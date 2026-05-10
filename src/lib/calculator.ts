/**
 * iBuyReal — beregningsmotor.
 *
 * Pure functions, ingen DB. Hele forretningslogikken bag Boligberegneren
 * og scenarie-beregneren bor her, så den kan testes isoleret.
 *
 * Konventioner:
 *   - Pct-input bruges som tal (3 = 3%, 14.8 = 14.8%).
 *   - Returnerede afkast/yields er decimaltal (0.269 = 26.9%); UI-laget
 *     ganger med 100 ved render.
 *   - kr-input/kr-output er kroner (ingen øre).
 *   - "Bydel" er normaliseret slug, se types.ts.
 */
import { DEFAULT_ASSUMPTIONS } from './constants';
import type { Assumptions, Bydel, Scenarie } from './types';

// ─── 1. Faktorer ───────────────────────────────────────────────────────────

export function getRoomFactor(vaer: number, a: Assumptions = DEFAULT_ASSUMPTIONS): number {
  if (vaer <= 0) return a.room.studio;
  if (vaer === 1) return a.room.v1;
  if (vaer === 2) return a.room.v2;
  if (vaer === 3) return a.room.v3;
  return a.room.v4; // 4+
}

export function getStandFactor(bygaar: number | null, a: Assumptions = DEFAULT_ASSUMPTIONS): number {
  if (bygaar === null || bygaar === undefined) return a.stand.god;
  if (bygaar >= 2015) return a.stand.luksus;
  if (bygaar >= 1850) return a.stand.god;
  return a.stand.aeldre;
}

// ─── 2. Airbnb beregning ────────────────────────────────────────────────────

export function calcADR(
  bydel: Bydel,
  vaer: number,
  bygaar: number | null,
  a: Assumptions = DEFAULT_ASSUMPTIONS,
): number {
  const base = a.adr[bydel];
  return base * getRoomFactor(vaer, a) * getStandFactor(bygaar, a);
}

export function getOcc(bydel: Bydel, a: Assumptions = DEFAULT_ASSUMPTIONS): number {
  return a.occ[bydel];
}

export function calcBookings(occPct: number, a: Assumptions = DEFAULT_ASSUMPTIONS): number {
  return (365 * (occPct / 100)) / a.naetterPerBooking;
}

export function calcBruttoAirbnb(adr: number, occPct: number): number {
  return adr * 365 * (occPct / 100);
}

export interface NetAirbnbBreakdown {
  brutto: number;
  gebyr: number;
  rengoring: number;
  admin: number;
  totalUdg: number;
  netAirbnb: number;
  bookings: number;
}

export function calcNetAirbnb(
  brutto: number,
  bookings: number,
  a: Assumptions = DEFAULT_ASSUMPTIONS,
): NetAirbnbBreakdown {
  const gebyr = brutto * (a.platformPct / 100);
  const rengoring = a.rengoringKr * bookings;
  const admin = (brutto - gebyr - rengoring) * (a.adminPct / 100);
  const totalUdg = gebyr + rengoring + admin;
  const netAirbnb = brutto - totalUdg;
  return { brutto, gebyr, rengoring, admin, totalUdg, netAirbnb, bookings };
}

export function airbnbForCase(
  bydel: Bydel,
  vaer: number,
  bygaar: number | null,
  a: Assumptions = DEFAULT_ASSUMPTIONS,
): NetAirbnbBreakdown & { adr: number; occ: number } {
  const adr = calcADR(bydel, vaer, bygaar, a);
  const occ = getOcc(bydel, a);
  const bookings = calcBookings(occ, a);
  const brutto = calcBruttoAirbnb(adr, occ);
  const net = calcNetAirbnb(brutto, bookings, a);
  return { ...net, adr, occ };
}

// ─── 3. Off-market + transaktion ────────────────────────────────────────────

export interface OffMarketBreakdown {
  udbud: number;
  afslag: number;
  convFee: number;
  maeglerSpar: number;
  offMarketPris: number;
}

export function calcOffMarket(
  udbud: number,
  a: Assumptions = DEFAULT_ASSUMPTIONS,
): OffMarketBreakdown {
  const afslag = udbud * (a.afslagPct / 100);
  const convFee = udbud * (a.convFeePct / 100);
  const maeglerSpar = a.maeglerSparKr;
  const offMarketPris = udbud - afslag - convFee - maeglerSpar;
  return { udbud, afslag, convFee, maeglerSpar, offMarketPris };
}

export function calcTx(koebspris: number, a: Assumptions = DEFAULT_ASSUMPTIONS): number {
  return a.txFastKr + (a.txPct / 100) * koebspris;
}

export function calcInvesteret(offMarketPris: number, tx: number): number {
  return offMarketPris + tx;
}

// ─── 4. Scenarier ───────────────────────────────────────────────────────────

export function calcAlpha(fmv: number, koebspris: number): number {
  if (koebspris <= 0) return 0;
  return (fmv - koebspris) / koebspris;
}

export function calcSalgspris(fmv: number, betaPct: number): number {
  return fmv * (1 + betaPct / 100);
}

/**
 * grossRental for et scenarie — bruges både i CF-yield og profit.
 *   worst: langtidsleje × kvm × 12 - ejTotal     (ren langtidsleje)
 *   base:  langtidsleje × kvm × 12 × 1.3 - ejTotal  (expat +30%)
 *   best:  netAirbnb - ejTotal                   (fuld Airbnb)
 */
