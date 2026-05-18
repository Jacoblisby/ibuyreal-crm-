'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  calculateProperty,
  getRoomFactor,
  getStandFactor,
  maxTilbudspris,
} from '@/lib/calculator';
import { DEFAULT_ANTAGELSER } from '@/lib/constants';
import type { OnMarketCandidate } from '@/lib/db/schema';
import { formatKr, formatNum, formatPct } from '@/lib/format';
import { BYDEL_LABEL } from '@/lib/status';
import type { Bydel, Scenarie } from '@/lib/types';

type Review = 'ny' | 'interesseret' | 'passet' | 'importeret';

const REVIEW_LABEL: Record<Review, string> = {
  ny: 'Ny',
  interesseret: 'Interesseret',
  passet: 'Passet',
  importeret: 'Importeret',
};

const REVIEW_COLOR: Record<Review, string> = {
  ny: 'bg-slate-100 text-slate-700',
  interesseret: 'bg-emerald-100 text-emerald-700',
  passet: 'bg-rose-100 text-rose-700',
  importeret: 'bg-blue-100 text-blue-700',
};

interface InputState {
  // Pris (de største håndtag)
  fmv: string;
  tilbudPris: string;
  // Ejerudgifter (kr/år)
  ejSkat: string;
  ejGrundskyld: string;
  ejFaelles: string;
  ejOvrige: string;
  // Udlejnings-overrides (tom = brug bydel-default)
  adr: string;          // kr/nat — slutlig ADR efter room+stand
  occ: string;          // %
  ltRate: string;       // kr/m²/måned
  // Markedsudvikling (% — beta per scenarie)
  betaWorst: string;
  betaBase: string;
  betaBest: string;
}

function buildInitialInputs(c: OnMarketCandidate): InputState {
  const yearlyFaelles = c.monthlyExpense ? Math.round(c.monthlyExpense * 12) : 0;
  return {
    fmv: String(c.listPrice ?? 0), // FMV = list price indtil XGBoost-AVM
    tilbudPris: String(c.listPrice ?? 0),
    ejSkat: '0',
    ejGrundskyld: '0',
    ejFaelles: String(yearlyFaelles),
    ejOvrige: '0',
    adr: '',
    occ: '',
    ltRate: '',
    betaWorst: '',
    betaBase: '',
    betaBest: '',
  };
}

