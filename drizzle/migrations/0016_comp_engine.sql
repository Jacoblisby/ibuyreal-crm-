ALTER TABLE "on_market_candidates" ADD COLUMN IF NOT EXISTS "comp_engine" jsonb;
ALTER TABLE "on_market_candidates" ADD COLUMN IF NOT EXISTS "comp_engine_median_ppm" double precision;
ALTER TABLE "on_market_candidates" ADD COLUMN IF NOT EXISTS "comp_engine_p10_ppm" double precision;
ALTER TABLE "on_market_candidates" ADD COLUMN IF NOT EXISTS "comp_engine_confidence" double precision;
ALTER TABLE "on_market_candidates" ADD COLUMN IF NOT EXISTS "comp_engine_at" timestamp with time zone;
