'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Investor, Property } from '@/lib/db/schema';
import { formatKr, formatPct } from '@/lib/format';

type InvestorWithStats = Investor & { antalEjendomme: number; faktiskDeployed: number };

export function InvestorsClient({
  initial,
  properties,
}: {
  initial: InvestorWithStats[];
  properties: Property[];
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [committed, setCommitted] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch('/api/investors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email: email || null,
          committed: committed ? Number(committed) : null,
        }),
      });
      if (!res.ok) throw new Error('Kunne ikke oprette investor');
      setName('');
      setEmail('');
      setCommitted('');
      setShowForm(false);
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Fejl');
    } finally {
      setBusy(false);
    }
  }

  async function assign(propertyId: string, investorId: string | null) {
    await fetch(`/api/properties/${propertyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ investorId }),
    });
    router.refresh();
  }

  const totalCommitted = initial.reduce((s, i) => s + (i.committed ?? 0), 0);
  const totalDeployed = initial.reduce((s, i) => s + i.faktiskDeployed, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Total committed" value={formatKr(totalCommitted)} />
        <Stat label="Total deployed" value={formatKr(totalDeployed)} />
        <Stat
          label="Allokering"
          value={totalCommitted ? formatPct(totalDeployed / totalCommitted) : '–'}
        />
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">{initial.length} investorer</h3>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          {showForm ? 'Annullér' : '+ Tilføj investor'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={add}
          className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-4"
        >
          <input
            required
            placeholder="Navn"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <input
            type="number"
            placeholder="Committed (kr)"
            value={committed}
            onChange={(e) => setCommitted(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? 'Gemmer...' : 'Gem'}
          </button>
        </form>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Navn</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2 text-right">Committed</th>
              <th className="px-3 py-2 text-right">Deployed (faktisk)</th>
              <th className="px-3 py-2 text-right">Allok %</th>
              <th className="px-3 py-2 text-right">Ejendomme</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {initial.map((inv) => {
              const pct = inv.committed ? inv.faktiskDeployed / inv.committed : null;
              const open = openId === inv.id;
              const owned = properties.filter((p) => p.investorId === inv.id);
              const unassigned = properties.filter((p) => p.investorId === null);
              return (
                <>
                  <tr key={inv.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="px-3 py-2 font-medium text-slate-900">{inv.name}</td>
                    <td className="px-3 py-2 text-slate-600">{inv.email ?? '–'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {inv.committed ? formatKr(inv.committed) : '–'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatKr(inv.faktiskDeployed)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {pct !== null ? formatPct(pct) : '–'}
                    </td>
                    <td className="px-3 py-2 text-right">{inv.antalEjendomme}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => setOpenId(open ? null : inv.id)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        {open ? 'Skjul' : 'Tildel'}
                      </button>
                    </td>
                  </tr>
                  {open && (
                    <tr key={inv.id + '-detail'} className="border-b border-slate-100 bg-slate-50/40">
                      <td colSpan={7} className="px-3 py-3">
                        <div className="space-y-3">
                          <div>
                            <div className="mb-1 text-xs font-medium text-slate-500">
                              Tildelte ejendomme ({owned.length})
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {owned.length === 0 && <span className="text-xs text-slate-400">Ingen</span>}
                              {owned.map((p) => (
                                <button
                                  key={p.id}
                                  onClick={() => assign(p.id, null)}
                                  className="rounded-md bg-white px-2 py-1 text-xs text-slate-700 ring-1 ring-slate-200 hover:bg-rose-50 hover:text-rose-700"
                                  title="Klik for at fjerne tildeling"
                                >
                                  {p.address} ✕
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <div className="mb-1 text-xs font-medium text-slate-500">
                              Ledige ejendomme ({unassigned.length})
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {unassigned.slice(0, 30).map((p) => (
                                <button
                                  key={p.id}
                                  onClick={() => assign(p.id, inv.id)}
                                  className="rounded-md bg-white px-2 py-1 text-xs text-slate-700 ring-1 ring-slate-200 hover:bg-emerald-50 hover:text-emerald-700"
                                >
                                  + {p.address}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
            {initial.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-400">
                  Ingen investorer endnu — tilføj den første.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-xl font-bold tabular-nums text-slate-900">{value}</div>
    </div>
  );
}
