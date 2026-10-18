-- Privileges and updated_at triggers for the seller document tables (design
-- doc 5.4). Row-level security decides which rows each user reaches.
GRANT SELECT, INSERT, UPDATE ON seller_document_requests, seller_document_files TO ecokart_web;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON seller_document_requests, seller_document_files TO ecokart_worker;
--> statement-breakpoint
CREATE TRIGGER seller_document_requests_set_updated_at BEFORE UPDATE ON seller_document_requests FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER seller_document_files_set_updated_at BEFORE UPDATE ON seller_document_files FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
