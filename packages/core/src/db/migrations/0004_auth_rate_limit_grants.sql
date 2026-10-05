-- Better Auth keeps its rate-limit counters here (backend spec, step 2). It
-- holds no buyer or seller data, so it has no row-level security, like the
-- other Better Auth tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON auth_rate_limits TO ecokart_web;
--> statement-breakpoint
GRANT SELECT ON auth_rate_limits TO ecokart_worker;
