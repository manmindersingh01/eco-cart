ALTER TABLE "ai_requests" RENAME COLUMN "cost_micro_inr" TO "cost_micro_usd";--> statement-breakpoint
ALTER TABLE "ai_requests" DROP CONSTRAINT "ai_requests_counts_check";--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_counts_check" CHECK (input_tokens >= 0 and output_tokens >= 0 and cost_micro_usd >= 0 and latency_ms >= 0);