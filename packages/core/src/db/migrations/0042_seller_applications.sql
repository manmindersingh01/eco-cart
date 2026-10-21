ALTER TABLE "email_outbox" DROP CONSTRAINT "email_outbox_template_check";--> statement-breakpoint
ALTER TABLE "sellers" DROP CONSTRAINT "sellers_status_check";--> statement-breakpoint
ALTER TABLE "sellers" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_template_check" CHECK (template in ('otp', 'order_placed', 'payment_received', 'dispatched', 'cancelled', 'refund_recorded', 'seller_application'));--> statement-breakpoint
ALTER TABLE "sellers" ADD CONSTRAINT "sellers_status_check" CHECK (status in ('pending', 'approved', 'suspended', 'rejected'));--> statement-breakpoint
ALTER POLICY "web_insert" ON "sellers" TO ecokart_web WITH CHECK ((owner_user_id = app.user_id() and status = 'pending' and approved_at is null) or app.has_full_access());