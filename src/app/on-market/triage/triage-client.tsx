'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { OnMarketCandidate } from '@/lib/db/schema';
import { pickCurated } from '@/lib/curation';
import type { CalibrationFactors } from '@/lib/avmCalibration';
import type { StrongFreshAggregate } from '@/lib/strongComps';
import { diagnoseCase } from '@/lib/diagnose';
import { DiagnoseChips } from '@/components/DiagnoseChips';
import { formatKr } from '@/lib/format';
import { BYDEL_LABEL } from '@/lib/status';

type PassReason = 'pris' | 'stand' | 'beliggenhed' | 'andet';

const PASS_REASONS: Array<{ value: PassReason; label: string; key: string }> = [
  { value: 'pris', label: 'For dyr', key: '1' },
  { value: 'stand', label: 'Stand/renovering', key: '2' },
  { value: 'beliggenhed', label: 'Beliggenhed', key: '3' },
  { value: 'andet', label: 'Andet', key: '4' },
];

export function TriageClient({
  initial,
  strongFreshMap,
  calibration,
}: {
  initial: OnMarketCandidate[];
  strongFreshMap?: Record<string, StrongFreshAggregate>;
  calibration?: CalibrationFactors;
}) {
  const router = useRouter();
  // Lokal kø: cases fjernes optimistisk når der tages stilling
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const [showPassPicker, setShowPassPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  // Feedback-loop: fritekst-begrundelse gemmes sammen med beslutningen
  const [note, setNote] = useState('');

  const queue = useMemo(() => {
    const picks = pickCurated(initial, 20, { strongFreshMap, calibration });
    return picks.filter((c) => c.reviewStatus === 'ny' && !handled.has(c.id));
  }, [initial, strongFreshMap, calibration, handled]);

  const current = queue[0];
  const total = queue.length + doneCount;

  const act = useCallback(
    async (reviewStatus: 'interesseret' | 'passet' | 'senere', passReason?: PassReason) => {
      if (!current || busy) return;
      setBusy(true);
      setShowPassPicker(false);
      const id = current.id;
      const addr = current.address;
      const trimmedNote = note.trim();
      // Optimistisk: videre med det samme
      setHandled((prev) => new Set(prev).add(id));
      setDoneCount((n) => n + 1);
      setNote('');
      try {
        const r = await fetch(`/api/on-market/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reviewStatus,
            ...(passReason ? { passReason } : {}),
            ...(trimmedNote ? { reviewNote: trimmedNote } : {}),
          }),
        });
        if (!r.ok) throw new Error('Kunne ikke gemme');
        const label =
          reviewStatus === 'interesseret'
            ? '✓ Interesseret'
            : reviewStatus === 'senere'
            ? '⏰ Senere'
            : `✗ Passet (${PASS_REASONS.find((p) => p.value === passReason)?.label ?? passReason})`;
        toast.success(`${label} — ${addr}`);
      } catch {
        toast.error(`Kunne ikke gemme ${addr} — prøv igen`);
        setHandled((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setDoneCount((n) => n - 1);
        setNote(trimmedNote); // gendan så begrundelsen ikke tabes
      } finally {
        setBusy(false);
      }
    },
    [current, busy, note],
  );

  // Tastaturgenveje
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (showPassPicker) {
        const reason = PASS_REASONS.find((p) => p.key === e.key);
        if (reason) {
          e.preventDefault();
          act('passet', reason.value);
        } else if (e.key === 'Escape') {
          setShowPassPicker(false);
        }
        return;
      }
      if (e.key === 'i') {
        e.preventDefault();
        act('interesseret');
      } else if (e.key === 'p') {
        e.preventDefault();
        setShowPassPicker(true);
      } else if (e.key === 's') {
        e.preventDefault();
        act('senere');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, showPassPicker]);

  // ─── Inbox zero ─────────────────────────────────────────────────────────
  if (!current) {
    return (
      <div className="mx-auto max-w-lg py-24 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
          <svg className="h-8 w-8 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-slate-900">
          Alt behandlet
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {doneCount > 0
            ? `Du har taget stilling til ${doneCount} kandidat${doneCount === 1 ? '' : 'er'} i denne omgang.`
            : 'Ingen nye Top picks-kandidater kræver din stilling.'}
          {' '}Nye kandidater lander her efter næste scrape (dagligt kl 07:00).
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <a
            href="/on-market"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 active:scale-[0.97]"
          >
            Til on-market
          </a>
          <button
            onClick={() => router.refresh()}
            className="rounded-md border border-slate-200 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50 active:scale-[0.97]"
          >
            Genindlæs
          </button>
        </div>
      </div>
    );
  }

  // ─── Aktuel kandidat ────────────────────────────────────────────────────
  const c = current;
  const estimat = c.v3Fmv ?? 0;
  const listPrice = c.listPrice ?? 0;
  const upsidePct = listPrice > 0 && estimat > 0 ? ((estimat - listPrice) / listPrice) * 100 : null;
  const listPpm = c.kvm && listPrice ? listPrice / c.kvm : 0;
  const agg = c.strongFreshAggregate;
  const medianDeltaPct =
    agg?.medianPpm && listPpm > 0 ? ((agg.medianPpm - listPpm) / listPpm) * 100 : null;
  const flags = diagnoseCase(c, agg);
  const bydel = c.bydel ? BYDEL_LABEL[c.bydel] ?? c.bydel : 'København';
  const stand = c.imageAssessment?.overall_condition ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Top-bar: fremdrift */}
      <div className="flex items-center justify-between">
        <a href="/on-market" className="text-sm text-slate-500 hover:text-slate-900">
          ← On-market
        </a>
        <div className="flex items-center gap-3">
          <span className="text-xs tabular-nums text-slate-500">
            <span className="font-semibold text-slate-900">{doneCount + 1}</span> af {total}
          </span>
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-slate-900 transition-all duration-300 ease-[var(--ease-out)]"
              style={{ width: `${(doneCount / Math.max(total, 1)) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Kandidat-kort */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* Billede */}
        {c.primaryImage && (
          <div className="aspect-[2/1] w-full bg-slate-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.primaryImage} alt={c.address} className="h-full w-full object-cover" />
          </div>
        )}

        <div className="p-6">
          {/* Adresse */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">{c.address}</h1>
              <p className="mt-0.5 text-sm text-slate-500">
                {c.postalCode} {bydel} · {c.kvm} m² · {c.rooms ?? '?'} vær.
                {c.yearBuilt ? ` · opført ${c.yearBuilt}` : ''}
                {c.daysOnMarket ? ` · ${c.daysOnMarket} dage på marked` : ''}
              </p>
            </div>
            <a
              href={`/on-market/${c.id}`}
              target="_blank"
              className="flex-none rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-50"
            >
              Detaljer ↗
            </a>
          </div>

          {/* Diagnose-chips */}
          <div className="mt-4">
            <DiagnoseChips flags={flags} max={10} />
          </div>

          {/* Pris-blok */}
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Udbud</div>
              <div className="mt-1 text-lg font-bold tabular-nums text-slate-900">{formatKr(listPrice)}</div>
              <div className="text-[11px] tabular-nums text-slate-400">{Math.round(listPpm).toLocaleString('da-DK')} kr/m²</div>
            </div>
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Vores estimat</div>
              <div className="mt-1 text-lg font-bold tabular-nums text-slate-900">
                {estimat > 0 ? formatKr(estimat) : '–'}
              </div>
              {upsidePct !== null && (
                <div className={'text-[11px] font-semibold tabular-nums ' + (upsidePct >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                  {upsidePct >= 0 ? '+' : ''}{upsidePct.toFixed(1)}% upside
                </div>
              )}
            </div>
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400" title="Median af friske handler i samme postnr+kvm+byggeår vs udbud">
                Marked siger
              </div>
              <div className={'mt-1 text-lg font-bold tabular-nums ' + (medianDeltaPct === null ? 'text-slate-300' : medianDeltaPct >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                {medianDeltaPct === null ? '–' : `${medianDeltaPct >= 0 ? '+' : ''}${medianDeltaPct.toFixed(1)}%`}
              </div>
              <div className="text-[11px] tabular-nums text-slate-400">
                {agg?.count ? `${agg.count} friske handler` : 'ingen comps'}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Stand</div>
              <div className={'mt-1 text-lg font-bold tabular-nums ' + (stand === null ? 'text-slate-300' : stand >= 7 ? 'text-emerald-600' : stand >= 5 ? 'text-amber-600' : 'text-rose-600')}>
                {stand === null ? '–' : `${stand}/10`}
              </div>
              <div className="text-[11px] text-slate-400">
                {c.imageAssessment?.renovation_state
                  ? c.imageAssessment.renovation_state.slice(0, 28)
                  : 'ikke vurderet endnu'}
              </div>
            </div>
          </div>
        </div>

        {/* Feedback-loop: hvorfor virker/virker den ikke? */}
        <div className="border-t border-slate-100 px-6 py-4">
          <label className="mb-1.5 block text-xs font-medium text-slate-600">
            Din vurdering — hvorfor virker casen / virker den ikke?{' '}
            <span className="font-normal text-slate-400">(valgfrit — gemmes med beslutningen og bruges til at forbedre modellen)</span>
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder='F.eks. "God pris men Sundholm-kvarteret er for uroligt" eller "AVM undervurderer — altan + 5. sal med udsigt"'
            className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-300 transition-colors duration-150 ease-[var(--ease-out)] hover:border-slate-300 focus:border-slate-400 focus:outline-none"
          />
        </div>

        {/* Handlings-bar */}
        <div className="border-t border-slate-100 bg-slate-50/60 p-4">
          {showPassPicker ? (
            <div>
              <div className="mb-2 text-xs font-medium text-slate-600">Hvorfor passer du? (1-4, Esc annullerer)</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {PASS_REASONS.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => act('passet', r.value)}
                    disabled={busy}
                    className="rounded-lg border border-rose-200 bg-white px-3 py-2.5 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-50 active:scale-[0.97] disabled:opacity-50"
                  >
                    <span className="mr-1.5 inline-block rounded bg-rose-100 px-1.5 text-[10px] tabular-nums">{r.key}</span>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => act('interesseret')}
                disabled={busy}
                className="rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-[background-color,transform] hover:bg-emerald-700 active:scale-[0.97] disabled:opacity-50"
              >
                Interesseret
                <span className="ml-2 rounded bg-emerald-700/60 px-1.5 py-0.5 text-[10px] font-normal">i</span>
              </button>
              <button
                onClick={() => setShowPassPicker(true)}
                disabled={busy}
                className="rounded-lg border border-rose-200 bg-white px-4 py-3 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-50 active:scale-[0.97] disabled:opacity-50"
              >
                Pas
                <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-normal">p</span>
              </button>
              <button
                onClick={() => act('senere')}
                disabled={busy}
                className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 active:scale-[0.97] disabled:opacity-50"
              >
                Senere
                <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal">s</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Næste i køen (peek) */}
      {queue.length > 1 && (
        <p className="text-center text-xs text-slate-400">
          Næste: {queue[1].address} · {queue.length - 1} tilbage i køen
        </p>
      )}
    </div>
  );
}
