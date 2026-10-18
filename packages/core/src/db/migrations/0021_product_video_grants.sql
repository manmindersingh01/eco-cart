-- Product videos: the same privileges as product photos, which the seller
-- adds and removes while the listing may change, and the worker converts.
GRANT SELECT, INSERT, UPDATE, DELETE ON product_videos TO ecokart_web, ecokart_worker;
--> statement-breakpoint
CREATE TRIGGER product_videos_set_updated_at BEFORE UPDATE ON product_videos FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
