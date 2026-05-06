'use client';

import { useMemo, useState } from 'react';
import { calculateProperty, maxTilbudspris } from '@/lib/calculator';
import { formatKr, formatNum, formatPct } from '@/lib/format';
import type { Bydel, PropertyStatus, Scenarie } from '@/lib/types';

const BYDELER: { value: Bydel; label: string }[] = [
  { value: 'indre-by', label: 'Indre By' },
  { value: 'vesterbro', label: 'Vesterbro' },
  { value: 'noerrebro', label: 'Nørrebro' },
  { value: 'oesterbro', label: 'Østerbro' },
  { value: 'frederiksberg', label: 'Frederiksberg' },
  { value: 'amager', label: 'Amager' },
];

interface FormState {
  address: string;
  bydel: Bydel;
  postnr: string;
  kvm: string;
  vaer: string;
  bygaar: string;
  udbud: string;
  fmv: string;
  decil: string;
  ejSkat: string;
  ejGrundskyld: string;
  ejFaelles: string;
  ejOvrige: string;
  tilbudPris: string;
}

const DEFAULT_FORM: FormState = {
  address: 'Østergade 11, 3.',
  bydel: 'indre-by',
  postnr: '1100',
  kvm: '89',
  vaer: '3',
  bygaar: '1900',
  udbud: '6995000',
  fmv: '8328964',
  decil: '2',
  ejSkat: '8000',
  ejGrundskyld: '6000',
  ejFaelles: '14000',
  ejOvrige: '2000',
  tilbudPris: '',
};

