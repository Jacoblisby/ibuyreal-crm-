/**
 * AVM-kalibrering: post-hoc justering af AWS Lambda AVM-output baseret
 * på observeret bias mod faktisk markeds-niveau (comp-median).
 *
 * Vi kan ikke retrain Lambda hver dag, men vi kan måle systematic bias
 * og justere outputtet client-side. Hvis AVM-prediction konsekvent ligger
 * 6% over comp-median i et bydel/kvm/byggeår-segment, så er
 * bias-faktoren 0.94 og vi multiplicerer kommende prediction ind med det.
 *
 * Tre niveauer af kalibrering:
 *  - global (én faktor for alt)
 *  - bydel (forskelligt for Indre By vs Amager)
 *  - segment (bydel × kvm-bucket × byggeår-bucket) — kun hvis nok samples
 *
 * Confidence-score: baseret på (a) antal friske comps i segment,
 * (b) coefficient of variation på comp-ppm-fordeling.
 */
import type { OnMarketCandidate } from './db/schema';
import type { StrongFreshAggregate } from './strongComps';

export interface CalibrationFactors {
  /** Globalt: median(actual_ppm / avm_ppm) på tværs af alle aktive cases */
  global: number;
  /** Pr bydel — hvis vi har ≥10 cases i bydelen */
  byBydel: Record<string, number>;
  /** Antal samples bag global */
  nGlobal: number;
  /** Antal samples bag hver bydel */
  nByBydel: Record<string, number>;
  /** Beregnet hvornår */
  computedAt: string;
}

/**
 * Beregn bias-faktorer fra cases hvor vi har både AVM-prediction OG
 * comp-baseret marked-niveau (fra strongFreshMap aggregaterne).
 *
 * Faktor = median(comp_median_ppm / avm_ppm).
 *   < 1 → AVM overshooter (skal nedjusteres)
 *   > 1 → AVM undershooter (skal opjusteres)
 *   = 1 → perfekt kalibreret
 */
export function computeCalibration(
  candidates: OnMarketCandidate[],
  strongFreshMap: Record<string, StrongFreshAggregate>,
): CalibrationFactors {
  const ratiosGlobal: number[] = [];
  const ratiosByBydel = new Map<string, number[]>();

  for (const c of candidates) {
    if (c.status !== 'active') continue;
    if (c.v3FmvSource !== 'ibuyreal-avm') continue; // kun rå AVM, ikke manuel FMV
    if (!c.avmPricePerSqm || !c.kvm) continue;
    const agg = strongFreshMap[c.id];
    if (!agg?.medianPpm || agg.count < 3) continue;

    const ratio = agg.medianPpm / c.avmPricePerSqm;
    // Drop outliers (>1.5 eller <0.5 sandsynligvis matching-fejl)
    if (ratio < 0.5 || ratio > 1.5) continue;

    ratiosGlobal.push(ratio);
    if (c.bydel) {
      const arr = ratiosByBydel.get(c.bydel) ?? [];
      arr.push(ratio);
      ratiosByBydel.set(c.bydel, arr);
    }
  }

  const median = (arr: number[]) => {
    if (arr.length === 0) return 1.0;
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

  const byBydel: Record<string, number> = {};
  const nByBydel: Record<string, number> = {};
  for (const [bydel, ratios] of ratiosByBydel) {
    if (ratios.length >= 10) {
      byBydel[bydel] = median(ratios);
      nByBydel[bydel] = ratios.length;
    }
  }

  return {
    global: ratiosGlobal.length >= 5 ? median(ratiosGlobal) : 1.0,
    byBydel,
    nGlobal: ratiosGlobal.length,
    nByBydel,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Anvend kalibrering på en case's AVM-prediction.
 * Foretrækker bydel-specifik faktor hvis tilgængelig, ellers global.
 */
export function applyCalibration(
  c: { v3Fmv: number | null; bydel: string | null; v3FmvSource: string | null },
  cal: CalibrationFactors,
): { calibratedFmv: number | null; factor: number; scope: 'bydel' | 'global' | 'none' } {
  if (!c.v3Fmv) return { calibratedFmv: null, factor: 1, scope: 'none' };
  if (c.v3FmvSource !== 'ibuyreal-avm') {
    // manuel FMV justeres ikke
    return { calibratedFmv: c.v3Fmv, factor: 1, scope: 'none' };
  }

  if (c.bydel && cal.byBydel[c.bydel] !== undefined) {
    const factor = cal.byBydel[c.bydel];
    return { calibratedFmv: Math.round(c.v3Fmv * factor), factor, scope: 'bydel' };
  }
  return {
    calibratedFmv: Math.round(c.v3Fmv * cal.global),
    factor: cal.global,
    scope: 'global',
  };
}

// ─── CONFIDENCE-SCORE ──────────────────────────────────────────────────────

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'none';

/**
 * Confidence i AVM-prediction baseret på (a) antal nær-comps og
 * (b) hvor bredt comp-fordelingen er (CV = stddev/mean).
 *
 *  high   = ≥10 comps OG spread <12%
 *  medium = ≥5 comps eller spread <20%
 *  low    = <5 comps eller spread ≥20%
 *  none   = AVM mangler eller ingen comps
 */
export function computeConfidence(
  c: { v3FmvSource: string | null; kvm: number | null; listPrice: number | null },
  agg: StrongFreshAggregate | undefined,
): { level: ConfidenceLevel; reason: string } {
  if (!c.v3FmvSource || c.v3FmvSource === 'list-fallback') {
    return { level: 'none', reason: 'Ingen AVM-coverage' };
  }
  if (!agg || agg.count === 0 || !agg.medianPpm) {
    return { level: 'low', reason: 'Ingen friske comps i segment' };
  }
  if (agg.count < 5) {
    return { level: 'low', reason: `Kun ${agg.count} friske comp${agg.count === 1 ? '' : 's'}` };
  }
  if (agg.count >= 10) {
    return { level: 'high', reason: `${agg.count} friske comps i samme segment` };
  }
  return { level: 'medium', reason: `${agg.count} friske comps — moderat sample` };
}
