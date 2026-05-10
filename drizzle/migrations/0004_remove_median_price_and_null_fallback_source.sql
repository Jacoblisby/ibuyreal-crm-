ALTER TABLE IF EXISTS "on_market_candidates"
DROP COLUMN IF EXISTS "median_price_per_area";
--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.tables
		WHERE table_schema = current_schema()
			AND table_name = 'on_market_candidates'
	) THEN
		UPDATE "on_market_candidates"
		SET "prediction_source" = NULL
		WHERE "prediction_source" IS NOT NULL
			AND "prediction_source" <> 1;
	END IF;
END
$$;
