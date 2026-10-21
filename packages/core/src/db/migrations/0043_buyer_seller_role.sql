-- One account can be both buyer and seller (design doc 11, decided 20 October
-- 2026). Better Auth's admin plugin keeps several roles as one comma-separated
-- value, and approving a buyer's seller application adds `seller` after
-- `buyer`. Administrators keep a role of their own.
ALTER TABLE users DROP CONSTRAINT users_role_check;
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('buyer', 'seller', 'admin', 'buyer,seller'));
