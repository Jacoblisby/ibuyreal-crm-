ALTER TABLE "on_market_candidates" ADD COLUMN "image_assessment" jsonb;--> statement-breakpoint
ALTER TABLE "on_market_candidates" ADD COLUMN "image_assessment_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "on_market_candidates" ADD COLUMN "image_assessment_hash" text;