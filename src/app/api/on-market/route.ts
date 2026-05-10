import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { getOnMarketRows } from '@/lib/on-market';

export async function GET(req: Request) {
  if (!db) return NextResponse.json({ error: 'DB not configured' }, { status: 500 });
  const url = new URL(req.url);
  const status = (url.searchParams.get('status') ?? 'active') as 'active' | 'sold' | 'ignored';
  const review = url.searchParams.get('review');

  const rows = await getOnMarketRows({
    status,
    review: review
      ? (review as 'new' | 'interested' | 'passed' | 'imported')
      : undefined,
  });

  return NextResponse.json(rows);
}
