CREATE TABLE "seller_document_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"upload_key" text NOT NULL,
	"storage_key" text,
	"status" text DEFAULT 'processing' NOT NULL,
	"content_type" text,
	"size_bytes" integer,
	"content_hash" text,
	"failure_reason" text,
	"rejection_reason" text,
	"uploaded_by" uuid NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_document_files_upload_key_unique" UNIQUE("upload_key"),
	CONSTRAINT "seller_document_files_status_check" CHECK (status in ('processing', 'received', 'failed', 'accepted', 'rejected')),
	CONSTRAINT "seller_document_files_content_type_check" CHECK (content_type in ('application/pdf', 'image/jpeg', 'image/png')),
	CONSTRAINT "seller_document_files_checked_check" CHECK ((status in ('received', 'accepted', 'rejected')) = (storage_key is not null and content_type is not null and size_bytes is not null and content_hash is not null)),
	CONSTRAINT "seller_document_files_failure_check" CHECK ((status = 'failed') = (failure_reason is not null)),
	CONSTRAINT "seller_document_files_rejection_check" CHECK ((status = 'rejected') = (rejection_reason is not null)),
	CONSTRAINT "seller_document_files_reviewed_check" CHECK ((status in ('accepted', 'rejected')) = (reviewed_at is not null))
);
--> statement-breakpoint
ALTER TABLE "seller_document_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "seller_document_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"note" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"requested_by" uuid,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_document_requests_status_check" CHECK (status in ('requested', 'processing', 'received', 'accepted', 'cancelled')),
	CONSTRAINT "seller_document_requests_document_type_check" CHECK (document_type in ('gst_certificate', 'pan_card', 'bank_proof', 'business_registration', 'address_proof', 'other')),
	CONSTRAINT "seller_document_requests_note_check" CHECK (char_length(note) between 1 and 500),
	CONSTRAINT "seller_document_requests_accepted_check" CHECK ((status = 'accepted') = (accepted_at is not null)),
	CONSTRAINT "seller_document_requests_cancelled_check" CHECK ((status = 'cancelled') = (cancelled_at is not null) and (cancelled_at is null) = (cancel_reason is null))
);
--> statement-breakpoint
ALTER TABLE "seller_document_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seller_document_files" ADD CONSTRAINT "seller_document_files_request_id_seller_document_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."seller_document_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_document_files" ADD CONSTRAINT "seller_document_files_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_document_files" ADD CONSTRAINT "seller_document_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_document_files" ADD CONSTRAINT "seller_document_files_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_document_requests" ADD CONSTRAINT "seller_document_requests_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_document_requests" ADD CONSTRAINT "seller_document_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_document_requests" ADD CONSTRAINT "seller_document_requests_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_document_requests" ADD CONSTRAINT "seller_document_requests_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seller_document_files_request_id_created_at_idx" ON "seller_document_files" USING btree ("request_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "seller_document_files_received_idx" ON "seller_document_files" USING btree ("created_at","id") WHERE status = 'received';--> statement-breakpoint
CREATE UNIQUE INDEX "seller_document_files_live_request_id_unique" ON "seller_document_files" USING btree ("request_id") WHERE status in ('processing', 'received');--> statement-breakpoint
CREATE INDEX "seller_document_requests_seller_id_created_at_idx" ON "seller_document_requests" USING btree ("seller_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "web_select" ON "seller_document_files" AS PERMISSIVE FOR SELECT TO "ecokart_web" USING (seller_id = app.seller_id() or app.has_full_access());--> statement-breakpoint
CREATE POLICY "web_insert" ON "seller_document_files" AS PERMISSIVE FOR INSERT TO "ecokart_web" WITH CHECK (app.has_full_access() or (seller_id = app.seller_id() and uploaded_by = app.user_id() and status = 'processing' and exists (select 1 from seller_document_requests r where r.id = seller_document_files.request_id and r.seller_id = app.seller_id())));--> statement-breakpoint
CREATE POLICY "web_update" ON "seller_document_files" AS PERMISSIVE FOR UPDATE TO "ecokart_web" USING (app.has_full_access()) WITH CHECK (app.has_full_access());--> statement-breakpoint
CREATE POLICY "worker_all" ON "seller_document_files" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "web_select" ON "seller_document_requests" AS PERMISSIVE FOR SELECT TO "ecokart_web" USING (seller_id = app.seller_id() or app.has_full_access());--> statement-breakpoint
CREATE POLICY "web_insert" ON "seller_document_requests" AS PERMISSIVE FOR INSERT TO "ecokart_web" WITH CHECK (app.has_full_access());--> statement-breakpoint
CREATE POLICY "web_update" ON "seller_document_requests" AS PERMISSIVE FOR UPDATE TO "ecokart_web" USING (seller_id = app.seller_id() or app.has_full_access()) WITH CHECK (app.has_full_access() or (seller_id = app.seller_id() and status = 'processing'));--> statement-breakpoint
CREATE POLICY "worker_all" ON "seller_document_requests" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);