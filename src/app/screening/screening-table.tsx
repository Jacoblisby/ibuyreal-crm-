'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { Property } from '@/lib/db/schema';
import { formatKr, formatNum, formatPct } from '@/lib/format';
import { BYDEL_LABEL, STATUS_COLOR, STATUS_LABEL } from '@/lib/status';
import type { PropertyStatus } from '@/lib/types';

type SortKey = 'address' | 'bydel' | 'kvm' | 'udbud' | 'fmv' | 'afvigelse' | 'alpha' | 'afkastBest';

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'address', label: 'Adresse' },
  { key: 'bydel', label: 'Bydel' },
  { key: 'kvm', label: 'kvm', numeric: true },
  { key: 'udbud', label: 'Udbud', numeric: true },
  { key: 'fmv', label: 'FMV', numeric: true },
  { key: 'afvigelse', label: 'Afvigelse', numeric: true },
  { key: 'alpha', label: 'Alpha', numeric: true },
  { key: 'afkastBest', label: 'Best', numeric: true },
];

const BYDEL_OPTS = ['', 'indre-by', 'vesterbro', 'noerrebro', 'oesterbro', 'frederiksberg', 'amager'];

interface State {
  q: string;
  bydel: string;
  status: '' | PropertyStatus;
  minKvm: string;
  maxKvm: string;
  minAfvigelse: string;
  maxAfvigelse: string;
  sort: SortKey;
  dir: 'asc' | 'desc';
}

const DEFAULT_STATE: State = {
  q: '',
  bydel: '',
  status: '',
  minKvm: '',
  maxKvm: '',
  minAfvigelse: '',
  maxAfvigelse: '',
  sort: 'alpha',
  dir: 'desc',
};

export function ScreeningTable({ rows }: { rows: Property[] }) {
  const [s, setS] = useState<State>(DEFAULT_STATE);

  const filtered = useMemo(() => {
    let r = rows;
    if (s.q) {
      const q = s.q.toLowerCase();
      r = r.filter((row) => row.address.toLowerCase().includes(q));
    }
    if (s.bydel) r = r.filter((row) => row.bydel === s.bydel);
    if (s.status) r = r.filter((row) => row.status === s.status);
    const minKvm = Number(s.minKvm);
    const maxKvm = Number(s.maxKvm);
    if (s.minKvm) r = r.filter((row) => row.kvm >= minKvm);
    if (s.maxKvm) r = r.filter((row) => row.kvm <= maxKvm);
    const minAfv = Number(s.minAfvigelse);
    const maxAfv = Number(s.maxAfvigelse);
    if (s.minAfvigelse) r = r.filter((row) => (row.afvigelse ?? 0) * 100 >= minAfv);
    if (s.maxAfvigelse) r = r.filter((row) => (row.afvigelse ?? 0) * 100 <= maxAfv);

    const sorted = [...r].sort((a, b) => {
      const av = a[s.sort];
      const bv = b[s.sort];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'string' && typeof bv === 'string') {
        return s.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return s.dir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return sorted;
  }, [rows, s]);

  function toggleSort(k: SortKey) {
    setS((p) => ({
      ...p,
      sort: k,
      dir: p.sort === k && p.dir === 'desc' ? 'asc' : 'desc',
    }));
  }

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
        <input
          placeholder="Søg adresse..."
          value={s.q}
          onChange={(e) => setS((p) => ({ ...p, q: e.target.value }))}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        />
        <select
          value={s.bydel}
          onChange={(e) => setS((p) => ({ ...p, bydel: e.target.value }))}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        >
          {BYDEL_OPTS.map((b) => (
            <option key={b} value={b}>
              {b ? BYDEL_LABEL[b] : 'Alle bydele'}
            </option>
          ))}
        </select>
        <select
          value={s.status}
          onChange={(e) => setS((p) => ({ ...p, status: e.target.value as State['status'] }))}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        >
          <option value="">Alle statusser</option>
          {(Object.keys(STATUS_LABEL) as PropertyStatus[]).map((st) => (
            <option key={st} value={st}>
              {STATUS_LABEL[st]}
            </option>
          ))}
        </select>
        <span className="text-slate-400">kvm:</span>
        <input
          type="number"
          placeholder="min"
          value={s.minKvm}
          onChange={(e) => setS((p) => ({ ...p, minKvm: e.target.value }))}
          className="w-20 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <input
          type="number"
          placeholder="max"
          value={s.maxKvm}
          onChange={(e) => setS((p) => ({ ...p, maxKvm: e.target.value }))}
          className="w-20 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <span className="text-slate-400">afvigelse %:</span>
        <input
          type="number"
          placeholder="min"
          value={s.minAfvigelse}
          onChange={(e) => setS((p) => ({ ...p, minAfvigelse: e.target.value }))}
          className="w-20 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <input
          type="number"
          placeholder="max"
          value={s.maxAfvigelse}
          onChange={(e) => setS((p) => ({ ...p, maxAfvigelse: e.target.value }))}
          className="w-20 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <button
          onClick={() => setS(DEFAULT_STATE)}
          className="ml-auto text-xs text-slate-500 hover:text-slate-900"
        >
          Nulstil
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  className={
                    'cursor-pointer px-3 py-2 select-none hover:text-slate-900 ' +
                    (c.numeric ? 'text-right' : '')
                  }
                >
                  {c.label}
                  {s.sort === c.key && (
                    <span className="ml-1 text-slate-400">{s.dir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </th>
              ))}
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                <td className="px-3 py-2 font-medium">
                  <Link href={`/cases/${r.id}`} className="text-slate-900 hover:text-blue-600">
                    {r.address}
                  </Link>
                </td>
                <td className="px-3 py-2 text-slate-600">{BYDEL_LABEL[r.bydel] ?? r.bydel}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatNum(r.kvm)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatKr(r.udbud)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatKr(r.fmv)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-rose-600">
                  {formatPct(r.afvigelse, 1)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium text-emerald-700">
                  {formatPct(r.alpha)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">
                  {formatPct(r.afkastBest)}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={
                      'rounded-full px-2 py-0.5 text-xs ' +
                      (STATUS_COLOR[r.status as PropertyStatus] ?? 'bg-slate-100 text-slate-600')
                    }
                  >
                    {STATUS_LABEL[r.status as PropertyStatus] ?? r.status}
                  </span>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-sm text-slate-400">
                  Ingen cases matcher filtrene.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
