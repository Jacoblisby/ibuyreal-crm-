ALTER TABLE "on_market_candidates" ADD COLUMN IF NOT EXISTS "sun_score" integer;
ALTER TABLE "on_market_candidates" ADD COLUMN IF NOT EXISTS "sun_data" jsonb;
ALTER TABLE "on_market_candidates" ADD COLUMN IF NOT EXISTS "sun_calculated_at" timestamp with time zone;
