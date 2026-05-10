-- ============================================================
-- iBuyReal CRM — schema bootstrap
-- Target schema : crm
-- PostgreSQL    : 13+ (validated on PG18)
-- Idempotent    : safe to re-run (IF NOT EXISTS throughout)
-- Run with      : psql -d <your_db> -f sql/001_crm_bootstrap.sql
-- ============================================================

BEGIN;

-- ─── 1. Schema ───────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS crm;

-- ─── 2. Tables ───────────────────────────────────────────────────────────────
-- Order matters: investors before properties (FK dependency),
-- properties before on_market_candidates (FK dependency).

CREATE TABLE IF NOT EXISTS crm.investors (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  timestamptz NOT NULL DEFAULT now(),
    name        text        NOT NULL,
    email       text,
    phone       text,
    committed   double precision,
    deployed    double precision,
    notes       text
);

CREATE TABLE IF NOT EXISTS crm.properties (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),

    -- Stamdata
    address           text        NOT NULL,
    bydel             text        NOT NULL,
    postnr            text,
    kvm               integer     NOT NULL,
    vaer              integer     NOT NULL,
    bygaar            integer,
    etage             text,
    energi            text,

    -- Marked
    udbud             double precision NOT NULL,
    dage              integer,
    boligsiden_url    text,

    -- AVM
    fmv               double precision,
    avm_kvm           double precision,
    afvigelse         double precision,
    decil             integer,

    -- Off-market
    off_market_pris   double precision,
    tx_kost           double precision,
    investeret        double precision,

    -- Airbnb
    adr               double precision,
    occ               double precision,
    brutto_airbnb     double precision,
    net_airbnb        double precision,

    -- Ejerudgifter
    ej_skat           double precision,
    ej_grundskyld     double precision,
    ej_faelles        double precision,
    ej_ovrige         double precision,
    ej_total          double precision,

    -- Cashflow
    net_cashflow      double precision,
    cf_yield_best     double precision,
    cf_yield_base     double precision,
    cf_yield_worst    double precision,

    -- Scenarier (beregnet cache)
    alpha             double precision,
    profit_worst      double precision,
    profit_base       double precision,
    profit_best       double precision,
    afkast_worst      double precision,
    afkast_base       double precision,
    afkast_best       double precision,

    -- Pipeline
    status            text NOT NULL DEFAULT 'screening',
    tilbud_pris       double precision,
    tilbud_dato       timestamptz,
    notes             text,

    -- Links
    prospekt_url      text,
    image_url         text,

    -- FK
    investor_id       uuid
);

