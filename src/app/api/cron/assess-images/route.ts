/**
 * Cron-batch: kør Claude Vision på de cases der kvalificerer til Top picks
 * (eller er tæt på) og hvor billed-assessmentet enten mangler eller billederne
 * er ændret siden sidst.
 *
 * Auth: Bearer CRON_SECRET (samme som /api/cron/scrape).
 * Køres typisk efter den daglige scrape så vi har frisk data.
 */
import { NextResponse } from 'next/server';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { onMarketCandidates } from '@/lib/db/schema';
import { assessImages, hashImages } from '@/lib/imageAssessment';
import { isConcreteEra, isGroundFloor, isNoisyStreet } from '@/lib/quality';

export const maxDuration = 300; // 5 min

interface Result {
  id: string;
  address: string;
  status: 'assessed' | 'skipped' | 'unchanged' | 'error';
  reason?: string;
  condition?: number;
}

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET mangler' }, { status: 503 });
  const auth = req.headers.get('authorization') ?? '';
  if (auth.replace(/^Bearer\s+/i, '').trim() !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY ikke sat' }, { status: 503 });
  }
  if (!db) return NextResponse.json({ error: 'DB ikke konfigureret' }, { status: 500 });

  // Hent kvalificerende cases — pre-filter aggressivt så vi sparer Claude-calls.
  // Vi kører kun på cases der ER eller LIGE NÆR ER på Top picks.
  const candidates = await db
    .select()
    .from(onMarketCandidates)
    .where(
      and(
        eq(onMarketCandidates.status, 'active'),
        sql`${onMarketCandidates.v3FmvSource} IN ('ibuyreal-avm', 'manual')`,
        sql`${onMarketCandidates.v3Alpha} > -0.05`, // lidt margin
        sql`${onMarketCandidates.kvm} <= 110`,
        eq(onMarketCandidates.hjemfaldspligt, false),
        isNotNull(onMarketCandidates.images),
      ),
    );

  const queue = candidates.filter(
    (c) =>
      !isGroundFloor(c.address) &&
      !isNoisyStreet(c.address) &&
      !isConcreteEra(c.yearBuilt),
  );

  const results: Result[] = [];
  let assessed = 0;
  let skipped = 0;
  let unchanged = 0;
  let errors = 0;

  for (const c of queue) {
    const images = (c.images as string[] | null) ?? [];
    if (images.length === 0) {
      results.push({ id: c.id, address: c.address, status: 'skipped', reason: 'no images' });
      skipped++;
      continue;
    }

    const newHash = hashImages(images);
    if (c.imageAssessment && c.imageAssessmentHash === newHash) {
      results.push({
        id: c.id,
        address: c.address,
        status: 'unchanged',
        condition: c.imageAssessment.overall_condition,
      });
      unchanged++;
      continue;
    }

    try {
      const assessment = await assessImages({
        address: c.address,
        yearBuilt: c.yearBuilt,
        imageUrls: images,
      });
      if (!assessment) {
        errors++;
        results.push({ id: c.id, address: c.address, status: 'error', reason: 'null assessment' });
        continue;
      }
      await db
        .update(onMarketCandidates)
        .set({
          imageAssessment: assessment,
          imageAssessmentAt: new Date(),
          imageAssessmentHash: newHash,
          updatedAt: new Date(),
        })
        .where(eq(onMarketCandidates.id, c.id));
      assessed++;
      results.push({
        id: c.id,
        address: c.address,
        status: 'assessed',
        condition: assessment.overall_condition,
      });
    } catch (e) {
      errors++;
      results.push({
        id: c.id,
        address: c.address,
        status: 'error',
        reason: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    queueSize: queue.length,
    assessed,
    skipped,
    unchanged,
    errors,
    results,
    timestamp: new Date().toISOString(),
  });
}
