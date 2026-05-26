'use client';

import type { DiagnoseFlag, DiagnoseLevel } from '@/lib/diagnose';

/**
 * Viser en række chips med diagnose-flag for en bolig.
 *
 * - `compact`: vis kun de N vigtigste, rest skjules under "+N mere"
 * - `inline`: kompakt række til tabel-rækker
 * - default: fuld række til cards/detail-page
 */
export function DiagnoseChips({
  flags,
  max,
  inline = false,
}: {
  flags: DiagnoseFlag[];
  max?: number;
  inline?: boolean;
}) {
  if (flags.length === 0) return null;
  const visible = max ? flags.slice(0, max) : flags;
  const hidden = max ? flags.slice(max) : [];

  return (
    <div className={inline ? 'flex flex-wrap items-center gap-1' : 'flex flex-wrap items-center gap-1.5'}>
      {visible.map((f, i) => (
        <Chip key={i} flag={f} inline={inline} />
      ))}
      {hidden.length > 0 && (
        <span
          className={
            'inline-flex items-center rounded-md border border-slate-200 bg-white text-slate-500 cursor-help ' +
            (inline ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]')
          }
          title={hidden
            .map((h) => `${h.level === 'fail' ? '✗' : h.level === 'warn' ? '!' : '✓'} ${h.label}: ${h.detail}`)
            .join('\n')}
        >
          +{hidden.length} mere
        </span>
      )}
    </div>
  );
}

function Chip({ flag, inline }: { flag: DiagnoseFlag; inline?: boolean }) {
  const cls = toneClass(flag.level);
  const icon = flag.level === 'pass' ? '✓' : flag.level === 'warn' ? '!' : '✗';
  return (
    <span
      title={flag.detail}
      className={
        'inline-flex items-center gap-1 rounded-md border cursor-help font-medium ' +
        cls +
        (inline ? ' px-1.5 py-0.5 text-[10px]' : ' px-2 py-0.5 text-[11px]')
      }
    >
      <span className="opacity-70">{icon}</span>
      {flag.label}
    </span>
  );
}

function toneClass(level: DiagnoseLevel): string {
  if (level === 'pass') return 'border-emerald-200/70 bg-emerald-50 text-emerald-800';
  if (level === 'warn') return 'border-amber-200/70 bg-amber-50 text-amber-800';
  return 'border-rose-200/70 bg-rose-50 text-rose-800';
}
