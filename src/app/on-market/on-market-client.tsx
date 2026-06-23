'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { OnMarketCandidate, ScrapeJob } from '@/lib/db/schema';
import { curatedScore, pickCurated } from '@/lib/curation';
import { formatKr, formatNum, formatPct } from '@/lib/format';
import { classifyEjerudgift, isGroundFloor } from '@/lib/quality';
import { diagnoseCase } from '@/lib/diagnose';
import { DiagnoseChips } from '@/components/DiagnoseChips';
import { BYDEL_LABEL } from '@/lib/status';

type ReviewStatus = 'ny' | 'interesseret' | 'passet' | 'importeret';

const REVIEW_LABEL: Record<ReviewStatus, string> = {
  ny: 'Ny',
  interesseret: 'Interesseret',
  passet: 'Passet',
  importeret: 'Importeret',
};

const REVIEW_COLOR: Record<ReviewStatus, string> = {
  ny: 'bg-slate-100 text-slate-700',
  interesseret: 'bg-emerald-100 text-emerald-700',
  passet: 'bg-rose-100 text-rose-700',
  importeret: 'bg-blue-100 text-blue-700',
};

type Preset = 'all' | 'curated' | 'fallback';

interface State {
  preset: Preset;
  q: string;
  bydel: string;
  review: '' | ReviewStatus;
  minKvm: string;
  maxKvm: string;
  minPris: string;
  maxPris: string;
  onlyAlpha: boolean;
  /** Hvis true: vis ogsa stueetage + hjemfaldspligt-cases (default false) */
  showDisqualified: boolean;
}

const DEFAULT_STATE: State = {
  preset: 'all',
  q: '',
  bydel: '',
  review: '',
  minKvm: '',
  maxKvm: '',
  minPris: '',
  maxPris: '',
  onlyAlpha: false,
  showDisqualified: false,
};

const PRESET_LABEL: Record<Preset, { label: string; desc: string }> = {
  all: { label: 'Alle', desc: 'Vis alle aktive listings' },
  curated: {
    label: 'Top picks',
    desc:
      'Cases hvor friske handler i samme område bekræfter et godt køb. Ingen stueetage, ingen hjemfald, ingen 1950–1990 betonejendomme, ingen støjgader, lejligheden i god stand.',
  },
  fallback: { label: 'Mangler AVM', desc: 'Kun cases hvor modellen ikke kunne predicte' },
};

