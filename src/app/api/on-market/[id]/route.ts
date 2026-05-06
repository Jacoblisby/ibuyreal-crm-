import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { onMarketCandidates } from '@/lib/db/schema';

const patchSchema = z.object({
  reviewStatus: z.enum(['ny', 'interesseret', 'passet', 'importeret']).optional(),
  status: z.enum(['active', 'sold', 'ignored']).optional(),
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
    return NextResponse.json({ error: 'Ugyldig input' }, { status: 400 });
  }
  await db
    .update(onMarketCandidates)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(onMarketCandidates.id, id));
  const [row] = await db.select().from(onMarketCandidates).where(eq(onMarketCandidates.id, id));
  return NextResponse.json(row);
}
