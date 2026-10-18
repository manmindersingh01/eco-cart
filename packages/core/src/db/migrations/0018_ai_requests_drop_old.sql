ALTER TABLE "ai_requests" DROP COLUMN "cost_micro_inr";--> statement-breakpoint
DROP POLICY "web_all" ON "ai_requests" CASCADE;