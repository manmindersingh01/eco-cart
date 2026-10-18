CREATE TABLE "cache_invalidations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cache_invalidations_tag_check" CHECK (length(tag) between 1 and 256)
);
--> statement-breakpoint
CREATE INDEX "cache_invalidations_created_at_idx" ON "cache_invalidations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "products_public_category_published_idx" ON "products" USING btree ("category_id","published_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE status = 'approved' and deleted_at is null;--> statement-breakpoint
CREATE INDEX "products_public_category_price_idx" ON "products" USING btree ("category_id","min_price_paise","id") WHERE status = 'approved' and deleted_at is null;--> statement-breakpoint
CREATE INDEX "products_public_published_idx" ON "products" USING btree ("published_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE status = 'approved' and deleted_at is null;--> statement-breakpoint
CREATE INDEX "products_public_brand_idx" ON "products" USING btree ("brand_id") WHERE status = 'approved' and deleted_at is null;