/**
 * Feedback-loop oversigt: alle triage-beslutninger med Jacobs begrundelser.
 *
 * Formål: lære hvor modellen/gates afviger fra den faktiske vurdering.
 * Mønstre her bliver til gate-justeringer eller træningssignal til AVM.
 */
import Link from 'next/link';
import { db } from '@/lib/db/client';
import { onMarketCandidates } from '@/lib/db/schema';
import { desc, isNotNull, inArray, and } from 'drizzle-orm';
import { formatKr } from '@/lib/format';
import { BYDEL_LABEL } from '@/lib/status';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Triage-feedback — iBuyReal' };

const PASS_LABEL: Record<string, string> = {
  pris: 'For dyr',
  stand: 'Stand/renovering',
  beliggenhed: 'Beliggenhed',
  andet: 'Andet',
};

export default async function TriageFeedbackPage() {
  if (!db) return <div className="text-sm text-slate-500">DB ikke konfigureret.</div>;

  const decisions = await db
    .select()
    .from(onMarketCandidates)
    .where(
      and(
        inArray(onMarketCandidates.reviewStatus, ['interesseret', 'passet', 'senere']),
        isNotNull(onMarketCandidates.reviewedAt),
      ),
    )
    .orderBy(desc(onMarketCandidates.reviewedAt))
    .limit(200);

  const interested = decisions.filter((d) => d.reviewStatus === 'interesseret');
  const passed = decisions.filter((d) => d.reviewStatus === 'passet');
  const later = decisions.filter((d) => d.reviewStatus === 'senere');
  const withNote = decisions.filter((d) => d.reviewNote);

  // Pas-årsag fordeling
  const reasonCounts = new Map<string, number>();
  for (const d of passed) {
    if (d.passReason) reasonCounts.set(d.passReason, (reasonCounts.get(d.passReason) ?? 0) + 1);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Triage-feedback</h1>
        <p className="mt-1 text-sm text-slate-500">
          Dine beslutninger + begrundelser fra triage-inboxen. Mønstre her bliver til
          gate-justeringer og træningssignal til AVM-modellen.
        </p>
      </div>

      {/* Stat-strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Interesseret" value={interested.length} tone="emerald" />
        <Stat label="Passet" value={passed.length} tone="rose" />
        <Stat label="Senere" value={later.length} tone="slate" />
        <Stat label="Med begrundelse" value={withNote.length} tone="blue" />
      </div>

      {/* Pas-årsager */}
      {reasonCounts.size > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-[13px] font-semibold tracking-tight text-slate-900">
            Hvorfor passer du? (fordeling)
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {Array.from(reasonCounts.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([reason, n]) => (
                <span
                  key={reason}
                  className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-sm text-rose-800"
                >
                  {PASS_LABEL[reason] ?? reason}
                  <span className="rounded-full bg-rose-100 px-1.5 text-xs font-semibold tabular-nums">{n}</span>
                </span>
              ))}
          </div>
        </div>
      )}

      {/* Beslutningslog */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/80 text-left text-[11px] font-medium uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2.5">Dato</th>
              <th className="px-3 py-2.5">Case</th>
              <th className="px-3 py-2.5">Beslutning</th>
              <th className="px-3 py-2.5">Begrundelse</th>
              <th className="px-3 py-2.5 text-right">Udbud</th>
              <th className="px-3 py-2.5 text-right">α</th>
            </tr>
          </thead>
          <tbody>
            {decisions.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-12 text-center text-sm text-slate-400">
                  Ingen beslutninger endnu — gå til{' '}
                  <Link href="/on-market/triage" className="text-blue-600 underline">triagen</Link>{' '}
                  og tag stilling til kandidaterne.
                </td>
              </tr>
            ) : (
              decisions.map((d) => (
                <tr key={d.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                  <td className="px-3 py-2.5 text-xs tabular-nums text-slate-500 whitespace-nowrap">
                    {d.reviewedAt ? new Date(d.reviewedAt).toLocaleDateString('da-DK', { day: 'numeric', month: 'short' }) : '–'}
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={`/on-market/${d.id}`} className="font-medium text-slate-900 hover:text-blue-700 hover:underline">
                      {d.address}
                    </Link>
                    <div className="text-xs text-slate-400">
                      {d.postalCode} {d.bydel ? BYDEL_LABEL[d.bydel] ?? d.bydel : ''} · {d.kvm} m²
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {d.reviewStatus === 'interesseret' && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">✓ Interesseret</span>
                    )}
                    {d.reviewStatus === 'passet' && (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800">
                        ✗ Pas{d.passReason ? ` · ${PASS_LABEL[d.passReason] ?? d.passReason}` : ''}
                      </span>
                    )}
                    {d.reviewStatus === 'senere' && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">⏰ Senere</span>
                    )}
                  </td>
                  <td className="max-w-md px-3 py-2.5 text-sm text-slate-700">
                    {d.reviewNote || <span className="text-slate-300">–</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-600 whitespace-nowrap">
                    {d.listPrice ? formatKr(d.listPrice) : '–'}
                  </td>
                  <td className={'px-3 py-2.5 text-right text-xs font-semibold tabular-nums ' + ((d.v3Alpha ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                    {d.v3Alpha !== null ? `${((d.v3Alpha ?? 0) * 100).toFixed(1)}%` : '–'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'rose' | 'slate' | 'blue' }) {
  const color =
    tone === 'emerald' ? 'text-emerald-700' : tone === 'rose' ? 'text-rose-700' : tone === 'blue' ? 'text-blue-700' : 'text-slate-700';
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1.5 text-2xl font-bold tabular-nums tracking-tight ${color}`}>{value}</div>
    </div>
  );
}
