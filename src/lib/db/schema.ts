/**
 * iBuyReal CRM — Drizzle schema.
 *
 * Domæner:
 *   A. Properties (cases i pipelinen)
 *   B. Investorer
 *   C. Antagelser (single-row config)
 */
import {
  pgTable,
  text,
  timestamp,
  integer,
  doublePrecision,
  uuid,
  index,
  uniqueIndex,
  jsonb,
  boolean,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// ─── A. Properties ──────────────────────────────────────────────────────────

export const PROPERTY_STATUS = [
  'screening',
  'analyseret',
  'tilbud_sendt',
  'forhandling',
  'under_kontrakt',
  'koebt',
  'afvist',
  'solgt',
] as const;

export const properties = pgTable(
  'properties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    // Stamdata
    address: text('address').notNull(),
    bydel: text('bydel').notNull(), // 'indre-by', 'vesterbro', ...
    postnr: text('postnr'),
    kvm: integer('kvm').notNull(),
    vaer: integer('vaer').notNull(),
    bygaar: integer('bygaar'),
    etage: text('etage'),
    energi: text('energi'),

    // Marked
    udbud: doublePrecision('udbud').notNull(),
    dage: integer('dage'),
    boligsidenUrl: text('boligsiden_url'),

    // AVM
    fmv: doublePrecision('fmv'),
    avmKvm: doublePrecision('avm_kvm'),
    afvigelse: doublePrecision('afvigelse'),
    decil: integer('decil'),

    // Off-market
    offMarketPris: doublePrecision('off_market_pris'),
    txKost: doublePrecision('tx_kost'),
    investeret: doublePrecision('investeret'),

    // Airbnb
    adr: doublePrecision('adr'),
    occ: doublePrecision('occ'),
    bruttoAirbnb: doublePrecision('brutto_airbnb'),
    netAirbnb: doublePrecision('net_airbnb'),

    // Ejerudgifter
    ejSkat: doublePrecision('ej_skat'),
    ejGrundskyld: doublePrecision('ej_grundskyld'),
    ejFaelles: doublePrecision('ej_faelles'),
    ejOvrige: doublePrecision('ej_ovrige'),
    ejTotal: doublePrecision('ej_total'),

    // Cashflow
    netCashflow: doublePrecision('net_cashflow'),
    cfYieldBest: doublePrecision('cf_yield_best'),
    cfYieldBase: doublePrecision('cf_yield_base'),
    cfYieldWorst: doublePrecision('cf_yield_worst'),

    // Scenarier (gemt cache, så vi ikke genberegner ved hvert page-load)
    alpha: doublePrecision('alpha'),
    profitWorst: doublePrecision('profit_worst'),
    profitBase: doublePrecision('profit_base'),
    profitBest: doublePrecision('profit_best'),
    afkastWorst: doublePrecision('afkast_worst'),
    afkastBase: doublePrecision('afkast_base'),
    afkastBest: doublePrecision('afkast_best'),

    // Pipeline
    status: text('status').notNull().default('screening'),
    tilbudPris: doublePrecision('tilbud_pris'),
    tilbudDato: timestamp('tilbud_dato', { withTimezone: true }),
    notes: text('notes'),

    // Relationer
    prospektUrl: text('prospekt_url'),
    imageUrl: text('image_url'),
    investorId: uuid('investor_id').references(() => investors.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('properties_status_idx').on(t.status),
    index('properties_bydel_idx').on(t.bydel),
    index('properties_investor_idx').on(t.investorId),
  ],
);

// ─── B. Investorer ──────────────────────────────────────────────────────────

export const investors = pgTable('investors', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  committed: doublePrecision('committed'),
  deployed: doublePrecision('deployed'),
  notes: text('notes'),
});

export const investorsRelations = relations(investors, ({ many }) => ({
  properties: many(properties),
}));

export const propertiesRelations = relations(properties, ({ one }) => ({
  investor: one(investors, {
    fields: [properties.investorId],
    references: [investors.id],
  }),
}));

// ─── C. Antagelser (single-row) ─────────────────────────────────────────────

