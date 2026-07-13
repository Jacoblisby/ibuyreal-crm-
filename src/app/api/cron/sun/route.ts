/**
 * Sol-score backfill/opdatering. Beregner sol-profil (via solnu shadow-engine)
 * for aktive kandidater der ikke har en endnu. Kør efter daglig scrape.
 *
 * Auth: samme CRON_SECRET-mønster som /api/cron/scrape.
 * Batch-størrelse 100 pr. kald (DAWA + solnu er eksterne kald) — kør i loop
 * til `remaining` er 0.
 *
 * Eksempel cron-linje (efter scrape kl 07:00):
 *   30 7 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://app.ibrc.dk/api/cron/sun >/dev/null
 */
import { NextResponse } from 'next/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { onMarketCandidates } from '@/lib/db/schema';
import { fetchSunProfile } from '@/lib/sun';

export const maxDuration = 300;

const BATCH_SIZE = 100;
const CONCURRENCY = 8;

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET ikke konfigureret' }, { status: 503 });
  }
  const provided = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!db) {
    return NextResponse.json({ error: 'DB ikke konfigureret' }, { status: 500 });
  }

  const todo = await db
    .select({
      id: onMarketCandidates.id,
      addressId: onMarketCandidates.addressId,
      address: onMarketCandidates.address,
      postalCode: onMarketCandidates.postalCode,
    })
    .from(onMarketCandidates)
    .where(and(eq(onMarketCandidates.status, 'active'), isNull(onMarketCandidates.sunCalculatedAt)))
    .limit(BATCH_SIZE);

  let computed = 0;
  let failed = 0;

  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const chunk = todo.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (c) => {
        const profile = await fetchSunProfile(c);
        // sunCalculatedAt stemples ALTID — også ved fejl, så vi ikke
        // hamrer DAWA/solnu med de samme umulige adresser hver dag.
        await db!
          .update(onMarketCandidates)
          .set({
            sunScore: profile?.score ?? null,
            sunData: profile
              ? { floor: profile.floor, heightM: profile.heightM, jun: profile.jun, mar: profile.mar }
              : null,
            sunCalculatedAt: new Date(),
          })
          .where(eq(onMarketCandidates.id, c.id));
        if (profile) computed++;
        else failed++;
      }),
    );
  }

  const [{ remaining }] = await db
    .select({ remaining: sql<number>`count(*)::int` })
    .from(onMarketCandidates)
    .where(and(eq(onMarketCandidates.status, 'active'), isNull(onMarketCandidates.sunCalculatedAt)));

  return NextResponse.json({ ok: true, computed, failed, remaining });
}
