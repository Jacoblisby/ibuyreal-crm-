/**
 * Curated scoring — JP Morgan-grade selection of best on-market candidates.
 *
 * Vi vil ikke bare optimere alpha (giver speculative picks). Vi vægter
 * datakvalitet, defensiv positionering og lav risiko lige så højt.
 *
 * Composite score 0-100, opdelt i 5 komponenter:
 *   AVM signal (25)     — AVM-coverage + realistisk alpha (5-20% sweet spot)
 *   Quality (25)        — moderne byggeri, ikke beton, ikke stuen, ikke støj
 *   Data freshness (20) — recent comparable sale + realistic seller CAGR
 *   Bydel attract. (15) — A-prime locations (Indre By, Frb, Østerbro)
 *   Market signals (15) — sweet spot dage-på-markedet + realistisk best afkast
 *
 * Output også en rationale-liste (human-readable bullets) som kan vises i UI.
 */
import type { OnMarketCandidate } from './db/schema';
import { isConcreteEra, isGroundFloor, isNoisyStreet } from './quality';
import { findStrongFreshComps, type StrongFreshComp } from './strongComps';

export interface ScoreComponents {
  avmSignal: number;
  quality: number;
  dataFreshness: number;
  bydelAttractive: number;
  marketSignals: number;
}

export interface CuratedScore {
  total: number;
  components: ScoreComponents;
  rationale: string[];
  redFlags: string[];
}

const BYDEL_TIER_A = ['indre-by', 'frederiksberg', 'oesterbro'] as const;
const BYDEL_TIER_B = ['vesterbro', 'noerrebro'] as const;
const BYDEL_TIER_C = ['amager'] as const;

export function curatedScore(c: OnMarketCandidate): CuratedScore {
  const rationale: string[] = [];
  const redFlags: string[] = [];

  // ─── AVM SIGNAL (25 max) ─────────────────────────────────────────────────
  let avmSignal = 0;
  if (c.v3FmvSource === 'ibuyreal-avm') {
    avmSignal += 10;
    rationale.push('iBuyReal AVM dækker adressen');
  } else if (c.v3FmvSource === 'manual') {
    avmSignal += 8;
    rationale.push('Manuel FMV sat efter validering');
  } else {
    redFlags.push('FMV = listpris fallback (ingen model-prediction)');
  }

  const alpha = c.v3Alpha ?? 0;
  if (alpha >= 0.05 && alpha <= 0.2) {
    avmSignal += 15;
    rationale.push(`α ${(alpha * 100).toFixed(1)}% i sweet spot (5-20%)`);
  } else if (alpha > 0.2 && alpha < 0.4) {
    avmSignal += 8;
    rationale.push(`α ${(alpha * 100).toFixed(1)}% — høj men plausibel`);
  } else if (alpha > 0) {
    avmSignal += 4;
  } else if (alpha < -0.05) {
    redFlags.push(`α ${(alpha * 100).toFixed(1)}% — over markedet`);
  }

  // Penalize hvis BS-AVM peger anden vej (overshoot-signal)
  if (
    c.v3FmvSource === 'ibuyreal-avm' &&
    c.latestValuation &&
    c.v3Fmv &&
    c.v3Fmv > c.latestValuation * 3
  ) {
    avmSignal -= 5;
    redFlags.push('iBuyReal AVM 3x højere end BS-AVM (måske overshoot)');
  }

  // ─── QUALITY (25 max) ────────────────────────────────────────────────────
  let quality = 0;
  const yb = c.yearBuilt ?? 0;
  if (yb >= 2000) {
    quality += 12;
    rationale.push(`Moderne (byggeår ${yb})`);
  } else if (yb >= 1900 && yb < 1950) {
    quality += 10;
    rationale.push(`Klassisk pre-krigs (byggeår ${yb})`);
  } else if (yb >= 1850 && yb < 1900) {
    quality += 7;
    rationale.push(`Ældre charme (byggeår ${yb})`);
  } else if (isConcreteEra(yb)) {
    redFlags.push(`Betonbyggeri-æra (${yb}) — lavere standard`);
  }

  // No ground floor
  if (!isGroundFloor(c.address)) {
    quality += 7;
  } else {
    redFlags.push('Stueetage/kælder');
  }

  // No noisy street
  if (!isNoisyStreet(c.address)) {
    quality += 6;
  } else {
    redFlags.push('Beliggende på støjgade/turist-strøg');
  }

  // ─── DATA FRESHNESS (20 max) ─────────────────────────────────────────────
  let dataFreshness = 0;
  const lastSale = c.lastSaleDate;
  const lastSaleAmt = c.lastSaleAmount;
  if (lastSale && lastSaleAmt) {
    const saleYear = parseInt(lastSale.slice(0, 4));
    const yearsAgo = new Date().getFullYear() - saleYear;
    if (yearsAgo <= 5) {
      dataFreshness += 12;
      rationale.push(`Fresh handelsdata (${lastSale.slice(0, 4)})`);
    } else if (yearsAgo <= 10) {
      dataFreshness += 8;
    } else if (yearsAgo <= 20) {
      dataFreshness += 4;
    }

    // Realistisk CAGR fra sidste handel til udbud
    if (c.listPrice && yearsAgo > 0) {
      const cagr = (Math.pow(c.listPrice / lastSaleAmt, 1 / yearsAgo) - 1) * 100;
      if (cagr >= 4 && cagr <= 8) {
        dataFreshness += 8;
        rationale.push(`Seller CAGR ${cagr.toFixed(1)}% pa — realistisk`);
      } else if (cagr > 0 && cagr < 12) {
        dataFreshness += 4;
      } else if (cagr >= 12) {
        redFlags.push(`Seller CAGR ${cagr.toFixed(1)}% pa — aggressiv`);
      }
    }
  } else {
    redFlags.push('Ingen historisk handelsdata');
  }

  // ─── BYDEL ATTRACTIVE (15 max) ───────────────────────────────────────────
  let bydelAttractive = 0;
  const bydel = c.bydel ?? '';
  if (BYDEL_TIER_A.includes(bydel as never)) {
    bydelAttractive = 15;
    rationale.push(`Tier-A bydel (${bydel})`);
  } else if (BYDEL_TIER_B.includes(bydel as never)) {
    bydelAttractive = 10;
    rationale.push(`Tier-B bydel (${bydel})`);
  } else if (BYDEL_TIER_C.includes(bydel as never)) {
    bydelAttractive = 5;
  }

  // ─── MARKET SIGNALS (15 max) ─────────────────────────────────────────────
  let marketSignals = 0;
  const days = c.daysOnMarket ?? 0;
  if (days >= 30 && days <= 150) {
    marketSignals += 8;
    rationale.push(`${days} dage på markedet — ægte prissætning + forhandlingsrum`);
  } else if (days > 150) {
    marketSignals += 6;
    rationale.push(`${days} dage — sælger kan være motiveret`);
  } else if (days > 0 && days < 30) {
    marketSignals += 3;
  }

  const best = c.v3AfkastBest ?? 0;
  if (best >= 0.18 && best <= 0.35) {
    marketSignals += 7;
    rationale.push(`Best afkast ${(best * 100).toFixed(0)}% — realistisk`);
  } else if (best > 0.35 && best <= 0.5) {
    marketSignals += 4;
  } else if (best > 0.5) {
    marketSignals += 2;
    redFlags.push(`Best afkast ${(best * 100).toFixed(0)}% — sandsynligvis overshoot`);
  }

  const components: ScoreComponents = {
    avmSignal: Math.max(0, Math.min(25, avmSignal)),
    quality: Math.max(0, Math.min(25, quality)),
    dataFreshness: Math.max(0, Math.min(20, dataFreshness)),
    bydelAttractive: Math.max(0, Math.min(15, bydelAttractive)),
    marketSignals: Math.max(0, Math.min(15, marketSignals)),
  };

  const total = Math.round(
    components.avmSignal +
      components.quality +
      components.dataFreshness +
      components.bydelAttractive +
      components.marketSignals,
  );

  return { total, components, rationale, redFlags };
}

