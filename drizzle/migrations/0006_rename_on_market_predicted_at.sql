DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'crm'
      AND table_name = 'on_market_candidates'
      AND column_name = 'calculated_at'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'crm'
      AND table_name = 'on_market_candidates'
      AND column_name = 'predicted_at'
  ) THEN
    ALTER TABLE crm.on_market_candidates
      RENAME COLUMN calculated_at TO predicted_at;
  END IF;
END $$;
