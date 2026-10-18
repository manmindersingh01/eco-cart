CREATE TABLE "seller_bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"account_holder" text NOT NULL,
	"account_number_sealed" text NOT NULL,
	"account_number_last4" char(4) NOT NULL,
	"ifsc" char(11) NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_bank_accounts_seller_id_unique" UNIQUE("seller_id"),
	CONSTRAINT "seller_bank_accounts_account_holder_check" CHECK (char_length(account_holder) between 1 and 100),
	CONSTRAINT "seller_bank_accounts_account_number_sealed_check" CHECK (account_number_sealed like 'v1.%'),
	CONSTRAINT "seller_bank_accounts_account_number_last4_check" CHECK (account_number_last4 ~ '^[0-9]{4}$'),
	CONSTRAINT "seller_bank_accounts_ifsc_check" CHECK (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$')
);
--> statement-breakpoint
ALTER TABLE "seller_bank_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "return_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"return_request_id" uuid,
	"upload_key" text NOT NULL,
	"storage_key" text,
	"status" text DEFAULT 'processing' NOT NULL,
	"failure_reason" text,
	"content_hash" text,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_photos_upload_key_unique" UNIQUE("upload_key"),
	CONSTRAINT "return_photos_status_check" CHECK (status in ('processing', 'ready', 'failed')),
	CONSTRAINT "return_photos_ready_check" CHECK ((status = 'ready') = (storage_key is not null and content_hash is not null and width is not null and height is not null)),
	CONSTRAINT "return_photos_failure_check" CHECK ((status = 'failed') = (failure_reason is not null)),
	CONSTRAINT "return_photos_attached_check" CHECK (return_request_id is null or status = 'ready')
);
--> statement-breakpoint
ALTER TABLE "return_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seller_bank_accounts" ADD CONSTRAINT "seller_bank_accounts_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_bank_accounts" ADD CONSTRAINT "seller_bank_accounts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_photos" ADD CONSTRAINT "return_photos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_photos" ADD CONSTRAINT "return_photos_return_request_id_return_requests_id_fk" FOREIGN KEY ("return_request_id") REFERENCES "public"."return_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "return_photos_user_id_created_at_idx" ON "return_photos" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "return_photos_return_request_id_idx" ON "return_photos" USING btree ("return_request_id");--> statement-breakpoint
CREATE POLICY "web_select" ON "seller_bank_accounts" AS PERMISSIVE FOR SELECT TO "ecokart_web" USING (seller_id = app.seller_id() or app.has_full_access());--> statement-breakpoint
CREATE POLICY "web_insert" ON "seller_bank_accounts" AS PERMISSIVE FOR INSERT TO "ecokart_web" WITH CHECK (app.has_full_access());--> statement-breakpoint
CREATE POLICY "web_update" ON "seller_bank_accounts" AS PERMISSIVE FOR UPDATE TO "ecokart_web" USING (app.has_full_access()) WITH CHECK (app.has_full_access());--> statement-breakpoint
CREATE POLICY "worker_all" ON "seller_bank_accounts" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "web_select" ON "return_photos" AS PERMISSIVE FOR SELECT TO "ecokart_web" USING (user_id = app.user_id() or app.has_full_access() or exists (select 1 from return_requests r where r.id = return_photos.return_request_id and r.seller_id = app.seller_id()));--> statement-breakpoint
CREATE POLICY "web_insert" ON "return_photos" AS PERMISSIVE FOR INSERT TO "ecokart_web" WITH CHECK (app.has_full_access() or (user_id = app.user_id() and status = 'processing' and return_request_id is null));--> statement-breakpoint
CREATE POLICY "web_update" ON "return_photos" AS PERMISSIVE FOR UPDATE TO "ecokart_web" USING (user_id = app.user_id() or app.has_full_access()) WITH CHECK (app.has_full_access() or (user_id = app.user_id() and exists (select 1 from return_requests r where r.id = return_photos.return_request_id and r.user_id = app.user_id())));--> statement-breakpoint
CREATE POLICY "worker_all" ON "return_photos" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);