/**
 * Curated top-N candidates, sorteret efter total score (desc).
 *
 * HARDE pre-filters (case dumper ud helt):
 *   - Status active
 *   - Har AVM eller manuel FMV
 *   - Positiv alpha
 *   - Klarer quality: ikke noisy-gade, ikke stuen/kælder, ikke beton (1950-1990)
 *   - **≥1 stærk frisk comp**: en nær-peer solgt indenfor 5 mdr OVER vores
 *     udbudspris/m². Uden bevis fra friske handler droppes casen helt fra
 *     shortlist — vi vil kun præsentere cases hvor markedet for nyligt har
 *     valideret prisniveauet.
 */
export function pickCurated(
  candidates: OnMarketCandidate[],
  n = 20,
  opts?: {
    strongFreshMinCount?: number;
    monthsBack?: number;
    abovePct?: number;
    /**
     * Pre-computed strong-fresh-comp count per kandidat-ID (server-side, inkl.
     * Resight external_sales). Hvis angivet bruges denne i stedet for at
     * compute fra `candidates` alene — det giver os adgang til ekstern pool
     * som ikke er i `historicalSales`.
     */
    strongFreshMap?: Record<string, number>;
  },
): Array<OnMarketCandidate & { score: CuratedScore; strongFreshComps: StrongFreshComp[]; strongFreshCount: number }> {
  const minCount = opts?.strongFreshMinCount ?? 1;
  const monthsBack = opts?.monthsBack ?? 5;
  const abovePct = opts?.abovePct ?? 0;
  const precomputed = opts?.strongFreshMap;

  // Pool for peer-search = alle aktive (incl. dem der ikke nødvendigvis går videre)
  const pool = candidates.filter((c) => c.status === 'active');

  const scored = pool
    .filter(
      (c) =>
        (c.v3FmvSource === 'ibuyreal-avm' || c.v3FmvSource === 'manual') &&
        (c.v3Alpha ?? 0) > 0 &&
        !isNoisyStreet(c.address) &&
        !isGroundFloor(c.address) &&
        !isConcreteEra(c.yearBuilt),
    )
    .map((c) => {
      const strongFreshComps = findStrongFreshComps(c, pool, { monthsBack, abovePct });
      // Foretræk precomputed count (incl. Resight) hvis tilgængelig
      const strongFreshCount = precomputed?.[c.id] ?? strongFreshComps.length;
      return { ...c, score: curatedScore(c), strongFreshComps, strongFreshCount };
    })
    .filter((c) => c.strongFreshCount >= minCount);

  scored.sort((a, b) => b.score.total - a.score.total);
  return scored.slice(0, n);
}
