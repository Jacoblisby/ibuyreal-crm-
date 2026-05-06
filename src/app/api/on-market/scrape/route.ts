import { NextResponse } from 'next/server';
import { runScrapeJob } from '@/lib/scrape';

export const maxDuration = 300; // 5 min

export async function POST(req: Request) {
  let body: { postnumre?: string[]; minRooms?: number; maxRooms?: number } = {};
  try {
    body = await req.json();
  } catch {
    // no body — bruger defaults
  }
  try {
    const result = await runScrapeJob({
      postnumre: body.postnumre,
      minRooms: body.minRooms,
      maxRooms: body.maxRooms,
      runKind: 'manual',
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Scrape fejlede' },
      { status: 500 },
    );
  }
}