CREATE TABLE IF NOT EXISTS crm.assumptions (
    id                    text PRIMARY KEY DEFAULT 'default',

    -- Airbnb ADR (DKK/nat) per bydel
    adr_indreby           double precision NOT NULL DEFAULT 1609,
    adr_vesterbro         double precision NOT NULL DEFAULT 1195,
    adr_noerrebro         double precision NOT NULL DEFAULT 1100,
    adr_frederiksberg     double precision NOT NULL DEFAULT 1250,
    adr_osterbro          double precision NOT NULL DEFAULT 1202,
    adr_amager            double precision NOT NULL DEFAULT 1150,

    -- Belægningsgrad (%) per bydel
    occ_indreby           double precision NOT NULL DEFAULT 83,
    occ_vesterbro         double precision NOT NULL DEFAULT 80,
    occ_noerrebro         double precision NOT NULL DEFAULT 78,
    occ_frederiksberg     double precision NOT NULL DEFAULT 80,
    occ_osterbro          double precision NOT NULL DEFAULT 78,
    occ_amager            double precision NOT NULL DEFAULT 78,

    -- Roomtype-faktorer
    room_studio           double precision NOT NULL DEFAULT 0.7,
    room_1v               double precision NOT NULL DEFAULT 0.85,
    room_2v               double precision NOT NULL DEFAULT 1.0,
    room_3v               double precision NOT NULL DEFAULT 1.4,
    room_4v               double precision NOT NULL DEFAULT 1.9,

    -- Standfaktorer
    stand_luksus          double precision NOT NULL DEFAULT 1.15,
    stand_god             double precision NOT NULL DEFAULT 1.0,
    stand_aeldre          double precision NOT NULL DEFAULT 0.85,

    -- Airbnb-udgifter
    platform_pct          double precision NOT NULL DEFAULT 15,
    rengoring_kr          double precision NOT NULL DEFAULT 300,
    naetter_per_booking   double precision NOT NULL DEFAULT 2.875,
    admin_pct             double precision NOT NULL DEFAULT 10,

    -- Off-market
    afslag_pct            double precision NOT NULL DEFAULT 3,
    conv_fee_pct          double precision NOT NULL DEFAULT 2,
    maegler_spar_kr       double precision NOT NULL DEFAULT 80000,

    -- Transaktionsomkostninger
    tx_fast_kr            double precision NOT NULL DEFAULT 1850,
    tx_pct                double precision NOT NULL DEFAULT 0.6,

    -- Beta-scenarier (markedsudvikling %)
    beta_worst            double precision NOT NULL DEFAULT 0,
    beta_base             double precision NOT NULL DEFAULT 7,
    beta_best             double precision NOT NULL DEFAULT 14.8,

    -- Langtidsleje (DKK/m²/måned)
    lt_indreby            double precision NOT NULL DEFAULT 220,
    lt_osterbro           double precision NOT NULL DEFAULT 200,
    lt_noerrebro          double precision NOT NULL DEFAULT 180,
    lt_vesterbro          double precision NOT NULL DEFAULT 195,
    lt_frederiksberg      double precision NOT NULL DEFAULT 210,
    lt_amager             double precision NOT NULL DEFAULT 170,

    updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm.on_market_candidates (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),

    -- Identifikation
    source                    text NOT NULL DEFAULT 'boligsiden',
    source_id                 text NOT NULL,
    source_url                text NOT NULL,
    case_url                  text,

    -- Adresse
    address                   text NOT NULL,
    postal_code               text NOT NULL,
    city                      text,
    bydel                     text,

    -- Boligdata
    kvm                       integer,
    rooms                     integer,
    year_built                integer,

    -- Pris
    list_price                double precision,
    monthly_expense           double precision,
    per_area_price            double precision,
    latest_valuation          double precision,

    -- Mægler
    broker_kind               text,
    realtor_name              text,

    -- Tidsdata
    days_on_market            integer,
    first_seen_at             timestamptz NOT NULL DEFAULT now(),
    last_seen_at              timestamptz NOT NULL DEFAULT now(),
    sold_at                   timestamptz,

    -- Alpha-estimat
    estimated_alpha           double precision,

    -- Beskrivelse og billeder
    description_title         text,
    description               text,
    images                    jsonb,
    per_area_price_median_bydel double precision,

    -- V3-screening cache
    v3_fmv                    double precision,
    v3_fmv_source             text,
    v3_alpha                  double precision,
    v3_investeret             double precision,
    v3_off_market_pris        double precision,
    v3_afkast_worst           double precision,
    v3_afkast_base            double precision,
    v3_afkast_best            double precision,
    v3_profit_best            double precision,
    v3_calculated_at          timestamptz,

    -- Status
    status                    text NOT NULL DEFAULT 'active',
    review_status             text NOT NULL DEFAULT 'ny',

    -- FK til properties hvis importeret
    converted_property_id     uuid,

    -- Primært billede
    primary_image             text
);

-- ─── 3. Foreign keys (idempotent via DO block) ───────────────────────────────

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'properties_investor_id_fk'
          AND n.nspname  = 'crm'
    ) THEN
        ALTER TABLE crm.properties
            ADD CONSTRAINT properties_investor_id_fk
            FOREIGN KEY (investor_id)
            REFERENCES crm.investors(id)
            ON DELETE SET NULL;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'on_market_converted_property_id_fk'
          AND n.nspname  = 'crm'
    ) THEN
        ALTER TABLE crm.on_market_candidates
            ADD CONSTRAINT on_market_converted_property_id_fk
            FOREIGN KEY (converted_property_id)
            REFERENCES crm.properties(id)
            ON DELETE SET NULL;
    END IF;
END $$;

-- ─── 4. Indexes ──────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS properties_status_idx
    ON crm.properties USING btree (status);

CREATE INDEX IF NOT EXISTS properties_bydel_idx
    ON crm.properties USING btree (bydel);

CREATE INDEX IF NOT EXISTS properties_investor_idx
    ON crm.properties USING btree (investor_id);

CREATE UNIQUE INDEX IF NOT EXISTS on_market_source_idx
    ON crm.on_market_candidates USING btree (source, source_id);

CREATE INDEX IF NOT EXISTS on_market_status_idx
    ON crm.on_market_candidates USING btree (status);

CREATE INDEX IF NOT EXISTS on_market_postal_idx
    ON crm.on_market_candidates USING btree (postal_code);

CREATE INDEX IF NOT EXISTS on_market_review_idx
    ON crm.on_market_candidates USING btree (review_status);

-- ─── 5. Seed default assumptions row (once) ───────────────────────────────────

INSERT INTO crm.assumptions (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

COMMIT;
