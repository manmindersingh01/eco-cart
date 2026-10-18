CREATE TABLE "cache_invalidations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cache_invalidations_tag_check" CHECK (length(tag) between 1 and 256)
);
--> statement-breakpoint
CREATE INDEX "cache_invalidations_created_at_idx" ON "cache_invalidations" USING btree ("created_at");