export const antagelser = pgTable('antagelser', {
  id: text('id').primaryKey().default('default'),

  // Airbnb base rates per område
  adrIndreby: doublePrecision('adr_indreby').notNull().default(1609),
  adrVesterbro: doublePrecision('adr_vesterbro').notNull().default(1195),
  adrNoerrebro: doublePrecision('adr_noerrebro').notNull().default(1100),
  adrFrederiksberg: doublePrecision('adr_frederiksberg').notNull().default(1250),
  adrOsterbro: doublePrecision('adr_osterbro').notNull().default(1202),
  adrAmager: doublePrecision('adr_amager').notNull().default(1150),

  occIndreby: doublePrecision('occ_indreby').notNull().default(83),
  occVesterbro: doublePrecision('occ_vesterbro').notNull().default(80),
  occNoerrebro: doublePrecision('occ_noerrebro').notNull().default(78),
  occFrederiksberg: doublePrecision('occ_frederiksberg').notNull().default(80),
  occOsterbro: doublePrecision('occ_osterbro').notNull().default(78),
  occAmager: doublePrecision('occ_amager').notNull().default(78),

  // Room factors
  roomStudio: doublePrecision('room_studio').notNull().default(0.7),
  room1v: doublePrecision('room_1v').notNull().default(0.85),
  room2v: doublePrecision('room_2v').notNull().default(1.0),
  room3v: doublePrecision('room_3v').notNull().default(1.4),
  room4v: doublePrecision('room_4v').notNull().default(1.9),

  // Stand factors
  standLuksus: doublePrecision('stand_luksus').notNull().default(1.15),
  standGod: doublePrecision('stand_god').notNull().default(1.0),
  standAeldre: doublePrecision('stand_aeldre').notNull().default(0.85),

  // Expenses
  platformPct: doublePrecision('platform_pct').notNull().default(15),
  rengoringKr: doublePrecision('rengoring_kr').notNull().default(300),
  naetterPerBooking: doublePrecision('naetter_per_booking').notNull().default(2.875),
  adminPct: doublePrecision('admin_pct').notNull().default(10),

  // Off-market
  afslagPct: doublePrecision('afslag_pct').notNull().default(3),
  convFeePct: doublePrecision('conv_fee_pct').notNull().default(2),
  maeglerSparKr: doublePrecision('maegler_spar_kr').notNull().default(80_000),

  // Transaction
  txFastKr: doublePrecision('tx_fast_kr').notNull().default(1850),
  txPct: doublePrecision('tx_pct').notNull().default(0.6),

  // Beta scenarier
  betaWorst: doublePrecision('beta_worst').notNull().default(0),
  betaBase: doublePrecision('beta_base').notNull().default(7),
  betaBest: doublePrecision('beta_best').notNull().default(14.8),

  // Langtidsleje (kr/m²/måned). Realistiske rates for KBH/Frb 2026.
  ltIndreby: doublePrecision('lt_indreby').notNull().default(220),
  ltOsterbro: doublePrecision('lt_osterbro').notNull().default(200),
  ltNoerrebro: doublePrecision('lt_noerrebro').notNull().default(180),
  ltVesterbro: doublePrecision('lt_vesterbro').notNull().default(195),
  ltFrederiksberg: doublePrecision('lt_frederiksberg').notNull().default(210),
  ltAmager: doublePrecision('lt_amager').notNull().default(170),

  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

// ─── D. On-market kandidater (Boligsiden scrape) ────────────────────────────

/**
 * Råscrape-resultater fra Boligsiden. Adskilt fra `properties` så vi kan
 * scrape natligt uden at forurene pipelinen — brugeren importerer manuelt
 * de cases der ser interessante ud.
 *
 * Status:
 *   active = aktiv på markedet
 *   sold   = forsvundet fra Boligsiden
 *   ignored = brugeren har afvist (ikke interessant)
 */
export const onMarketCandidates = pgTable(
  'on_market_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    // Identifikation
    source: text('source').notNull().default('boligsiden'),
    sourceId: text('source_id').notNull(), // slug fra Boligsiden, fx 'roersangervej-22-2400-koebenhavn-nv'
    sourceUrl: text('source_url').notNull(),
    caseUrl: text('case_url'), // mæglerens URL

    // Adresse + bolig
    address: text('address').notNull(),
    postalCode: text('postal_code').notNull(),
    city: text('city'),
    bydel: text('bydel'), // udledt fra postnummer

    kvm: integer('kvm'),
    rooms: integer('rooms'),
    yearBuilt: integer('year_built'),

    // Pris
    listPrice: doublePrecision('list_price'),
    monthlyExpense: doublePrecision('monthly_expense'),
    perAreaPrice: doublePrecision('per_area_price'),
    latestValuation: doublePrecision('latest_valuation'), // Boligsiden's egen AVM

    // Mægler
    brokerKind: text('broker_kind'), // 'edc' | 'home' | 'nybolig' | ...
    realtorName: text('realtor_name'),

    // Tidsdata
    daysOnMarket: integer('days_on_market'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    soldAt: timestamp('sold_at', { withTimezone: true }),

    // Beregnet fordel ved scrape (alpha estimate hvis vi har latestValuation)
    estimatedAlpha: doublePrecision('estimated_alpha'),

    // Mæglerbeskrivelse + galleri (kan bruges på detail-siden)
    descriptionTitle: text('description_title'),
    description: text('description'),
    images: jsonb('images').$type<string[]>(), // op til ~30 billed-URLs
    perAreaPriceMedianBydel: doublePrecision('per_area_price_median_bydel'),

    // DAWA address UUID — kobler til iBuyReal AVM input
    addressId: text('address_id'),
    // AVM-output cache (kun udfyldt hvis modellen kender adressen)
    avmUnitUuid: text('avm_unit_uuid'),
    avmPricePerSqm: doublePrecision('avm_price_per_sqm'),
    avmCalculatedAt: timestamp('avm_calculated_at', { withTimezone: true }),

    // Manuel FMV override — bruges når AVM ikke kan predicte for adressen
    // (fx pre-1850 bygninger). Hvis sat, overskriver AVM/listPris i V3-beregning.
    manualFmv: doublePrecision('manual_fmv'),
    manualFmvNote: text('manual_fmv_note'),
    manualFmvSetAt: timestamp('manual_fmv_set_at', { withTimezone: true }),

    // Tidligere handler fra Boligsiden /addresses/{uuid}.registrations
    // Bruges til CAGR-validation af AVM-FMV på detail-siden.
    historicalSales: jsonb('historical_sales').$type<Array<{
      date: string;        // ISO YYYY-MM-DD
      amount: number;      // kr
      type: string;        // 'normal' | 'family' | 'auction' | 'other'
    }>>(),
    lastSaleDate: text('last_sale_date'),     // denormaliseret seneste 'normal' handel
    lastSaleAmount: doublePrecision('last_sale_amount'),
    publicValuation: doublePrecision('public_valuation'), // offentlig vurdering (SKAT)

    // V3-screening cache — kører calculateProperty() med:
    //   FMV = iBuyReal AVM (predicted_price_per_sqm × kvm) eller listPrice som fallback
    //   ejTotal = monthlyExpense * 12
    //   bydel/kvm/vaer/bygaar fra scrape
    // Gemmes så listen kan sortere/filtere på iBuyReal-afkast.
    v3Fmv: doublePrecision('v3_fmv'),
    v3FmvSource: text('v3_fmv_source'), // 'boligsiden-bs-avm' | 'ibuyreal-avm' | 'manual'
    v3Alpha: doublePrecision('v3_alpha'),
    v3Investeret: doublePrecision('v3_investeret'),
    v3OffMarketPris: doublePrecision('v3_off_market_pris'),
    v3AfkastWorst: doublePrecision('v3_afkast_worst'),
    v3AfkastBase: doublePrecision('v3_afkast_base'),
    v3AfkastBest: doublePrecision('v3_afkast_best'),
    v3ProfitBest: doublePrecision('v3_profit_best'),
    v3CalculatedAt: timestamp('v3_calculated_at', { withTimezone: true }),

    // Status
    status: text('status').notNull().default('active'), // active | sold | ignored
    reviewStatus: text('review_status').notNull().default('ny'), // ny | interesseret | passet | senere | importeret
    /** Hvorfor blev casen passet? Sat via triage-inbox. pris | stand | beliggenhed | andet */
    passReason: text('pass_reason'),
    /** Hvornår brugeren sidst tog stilling (triage-handling) */
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),

    /**
     * Manuel disqualify-flag for hjemfaldspligt (leasehold-reversion).
     * Sættes via toggle på case-detail-siden. Hvis true skjules casen
     * fra on-market-listen + pitch + curated.
     * Hjemfaldspligt findes ikke i Boligsiden/Resight-data, så det MÅ
     * markeres manuelt.
     */
    hjemfaldspligt: boolean('hjemfaldspligt').notNull().default(false),
    /** Fri tekst-note om hjemfaldspligt (fx "udløb 2052, kommunal grund") */
    hjemfaldspligtNote: text('hjemfaldspligt_note'),

    /**
     * Håndværkertilbud / fixer-upper flag. Auto-detekteres fra mæglerens
     * beskrivelse (typisk ordet "håndværkertilbud" eller "kræver renovering"
     * i title/description). Bruger kan toggle manuelt og det bevares.
     * Hvis true skjules casen fra on-market-listen + Top picks.
     */
    handymanListing: boolean('handyman_listing').notNull().default(false),
    handymanListingNote: text('handyman_listing_note'),

    /**
     * Manuel pin-flag: tvang inkluder casen på Top picks selv hvis
     * den dumper auto-gates (beton-æra, α, median-comp etc.).
     * Bevarer dog stueetage + hjemfaldspligt + ignored som hard safety.
     */
    topPickOverride: boolean('top_pick_override').notNull().default(false),

    /**
     * Claude Vision-assessment af interiørets stand baseret på
     * 6-8 fotos fra Boligsiden. Indeholder overall_condition 1-10,
     * estimeret refurb-cost, strengths/weaknesses/deal-breakers.
     * Recomputes kun ved billed-ændring (images-hash change).
     */
    imageAssessment: jsonb('image_assessment').$type<{
      overall_condition: number;
      renovation_state: string;
      kitchen: { age: string; quality: string };
      bathroom: { tiles_modern: boolean; quality: string };
      floors: string;
      windows: string;
      walls_ceilings: string;
      estimated_refurb_cost: number;
      strengths: string[];
      weaknesses: string[];
      deal_breakers: string[];
      confidence: number;
      images_analyzed: number;
      model: string;
    }>(),
    imageAssessmentAt: timestamp('image_assessment_at', { withTimezone: true }),
    /** Hash af images-arrayet — bruges til at detektere om reassess er nødvendig */
    imageAssessmentHash: text('image_assessment_hash'),

    // Hvis konverteret til Property
    convertedPropertyId: uuid('converted_property_id').references(() => properties.id, {
      onDelete: 'set null',
    }),

    // Billeder
    primaryImage: text('primary_image'),
  },
  (t) => [
    uniqueIndex('on_market_source_idx').on(t.source, t.sourceId),
    index('on_market_status_idx').on(t.status),
    index('on_market_postal_idx').on(t.postalCode),
    index('on_market_review_idx').on(t.reviewStatus),
  ],
);

// ─── E. Scrape jobs (audit log) ─────────────────────────────────────────────

/**
 * External tinglysningsdata fra Resight (eller andre kilder).
 *
 * Bruges som ekstra comps-pool ud over `historicalSales` på `on_market_candidates`.
 * Hvor `historicalSales` kun har handler på adresser vi pt. scraper,
 * indeholder denne tabel ALLE handler i KBH/Frb — også fra ejendomme
 * vi ikke aktivt scraper. Det giver markant bedre comp-coverage,
 * især for friske handler (last 5 months).
 *
 * Idempotency: (handelsId) er UNIQUE — samme Resight-handels-ID kan reimporteres
 * uden duplikater.
 */
export const externalSales = pgTable(
  'external_sales',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Resight Handels-ID — UNIQUE constraint for idempotent import */
    handelsId: text('handels_id').notNull().unique(),
    /** Fuld adresse fra "Handelsnavn", fx "Englandsvej 23, 3. tv, 2300 København S" */
    address: text('address').notNull(),
    saleDate: text('sale_date').notNull(),          // YYYY-MM-DD
    /** Total købspris (kr) */
    amount: doublePrecision('amount').notNull(),
    /** Enhedsareal (kvm) */
    kvm: integer('kvm'),
    /** Pris pr. m² (enhedsareal) — fra Resight */
    perAreaPrice: doublePrecision('per_area_price'),
    /** Opførselsår fra Ejendomme-sheet (joined på Handels-ID) */
    yearBuilt: integer('year_built'),
    postalCode: text('postal_code').notNull(),
    municipalityCode: integer('municipality_code'),
    /** Resight handelstype: 'Private handler', 'Familiehandler' etc. */
    handelstype: text('handelstype'),
    /** Resight handelsmetode: 'Almindelig fri handel', 'Auktion' etc. */
    handelsmetode: text('handelsmetode'),
    /** Resight anvendelse, fx 'Etagebolig-bygning, flerfamiliehus...' */
    anvendelse: text('anvendelse'),
    /** Mægler firma — kan bruges til volume-stats */
    broker: text('broker'),
    /** Kilde-fil + import-batch så vi kan rulle tilbage */
    importBatch: text('import_batch'),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    postalIdx: index('external_sales_postal_idx').on(t.postalCode),
    dateIdx: index('external_sales_date_idx').on(t.saleDate),
    addressIdx: index('external_sales_address_idx').on(t.address),
  }),
);

export const scrapeJobs = pgTable('scrape_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  runKind: text('run_kind').notNull().default('manual'), // 'cron' | 'manual'
  postnrCodes: jsonb('postnr_codes').$type<string[]>().notNull(),
  minRooms: integer('min_rooms'),
  maxRooms: integer('max_rooms'),
  status: text('status').notNull().default('running'), // running | success | failed
  scraped: integer('scraped').notNull().default(0),
  newListings: integer('new_listings').notNull().default(0),
  updatedListings: integer('updated_listings').notNull().default(0),
  markedSold: integer('marked_sold').notNull().default(0),
  errorMsg: text('error_msg'),
});

export type Property = typeof properties.$inferSelect;
export type NewProperty = typeof properties.$inferInsert;
export type Investor = typeof investors.$inferSelect;
export type AntagelserRow = typeof antagelser.$inferSelect;
export type OnMarketCandidate = typeof onMarketCandidates.$inferSelect;
export type ScrapeJob = typeof scrapeJobs.$inferSelect;
export type ExternalSale = typeof externalSales.$inferSelect;
export type NewExternalSale = typeof externalSales.$inferInsert;
