ALTER TABLE IF EXISTS "on_market_candidates"
DROP COLUMN IF EXISTS "profit_worst_case",
DROP COLUMN IF EXISTS "profit_base_case",
DROP COLUMN IF EXISTS "profit_best_case",
DROP COLUMN IF EXISTS "return_worst_case",
DROP COLUMN IF EXISTS "return_base_case",
DROP COLUMN IF EXISTS "return_best_case";
