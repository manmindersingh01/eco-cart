-- Cache invalidations (backend spec step 9). The web app records tags and
-- reads the latest ones every second; the worker records tags from its jobs
-- and deletes rows older than a day. Nobody changes a row once written.
GRANT SELECT, INSERT ON cache_invalidations TO ecokart_web;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON cache_invalidations TO ecokart_worker;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE cache_invalidations_id_seq TO ecokart_web, ecokart_worker;