export function CalculatorClient() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [saved, setSaved] = useState<{ id: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const result = useMemo(() => {
    const kvm = Number(form.kvm) || 0;
    const vaer = Number(form.vaer) || 0;
    const bygaar = form.bygaar ? Number(form.bygaar) : null;
    const udbud = Number(form.udbud) || 0;
    const fmv = Number(form.fmv) || 0;
    const ejTotal =
      (Number(form.ejSkat) || 0) +
      (Number(form.ejGrundskyld) || 0) +
      (Number(form.ejFaelles) || 0) +
      (Number(form.ejOvrige) || 0);
    const tilbudPris = form.tilbudPris ? Number(form.tilbudPris) : undefined;

    if (!kvm || !udbud || !fmv) return null;

    const calc = calculateProperty({
      bydel: form.bydel,
      kvm,
      vaer,
      bygaar,
      udbud,
      fmv,
      ejTotal,
      tilbudPris,
    });
    const max = maxTilbudspris({ bydel: form.bydel, kvm, fmv, ejTotal });
    const afvigelse = (udbud - fmv) / fmv;
    return { calc, max, afvigelse, ejTotal };
  }, [form]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(null);
  }

  async function handleSave() {
    if (!result) return;
    setSaving(true);
    try {
      const res = await fetch('/api/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: form.address,
          bydel: form.bydel,
          postnr: form.postnr || null,
          kvm: Number(form.kvm),
          vaer: Number(form.vaer),
          bygaar: form.bygaar ? Number(form.bygaar) : null,
          udbud: Number(form.udbud),
          fmv: Number(form.fmv),
          decil: form.decil ? Number(form.decil) : null,
          ejSkat: Number(form.ejSkat) || 0,
          ejGrundskyld: Number(form.ejGrundskyld) || 0,
          ejFaelles: Number(form.ejFaelles) || 0,
          ejOvrige: Number(form.ejOvrige) || 0,
          tilbudPris: form.tilbudPris ? Number(form.tilbudPris) : null,
          status: 'screening' satisfies PropertyStatus,
        }),
      });
      if (!res.ok) throw new Error(`Save fejlede: ${res.status}`);
      const data = (await res.json()) as { id: string };
      setSaved(data);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Ukendt fejl ved gem');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[420px_1fr]">
      {/* ─── Venstre: input-form ─── */}
      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Input</h2>

        <Group label="Stamdata">
          <Field label="Adresse">
            <input
              className="form-input"
              value={form.address}
              onChange={(e) => update('address', e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bydel">
              <select
                className="form-input"
                value={form.bydel}
                onChange={(e) => update('bydel', e.target.value as Bydel)}
              >
                {BYDELER.map((b) => (
                  <option key={b.value} value={b.value}>{b.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Postnr">
              <input
                className="form-input"
                value={form.postnr}
                onChange={(e) => update('postnr', e.target.value)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="kvm">
              <input
                type="number"
                className="form-input"
                value={form.kvm}
                onChange={(e) => update('kvm', e.target.value)}
              />
            </Field>
            <Field label="Værelser">
              <input
                type="number"
                className="form-input"
                value={form.vaer}
                onChange={(e) => update('vaer', e.target.value)}
              />
            </Field>
            <Field label="Byggeår">
              <input
                type="number"
                className="form-input"
                value={form.bygaar}
                onChange={(e) => update('bygaar', e.target.value)}
              />
            </Field>
          </div>
        </Group>

        <Group label="Marked + AVM">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Udbudspris (kr)">
              <input
                type="number"
                className="form-input"
                value={form.udbud}
                onChange={(e) => update('udbud', e.target.value)}
              />
            </Field>
            <Field label="AVM FMV (kr)">
              <input
                type="number"
                className="form-input"
                value={form.fmv}
                onChange={(e) => update('fmv', e.target.value)}
              />
            </Field>
            <Field label="Decil (1-10)">
              <input
                type="number"
                className="form-input"
                value={form.decil}
                onChange={(e) => update('decil', e.target.value)}
              />
            </Field>
            <Field label="Tilbudspris (valgfri)">
              <input
                type="number"
                placeholder="Off-market"
                className="form-input"
                value={form.tilbudPris}
                onChange={(e) => update('tilbudPris', e.target.value)}
              />
            </Field>
          </div>
        </Group>

        <Group label="Ejerudgifter (kr/år)">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ejendomsskat">
              <input
                type="number"
                className="form-input"
                value={form.ejSkat}
                onChange={(e) => update('ejSkat', e.target.value)}
              />
            </Field>
            <Field label="Grundskyld">
              <input
                type="number"
                className="form-input"
                value={form.ejGrundskyld}
                onChange={(e) => update('ejGrundskyld', e.target.value)}
              />
            </Field>
            <Field label="Fællesudgift">
              <input
                type="number"
                className="form-input"
                value={form.ejFaelles}
                onChange={(e) => update('ejFaelles', e.target.value)}
              />
            </Field>
            <Field label="Øvrige">
              <input
                type="number"
                className="form-input"
                value={form.ejOvrige}
                onChange={(e) => update('ejOvrige', e.target.value)}
              />
            </Field>
          </div>
          {result && (
            <div className="text-xs text-slate-500">
              Total: <span className="font-medium text-slate-700">{formatKr(result.ejTotal)}/år</span>
            </div>
          )}
        </Group>

        <button
          onClick={handleSave}
          disabled={!result || saving}
          className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Gemmer...' : saved ? '✓ Gemt' : 'Gem som case'}
        </button>
      </section>

      {/* ─── Højre: live output ─── */}
      <section className="space-y-4">
        {!result ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center text-sm text-slate-400">
            Tast kvm, udbud og FMV for at starte beregningen
          </div>
        ) : (
          <>
            {/* Top KPIs */}
            <div className="grid grid-cols-4 gap-3">
              <Kpi label="Alpha" value={formatPct(result.calc.alpha)} accent="emerald" />
              <Kpi label="Afvigelse vs AVM" value={formatPct(result.afvigelse)} />
              <Kpi label="Investeret" value={formatKr(result.calc.investeret)} />
              <Kpi label="Max tilbud (BE)" value={formatKr(result.max)} />
            </div>

            {/* Off-market waterfall */}
            <Panel title="Off-market pris (waterfall)">
              <div className="space-y-1.5 text-sm">
                <Row label="Udbudspris" value={formatKr(result.calc.offMarket.udbud)} />
                <Row label="− Afslag (3%)" value={`-${formatKr(result.calc.offMarket.afslag)}`} muted />
                <Row label="− Conv. fee (2%)" value={`-${formatKr(result.calc.offMarket.convFee)}`} muted />
                <Row label="− Mæglerspar" value={`-${formatKr(result.calc.offMarket.maeglerSpar)}`} muted />
                <Row label="= Off-market pris" value={formatKr(result.calc.offMarket.offMarketPris)} bold />
                <Row label="+ Tx-omkostning" value={formatKr(result.calc.tx)} muted />
                <Row label="= Total investeret" value={formatKr(result.calc.investeret)} bold />
              </div>
            </Panel>

            {/* Airbnb-boks */}
            <Panel title="Airbnb-cashflow (best case)">
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <Stat label="ADR" value={formatKr(result.calc.airbnb.adr)} sub="kr/nat" />
                <Stat label="Belægning" value={`${result.calc.airbnb.occ.toFixed(0)}%`} />
                <Stat label="Bookings/år" value={formatNum(result.calc.airbnb.bookings, 0)} />
                <Stat label="Brutto/år" value={formatKr(result.calc.airbnb.brutto)} />
              </div>
              <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm">
                <Row label="− Platform 15%" value={`-${formatKr(result.calc.airbnb.gebyr)}`} muted />
                <Row label="− Rengøring" value={`-${formatKr(result.calc.airbnb.rengoring)}`} muted />
                <Row label="− Admin 10%" value={`-${formatKr(result.calc.airbnb.admin)}`} muted />
                <Row label="= Net Airbnb" value={formatKr(result.calc.airbnb.netAirbnb)} bold />
              </div>
            </Panel>

            {/* Scenarie-kort */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <ScenarioCard
                label="Worst case"
                desc="Langtidsleje + 0% beta"
                {...result.calc.worst}
              />
              <ScenarioCard
                label="Base case"
                desc="Expat (+30%) + 7% beta"
                {...result.calc.base}
              />
              <ScenarioCard
                label="Best case"
                desc="Airbnb + 14.8% beta"
                {...result.calc.best}
              />
            </div>
          </>
        )}
      </section>

      <style jsx>{`
        :global(.form-input) {
          width: 100%;
          padding: 0.4rem 0.6rem;
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 0.375rem;
          font-size: 0.875rem;
          color: #0f172a;
          outline: none;
          transition: border-color 0.15s;
        }
        :global(.form-input:focus) {
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
        }
      `}</style>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function Kpi({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'emerald';
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div
        className={
          'mt-1 text-lg font-semibold ' + (accent === 'emerald' ? 'text-emerald-600' : 'text-slate-900')
        }
      >
        {value}
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <h3 className="mb-3 text-sm font-semibold text-slate-900">{title}</h3>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  muted,
}: {
  label: string;
  value: string;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={'text-slate-' + (muted ? '500' : '600')}>{label}</span>
      <span className={'tabular-nums ' + (bold ? 'font-semibold text-slate-900' : 'text-slate-700')}>
        {value}
      </span>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 font-semibold text-slate-900">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

interface ScenarioCardProps {
  scenarie: Scenarie;
  label: string;
  desc: string;
  betaPct: number;
  salgspris: number;
  profit: number;
  alpha: number;
  beta: number;
  cfYield: number;
  afkast: number;
}

function ScenarioCard(p: ScenarioCardProps) {
  const accent =
    p.scenarie === 'best'
      ? 'border-emerald-200 bg-emerald-50/50'
      : p.scenarie === 'worst'
      ? 'border-amber-200 bg-amber-50/40'
      : 'border-slate-200 bg-white';
  return (
    <div className={'rounded-lg border p-4 ' + accent}>
      <div className="mb-1 flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-900">{p.label}</div>
        <div className="text-xs text-slate-500">{p.desc}</div>
      </div>
      <div className="mb-3 text-2xl font-bold tabular-nums text-slate-900">
        {formatPct(p.afkast)}
      </div>
      <div className="space-y-1 border-t border-slate-200/60 pt-2 text-xs">
        <Row label="Alpha" value={formatPct(p.alpha)} />
        <Row label={`Beta (${p.betaPct}%)`} value={formatPct(p.beta)} />
        <Row label="CF-yield" value={formatPct(p.cfYield)} />
      </div>
      <div className="mt-3 space-y-1 border-t border-slate-200/60 pt-2 text-xs">
        <Row label="Salgspris" value={formatKr(p.salgspris)} />
        <Row label="Profit" value={formatKr(p.profit)} bold />
      </div>
    </div>
  );
}