export function grossRental(
  scenarie: Scenarie,
  kvm: number,
  bydel: Bydel,
  netAirbnb: number,
  ejTotal: number,
  a: Assumptions = DEFAULT_ASSUMPTIONS,
): number {
  const lt = a.langtidsleje[bydel];
  const ltAarlig = lt * kvm * 12;
  if (scenarie === 'worst') return ltAarlig - ejTotal;
  if (scenarie === 'base') return ltAarlig * 1.3 - ejTotal;
  return netAirbnb - ejTotal;
}

export function calcCfYield(
  scenarie: Scenarie,
  kvm: number,
  bydel: Bydel,
  netAirbnb: number,
  ejTotal: number,
  investeret: number,
  a: Assumptions = DEFAULT_ASSUMPTIONS,
): number {
  if (investeret <= 0) return 0;
  return grossRental(scenarie, kvm, bydel, netAirbnb, ejTotal, a) / investeret;
}

export interface ScenarioResult {
  scenarie: Scenarie;
  betaPct: number;
  salgspris: number;
  grossRental: number;
  profit: number;
  alpha: number;
  beta: number;
  cfYield: number;
  afkast: number;
}

export function calcScenario(
  scenarie: Scenarie,
  params: {
    fmv: number;
    investeret: number;
    kvm: number;
    bydel: Bydel;
    netAirbnb: number;
    ejTotal: number;
  },
  a: Assumptions = DEFAULT_ASSUMPTIONS,
): ScenarioResult {
  const betaPct = a.beta[scenarie];
  const salgspris = calcSalgspris(params.fmv, betaPct);
  const gr = grossRental(scenarie, params.kvm, params.bydel, params.netAirbnb, params.ejTotal, a);
  const profit = salgspris - params.investeret + gr;
  const alpha = calcAlpha(params.fmv, params.investeret);
  const beta = betaPct / 100;
  const cfYield = params.investeret > 0 ? gr / params.investeret : 0;
  const afkast = alpha + beta + cfYield;
  return {
    scenarie,
    betaPct,
    salgspris,
    grossRental: gr,
    profit,
    alpha,
    beta,
    cfYield,
    afkast,
  };
}

// ─── 5. Hele pipelinen i én funktion ────────────────────────────────────────

export interface PropertyInput {
  bydel: Bydel;
  kvm: number;
  vaer: number;
  bygaar: number | null;
  udbud: number;
  fmv: number;
  /** Total ejerudgift/år (skat + grundskyld + fælles + øvrige). */
  ejTotal: number;
  /** Hvis bruges, overskriver off-market pris (fx for budgivning). */
  tilbudPris?: number;
}

export interface PropertyCalculation {
  airbnb: ReturnType<typeof airbnbForCase>;
  offMarket: OffMarketBreakdown;
  tx: number;
  investeret: number;
  alpha: number;
  worst: ScenarioResult;
  base: ScenarioResult;
  best: ScenarioResult;
}

export function calculateProperty(
  input: PropertyInput,
  a: Assumptions = DEFAULT_ASSUMPTIONS,
): PropertyCalculation {
  const airbnb = airbnbForCase(input.bydel, input.vaer, input.bygaar, a);
  const offMarket = calcOffMarket(input.udbud, a);
  const koebspris = input.tilbudPris ?? offMarket.offMarketPris;
  const tx = calcTx(koebspris, a);
  const investeret = calcInvesteret(koebspris, tx);

  const alpha = calcAlpha(input.fmv, investeret);

  const scenarioParams = {
    fmv: input.fmv,
    investeret,
    kvm: input.kvm,
    bydel: input.bydel,
    netAirbnb: airbnb.netAirbnb,
    ejTotal: input.ejTotal,
  };

  return {
    airbnb,
    offMarket,
    tx,
    investeret,
    alpha,
    worst: calcScenario('worst', scenarioParams, a),
    base: calcScenario('base', scenarioParams, a),
    best: calcScenario('best', scenarioParams, a),
  };
}

// ─── 6. Hjælpefunktioner til UI ─────────────────────────────────────────────

/**
 * Break-even tilbudspris: den højeste pris hvor worst-case afkast = 0%.
 *   afkast(worst) = alpha + 0 + grossRental(worst)/investeret
 *   = (FMV - investeret)/investeret + grossRental/investeret
 *   = (FMV + grossRental - investeret) / investeret  = 0
 *   => investeret = FMV + grossRental(worst)
 *   => offMarketPris + tx = FMV + grossRental
 *   tx = txFast + (txPct/100) × offMarketPris
 *   => offMarketPris × (1 + txPct/100) = FMV + grossRental - txFast
 *   => offMarketPris = (FMV + grossRental - txFast) / (1 + txPct/100)
 */
export function maxTilbudspris(
  input: Pick<PropertyInput, 'bydel' | 'kvm' | 'fmv' | 'ejTotal'>,
  a: Assumptions = DEFAULT_ASSUMPTIONS,
): number {
  const lt = a.langtidsleje[input.bydel];
  const grossRentalWorst = lt * input.kvm * 12 - input.ejTotal;
  return (input.fmv + grossRentalWorst - a.txFastKr) / (1 + a.txPct / 100);
}
