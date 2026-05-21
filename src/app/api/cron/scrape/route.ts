/**
 * Cron-protected scrape-endpoint.
 *
 * Kaldes af et system-cron-job hver dag kl 07:00 UTC.
 * Auth: Authorization header skal matche CRON_SECRET env var.
 *
 * Eksempel cron-linje (på Hetzner-host):
 *   0 7 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://app.ibrc.dk/api/cron/scrape >/dev/null
 */
import { NextResponse } from 'next/server';
import { runScrapeJob } from '@/lib/scrape';

export const maxDuration = 300; // 5 min

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET ikke konfigureret på serveren' },
      { status: 503 },
    );
  }
  const auth = req.headers.get('authorization') ?? '';
  const provided = auth.replace(/^Bearer\s+/i, '').trim();
  if (provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runScrapeJob({ runKind: 'cron' });
    return NextResponse.json({
      ok: true,
      jobId: result.jobId,
      stats: {
        scraped: result.scraped,
        newListings: result.newListings,
        updated: result.updated,
        markedSold: result.markedSold,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Scrape fejlede' },
      { status: 500 },
    );
  }
}
