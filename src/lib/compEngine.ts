/**
 * iBuyReals egen comp-engine (POST /api/inspect).
 *
 * Hvad den giver som AVM'en ikke gør:
 *   - et kvantil-spænd (P10-P90) i stedet for ét punktestimat
 *   - en confidence-vurdering: hvor mange comps, hvor langt væk, hvor spredte
 *   - eksplicitte advarsler og et requires_manual_review-flag
 *
 * P10 er det konservative købssignal: hvis casen stadig er attraktiv målt
 * mod P10, hviler den ikke på at comps'ene rammer perfekt.
 */
const COMP_ENGINE_URL =
  process.env.COMP_ENGINE_URL ??
  'https://1vu06ca2e5.execute-api.eu-north-1.amazonaws.com/api/inspect';

export interface CompEngineSummary {
  medianPpm: number;
  meanPpm: number;
  p10Ppm: number;
  p25Ppm: number;
  p75Ppm: number;
  p90Ppm: number;
  confidence: number;
  confidenceLabel: string;
  compCount: number;
  medianDistanceM: number;
  medianDaysSinceSale: number;
  fallbackTier: string;
  requiresManualReview: boolean;
  warnings: string[];
}

interface InspectResponse {
  valuation_range: {
    weighted_mean_price_per_sqm: number;
    weighted_median_price_per_sqm: number;
    p10_price_per_sqm: number;
    p25_price_per_sqm: number;
    p75_price_per_sqm: number;
    p90_price_per_sqm: number;
  };
  confidence: {
    score: number;
    label: string;
    comp_count: number;
    median_distance_m: number;
    median_days_since_sale: number;
    fallback_tier: string;
    requires_manual_review: boolean;
    warnings?: string[];
  };
}

/**
 * Hent comp-engine-vurdering for én adresse.
 *
 * Returnerer null ved 404 (engine kender ikke adressen — helt normalt for
 * nybyggeri og sammenlagte enheder) og ved netværksfejl. Kaldere skal stemple
 * et tidspunkt uanset, så vi ikke hamrer den med de samme umulige adresser.
 */
export async function fetchCompEngine(addressId: string): Promise<CompEngineSummary | null> {
  try {
    const res = await fetch(COMP_ENGINE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address_id: addressId }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as InspectResponse;
    if (!d?.valuation_range || !d?.confidence) return null;

    const v = d.valuation_range;
    const c = d.confidence;
    return {
      medianPpm: v.weighted_median_price_per_sqm,
      meanPpm: v.weighted_mean_price_per_sqm,
      p10Ppm: v.p10_price_per_sqm,
      p25Ppm: v.p25_price_per_sqm,
      p75Ppm: v.p75_price_per_sqm,
      p90Ppm: v.p90_price_per_sqm,
      confidence: c.score,
      confidenceLabel: c.label,
      compCount: c.comp_count,
      medianDistanceM: c.median_distance_m,
      medianDaysSinceSale: c.median_days_since_sale,
      fallbackTier: c.fallback_tier,
      requiresManualReview: c.requires_manual_review,
      warnings: c.warnings ?? [],
    };
  } catch {
    return null;
  }
}

/** Menneskelig tekst for engine'ens tier-navne. */
export const TIER_LABEL: Record<string, string> = {
  within_250m: 'inden for 250 m',
  within_500m: 'inden for 500 m',
  within_1000m: 'inden for 1 km',
  same_zip_code: 'samme postnummer',
  same_parish: 'samme sogn',
};

/** Engine'ens advarsler oversat til noget man kan handle på. */
export const WARNING_LABEL: Record<string, string> = {
  wide_comp_price_range: 'comps spreder sig bredt i pris',
  very_wide_comp_price_range: 'comps spreder sig meget bredt',
  large_mean_median_gap: 'gennemsnit og median er langt fra hinanden',
  distant_selected_comps: 'comps ligger langt væk',
  few_comps: 'få comps',
  stale_comps: 'comps er gamle',
};
