/**
 * Hent comp-engine-vurdering for aktive cases der mangler en.
 *
 * Auth: samme CRON_SECRET-mønster som de øvrige cron-endpoints.
 * Batch 150 pr. kald (engine svarer på ~0,6s varm), concurrency 6.
 * Kør i loop til remaining er 0.
 *
 * Cron-linje (efter sol-scoren):
 *   40 5 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://app.ibrc.dk/api/cron/comp-engine
 */
import { NextResponse } from 'next/server';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { onMarketCandidates } from '@/lib/db/schema';
import { fetchCompEngine } from '@/lib/compEngine';

export const maxDuration = 300;

const BATCH = 150;
const CONCURRENCY = 6;

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET mangler' }, { status: 503 });
  const provided = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (provided !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!db) return NextResponse.json({ error: 'DB ikke konfigureret' }, { status: 500 });

  const force = new URL(req.url).searchParams.get('force') === '1';

  const todo = await db
    .select({ id: onMarketCandidates.id, addressId: onMarketCandidates.addressId })
    .from(onMarketCandidates)
    .where(
      force
        ? and(eq(onMarketCandidates.status, 'active'), isNotNull(onMarketCandidates.addressId))
        : and(
            eq(onMarketCandidates.status, 'active'),
            isNotNull(onMarketCandidates.addressId),
            isNull(onMarketCandidates.compEngineAt),
          ),
    )
    .limit(BATCH);

  let ok = 0;
  let missing = 0;

  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    await Promise.all(
      todo.slice(i, i + CONCURRENCY).map(async (c) => {
        const r = c.addressId ? await fetchCompEngine(c.addressId) : null;
        // Stempl altid, også ved 404 — ellers spørger vi om de samme
        // ukendte adresser hver eneste nat.
        await db!
          .update(onMarketCandidates)
          .set({
            compEngine: r,
            compEngineMedianPpm: r?.medianPpm ?? null,
            compEngineP10Ppm: r?.p10Ppm ?? null,
            compEngineConfidence: r?.confidence ?? null,
            compEngineAt: new Date(),
          })
          .where(eq(onMarketCandidates.id, c.id));
        if (r) ok++;
        else missing++;
      }),
    );
  }

  const [{ remaining }] = await db
    .select({ remaining: sql<number>`count(*)::int` })
    .from(onMarketCandidates)
    .where(
      and(
        eq(onMarketCandidates.status, 'active'),
        isNotNull(onMarketCandidates.addressId),
        isNull(onMarketCandidates.compEngineAt),
      ),
    );

  return NextResponse.json({ ok: true, hentet: ok, ukendt: missing, remaining });
}
