'use client';

import { formatKr } from '@/lib/format';

interface Bar {
  label: string;
  best: number;
  base: number;
  worst: number;
}

export function ProfitChart({ data }: { data: Bar[] }) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => Math.max(d.best, d.base, d.worst)));
  const min = Math.min(0, ...data.map((d) => Math.min(d.best, d.base, d.worst)));
  const range = max - min || 1;

  return (
    <div className="space-y-3">
      {data.map((d) => {
        const pct = (v: number) => ((v - min) / range) * 100;
        const zeroPct = pct(0);
        return (
          <div key={d.label} className="grid grid-cols-[1fr_3fr_auto] items-center gap-3 text-xs">
            <div className="truncate text-slate-700" title={d.label}>{d.label}</div>
            <div className="relative h-6 rounded-md bg-slate-100">
              {/* worst bar (light) */}
              <div
                className="absolute h-2 rounded-sm bg-amber-300/70"
                style={{
                  left: `${Math.min(pct(0), pct(d.worst))}%`,
                  width: `${Math.abs(pct(d.worst) - zeroPct)}%`,
                  top: 0,
                }}
                title={`Worst: ${formatKr(d.worst)}`}
              />
              {/* base bar */}
              <div
                className="absolute h-2 rounded-sm bg-slate-400"
                style={{
                  left: `${Math.min(pct(0), pct(d.base))}%`,
                  width: `${Math.abs(pct(d.base) - zeroPct)}%`,
                  top: '0.5rem',
                }}
                title={`Base: ${formatKr(d.base)}`}
              />
              {/* best bar */}
              <div
                className="absolute h-2 rounded-sm bg-emerald-500"
                style={{
                  left: `${Math.min(pct(0), pct(d.best))}%`,
                  width: `${Math.abs(pct(d.best) - zeroPct)}%`,
                  top: '1rem',
                }}
                title={`Best: ${formatKr(d.best)}`}
              />
              {/* zero line */}
              <div
                className="absolute top-0 h-full w-px bg-slate-300"
                style={{ left: `${zeroPct}%` }}
              />
            </div>
            <div className="text-right tabular-nums text-slate-900">{formatKr(d.best)}</div>
          </div>
        );
      })}
      <div className="flex items-center gap-4 border-t border-slate-100 pt-2 text-xs text-slate-500">
        <Legend color="bg-amber-300/70" label="Worst" />
        <Legend color="bg-slate-400" label="Base" />
        <Legend color="bg-emerald-500" label="Best" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={'inline-block h-2 w-3 rounded-sm ' + color} />
      {label}
    </span>
  );
}
