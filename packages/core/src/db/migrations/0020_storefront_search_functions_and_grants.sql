-- Keyword search (backend spec step 9).
-- The full-text (@@) and trigram (<%) operators are not leakproof, so on a
-- table with row-level security PostgreSQL never uses their GIN indexes, and
-- every search would read every product on sale. These functions run the
-- match as the table owner, which row-level security does not apply to, so
-- the indexes work. They only ever return ids, with a rank, of products that
-- visitors may see anyway: approved, not deleted, from an approved seller.
-- The storefront query joins them and applies its own checks and row-level
-- security on top.
CREATE FUNCTION app.public_products_with_words(words text)
  RETURNS TABLE (product_id uuid, rank numeric)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    -- The same 'english' configuration as products.search_vector (step 1).
    -- The rank is rounded so a page cursor compares exactly.
    SELECT p.id, round(ts_rank(p.search_vector, q.query)::numeric, 6)
    FROM public.products p, websearch_to_tsquery('english', words) AS q(query)
    WHERE p.search_vector @@ q.query
      AND p.status = 'approved'
      AND p.deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM public.sellers s
        WHERE s.id = p.seller_id AND s.status = 'approved'
      )
  $$;
--> statement-breakpoint
-- The typo fallback: word similarity above pg_trgm's threshold (0.6 unless
-- the session changes pg_trgm.word_similarity_threshold).
CREATE FUNCTION app.public_products_with_similar_words(words text)
  RETURNS TABLE (product_id uuid, rank numeric)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT p.id, round(public.word_similarity(words, p.search_text)::numeric, 6)
    FROM public.products p
    WHERE words OPERATOR(public.<%) p.search_text
      AND p.status = 'approved'
      AND p.deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM public.sellers s
        WHERE s.id = p.seller_id AND s.status = 'approved'
      )
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.public_products_with_words(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.public_products_with_similar_words(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.public_products_with_words(text) TO ecokart_web, ecokart_worker;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.public_products_with_similar_words(text) TO ecokart_web, ecokart_worker;
--> statement-breakpoint
-- Cache invalidations (backend spec step 9). The web app records tags and
-- reads the latest ones every second; the worker records tags from its jobs
-- and deletes rows older than a day. Nobody changes a row once written.
GRANT SELECT, INSERT ON cache_invalidations TO ecokart_web;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON cache_invalidations TO ecokart_worker;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE cache_invalidations_id_seq TO ecokart_web, ecokart_worker;
