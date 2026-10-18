ALTER TABLE "cart_items" DROP CONSTRAINT "cart_items_quantity_check";--> statement-breakpoint
CREATE INDEX "coupons_created_at_idx" ON "coupons" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_quantity_check" CHECK (quantity between 1 and 1000);