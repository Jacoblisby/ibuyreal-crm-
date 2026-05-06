import Link from 'next/link';
import { db } from '@/lib/db/client';
import { properties } from '@/lib/db/schema';
import { formatKr, formatPct, formatNum } from '@/lib/format';
import { STATUS_COLOR, STATUS_LABEL, STATUS_ORDER } from '@/lib/status';
import type { PropertyStatus } from '@/lib/types';
import { ProfitChart } from './_dashboard/profit-chart';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  if (!db) return <div className="text-sm text-slate-500">DB ikke konfigureret.</div>;
  const rows = await db.select().from(properties);

  const active = rows.filter((r) => r.status !== 'afvist' && r.status !== 'solgt');
  const pipelineValue = active.reduce((s, r) => s + (r.investeret ?? 0), 0);
  const avgAlpha = active.length
    ? active.reduce((s, r) => s + (r.alpha ?? 0), 0) / active.length
    : 0;
  const avgBest = active.length
    ? active.reduce((s, r) => s + (r.afkastBest ?? 0), 0) / active.length
    : 0;
  const totalProfit = active.reduce((s, r) => s + (r.profitBase ?? 0), 0);

  // Tæl pr. status
  const statusCounts: Record<PropertyStatus, number> = {
    screening: 0, analyseret: 0, tilbud_sendt: 0, forhandling: 0,
    under_kontrakt: 0, koebt: 0, afvist: 0, solgt: 0,
  };
  for (const r of rows) {
    statusCounts[r.status as PropertyStatus] = (statusCounts[r.status as PropertyStatus] ?? 0) + 1;
  }

  const chartData = active
    .filter((r) => r.profitBest !== null)
    .map((r) => ({
      label: r.address.split(',')[0],
      best: r.profitBest ?? 0,
      base: r.profitBase ?? 0,
      worst: r.profitWorst ?? 0,
    }))
    .sort((a, b) => b.best - a.best)
    .slice(0, 10);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          {rows.length} cases — {active.length} aktive
        </p>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Pipeline-værdi" value={formatKr(pipelineValue)} sub="investeret kapital" />
        <KpiCard label="Gns. alpha" value={formatPct(avgAlpha)} sub="aktive cases" accent="emerald" />
        <KpiCard label="Gns. best afkast" value={formatPct(avgBest)} sub="α + β + cf-yield" accent="emerald" />
        <KpiCard label="Forventet profit (base)" value={formatKr(totalProfit)} sub="på exit" />
      </div>

      {/* Pipeline overview */}
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Pipeline</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {STATUS_ORDER.map((s) => (
            <Link
              key={s}
              href={`/screening?status=${s}`}
              className={
                'rounded-md border border-transparent p-3 text-center transition hover:border-slate-300 ' +
                STATUS_COLOR[s]
              }
            >
              <div className="text-2xl font-bold tabular-nums">{statusCounts[s]}</div>
              <div className="mt-0.5 text-xs">{STATUS_LABEL[s]}</div>
            </Link>
          ))}
        </div>
      </div>

      {/* Profit chart */}
      {chartData.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="mb-4 text-sm font-semibold text-slate-900">
            Profit pr. case (top 10, base case)
          </h3>
          <ProfitChart data={chartData} />
        </div>
      )}

      {/* Recent activity */}
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Seneste aktivitet</h3>
        <ul className="space-y-2 text-sm">
          {rows
            .slice()
            .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
            .slice(0, 5)
            .map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-slate-50">
                <Link href={`/cases/${r.id}`} className="font-medium text-slate-900 hover:text-blue-600">
                  {r.address}
                </Link>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span className={'rounded-full px-2 py-0.5 ' + STATUS_COLOR[r.status as PropertyStatus]}>
                    {STATUS_LABEL[r.status as PropertyStatus]}
                  </span>
                  <span>{formatPct(r.alpha)} α</span>
                  <span className="text-slate-400">{formatNum(r.kvm)} kvm</span>
                </div>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'emerald';
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div
        className={
          'mt-2 text-2xl font-bold tabular-nums ' +
          (accent === 'emerald' ? 'text-emerald-600' : 'text-slate-900')
        }
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
