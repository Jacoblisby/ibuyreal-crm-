/**
 * Genberegn V3-screeningen på alle aktive cases med de gemte antagelser.
 *
 * Baggrund: v3-tallene (alpha, FMV, afkast, investeret) ligger cachet i
 * kolonner og blev tidligere kun skrevet under scrape — og scrapen regnede
 * med DEFAULT_ANTAGELSER, ikke med det du gemte. Dette endpoint lukker
 * hullet: gem antagelser, kald recalc, og tallene flytter sig med det samme.
 *
 * AVM-felterne (unitUuid, pricePerSqm, avmCalculatedAt) røres IKKE — de
 * kommer fra Lambda'en og har intet med antagelser at gøre.
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { onMarketCandidates } from '@/lib/db/schema';
import { loadAntagelser } from '@/lib/antagelser.server';
import { runV3OnListing } from '@/lib/scrape';
import { bydelFromPostnr } from '@/lib/postnumre';
import type { Bydel } from '@/lib/types';

export const maxDuration = 300;

export async function POST() {
  if (!db) return NextResponse.json({ error: 'DB ikke konfigureret' }, { status: 500 });

  const antag = await loadAntagelser();
  const rows = await db
    .select()
    .from(onMarketCandidates)
    .where(eq(onMarketCandidates.status, 'active'));

  let updated = 0;
  let skipped = 0;

  for (const c of rows) {
    // c.bydel er text i DB; bydelFromPostnr returnerer den snævre union
    const bydel = (c.bydel as Bydel | null) ?? bydelFromPostnr(c.postalCode);
    if (!bydel || !c.kvm || !c.listPrice) {
      skipped++;
      continue;
    }

    const v3 = runV3OnListing(
      {
        listPrice: c.listPrice,
        kvm: c.kvm,
        rooms: c.rooms,
        yearBuilt: c.yearBuilt,
        monthlyExpense: c.monthlyExpense,
      },
      bydel,
      c.avmPricePerSqm
        ? { unitUuid: c.avmUnitUuid ?? '', pricePerSqm: c.avmPricePerSqm }
        : undefined,
      c.manualFmv,
      antag,
    );
    if (!v3) {
      skipped++;
      continue;
    }

    await db
      .update(onMarketCandidates)
      .set({
        v3Fmv: v3.v3Fmv,
        v3FmvSource: v3.v3FmvSource,
        v3Alpha: v3.v3Alpha,
        v3Investeret: v3.v3Investeret,
        v3AfkastWorst: v3.v3AfkastWorst,
        v3AfkastBase: v3.v3AfkastBase,
        v3AfkastBest: v3.v3AfkastBest,
        v3ProfitBest: v3.v3ProfitBest,
        v3CalculatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(onMarketCandidates.id, c.id));
    updated++;
  }

  return NextResponse.json({ ok: true, updated, skipped, total: rows.length });
}
