-- Settlement statements (step 15): the web app adds them, and only the
-- worker fills them in.
GRANT SELECT, INSERT ON settlement_statements TO ecokart_web;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON settlement_statements TO ecokart_worker;
--> statement-breakpoint
CREATE TRIGGER settlement_statements_set_updated_at BEFORE UPDATE ON settlement_statements FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