export function CandidateDetail({ candidate: initial }: { candidate: OnMarketCandidate }) {
  const router = useRouter();
  const [c, setC] = useState(initial);
  const [activeImg, setActiveImg] = useState(0);
  const [busy, setBusy] = useState(false);

  const initialInputs = useMemo(() => buildInitialInputs(c), [c]);
  const [form, setForm] = useState<InputState>(initialInputs);

  const bydel = (c.bydel ?? 'indre-by') as Bydel;

  // Facts fra scrape (ikke editable)
  const kvm = c.kvm ?? 0;
  const vaer = c.rooms ?? 2;
  const bygaar = c.yearBuilt;
  const udbud = c.listPrice ?? 0;

  // Live-beregning. Bygger en custom Antagelser inline med eventuelle
  // overrides fra form (tomme felter → bydel-defaults).
  const live = useMemo(() => {
    if (!kvm || !udbud) return null;

    const fmv = Number(form.fmv) || udbud;
    const tilbudPris = Number(form.tilbudPris) || udbud;
    const ejTotal =
      (Number(form.ejSkat) || 0) +
      (Number(form.ejGrundskyld) || 0) +
      (Number(form.ejFaelles) || 0) +
      (Number(form.ejOvrige) || 0);

    // Bygd custom Antagelser
    const baseA = DEFAULT_ANTAGELSER;
    const roomFactor = getRoomFactor(vaer, baseA);
    const standFactor = getStandFactor(bygaar, baseA);

    // Hvis user overrider final ADR, beregn inverse base ADR så
    // base × room × stand = override
    const adrFinalOverride = form.adr ? Number(form.adr) : null;
    const occOverride = form.occ ? Number(form.occ) : null;
    const ltRateOverride = form.ltRate ? Number(form.ltRate) : null;
    const betaWorstOverride = form.betaWorst !== '' ? Number(form.betaWorst) : null;
    const betaBaseOverride = form.betaBase !== '' ? Number(form.betaBase) : null;
    const betaBestOverride = form.betaBest !== '' ? Number(form.betaBest) : null;

    const a: typeof baseA = {
      ...baseA,
      adr:
        adrFinalOverride !== null && roomFactor * standFactor > 0
          ? { ...baseA.adr, [bydel]: adrFinalOverride / (roomFactor * standFactor) }
          : baseA.adr,
      occ:
        occOverride !== null
          ? { ...baseA.occ, [bydel]: occOverride }
          : baseA.occ,
      langtidsleje:
        ltRateOverride !== null
          ? { ...baseA.langtidsleje, [bydel]: ltRateOverride }
          : baseA.langtidsleje,
      beta: {
        worst: betaWorstOverride ?? baseA.beta.worst,
        base: betaBaseOverride ?? baseA.beta.base,
        best: betaBestOverride ?? baseA.beta.best,
      },
    };

    const calc = calculateProperty(
      { bydel, kvm, vaer, bygaar, udbud, fmv, ejTotal, tilbudPris },
      a,
    );
    const max = maxTilbudspris({ bydel, kvm, fmv, ejTotal }, a);

    // Mellemregninger som calculator ikke selv eksponerer
    const adrBase = a.adr[bydel];
    const ltRate = a.langtidsleje[bydel];
    const ltYearly = ltRate * kvm * 12;
    const expatYearly = ltYearly * 1.3;
    const rabatKr = udbud - tilbudPris;
    const rabatPct = udbud > 0 ? rabatKr / udbud : 0;

    return {
      calc,
      max,
      kvm,
      vaer,
      bygaar,
      fmv,
      tilbudPris,
      rabatKr,
      rabatPct,
      ejTotal,
      udbud,
      adrBase,
      roomFactor,
      standFactor,
      ltRate,
      ltYearly,
      expatYearly,
      antagelser: a,
    };
  }, [form, bydel, kvm, vaer, bygaar, udbud]);

  function update<K extends keyof InputState>(key: K, value: InputState[K]) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  async function setReview(rs: Review) {
    setBusy(true);
    try {
      const r = await fetch(`/api/on-market/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewStatus: rs }),
      });
      if (!r.ok) throw new Error('Update fejlede');
      const updated = (await r.json()) as OnMarketCandidate;
      setC(updated);
    } finally {
      setBusy(false);
    }
  }

  async function importToPipeline() {
    if (!confirm('Importér til pipelinen som ny screening-case?')) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/on-market/${c.id}/import`, { method: 'POST' });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? 'Import fejlede');
      }
      const data = (await r.json()) as { propertyId: string };
      router.push(`/cases/${data.propertyId}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Fejl');
      setBusy(false);
    }
  }

  const images = (c.images as string[] | null) ?? [];
  const display = c.primaryImage && images.length === 0 ? [c.primaryImage] : images;
  const review = c.reviewStatus as Review;
  const importedAlready = !!c.convertedPropertyId;

  return (
    <div className="space-y-4">
      {/* AVM-status banner */}
      {c.v3FmvSource === 'ibuyreal-avm' ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-800">
          <strong>FMV fra iBuyReal AVM</strong> ·{' '}
          {c.avmPricePerSqm
            ? `${Math.round(c.avmPricePerSqm).toLocaleString('da-DK')} kr/m² × ${c.kvm} m² = ${formatKr(c.v3Fmv)}`
            : ''}
          {c.avmCalculatedAt && (
            <>
              {' '}
              · beregnet {new Date(c.avmCalculatedAt).toLocaleDateString('da-DK')}
            </>
          )}
        </div>
      ) : (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <strong>FMV = listPris (fallback)</strong> — iBuyReal AVM kender ikke denne adresse
          ({c.addressId ? `address_id ${c.addressId.slice(0, 8)}…` : 'ingen DAWA address_id'}).
          Justér FMV manuelt herover hvis du har et andet skøn.
        </div>
      )}

      {/* Image gallery + actions side-by-side */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div>
          {display.length > 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="aspect-video w-full overflow-hidden rounded-md bg-slate-100">
                <img
                  src={display[activeImg]}
                  alt={c.address}
                  className="h-full w-full object-cover"
                />
              </div>
              {display.length > 1 && (
                <div className="mt-2 grid grid-cols-8 gap-1.5 lg:grid-cols-10">
                  {display.slice(0, 20).map((url, i) => (
                    <button
                      key={url + i}
                      onClick={() => setActiveImg(i)}
                      className={
                        'aspect-square overflow-hidden rounded ring-2 transition ' +
                        (activeImg === i ? 'ring-blue-500' : 'ring-transparent hover:ring-slate-300')
                      }
                    >
                      <img src={url} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-400">
              Ingen billeder
            </div>
          )}
        </div>

        <div className="space-y-3">
          <Panel title="Handling">
            <div className="space-y-2">
              {importedAlready ? (
                <a
                  href={`/cases/${c.convertedPropertyId}`}
                  className="block w-full rounded-md bg-blue-600 px-3 py-2 text-center text-sm font-medium text-white hover:bg-blue-700"
                >
                  Åbn case i pipeline →
                </a>
              ) : (
                <button
                  onClick={importToPipeline}
                  disabled={busy}
                  className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  Importér til pipeline
                </button>
              )}
              <a
                href={c.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-center text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Boligsiden ↗
              </a>
              {c.caseUrl && (
                <a
                  href={c.caseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-center text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Mægler ↗
                </a>
              )}
            </div>
          </Panel>
          <Panel title="Review">
            <div className="space-y-1">
              {(Object.keys(REVIEW_LABEL) as Review[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setReview(r)}
                  disabled={busy || review === r || importedAlready}
                  className={
                    'flex w-full items-center justify-between rounded-md px-3 py-1.5 text-sm transition ' +
                    (review === r ? REVIEW_COLOR[r] + ' font-medium' : 'hover:bg-slate-50 text-slate-700')
                  }
                >
                  <span>{REVIEW_LABEL[r]}</span>
                  {review === r && <span>✓</span>}
                </button>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {/* Facts (read-only fra scrape) */}
      <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Bolig (fra Boligsiden)
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-6">
          <Fact label="Bydel" value={BYDEL_LABEL[bydel] ?? bydel} />
          <Fact label="kvm" value={kvm ? `${kvm} m²` : '–'} />
          <Fact label="Værelser" value={String(vaer)} />
          <Fact label="Byggeår" value={bygaar ? String(bygaar) : '–'} />
          <Fact label="Udbudspris" value={formatKr(udbud)} />
          <Fact label="Dage på markedet" value={c.daysOnMarket ? `${c.daysOnMarket}d` : '–'} />
        </div>
      </div>

      {/* Antagelser (editable) */}
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Antagelser (live recalc)</h3>
          <button
            onClick={() => setForm(initialInputs)}
            className="text-xs text-slate-500 hover:text-slate-900"
          >
            Nulstil
          </button>
        </div>

        {/* Pris */}
        <div className="mb-3">
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">Pris</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="FMV (kr)" hint="iBuyReal AVM-værdi">
              <input
                type="number"
                value={form.fmv}
                onChange={(e) => update('fmv', e.target.value)}
                className="form-input"
              />
            </Field>
            <Field label="Tilbudspris (kr)" hint="default = udbudspris">
              <input
                type="number"
                value={form.tilbudPris}
                onChange={(e) => update('tilbudPris', e.target.value)}
                className="form-input"
              />
            </Field>
          </div>
        </div>

        {/* Ejerudgifter */}
        <div className="mb-3">
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
            Ejerudgifter (kr/år)
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Ejendomsskat">
              <input
                type="number"
                value={form.ejSkat}
                onChange={(e) => update('ejSkat', e.target.value)}
                className="form-input"
              />
            </Field>
            <Field label="Grundskyld">
              <input
                type="number"
                value={form.ejGrundskyld}
                onChange={(e) => update('ejGrundskyld', e.target.value)}
                className="form-input"
              />
            </Field>
            <Field label="Fællesudgift">
              <input
                type="number"
                value={form.ejFaelles}
                onChange={(e) => update('ejFaelles', e.target.value)}
                className="form-input"
              />
            </Field>
            <Field label="Øvrige">
              <input
                type="number"
                value={form.ejOvrige}
                onChange={(e) => update('ejOvrige', e.target.value)}
                className="form-input"
              />
            </Field>
          </div>
        </div>

        {/* Udlejning */}
        <div className="mb-3">
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
            Udlejnings-rates (tom = bydel-default)
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field
              label="ADR (kr/nat)"
              hint={`default ≈ ${formatKr(
                DEFAULT_ANTAGELSER.adr[bydel] *
                  getRoomFactor(vaer) *
                  getStandFactor(bygaar),
              )}`}
            >
              <input
                type="number"
                placeholder="auto"
                value={form.adr}
                onChange={(e) => update('adr', e.target.value)}
                className="form-input"
              />
            </Field>
            <Field
              label="Belægning (%)"
              hint={`default ${DEFAULT_ANTAGELSER.occ[bydel]}%`}
            >
              <input
                type="number"
                placeholder="auto"
                value={form.occ}
                onChange={(e) => update('occ', e.target.value)}
                className="form-input"
              />
            </Field>
            <Field
              label="Langtidsleje (kr/m²/mdr)"
              hint={`default ${DEFAULT_ANTAGELSER.langtidsleje[bydel]}`}
            >
              <input
                type="number"
                placeholder="auto"
                value={form.ltRate}
                onChange={(e) => update('ltRate', e.target.value)}
                className="form-input"
              />
            </Field>
          </div>
        </div>

        {/* Beta */}
        <div>
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
            Markedsudvikling — beta i % (tom = default)
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Worst (%)" hint={`default ${DEFAULT_ANTAGELSER.beta.worst}`}>
              <input
                type="number"
                step="0.1"
                placeholder="auto"
                value={form.betaWorst}
                onChange={(e) => update('betaWorst', e.target.value)}
                className="form-input"
              />
            </Field>
            <Field label="Base (%)" hint={`default ${DEFAULT_ANTAGELSER.beta.base}`}>
              <input
                type="number"
                step="0.1"
                placeholder="auto"
                value={form.betaBase}
                onChange={(e) => update('betaBase', e.target.value)}
                className="form-input"
              />
            </Field>
            <Field label="Best (%)" hint={`default ${DEFAULT_ANTAGELSER.beta.best}`}>
              <input
                type="number"
                step="0.1"
                placeholder="auto"
                value={form.betaBest}
                onChange={(e) => update('betaBest', e.target.value)}
                className="form-input"
              />
            </Field>
          </div>
        </div>

        {live && (
          <div className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
            Total ejerudgift: <strong className="text-slate-900">{formatKr(live.ejTotal)}/år</strong>
          </div>
        )}
      </div>

      {!live ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
          Tast kvm og udbud for at starte beregningen
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi
              label="Alpha"
              value={formatPct(live.calc.alpha)}
              accent={live.calc.alpha > 0 ? 'emerald' : 'rose'}
              sub="(FMV − investeret) / investeret"
            />
            <Kpi
              label="FMV"
              value={formatKr(live.fmv)}
              sub={c.v3FmvSource === 'ibuyreal-avm' ? 'iBuyReal AVM' : 'listPris fallback'}
            />
            <Kpi label="Investeret" value={formatKr(live.calc.investeret)} sub="tilbudspris + tx" />
            <Kpi
              label="Max bud (BE worst)"
              value={formatKr(live.max)}
              sub="højeste pris hvor worst-afkast = 0"
            />
          </div>

          {/* Scenarie-kort med fuld breakdown */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <ScenarioCard
              label="Worst case"
              scenarie="worst"
              data={live.calc.worst}
              desc="Langtidsleje, 0% beta"
            />
            <ScenarioCard
              label="Base case"
              scenarie="base"
              data={live.calc.base}
              desc="Expat (+30%), 7% beta"
            />
            <ScenarioCard
              label="Best case"
              scenarie="best"
              data={live.calc.best}
              desc="Airbnb, 14.8% beta"
            />
          </div>

          {/* Mellemregninger — 2 kolonner */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Venstre kolonne: ADR + Airbnb */}
            <div className="space-y-4">
              <Panel title="① ADR-beregning (natpris)">
                <div className="space-y-1.5 text-sm">
                  <Row label={`Base ADR (${BYDEL_LABEL[bydel]})`} value={`${formatKr(live.adrBase)}/nat`} />
                  <Row
                    label={`× Room factor (${live.vaer} vær)`}
                    value={`× ${live.roomFactor.toFixed(2)}`}
                    muted
                  />
                  <Row
                    label={`× Stand factor (${
                      !live.bygaar
                        ? 'ukendt'
                        : live.bygaar >= 2015
                        ? 'luksus'
                        : live.bygaar >= 1850
                        ? 'god'
                        : 'ældre'
                    })`}
                    value={`× ${live.standFactor.toFixed(2)}`}
                    muted
                  />
                  <Divider />
                  <Row label="= Justeret ADR" value={`${formatKr(live.calc.airbnb.adr)}/nat`} bold />
                </div>
              </Panel>

              <Panel title="② Airbnb cashflow (best case)">
                <div className="space-y-1.5 text-sm">
                  <Row label="Justeret ADR" value={`${formatKr(live.calc.airbnb.adr)}/nat`} />
                  <Row label="× 365 dage" value="× 365" muted />
                  <Row
                    label={`× Belægning (${live.calc.airbnb.occ.toFixed(0)}%)`}
                    value={`× ${(live.calc.airbnb.occ / 100).toFixed(2)}`}
                    muted
                  />
                  <Divider />
                  <Row label="= Brutto Airbnb/år" value={formatKr(live.calc.airbnb.brutto)} bold />
                  <Row
                    label={`Bookings/år (365 × occ ÷ 2.875)`}
                    value={formatNum(live.calc.airbnb.bookings, 0)}
                    muted
                  />
                  <Divider />
                  <Row
                    label="− Platform 15% af brutto"
                    value={`-${formatKr(live.calc.airbnb.gebyr)}`}
                    muted
                  />
                  <Row
                    label={`− Rengøring (300 kr × ${formatNum(live.calc.airbnb.bookings, 0)})`}
                    value={`-${formatKr(live.calc.airbnb.rengoring)}`}
                    muted
                  />
                  <Row
                    label="− Admin 10% (af rest)"
                    value={`-${formatKr(live.calc.airbnb.admin)}`}
                    muted
                  />
                  <Divider />
                  <Row label="= Net Airbnb/år" value={formatKr(live.calc.airbnb.netAirbnb)} bold />
                </div>
              </Panel>

              <Panel title="③ Langtidsleje + Expat (worst & base case)">
                <div className="space-y-1.5 text-sm">
                  <Row
                    label={`Langtidsleje rate (${BYDEL_LABEL[bydel]})`}
                    value={`${formatNum(live.ltRate)} kr/m²/mdr`}
                  />
                  <Row label={`× kvm (${live.kvm}) × 12 mdr`} value="" muted />
                  <Divider />
                  <Row label="= Langtidsleje/år" value={formatKr(live.ltYearly)} bold />
                  <Row label={`Expat-model (× 1.30 markup)`} value={formatKr(live.expatYearly)} muted />
                  <Divider />
                  <Row label="− Ejerudgifter/år" value={`-${formatKr(live.ejTotal)}`} muted />
                  <Divider />
                  <Row
                    label="Worst gross rental (langtidsleje − ejerudg.)"
                    value={formatKr(live.calc.worst.grossRental)}
                  />
                  <Row
                    label="Base gross rental (expat − ejerudg.)"
                    value={formatKr(live.calc.base.grossRental)}
                  />
                  <Row
                    label="Best gross rental (Airbnb − ejerudg.)"
                    value={formatKr(live.calc.best.grossRental)}
                  />
                </div>
              </Panel>
            </div>

            {/* Højre kolonne: Off-market + Investeret + Subject */}
            <div className="space-y-4">
              <Panel title="④ Købspris (on-market)">
                <div className="space-y-1.5 text-sm">
                  <Row label="Udbudspris" value={formatKr(live.udbud)} />
                  <Row
                    label="− Forhandlet rabat"
                    value={
                      live.rabatKr > 0
                        ? `-${formatKr(live.rabatKr)} (${(live.rabatPct * 100).toFixed(1)}%)`
                        : '0 kr'
                    }
                    muted
                  />
                  <Divider />
                  <Row label="= Tilbudspris (købspris)" value={formatKr(live.tilbudPris)} bold />
                </div>
                <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500">
                  Off-market arbitrage (3% afslag + 2% conv + 80k mæglerspar) gælder ikke
                  her — handlen går allerede gennem mægler.
                </p>
              </Panel>

              <Panel title="⑤ Tx + Investeret">
                <div className="space-y-1.5 text-sm">
                  <Row label="Tilbudspris (købspris)" value={formatKr(live.tilbudPris)} />
                  <Row label="Tx fast" value="1.850 kr" muted />
                  <Row
                    label={`+ 0,6% af købspris`}
                    value={`+${formatKr(live.calc.tx - 1850)}`}
                    muted
                  />
                  <Divider />
                  <Row label="= Tx-omkostning" value={formatKr(live.calc.tx)} />
                  <Row label="+ Tilbudspris" value={formatKr(live.tilbudPris)} muted />
                  <Divider />
                  <Row label="= Total investeret" value={formatKr(live.calc.investeret)} bold />
                </div>
              </Panel>

              <Panel title="⑥ Alpha-beregning">
                <div className="space-y-1.5 text-sm">
                  <Row label="FMV" value={formatKr(live.fmv)} />
                  <Row label="− Investeret" value={`-${formatKr(live.calc.investeret)}`} muted />
                  <Divider />
                  <Row
                    label="= Spread"
                    value={formatKr(live.fmv - live.calc.investeret)}
                    bold
                  />
                  <Row label="÷ Investeret" value={`÷ ${formatKr(live.calc.investeret)}`} muted />
                  <Divider />
                  <Row
                    label="= Alpha"
                    value={formatPct(live.calc.alpha)}
                    bold
                  />
                </div>
              </Panel>

              <Panel title="📊 FMV-sammenligning (Boligsiden vs iBuyReal)">
                <div className="space-y-1.5 text-sm">
                  <Row label="Udbudspris" value={formatKr(live.udbud)} />
                  <Row
                    label="iBuyReal AVM"
                    value={c.v3FmvSource === 'ibuyreal-avm' ? formatKr(c.v3Fmv) : '— (mangler)'}
                    bold
                  />
                  {c.v3FmvSource === 'ibuyreal-avm' && (
                    <Row
                      label="iBuyReal kr/m²"
                      value={c.avmPricePerSqm ? formatKr(c.avmPricePerSqm) : '–'}
                      muted
                    />
                  )}
                  <Divider />
                  <Row
                    label="Boligsidens AVM"
                    value={c.latestValuation ? formatKr(c.latestValuation) : '— (ingen data)'}
                  />
                  {c.latestValuation && live.kvm > 0 && (
                    <>
                      <Row
                        label="Boligsiden kr/m²"
                        value={formatKr(c.latestValuation / live.kvm)}
                        muted
                      />
                      <Row
                        label="Spread vs udbud"
                        value={`${(((c.latestValuation - live.udbud) / live.udbud) * 100).toFixed(1)}%`}
                        muted
                      />
                    </>
                  )}
                  {c.v3FmvSource === 'ibuyreal-avm' && c.latestValuation && c.v3Fmv && (
                    <>
                      <Divider />
                      <Row
                        label="iBR vs BS spread"
                        value={`${(((c.v3Fmv - c.latestValuation) / c.latestValuation) * 100).toFixed(1)}%`}
                        bold
                      />
                    </>
                  )}
                </div>
                <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500">
                  Boligsidens AVM vises kun til reference og indgår <strong>ikke</strong> i
                  beregningerne ovenfor. Alle scenarier bruger iBuyReal AVM (eller listPris
                  som fallback hvis AVM mangler).
                </p>
              </Panel>

              <Panel title="Mægler">
                <div className="space-y-1.5 text-sm">
                  <Row label="kr/m² (udbud)" value={c.perAreaPrice ? formatKr(c.perAreaPrice) : '–'} />
                  <Row label="Mægler" value={c.realtorName ?? c.brokerKind ?? '–'} />
                  <Row label="Type" value={c.brokerKind ?? '–'} muted />
                </div>
              </Panel>
            </div>
          </div>

          {/* Mæglerbeskrivelse */}
          {(c.descriptionTitle || c.description) && (
            <Panel title="Mæglerbeskrivelse">
              {c.descriptionTitle && (
                <h4 className="mb-2 text-base font-semibold text-slate-900">{c.descriptionTitle}</h4>
              )}
              {c.description && (
                <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
                  {c.description}
                </p>
              )}
            </Panel>
          )}
        </>
      )}

      <style jsx>{`
        :global(.form-input) {
          width: 100%;
          padding: 0.4rem 0.6rem;
          background: white;
          border: 1px solid #cbd5e1;
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

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-slate-500">
        {label}
        {hint && <span className="ml-1 text-slate-400">· {hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-medium text-slate-900">{value}</div>
    </div>
  );
}

function Kpi({
  label,
  value,
  accent,
  sub,
}: {
  label: string;
  value: string;
  accent?: 'emerald' | 'rose';
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div
        className={
          'mt-1 text-lg font-semibold ' +
          (accent === 'emerald' ? 'text-emerald-600' : accent === 'rose' ? 'text-rose-600' : 'text-slate-900')
        }
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
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
      <span
        className={
          'tabular-nums ' + (bold ? 'font-semibold text-slate-900' : 'text-slate-700')
        }
      >
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="my-1 h-px bg-slate-100" />;
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
  data: {
    afkast: number;
    alpha: number;
    beta: number;
    cfYield: number;
    salgspris: number;
    profit: number;
    grossRental: number;
    betaPct: number;
  };
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
      <div className="mb-3 text-2xl font-bold tabular-nums text-slate-900">
        {formatPct(data.afkast)}
      </div>
      <div className="space-y-1 border-t border-slate-200/60 pt-2 text-xs">
        <Row label="α (alpha)" value={formatPct(data.alpha)} />
        <Row label={`β (${data.betaPct}% beta)`} value={formatPct(data.beta)} />
        <Row label="cf-yield" value={formatPct(data.cfYield)} />
        <Divider />
        <Row label="= Total afkast" value={formatPct(data.afkast)} bold />
      </div>
      <div className="mt-3 space-y-1 border-t border-slate-200/60 pt-2 text-xs">
        <Row label="Gross rental/år" value={formatKr(data.grossRental)} muted />
        <Row label="Salgspris" value={formatKr(data.salgspris)} muted />
        <Divider />
        <Row label="Profit (1 års hold)" value={formatKr(data.profit)} bold />
      </div>
    </div>
  );
}
