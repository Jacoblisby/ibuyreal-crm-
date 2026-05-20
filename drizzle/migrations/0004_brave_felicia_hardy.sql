ALTER TABLE "on_market_candidates" ADD COLUMN "manual_fmv" double precision;--> statement-breakpoint
ALTER TABLE "on_market_candidates" ADD COLUMN "manual_fmv_note" text;--> statement-breakpoint
ALTER TABLE "on_market_candidates" ADD COLUMN "manual_fmv_set_at" timestamp with time zone;