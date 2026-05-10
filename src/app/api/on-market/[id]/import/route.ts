/**
 * Convert an on-market candidate to a Property (lead in pipeline).
 *
 * - Creates a new `properties` row with scrape data
 * - Uses `prediction` as FMV if present; otherwise uses listPrice
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { calculateProperty } from '@/lib/calculator';
import { rowToAssumptions } from '@/lib/assumptions';
import { db } from '@/lib/db/client';
import { assumptions, onMarketCandidates, properties } from '@/lib/db/schema';
import { getOnMarketRow } from '@/lib/on-market';
import { bydelFromPostnr } from '@/lib/postnumre';
import type { Bydel } from '@/lib/types';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!db) return NextResponse.json({ error: 'DB not configured' }, { status: 500 });
  const { id } = await params;

  const cand = await getOnMarketRow(id);
  if (!cand) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Estimate fields
  const fmv = cand.prediction ?? cand.listPrice ?? 0;
  const ejTotal = cand.monthlyExpense ? cand.monthlyExpense * 12 : 0;
  const bydel = (bydelFromPostnr(cand.postalCode) ?? 'indre-by') as Bydel;
  const [assumptionsRow] = await db.select().from(assumptions).where(eq(assumptions.id, 'default'));
  const assumptionsConfig = rowToAssumptions(assumptionsRow);
  const calc = calculateProperty({
    bydel,
    kvm: cand.kvm ?? 0,
    vaer: cand.rooms ?? 2,
    bygaar: cand.yearBuilt,
    udbud: cand.listPrice ?? 0,
    fmv,
    ejTotal,
  }, assumptionsConfig);

  const [row] = await db
    .insert(properties)
    .values({
      address: cand.address ?? 'Unknown address',
      bydel,
      postnr: cand.postalCode ?? null,
      kvm: cand.kvm ?? 0,
      vaer: cand.rooms ?? 2,
      bygaar: cand.yearBuilt,
      udbud: cand.listPrice ?? 0,
      dage: cand.daysOnMarket,
      boligsidenUrl: cand.sourceUrl,
      fmv,
      avmKvm: cand.kvm ? fmv / cand.kvm : null,
      afvigelse: fmv > 0 ? ((cand.listPrice ?? 0) - fmv) / fmv : null,
      ejFaelles: ejTotal,
      ejTotal,
      offMarketPris: calc.offMarket.offMarketPris,
      txKost: calc.tx,
      investeret: calc.investeret,
      adr: calc.airbnb.adr,
      occ: calc.airbnb.occ,
      bruttoAirbnb: calc.airbnb.brutto,
      netAirbnb: calc.airbnb.netAirbnb,
      netCashflow: calc.airbnb.netAirbnb - ejTotal,
      cfYieldWorst: calc.worst.cfYield,
      cfYieldBase: calc.base.cfYield,
      cfYieldBest: calc.best.cfYield,
      alpha: calc.alpha,
      profitWorst: calc.worst.profit,
      profitBase: calc.base.profit,
      profitBest: calc.best.profit,
      afkastWorst: calc.worst.afkast,
      afkastBase: calc.base.afkast,
      afkastBest: calc.best.afkast,
      imageUrl: null,
      status: 'screening',
    })
    .returning({ id: properties.id });

  await db
    .update(onMarketCandidates)
    .set({
      reviewType: 'imported',
      updatedAt: new Date(),
    })
    .where(eq(onMarketCandidates.caseId, id));

  return NextResponse.json({ propertyId: row.id });
}
