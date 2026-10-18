ALTER TABLE "content_pages" ALTER COLUMN "updated_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "author_name" text NOT NULL;--> statement-breakpoint
CREATE INDEX "reviews_status_created_at_idx" ON "reviews" USING btree ("status","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_author_name_check" CHECK (length(author_name) between 1 and 50);