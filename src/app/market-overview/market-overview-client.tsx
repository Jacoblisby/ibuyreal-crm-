'use client';

import { formatKr, formatPct } from '@/lib/format';
import type { BydelBenchmark } from '@/lib/bydelBenchmarks';

type Row = BydelBenchmark & {
  ourMedian: number | null;
  ourCount: number;
  diff: number | null;
};

export function MarketOverviewClient({
  rows,
  totalCount,
  totalActiveByBydel,
}: {
  rows: Row[];
  totalCount: number;
  totalActiveByBydel: number;
}) {
  // Aggregated stats across all bydele
  const weightedAvgMedian = (() => {
    const weighted = rows
      .filter((r) => r.ourMedian !== null)
      .reduce(
        (acc, r) => ({
          sum: acc.sum + (r.ourMedian ?? 0) * r.ourCount,
          n: acc.n + r.ourCount,
        }),
        { sum: 0, n: 0 },
      );
    return weighted.n > 0 ? weighted.sum / weighted.n : null;
  })();

  const benchmarkWeightedAvg = (() => {
    const weighted = rows.reduce(
      (acc, r) => ({
        sum: acc.sum + r.medianPerSqm * r.quarterlyVolume,
        n: acc.n + r.quarterlyVolume,
      }),
      { sum: 0, n: 0 },
    );
    return weighted.n > 0 ? weighted.sum / weighted.n : null;
  })();

  return (
    <div className="space-y-4">
      {/* Top KPIs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Kpi label="Aktive listings totalt" value={String(totalCount)} sub="alle scrapede aktive" />
        <Kpi
          label="I 6 KBH+Frb bydele"
          value={String(totalActiveByBydel)}
          sub={`${Math.round((totalActiveByBydel / totalCount) * 100)}% af coverage`}
        />
        <Kpi
          label="Vores median kr/m²"
          value={weightedAvgMedian ? formatKr(weightedAvgMedian) : '–'}
          sub="weighted by case-count"
        />
        <Kpi
          label="Marked median kr/m²"
          value={benchmarkWeightedAvg ? formatKr(benchmarkWeightedAvg) : '–'}
          sub="weighted by quarterly volume"
        />
      </div>

      {/* Bydel-tabel */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/80 text-left text-[11px] font-medium uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2.5">Bydel</th>
              <th className="px-3 py-2.5 text-right" title="Benchmark median fra Danmarks Statistik + Boligsiden">
                Marked median
              </th>
              <th className="px-3 py-2.5 text-right">25p–75p range</th>
              <th className="px-3 py-2.5 text-right" title="År-over-år ændring i median pris/m²">
                YoY
              </th>
              <th className="px-3 py-2.5 text-right" title="Antal handler per kvartal (likviditets-indikator)">
                Volume/Q
              </th>
              <th className="px-3 py-2.5 text-right" title="Antal aktive listings i vores DB">
                Vores n
              </th>
              <th className="px-3 py-2.5 text-right" title="Vores median udbudspris/m² blandt aktive listings">
                Vores median
              </th>
              <th className="px-3 py-2.5 text-right" title="Hvor meget vores listings i snit ligger over/under benchmark">
                Diff vs marked
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr
                key={r.bydel}
                className="row-stagger border-b border-slate-100 transition-colors duration-100 ease-[var(--ease-out)] last:border-0 hover:bg-slate-50"
                style={{ animationDelay: `${idx * 40}ms` }}
              >
                <td className="px-3 py-2.5 font-medium text-slate-900">{r.label}</td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                  {formatKr(r.medianPerSqm)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-xs text-slate-500">
                  {formatKr(r.p25PerSqm)} – {formatKr(r.p75PerSqm)}
                </td>
                <td
                  className={
                    'px-3 py-2.5 text-right tabular-nums text-xs font-medium ' +
                    (r.yoyGrowth > 5
                      ? 'text-emerald-700'
                      : r.yoyGrowth > 0
                      ? 'text-emerald-600'
                      : 'text-rose-600')
                  }
                >
                  +{r.yoyGrowth.toFixed(1)}%
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-xs text-slate-500">
                  {r.quarterlyVolume}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {r.ourCount > 0 ? (
                    <span className="font-medium">{r.ourCount}</span>
                  ) : (
                    <span className="text-slate-400">0</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {r.ourMedian ? formatKr(r.ourMedian) : <span className="text-slate-400">–</span>}
                </td>
                <td
                  className={
                    'px-3 py-2.5 text-right tabular-nums text-xs font-medium ' +
                    (r.diff === null
                      ? 'text-slate-400'
                      : r.diff < -0.05
                      ? 'text-emerald-700'
                      : r.diff < 0.05
                      ? 'text-slate-600'
                      : 'text-rose-600')
                  }
                >
                  {r.diff !== null ? formatPct(r.diff, 1) : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Læsevejledning */}
      <div className="rounded-md border border-slate-100 bg-slate-50/60 p-3 text-xs text-slate-600">
        <strong className="text-slate-700">Læsevejledning:</strong>
        <ul className="mt-1 space-y-1">
          <li>
            <strong>Diff vs marked</strong> negativ = vores listings ligger under markedet (potentielt underprised).
          </li>
          <li>
            <strong>YoY positiv</strong> = bydel i opadgående tendens (gunstig β).
          </li>
          <li>
            <strong>Volume/Q høj</strong> = god likviditet ved exit.
          </li>
        </ul>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1.5 text-xl font-bold tabular-nums tracking-tight text-slate-900">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
