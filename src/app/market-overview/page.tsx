import { db } from '@/lib/db/client';
import { onMarketCandidates } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { BENCHMARK_SOURCE, BYDEL_BENCHMARKS } from '@/lib/bydelBenchmarks';
import type { Bydel } from '@/lib/types';
import { MarketOverviewClient } from './market-overview-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Marked-overblik — iBuyReal' };

export default async function MarketOverviewPage() {
  if (!db) return <div className="text-sm text-slate-500">DB ikke konfigureret.</div>;

  const all = await db.select().from(onMarketCandidates).where(eq(onMarketCandidates.status, 'active'));

  // Beregn vores scrape-median pr. bydel
  const buckets: Record<Bydel, number[]> = {
    'indre-by': [],
    vesterbro: [],
    noerrebro: [],
    'oesterbro': [],
    frederiksberg: [],
    amager: [],
  };
  for (const r of all) {
    const bd = r.bydel as Bydel | null;
    if (!bd || !(bd in buckets)) continue;
    if (r.kvm && r.listPrice) {
      buckets[bd].push(r.listPrice / r.kvm);
    }
  }

  const rows = (Object.keys(BYDEL_BENCHMARKS) as Bydel[]).map((bd) => {
    const benchmark = BYDEL_BENCHMARKS[bd];
    const ppm = buckets[bd].sort((a, b) => a - b);
    const ourMedian = ppm.length > 0 ? ppm[Math.floor(ppm.length / 2)] : null;
    const ourCount = ppm.length;
    const diff = ourMedian && benchmark.medianPerSqm
      ? (ourMedian - benchmark.medianPerSqm) / benchmark.medianPerSqm
      : null;
    return {
      ...benchmark,
      ourMedian,
      ourCount,
      diff,
    };
  });

  // Totals
  const totalCount = all.length;
  const totalActiveByBydel = rows.reduce((acc, r) => acc + r.ourCount, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Marked-overblik</h1>
        <p className="mt-1 text-sm text-slate-500">
          Sammenligning af bydels-benchmarks (manuelt opslagne fra DSt + Boligsiden) mod vores
          scrape-coverage. Bruges til at vurdere om vores aktive picks ligger over eller under
          markedet.
        </p>
      </div>
      <MarketOverviewClient
        rows={rows}
        totalCount={totalCount}
        totalActiveByBydel={totalActiveByBydel}
      />
      <div className="rounded-md border border-slate-100 bg-slate-50/60 p-3 text-xs text-slate-500">
        <strong className="text-slate-700">Kilder ({BENCHMARK_SOURCE.date}):</strong>{' '}
        {BENCHMARK_SOURCE.sources.join(' · ')}. Benchmarks opdateres manuelt kvartalsvist —
        ret <code className="font-mono">src/lib/bydelBenchmarks.ts</code>.
      </div>
    </div>
  );
}
