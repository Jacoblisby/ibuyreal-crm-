import { describe, expect, it } from 'vitest';
import { DEFAULT_ANTAGELSER } from './constants';
import {
  airbnbForCase,
  calcADR,
  calcAlpha,
  calcBookings,
  calcBruttoAirbnb,
  calcCfYield,
  calcInvesteret,
  calcNetAirbnb,
  calcOffMarket,
  calcSalgspris,
  calcScenario,
  calcTx,
  calculateProperty,
  getRoomFactor,
  getStandFactor,
  grossRental,
  maxTilbudspris,
} from './calculator';

describe('faktorer', () => {
  it('room factor: 0=studio, 2v=1.0, 4v=1.9, 5v capped to 4v', () => {
    expect(getRoomFactor(0)).toBe(0.7);
    expect(getRoomFactor(1)).toBe(0.85);
    expect(getRoomFactor(2)).toBe(1.0);
    expect(getRoomFactor(3)).toBe(1.4);
    expect(getRoomFactor(4)).toBe(1.9);
    expect(getRoomFactor(5)).toBe(1.9);
  });

  it('stand factor: bygaar bands', () => {
    expect(getStandFactor(2020)).toBe(1.15);
    expect(getStandFactor(2015)).toBe(1.15);
    expect(getStandFactor(1900)).toBe(1.0);
    expect(getStandFactor(1850)).toBe(1.0);
    expect(getStandFactor(1800)).toBe(0.85);
    expect(getStandFactor(null)).toBe(1.0);
  });
});

describe('Airbnb', () => {
  it('ADR = base × room × stand', () => {
    // Indre By, 2v, 1900 → 1609 × 1.0 × 1.0 = 1609
    expect(calcADR('indre-by', 2, 1900)).toBe(1609);
    // Vesterbro, 3v, 2020 → 1195 × 1.4 × 1.15
    expect(calcADR('vesterbro', 3, 2020)).toBeCloseTo(1195 * 1.4 * 1.15, 4);
  });

  it('bookings = 365 × occ / naetterPerBooking', () => {
    // 83% occ, 2.875 nætter/booking → ~105.39
    expect(calcBookings(83)).toBeCloseTo((365 * 0.83) / 2.875, 4);
  });

  it('brutto = ADR × 365 × occ', () => {
    expect(calcBruttoAirbnb(1609, 83)).toBeCloseTo(1609 * 365 * 0.83, 2);
  });

  it('net Airbnb breakdown holder identitet: brutto − totalUdg', () => {
    const brutto = 487_525;
    const bookings = 105.4;
    const r = calcNetAirbnb(brutto, bookings);
    expect(r.gebyr).toBeCloseTo(brutto * 0.15, 2);
    expect(r.rengoring).toBeCloseTo(300 * bookings, 2);
    const expectedAdmin = (brutto - r.gebyr - r.rengoring) * 0.1;
    expect(r.admin).toBeCloseTo(expectedAdmin, 2);
    expect(r.netAirbnb).toBeCloseTo(brutto - r.gebyr - r.rengoring - r.admin, 2);
    expect(r.netAirbnb + r.totalUdg).toBeCloseTo(brutto, 2);
  });

  it('airbnbForCase returnerer ADR/occ + breakdown', () => {
    const r = airbnbForCase('indre-by', 2, 1900);
    expect(r.adr).toBe(1609);
    expect(r.occ).toBe(83);
    expect(r.brutto).toBeCloseTo(1609 * 365 * 0.83, 2);
  });
});

describe('off-market + tx', () => {
  it('offMarket: udbud − 3% afslag − 2% conv − 80k spar', () => {
    const r = calcOffMarket(6_995_000);
    expect(r.afslag).toBeCloseTo(6_995_000 * 0.03, 2);
    expect(r.convFee).toBeCloseTo(6_995_000 * 0.02, 2);
    expect(r.maeglerSpar).toBe(80_000);
    expect(r.offMarketPris).toBeCloseTo(6_995_000 - r.afslag - r.convFee - 80_000, 2);
    // Sanity: ~6.565M for case 1 i seed
    expect(r.offMarketPris).toBeCloseTo(6_565_250, 0);
  });

  it('tx = 1850 + 0.6% × købspris', () => {
    expect(calcTx(6_565_250)).toBeCloseTo(1_850 + 0.006 * 6_565_250, 2);
  });

  it('investeret = offMarketPris + tx', () => {
    expect(calcInvesteret(6_565_250, 41_241.5)).toBe(6_606_491.5);
  });
});

