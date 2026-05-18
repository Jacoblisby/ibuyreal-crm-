'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { OnMarketCandidate, ScrapeJob } from '@/lib/db/schema';
import { formatKr, formatNum, formatPct } from '@/lib/format';
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

interface State {
  q: string;
  bydel: string;
  review: '' | ReviewStatus;
  minKvm: string;
  maxKvm: string;
  minPris: string;
  maxPris: string;
  onlyAlpha: boolean;
}

const DEFAULT_STATE: State = {
  q: '',
  bydel: '',
  review: '',
  minKvm: '',
  maxKvm: '',
  minPris: '',
  maxPris: '',
  onlyAlpha: false,
};

export function OnMarketClient({
  initial,
  lastJob,
}: {
  initial: OnMarketCandidate[];
  lastJob: ScrapeJob | null;
}) {
  const router = useRouter();
  const [rows] = useState(initial);
  const [scraping, setScraping] = useState(false);
  const [s, setS] = useState<State>(DEFAULT_STATE);

  const filtered = useMemo(() => {
    let r = rows.filter((x) => x.status === 'active');
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
  }, [rows, s]);

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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="text-sm">
          {lastJob ? (
            <>
              <span className="text-slate-500">Senest scrapet:</span>{' '}
              <span className="font-medium text-slate-900">
                {new Date(lastJob.startedAt).toLocaleString('da-DK')}
              </span>{' '}
              <span className="text-slate-500">
                — {lastJob.scraped} fundet, {lastJob.newListings} nye, status: {lastJob.status}
              </span>
            </>
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

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
        <input
          placeholder="Søg adresse..."
          value={s.q}
          onChange={(e) => setS((p) => ({ ...p, q: e.target.value }))}
          className="rounded-md border border-slate-300 px-2 py-1.5"
        />
        <select
          value={s.bydel}
          onChange={(e) => setS((p) => ({ ...p, bydel: e.target.value }))}
          className="rounded-md border border-slate-300 px-2 py-1.5"
        >
          <option value="">Alle bydele</option>
          {Object.entries(BYDEL_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={s.review}
          onChange={(e) => setS((p) => ({ ...p, review: e.target.value as State['review'] }))}
          className="rounded-md border border-slate-300 px-2 py-1.5"
        >
          <option value="">Alle reviews</option>
          {(Object.keys(REVIEW_LABEL) as ReviewStatus[]).map((r) => (
            <option key={r} value={r}>{REVIEW_LABEL[r]}</option>
          ))}
        </select>
        <span className="text-slate-400">kvm:</span>
        <input
          type="number"
          placeholder="min"
          value={s.minKvm}
          onChange={(e) => setS((p) => ({ ...p, minKvm: e.target.value }))}
          className="w-20 rounded-md border border-slate-300 px-2 py-1.5"
        />
        <input
          type="number"
          placeholder="max"
          value={s.maxKvm}
          onChange={(e) => setS((p) => ({ ...p, maxKvm: e.target.value }))}
          className="w-20 rounded-md border border-slate-300 px-2 py-1.5"
        />
        <span className="text-slate-400">pris (kr):</span>
        <input
          type="number"
          placeholder="min"
          value={s.minPris}
          onChange={(e) => setS((p) => ({ ...p, minPris: e.target.value }))}
          className="w-32 rounded-md border border-slate-300 px-2 py-1.5"
        />
        <input
          type="number"
          placeholder="max"
          value={s.maxPris}
          onChange={(e) => setS((p) => ({ ...p, maxPris: e.target.value }))}
          className="w-32 rounded-md border border-slate-300 px-2 py-1.5"
        />
        <label className="ml-2 inline-flex cursor-pointer items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={s.onlyAlpha}
            onChange={(e) => setS((p) => ({ ...p, onlyAlpha: e.target.checked }))}
          />
          Kun positiv α
        </label>
        <span className="ml-auto text-xs text-slate-500">{filtered.length} af {rows.length} aktive</span>
        <button
          onClick={() => setS(DEFAULT_STATE)}
          className="rounded px-2 py-1 text-xs text-slate-500 transition-colors duration-150 ease-[var(--ease-out)] hover:bg-slate-100 hover:text-slate-900 active:scale-[0.97]"
        >
          Nulstil
        </button>
      </div>

      {/* Tabel */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/80 text-left text-[11px] font-medium uppercase tracking-wider text-slate-500">
            <tr>
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
                    {r.v3Fmv ? formatKr(r.v3Fmv) : '–'}
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
                <td colSpan={14} className="px-3 py-16">
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
