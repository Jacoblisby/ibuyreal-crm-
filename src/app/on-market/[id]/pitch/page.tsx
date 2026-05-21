/**
 * Pitch-side: én underside per case der gør det visuelt øjeblikkeligt klart
 * at udbudsprisen ligger UNDER vores FMV, valideret med friske handler.
 *
 * Tre sektioner:
 *   1. HERO: udbud · FMV · discount (stort, grønt, ingen støj)
 *   2. BEVIS: friske handler sidste 5 mdr i samme postnr/kvm/byggeår
 *      solgt OVER vores udbud — direct evidence at markedet er enig
 *   3. PRIS/M² BREAKDOWN: udbud vs FMV vs comp-median side-ved-side
 *
 * Server-side rendered — al data hentes direkte fra DB.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { externalSales, onMarketCandidates } from '@/lib/db/schema';
import { formatKr, formatPct } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pitch — iBuyReal' };

interface PitchComp {
  date: string;
  ageMonths: number;
  address: string;
  kvm: number;
  yearBuilt: number | null;
  perAreaPrice: number;
  vsList: number;
  vsFmv: number | null;
  source: 'internal' | 'resight';
}

export default async function PitchPage({ params }: { params: Promise<{ id: string }> }) {
  if (!db) return <div className="text-sm text-slate-500">DB ikke konfigureret.</div>;

  const { id } = await params;
  const [c] = await db.select().from(onMarketCandidates).where(eq(onMarketCandidates.id, id));
  if (!c) return notFound();

  if (!c.kvm || !c.listPrice || !c.v3Fmv) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
        <h1 className="text-lg font-semibold text-amber-900">Pitch ikke tilgængelig</h1>
        <p className="mt-2 text-sm text-amber-800">
          Casen mangler kvm, udbudspris eller FMV-estimat. Sæt manuel FMV på{' '}
          <Link className="underline" href={`/on-market/${id}`}>case-siden</Link>{' '}
          for at låse pitch op.
        </p>
      </div>
    );
  }

  const subjectKvm = c.kvm;
  const listPpm = c.listPrice / subjectKvm;
  const fmvPpm = c.v3Fmv / subjectKvm;
  const fmvUpside = (c.v3Fmv - c.listPrice) / c.listPrice;
  const fmvUpsideKr = c.v3Fmv - c.listPrice;
  const isPitchable = fmvUpside > 0;

  // ─── Find friske comps ─────────────────────────────────────────────────
  const kvmMin = Math.floor(subjectKvm * 0.7);
  const kvmMax = Math.ceil(subjectKvm * 1.3);
  const yearTol = 25;
  const now = new Date();
  const DAY_MS = 1000 * 60 * 60 * 24;
  const nowMs = now.getTime();

  const cutoff5m = new Date(now);
  cutoff5m.setMonth(cutoff5m.getMonth() - 5);
  const cutoff5mStr = cutoff5m.toISOString().slice(0, 10);

  const cutoff12m = new Date(now);
  cutoff12m.setMonth(cutoff12m.getMonth() - 12);
  const cutoff12mStr = cutoff12m.toISOString().slice(0, 10);

  const extRows = await db
    .select({
      address: externalSales.address,
      saleDate: externalSales.saleDate,
      amount: externalSales.amount,
      kvm: externalSales.kvm,
      perAreaPrice: externalSales.perAreaPrice,
      yearBuilt: externalSales.yearBuilt,
    })
    .from(externalSales)
    .where(
      and(
        eq(externalSales.postalCode, c.postalCode),
        gte(externalSales.saleDate, cutoff12mStr),
        sql`${externalSales.kvm} BETWEEN ${kvmMin} AND ${kvmMax}`,
      ),
    );

  // Internal peers (samme logik som comparables-api'et)
  const internalPeers = await db
    .select({
      id: onMarketCandidates.id,
      address: onMarketCandidates.address,
      kvm: onMarketCandidates.kvm,
      yearBuilt: onMarketCandidates.yearBuilt,
      historicalSales: onMarketCandidates.historicalSales,
    })
    .from(onMarketCandidates)
    .where(
      and(
        eq(onMarketCandidates.postalCode, c.postalCode),
        sql`${onMarketCandidates.kvm} BETWEEN ${kvmMin} AND ${kvmMax}`,
      ),
    );

  const allComps: PitchComp[] = [];

  // Resight
  for (const r of extRows) {
    if (!r.kvm) continue;
    if (c.yearBuilt && r.yearBuilt && Math.abs(r.yearBuilt - c.yearBuilt) > yearTol) continue;
    const ppm = r.perAreaPrice ?? r.amount / r.kvm;
    if (ppm < 5_000) continue;
    const ageMonths = (nowMs - new Date(r.saleDate).getTime()) / DAY_MS / 30.44;
    allComps.push({
      date: r.saleDate,
      ageMonths: Math.round(ageMonths * 10) / 10,
      address: r.address,
      kvm: r.kvm,
      yearBuilt: r.yearBuilt,
      perAreaPrice: Math.round(ppm),
      vsList: (ppm - listPpm) / listPpm,
      vsFmv: fmvPpm ? (ppm - fmvPpm) / fmvPpm : null,
      source: 'resight',
    });
  }

  // Internal
  for (const p of internalPeers) {
    if (!p.historicalSales) continue;
    if (c.yearBuilt && p.yearBuilt && Math.abs(p.yearBuilt - c.yearBuilt) > yearTol) continue;
    for (const s of p.historicalSales as Array<{ date: string; amount: number; type: string }>) {
      if (s.type !== 'normal') continue;
      if (s.date < cutoff12mStr) continue;
      if (!s.amount || s.amount < 100_000) continue;
      const kvm = p.kvm ?? 0;
      if (kvm <= 0) continue;
      const ppm = Math.round(s.amount / kvm);
      const ageMonths = (nowMs - new Date(s.date).getTime()) / DAY_MS / 30.44;
      allComps.push({
        date: s.date,
        ageMonths: Math.round(ageMonths * 10) / 10,
        address: p.address,
        kvm,
        yearBuilt: p.yearBuilt,
        perAreaPrice: ppm,
        vsList: (ppm - listPpm) / listPpm,
        vsFmv: fmvPpm ? (ppm - fmvPpm) / fmvPpm : null,
        source: 'internal',
      });
    }
  }

  // Dedup på dato+adresse — internal vinder
  const seen = new Set<string>();
  const dedup: PitchComp[] = [];
  allComps.sort((a, b) => (a.source === 'internal' ? -1 : 1));
  for (const x of allComps) {
    const key = `${x.date}|${x.address.toLowerCase().replace(/\s+/g, '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(x);
  }

  const fresh5m = dedup.filter((x) => x.date >= cutoff5mStr);
  const fresh5mAboveList = fresh5m.filter((x) => x.vsList >= 0).sort((a, b) => b.vsList - a.vsList);
  const fresh12mAboveList = dedup.filter((x) => x.vsList >= 0).sort((a, b) => b.vsList - a.vsList);

  // Comp-median (fresh 12m)
  const fresh12mPpm = dedup
    .filter((x) => x.date >= cutoff12mStr)
    .map((x) => x.perAreaPrice)
    .sort((a, b) => a - b);
  const compMedian = fresh12mPpm.length > 0 ? fresh12mPpm[Math.floor(fresh12mPpm.length / 2)] : null;

  // Strong comps: fresh 5m above list (de "rygende" beviser)
  const strongComps = fresh5mAboveList.slice(0, 8);
  // Fallback til 12m hvis < 3
  const displayComps = strongComps.length >= 3 ? strongComps : fresh12mAboveList.slice(0, 8);
  const usingExtended = strongComps.length < 3;

  return (
    <div className="space-y-6">
      {/* Top-bar med tilbage-link */}
      <div className="flex items-center justify-between">
        <Link
          href={`/on-market/${id}`}
          className="inline-flex items-center gap-1 text-sm text-slate-500 transition-colors duration-150 ease-[var(--ease-out)] hover:text-slate-900"
        >
          <span aria-hidden="true">←</span>
          Tilbage til case-detail
        </Link>
        <div className="text-xs text-slate-400">Pitch-view · {c.postalCode}</div>
      </div>

      {/* ─── HERO ─────────────────────────────────────────────────────── */}
      <div
        className={
          'overflow-hidden rounded-2xl border bg-gradient-to-br p-8 shadow-sm ' +
          (isPitchable
            ? 'border-emerald-200/70 from-emerald-50/40 via-white to-white'
            : 'border-rose-200/70 from-rose-50/40 via-white to-white')
        }
      >
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">
          {c.bydel ? c.bydel.replace('-', ' ').replace('oe', 'ø').replace('aer', 'ær') : 'København'} ·{' '}
          {c.kvm} m² · {c.rooms ?? '?'} værelser
          {c.yearBuilt ? ` · opført ${c.yearBuilt}` : ''}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{c.address}</h1>
        <div className="mt-1 text-sm text-slate-500">{c.postalCode} {c.city}</div>

        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
          {/* Udbud */}
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Udbudspris
            </div>
            <div className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-slate-900">
              {formatKr(c.listPrice)}
            </div>
            <div className="mt-1 text-xs text-slate-400 tabular-nums">
              {formatKr(listPpm)}/m²
            </div>
          </div>

          {/* Vores FMV */}
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Vores FMV
              {c.v3FmvSource && (
                <span className="ml-1.5 normal-case text-slate-400">
                  ({c.v3FmvSource === 'ibuyreal-avm' ? 'iBR AVM' : 'manuel'})
                </span>
              )}
            </div>
            <div className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-slate-900">
              {formatKr(c.v3Fmv)}
            </div>
            <div className="mt-1 text-xs text-slate-400 tabular-nums">{formatKr(fmvPpm)}/m²</div>
          </div>

          {/* Discount */}
          <div
            className={
              'rounded-xl p-4 ' +
              (isPitchable ? 'bg-emerald-100/60' : 'bg-rose-100/60')
            }
          >
            <div
              className={
                'text-[11px] font-medium uppercase tracking-wider ' +
                (isPitchable ? 'text-emerald-700' : 'text-rose-700')
              }
            >
              {isPitchable ? 'Discount vs FMV' : 'Premium vs FMV'}
            </div>
            <div
              className={
                'mt-2 text-4xl font-bold tabular-nums tracking-tight ' +
                (isPitchable ? 'text-emerald-700' : 'text-rose-700')
              }
            >
              {isPitchable ? '+' : ''}
              {formatPct(fmvUpside, 1)}
            </div>
            <div
              className={
                'mt-1 text-xs tabular-nums ' +
                (isPitchable ? 'text-emerald-700/80' : 'text-rose-700/80')
              }
            >
              {fmvUpsideKr >= 0 ? '+' : ''}
              {formatKr(fmvUpsideKr)} upside
            </div>
          </div>
        </div>
      </div>

      {/* ─── BEVIS: friske comps ───────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">
              {fresh5mAboveList.length > 0
                ? 'Markedet bekræfter — friske handler ligger OVER udbud'
                : displayComps.length > 0
                ? 'Nær-comps fra sidste 12 mdr'
                : 'Ingen friske comps fundet'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Samme postnr {c.postalCode}, ±30% kvm
              {c.yearBuilt ? `, byggeår ${c.yearBuilt - yearTol}-${c.yearBuilt + yearTol}` : ''}
              {usingExtended ? ' · 12 mdr (for få under 5 mdr)' : ' · sidste 5 mdr'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <MiniStat
              label="Friske 5 mdr ≥ udbud"
              value={String(fresh5mAboveList.length)}
              tone={fresh5mAboveList.length >= 3 ? 'emerald' : fresh5mAboveList.length > 0 ? 'amber' : 'rose'}
            />
            <MiniStat
              label="Sidste 12 mdr ≥ udbud"
              value={String(fresh12mAboveList.length)}
              tone={fresh12mAboveList.length >= 3 ? 'emerald' : 'slate'}
            />
            <MiniStat
              label="Comp-median /m²"
              value={compMedian ? formatKr(compMedian) : '–'}
              tone={compMedian && compMedian >= listPpm ? 'emerald' : 'slate'}
            />
          </div>
        </div>

        {displayComps.length > 0 ? (
          <div className="mt-5 overflow-hidden rounded-xl border border-slate-100">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[10px] font-medium uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2">Solgt</th>
                  <th className="px-3 py-2 text-right">Alder</th>
                  <th className="px-3 py-2">Adresse</th>
                  <th className="px-3 py-2 text-right">kvm</th>
                  <th className="px-3 py-2 text-right">Bygget</th>
                  <th className="px-3 py-2 text-right">kr/m²</th>
                  <th className="px-3 py-2 text-right">vs udbud</th>
                  {fmvPpm > 0 && <th className="px-3 py-2 text-right">vs FMV</th>}
                </tr>
              </thead>
              <tbody>
                {displayComps.map((x, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-2 tabular-nums text-slate-700">{x.date}</td>
                    <td
                      className={
                        'px-3 py-2 text-right tabular-nums text-xs ' +
                        (x.ageMonths <= 3
                          ? 'font-semibold text-emerald-700'
                          : x.ageMonths <= 6
                          ? 'text-emerald-600'
                          : 'text-slate-500')
                      }
                    >
                      {x.ageMonths < 12 ? `${x.ageMonths.toFixed(1)} mdr` : `${(x.ageMonths / 12).toFixed(1)} år`}
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-900">
                      {x.address}
                      {x.source === 'resight' && (
                        <span
                          title="Resight tinglysningsdata"
                          className="ml-1.5 inline-block rounded bg-violet-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-violet-700"
                        >
                          R
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{x.kvm}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-500">
                      {x.yearBuilt ?? '–'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">
                      {formatKr(x.perAreaPrice)}
                    </td>
                    <td
                      className={
                        'px-3 py-2 text-right tabular-nums font-semibold ' +
                        (x.vsList >= 0.05
                          ? 'text-emerald-700'
                          : x.vsList >= 0
                          ? 'text-emerald-600'
                          : 'text-rose-600')
                      }
                    >
                      {x.vsList >= 0 ? '+' : ''}
                      {(x.vsList * 100).toFixed(1)}%
                    </td>
                    {fmvPpm > 0 && (
                      <td
                        className={
                          'px-3 py-2 text-right tabular-nums text-xs font-medium ' +
                          (x.vsFmv === null
                            ? 'text-slate-400'
                            : Math.abs(x.vsFmv) <= 0.08
                            ? 'text-emerald-700'
                            : x.vsFmv >= 0
                            ? 'text-emerald-600'
                            : 'text-amber-600')
                        }
                      >
                        {x.vsFmv !== null
                          ? `${x.vsFmv >= 0 ? '+' : ''}${(x.vsFmv * 100).toFixed(1)}%`
                          : '–'}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-5 rounded-md border border-slate-100 bg-slate-50/50 p-4 text-sm text-slate-500">
            Ingen friske handler fundet i samme postnr+kvm+byggeår-bånd. Udvid scope eller revurdér.
          </div>
        )}
      </div>

      {/* ─── PRIS/M² BREAKDOWN ───────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">
          Pris pr. m² — tre uafhængige værdier
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Investorens hurtige skim: hvad koster m² på udbud, hvad siger vores model, hvad solgte
          markedet for?
        </p>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <PpmCard label="Udbud /m²" value={listPpm} tone="neutral" sub="sælgers ask" />
          <PpmCard
            label="Vores FMV /m²"
            value={fmvPpm}
            tone={isPitchable ? 'emerald' : 'rose'}
            sub={`${isPitchable ? '+' : ''}${formatPct((fmvPpm - listPpm) / listPpm, 1)} vs udbud`}
          />
          <PpmCard
            label="Comp-median /m²"
            value={compMedian}
            tone={compMedian && compMedian >= listPpm ? 'emerald' : 'slate'}
            sub={
              compMedian
                ? `${((compMedian - listPpm) / listPpm) * 100 >= 0 ? '+' : ''}${(
                    ((compMedian - listPpm) / listPpm) *
                    100
                  ).toFixed(1)}% vs udbud · n=${fresh12mPpm.length}`
                : 'ingen comps'
            }
          />
        </div>
      </div>

      {/* ─── DEAL NOTE / NEXT STEPS ──────────────────────────────────── */}
      {isPitchable && fresh5mAboveList.length > 0 && (
        <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/40 p-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-emerald-600 text-white">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold text-emerald-900">
                Kort sagt: udbud {formatKr(listPpm)}/m² · markedet betaler{' '}
                {formatKr(compMedian ?? fmvPpm)}/m² · {fresh5mAboveList.length} handler sidste 5 mdr
                solgt over udbud
              </div>
              <p className="mt-1 text-xs text-emerald-800/80">
                Udbudsprisen ligger {formatPct(Math.abs(fmvUpside), 1)} under vores FMV. Friske
                comps fra samme postnr/kvm/byggeår-segment validerer at det er pris-disconnect,
                ikke værdi-disconnect.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'emerald' | 'amber' | 'rose' | 'slate';
}) {
  const toneClass =
    tone === 'emerald'
      ? 'text-emerald-700'
      : tone === 'amber'
      ? 'text-amber-700'
      : tone === 'rose'
      ? 'text-rose-700'
      : 'text-slate-700';
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/40 px-3 py-2 text-right">
      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className={'mt-0.5 text-xl font-bold tabular-nums tracking-tight ' + toneClass}>
        {value}
      </div>
    </div>
  );
}

function PpmCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number | null;
  sub: string;
  tone: 'neutral' | 'emerald' | 'rose' | 'slate';
}) {
  const border =
    tone === 'emerald'
      ? 'border-emerald-200/70 bg-emerald-50/30'
      : tone === 'rose'
      ? 'border-rose-200/70 bg-rose-50/30'
      : tone === 'slate'
      ? 'border-slate-200 bg-slate-50/30'
      : 'border-slate-200 bg-white';
  const valueColor =
    tone === 'emerald' ? 'text-emerald-700' : tone === 'rose' ? 'text-rose-700' : 'text-slate-900';
  return (
    <div className={'rounded-xl border p-5 ' + border}>
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className={'mt-2 text-2xl font-bold tabular-nums tracking-tight ' + valueColor}>
        {value ? formatKr(value) : '–'}
      </div>
      <div className="mt-1 text-xs text-slate-500">{sub}</div>
    </div>
  );
}
