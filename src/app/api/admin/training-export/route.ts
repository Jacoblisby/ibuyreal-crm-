/**
 * Training-feature export til AVM Lambda-teamet.
 *
 * Returnerer 2 CSV-filer (zip):
 *  1. features.csv: alle current on_market_candidates med rich features
 *     + nuværende AVM-prediction. Bruges som feature-skema-reference.
 *  2. sales.csv: alle external_sales (Resight tinglysning) med samme
 *     feature-kolonner hvor tilgængelige. Det er labeled ground truth
 *     til retraining.
 *
 * Format er valgt så Lambda-teamet direkte kan loade i pandas eller scikit.
 *
 * GET /api/admin/training-export?which=features|sales|both (default: both)
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { externalSales, onMarketCandidates } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { isConcreteEra, isGroundFloor, isNoisyStreet } from '@/lib/quality';

/**
 * Parse adresse → etage-nummer. 0 = stueetage. Returnerer null hvis ikke parseable.
 */
function parseFloor(address: string): number | null {
  const m = address.toLowerCase().match(/,\s*(st\.?|stuen|kld\.?|\d+)\.?/);
  if (!m) return null;
  const s = m[1];
  if (s.startsWith('st') || s === 'stuen' || s.startsWith('0')) return 0;
  if (s.startsWith('kld')) return -1;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Byggeår-bucket — non-linear feature AVM kan lære fra.
 */
function eraOf(year: number | null | undefined): string {
  if (!year) return 'unknown';
  if (year < 1900) return 'pre1900';
  if (year < 1950) return '1900_1949';
  if (year <= 1990) return '1950_1990_concrete';
  if (year < 2010) return '1990_2009';
  return 'post2010';
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function rowsToCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const header = columns.join(',');
  const lines = rows.map((r) => columns.map((c) => csvEscape(r[c])).join(','));
  return [header, ...lines].join('\n');
}

export async function GET(req: Request) {
  if (!db) return NextResponse.json({ error: 'DB ikke konfigureret' }, { status: 500 });

  const url = new URL(req.url);
  const which = url.searchParams.get('which') ?? 'both';

  const out: Record<string, string> = {};

  if (which === 'features' || which === 'both') {
    const rows = await db
      .select()
      .from(onMarketCandidates)
      .where(eq(onMarketCandidates.status, 'active'));

    const featureCols = [
      'id',
      'address',
      'postal_code',
      'city',
      'bydel',
      'kvm',
      'rooms',
      'year_built',
      'list_price',
      'list_price_per_sqm',
      'monthly_expense',
      'days_on_market',
      'broker_kind',
      // AVM
      'avm_price_per_sqm',
      'avm_unit_uuid',
      'avm_calculated_at',
      'public_valuation',
      'latest_valuation',
      // Vision (NEW signals AVM ikke kender)
      'vision_overall_condition',
      'vision_renovation_state',
      'vision_estimated_refurb_cost',
      'vision_deal_breakers_count',
      'vision_confidence',
      // History
      'last_sale_date',
      'last_sale_amount',
      'historical_sales_count',
      // Manuelt sat
      'manual_fmv',
      'hjemfaldspligt',
      // ─── NYE FEATURE-FLAG TIL AVM (extract fra adresse/byggeår) ───
      // Disse er features AVM mangler — pt. ser modellen kun postnr+kvm+år
      // og misser stueetage, beton-æra, støjgader. Bevisbillede i
      // /admin/avm-analyse — 87% af AVMs "positive α"-cases er falske
      // positiver pga. disse mangler.
      'floor_number',         // 0=stueetage, 1, 2, 3, 4, 5+
      'is_ground_floor',      // bool — adresse-parse
      'era_bucket',           // pre1900 | 1900_1949 | 1950_1990_concrete | 1990_2009 | post2010
      'is_concrete_era',      // bool — 1950-1990 byggeri
      'is_noisy_street',      // bool — lookup mod kendte støjgader
      'kvm_bucket',           // small (<60) | mid (60-90) | large (90-110) | xl (110+)
      // Vores observation om hvor modellen ramte forkert (label til retrain)
      'avm_implied_alpha_pct', // (avm - list) / list × 100
      'our_verdict',          // top_pick | filtered_<reason> | not_evaluated
    ];

    const data = rows.map((r) => ({
      id: r.id,
      address: r.address,
      postal_code: r.postalCode,
      city: r.city,
      bydel: r.bydel,
      kvm: r.kvm,
      rooms: r.rooms,
      year_built: r.yearBuilt,
      list_price: r.listPrice,
      list_price_per_sqm:
        r.kvm && r.listPrice ? Math.round(r.listPrice / r.kvm) : null,
      monthly_expense: r.monthlyExpense,
      days_on_market: r.daysOnMarket,
      broker_kind: r.brokerKind,
      avm_price_per_sqm: r.avmPricePerSqm,
      avm_unit_uuid: r.avmUnitUuid,
      avm_calculated_at: r.avmCalculatedAt?.toISOString() ?? null,
      public_valuation: r.publicValuation,
      latest_valuation: r.latestValuation,
      vision_overall_condition: r.imageAssessment?.overall_condition ?? null,
      vision_renovation_state: r.imageAssessment?.renovation_state ?? null,
      vision_estimated_refurb_cost: r.imageAssessment?.estimated_refurb_cost ?? null,
      vision_deal_breakers_count: r.imageAssessment?.deal_breakers?.length ?? null,
      vision_confidence: r.imageAssessment?.confidence ?? null,
      last_sale_date: r.lastSaleDate,
      last_sale_amount: r.lastSaleAmount,
      historical_sales_count: Array.isArray(r.historicalSales)
        ? r.historicalSales.length
        : 0,
      manual_fmv: r.manualFmv,
      hjemfaldspligt: r.hjemfaldspligt,
      floor_number: parseFloor(r.address),
      is_ground_floor: isGroundFloor(r.address),
      era_bucket: eraOf(r.yearBuilt),
      is_concrete_era: isConcreteEra(r.yearBuilt),
      is_noisy_street: isNoisyStreet(r.address),
      kvm_bucket:
        !r.kvm ? 'unknown'
        : r.kvm < 60 ? 'small'
        : r.kvm < 90 ? 'mid'
        : r.kvm < 110 ? 'large'
        : 'xl',
      avm_implied_alpha_pct:
        r.v3Fmv && r.listPrice && r.v3FmvSource === 'ibuyreal-avm'
          ? Math.round(((r.v3Fmv - r.listPrice) / r.listPrice) * 1000) / 10
          : null,
      our_verdict: (() => {
        if (r.hjemfaldspligt) return 'filtered_hjemfaldspligt';
        if (isGroundFloor(r.address)) return 'filtered_ground_floor';
        if (isConcreteEra(r.yearBuilt)) return 'filtered_concrete_era';
        if (isNoisyStreet(r.address)) return 'filtered_noisy_street';
        if (r.kvm && r.kvm > 100) return 'filtered_kvm_too_big';
        if (r.imageAssessment && r.imageAssessment.overall_condition < 6) return 'filtered_poor_condition';
        if (r.imageAssessment && (r.imageAssessment.deal_breakers?.length ?? 0) > 0) return 'filtered_deal_breaker';
        if (!r.v3FmvSource || r.v3FmvSource === 'list-fallback') return 'filtered_no_avm';
        if (!r.v3Alpha || r.v3Alpha <= 0) return 'filtered_negative_alpha';
        return 'top_pick_candidate';
      })(),
    }));

    out.features = rowsToCsv(data, featureCols);
  }

  if (which === 'sales' || which === 'both') {
    const sales = await db.select().from(externalSales);
    const salesCols = [
      'handels_id',
      'address',
      'postal_code',
      'municipality_code',
      'sale_date',
      'amount',
      'kvm',
      'per_area_price',
      'year_built',
      'anvendelse',
      'handelstype',
      'handelsmetode',
      'broker',
    ];
    const data = sales.map((s) => ({
      handels_id: s.handelsId,
      address: s.address,
      postal_code: s.postalCode,
      municipality_code: s.municipalityCode,
      sale_date: s.saleDate,
      amount: s.amount,
      kvm: s.kvm,
      per_area_price: s.perAreaPrice,
      year_built: s.yearBuilt,
      anvendelse: s.anvendelse,
      handelstype: s.handelstype,
      handelsmetode: s.handelsmetode,
      broker: s.broker,
    }));
    out.sales = rowsToCsv(data, salesCols);
  }

  // Single CSV requested → return as text/csv with download
  if (which === 'features' && out.features) {
    return new NextResponse(out.features, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="features-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }
  if (which === 'sales' && out.sales) {
    return new NextResponse(out.sales, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="sales-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  // Both → return as JSON with both CSVs (client kan splitte i 2 download)
  return NextResponse.json({
    features: out.features,
    sales: out.sales,
    counts: {
      features: out.features?.split('\n').length ?? 0 - 1,
      sales: out.sales?.split('\n').length ?? 0 - 1,
    },
    schema: {
      features_url: '/api/admin/training-export?which=features',
      sales_url: '/api/admin/training-export?which=sales',
      note: 'features.csv = current active listings med rich features. sales.csv = Resight ground truth til retraining. JOIN på address+date hvis du vil matche listing-features til actual sales.',
    },
  });
}
