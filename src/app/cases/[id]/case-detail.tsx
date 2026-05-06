'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { calculateProperty, maxTilbudspris } from '@/lib/calculator';
import type { Property } from '@/lib/db/schema';
import { formatKr, formatNum, formatPct } from '@/lib/format';
import { BYDEL_LABEL, STATUS_COLOR, STATUS_LABEL, STATUS_ORDER } from '@/lib/status';
import type { Bydel, PropertyStatus, Scenarie } from '@/lib/types';

export function CaseDetail({ property: initial }: { property: Property }) {
  const router = useRouter();
  const [property, setProperty] = useState(initial);
  const [tilbudPris, setTilbudPris] = useState<string>(
    initial.tilbudPris ? String(initial.tilbudPris) : '',
  );
  const [notes, setNotes] = useState(initial.notes ?? '');
  const [saving, setSaving] = useState(false);

  const tilbud = tilbudPris ? Number(tilbudPris) : undefined;
  const calc = calculateProperty({
    bydel: property.bydel as Bydel,
    kvm: property.kvm,
    vaer: property.vaer,
    bygaar: property.bygaar,
    udbud: property.udbud,
    fmv: property.fmv ?? property.udbud,
    ejTotal: property.ejTotal ?? 0,
    tilbudPris: tilbud,
  });
  const max = maxTilbudspris({
    bydel: property.bydel as Bydel,
    kvm: property.kvm,
    fmv: property.fmv ?? property.udbud,
    ejTotal: property.ejTotal ?? 0,
  });

  async function save(patch: Partial<Property>) {
    setSaving(true);
    try {
      const res = await fetch(`/api/properties/${property.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`Save fejlede: ${res.status}`);
      const updated = (await res.json()) as Property;
      setProperty(updated);
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Ukendt fejl');
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(s: PropertyStatus) {
    await save({ status: s });
  }

  async function saveTilbud() {
    await save({
      tilbudPris: tilbud ?? null,
      tilbudDato: tilbud ? new Date().toISOString() : null,
      status: tilbud && property.status === 'analyseret' ? 'tilbud_sendt' : property.status,
    } as Partial<Property>);
  }

  async function saveNotes() {
    await save({ notes });
  }

  async function generateMail() {
    const subject = `Henvendelse vedr. ${property.address}`;
    const body = [
      `Kære sælger`,
      ``,
      `Vi henvender os vedr. din ejendom på ${property.address}.`,
      `Efter en intern AVM-vurdering vurderer vi en fair markedsværdi på ca. ${formatKr(property.fmv)}.`,
      ``,
      `På baggrund af besparet handelsomkostning ved off-market-salg tillader vi os hermed at byde:`,
      `  ${formatKr(tilbud ?? calc.offMarket.offMarketPris)}`,
      ``,
      `Tilbuddet er gyldigt 7 dage fra modtagelse.`,
      ``,
      `Mvh.`,
      `iBuyReal`,
    ].join('\n');
    await navigator.clipboard.writeText(`Til: \nEmne: ${subject}\n\n${body}`);
    alert('Tilbuds-mail kopieret til clipboard');
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        {/* Stamdata + KPI */}
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Field label="Bydel" value={BYDEL_LABEL[property.bydel] ?? property.bydel} />
            <Field label="kvm" value={`${property.kvm} m²`} />
            <Field label="Værelser" value={String(property.vaer)} />
            <Field label="Byggeår" value={property.bygaar ? String(property.bygaar) : '–'} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Alpha" value={formatPct(calc.alpha)} accent="emerald" />
            <Kpi label="Investeret" value={formatKr(calc.investeret)} />
            <Kpi label="Afvigelse vs AVM" value={formatPct(property.afvigelse)} />
            <Kpi label="Max tilbud (BE)" value={formatKr(max)} />
          </div>
        </div>

        {/* Off-market */}
        <Panel title="Off-market pris (waterfall)">
          <div className="space-y-1.5 text-sm">
            <Row label="Udbudspris" value={formatKr(calc.offMarket.udbud)} />
            <Row label="− Afslag" value={`-${formatKr(calc.offMarket.afslag)}`} muted />
            <Row label="− Conv. fee" value={`-${formatKr(calc.offMarket.convFee)}`} muted />
            <Row label="− Mæglerspar" value={`-${formatKr(calc.offMarket.maeglerSpar)}`} muted />
            <Row label="Off-market pris" value={formatKr(calc.offMarket.offMarketPris)} bold />
            <Row label="+ Tx" value={formatKr(calc.tx)} muted />
            <Row label="Total investeret" value={formatKr(calc.investeret)} bold />
          </div>
        </Panel>

        {/* Scenario cards */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <ScenarioCard label="Worst case" scenarie="worst" data={calc.worst} desc="Langtidsleje + 0% beta" />
          <ScenarioCard label="Base case" scenarie="base" data={calc.base} desc="Expat (+30%) + 7% beta" />
          <ScenarioCard label="Best case" scenarie="best" data={calc.best} desc="Airbnb + 14.8% beta" />
        </div>

        {/* Notes */}
        <Panel title="Noter">
          <textarea
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            placeholder="Egne noter til denne case..."
          />
          <button
            onClick={saveNotes}
            disabled={saving}
            className="mt-2 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Gem noter
          </button>
        </Panel>
      </div>

      {/* Højre: status + tilbud */}
      <div className="space-y-4">
        <Panel title="Status">
          <div className="space-y-1">
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                onClick={() => changeStatus(s)}
                disabled={saving || property.status === s}
                className={
                  'flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition ' +
                  (property.status === s
                    ? STATUS_COLOR[s] + ' font-medium'
                    : 'hover:bg-slate-50 text-slate-700')
                }
              >
                <span>{STATUS_LABEL[s]}</span>
                {property.status === s && <span>✓</span>}
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Tilbudsmodul">
          <div className="space-y-2 text-sm">
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">Tilbudspris (kr)</span>
              <input
                type="number"
                placeholder={String(Math.round(calc.offMarket.offMarketPris))}
                value={tilbudPris}
                onChange={(e) => setTilbudPris(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
              <span className="mt-1 block text-xs text-slate-400">
                Standard off-market: {formatKr(calc.offMarket.offMarketPris)}
              </span>
              <span className="block text-xs text-slate-400">
                Break-even worst: {formatKr(max)}
              </span>
            </label>
            <button
              onClick={saveTilbud}
              disabled={saving}
              className="w-full rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? 'Gemmer...' : 'Gem tilbud'}
            </button>
            <button
              onClick={generateMail}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Generér tilbuds-mail
            </button>
          </div>
        </Panel>

        <Panel title="Marked">
          <div className="space-y-1.5 text-sm">
            <Row label="Udbud" value={formatKr(property.udbud)} />
            <Row label="FMV (AVM)" value={formatKr(property.fmv)} />
            <Row label="Decil" value={property.decil ? `${property.decil}/10` : '–'} />
            <Row label="Dage" value={property.dage ? formatNum(property.dage) : '–'} />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 font-medium text-slate-900">{value}</div>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: 'emerald' }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={'mt-0.5 text-base font-semibold ' + (accent === 'emerald' ? 'text-emerald-600' : 'text-slate-900')}>
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

function ScenarioCard({
  label,
  scenarie,
  desc,
  data,
}: {
  label: string;
  scenarie: Scenarie;
  desc: string;
  data: { afkast: number; alpha: number; beta: number; cfYield: number; salgspris: number; profit: number; betaPct: number };
}) {
  const accent =
    scenarie === 'best'
      ? 'border-emerald-200 bg-emerald-50/50'
      : scenarie === 'worst'
      ? 'border-amber-200 bg-amber-50/40'
      : 'border-slate-200 bg-white';
  return (
    <div className={'rounded-lg border p-4 ' + accent}>
      <div className="mb-1 flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-900">{label}</div>
        <div className="text-xs text-slate-500">{desc}</div>
      </div>
      <div className="mb-3 text-2xl font-bold tabular-nums text-slate-900">{formatPct(data.afkast)}</div>
      <div className="space-y-1 border-t border-slate-200/60 pt-2 text-xs">
        <Row label="Alpha" value={formatPct(data.alpha)} />
        <Row label={`Beta (${data.betaPct}%)`} value={formatPct(data.beta)} />
        <Row label="CF-yield" value={formatPct(data.cfYield)} />
      </div>
      <div className="mt-3 space-y-1 border-t border-slate-200/60 pt-2 text-xs">
        <Row label="Salgspris" value={formatKr(data.salgspris)} />
        <Row label="Profit" value={formatKr(data.profit)} bold />
      </div>
    </div>
  );
}
