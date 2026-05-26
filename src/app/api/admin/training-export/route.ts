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
