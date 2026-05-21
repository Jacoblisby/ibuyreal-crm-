import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { calculateProperty } from '@/lib/calculator';
import { db } from '@/lib/db/client';
import { onMarketCandidates } from '@/lib/db/schema';
import type { Bydel } from '@/lib/types';

const patchSchema = z.object({
  reviewStatus: z.enum(['ny', 'interesseret', 'passet', 'importeret']).optional(),
  status: z.enum(['active', 'sold', 'ignored']).optional(),
  manualFmv: z.number().positive().nullable().optional(),
  manualFmvNote: z.string().nullable().optional(),
  hjemfaldspligt: z.boolean().optional(),
  hjemfaldspligtNote: z.string().nullable().optional(),
  topPickOverride: z.boolean().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!db) return NextResponse.json({ error: 'DB ikke konfigureret' }, { status: 500 });
  const { id } = await params;
  const [row] = await db.select().from(onMarketCandidates).where(eq(onMarketCandidates.id, id));
  if (!row) return NextResponse.json({ error: 'Ikke fundet' }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!db) return NextResponse.json({ error: 'DB ikke konfigureret' }, { status: 500 });
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Ugyldig input', details: parsed.error.issues }, { status: 400 });
  }

  // Hvis manualFmv ændres, genberegn V3 så listen viser opdaterede tal
  const baseUpdate: Record<string, unknown> = {
    ...parsed.data,
    updatedAt: new Date(),
  };

  if ('manualFmv' in parsed.data) {
    const [existing] = await db
      .select()
      .from(onMarketCandidates)
      .where(eq(onMarketCandidates.id, id));
    if (!existing) {
      return NextResponse.json({ error: 'Ikke fundet' }, { status: 404 });
    }

    const manualFmv = parsed.data.manualFmv;
    baseUpdate.manualFmvSetAt = manualFmv ? new Date() : null;

    // Genberegn V3 med ny FMV (manual eller fald tilbage til AVM/listPris)
    if (existing.bydel && existing.kvm && existing.listPrice) {
      // Vælg FMV: manual > AVM > listPris fallback
      const avmFmv =
        existing.avmPricePerSqm && existing.kvm
          ? existing.avmPricePerSqm * existing.kvm
          : null;
      const effectiveFmv = manualFmv ?? avmFmv ?? existing.listPrice;
      const fmvSource = manualFmv
        ? 'manual'
        : avmFmv
        ? 'ibuyreal-avm'
        : 'list-price-fallback';

      const ejTotal = existing.monthlyExpense
        ? existing.monthlyExpense * 12
        : Math.round(existing.kvm * 350);

      const calc = calculateProperty({
        bydel: existing.bydel as Bydel,
        kvm: existing.kvm,
        vaer: existing.rooms ?? 2,
        bygaar: existing.yearBuilt,
        udbud: existing.listPrice,
        fmv: effectiveFmv,
        ejTotal,
        tilbudPris: existing.listPrice, // on-market: ingen rabat
      });

      baseUpdate.v3Fmv = effectiveFmv;
      baseUpdate.v3FmvSource = fmvSource;
      baseUpdate.v3Alpha = calc.alpha;
      baseUpdate.v3Investeret = calc.investeret;
      baseUpdate.v3AfkastWorst = calc.worst.afkast;
      baseUpdate.v3AfkastBase = calc.base.afkast;
      baseUpdate.v3AfkastBest = calc.best.afkast;
      baseUpdate.v3ProfitBest = calc.best.profit;
      baseUpdate.v3CalculatedAt = new Date();
    }
  }

  await db.update(onMarketCandidates).set(baseUpdate).where(eq(onMarketCandidates.id, id));
  const [row] = await db.select().from(onMarketCandidates).where(eq(onMarketCandidates.id, id));
  return NextResponse.json(row);
}
