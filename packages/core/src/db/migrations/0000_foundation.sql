-- Foundation for every later migration (backend spec, step 1).
-- Extensions, the two database users the programs log in as, and the helper
-- functions that row-level security policies and triggers call.

-- pgvector for embeddings and pg_trgm for typo-tolerant search (design doc 6.8).
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

-- Roles belong to the whole server, not one database, so another database on
-- the same server (for example a test database) may already have made them.
-- They start without LOGIN; `pnpm db:migrate` sets their passwords.
DO $$
BEGIN
  CREATE ROLE ecokart_web NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE ROLE ecokart_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END
$$;
--> statement-breakpoint

-- The request context set by withContext() in src/db/context.ts.
CREATE SCHEMA app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO ecokart_web, ecokart_worker;
--> statement-breakpoint

-- current_setting(..., true) returns NULL when the value was never set and ''
-- after a SET LOCAL from an earlier transaction ended, so both mean "none".
CREATE FUNCTION app.user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION app.seller_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.seller_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION app.guest_token() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.guest_token', true), '') $$;
--> statement-breakpoint
CREATE FUNCTION app.role_name() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT coalesce(nullif(current_setting('app.role', true), ''), 'anonymous') $$;
--> statement-breakpoint
CREATE FUNCTION app.has_full_access() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT app.role_name() IN ('admin', 'system') $$;
--> statement-breakpoint

-- True when the current seller has at least one item in the order.
-- The orders policy needs this, and the order_items policy looks at orders,
-- so asking order_items directly would make the two policies call each other
-- forever. SECURITY DEFINER runs the lookup as the table owner, which row-level
-- security does not apply to, and it only ever answers yes or no.
-- plpgsql (not sql) because order_items does not exist yet when this runs.
CREATE FUNCTION app.is_order_seller(p_order_id uuid) RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF app.seller_id() IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.order_items oi
    WHERE oi.order_id = p_order_id AND oi.seller_id = app.seller_id()
  );
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.is_order_seller(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.is_order_seller(uuid) TO ecokart_web;
--> statement-breakpoint

-- Keeps updated_at current on every UPDATE, including raw SQL ones.
CREATE FUNCTION app.set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint

-- For append-only tables: history is corrected with a new row, never changed.
CREATE FUNCTION app.reject_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION '% is append only; add a new row instead', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END
$$;
