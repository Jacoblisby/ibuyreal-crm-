ALTER TABLE "on_market_candidates" ADD COLUMN "case_id" uuid;
--> statement-breakpoint

UPDATE "on_market_candidates" c
SET "case_id" = l.case_id
FROM public.listing l
WHERE c.case_id IS NULL
  AND c.source_url = l.source_url;
--> statement-breakpoint

DELETE FROM "on_market_candidates"
WHERE case_id IS NULL;
--> statement-breakpoint

DELETE FROM "on_market_candidates" a
USING "on_market_candidates" b
WHERE a.ctid < b.ctid
  AND a.case_id = b.case_id;
--> statement-breakpoint

ALTER TABLE "on_market_candidates" DROP CONSTRAINT IF EXISTS "on_market_candidates_pkey";
--> statement-breakpoint

ALTER TABLE "on_market_candidates" ALTER COLUMN "case_id" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "on_market_candidates" ADD CONSTRAINT "on_market_candidates_pkey" PRIMARY KEY ("case_id");
--> statement-breakpoint

DROP INDEX IF EXISTS "on_market_source_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "on_market_postal_idx";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "on_market_case_idx" ON "on_market_candidates" USING btree ("case_id");
--> statement-breakpoint

ALTER TABLE "on_market_candidates" ADD COLUMN IF NOT EXISTS "v3_tx_kost" double precision;
--> statement-breakpoint
ALTER TABLE "on_market_candidates" ADD COLUMN IF NOT EXISTS "v3_profit_worst" double precision;
--> statement-breakpoint
ALTER TABLE "on_market_candidates" ADD COLUMN IF NOT EXISTS "v3_profit_base" double precision;
--> statement-breakpoint

ALTER TABLE "on_market_candidates" DROP COLUMN IF EXISTS "id";
--> statement-breakpoint
ALTER TABLE "on_market_candidates" DROP COLUMN IF EXISTS "source";
--> statement-breakpoint
ALTER TABLE "on_market_candidates" DROP COLUMN IF EXISTS "source_id";
--> statement-breakpoint
ALTER TABLE "on_market_candidates" DROP COLUMN IF EXISTS "source_url";
--> statement-breakpoint
ALTER TABLE "on_market_candidates" DROP COLUMN IF EXISTS "case_url";
--> statement-breakpoint
ALTER TABLE "on_market_candidates" DROP COLUMN IF EXISTS "address";
--> statement-breakpoint
ALTER TABLE "on_market_candidates" DROP COLUMN IF EXISTS "postal_code";
--> statement-breakpoint
ALTER TABLE "on_market_candidates" DROP COLUMN IF EXISTS "city";
--> statement-breakpoint
ALTER TABLE "on_market_candidates" DROP COLUMN IF EXISTS "kvm";
--> statement-breakpoint
ALTER TABLE "on_market_candidates" DROP COLUMN IF EXISTS "rooms";
--> statement-breakpoint
ALTER TABLE "on_market_candidates" DROP COLUMN IF EXISTS "year_built";
--> statement-breakpoint
ALTER TABLE "on_market_candidates" DROP COLUMN IF EXISTS "list_price";
--> statement-breakpoint
ALTER TABLE "on_market_candidates" DROP COLUMN IF EXISTS "monthly_expense";
--> statement-breakpoint
ALTER TABLE "on_market_candidates" DROP COLUMN IF EXISTS "per_area_price";
--> statement-breakpoint
ALTER TABLE "on_market_candidates" DROP COLUMN IF EXISTS "latest_valuation";
--> statement-breakpoint
ALTER TABLE "on_market_candidates" DROP COLUMN IF EXISTS "broker_kind";
--> statement-breakpoint
ALTER TABLE "on_market_candidates" DROP COLUMN IF EXISTS "realtor_name";
--> statement-breakpoint
ALTER TABLE "on_market_candidates" DROP COLUMN IF EXISTS "days_on_market";
--> statement-breakpoint
ALTER TABLE "on_market_candidates" DROP COLUMN IF EXISTS "first_seen_at";
--> statement-breakpoint
ALTER TABLE "on_market_candidates" DROP COLUMN IF EXISTS "last_seen_at";
--> statement-breakpoint
ALTER TABLE "on_market_candidates" DROP COLUMN IF EXISTS "description_title";
--> statement-breakpoint
ALTER TABLE "on_market_candidates" DROP COLUMN IF EXISTS "description";
--> statement-breakpoint
ALTER TABLE "on_market_candidates" DROP COLUMN IF EXISTS "images";
--> statement-breakpoint
ALTER TABLE "on_market_candidates" DROP COLUMN IF EXISTS "primary_image";