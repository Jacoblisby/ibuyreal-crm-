/**
 * iBuyReal CRM — Drizzle schema.
 *
 * Domæner:
 *   A. Properties (cases i pipelinen)
 *   B. Investorer
 *   C. Assumptions (single-row config)
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

// ─── C. Assumptions (single-row) ─────────────────────────────────────────────

export const assumptions = pgTable('assumptions', {
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
    caseId: uuid('case_id').primaryKey(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    // Computed metrics
    prediction: doublePrecision('prediction'),
    estimatedAlpha: doublePrecision('estimated_alpha'),
    marketSpread: doublePrecision('market_spread'),
    investedAmount: doublePrecision('invested_amount'),
    offMarketPrice: doublePrecision('off_market_price'),
    transactionCost: doublePrecision('transaction_cost'),
    predictedAt: timestamp('predicted_at', { withTimezone: true }),
    predictionSource: integer('prediction_source'),

    // Status
    status: text('status').notNull().default('active'), // active | sold | ignored
    reviewType: text('review_type').notNull().default('new'), // new | interested | passed | imported
  },
  (t) => [
    index('on_market_status_idx').on(t.status),
    index('on_market_review_idx').on(t.reviewType),
  ],
);

export type Property = typeof properties.$inferSelect;
export type NewProperty = typeof properties.$inferInsert;
export type Investor = typeof investors.$inferSelect;
export type AssumptionsRow = typeof assumptions.$inferSelect;
export type OnMarketCandidate = typeof onMarketCandidates.$inferSelect;
