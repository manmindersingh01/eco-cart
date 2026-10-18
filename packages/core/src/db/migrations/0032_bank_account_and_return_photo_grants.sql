-- Privileges and updated_at triggers for seller bank accounts (design doc
-- 5.9) and return photos (design doc 5.7). Row-level security decides which
-- rows each user reaches.
GRANT SELECT, INSERT, UPDATE ON seller_bank_accounts, return_photos TO ecokart_web;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON seller_bank_accounts, return_photos TO ecokart_worker;
--> statement-breakpoint
CREATE TRIGGER seller_bank_accounts_set_updated_at BEFORE UPDATE ON seller_bank_accounts FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER return_photos_set_updated_at BEFORE UPDATE ON return_photos FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
