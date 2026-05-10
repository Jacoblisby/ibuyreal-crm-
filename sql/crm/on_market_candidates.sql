-- ============================================================
-- iBuyReal CRM — on_market_candidates table
-- Target schema : crm
-- Purpose       : Computed-only table keyed by case_id (listing UUID)
--                 Populated by scraper, read by CRM app
-- PostgreSQL    : 13+ (validated on PG18)
-- Idempotent    : safe to re-run (IF NOT EXISTS)
-- ============================================================

BEGIN;

-- ─── 1. Main Table ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crm.on_market_candidates (
  case_id                     uuid PRIMARY KEY,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  -- Afledte/screening-felter
  bydel                       text,

  -- Tidsdata
  sold_at                     timestamptz,

  -- Beregnede værdier (v3 metric suite)
  estimated_alpha             double precision,
  per_area_price_median_bydel double precision,

  v3_fmv                      double precision,
  v3_fmv_source               text,
  v3_alpha                    double precision,
  v3_investeret               double precision,
  v3_off_market_pris          double precision,
  v3_tx_kost                  double precision,
  v3_profit_worst             double precision,
  v3_profit_base              double precision,
  v3_afkast_worst             double precision,
  v3_afkast_base              double precision,
  v3_afkast_best              double precision,
  v3_profit_best              double precision,
  v3_calculated_at            timestamptz,

  -- Status
  status                      text NOT NULL DEFAULT 'active',
      -- Enum: 'active' | 'sold' | 'ignored'
  review_status               text NOT NULL DEFAULT 'ny',
      -- Enum: 'ny' | 'interesseret' | 'passet' | 'importeret'

  -- Hvis konverteret til Property
  converted_property_id       uuid REFERENCES crm.properties(id) ON DELETE SET NULL
);

-- ─── 2. Indexes ─────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS on_market_case_idx
  ON crm.on_market_candidates (case_id);

CREATE INDEX IF NOT EXISTS on_market_status_idx
  ON crm.on_market_candidates (status);

CREATE INDEX IF NOT EXISTS on_market_review_idx
  ON crm.on_market_candidates (review_status);

CREATE INDEX IF NOT EXISTS on_market_updated_idx
  ON crm.on_market_candidates (updated_at DESC);

COMMIT;
