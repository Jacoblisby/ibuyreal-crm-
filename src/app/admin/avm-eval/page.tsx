/**
 * AVM-eval: løbende evaluering af den aktuelle AVM-model mod markedsdata.
 *
 * Alt beregnes live fra DB ved page-load:
 *  1. Model-skift: gammel vs ny prediction (kræver avm_snapshot_old — one-off)
 *  2. Bias per bydel / æra / kvm / prissegment (AVM vs Resight comp-median)
 *  3. Fejl-kandidater: cases hvor modellen sandsynligvis tager fejl
 *  4. Portefølje-skævhed: er høj-α cases koncentreret i billige segmenter?
 */
import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { externalSales, onMarketCandidates } from '@/lib/db/schema';
import { eq, gte } from 'drizzle-orm';
import { formatKr } from '@/lib/format';
import { BYDEL_LABEL } from '@/lib/status';
import type { OnMarketCandidate } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AVM eval — iBuyReal' };

// ─── Hjælpere ────────────────────────────────────────────────────────────────

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function eraOf(y: number | null): string {
  if (!y) return 'ukendt';
  if (y < 1900) return 'pre-1900';
  if (y < 1950) return '1900-1949';
  if (y <= 1990) return '1950-1990';
  if (y < 2010) return '1990-2009';
  return 'post-2010';
}

function kvmBucket(kvm: number | null): string {
  if (!kvm) return 'ukendt';
  if (kvm < 50) return '<50 m²';
  if (kvm < 70) return '50-70 m²';
  if (kvm < 90) return '70-90 m²';
  if (kvm <= 110) return '90-110 m²';
  return '>110 m²';
}

function prisBucket(p: number | null): string {
  if (!p) return 'ukendt';
  if (p < 3_000_000) return '<3M';
  if (p < 4_500_000) return '3-4,5M';
  if (p < 6_000_000) return '4,5-6M';
  if (p <= 8_000_000) return '6-8M';
  return '>8M';
}

/** Bygnings-nøgle: "Klaksvigsgade 8, 1. tv" → "klaksvigsgade 8|2300" */
function buildingKey(address: string, postalCode: string): string | null {
  const m = address.match(/^(.+?\d+[A-Za-z]?)\s*(,|$)/);
  return m ? `${m[1].toLowerCase().trim()}|${postalCode}` : null;
}

interface SegmentBias {
  label: string;
  n: number;
  medianBiasPct: number;
  spreadPct: number;
}

function segmentBias(
  items: Array<{ key: string; biasPct: number }>,
  minN = 8,
): SegmentBias[] {
  const groups = new Map<string, number[]>();
  for (const it of items) {
    const arr = groups.get(it.key) ?? [];
    arr.push(it.biasPct);
    groups.set(it.key, arr);
  }
  const out: SegmentBias[] = [];
  for (const [label, biases] of groups) {
    if (biases.length < minN) continue;
    const med = median(biases)!;
    const mean = biases.reduce((a, b) => a + b, 0) / biases.length;
    const spread = Math.sqrt(biases.reduce((a, b) => a + (b - mean) ** 2, 0) / biases.length);
    out.push({ label, n: biases.length, medianBiasPct: med, spreadPct: spread });
  }
  return out.sort((a, b) => Math.abs(b.medianBiasPct) - Math.abs(a.medianBiasPct));
}

// ─── Side ────────────────────────────────────────────────────────────────────

