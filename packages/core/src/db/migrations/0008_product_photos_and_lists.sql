DROP INDEX "products_seller_id_status_idx";--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "status" text DEFAULT 'processing' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "upload_key" text;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "failure_reason" text;--> statement-breakpoint
CREATE INDEX "products_seller_id_created_at_idx" ON "products" USING btree ("seller_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "products_seller_id_status_created_at_idx" ON "products" USING btree ("seller_id","status","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_upload_key_unique" UNIQUE("upload_key");--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_status_check" CHECK (status in ('processing', 'ready', 'failed'));--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_ready_check" CHECK (status <> 'ready' or (content_hash is not null and width is not null and height is not null));--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_failed_check" CHECK ((status = 'failed') = (failure_reason is not null));