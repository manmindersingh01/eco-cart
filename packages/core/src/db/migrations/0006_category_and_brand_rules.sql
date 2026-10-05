ALTER TABLE "categories" DROP CONSTRAINT "categories_depth_check";--> statement-breakpoint
ALTER TABLE "categories" DROP CONSTRAINT "categories_default_hsn_code_check";--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_hsn_code_check";--> statement-breakpoint
CREATE UNIQUE INDEX "brands_name_unique" ON "brands" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "categories_parent_id_name_unique" ON "categories" USING btree (coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name"));--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_slug_check" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_depth_parent_check" CHECK ((parent_id is null) = (depth = 0));--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_slug_check" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_depth_check" CHECK (depth between 0 and 2);--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_default_hsn_code_check" CHECK (default_hsn_code ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$');--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_hsn_code_check" CHECK (hsn_code ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$');