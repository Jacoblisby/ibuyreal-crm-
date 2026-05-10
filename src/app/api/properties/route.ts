import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { calculateProperty } from '@/lib/calculator';
import { rowToAssumptions } from '@/lib/assumptions';
import { db } from '@/lib/db/client';
import { assumptions, properties } from '@/lib/db/schema';
import { PROPERTY_STATUS } from '@/lib/db/schema';
import type { Bydel } from '@/lib/types';

const BYDELER = ['indre-by', 'vesterbro', 'noerrebro', 'oesterbro', 'frederiksberg', 'amager'] as const;

const createSchema = z.object({
  address: z.string().min(1),
  bydel: z.enum(BYDELER),
  postnr: z.string().nullable().optional(),
  kvm: z.number().int().positive(),
  vaer: z.number().int().min(0),
  bygaar: z.number().int().nullable().optional(),
  udbud: z.number().positive(),
  fmv: z.number().positive(),
  decil: z.number().int().min(1).max(10).nullable().optional(),
  ejSkat: z.number().default(0),
  ejGrundskyld: z.number().default(0),
  ejFaelles: z.number().default(0),
  ejOvrige: z.number().default(0),
  tilbudPris: z.number().nullable().optional(),
  status: z.enum(PROPERTY_STATUS).default('screening'),
});

export async function POST(req: Request) {
  if (!db) {
    return NextResponse.json({ error: 'DB ikke konfigureret' }, { status: 500 });
  }
  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Ugyldig input', details: parsed.error.issues }, { status: 400 });
  }
  const data = parsed.data;
  const ejTotal = data.ejSkat + data.ejGrundskyld + data.ejFaelles + data.ejOvrige;
  const [assumptionsRow] = await db.select().from(assumptions).where(eq(assumptions.id, 'default'));
  const assumptionsConfig = rowToAssumptions(assumptionsRow);

  const calc = calculateProperty({
    bydel: data.bydel as Bydel,
    kvm: data.kvm,
    vaer: data.vaer,
    bygaar: data.bygaar ?? null,
    udbud: data.udbud,
    fmv: data.fmv,
    ejTotal,
    tilbudPris: data.tilbudPris ?? undefined,
  }, assumptionsConfig);

  const [row] = await db
    .insert(properties)
    .values({
      address: data.address,
      bydel: data.bydel,
      postnr: data.postnr ?? null,
      kvm: data.kvm,
      vaer: data.vaer,
      bygaar: data.bygaar ?? null,
      udbud: data.udbud,
      fmv: data.fmv,
      decil: data.decil ?? null,
      afvigelse: (data.udbud - data.fmv) / data.fmv,
      avmKvm: data.fmv / data.kvm,
      ejSkat: data.ejSkat,
      ejGrundskyld: data.ejGrundskyld,
      ejFaelles: data.ejFaelles,
      ejOvrige: data.ejOvrige,
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
      tilbudPris: data.tilbudPris ?? null,
      status: data.status,
    })
    .returning({ id: properties.id });

  return NextResponse.json({ id: row.id }, { status: 201 });
}

export async function GET() {
  if (!db) {
    return NextResponse.json({ error: 'DB ikke konfigureret' }, { status: 500 });
  }
  const rows = await db.select().from(properties);
  return NextResponse.json(rows);
}
