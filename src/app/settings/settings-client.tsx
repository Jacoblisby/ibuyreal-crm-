'use client';

import { useMemo, useState } from 'react';
import { calculateProperty } from '@/lib/calculator';
import { rowToAssumptions } from '@/lib/assumptions';
import type { AssumptionsRow, Property } from '@/lib/db/schema';
import { formatKr, formatPct } from '@/lib/format';
import type { Bydel } from '@/lib/types';

const FIELDS: { key: keyof AssumptionsRow; label: string; group: string; suffix?: string }[] = [
  // ADR
  { key: 'adrIndreby', label: 'Indre By', group: 'Airbnb base ADR (kr/nat)', suffix: 'kr' },
  { key: 'adrVesterbro', label: 'Vesterbro', group: 'Airbnb base ADR (kr/nat)', suffix: 'kr' },
  { key: 'adrNoerrebro', label: 'Nørrebro', group: 'Airbnb base ADR (kr/nat)', suffix: 'kr' },
  { key: 'adrOsterbro', label: 'Østerbro', group: 'Airbnb base ADR (kr/nat)', suffix: 'kr' },
  { key: 'adrFrederiksberg', label: 'Frederiksberg', group: 'Airbnb base ADR (kr/nat)', suffix: 'kr' },
  { key: 'adrAmager', label: 'Amager', group: 'Airbnb base ADR (kr/nat)', suffix: 'kr' },
  // OCC
  { key: 'occIndreby', label: 'Indre By', group: 'Belægning (%)', suffix: '%' },
  { key: 'occVesterbro', label: 'Vesterbro', group: 'Belægning (%)', suffix: '%' },
  { key: 'occNoerrebro', label: 'Nørrebro', group: 'Belægning (%)', suffix: '%' },
  { key: 'occOsterbro', label: 'Østerbro', group: 'Belægning (%)', suffix: '%' },
  { key: 'occFrederiksberg', label: 'Frederiksberg', group: 'Belægning (%)', suffix: '%' },
  { key: 'occAmager', label: 'Amager', group: 'Belægning (%)', suffix: '%' },
  // Langtidsleje
  { key: 'ltIndreby', label: 'Indre By', group: 'Langtidsleje (kr/m²/mdr)', suffix: 'kr' },
  { key: 'ltOsterbro', label: 'Østerbro', group: 'Langtidsleje (kr/m²/mdr)', suffix: 'kr' },
  { key: 'ltNoerrebro', label: 'Nørrebro', group: 'Langtidsleje (kr/m²/mdr)', suffix: 'kr' },
  { key: 'ltVesterbro', label: 'Vesterbro', group: 'Langtidsleje (kr/m²/mdr)', suffix: 'kr' },
  { key: 'ltFrederiksberg', label: 'Frederiksberg', group: 'Langtidsleje (kr/m²/mdr)', suffix: 'kr' },
  { key: 'ltAmager', label: 'Amager', group: 'Langtidsleje (kr/m²/mdr)', suffix: 'kr' },
  // Room
  { key: 'roomStudio', label: 'Studio', group: 'Room factor' },
  { key: 'room1v', label: '1 vær', group: 'Room factor' },
  { key: 'room2v', label: '2 vær', group: 'Room factor' },
  { key: 'room3v', label: '3 vær', group: 'Room factor' },
  { key: 'room4v', label: '4+ vær', group: 'Room factor' },
  // Stand
  { key: 'standLuksus', label: 'Luksus (≥2015)', group: 'Stand factor' },
  { key: 'standGod', label: 'God (≥1850)', group: 'Stand factor' },
  { key: 'standAeldre', label: 'Ældre (<1850)', group: 'Stand factor' },
  // Expenses
  { key: 'platformPct', label: 'Platform', group: 'Airbnb-omkostninger', suffix: '%' },
  { key: 'rengoringKr', label: 'Rengøring/booking', group: 'Airbnb-omkostninger', suffix: 'kr' },
  { key: 'naetterPerBooking', label: 'Nætter/booking', group: 'Airbnb-omkostninger' },
  { key: 'adminPct', label: 'Admin', group: 'Airbnb-omkostninger', suffix: '%' },
  // Off-market
  { key: 'afslagPct', label: 'Afslag', group: 'Off-market', suffix: '%' },
  { key: 'convFeePct', label: 'Conv. fee', group: 'Off-market', suffix: '%' },
  { key: 'maeglerSparKr', label: 'Mæglerspar', group: 'Off-market', suffix: 'kr' },
  // Tx
  { key: 'txFastKr', label: 'Fast', group: 'Transaktion', suffix: 'kr' },
  { key: 'txPct', label: 'Variabel', group: 'Transaktion', suffix: '%' },
  // Beta
  { key: 'betaWorst', label: 'Worst', group: 'Beta scenarier', suffix: '%' },
  { key: 'betaBase', label: 'Base', group: 'Beta scenarier', suffix: '%' },
  { key: 'betaBest', label: 'Best', group: 'Beta scenarier', suffix: '%' },
];

