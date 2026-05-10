import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { calculateProperty } from '@/lib/calculator';
import { rowToAssumptions } from '@/lib/assumptions';
import { db } from '@/lib/db/client';
import { assumptions, properties, PROPERTY_STATUS } from '@/lib/db/schema';
import type { Bydel } from '@/lib/types';

const BYDELER = ['indre-by', 'vesterbro', 'noerrebro', 'oesterbro', 'frederiksberg', 'amager'] as const;

const patchSchema = z.object({
  // Stamdata (alle valgfri ved patch)
  address: z.string().min(1).optional(),
  bydel: z.enum(BYDELER).optional(),
  postnr: z.string().nullable().optional(),
  kvm: z.number().int().positive().optional(),
  vaer: z.number().int().min(0).optional(),
  bygaar: z.number().int().nullable().optional(),
  etage: z.string().nullable().optional(),
  energi: z.string().nullable().optional(),
  // Marked
  udbud: z.number().positive().optional(),
  dage: z.number().int().nullable().optional(),
  boligsidenUrl: z.string().nullable().optional(),
  fmv: z.number().positive().optional(),
  decil: z.number().int().min(1).max(10).nullable().optional(),
  // Ejerudgifter
  ejSkat: z.number().optional(),
  ejGrundskyld: z.number().optional(),
  ejFaelles: z.number().optional(),
  ejOvrige: z.number().optional(),
  // Pipeline
  status: z.enum(PROPERTY_STATUS).optional(),
  tilbudPris: z.number().nullable().optional(),
  tilbudDato: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  investorId: z.string().nullable().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!db) return NextResponse.json({ error: 'DB ikke konfigureret' }, { status: 500 });
  const { id } = await params;
  const [row] = await db.select().from(properties).where(eq(properties.id, id));
  if (!row) return NextResponse.json({ error: 'Ikke fundet' }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!db) return NextResponse.json({ error: 'DB ikke konfigureret' }, { status: 500 });
  const { id } = await params;
  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Ugyldig input', details: parsed.error.issues }, { status: 400 });
  }

  const [existing] = await db.select().from(properties).where(eq(properties.id, id));
  if (!existing) return NextResponse.json({ error: 'Ikke fundet' }, { status: 404 });

  const merged = { ...existing, ...parsed.data };
  const ejTotal =
    (merged.ejSkat ?? 0) +
    (merged.ejGrundskyld ?? 0) +
    (merged.ejFaelles ?? 0) +
    (merged.ejOvrige ?? 0);
  const [assumptionsRow] = await db.select().from(assumptions).where(eq(assumptions.id, 'default'));
  const assumptionsConfig = rowToAssumptions(assumptionsRow);

  // Genberegn altid hvis nøgle-felter ændrer sig
  const calc = calculateProperty({
    bydel: merged.bydel as Bydel,
    kvm: merged.kvm,
    vaer: merged.vaer,
    bygaar: merged.bygaar,
    udbud: merged.udbud,
    fmv: merged.fmv ?? merged.udbud,
    ejTotal,
    tilbudPris: merged.tilbudPris ?? undefined,
  }, assumptionsConfig);

  const update: Record<string, unknown> = {
    ...parsed.data,
    updatedAt: new Date(),
    ejTotal,
    afvigelse: merged.fmv ? (merged.udbud - merged.fmv) / merged.fmv : null,
    avmKvm: merged.fmv ? merged.fmv / merged.kvm : null,
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
  };
  if (parsed.data.tilbudDato) {
    update.tilbudDato = new Date(parsed.data.tilbudDato);
  }

  await db.update(properties).set(update).where(eq(properties.id, id));
  const [updated] = await db.select().from(properties).where(eq(properties.id, id));
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!db) return NextResponse.json({ error: 'DB ikke konfigureret' }, { status: 500 });
  const { id } = await params;
  await db.delete(properties).where(eq(properties.id, id));
  return NextResponse.json({ ok: true });
}
