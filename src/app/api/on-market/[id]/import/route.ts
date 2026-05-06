/**
 * Konvertér en on-market kandidat til en Property (lead i pipelinen).
 *
 * - Opretter en ny `properties`-row med scrape-data
 * - Bruger `latestValuation` som FMV hvis tilstede; ellers bruges udbud
 *   (alpha = 0 indtil rigtig AVM-køring)
 * - Markerer kandidaten som reviewStatus='importeret' og kobler converted_property_id
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { calculateProperty } from '@/lib/calculator';
import { db } from '@/lib/db/client';
import { onMarketCandidates, properties } from '@/lib/db/schema';
import type { Bydel } from '@/lib/types';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!db) return NextResponse.json({ error: 'DB ikke konfigureret' }, { status: 500 });
  const { id } = await params;

  const [cand] = await db.select().from(onMarketCandidates).where(eq(onMarketCandidates.id, id));
  if (!cand) return NextResponse.json({ error: 'Ikke fundet' }, { status: 404 });
  if (cand.convertedPropertyId) {
    return NextResponse.json(
      { error: 'Kandidaten er allerede importeret', propertyId: cand.convertedPropertyId },
      { status: 409 },
    );
  }

  // Estimér felter
  const fmv = cand.latestValuation ?? cand.listPrice ?? 0;
  const ejTotal = cand.monthlyExpense ? cand.monthlyExpense * 12 : 0;
  const calc = calculateProperty({
    bydel: (cand.bydel ?? 'indre-by') as Bydel,
    kvm: cand.kvm ?? 0,
    vaer: cand.rooms ?? 2,
    bygaar: cand.yearBuilt,
    udbud: cand.listPrice ?? 0,
    fmv,
    ejTotal,
  });

  const [row] = await db
    .insert(properties)
    .values({
      address: cand.address,
      bydel: cand.bydel ?? 'indre-by',
      postnr: cand.postalCode,
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
      imageUrl: cand.primaryImage,
      status: 'screening',
    })
    .returning({ id: properties.id });

  await db
    .update(onMarketCandidates)
    .set({
      reviewStatus: 'importeret',
      convertedPropertyId: row.id,
      updatedAt: new Date(),
    })
    .where(eq(onMarketCandidates.id, id));

  return NextResponse.json({ propertyId: row.id });
}
