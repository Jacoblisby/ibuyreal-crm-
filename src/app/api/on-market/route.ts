import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { onMarketCandidates } from '@/lib/db/schema';

export async function GET(req: Request) {
  if (!db) return NextResponse.json({ error: 'DB ikke konfigureret' }, { status: 500 });
  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? 'active';
  const review = url.searchParams.get('review');

  const conds = [eq(onMarketCandidates.status, status)];
  if (review) conds.push(eq(onMarketCandidates.reviewStatus, review));

  const rows = await db
    .select()
    .from(onMarketCandidates)
    .where(and(...conds))
    .orderBy(desc(onMarketCandidates.estimatedAlpha));

  return NextResponse.json(rows);
}
