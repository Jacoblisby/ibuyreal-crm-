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

  // scope=top (default): kun Top picks-nære cases — det daglige cron-mønster.
  // scope=all: hele det aktive marked (fuld-markeds stand-kortlægning) —
  //   batches via ?limit= så hver invocation holder sig under maxDuration;
  //   kald i loop til assessed+errors == 0 tilbage (unchanged skipper gratis).
  const url = new URL(req.url);
  const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'top';
  const limit = Math.max(1, Math.min(30, Number(url.searchParams.get('limit') ?? 16)));

  const candidates = await db
    .select()
    .from(onMarketCandidates)
    .where(
      scope === 'all'
        ? and(eq(onMarketCandidates.status, 'active'), isNotNull(onMarketCandidates.images))
        : and(
            eq(onMarketCandidates.status, 'active'),
            sql`${onMarketCandidates.v3FmvSource} IN ('ibuyreal-avm', 'manual')`,
            sql`${onMarketCandidates.v3Alpha} > -0.05`, // lidt margin
            sql`${onMarketCandidates.kvm} <= 110`,
            eq(onMarketCandidates.hjemfaldspligt, false),
            isNotNull(onMarketCandidates.images),
          ),
    );

  const prefiltered =
    scope === 'all'
      ? candidates
      : candidates.filter(
          (c) =>
            !isGroundFloor(c.address) &&
            !isNoisyStreet(c.address) &&
            !isConcreteEra(c.yearBuilt),
        );

  // Ved scope=all: tag kun dem der faktisk skal vurderes (mangler assessment
  // eller billeder ændret) op til limit — resten venter på næste kald.
  const needing =
    scope === 'all'
      ? prefiltered.filter((c) => {
          const imgs = (c.images as string[] | null) ?? [];
          return imgs.length > 0 && (!c.imageAssessment || c.imageAssessmentHash !== hashImages(imgs));
        })
      : prefiltered;
  const queue = scope === 'all' ? needing.slice(0, limit) : needing;
  const remaining = needing.length - queue.length;

  const results: Result[] = [];
  let assessed = 0;
  let skipped = 0;
  let unchanged = 0;
  let errors = 0;

  const CONCURRENCY = 4;

  async function processOne(c: (typeof queue)[number]): Promise<void> {
    const images = (c.images as string[] | null) ?? [];
    if (images.length === 0) {
      results.push({ id: c.id, address: c.address, status: 'skipped', reason: 'no images' });
      skipped++;
      return;
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
      return;
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
        return;
      }
      await db!
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

  for (let i = 0; i < queue.length; i += CONCURRENCY) {
    await Promise.all(queue.slice(i, i + CONCURRENCY).map(processOne));
  }

  return NextResponse.json({
    ok: true,
    queueSize: queue.length,
    remaining,
    assessed,
    skipped,
    unchanged,
    errors,
    results,
    timestamp: new Date().toISOString(),
  });
}