export function OnMarketClient({
  initial,
  lastJob,
  strongFreshMap: strongFreshMapServer,
  calibration,
}: {
  initial: OnMarketCandidate[];
  lastJob: ScrapeJob | null;
  /** Pre-computed server-side: friske-comp aggregat (count, median, medianAboveList) per kandidat-ID */
  strongFreshMap?: Record<string, import('@/lib/strongComps').StrongFreshAggregate>;
  /** Server-computed AVM-kalibreringsfaktorer */
  calibration?: import('@/lib/avmCalibration').CalibrationFactors;
}) {
  const router = useRouter();
  const [rows] = useState(initial);
  const [scraping, setScraping] = useState(false);

  // Filter-state med sessionStorage-persistens så bruger ikke skal vælge
  // filtre igen efter at have klikket ind på en case og tilbage.
  // Bruger sessionStorage (ikke localStorage) så ny tab/session får default.
  const STATE_KEY = 'on-market-filters-v1';
  const [s, setS] = useState<State>(DEFAULT_STATE);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<State>;
        setS({ ...DEFAULT_STATE, ...parsed });
      }
    } catch {
      // ignore parse errors
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(STATE_KEY, JSON.stringify(s));
    } catch {
      // quota or disabled — ignore
    }
  }, [s]);

  // Beregn preset-counts altid (uafhængigt af andre filtre) til pill-badges.
  // Default skjules stueetage + hjemfaldspligt — kan vises via toggle.
  const isDisqualified = (x: OnMarketCandidate): boolean =>
    isGroundFloor(x.address) ||
    x.hjemfaldspligt === true ||
    x.handymanListing === true;
  const disqualifiedCount = useMemo(
    () => rows.filter((x) => x.status === 'active' && isDisqualified(x)).length,
    [rows],
  );
  const activeRows = useMemo(
    () =>
      rows.filter(
        (x) => x.status === 'active' && (s.showDisqualified || !isDisqualified(x)),
      ),
    [rows, s.showDisqualified],
  );

  const curatedTop20 = useMemo(
    () =>
      pickCurated(activeRows, 15, {
        strongFreshMap: strongFreshMapServer,
        calibration,
      }),
    [activeRows, strongFreshMapServer, calibration],
  );
  const curatedIds = useMemo(() => new Set(curatedTop20.map((x) => x.id)), [curatedTop20]);
  const strongFreshMap = useMemo(() => {
    const m = new Map<string, import('@/lib/strongComps').StrongFreshAggregate>();
    curatedTop20.forEach((x) => m.set(x.id, x.strongFreshAggregate));
    return m;
  }, [curatedTop20]);
  const scoreMap = useMemo(() => {
    const m = new Map<string, ReturnType<typeof curatedScore>>();
    activeRows.forEach((x) => m.set(x.id, curatedScore(x)));
    return m;
  }, [activeRows]);

  const presetCounts = useMemo(() => {
    return {
      all: activeRows.length,
      curated: curatedTop20.length,
      fallback: activeRows.filter(
        (x) => x.v3FmvSource !== 'ibuyreal-avm' && x.v3FmvSource !== 'manual',
      ).length,
    };
  }, [activeRows, curatedTop20]);

  const filtered = useMemo(() => {
    let r = activeRows;

    // Apply preset først
    if (s.preset === 'curated') {
      r = r.filter((x) => curatedIds.has(x.id));
      // Sort by score
      r = [...r].sort(
        (a, b) => (scoreMap.get(b.id)?.total ?? 0) - (scoreMap.get(a.id)?.total ?? 0),
      );
    } else if (s.preset === 'fallback') {
      r = r.filter((x) => x.v3FmvSource !== 'ibuyreal-avm' && x.v3FmvSource !== 'manual');
    }

    if (s.q) {
      const q = s.q.toLowerCase();
      r = r.filter((x) => x.address.toLowerCase().includes(q));
    }
    if (s.bydel) r = r.filter((x) => x.bydel === s.bydel);
    if (s.review) r = r.filter((x) => x.reviewStatus === s.review);
    if (s.minKvm) r = r.filter((x) => (x.kvm ?? 0) >= Number(s.minKvm));
    if (s.maxKvm) r = r.filter((x) => (x.kvm ?? 0) <= Number(s.maxKvm));
    if (s.minPris) r = r.filter((x) => (x.listPrice ?? 0) >= Number(s.minPris));
    if (s.maxPris) r = r.filter((x) => (x.listPrice ?? 0) <= Number(s.maxPris));
    if (s.onlyAlpha) r = r.filter((x) => (x.v3Alpha ?? 0) > 0);
    return r;
  }, [activeRows, s]);

  async function startScrape() {
    setScraping(true);
    const promise = (async () => {
      const res = await fetch('/api/on-market/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Scrape fejlede: ${res.status}`);
      }
      return (await res.json()) as {
        scraped: number;
        newListings: number;
        updated: number;
        markedSold: number;
        durationSeconds: number;
      };
    })();

    toast.promise(promise, {
      loading: 'Scraper Boligsiden…',
      success: (data) =>
        `${data.scraped} fundet · ${data.newListings} nye · ${data.markedSold} solgte (${data.durationSeconds.toFixed(1)}s)`,
      error: (e) => (e instanceof Error ? e.message : 'Scrape fejlede'),
    });

    try {
      await promise;
      router.refresh();
    } catch {
      // toast.promise viser fejlen — vi spiser den her
    } finally {
      setScraping(false);
    }
  }

  async function setReview(id: string, review: ReviewStatus, address: string) {
    await fetch(`/api/on-market/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewStatus: review }),
    });
    toast.success(`${address.split(',')[0]} → ${REVIEW_LABEL[review]}`, { duration: 2000 });
    router.refresh();
  }

  async function importCandidate(id: string, address: string) {
    toast(`Importér "${address.split(',')[0]}" til pipelinen?`, {
      action: {
        label: 'Importér',
        onClick: async () => {
          const t = toast.loading('Importerer…');
          try {
            const res = await fetch(`/api/on-market/${id}/import`, { method: 'POST' });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.error ?? 'Import fejlede');
            }
            const data = (await res.json()) as { propertyId: string };
            toast.success('Importeret', {
              id: t,
              description: 'Casen er klar i pipelinen',
              action: {
                label: 'Åbn case',
                onClick: () => router.push(`/cases/${data.propertyId}`),
              },
            });
            router.refresh();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Import fejlede', { id: t });
          }
        },
      },
    });
  }

  return (
    <div className="space-y-4">
      {/* Scrape control */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-sm">
          {lastJob ? (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="flex items-center gap-2 text-slate-500">
                <span
                  className={
                    'inline-block h-1.5 w-1.5 rounded-full ' +
                    (lastJob.status === 'success'
                      ? 'bg-emerald-500'
                      : lastJob.status === 'failed'
                      ? 'bg-rose-500'
                      : 'bg-amber-500 animate-pulse')
                  }
                />
                Senest scrapet
              </span>
              <span className="font-medium tabular-nums text-slate-900">
                {new Date(lastJob.startedAt).toLocaleString('da-DK', { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
              <span className="text-slate-400">·</span>
              <span className="tabular-nums text-slate-600">{lastJob.scraped} fundet</span>
              <span className="text-slate-300">·</span>
              <span className="tabular-nums text-slate-600">{lastJob.newListings} nye</span>
            </div>
          ) : (
            <span className="text-slate-500">Ingen scrapes endnu — start nu for at hente data fra Boligsiden.</span>
          )}
        </div>
        <button
          onClick={startScrape}
          disabled={scraping}
          className="group inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-[transform,background-color,box-shadow] duration-150 ease-[var(--ease-out)] hover:bg-slate-800 hover:shadow-md active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:shadow-sm disabled:active:scale-100"
        >
          {scraping && (
            <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          )}
          {scraping ? 'Scraper Boligsiden…' : 'Scrape Boligsiden nu'}
        </button>
      </div>

      {/* Preset pills */}
      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'curated', 'fallback'] as Preset[]).map((p) => {
          const active = s.preset === p;
          const meta = PRESET_LABEL[p];
          return (
            <button
              key={p}
              onClick={() => setS((st) => ({ ...st, preset: p }))}
              title={meta.desc}
              className={
                'inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.97] ' +
                (active
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50')
              }
            >
              <span>{meta.label}</span>
              <span
                className={
                  'tabular-nums text-xs ' +
                  (active ? 'text-slate-300' : 'text-slate-400')
                }
              >
                {presetCounts[p]}
              </span>
            </button>
          );
        })}
        <span className="ml-1 hidden text-xs text-slate-500 sm:inline">
          {PRESET_LABEL[s.preset].desc}
        </span>
      </div>


      {/* Filter bar — grouped + sticky */}
      <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-2.5 text-sm shadow-sm backdrop-blur-sm">
        {/* Søg */}
        <div className="relative">
          <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            placeholder="Søg adresse…"
            value={s.q}
            onChange={(e) => setS((p) => ({ ...p, q: e.target.value }))}
            className="w-56 rounded-md border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2 text-sm transition-colors duration-150 ease-[var(--ease-out)] placeholder:text-slate-400 hover:bg-white hover:border-slate-300 focus:bg-white focus:border-slate-400"
          />
        </div>

        <div className="h-6 w-px bg-slate-200" />

        {/* Bydel + Review */}
        <div className="flex items-center gap-2">
          <select
            value={s.bydel}
            onChange={(e) => setS((p) => ({ ...p, bydel: e.target.value }))}
            className="cursor-pointer rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm transition-colors duration-150 ease-[var(--ease-out)] hover:bg-white hover:border-slate-300"
          >
            <option value="">Alle bydele</option>
            {Object.entries(BYDEL_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            value={s.review}
            onChange={(e) => setS((p) => ({ ...p, review: e.target.value as State['review'] }))}
            className="cursor-pointer rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm transition-colors duration-150 ease-[var(--ease-out)] hover:bg-white hover:border-slate-300"
          >
            <option value="">Alle reviews</option>
            {(Object.keys(REVIEW_LABEL) as ReviewStatus[]).map((r) => (
              <option key={r} value={r}>{REVIEW_LABEL[r]}</option>
            ))}
          </select>
        </div>

        <div className="h-6 w-px bg-slate-200" />

        {/* kvm range */}
        <div className="inline-flex items-center overflow-hidden rounded-md border border-slate-200 bg-slate-50 transition-colors duration-150 ease-[var(--ease-out)] hover:bg-white hover:border-slate-300">
          <span className="px-2 text-xs font-medium text-slate-500">kvm</span>
          <input
            type="number"
            placeholder="min"
            value={s.minKvm}
            onChange={(e) => setS((p) => ({ ...p, minKvm: e.target.value }))}
            className="w-14 border-l border-slate-200 bg-transparent px-2 py-1.5 text-sm placeholder:text-slate-400"
          />
          <span className="text-slate-300">–</span>
          <input
            type="number"
            placeholder="max"
            value={s.maxKvm}
            onChange={(e) => setS((p) => ({ ...p, maxKvm: e.target.value }))}
            className="w-14 bg-transparent px-2 py-1.5 text-sm placeholder:text-slate-400"
          />
        </div>

        {/* pris range */}
        <div className="inline-flex items-center overflow-hidden rounded-md border border-slate-200 bg-slate-50 transition-colors duration-150 ease-[var(--ease-out)] hover:bg-white hover:border-slate-300">
          <span className="px-2 text-xs font-medium text-slate-500">pris</span>
          <input
            type="number"
            placeholder="min"
            value={s.minPris}
            onChange={(e) => setS((p) => ({ ...p, minPris: e.target.value }))}
            className="w-24 border-l border-slate-200 bg-transparent px-2 py-1.5 text-sm placeholder:text-slate-400"
          />
          <span className="text-slate-300">–</span>
          <input
            type="number"
            placeholder="max"
            value={s.maxPris}
            onChange={(e) => setS((p) => ({ ...p, maxPris: e.target.value }))}
            className="w-24 bg-transparent px-2 py-1.5 text-sm placeholder:text-slate-400"
          />
        </div>

        <label className="ml-1 inline-flex cursor-pointer select-none items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-slate-600 transition-colors duration-150 ease-[var(--ease-out)] hover:bg-slate-100">
          <input
            type="checkbox"
            checked={s.onlyAlpha}
            onChange={(e) => setS((p) => ({ ...p, onlyAlpha: e.target.checked }))}
            className="h-3.5 w-3.5 cursor-pointer accent-slate-900"
          />
          Kun positiv α
        </label>

        <label
          className="inline-flex cursor-pointer select-none items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-slate-600 transition-colors duration-150 ease-[var(--ease-out)] hover:bg-slate-100"
          title={`${disqualifiedCount} cases er stueetage, hjemfaldspligt eller håndværkertilbud — skjult som default`}
        >
          <input
            type="checkbox"
            checked={s.showDisqualified}
            onChange={(e) => setS((p) => ({ ...p, showDisqualified: e.target.checked }))}
            className="h-3.5 w-3.5 cursor-pointer accent-slate-900"
          />
          Vis stuen + hjemfald + håndværker ({disqualifiedCount})
        </label>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs tabular-nums text-slate-500">
            <span className="font-medium text-slate-700">{filtered.length}</span>
            <span className="text-slate-400"> / {rows.length}</span>
          </span>
          <button
            onClick={() => {
              setS(DEFAULT_STATE);
              try { sessionStorage.removeItem(STATE_KEY); } catch {}
            }}
            className="rounded-md px-2 py-1 text-xs text-slate-500 transition-colors duration-150 ease-[var(--ease-out)] hover:bg-slate-100 hover:text-slate-900 active:scale-[0.97]"
          >
            Nulstil
          </button>
        </div>
      </div>

      {/* Card-list — samme layout for alle presets */}
      <CaseCards
        cases={filtered}
        showRank={s.preset === 'curated'}
        emptyMessage={
          rows.length === 0
            ? 'Ingen scrape-data endnu. Klik "Scrape Boligsiden nu" øverst.'
            : s.preset === 'curated'
            ? 'Ingen cases passerer Top picks-gates lige nu.'
            : 'Ingen cases matcher filtrene. Prøv at nulstille.'
        }
        strongFreshMap={strongFreshMapServer}
      />
    </div>
  );
}

function ScoreLegendItem({
  max,
  label,
  desc,
}: {
  max: number;
  label: string;
  desc: string;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-700">
          /{max}
        </span>
        <span className="text-[11px] font-semibold text-slate-800">{label}</span>
      </div>
      <p className="mt-0.5 text-[10.5px] leading-tight text-slate-500">{desc}</p>
    </div>
  );
}

// ─── Case Cards — unified layout for ALLE presets ─────────────────────────
type TopPickCase = ReturnType<typeof pickCurated>[number];

function CaseCards({
  cases,
  showRank = false,
  emptyMessage = 'Ingen cases matcher filtrene.',
  strongFreshMap,
}: {
  cases: OnMarketCandidate[];
  showRank?: boolean;
  emptyMessage?: string;
  strongFreshMap?: Record<string, import('@/lib/strongComps').StrongFreshAggregate>;
}) {
  if (cases.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {cases.map((c, idx) => (
        <CaseCard
          key={c.id}
          c={c}
          rank={showRank ? idx + 1 : null}
          agg={strongFreshMap?.[c.id]}
        />
      ))}
    </div>
  );
}

function CaseCard({
  c,
  rank,
  agg,
}: {
  c: OnMarketCandidate;
  rank: number | null;
  agg?: import('@/lib/strongComps').StrongFreshAggregate;
}) {
  const estimat = c.v3Fmv ?? 0;
  const listPrice = c.listPrice ?? 0;
  const upsidePct = listPrice > 0 ? ((estimat - listPrice) / listPrice) * 100 : 0;
  const upsideKr = estimat - listPrice;
  const listPpm = c.kvm && listPrice ? listPrice / c.kvm : 0;
  const estimatPpm = c.kvm && estimat ? estimat / c.kvm : 0;

  // Bevis-styrke: kombiner antal comps + stand
  const stand = c.imageAssessment?.overall_condition ?? null;
  const compCount = agg?.count ?? 0;
  let bevis: { color: string; label: string; sub: string };
  if (compCount >= 10 && (stand === null || stand >= 7)) {
    bevis = {
      color: 'emerald',
      label: 'Stærkt bevis',
      sub: `${compCount} friske handler bekræfter${stand ? ` · stand ${stand}/10` : ''}`,
    };
  } else if (compCount >= 5 || (stand !== null && stand >= 6)) {
    bevis = {
      color: 'amber',
      label: 'OK bevis',
      sub: `${compCount} friske handler${stand ? ` · stand ${stand}/10` : ''}`,
    };
  } else {
    bevis = {
      color: 'slate',
      label: 'Tyndt bevis',
      sub: `Kun ${compCount} friske handler${stand ? ` · stand ${stand}/10` : ''}`,
    };
  }

  const bydel = c.bydel ? c.bydel.replace('-', ' ').replace('oe', 'ø').replace('aer', 'ær') : 'København';
  const flags = diagnoseCase(c, agg);

  return (
    <a
      href={`/on-market/${c.id}`}
      className="row-stagger group block rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-[box-shadow,border-color,transform] duration-150 ease-[var(--ease-out)] hover:border-slate-300 hover:shadow-md active:scale-[0.998]"
      style={{ animationDelay: `${Math.min(rank ?? 0, 12) * 30}ms` }}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Venstre: rank + adresse */}
        <div className="flex items-start gap-3">
          {rank !== null && (
            <span className="mt-1 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold tabular-nums text-slate-600">
              #{rank}
            </span>
          )}
          <div>
            <h3 className="text-base font-semibold tracking-tight text-slate-900 group-hover:text-blue-700">
              {c.address}
              {c.topPickOverride && (
                <span className="ml-2 inline-block rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                  📌 pinned
                </span>
              )}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {c.postalCode} {bydel} · {c.kvm} m² · {c.rooms ?? '?'} vær.
              {c.yearBuilt ? ` · opført ${c.yearBuilt}` : ''}
              {c.daysOnMarket ? ` · ${c.daysOnMarket} dage på marked` : ''}
            </p>
          </div>
        </div>

        {/* Højre: bevis-badge */}
        <div
          className={
            'flex-none rounded-md px-2.5 py-1 text-right ' +
            (bevis.color === 'emerald'
              ? 'bg-emerald-50 text-emerald-800'
              : bevis.color === 'amber'
              ? 'bg-amber-50 text-amber-800'
              : 'bg-slate-50 text-slate-600')
          }
        >
          <div className="text-[11px] font-semibold">
            {bevis.color === 'emerald' && '🟢 '}
            {bevis.color === 'amber' && '🟡 '}
            {bevis.color === 'slate' && '⚪ '}
            {bevis.label}
          </div>
          <div className="text-[10px] opacity-75">{bevis.sub}</div>
        </div>
      </div>

      {/* Diagnose-chips — hvad gør casen god/dårlig */}
      <div className="mt-3">
        <DiagnoseChips flags={flags} max={8} />
      </div>

      {/* Midten: udbud → vores estimat → upside */}
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_1.2fr]">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
            Udbud
          </div>
          <div className="mt-1 text-xl font-bold tabular-nums tracking-tight text-slate-900">
            {formatKr(listPrice)}
          </div>
          <div className="mt-0.5 text-[11px] tabular-nums text-slate-400">
            {Math.round(listPpm).toLocaleString('da-DK')} kr/m²
          </div>
        </div>

        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
            Vores estimat
          </div>
          {estimat > 0 ? (
            <>
              <div className="mt-1 text-xl font-bold tabular-nums tracking-tight text-slate-900">
                {formatKr(estimat)}
              </div>
              <div className="mt-0.5 text-[11px] tabular-nums text-slate-400">
                {Math.round(estimatPpm).toLocaleString('da-DK')} kr/m²
              </div>
            </>
          ) : (
            <>
              <div className="mt-1 text-xl font-bold tabular-nums text-slate-300">–</div>
              <div className="mt-0.5 text-[11px] text-amber-600">AVM mangler</div>
            </>
          )}
        </div>

        <div
          className={
            'rounded-lg p-3 ' +
            (estimat === 0
              ? 'bg-slate-50'
              : upsidePct >= 5
              ? 'bg-emerald-50/60'
              : upsidePct >= 0
              ? 'bg-emerald-50/30'
              : 'bg-rose-50/40')
          }
        >
          <div
            className={
              'text-[10px] font-medium uppercase tracking-wider ' +
              (estimat === 0
                ? 'text-slate-400'
                : upsidePct >= 0
                ? 'text-emerald-700'
                : 'text-rose-700')
            }
          >
            {estimat === 0 ? 'Upside' : upsidePct >= 0 ? 'Upside' : 'Negativ'}
          </div>
          <div
            className={
              'mt-1 text-2xl font-bold tabular-nums tracking-tight ' +
              (estimat === 0
                ? 'text-slate-300'
                : upsidePct >= 0
                ? 'text-emerald-700'
                : 'text-rose-700')
            }
          >
            {estimat === 0 ? '–' : `${upsidePct >= 0 ? '+' : ''}${upsidePct.toFixed(1)}%`}
          </div>
          {estimat > 0 && (
            <div
              className={
                'mt-0.5 text-[11px] tabular-nums ' +
                (upsidePct >= 0 ? 'text-emerald-700/70' : 'text-rose-700/70')
              }
            >
              {upsideKr >= 0 ? '+' : ''}
              {formatKr(upsideKr)}
            </div>
          )}
        </div>
      </div>

      {/* Bund: link-cue */}
      <div className="mt-3 flex items-center justify-end text-xs text-slate-400 transition-colors duration-150 ease-[var(--ease-out)] group-hover:text-blue-600">
        Se hele casen
        <span className="ml-1 transition-transform duration-150 ease-[var(--ease-out)] group-hover:translate-x-0.5">→</span>
      </div>
    </a>
  );
}
