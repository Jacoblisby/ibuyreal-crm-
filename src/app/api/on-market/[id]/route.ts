import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { onMarketCandidates } from '@/lib/db/schema';
import { getOnMarketRow } from '@/lib/on-market';

const patchSchema = z.object({
  reviewType: z.enum(['new', 'interested', 'passed', 'imported']).optional(),
  status: z.enum(['active', 'sold', 'ignored']).optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!db) return NextResponse.json({ error: 'DB not configured' }, { status: 500 });
  const { id } = await params;
  const row = await getOnMarketRow(id);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!db) return NextResponse.json({ error: 'DB not configured' }, { status: 500 });
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }
  await db
    .update(onMarketCandidates)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(onMarketCandidates.caseId, id));
  const row = await getOnMarketRow(id);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(row);
}
