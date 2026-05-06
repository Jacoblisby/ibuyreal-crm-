'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Property } from '@/lib/db/schema';
import { formatKr, formatPct } from '@/lib/format';
import { BYDEL_LABEL, STATUS_COLOR, STATUS_LABEL, STATUS_ORDER } from '@/lib/status';
import type { PropertyStatus } from '@/lib/types';

export function Kanban({ initial }: { initial: Property[] }) {
  const [rows, setRows] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<PropertyStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const grouped = STATUS_ORDER.reduce((acc, s) => {
    acc[s] = rows.filter((r) => r.status === s);
    return acc;
  }, {} as Record<PropertyStatus, Property[]>);

  async function moveCard(id: string, newStatus: PropertyStatus) {
    const card = rows.find((r) => r.id === id);
    if (!card || card.status === newStatus) return;
    // Optimistic update
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: newStatus } : r)));
    setBusy(true);
    try {
      const res = await fetch(`/api/properties/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Update fejlede');
    } catch (e) {
      // Revert
      setRows(initial);
      alert(e instanceof Error ? e.message : 'Fejl ved status-skift');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex gap-3 min-w-max">
        {STATUS_ORDER.map((status) => {
          const cards = grouped[status];
          const isOver = dragOver === status;
          return (
            <div
              key={status}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(status);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                if (dragId) moveCard(dragId, status);
                setDragId(null);
              }}
              className={
                'w-72 flex-shrink-0 rounded-lg border-2 transition ' +
                (isOver ? 'border-blue-400 bg-blue-50/50' : 'border-transparent bg-slate-100/60')
              }
            >
              <div className="flex items-center justify-between p-3">
                <span
                  className={'rounded-full px-2.5 py-0.5 text-xs font-medium ' + STATUS_COLOR[status]}
                >
                  {STATUS_LABEL[status]}
                </span>
                <span className="text-xs text-slate-500">{cards.length}</span>
              </div>
              <div className="space-y-2 px-2 pb-2 min-h-[100px]">
                {cards.map((c) => (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={() => setDragId(c.id)}
                    onDragEnd={() => setDragId(null)}
                    className={
                      'rounded-md border border-slate-200 bg-white p-3 text-sm shadow-sm transition ' +
                      (dragId === c.id ? 'opacity-50' : 'hover:shadow-md cursor-grab active:cursor-grabbing')
                    }
                  >
                    <Link href={`/cases/${c.id}`} className="font-medium text-slate-900 hover:text-blue-600">
                      {c.address}
                    </Link>
                    <div className="mt-1 text-xs text-slate-500">
                      {BYDEL_LABEL[c.bydel] ?? c.bydel} · {c.kvm} kvm
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="tabular-nums text-slate-600">{formatKr(c.udbud)}</span>
                      <span className="tabular-nums font-medium text-emerald-700">
                        α {formatPct(c.alpha, 0)}
                      </span>
                    </div>
                    <div className="mt-1 text-right text-xs tabular-nums text-slate-500">
                      best {formatPct(c.afkastBest, 0)}
                    </div>
                  </div>
                ))}
                {cards.length === 0 && (
                  <div className="rounded-md border border-dashed border-slate-300 p-4 text-center text-xs text-slate-400">
                    Træk hertil
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {busy && <div className="mt-2 text-xs text-slate-500">Gemmer...</div>}
    </div>
  );
}