describe('scenarier', () => {
  it('alpha = (FMV − købspris) / købspris — match seed case 1 (~26.9%)', () => {
    const offMarket = calcOffMarket(6_995_000).offMarketPris;
    const tx = calcTx(offMarket);
    const investeret = calcInvesteret(offMarket, tx);
    const alpha = calcAlpha(8_328_964, investeret);
    expect(alpha).toBeGreaterThan(0.25);
    expect(alpha).toBeLessThan(0.27);
  });

  it('salgspris = FMV × (1 + beta)', () => {
    expect(calcSalgspris(8_328_964, 14.8)).toBeCloseTo(8_328_964 * 1.148, 2);
    expect(calcSalgspris(1_000_000, 0)).toBe(1_000_000);
  });

  it('grossRental: worst, base, best forskellig logik', () => {
    const lt = 220; // Indre By default langtidsleje (kr/m²/måned)
    const w = grossRental('worst', 89, 'indre-by', 500_000, 30_000);
    expect(w).toBeCloseTo(lt * 89 * 12 - 30_000, 2);
    const b = grossRental('base', 89, 'indre-by', 500_000, 30_000);
    expect(b).toBeCloseTo(lt * 89 * 12 * 1.3 - 30_000, 2);
    const best = grossRental('best', 89, 'indre-by', 500_000, 30_000);
    expect(best).toBe(500_000 - 30_000);
  });

  it('cfYield = grossRental / investeret', () => {
    const lt = 220;
    const y = calcCfYield('worst', 89, 'indre-by', 500_000, 30_000, 6_606_491.5);
    expect(y).toBeCloseTo((lt * 89 * 12 - 30_000) / 6_606_491.5, 6);
  });

  it('calcScenario: total afkast = alpha + beta + cfYield', () => {
    const r = calcScenario('best', {
      fmv: 8_328_964,
      investeret: 6_606_491.5,
      kvm: 89,
      bydel: 'indre-by',
      netAirbnb: 500_000,
      ejTotal: 30_000,
    });
    expect(r.afkast).toBeCloseTo(r.alpha + r.beta + r.cfYield, 8);
    // Profit = salgspris − investeret + grossRental
    const expectedProfit = r.salgspris - 6_606_491.5 + r.grossRental;
    expect(r.profit).toBeCloseTo(expectedProfit, 2);
  });
});

describe('calculateProperty (full pipeline)', () => {
  it('seed case 1 — Østergade 11: alpha ≈ 26.9%', () => {
    const result = calculateProperty({
      bydel: 'indre-by',
      kvm: 89,
      vaer: 3,
      bygaar: 1900,
      udbud: 6_995_000,
      fmv: 8_328_964,
      ejTotal: 30_000,
    });
    expect(result.alpha).toBeGreaterThan(0.25);
    expect(result.alpha).toBeLessThan(0.275);
    // Alle tre scenarier giver positivt afkast (case er underpriset).
    // NB: Med default langtidsleje = 1500 kr/m²/måned (spec) bliver worst-case
    // CF-yield kunstigt høj. Bemærk at spec sandsynligvis mener kr/m²/år.
    expect(result.worst.afkast).toBeGreaterThan(0);
    expect(result.base.afkast).toBeGreaterThan(0);
    expect(result.best.afkast).toBeGreaterThan(0);
    // Identitet: afkast = alpha + beta + cfYield
    expect(result.best.afkast).toBeCloseTo(
      result.best.alpha + result.best.beta + result.best.cfYield,
      8,
    );
  });

  it('tilbudPris overrides off-market pris', () => {
    const lower = calculateProperty({
      bydel: 'indre-by',
      kvm: 89,
      vaer: 3,
      bygaar: 1900,
      udbud: 6_995_000,
      fmv: 8_328_964,
      ejTotal: 30_000,
      tilbudPris: 6_000_000,
    });
    const baseline = calculateProperty({
      bydel: 'indre-by',
      kvm: 89,
      vaer: 3,
      bygaar: 1900,
      udbud: 6_995_000,
      fmv: 8_328_964,
      ejTotal: 30_000,
    });
    // Lavere købspris → højere alpha
    expect(lower.alpha).toBeGreaterThan(baseline.alpha);
  });
});

describe('maxTilbudspris (break-even worst)', () => {
  it('en tilbudspris = max → worst-case afkast ≈ 0', () => {
    const input = {
      bydel: 'indre-by' as const,
      kvm: 89,
      fmv: 8_328_964,
      ejTotal: 30_000,
    };
    const max = maxTilbudspris(input);
    const result = calculateProperty({
      ...input,
      vaer: 3,
      bygaar: 1900,
      udbud: 6_995_000,
      tilbudPris: max,
    });
    expect(result.worst.afkast).toBeCloseTo(0, 4);
  });
});

describe('default antagelser sanity', () => {
  it('alle bydel-keys er defineret i adr/occ/langtidsleje', () => {
    const bydeler = ['indre-by', 'vesterbro', 'noerrebro', 'oesterbro', 'frederiksberg', 'amager'] as const;
    for (const b of bydeler) {
      expect(DEFAULT_ANTAGELSER.adr[b]).toBeGreaterThan(0);
      expect(DEFAULT_ANTAGELSER.occ[b]).toBeGreaterThan(0);
      expect(DEFAULT_ANTAGELSER.langtidsleje[b]).toBeGreaterThan(0);
    }
  });
});