export function SettingsClient({
  assumptions,
  cases,
}: {
  assumptions: AssumptionsRow;
  cases: Property[];
}) {
  const [draft, setDraft] = useState<AssumptionsRow>(assumptions);
  const [original] = useState<AssumptionsRow>(assumptions);
  const [previewId, setPreviewId] = useState<string>(cases[0]?.id ?? '');
  const [saving, setSaving] = useState(false);

  const dirty = useMemo(() => {
    return Object.keys(draft).some((k) => {
      const a = draft[k as keyof AssumptionsRow];
      const b = original[k as keyof AssumptionsRow];
      if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) > 1e-9;
      return false;
    });
  }, [draft, original]);

  const previewCase = cases.find((c) => c.id === previewId);
  const previewBefore = previewCase
    ? calculateProperty(
        {
          bydel: previewCase.bydel as Bydel,
          kvm: previewCase.kvm,
          vaer: previewCase.vaer,
          bygaar: previewCase.bygaar,
          udbud: previewCase.udbud,
          fmv: previewCase.fmv ?? previewCase.udbud,
          ejTotal: previewCase.ejTotal ?? 0,
        },
        rowToAssumptions(original),
      )
    : null;
  const previewAfter = previewCase
    ? calculateProperty(
        {
          bydel: previewCase.bydel as Bydel,
          kvm: previewCase.kvm,
          vaer: previewCase.vaer,
          bygaar: previewCase.bygaar,
          udbud: previewCase.udbud,
          fmv: previewCase.fmv ?? previewCase.udbud,
          ejTotal: previewCase.ejTotal ?? 0,
        },
        rowToAssumptions(draft),
      )
    : null;

  function update(key: keyof AssumptionsRow, value: string) {
    const n = parseFloat(value);
    setDraft((d) => ({ ...d, [key]: Number.isFinite(n) ? n : 0 }));
  }

  async function save() {
    setSaving(true);
    try {
      // Sender hele draft (bortset fra id/updatedAt)
      const { id: _i, updatedAt: _u, ...rest } = draft;
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rest),
      });
      if (!res.ok) throw new Error('Save fejlede');
      alert('Assumptions gemt');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Fejl');
    } finally {
      setSaving(false);
    }
  }

  // Group fields
  const groups: Record<string, typeof FIELDS> = {};
  for (const f of FIELDS) {
    if (!groups[f.group]) groups[f.group] = [];
    groups[f.group].push(f);
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        {Object.entries(groups).map(([groupName, fields]) => (
          <div key={groupName} className="rounded-lg border border-slate-200 bg-white p-5">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">{groupName}</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {fields.map((f) => {
                const val = draft[f.key] as number;
                const orig = original[f.key] as number;
                const changed = Math.abs(val - orig) > 1e-9;
                return (
                  <label key={String(f.key)} className="block">
                    <span className="mb-1 block text-xs text-slate-500">{f.label}</span>
                    <div className="relative">
                      <input
                        type="number"
                        step="any"
                        value={val}
                        onChange={(e) => update(f.key, e.target.value)}
                        className={
                          'w-full rounded-md border px-2 py-1.5 text-sm tabular-nums focus:outline-none ' +
                          (changed
                            ? 'border-amber-400 bg-amber-50/50 pr-8'
                            : 'border-slate-300 bg-white')
                        }
                      />
                      {f.suffix && (
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                          {f.suffix}
                        </span>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        ))}

        <div className="flex items-center gap-2">
          <button
            disabled={!dirty || saving}
            onClick={save}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? 'Gemmer...' : dirty ? 'Gem ændringer' : 'Ingen ændringer'}
          </button>
          {dirty && (
            <button
              onClick={() => setDraft(original)}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Nulstil
            </button>
          )}
        </div>
      </div>

      {/* Live preview */}
      <div className="space-y-3">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Live preview</h3>
          <select
            value={previewId}
            onChange={(e) => setPreviewId(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            {cases.map((c) => (
              <option key={c.id} value={c.id}>{c.address}</option>
            ))}
          </select>
          {previewCase && previewBefore && previewAfter && (
            <div className="mt-4 space-y-3 text-sm">
              <CompareRow
                label="Alpha"
                before={previewBefore.alpha}
                after={previewAfter.alpha}
                fmt="pct"
              />
              <CompareRow
                label="Worst afkast"
                before={previewBefore.worst.afkast}
                after={previewAfter.worst.afkast}
                fmt="pct"
              />
              <CompareRow
                label="Base afkast"
                before={previewBefore.base.afkast}
                after={previewAfter.base.afkast}
                fmt="pct"
              />
              <CompareRow
                label="Best afkast"
                before={previewBefore.best.afkast}
                after={previewAfter.best.afkast}
                fmt="pct"
              />
              <hr className="border-slate-100" />
              <CompareRow
                label="Net Airbnb"
                before={previewBefore.airbnb.netAirbnb}
                after={previewAfter.airbnb.netAirbnb}
                fmt="kr"
              />
              <CompareRow
                label="Off-market pris"
                before={previewBefore.offMarket.offMarketPris}
                after={previewAfter.offMarket.offMarketPris}
                fmt="kr"
              />
              <CompareRow
                label="Best profit"
                before={previewBefore.best.profit}
                after={previewAfter.best.profit}
                fmt="kr"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CompareRow({
  label,
  before,
  after,
  fmt,
}: {
  label: string;
  before: number;
  after: number;
  fmt: 'pct' | 'kr';
}) {
  const diff = after - before;
  const fmtFn = fmt === 'pct' ? (n: number) => formatPct(n) : (n: number) => formatKr(n);
  const changed = Math.abs(diff) > (fmt === 'pct' ? 1e-5 : 1);
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="tabular-nums text-slate-700">{fmtFn(before)}</span>
      <span
        className={
          'min-w-[72px] text-right tabular-nums ' +
          (!changed ? 'text-slate-400' : diff > 0 ? 'font-semibold text-emerald-600' : 'font-semibold text-rose-600')
        }
      >
        {changed ? `→ ${fmtFn(after)}` : '–'}
      </span>
    </div>
  );
}