export default async function AvmEvalPage() {
  if (!db) return <div className="text-sm text-slate-500">DB ikke konfigureret.</div>;

  const rows = await db
    .select()
    .from(onMarketCandidates)
    .where(eq(onMarketCandidates.status, 'active'));

  const cutoff6m = new Date();
  cutoff6m.setMonth(cutoff6m.getMonth() - 6);
  const extRows = await db
    .select({
      saleDate: externalSales.saleDate,
      amount: externalSales.amount,
      kvm: externalSales.kvm,
      perAreaPrice: externalSales.perAreaPrice,
      yearBuilt: externalSales.yearBuilt,
      postalCode: externalSales.postalCode,
      address: externalSales.address,
    })
    .from(externalSales)
    .where(gte(externalSales.saleDate, cutoff6m.toISOString().slice(0, 10)));

  const extByPostnr = new Map<string, typeof extRows>();
  for (const e of extRows) {
    if (!e.kvm || e.kvm <= 0) continue;
    const arr = extByPostnr.get(e.postalCode) ?? [];
    arr.push(e);
    extByPostnr.set(e.postalCode, arr);
  }

  // ── Per-case bias mod comp-median ────────────────────────────────────────
  interface CaseBias {
    c: OnMarketCandidate;
    compMedian: number | null;
    nComps: number;
    biasPct: number | null; // (compMedian - avm) / avm × 100
  }
  const withAvm: CaseBias[] = [];
  for (const c of rows) {
    if (!c.avmPricePerSqm || !c.kvm || c.v3FmvSource !== 'ibuyreal-avm') continue;
    const peers = (extByPostnr.get(c.postalCode) ?? []).filter((e) => {
      if (e.kvm! < c.kvm! * 0.7 || e.kvm! > c.kvm! * 1.3) return false;
      if (c.yearBuilt && e.yearBuilt && Math.abs(e.yearBuilt - c.yearBuilt) > 25) return false;
      // Udeluk handler på subjektets egen adresse
      return !e.address.toLowerCase().startsWith(c.address.toLowerCase().slice(0, 12));
    });
    const ppms = peers.map((p) => p.perAreaPrice ?? p.amount / p.kvm!).filter((v) => v > 5_000);
    const compMedian = median(ppms);
    const biasPct =
      compMedian !== null ? ((compMedian - c.avmPricePerSqm) / c.avmPricePerSqm) * 100 : null;
    withAvm.push({
      c,
      compMedian,
      nComps: ppms.length,
      biasPct: biasPct !== null && Math.abs(biasPct) <= 60 ? biasPct : null, // outlier-guard
    });
  }
  const biased = withAvm.filter((x) => x.biasPct !== null && x.nComps >= 5);

  const globalBias = median(biased.map((x) => x.biasPct!));

  // ── Segment-bias ─────────────────────────────────────────────────────────
  const byBydel = segmentBias(
    biased.filter((x) => x.c.bydel).map((x) => ({ key: BYDEL_LABEL[x.c.bydel!] ?? x.c.bydel!, biasPct: x.biasPct! })),
  );
  const byEra = segmentBias(biased.map((x) => ({ key: eraOf(x.c.yearBuilt), biasPct: x.biasPct! })));
  const byKvm = segmentBias(biased.map((x) => ({ key: kvmBucket(x.c.kvm), biasPct: x.biasPct! })));
  const byPris = segmentBias(biased.map((x) => ({ key: prisBucket(x.c.listPrice), biasPct: x.biasPct! })));

  // ── Fejl-kandidater ──────────────────────────────────────────────────────
  interface Suspect {
    c: OnMarketCandidate;
    reasons: string[];
    severity: number;
    compMedian: number | null;
    nComps: number;
  }
  const suspects: Suspect[] = [];

  // Bygnings-inkonsistens: samme bygning, stor prediction-spread
  const buildings = new Map<string, Array<{ id: string; ppm: number }>>();
  for (const x of withAvm) {
    const key = buildingKey(x.c.address, x.c.postalCode);
    if (!key) continue;
    const arr = buildings.get(key) ?? [];
    arr.push({ id: x.c.id, ppm: x.c.avmPricePerSqm! });
    buildings.set(key, arr);
  }
  const inconsistentIds = new Map<string, number>(); // id → spread%
  for (const [, units] of buildings) {
    if (units.length < 2) continue;
    const ppms = units.map((u) => u.ppm);
    const spreadPct = ((Math.max(...ppms) - Math.min(...ppms)) / Math.min(...ppms)) * 100;
    if (spreadPct > 25) {
      for (const u of units) inconsistentIds.set(u.id, spreadPct);
    }
  }

  for (const x of withAvm) {
    const reasons: string[] = [];
    let severity = 0;
    const alphaPct = (x.c.v3Alpha ?? 0) * 100;

    if (x.biasPct !== null && x.nComps >= 5 && Math.abs(x.biasPct) >= 20) {
      reasons.push(
        `AVM afviger ${x.biasPct > 0 ? '-' : '+'}${Math.abs(x.biasPct).toFixed(0)}% fra ${x.nComps} friske handler (comp-median ${Math.round(x.compMedian!).toLocaleString('da-DK')} kr/m²)`,
      );
      severity += Math.abs(x.biasPct);
    }
    if (alphaPct > 25) {
      reasons.push(`Ekstrem α +${alphaPct.toFixed(0)}% — historisk altid falsk positiv`);
      severity += alphaPct - 15;
    }
    if (x.c.avmPricePerSqm! < 35_000 || x.c.avmPricePerSqm! > 130_000) {
      reasons.push(`Usandsynlig ppm: ${Math.round(x.c.avmPricePerSqm!).toLocaleString('da-DK')} kr/m²`);
      severity += 30;
    }
    const bSpread = inconsistentIds.get(x.c.id);
    if (bSpread) {
      reasons.push(`Bygnings-inkonsistens: modellen spreder ${bSpread.toFixed(0)}% på tværs af enheder i samme opgang`);
      severity += bSpread / 2;
    }
    if (reasons.length > 0) {
      suspects.push({ c: x.c, reasons, severity, compMedian: x.compMedian, nComps: x.nComps });
    }
  }
  suspects.sort((a, b) => b.severity - a.severity);

  // ── Portefølje-skævhed: top-20 α fordeling ───────────────────────────────
  const topAlpha = withAvm
    .filter((x) => (x.c.v3Alpha ?? 0) > 0)
    .sort((a, b) => (b.c.v3Alpha ?? 0) - (a.c.v3Alpha ?? 0))
    .slice(0, 20);
  const topAlphaBydel = new Map<string, number>();
  for (const x of topAlpha) {
    const b = x.c.bydel ? BYDEL_LABEL[x.c.bydel] ?? x.c.bydel : '?';
    topAlphaBydel.set(b, (topAlphaBydel.get(b) ?? 0) + 1);
  }
  const bestandBydel = new Map<string, number>();
  for (const x of withAvm) {
    const b = x.c.bydel ? BYDEL_LABEL[x.c.bydel] ?? x.c.bydel : '?';
    bestandBydel.set(b, (bestandBydel.get(b) ?? 0) + 1);
  }
  const topAlphaMedianPris = median(topAlpha.map((x) => x.c.listPrice ?? 0));
  const bestandMedianPris = median(withAvm.map((x) => x.c.listPrice ?? 0));

  // ── Model-skift (hvis snapshot findes) ───────────────────────────────────
  let modelShift: Array<{
    address: string;
    id: string;
    old_ppm: number;
    new_ppm: number;
    shift_pct: number;
  }> = [];
  let shiftStats: { n: number; medianShift: number } | null = null;
  try {
    const shiftRows = (await db.execute(sql`
      SELECT c.id, c.address, o.old_ppm, c.avm_price_per_sqm AS new_ppm,
        (c.avm_price_per_sqm - o.old_ppm) / o.old_ppm * 100 AS shift_pct
      FROM on_market_candidates c
      JOIN avm_snapshot_old o ON o.id = c.id
      WHERE c.status = 'active' AND c.avm_price_per_sqm IS NOT NULL AND o.old_ppm IS NOT NULL
        AND ABS(c.avm_price_per_sqm - o.old_ppm) > 0.01
      ORDER BY ABS((c.avm_price_per_sqm - o.old_ppm) / o.old_ppm) DESC
    `)) as unknown as Array<{ id: string; address: string; old_ppm: number; new_ppm: number; shift_pct: number }>;
    modelShift = shiftRows.slice(0, 15);
    if (shiftRows.length > 0) {
      shiftStats = {
        n: shiftRows.length,
        medianShift: median(shiftRows.map((r) => Number(r.shift_pct))) ?? 0,
      };
    }
  } catch {
    // snapshot-tabel findes ikke — skip sektionen
  }

  const coverage = {
    total: rows.length,
    withAvm: rows.filter((r) => r.v3FmvSource === 'ibuyreal-avm').length,
    nulls: rows.filter((r) => r.v3FmvSource !== 'ibuyreal-avm' && r.v3FmvSource !== 'manual').length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AVM eval</h1>
        <p className="mt-1 text-sm text-slate-500">
          Løbende evaluering af den aktuelle AVM-model mod Resight-markedsdata (sidste 6 mdr).
          Bias = (comp-median − AVM) / AVM — positiv betyder modellen undervurderer.
        </p>
      </div>

      {/* Stat-strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Aktive cases" value={String(coverage.total)} />
        <Stat label="Med AVM" value={`${coverage.withAvm} (${Math.round((coverage.withAvm / coverage.total) * 100)}%)`} />
        <Stat label="Model-nuller" value={String(coverage.nulls)} />
        <Stat
          label="Global bias (median)"
          value={globalBias !== null ? `${globalBias > 0 ? '+' : ''}${globalBias.toFixed(1)}%` : '–'}
          tone={globalBias !== null && Math.abs(globalBias) > 5 ? 'amber' : 'emerald'}
        />
      </div>

      {/* Model-skift */}
      {shiftStats && (
        <Section title={`Model-skift: gammel → ny (${shiftStats.n} ændrede predictions, median ${shiftStats.medianShift > 0 ? '+' : ''}${shiftStats.medianShift.toFixed(1)}%)`}>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] font-medium uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2">Case (15 største skift)</th>
                <th className="px-3 py-2 text-right">Gammel kr/m²</th>
                <th className="px-3 py-2 text-right">Ny kr/m²</th>
                <th className="px-3 py-2 text-right">Skift</th>
              </tr>
            </thead>
            <tbody>
              {modelShift.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <Link href={`/on-market/${r.id}`} className="text-blue-700 hover:underline">{r.address}</Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{Math.round(Number(r.old_ppm)).toLocaleString('da-DK')}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Math.round(Number(r.new_ppm)).toLocaleString('da-DK')}</td>
                  <td className={'px-3 py-2 text-right font-semibold tabular-nums ' + (Number(r.shift_pct) > 0 ? 'text-emerald-700' : 'text-rose-700')}>
                    {Number(r.shift_pct) > 0 ? '+' : ''}{Number(r.shift_pct).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {/* Bias-tabeller */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BiasTable title="Bias per bydel" rows={byBydel} />
        <BiasTable title="Bias per byggeår-æra" rows={byEra} />
        <BiasTable title="Bias per størrelse" rows={byKvm} />
        <BiasTable title="Bias per prissegment" rows={byPris} />
      </div>

      {/* Portefølje-skævhed */}
      <Section title="Portefølje-skævhed: hvor kommer høj-α cases fra?">
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">Top-20 α per bydel vs hele bestanden</div>
            <table className="w-full text-sm">
              <tbody>
                {Array.from(topAlphaBydel.entries()).sort((a, b) => b[1] - a[1]).map(([bydel, n]) => {
                  const bestand = bestandBydel.get(bydel) ?? 0;
                  const topShare = (n / 20) * 100;
                  const bestandShare = (bestand / withAvm.length) * 100;
                  const skew = topShare - bestandShare;
                  return (
                    <tr key={bydel} className="border-t border-slate-100">
                      <td className="py-1.5 pr-2">{bydel}</td>
                      <td className="py-1.5 text-right tabular-nums">{n}/20 ({topShare.toFixed(0)}%)</td>
                      <td className="py-1.5 pl-3 text-right text-xs tabular-nums text-slate-400">bestand {bestandShare.toFixed(0)}%</td>
                      <td className={'py-1.5 pl-3 text-right text-xs font-semibold tabular-nums ' + (skew > 15 ? 'text-rose-600' : 'text-slate-500')}>
                        {skew > 0 ? '+' : ''}{skew.toFixed(0)}pp
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="space-y-3">
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-slate-500">Median udbudspris</div>
              <div className="mt-1 text-sm">
                Top-20 α: <strong className="tabular-nums">{topAlphaMedianPris ? formatKr(topAlphaMedianPris) : '–'}</strong>
                {' · '}Bestand: <strong className="tabular-nums">{bestandMedianPris ? formatKr(bestandMedianPris) : '–'}</strong>
              </div>
              {topAlphaMedianPris && bestandMedianPris && topAlphaMedianPris < bestandMedianPris * 0.8 && (
                <p className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
                  ⚠ Høj-α cases er markant billigere end bestanden — modellen overvurderer sandsynligvis billige segmenter
                  (kendt mønster: billige Amager-cases). Kryds-tjek mod comp-median før tillid.
                </p>
              )}
            </div>
          </div>
        </div>
      </Section>

      {/* Fejl-kandidater */}
      <Section title={`Fejl-kandidater (${suspects.length}) — cases hvor modellen sandsynligvis tager fejl`}>
        {suspects.length === 0 ? (
          <p className="p-4 text-sm text-slate-400">Ingen suspekte predictions fundet med de nuværende tærskler.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {suspects.slice(0, 40).map((s) => {
              const alphaPct = (s.c.v3Alpha ?? 0) * 100;
              return (
                <div key={s.c.id} className="flex items-start justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <Link href={`/on-market/${s.c.id}`} className="font-medium text-slate-900 hover:text-blue-700 hover:underline">
                      {s.c.address}
                    </Link>
                    <div className="text-xs text-slate-400">
                      {s.c.postalCode} · {s.c.kvm} m² · {s.c.yearBuilt ?? '?'} · udbud {s.c.listPrice ? formatKr(s.c.listPrice) : '–'} · AVM {Math.round(s.c.avmPricePerSqm!).toLocaleString('da-DK')} kr/m²
                    </div>
                    <ul className="mt-1.5 space-y-0.5">
                      {s.reasons.map((r, i) => (
                        <li key={i} className="text-xs text-rose-700">✗ {r}</li>
                      ))}
                    </ul>
                  </div>
                  <div className={'flex-none text-right text-sm font-bold tabular-nums ' + (alphaPct >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                    α {alphaPct >= 0 ? '+' : ''}{alphaPct.toFixed(1)}%
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}

// ─── UI-hjælpere ─────────────────────────────────────────────────────────────

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'amber' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1.5 text-xl font-bold tabular-nums tracking-tight ${tone === 'amber' ? 'text-amber-700' : tone === 'emerald' ? 'text-emerald-700' : 'text-slate-900'}`}>
        {value}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold tracking-tight text-slate-900">{title}</div>
      {children}
    </div>
  );
}

function BiasTable({ title, rows }: { title: string; rows: SegmentBias[] }) {
  return (
    <Section title={title}>
      {rows.length === 0 ? (
        <p className="p-4 text-xs text-slate-400">For få cases med comps (min. 8 per segment).</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] font-medium uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2">Segment</th>
              <th className="px-3 py-2 text-right" title="Median af (comp-median − AVM)/AVM. Positiv = modellen undervurderer.">Bias</th>
              <th className="px-3 py-2 text-right" title="Spredning — høj = modellen er usikker i segmentet">±</th>
              <th className="px-3 py-2 text-right">n</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-slate-100">
                <td className="px-3 py-2">{r.label}</td>
                <td className={'px-3 py-2 text-right font-semibold tabular-nums ' + (Math.abs(r.medianBiasPct) >= 10 ? 'text-rose-700' : Math.abs(r.medianBiasPct) >= 5 ? 'text-amber-700' : 'text-emerald-700')}>
                  {r.medianBiasPct > 0 ? '+' : ''}{r.medianBiasPct.toFixed(1)}%
                </td>
                <td className={'px-3 py-2 text-right text-xs tabular-nums ' + (r.spreadPct > 14 ? 'text-rose-600' : 'text-slate-400')}>
                  {r.spreadPct.toFixed(1)}%
                </td>
                <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-400">{r.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}
