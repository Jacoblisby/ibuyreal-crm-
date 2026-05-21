'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { curatedScore } from '@/lib/curation';
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
  fmvNote: string; // valgfri note hvis FMV gemmes manuelt
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
  // FMV-prioritet: manual > AVM > listPris fallback
  const defaultFmv = c.manualFmv
    ? Math.round(c.manualFmv)
    : c.v3FmvSource === 'ibuyreal-avm' && c.v3Fmv
    ? Math.round(c.v3Fmv)
    : (c.listPrice ?? 0);
  return {
    fmv: String(defaultFmv),
    fmvNote: c.manualFmvNote ?? '',
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

  // Er FMV-feltet ændret fra det gemte? (sammenlign med initialInputs.fmv)
  const fmvIsDirty = useMemo(() => {
    const current = Number(form.fmv);
    const saved = Number(initialInputs.fmv);
    return Number.isFinite(current) && Number.isFinite(saved) && Math.abs(current - saved) >= 1;
  }, [form.fmv, initialInputs.fmv]);

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

  async function saveManualFmv() {
    const fmvNum = Number(form.fmv);
    if (!Number.isFinite(fmvNum) || fmvNum <= 0) {
      toast.error('Indtast en gyldig FMV-værdi');
      return;
    }
    setBusy(true);
    const t = toast.loading('Gemmer manuel FMV…');
    try {
      const r = await fetch(`/api/on-market/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          manualFmv: fmvNum,
          manualFmvNote: form.fmvNote || null,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? 'Kunne ikke gemme');
      }
      const updated = (await r.json()) as OnMarketCandidate;
      setC(updated);
      toast.success(`FMV gemt: ${formatKr(fmvNum)}`, { id: t });
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Fejl', { id: t });
    } finally {
      setBusy(false);
    }
  }

  async function clearManualFmv() {
    setBusy(true);
    const t = toast.loading('Fjerner manuel FMV…');
    try {
      const r = await fetch(`/api/on-market/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manualFmv: null, manualFmvNote: null }),
      });
      if (!r.ok) throw new Error('Kunne ikke fjerne');
      const updated = (await r.json()) as OnMarketCandidate;
      setC(updated);
      // Reset form til ny default
      setForm(buildInitialInputs(updated));
      toast.success('Manuel FMV fjernet — bruger AVM/listPris igen', { id: t });
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Fejl', { id: t });
    } finally {
      setBusy(false);
    }
  }

  async function setReview(rs: Review) {
    setBusy(true);
    // Optimistic update — UI svarer instantly
    const prev = c;
    setC({ ...c, reviewStatus: rs });
    try {
      const r = await fetch(`/api/on-market/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewStatus: rs }),
      });
      if (!r.ok) throw new Error('Update fejlede');
      const updated = (await r.json()) as OnMarketCandidate;
      setC(updated);
      toast.success(REVIEW_LABEL[rs], { duration: 1800 });
    } catch (e) {
      setC(prev);
      toast.error(e instanceof Error ? e.message : 'Kunne ikke opdatere');
    } finally {
      setBusy(false);
    }
  }

  async function importToPipeline() {
    setBusy(true);
    const t = toast.loading('Importerer til pipelinen…');
    try {
      const r = await fetch(`/api/on-market/${c.id}/import`, { method: 'POST' });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? 'Import fejlede');
      }
      const data = (await r.json()) as { propertyId: string };
      toast.success('Importeret som screening-case', { id: t });
      router.push(`/cases/${data.propertyId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Fejl', { id: t });
      setBusy(false);
    }
  }

  const images = (c.images as string[] | null) ?? [];
  const display = c.primaryImage && images.length === 0 ? [c.primaryImage] : images;
  const review = c.reviewStatus as Review;
  const importedAlready = !!c.convertedPropertyId;
  const score = useMemo(() => curatedScore(c), [c]);

  return (
    <div className="space-y-4">
      {/* JP Morgan-grade hero: curated score + rationale + red flags */}
      <CuratedHero score={score} />

      {/* FMV-status banner */}
      {c.v3FmvSource === 'manual' ? (
        <div className="flex items-center gap-3 rounded-lg border border-blue-200/70 bg-gradient-to-r from-blue-50 to-white px-4 py-2.5 text-xs text-blue-900 shadow-sm">
          <svg className="h-4 w-4 shrink-0 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
          <div>
            <span className="font-semibold">FMV sat manuelt</span>
            <span className="ml-1.5 text-blue-800/80">
              · {formatKr(c.v3Fmv)}
              {c.manualFmvNote && ` — "${c.manualFmvNote}"`}
            </span>
          </div>
        </div>
      ) : c.v3FmvSource === 'ibuyreal-avm' ? (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200/70 bg-gradient-to-r from-emerald-50 to-white px-4 py-2.5 text-xs text-emerald-900 shadow-sm">
          <svg className="h-4 w-4 shrink-0 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <div>
            <span className="font-semibold">FMV fra iBuyReal AVM</span>
            {c.avmPricePerSqm && (
              <span className="ml-1.5 text-emerald-800/80">
                · {Math.round(c.avmPricePerSqm).toLocaleString('da-DK')} kr/m² × {c.kvm} m² = {formatKr(c.v3Fmv)}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200/70 bg-gradient-to-r from-amber-50 to-white px-4 py-2.5 text-xs text-amber-900 shadow-sm">
          <svg className="h-4 w-4 shrink-0 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div>
            <span className="font-semibold">FMV = listPris (fallback)</span>
            <span className="ml-1.5 text-amber-800/80">
              · iBuyReal AVM kender ikke denne adresse. Justér FMV i feltet nedenfor og klik "Gem som manuel FMV" for at låse din vurdering ind.
            </span>
          </div>
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
                        'aspect-square overflow-hidden rounded ring-2 transition-[box-shadow,transform,opacity] duration-150 ease-[var(--ease-out)] active:scale-[0.95] ' +
                        (activeImg === i
                          ? 'ring-slate-900 opacity-100'
                          : 'ring-transparent opacity-70 hover:opacity-100 hover:ring-slate-300')
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
                  className="block w-full rounded-md bg-blue-600 px-3 py-2 text-center text-sm font-medium text-white shadow-sm transition-[transform,background-color,box-shadow] duration-150 ease-[var(--ease-out)] hover:bg-blue-700 hover:shadow-md active:scale-[0.98]"
                >
                  Åbn case i pipeline →
                </a>
              ) : (
                <button
                  onClick={importToPipeline}
                  disabled={busy}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white shadow-sm transition-[transform,background-color,box-shadow] duration-150 ease-[var(--ease-out)] hover:bg-slate-800 hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
                >
                  {busy && (
                    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  )}
                  Importér til pipeline
                </button>
              )}
              <a
                href={c.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-center text-sm font-medium text-slate-700 transition-[transform,background-color,border-color] duration-150 ease-[var(--ease-out)] hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98]"
              >
                Boligsiden ↗
              </a>
              {c.caseUrl && (
                <a
                  href={c.caseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-center text-sm font-medium text-slate-700 transition-[transform,background-color,border-color] duration-150 ease-[var(--ease-out)] hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98]"
                >
                  Mægler ↗
                </a>
              )}
            </div>
          </Panel>
          <Panel title="Review">
            <div className="space-y-0.5">
              {(Object.keys(REVIEW_LABEL) as Review[]).map((r) => {
                const active = review === r;
                return (
                  <button
                    key={r}
                    onClick={() => setReview(r)}
                    disabled={busy || active || importedAlready}
                    className={
                      'flex w-full items-center justify-between rounded-md px-3 py-1.5 text-sm transition-[background-color,color,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.98] disabled:active:scale-100 ' +
                      (active
                        ? REVIEW_COLOR[r] + ' font-medium'
                        : 'text-slate-700 hover:bg-slate-100')
                    }
                  >
                    <span>{REVIEW_LABEL[r]}</span>
                    {active && (
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                );
              })}
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
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold tracking-tight text-slate-900">Antagelser (live recalc)</h3>
          <button
            onClick={() => setForm(initialInputs)}
            className="rounded-md px-2 py-1 text-xs text-slate-500 transition-colors duration-150 ease-[var(--ease-out)] hover:bg-slate-100 hover:text-slate-900 active:scale-[0.97]"
          >
            Nulstil
          </button>
        </div>

        {/* Pris */}
        <div className="mb-3">
          <div className="mb-1.5 flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Pris</div>
            {c.manualFmv && (
              <div className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="6" /></svg>
                Manuel FMV aktiv
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field
              label="FMV (kr)"
              hint={
                c.manualFmv
                  ? 'manuelt sat'
                  : c.v3FmvSource === 'ibuyreal-avm'
                  ? 'iBuyReal AVM'
                  : 'listPris fallback'
              }
            >
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
          {/* FMV save-bar — vises kun hvis FMV-værdien afviger fra det gemte */}
          {fmvIsDirty && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50/60 p-2">
              <input
                type="text"
                placeholder="Note (valgfri) — fx hvorfor AVM ikke kan bruges"
                value={form.fmvNote}
                onChange={(e) => update('fmvNote', e.target.value)}
                className="form-input flex-1 min-w-[200px] !bg-white"
              />
              <button
                onClick={saveManualFmv}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-[transform,background-color] duration-150 ease-[var(--ease-out)] hover:bg-slate-800 active:scale-[0.97] disabled:opacity-60"
              >
                Gem som manuel FMV
              </button>
            </div>
          )}
          {c.manualFmv && !fmvIsDirty && (
            <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
              <div>
                Manuel FMV: <strong className="font-medium text-slate-900">{formatKr(c.manualFmv)}</strong>
                {c.manualFmvNote && <span className="ml-2 text-slate-500">— "{c.manualFmvNote}"</span>}
                {c.manualFmvSetAt && (
                  <span className="ml-2 text-slate-400">
                    sat {new Date(c.manualFmvSetAt).toLocaleDateString('da-DK')}
                  </span>
                )}
              </div>
              <button
                onClick={clearManualFmv}
                disabled={busy}
                className="rounded-md px-2 py-1 text-xs text-slate-500 transition-colors duration-150 ease-[var(--ease-out)] hover:bg-slate-100 hover:text-rose-600 active:scale-[0.97]"
              >
                Fjern manuel FMV
              </button>
            </div>
          )}
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
              label={c.v3FmvSource === 'manual' ? 'FMV (manuel)' : 'iBuyReal AVM'}
              value={formatKr(live.fmv)}
              sub={
                c.v3FmvSource === 'manual'
                  ? 'manuelt sat værdi'
                  : c.v3FmvSource === 'ibuyreal-avm'
                  ? 'XGBoost prediction'
                  : 'listPris fallback'
              }
              accent={
                c.v3FmvSource === 'manual'
                  ? 'emerald'
                  : c.v3FmvSource === 'ibuyreal-avm'
                  ? 'emerald'
                  : undefined
              }
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

              <Panel title="Mægler">
                <div className="space-y-1.5 text-sm">
                  <Row label="kr/m² (udbud)" value={c.perAreaPrice ? formatKr(c.perAreaPrice) : '–'} />
                  <Row label="Mægler" value={c.realtorName ?? c.brokerKind ?? '–'} />
                  <Row label="Type" value={c.brokerKind ?? '–'} muted />
                </div>
              </Panel>
            </div>
          </div>

          {/* Tidligere handler — full width */}
          <HistoryPanel candidate={c} liveFmv={live.fmv} kvm={kvm} listPrice={c.listPrice ?? 0} />

          {/* Comparable sales i samme postnr */}
          <ComparablesPanel candidateId={c.id} subjectKvm={kvm} listPrice={c.listPrice ?? 0} />

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
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 0.375rem;
          font-size: 0.875rem;
          color: #0f172a;
          outline: none;
          font-variant-numeric: tabular-nums;
          transition: border-color 0.15s cubic-bezier(0.23, 1, 0.32, 1),
                      background-color 0.15s cubic-bezier(0.23, 1, 0.32, 1),
                      box-shadow 0.15s cubic-bezier(0.23, 1, 0.32, 1);
        }
        :global(.form-input:hover) {
          background: white;
          border-color: #cbd5e1;
        }
        :global(.form-input:focus) {
          background: white;
          border-color: #0f172a;
          box-shadow: 0 0 0 3px rgba(15, 23, 42, 0.08);
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

function HistoryPanel({
  candidate,
  liveFmv,
  kvm,
  listPrice,
}: {
  candidate: OnMarketCandidate;
  liveFmv: number;
  kvm: number;
  listPrice: number;
}) {
  const sales = (candidate.historicalSales as Array<{ date: string; amount: number; type: string }> | null) ?? [];
  const normal = sales.filter((s) => s.type === 'normal' && s.amount > 100_000);
  const latest = normal[0];

  // CAGR-beregning vs liveFmv og listPrice
  let cagrToFmv: number | null = null;
  let cagrToList: number | null = null;
  let yearsElapsed: number | null = null;
  if (latest) {
    const latestYear = parseInt(latest.date.slice(0, 4));
    yearsElapsed = new Date().getFullYear() - latestYear;
    if (yearsElapsed > 0) {
      cagrToFmv = (Math.pow(liveFmv / latest.amount, 1 / yearsElapsed) - 1) * 100;
      cagrToList = (Math.pow(listPrice / latest.amount, 1 / yearsElapsed) - 1) * 100;
    }
  }

  // Verdict for AVM-overshoot
  const overshoot =
    cagrToFmv !== null && cagrToList !== null ? cagrToFmv - cagrToList : null;
  const verdict =
    overshoot === null
      ? null
      : overshoot < 1.5
      ? { color: 'emerald', label: 'I tråd med marked' }
      : overshoot < 3.5
      ? { color: 'amber', label: 'Lidt optimistisk' }
      : { color: 'rose', label: 'AVM overshooter' };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold tracking-tight text-slate-900">
          Tidligere handler & prisudvikling
        </h3>
        {verdict && (
          <span
            className={
              'rounded-full px-2 py-0.5 text-[10px] font-medium ' +
              (verdict.color === 'emerald'
                ? 'bg-emerald-100 text-emerald-700'
                : verdict.color === 'amber'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-rose-100 text-rose-700')
            }
          >
            {verdict.label}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Venstre: handelshistorik tabel */}
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
            Registrerede handler (Boligsiden)
          </div>
          {sales.length === 0 ? (
            <p className="text-sm text-slate-400">
              Ingen historiske handler registreret for adressen.
            </p>
          ) : (
            <div className="space-y-1.5 text-sm">
              {sales.slice(0, 10).map((s, i) => (
                <div
                  key={i}
                  className={
                    'flex items-baseline justify-between gap-3 rounded-md px-2 py-1.5 ' +
                    (s.type === 'normal' ? 'bg-slate-50' : 'opacity-60')
                  }
                >
                  <div className="flex items-baseline gap-2">
                    <span className="tabular-nums font-medium text-slate-700">{s.date}</span>
                    <span className="text-[10px] uppercase tracking-wider text-slate-400">
                      {s.type}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="tabular-nums font-semibold text-slate-900">
                      {formatKr(s.amount)}
                    </span>
                    {kvm > 0 && (
                      <span className="ml-2 tabular-nums text-xs text-slate-500">
                        {formatKr(s.amount / kvm)}/m²
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {candidate.publicValuation && (
            <div className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500">
              Offentlig vurdering (SKAT):{' '}
              <span className="font-medium tabular-nums text-slate-700">
                {formatKr(candidate.publicValuation)}
              </span>
              <span className="ml-1 text-slate-400">— typisk forældet, kun reference</span>
            </div>
          )}
        </div>

        {/* Højre: CAGR-analyse */}
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
            Implicit prisudvikling (CAGR)
          </div>
          {latest && yearsElapsed ? (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                <div className="text-xs text-slate-500">Sidste handel</div>
                <div className="mt-0.5 flex items-baseline justify-between">
                  <span className="text-base font-semibold tabular-nums">
                    {formatKr(latest.amount)}
                  </span>
                  <span className="text-xs text-slate-500">
                    {latest.date} · {yearsElapsed} år siden
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-slate-600">Udbudspris implicerer</span>
                  <span className="tabular-nums font-medium text-slate-900">
                    {cagrToList!.toFixed(1)}% pa
                  </span>
                </div>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-slate-600">FMV implicerer</span>
                  <span className="tabular-nums font-semibold text-slate-900">
                    {cagrToFmv!.toFixed(1)}% pa
                  </span>
                </div>
                <div className="flex items-baseline justify-between border-t border-slate-100 pt-2 text-xs text-slate-500">
                  <span>Overshoot (FMV vs udbud)</span>
                  <span
                    className={
                      'tabular-nums font-medium ' +
                      (overshoot! < 1.5
                        ? 'text-emerald-600'
                        : overshoot! < 3.5
                        ? 'text-amber-600'
                        : 'text-rose-600')
                    }
                  >
                    {overshoot! > 0 ? '+' : ''}
                    {overshoot!.toFixed(1)}pp
                  </span>
                </div>
              </div>

              <div className="rounded-md border border-slate-100 bg-white p-3 text-xs text-slate-500">
                <p>
                  <strong className="text-slate-700">Tommelfingerregel:</strong> historisk KBH-condo
                  CAGR ligger på 5-7% over lange horisonter, op til 10% i boom-perioder.
                </p>
                <p className="mt-1">
                  Hvis FMV-CAGR &gt; 8-9% over en periode med fresh data, er det sandsynligvis
                  optimistisk.
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400">
              Mangler nylig handelsdata til CAGR-beregning.
            </p>
          )}
        </div>
      </div>
    </div>
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
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow duration-200 ease-[var(--ease-out)] hover:shadow-md">
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div
        className={
          'mt-1.5 text-xl font-semibold tabular-nums tracking-tight ' +
          (accent === 'emerald' ? 'text-emerald-600' : accent === 'rose' ? 'text-rose-600' : 'text-slate-900')
        }
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-[13px] font-semibold tracking-tight text-slate-900">{title}</h3>
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

// ─── CuratedHero — JP Morgan-grade overview ──────────────────────────────────

function CuratedHero({ score }: { score: ReturnType<typeof curatedScore> }) {
  const grade =
    score.total >= 75
      ? { label: 'A — institutional grade', color: 'emerald' }
      : score.total >= 60
      ? { label: 'B — solid', color: 'emerald' }
      : score.total >= 45
      ? { label: 'C — okay', color: 'amber' }
      : { label: 'D — speculative', color: 'rose' };

  const c = score.components;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr] rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      {/* Venstre: score-hero */}
      <div className="flex flex-col items-start justify-between border-b border-slate-100 pb-4 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-5">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
            Curated score
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={
                'text-5xl font-bold tabular-nums tracking-tight ' +
                (grade.color === 'emerald'
                  ? 'text-emerald-600'
                  : grade.color === 'amber'
                  ? 'text-amber-600'
                  : 'text-rose-600')
              }
            >
              {score.total}
            </span>
            <span className="text-base font-medium text-slate-400">/ 100</span>
          </div>
          <div
            className={
              'mt-2 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ' +
              (grade.color === 'emerald'
                ? 'bg-emerald-100 text-emerald-700'
                : grade.color === 'amber'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-rose-100 text-rose-700')
            }
          >
            {grade.label}
          </div>
        </div>
        {/* Component breakdown */}
        <div className="mt-4 w-full space-y-1.5 text-xs">
          <ScoreBar label="AVM signal" value={c.avmSignal} max={25} />
          <ScoreBar label="Kvalitet" value={c.quality} max={25} />
          <ScoreBar label="Data-freshness" value={c.dataFreshness} max={20} />
          <ScoreBar label="Bydel" value={c.bydelAttractive} max={15} />
          <ScoreBar label="Market signals" value={c.marketSignals} max={15} />
        </div>
      </div>

      {/* Højre: rationale + red flags */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-emerald-700">
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Positive signaler
          </div>
          <ul className="space-y-1 text-sm text-slate-700">
            {score.rationale.length === 0 ? (
              <li className="text-slate-400 italic">Ingen positive signaler</li>
            ) : (
              score.rationale.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-emerald-500">·</span>
                  <span>{r}</span>
                </li>
              ))
            )}
          </ul>
        </div>
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-rose-700">
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Red flags
          </div>
          <ul className="space-y-1 text-sm text-slate-700">
            {score.redFlags.length === 0 ? (
              <li className="text-emerald-600 italic">Ingen red flags identificeret</li>
            ) : (
              score.redFlags.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-rose-500">·</span>
                  <span>{r}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

function ScoreBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = (value / max) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px] text-slate-500">
        <span>{label}</span>
        <span className="tabular-nums">{value}/{max}</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-slate-900 transition-all duration-300 ease-[var(--ease-out)]"
          style={{ width: pct + '%' }}
        />
      </div>
    </div>
  );
}

// ─── ComparablesPanel — nærlokale 5-års handler ──────────────────────────────

function ComparablesPanel({
  candidateId,
  subjectKvm,
  listPrice,
}: {
  candidateId: string;
  subjectKvm: number;
  listPrice: number;
}) {
  interface CompResp {
    subjectKvm: number;
    subjectPostal: string;
    medianPerSqm: number | null;
    sampleSize: number;
    sales: Array<{
      date: string;
      amount: number;
      perAreaPrice: number;
      address: string;
      kvm: number;
      yearBuilt: number | null;
      isSelf: boolean;
    }>;
  }
  const [data, setData] = useState<CompResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/on-market/${candidateId}/comparables`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, [candidateId]);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-sm text-slate-400">Henter sammenlignelige handler…</div>
      </div>
    );
  }
  if (!data || data.sampleSize === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-[13px] font-semibold tracking-tight text-slate-900">
          Sammenlignelige handler (samme postnr, ±25% kvm, 5 år)
        </h3>
        <p className="mt-2 text-sm text-slate-400">
          Ingen nærlokale handler fundet i vores DB. Udvid scrape-coverage for at få sammenlignelige.
        </p>
      </div>
    );
  }

  const subjectPpm = listPrice && subjectKvm > 0 ? listPrice / subjectKvm : 0;
  const diffFromMedian =
    data.medianPerSqm && subjectPpm
      ? ((subjectPpm - data.medianPerSqm) / data.medianPerSqm) * 100
      : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-semibold tracking-tight text-slate-900">
          Sammenlignelige handler (samme postnr {data.subjectPostal}, ±25% kvm, 5 år)
        </h3>
        <span className="text-xs text-slate-500">
          n={data.sampleSize} · median{' '}
          <strong className="text-slate-900">
            {data.medianPerSqm ? formatKr(data.medianPerSqm) : '–'}/m²
          </strong>
          {diffFromMedian !== null && (
            <>
              {' '}
              · denne case ligger{' '}
              <strong
                className={
                  diffFromMedian < 0
                    ? 'text-emerald-700'
                    : diffFromMedian < 10
                    ? 'text-slate-900'
                    : 'text-rose-600'
                }
              >
                {diffFromMedian > 0 ? '+' : ''}
                {diffFromMedian.toFixed(1)}%
              </strong>{' '}
              vs median
            </>
          )}
        </span>
      </div>

      <div className="overflow-hidden rounded-md border border-slate-100">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] font-medium uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2">Dato</th>
              <th className="px-3 py-2">Adresse</th>
              <th className="px-3 py-2 text-right">kvm</th>
              <th className="px-3 py-2 text-right">Bygget</th>
              <th className="px-3 py-2 text-right">Pris</th>
              <th className="px-3 py-2 text-right">kr/m²</th>
            </tr>
          </thead>
          <tbody>
            {data.sales.map((s, i) => (
              <tr
                key={i}
                className={
                  'border-t border-slate-100 ' +
                  (s.isSelf ? 'bg-amber-50/40' : 'hover:bg-slate-50/60')
                }
              >
                <td className="px-3 py-2 tabular-nums text-slate-600">{s.date}</td>
                <td className="px-3 py-2 font-medium text-slate-900">
                  {s.address}
                  {s.isSelf && (
                    <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                      denne case
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{s.kvm}</td>
                <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-500">
                  {s.yearBuilt ?? '–'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatKr(s.amount)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                  {formatKr(s.perAreaPrice)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
