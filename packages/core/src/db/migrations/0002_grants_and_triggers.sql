-- Table privileges for the two database users, and the triggers that keep
-- updated_at current and append-only tables unchanged (backend spec, step 1).
-- Row-level security decides which rows a user reaches; these grants decide
-- which commands it may run at all. A table added later grants its own.

-- Better Auth's tables: only Better Auth, inside the web app, changes them.
GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions, accounts, verifications TO ecokart_web;
--> statement-breakpoint
GRANT SELECT ON users, sessions, accounts, verifications TO ecokart_worker;
--> statement-breakpoint

-- Web app.
GRANT SELECT, INSERT, UPDATE ON
  addresses, sellers, categories, brands, products, product_moderation,
  coupons, orders, order_items, shipments, return_requests, invoices,
  payments, payment_events, catalogue_imports, ai_requests,
  platform_settings, content_pages
  TO ecokart_web;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON
  product_variants, product_images, carts, cart_items, reviews, rate_limits
  TO ecokart_web;
--> statement-breakpoint
GRANT SELECT, INSERT ON
  order_events, refunds, seller_ledger_entries, search_queries, email_outbox,
  audit_logs
  TO ecokart_web;
--> statement-breakpoint
-- Embeddings and import rows are written only by the worker.
GRANT SELECT ON product_embeddings, catalogue_import_rows TO ecokart_web;
--> statement-breakpoint

-- Worker.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  addresses, sellers, categories, brands, products, product_variants,
  product_images, product_moderation, product_embeddings, carts, cart_items,
  coupons, orders, order_items, shipments, return_requests, invoices,
  payments, payment_events, reviews, catalogue_imports, catalogue_import_rows,
  ai_requests, search_queries, platform_settings, content_pages, email_outbox,
  rate_limits
  TO ecokart_worker;
--> statement-breakpoint
GRANT SELECT, INSERT ON order_events, refunds, seller_ledger_entries, audit_logs
  TO ecokart_worker;
--> statement-breakpoint

-- bigserial ids on the append-only logs.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ecokart_web, ecokart_worker;
--> statement-breakpoint

-- One role per account (design doc 11). Better Auth writes this column; the
-- constraint stops anything else from slipping in.
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('buyer', 'seller', 'admin'));
--> statement-breakpoint

-- Append-only history. The grants above already refuse UPDATE and DELETE to
-- both users; the triggers refuse them to the owner as well.
CREATE TRIGGER seller_ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON seller_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();
--> statement-breakpoint
CREATE TRIGGER seller_ledger_entries_no_truncate
  BEFORE TRUNCATE ON seller_ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_change();
--> statement-breakpoint
CREATE TRIGGER order_events_append_only
  BEFORE UPDATE OR DELETE ON order_events
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();
--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();
--> statement-breakpoint

-- updated_at on every mutable table except Better Auth's, which sets its own.
CREATE TRIGGER addresses_set_updated_at BEFORE UPDATE ON addresses FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER sellers_set_updated_at BEFORE UPDATE ON sellers FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER categories_set_updated_at BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER brands_set_updated_at BEFORE UPDATE ON brands FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER product_variants_set_updated_at BEFORE UPDATE ON product_variants FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER product_images_set_updated_at BEFORE UPDATE ON product_images FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER product_moderation_set_updated_at BEFORE UPDATE ON product_moderation FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER product_embeddings_set_updated_at BEFORE UPDATE ON product_embeddings FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER carts_set_updated_at BEFORE UPDATE ON carts FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER cart_items_set_updated_at BEFORE UPDATE ON cart_items FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER coupons_set_updated_at BEFORE UPDATE ON coupons FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER orders_set_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER order_items_set_updated_at BEFORE UPDATE ON order_items FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER shipments_set_updated_at BEFORE UPDATE ON shipments FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER return_requests_set_updated_at BEFORE UPDATE ON return_requests FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER invoices_set_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER payments_set_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER reviews_set_updated_at BEFORE UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER catalogue_imports_set_updated_at BEFORE UPDATE ON catalogue_imports FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER catalogue_import_rows_set_updated_at BEFORE UPDATE ON catalogue_import_rows FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER ai_requests_set_updated_at BEFORE UPDATE ON ai_requests FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER platform_settings_set_updated_at BEFORE UPDATE ON platform_settings FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER content_pages_set_updated_at BEFORE UPDATE ON content_pages FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER email_outbox_set_updated_at BEFORE UPDATE ON email_outbox FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER rate_limits_set_updated_at BEFORE UPDATE ON rate_limits FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
