ALTER TABLE "order_items" ADD COLUMN "line_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_line_number_check" CHECK (line_number > 0);