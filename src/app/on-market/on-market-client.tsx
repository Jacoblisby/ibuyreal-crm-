'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { OnMarketCandidate, ScrapeJob } from '@/lib/db/schema';
import { curatedScore, pickCurated } from '@/lib/curation';
import { formatKr, formatNum, formatPct } from '@/lib/format';
import { isGroundFloor, passesQualityFilter } from '@/lib/quality';
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

type Preset = 'all' | 'curated' | 'core' | 'fallback';

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
      'Hard gate: ≥1 frisk comp (sidste 5 mdr) solgt ≥ udbud/m² · kvm ≤ 100 · ikke stueetage · ikke hjemfaldspligt · ikke 1950-1990 · ikke støjstreets · positiv α · AVM eller manuel FMV. Rangering: composite-score 0-100. Cap: 15.',
  },
  core: {
    label: 'Core picks',
    desc:
      'AVM/manuel FMV · 50-100 kvm · dage ≥30 · α 0-30% · ikke stueetage · ikke 1950-1990 · ikke støjstreets',
  },
  fallback: { label: 'Mangler AVM', desc: 'Kun cases hvor modellen ikke kunne predicte' },
};

export function OnMarketClient({
  initial,
  lastJob,
  strongFreshMap: strongFreshMapServer,
}: {
  initial: OnMarketCandidate[];
  lastJob: ScrapeJob | null;
  /** Pre-computed server-side: count af strong-fresh-comps (incl. Resight) per kandidat-ID */
  strongFreshMap?: Record<string, number>;
}) {
  const router = useRouter();
  const [rows] = useState(initial);
  const [scraping, setScraping] = useState(false);
  const [s, setS] = useState<State>(DEFAULT_STATE);

  // Beregn preset-counts altid (uafhængigt af andre filtre) til pill-badges.
  // Default skjules stueetage + hjemfaldspligt — kan vises via toggle.
  const isDisqualified = (x: OnMarketCandidate): boolean =>
    isGroundFloor(x.address) || x.hjemfaldspligt === true;
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

  // Single source of truth for "core picks" logic
  const isCorePick = (x: OnMarketCandidate): boolean =>
    (x.v3FmvSource === 'ibuyreal-avm' || x.v3FmvSource === 'manual') &&
    (x.kvm ?? 0) >= 50 &&
    (x.kvm ?? 0) <= 100 &&
    (x.daysOnMarket ?? 0) >= 30 &&
    (x.v3Alpha ?? 0) > 0 &&
    (x.v3Alpha ?? 0) < 0.3 &&
    passesQualityFilter({ address: x.address, yearBuilt: x.yearBuilt });

  const curatedTop20 = useMemo(
    () => pickCurated(activeRows, 15, { strongFreshMap: strongFreshMapServer }),
    [activeRows, strongFreshMapServer],
  );
  const curatedIds = useMemo(() => new Set(curatedTop20.map((x) => x.id)), [curatedTop20]);
  const strongFreshMap = useMemo(() => {
    const m = new Map<string, number>();
    curatedTop20.forEach((x) => m.set(x.id, x.strongFreshCount));
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
      core: activeRows.filter(isCorePick).length,
      fallback: activeRows.filter(
        (x) => x.v3FmvSource !== 'ibuyreal-avm' && x.v3FmvSource !== 'manual',
      ).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    } else if (s.preset === 'core') {
      r = r.filter(isCorePick);
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
        {(['all', 'curated', 'core', 'fallback'] as Preset[]).map((p) => {
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

      {/* Score-forklaring — vises kun for Top picks */}
      {s.preset === 'curated' && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-xs">
          <div className="mb-2 flex items-center gap-2">
            <svg className="h-3.5 w-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span className="font-semibold text-slate-700">
              Score er 0–100 — sum af 5 komponenter
            </span>
            <span className="text-slate-400">(hover en score i tabellen for case-specifik rationale)</span>
          </div>
          <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-5">
            <ScoreLegendItem
              max={25}
              label="AVM signal"
              desc="AVM/manuel FMV-coverage + realistisk alpha (5–20% sweet spot)"
            />
            <ScoreLegendItem
              max={25}
              label="Kvalitet"
              desc="Moderne byggeri (>2000 best), ikke beton 1950–1990, ikke stuen, ikke støjgade"
            />
            <ScoreLegendItem
              max={20}
              label="Data freshness"
              desc="Recent sale + realistisk seller-CAGR (4–8% pa sweet spot)"
            />
            <ScoreLegendItem
              max={15}
              label="Bydel attractiveness"
              desc="Tier A (Indre By/Frb/Østerbro) > Tier B (Vesterbro/Nørrebro) > Tier C (Amager)"
            />
            <ScoreLegendItem
              max={15}
              label="Market signals"
              desc="Sweet-spot dage på marked (30–150) + realistisk best-afkast (18–35%)"
            />
          </div>
          <div className="mt-2 border-t border-slate-200 pt-2 text-slate-500">
            <strong className="text-slate-700">≥70</strong> = strong pick · <strong className="text-slate-700">55–69</strong> = solid · <strong className="text-slate-700">&lt;55</strong> = grænse-case
          </div>
        </div>
      )}

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
          title={`${disqualifiedCount} cases er stueetage eller markeret med hjemfaldspligt — skjult som default`}
        >
          <input
            type="checkbox"
            checked={s.showDisqualified}
            onChange={(e) => setS((p) => ({ ...p, showDisqualified: e.target.checked }))}
            className="h-3.5 w-3.5 cursor-pointer accent-slate-900"
          />
          Vis stuen + hjemfald ({disqualifiedCount})
        </label>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs tabular-nums text-slate-500">
            <span className="font-medium text-slate-700">{filtered.length}</span>
            <span className="text-slate-400"> / {rows.length}</span>
          </span>
          <button
            onClick={() => setS(DEFAULT_STATE)}
            className="rounded-md px-2 py-1 text-xs text-slate-500 transition-colors duration-150 ease-[var(--ease-out)] hover:bg-slate-100 hover:text-slate-900 active:scale-[0.97]"
          >
            Nulstil
          </button>
        </div>
      </div>

      {/* Tabel */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/80 text-left text-[11px] font-medium uppercase tracking-wider text-slate-500">
            <tr>
              {s.preset === 'curated' && (
                <>
                  <th className="px-3 py-2.5 text-right" title="Top-pick score 0-100 baseret på AVM, kvalitet, data-freshness, bydel, market signals">
                    Score
                  </th>
                  <th className="px-3 py-2.5 text-right" title="Antal handler i nær-området sidste 5 mdr solgt ≥ vores udbudspris/m². Hard gate: ≥1 påkrævet for at komme på listen.">
                    Friske comps
                  </th>
                </>
              )}
              <th className="px-3 py-2.5">Adresse</th>
              <th className="px-3 py-2.5">Bydel</th>
              <th className="px-3 py-2.5 text-right">kvm</th>
              <th className="px-3 py-2.5 text-right">vær</th>
              <th className="px-3 py-2.5 text-right">Bygget</th>
              <th className="px-3 py-2.5 text-right">Pris</th>
              <th className="px-3 py-2.5 text-right">kr/m²</th>
              <th className="px-3 py-2.5 text-right">Dage</th>
              <th className="px-3 py-2.5 text-right">FMV</th>
              <th className="px-3 py-2.5 text-right" title="Alpha = (FMV - investeret) / investeret. Positiv = underpriset.">α</th>
              <th className="px-3 py-2.5 text-right" title="Best-case afkast = α + 14.8% beta + Airbnb cf-yield">Best</th>
              <th className="px-3 py-2.5">Mægler</th>
              <th className="px-3 py-2.5">Review</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, idx) => {
              const review = r.reviewStatus as ReviewStatus;
              const importedAlready = !!r.convertedPropertyId;
              return (
                <tr
                  key={r.id}
                  className="row-stagger group border-b border-slate-100 transition-colors duration-100 ease-[var(--ease-out)] last:border-0 hover:bg-slate-50"
                  style={{ animationDelay: `${Math.min(idx, 12) * 25}ms` }}
                >
                  {s.preset === 'curated' && (
                    <>
                      <td className="px-3 py-2.5 text-right">
                        <div
                          className="inline-flex flex-col items-end"
                          title={(scoreMap.get(r.id)?.rationale ?? []).join('\n') + '\n\n' + (scoreMap.get(r.id)?.redFlags.map((f) => '⚠ ' + f).join('\n') ?? '')}
                        >
                          <span
                            className={
                              'tabular-nums text-base font-bold ' +
                              ((scoreMap.get(r.id)?.total ?? 0) >= 70
                                ? 'text-emerald-700'
                                : (scoreMap.get(r.id)?.total ?? 0) >= 55
                                ? 'text-slate-900'
                                : 'text-slate-500')
                            }
                          >
                            {scoreMap.get(r.id)?.total ?? '–'}
                          </span>
                          <span className="text-[10px] text-slate-400">#{idx + 1}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {(() => {
                          const count = strongFreshMap.get(r.id) ?? 0;
                          return (
                            <span
                              className={
                                'inline-block min-w-[28px] rounded-md px-2 py-0.5 text-center tabular-nums text-sm font-semibold ' +
                                (count >= 3
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : count >= 1
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-rose-50 text-rose-700')
                              }
                              title={`${count} handel${count === 1 ? '' : 'er'} sidste 5 mdr ≥ vores udbudspris/m²`}
                            >
                              {count}
                            </span>
                          );
                        })()}
                      </td>
                    </>
                  )}
                  <td className="px-3 py-2.5 font-medium text-slate-900">
                    <a
                      href={`/on-market/${r.id}`}
                      className="rounded-sm decoration-slate-300 decoration-1 underline-offset-2 transition-colors duration-100 ease-[var(--ease-out)] hover:text-blue-700 hover:underline"
                    >
                      {r.address}
                    </a>
                    <div className="text-xs text-slate-400">{r.postalCode} {r.city}</div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">
                    {r.bydel ? BYDEL_LABEL[r.bydel] ?? r.bydel : '–'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatNum(r.kvm)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.rooms ?? '–'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-xs text-slate-500">
                    {r.yearBuilt ?? '–'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatKr(r.listPrice)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-xs text-slate-500">
                    {formatKr(r.perAreaPrice)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-xs text-slate-500">
                    {r.daysOnMarket ?? '–'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                    {r.v3Fmv ? (
                      <span className="inline-flex items-center gap-1">
                        {formatKr(r.v3Fmv)}
                        {r.v3FmvSource === 'manual' && (
                          <span
                            className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500"
                            title="Manuelt sat FMV"
                          />
                        )}
                      </span>
                    ) : (
                      '–'
                    )}
                  </td>
                  <td
                    className={
                      'px-3 py-2.5 text-right tabular-nums font-semibold ' +
                      (r.v3Alpha === null
                        ? 'text-slate-400'
                        : r.v3Alpha > 0.05
                        ? 'text-emerald-700'
                        : r.v3Alpha > 0
                        ? 'text-emerald-600'
                        : 'text-rose-600')
                    }
                  >
                    {r.v3Alpha === null ? '–' : formatPct(r.v3Alpha)}
                  </td>
                  <td
                    className={
                      'px-3 py-2.5 text-right tabular-nums font-semibold ' +
                      (r.v3AfkastBest === null
                        ? 'text-slate-400'
                        : r.v3AfkastBest > 0.2
                        ? 'text-emerald-700'
                        : r.v3AfkastBest > 0
                        ? 'text-emerald-600'
                        : 'text-rose-600')
                    }
                  >
                    {r.v3AfkastBest === null ? '–' : formatPct(r.v3AfkastBest)}
                  </td>
                  <td className="px-3 py-2.5 text-xs capitalize text-slate-500">{r.brokerKind}</td>
                  <td className="px-3 py-2">
                    <select
                      value={review}
                      onChange={(e) => setReview(r.id, e.target.value as ReviewStatus, r.address)}
                      disabled={importedAlready}
                      className={
                        'cursor-pointer appearance-none rounded-full border-0 bg-no-repeat py-1 pl-2.5 pr-7 text-xs font-medium transition-[background-color,transform] duration-150 ease-[var(--ease-out)] hover:brightness-95 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 ' +
                        REVIEW_COLOR[review]
                      }
                      style={{
                        backgroundImage:
                          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")",
                        backgroundPosition: 'right 0.5rem center',
                        backgroundSize: '10px 10px',
                      }}
                    >
                      {(Object.keys(REVIEW_LABEL) as ReviewStatus[]).map((rv) => (
                        <option key={rv} value={rv}>{REVIEW_LABEL[rv]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    {importedAlready ? (
                      <a
                        href={`/cases/${r.convertedPropertyId}`}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-blue-700 transition-colors duration-150 ease-[var(--ease-out)] hover:bg-blue-50 active:scale-[0.97]"
                      >
                        Se case
                        <span aria-hidden="true">→</span>
                      </a>
                    ) : (
                      <button
                        onClick={() => importCandidate(r.id, r.address)}
                        className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white shadow-sm transition-[transform,background-color,box-shadow] duration-150 ease-[var(--ease-out)] hover:bg-slate-800 hover:shadow-md active:scale-[0.94]"
                      >
                        Importér
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={s.preset === 'curated' ? 16 : 14} className="px-3 py-16">
                  <div className="mx-auto flex max-w-sm flex-col items-center gap-3 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" />
                        <path d="m21 21-4.3-4.3" />
                      </svg>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-slate-700">
                        {rows.length === 0 ? 'Ingen scrape-data endnu' : 'Ingen match på filtrene'}
                      </p>
                      <p className="text-xs text-slate-500">
                        {rows.length === 0
                          ? 'Klik "Scrape Boligsiden nu" øverst for at hente listings.'
                          : 'Prøv at justere filtrene eller nulstil dem.'}
                      </p>
                    </div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
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
