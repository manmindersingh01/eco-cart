CREATE TABLE "product_videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"upload_key" text,
	"failure_reason" text,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_videos_product_id_unique" UNIQUE("product_id"),
	CONSTRAINT "product_videos_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "product_videos_upload_key_unique" UNIQUE("upload_key"),
	CONSTRAINT "product_videos_status_check" CHECK (status in ('processing', 'ready', 'failed')),
	CONSTRAINT "product_videos_ready_check" CHECK (status <> 'ready' or (duration_ms is not null and width is not null and height is not null)),
	CONSTRAINT "product_videos_failed_check" CHECK ((status = 'failed') = (failure_reason is not null)),
	CONSTRAINT "product_videos_size_check" CHECK (duration_ms > 0 and width > 0 and height > 0)
);
--> statement-breakpoint
ALTER TABLE "product_videos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_videos" ADD CONSTRAINT "product_videos_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "web_select" ON "product_videos" AS PERMISSIVE FOR SELECT TO "ecokart_web" USING (exists (select 1 from products p where p.id = product_videos.product_id));--> statement-breakpoint
CREATE POLICY "web_insert" ON "product_videos" AS PERMISSIVE FOR INSERT TO "ecokart_web" WITH CHECK (exists (select 1 from products p where p.id = product_videos.product_id and (p.seller_id = app.seller_id() or app.has_full_access())));--> statement-breakpoint
CREATE POLICY "web_update" ON "product_videos" AS PERMISSIVE FOR UPDATE TO "ecokart_web" USING (exists (select 1 from products p where p.id = product_videos.product_id and (p.seller_id = app.seller_id() or app.has_full_access()))) WITH CHECK (exists (select 1 from products p where p.id = product_videos.product_id and (p.seller_id = app.seller_id() or app.has_full_access())));--> statement-breakpoint
CREATE POLICY "web_delete" ON "product_videos" AS PERMISSIVE FOR DELETE TO "ecokart_web" USING (exists (select 1 from products p where p.id = product_videos.product_id and (p.seller_id = app.seller_id() or app.has_full_access())));--> statement-breakpoint
CREATE POLICY "worker_all" ON "product_videos" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);