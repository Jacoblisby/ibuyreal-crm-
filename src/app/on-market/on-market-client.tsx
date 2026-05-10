'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { formatKr, formatNum, formatPct } from '@/lib/format';
import type { OnMarketListingRow } from '@/lib/on-market';
import { bydelFromPostnr } from '@/lib/postnumre';
import { BYDEL_LABEL } from '@/lib/status';

type ReviewStatus = 'new' | 'interested' | 'passed' | 'imported';

const REVIEW_LABEL: Record<ReviewStatus, string> = {
  new: 'New',
  interested: 'Interested',
  passed: 'Passed',
  imported: 'Imported',
};

const REVIEW_COLOR: Record<ReviewStatus, string> = {
  new: 'bg-slate-100 text-slate-700',
  interested: 'bg-emerald-100 text-emerald-700',
  passed: 'bg-rose-100 text-rose-700',
  imported: 'bg-blue-100 text-blue-700',
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
}: {
  initial: OnMarketListingRow[];
}) {
  const router = useRouter();
  const [rows] = useState(initial);
  const [s, setS] = useState<State>(DEFAULT_STATE);

  function displayAddress(address: string | null): string {
    if (!address) return 'Unknown address';
    return address.replace(/\s*,?\s*\d{4}\s+.+$/u, '').trim();
  }

  const filtered = useMemo(() => {
    let r = rows.filter((x) => x.status === 'active');
    if (s.q) {
      const q = s.q.toLowerCase();
      r = r.filter((x) => (x.address ?? '').toLowerCase().includes(q));
    }
    if (s.bydel) {
      r = r.filter((x) => bydelFromPostnr(x.postalCode) === s.bydel);
    }
    if (s.review) r = r.filter((x) => x.reviewType === s.review);
    if (s.minKvm) r = r.filter((x) => (x.kvm ?? 0) >= Number(s.minKvm));
    if (s.maxKvm) r = r.filter((x) => (x.kvm ?? 0) <= Number(s.maxKvm));
    if (s.minPris) r = r.filter((x) => (x.listPrice ?? 0) >= Number(s.minPris));
    if (s.maxPris) r = r.filter((x) => (x.listPrice ?? 0) <= Number(s.maxPris));
    if (s.onlyAlpha) r = r.filter((x) => (x.marketSpread ?? 0) > 0);
    return r;
  }, [rows, s]);

  async function setReview(id: string, review: ReviewStatus) {
    await fetch(`/api/on-market/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewType: review }),
    });
    router.refresh();
  }

  async function importCandidate(id: string) {
    if (!confirm('Import to pipeline as new screening case?')) return;
    const res = await fetch(`/api/on-market/${id}/import`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error ?? 'Import failed');
      return;
    }
    const data = (await res.json()) as { propertyId: string };
    if (confirm('Imported. Open case now?')) {
      router.push(`/cases/${data.propertyId}`);
    } else {
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
        <input
          placeholder="Search address..."
          value={s.q}
          onChange={(e) => setS((p) => ({ ...p, q: e.target.value }))}
          className="rounded-md border border-slate-300 px-2 py-1.5"
        />
        <select
          value={s.bydel}
          onChange={(e) => setS((p) => ({ ...p, bydel: e.target.value }))}
          className="rounded-md border border-slate-300 px-2 py-1.5"
        >
          <option value="">All neighborhoods</option>
          {Object.entries(BYDEL_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={s.review}
          onChange={(e) => setS((p) => ({ ...p, review: e.target.value as State['review'] }))}
          className="rounded-md border border-slate-300 px-2 py-1.5"
        >
          <option value="">All reviews</option>
          {(Object.keys(REVIEW_LABEL) as ReviewStatus[]).map((r) => (
            <option key={r} value={r}>{REVIEW_LABEL[r]}</option>
          ))}
        </select>
        <span className="text-slate-400">sqm:</span>
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
        <span className="text-slate-400">price (kr):</span>
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
          Only positive spread
        </label>
        <span className="ml-auto text-xs text-slate-500">{filtered.length} of {rows.length} active</span>
        <button
          onClick={() => setS(DEFAULT_STATE)}
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          Reset
        </button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Address</th>
              <th className="px-3 py-2 text-right">sqm</th>
              <th className="px-3 py-2 text-right">rooms</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2 text-right">Days</th>
              <th className="px-3 py-2 text-right">Prediction</th>
              <th className="px-3 py-2 text-right" title="Spread = (prediction - invested) / invested. Positive = underpriced.">Spread</th>
              <th className="px-3 py-2 text-right" title="Best-case return = spread + configured best beta">Best Ret.</th>
              <th className="px-3 py-2">Review</th>
              <th className="px-3 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const review = r.reviewType as ReviewStatus;
              const importedAlready = false;
              return (
                <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                  <td className="px-3 py-2 font-medium text-slate-900">
                    <a href={`/on-market/${r.id}`} className="hover:text-blue-600">
                      {displayAddress(r.address)}
                    </a>
                    <div className="text-xs text-slate-400">{r.postalCode} {r.city}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNum(r.kvm)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.rooms ?? '–'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatKr(r.listPrice)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-500">
                    {r.daysOnMarket ?? '–'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">
                    {r.prediction ? formatKr(r.prediction) : '–'}
                  </td>
                  <td
                    className={
                      'px-3 py-2 text-right tabular-nums font-medium ' +
                      (r.marketSpread === null
                        ? 'text-slate-400'
                        : r.marketSpread > 0
                        ? 'text-emerald-700'
                        : 'text-rose-600')
                    }
                  >
                    {r.marketSpread === null ? '–' : formatPct(r.marketSpread)}
                  </td>
                  <td
                    className={
                      'px-3 py-2 text-right tabular-nums font-medium ' +
                      (r.returnBestCase === null
                        ? 'text-slate-400'
                        : r.returnBestCase > 0
                        ? 'text-emerald-700'
                        : 'text-rose-600')
                    }
                  >
                    {r.returnBestCase === null ? '–' : formatPct(r.returnBestCase)}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={review}
                      onChange={(e) => setReview(r.id, e.target.value as ReviewStatus)}
                      disabled={importedAlready}
                      className={
                        'rounded-md border-0 px-2 py-1 text-xs font-medium ' + REVIEW_COLOR[review]
                      }
                    >
                      {(Object.keys(REVIEW_LABEL) as ReviewStatus[]).map((rv) => (
                        <option key={rv} value={rv}>{REVIEW_LABEL[rv]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => importCandidate(r.id)}
                      className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800"
                    >
                      Import
                    </button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-12 text-center text-sm text-slate-400">
                  {rows.length === 0
                    ? 'No on-market candidates available.'
                    : 'No candidates match your filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
