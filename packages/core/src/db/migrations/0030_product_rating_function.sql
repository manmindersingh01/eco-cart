-- Product ratings (backend spec step 16). A buyer's review changes the
-- product's rating_avg and rating_count, but row-level security rightly lets
-- a buyer change no product. This function, run as the table owner, makes
-- that one change and nothing else: it recalculates both from the product's
-- published reviews, so a caller can never set a rating of its own choosing.
--
-- It first locks the product row, so a review written at the same moment
-- waits for this transaction to commit; the UPDATE after the lock reads the
-- reviews again with a fresh snapshot (plpgsql takes one per statement under
-- READ COMMITTED), so neither review is left out of the count.
CREATE FUNCTION app.refresh_product_rating(target uuid)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    PERFORM 1 FROM public.products WHERE id = target FOR NO KEY UPDATE;
    UPDATE public.products AS p
    SET rating_avg = coalesce(r.average, 0),
        rating_count = r.count
    FROM (
      SELECT round(avg(rating)::numeric, 2) AS average, count(*)::integer AS count
      FROM public.reviews
      WHERE product_id = target AND status = 'published'
    ) AS r
    WHERE p.id = target;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.refresh_product_rating(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.refresh_product_rating(uuid) TO ecokart_web, ecokart_worker;
