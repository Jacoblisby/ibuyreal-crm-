ALTER TABLE "on_market_candidates" ADD COLUMN IF NOT EXISTS "previous_list_price" double precision;
ALTER TABLE "on_market_candidates" ADD COLUMN IF NOT EXISTS "price_changed_at" timestamp with time zone;

CREATE TABLE IF NOT EXISTS "digest_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sent_at" timestamp with time zone NOT NULL DEFAULT now(),
  "recipient" text,
  "ok" boolean NOT NULL DEFAULT true,
  "error" text,
  "top_pick_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "handyman_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "price_cut_ids" jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS "digest_runs_sent_idx" ON "digest_runs" ("sent_at" DESC);
