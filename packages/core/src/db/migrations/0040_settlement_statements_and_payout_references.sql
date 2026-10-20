CREATE TABLE "settlement_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"requested_by" uuid,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"storage_key" text,
	"opening_balance_paise" bigint,
	"closing_balance_paise" bigint,
	"entry_count" integer,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_statements_period_check" CHECK (period_end >= period_start and period_end - period_start < 366),
	CONSTRAINT "settlement_statements_status_check" CHECK (status in ('processing', 'ready', 'failed')),
	CONSTRAINT "settlement_statements_ready_check" CHECK ((status = 'ready') = (storage_key is not null and opening_balance_paise is not null and closing_balance_paise is not null and entry_count is not null)),
	CONSTRAINT "settlement_statements_failure_check" CHECK ((status = 'failed') = (failure_reason is not null))
);
--> statement-breakpoint
ALTER TABLE "settlement_statements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settlement_statements" ADD CONSTRAINT "settlement_statements_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_statements" ADD CONSTRAINT "settlement_statements_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "settlement_statements_seller_id_created_at_idx" ON "settlement_statements" USING btree ("seller_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "seller_ledger_entries_payout_reference_idx" ON "seller_ledger_entries" USING btree ("seller_id","reference") WHERE entry_type = 'payout';--> statement-breakpoint
ALTER TABLE "seller_ledger_entries" ADD CONSTRAINT "seller_ledger_entries_payout_reference_check" CHECK (entry_type <> 'payout' or reference is not null);--> statement-breakpoint
CREATE POLICY "web_select" ON "settlement_statements" AS PERMISSIVE FOR SELECT TO "ecokart_web" USING (seller_id = app.seller_id() or app.has_full_access());--> statement-breakpoint
CREATE POLICY "web_insert" ON "settlement_statements" AS PERMISSIVE FOR INSERT TO "ecokart_web" WITH CHECK (app.has_full_access() or (seller_id = app.seller_id() and status = 'processing'));--> statement-breakpoint
CREATE POLICY "worker_all" ON "settlement_statements" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);