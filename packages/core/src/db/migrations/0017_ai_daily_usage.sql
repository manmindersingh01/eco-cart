-- How many AI calls the platform and one seller have made since a time, for
-- the daily limits (backend spec step 17, design doc 5.12). Each count takes
-- the features that count against it, which the AI service decides.
-- Row-level security lets a buyer's request see only shared rows and its own,
-- so a count made from that request would be too low and the platform limit
-- would never stop it. SECURITY DEFINER runs the count as the table owner,
-- which row-level security does not apply to, and it only ever returns two
-- numbers, never a row's content.
CREATE FUNCTION app.ai_calls_since(
  p_since timestamptz,
  p_seller_id uuid,
  p_platform_features text[],
  p_seller_features text[]
)
  RETURNS TABLE (platform_calls integer, seller_calls integer)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT
      (SELECT count(*)::integer FROM public.ai_requests
        WHERE created_at >= p_since AND feature = ANY (p_platform_features)),
      (SELECT count(*)::integer FROM public.ai_requests
        WHERE p_seller_id IS NOT NULL AND seller_id = p_seller_id
          AND created_at >= p_since AND feature = ANY (p_seller_features))
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.ai_calls_since(timestamptz, uuid, text[], text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.ai_calls_since(timestamptz, uuid, text[], text[]) TO ecokart_web, ecokart_worker;
