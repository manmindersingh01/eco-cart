ALTER TABLE "sellers" DROP CONSTRAINT "sellers_invoice_prefix_check";--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_cancellation_check" CHECK ((cancelled_at is null) = (cancel_reason is null));--> statement-breakpoint
ALTER TABLE "sellers" ADD CONSTRAINT "sellers_invoice_prefix_check" CHECK (invoice_prefix ~ '^[A-Z0-9]{1,4}$');