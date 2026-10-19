DROP INDEX "return_requests_user_id_idx";--> statement-breakpoint
DROP INDEX "return_requests_seller_id_idx";--> statement-breakpoint
CREATE INDEX "return_requests_user_id_created_at_idx" ON "return_requests" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "return_requests_seller_id_created_at_idx" ON "return_requests" USING btree ("seller_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "return_requests_open_line_key" ON "return_requests" USING btree ("order_item_id") WHERE status in ('requested', 'approved');--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_return_request_id_key" ON "refunds" USING btree ("return_request_id") WHERE return_request_id is not null;