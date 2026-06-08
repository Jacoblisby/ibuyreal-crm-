/**
 * AVM-faldgrupber: data-drevet liste af kendte modelfejl med konkrete cases.
 *
 * Kun mønstre med tilstrækkelig sample-size (≥20 cases eller klare patterns)
 * er inkluderet. Sample-størrelser vises eksplicit ved hver finding.
 *
 * Bruges af team til:
 *  - At forstå hvor AVM systematisk fejler
 *  - At sende konkrete eksempler til Lambda-teamet
 *  - Som training-input til retrain
 */
import Link from 'next/link';
import { db } from '@/lib/db/client';
import { externalSales, onMarketCandidates } from '@/lib/db/schema';
import { and, eq, gte } from 'drizzle-orm';
import { isConcreteEra, isGroundFloor, isNoisyStreet } from '@/lib/quality';
import type { OnMarketCandidate } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AVM faldgrupber — iBuyReal' };

const SAMPLE_THRESHOLD = 20; // kun bydele/æraer med ≥20 cases vises

interface Pattern {
  label: string;
  ourValue: number; // bias-pct
  spread?: number;
  n: number;
}

export default async function AvmFaldgrupberPage() {
  if (!db) return <div className="text-sm text-slate-500">DB ikke konfigureret.</div>;

  // ─── Hent alle active candidates + AVM-prediction ──────────────────────
  const rows = await db
    .select()
    .from(onMarketCandidates)
    .where(
      and(
        eq(onMarketCandidates.status, 'active'),
        eq(onMarketCandidates.v3FmvSource, 'ibuyreal-avm'),
      ),
    );

  // ─── Hent friske external sales ────────────────────────────────────────
  const cutoff3m = new Date();
  cutoff3m.setMonth(cutoff3m.getMonth() - 3);
  const cutoff3mStr = cutoff3m.toISOString().slice(0, 10);

  const extRows = await db
    .select({
      postalCode: externalSales.postalCode,
      saleDate: externalSales.saleDate,
      kvm: externalSales.kvm,
      perAreaPrice: externalSales.perAreaPrice,
      amount: externalSales.amount,
      yearBuilt: externalSales.yearBuilt,
    })
    .from(externalSales)
    .where(gte(externalSales.saleDate, cutoff3mStr));

  // Index per postnr for speed
  const extByPostnr = new Map<string, typeof extRows>();
  for (const e of extRows) {
    const arr = extByPostnr.get(e.postalCode) ?? [];
    arr.push(e);
    extByPostnr.set(e.postalCode, arr);
  }

  // ─── Beregn AVM-bias per case (market_median / avm) ────────────────────
  type WithBias = OnMarketCandidate & { marketPpm: number | null; biasPct: number | null };
  const withBias: WithBias[] = rows.map((c) => {
    if (!c.kvm || !c.avmPricePerSqm) return { ...c, marketPpm: null, biasPct: null };
    const peers = (extByPostnr.get(c.postalCode) ?? []).filter((e) => {
      if (!e.kvm) return false;
      const inKvm = e.kvm >= c.kvm! * 0.7 && e.kvm <= c.kvm! * 1.3;
      if (!inKvm) return false;
      if (c.yearBuilt && e.yearBuilt && Math.abs(e.yearBuilt - c.yearBuilt) > 25) return false;
      return true;
    });
    if (peers.length < 3) return { ...c, marketPpm: null, biasPct: null };
    const ppms = peers
      .map((p) => p.perAreaPrice ?? p.amount / p.kvm!)
      .sort((a, b) => a - b);
    const market = ppms[Math.floor(ppms.length / 2)];
    const bias = (market - c.avmPricePerSqm) / c.avmPricePerSqm;
    if (bias < -0.5 || bias > 0.5) return { ...c, marketPpm: market, biasPct: null }; // outlier
    return { ...c, marketPpm: market, biasPct: bias * 100 };
  });

  const validBias = withBias.filter((w) => w.biasPct !== null);

  // ─── PATTERN 1: bydel-bias ─────────────────────────────────────────────
  const bydelGroups = new Map<string, number[]>();
  for (const w of validBias) {
    if (!w.bydel) continue;
    const arr = bydelGroups.get(w.bydel) ?? [];
    arr.push(w.biasPct!);
    bydelGroups.set(w.bydel, arr);
  }
  const bydelPatterns: Pattern[] = [];
  for (const [bydel, biases] of bydelGroups) {
    if (biases.length < SAMPLE_THRESHOLD) continue;
    const sorted = [...biases].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    bydelPatterns.push({ label: bydel, ourValue: median, n: biases.length });
  }
  bydelPatterns.sort((a, b) => Math.abs(b.ourValue) - Math.abs(a.ourValue));

  // ─── PATTERN 2: æra-bias ───────────────────────────────────────────────
  const eraGroups = new Map<string, number[]>();
  for (const w of validBias) {
    if (!w.yearBuilt) continue;
    let era: string;
    if (w.yearBuilt < 1900) era = 'pre 1900';
    else if (w.yearBuilt < 1920) era = '1900-1919';
    else if (w.yearBuilt < 1940) era = '1920-1939';
    else if (w.yearBuilt <= 1990) era = 'BETON 1950-1990';
    else if (w.yearBuilt < 2010) era = '1990-2009';
    else era = 'Post 2010';
    const arr = eraGroups.get(era) ?? [];
    arr.push(w.biasPct!);
    eraGroups.set(era, arr);
  }
  const eraPatterns: (Pattern & { era: string })[] = [];
  for (const [era, biases] of eraGroups) {
    if (biases.length < SAMPLE_THRESHOLD) continue;
    const sorted = [...biases].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const mean = biases.reduce((a, b) => a + b, 0) / biases.length;
    const stddev = Math.sqrt(biases.reduce((a, b) => a + (b - mean) ** 2, 0) / biases.length);
    eraPatterns.push({ label: era, era, ourValue: median, spread: stddev, n: biases.length });
  }
  const eraOrder: Record<string, number> = {
    'pre 1900': 0,
    '1900-1919': 1,
    '1920-1939': 2,
    'BETON 1950-1990': 3,
    '1990-2009': 4,
    'Post 2010': 5,
  };
  eraPatterns.sort((a, b) => (eraOrder[a.era] ?? 99) - (eraOrder[b.era] ?? 99));

  // ─── PATTERN 3: False negatives (AVM siger BAD, market siger GOOD) ─────
  const falseNegatives = validBias
    .filter(
      (w) =>
        w.v3Alpha !== null &&
        w.v3Alpha < -0.05 &&
        w.kvm &&
        w.listPrice &&
        w.marketPpm &&
        w.marketPpm > (w.listPrice / w.kvm) * 1.05,
    )
    .sort((a, b) => {
      const aA = a.marketPpm! / (a.listPrice! / a.kvm!) - 1;
      const bA = b.marketPpm! / (b.listPrice! / b.kvm!) - 1;
      return bA - aA;
    })
    .slice(0, 10);

  // ─── BARRIER-TEST: empirisk test af geografiske skillelinjer ──────────
  // Computer median ppm per postnummer fra Resight (sidste 12 mdr,
  // kvm 40-110 for at få sammenligneligt grundlag).
  const cutoff12m = new Date();
  cutoff12m.setMonth(cutoff12m.getMonth() - 12);
  const cutoff12mStr = cutoff12m.toISOString().slice(0, 10);

  const allSales12m = await db
    .select({
      postalCode: externalSales.postalCode,
      perAreaPrice: externalSales.perAreaPrice,
      amount: externalSales.amount,
      kvm: externalSales.kvm,
    })
    .from(externalSales)
    .where(gte(externalSales.saleDate, cutoff12mStr));

  const postnrPpm = new Map<string, number[]>();
  for (const s of allSales12m) {
    if (!s.kvm || s.kvm < 40 || s.kvm > 110) continue;
    const ppm = s.perAreaPrice ?? s.amount / s.kvm;
    const arr = postnrPpm.get(s.postalCode) ?? [];
    arr.push(ppm);
    postnrPpm.set(s.postalCode, arr);
  }
  const postnrMedian = new Map<string, { median: number; n: number }>();
  for (const [pc, ppms] of postnrPpm) {
    if (ppms.length < 5) continue;
    const sorted = [...ppms].sort((a, b) => a - b);
    postnrMedian.set(pc, {
      median: sorted[Math.floor(sorted.length / 2)],
      n: ppms.length,
    });
  }

  interface BarrierTest {
    name: string;
    sideA: { label: string; postnumre: string[] };
    sideB: { label: string; postnumre: string[] };
  }
  // Postnummer-clusters til at samle data fra flere små postnumre
  const INDRE_BY_N = ['1255', '1264', '1270', '1302', '1307', '1310', '1311', '1313', '1319'];
  const INDRE_BY_S = ['1352', '1356', '1361', '1362', '1370'];
  const CHRISTIANSHAVN = ['1400', '1401', '1408', '1415', '1420', '1422', '1424', '1425', '1427', '1428', '1429'];
  const HOLMEN = ['1436', '1437'];
  const VESTERBRO_KLASSISK = ['1620', '1650', '1666', '1671', '1717', '1720', '1721', '1722', '1731', '1740', '1741', '1751'];
  const VESTERBRO_KALVEBOD = ['1799', '1786', '1789'];
  const FREDERIKSBERG_N = ['1850', '1860', '1870', '1872', '1873', '1874', '1875', '1879', '1900', '1902', '1903', '1904', '1908', '1910', '1915', '1916', '1917', '1919', '1923', '1925', '1928', '1929'];
  const FREDERIKSBERG_S = ['1950', '1953', '1955', '1957', '1958', '1960', '1963', '1966', '1970', '1971', '1973'];

  const barrierTests: BarrierTest[] = [
    // ─── HAVN + CHRISTIANSHAVN-AKSEN ────────────────────────────────────
    { name: 'Inderhavnen (Christianshavn ↔ Indre By N)', sideA: { label: 'Christianshavn', postnumre: CHRISTIANSHAVN }, sideB: { label: 'Indre By N', postnumre: INDRE_BY_N } },
    { name: 'Holmen / Operaen ↔ Christianshavn', sideA: { label: 'Holmen', postnumre: HOLMEN }, sideB: { label: 'Christianshavn', postnumre: CHRISTIANSHAVN } },
    { name: 'Holmen ↔ Indre By N', sideA: { label: 'Holmen', postnumre: HOLMEN }, sideB: { label: 'Indre By N', postnumre: INDRE_BY_N } },
    { name: 'Sundby-broen (Christianshavn ↔ Amager)', sideA: { label: 'Christianshavn', postnumre: CHRISTIANSHAVN }, sideB: { label: 'Amager', postnumre: ['2300'] } },
    { name: 'Sydhavnen (Sydhavn ↔ Amager)', sideA: { label: 'Sydhavn', postnumre: ['2450'] }, sideB: { label: 'Amager', postnumre: ['2300'] } },

    // ─── INDRE BY INTERN ───────────────────────────────────────────────
    { name: 'Strøget-aksen (Indre By N ↔ Indre By S)', sideA: { label: 'Indre By N', postnumre: INDRE_BY_N }, sideB: { label: 'Indre By S', postnumre: INDRE_BY_S } },

    // ─── SØERNE-AKSEN ────────────────────────────────────────────────
    { name: 'Søerne (Indre By N ↔ Nørrebro)', sideA: { label: 'Indre By N', postnumre: INDRE_BY_N }, sideB: { label: 'Nørrebro', postnumre: ['2200'] } },
    { name: 'Søerne (Indre By N ↔ Østerbro)', sideA: { label: 'Indre By N', postnumre: INDRE_BY_N }, sideB: { label: 'Østerbro', postnumre: ['2100'] } },
    { name: 'Søerne (Frederiksberg ↔ Indre By N)', sideA: { label: 'Indre By N', postnumre: INDRE_BY_N }, sideB: { label: 'Frederiksberg', postnumre: ['2000'] } },

    // ─── VESTERBRO INTERN ─────────────────────────────────────────────
    { name: 'Vesterbro Kalvebod ↔ klassisk', sideA: { label: 'Kalvebod (1786-99)', postnumre: VESTERBRO_KALVEBOD }, sideB: { label: 'Vesterbro klassisk', postnumre: VESTERBRO_KLASSISK } },

    // ─── FREDERIKSBERG INTERN ─────────────────────────────────────────
    { name: 'Frederiksberg N ↔ S', sideA: { label: 'Frederiksberg S', postnumre: FREDERIKSBERG_S }, sideB: { label: 'Frederiksberg N', postnumre: FREDERIKSBERG_N } },
    { name: 'Frederiksberg-hovedpostnr ↔ Frederiksberg N', sideA: { label: 'Frb 2000', postnumre: ['2000'] }, sideB: { label: 'Frederiksberg N', postnumre: FREDERIKSBERG_N } },

    // ─── ØSTERBRO + NORDHAVN ──────────────────────────────────────────
    { name: 'Tagensvej / Jagtvej (Østerbro ↔ Nørrebro)', sideA: { label: 'Østerbro', postnumre: ['2100'] }, sideB: { label: 'Nørrebro', postnumre: ['2200'] } },
    { name: 'Strandboulevarden (Østerbro ↔ Nordhavn)', sideA: { label: 'Nordhavn', postnumre: ['2150'] }, sideB: { label: 'Østerbro', postnumre: ['2100'] } },
    { name: 'Hellerup ↔ Nordhavn (Tuborg-aksen)', sideA: { label: 'Hellerup', postnumre: ['2900'] }, sideB: { label: 'Nordhavn', postnumre: ['2150'] } },

    // ─── VESTERBRO ↔ FREDERIKSBERG ────────────────────────────────────
    { name: 'Vester Voldgade / Hovedbanegården (Vesterbro Kalvebod ↔ Frederiksberg)', sideA: { label: 'Kalvebod 1799', postnumre: VESTERBRO_KALVEBOD }, sideB: { label: 'Frederiksberg N', postnumre: FREDERIKSBERG_N } },
    { name: 'Vesterbro klassisk ↔ Frederiksberg', sideA: { label: 'Frederiksberg', postnumre: ['2000'] }, sideB: { label: 'Vesterbro klassisk', postnumre: VESTERBRO_KLASSISK } },

    // ─── VEST-AKSEN ───────────────────────────────────────────────────
    { name: 'Folehaven (Ring 2 — Sydhavn ↔ Valby)', sideA: { label: 'Sydhavn', postnumre: ['2450'] }, sideB: { label: 'Valby', postnumre: ['2500'] } },
    { name: 'Bispeengbuen (Frederiksberg ↔ Nordvest)', sideA: { label: 'Frederiksberg', postnumre: ['2000'] }, sideB: { label: 'Nordvest', postnumre: ['2400'] } },
    { name: 'Borups Allé (Nørrebro ↔ Nordvest)', sideA: { label: 'Nørrebro', postnumre: ['2200'] }, sideB: { label: 'Nordvest', postnumre: ['2400'] } },
    { name: 'Frederikssundsvej (Brønshøj ↔ Vanløse)', sideA: { label: 'Vanløse', postnumre: ['2720'] }, sideB: { label: 'Brønshøj', postnumre: ['2700'] } },
    { name: 'Nordvest-Brønshøj korridor', sideA: { label: 'Nordvest', postnumre: ['2400'] }, sideB: { label: 'Brønshøj', postnumre: ['2700'] } },
    { name: 'Roskildevej (Frederiksberg ↔ Vanløse)', sideA: { label: 'Frederiksberg', postnumre: ['2000'] }, sideB: { label: 'Vanløse', postnumre: ['2720'] } },

    // ─── NORD-AKSEN ───────────────────────────────────────────────────
    { name: 'Strandvejen / Ring 3 (Hellerup ↔ Lyngby)', sideA: { label: 'Hellerup', postnumre: ['2900'] }, sideB: { label: 'Lyngby', postnumre: ['2800'] } },
  ];

  function aggregatePostnumre(postnumre: string[]): { median: number; n: number } | null {
    const all: number[] = [];
    for (const pc of postnumre) {
      const arr = postnrPpm.get(pc);
      if (arr) all.push(...arr);
    }
    if (all.length < 3) return null;
    const sorted = [...all].sort((a, b) => a - b);
    return { median: sorted[Math.floor(sorted.length / 2)], n: all.length };
  }

  const barrierResults = barrierTests.map((t) => {
    const a = aggregatePostnumre(t.sideA.postnumre);
    const b = aggregatePostnumre(t.sideB.postnumre);
    let verdict: 'confirmed' | 'rejected' | 'insufficient' = 'insufficient';
    let gapPct: number | null = null;
    if (a && b) {
      gapPct = Math.abs(((a.median - b.median) / Math.min(a.median, b.median)) * 100);
      if (gapPct >= 8) verdict = 'confirmed';
      else if (gapPct < 3) verdict = 'rejected';
      else verdict = 'rejected'; // grey zone treated as not-confirmed
    }
    return { ...t, a, b, gapPct, verdict };
  });

  // ─── KATEGORI-EKSEMPLER: top fejl per kategori ─────────────────────────
  const categoryExamples = {
    stueetage: rows.filter((r) => isGroundFloor(r.address) && (r.v3Alpha ?? 0) > 0).sort((a, b) => (b.v3Alpha ?? 0) - (a.v3Alpha ?? 0)).slice(0, 3),
    beton: rows.filter((r) => isConcreteEra(r.yearBuilt) && (r.v3Alpha ?? 0) > 0).sort((a, b) => (b.v3Alpha ?? 0) - (a.v3Alpha ?? 0)).slice(0, 3),
    stoejgade: rows.filter((r) => isNoisyStreet(r.address) && (r.v3Alpha ?? 0) > 0).sort((a, b) => (b.v3Alpha ?? 0) - (a.v3Alpha ?? 0)).slice(0, 3),
    forStor: rows.filter((r) => (r.kvm ?? 0) > 100 && (r.v3Alpha ?? 0) > 0).sort((a, b) => (b.v3Alpha ?? 0) - (a.v3Alpha ?? 0)).slice(0, 3),
    nedslidt: rows.filter((r) => r.imageAssessment && r.imageAssessment.overall_condition < 6 && (r.v3Alpha ?? 0) > 0).sort((a, b) => (b.v3Alpha ?? 0) - (a.v3Alpha ?? 0)).slice(0, 3),
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AVM faldgrupber</h1>
        <p className="mt-1 text-sm text-slate-500">
          Data-drevet liste over hvor AVM-modellen systematisk fejler, med konkrete
          cases hvor det er gået galt. Kun mønstre med ≥{SAMPLE_THRESHOLD} cases er
          inkluderet — resten er for støjende til at konkludere på.
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Beregnet på {validBias.length} active cases med både AVM-prediction og ≥3 friske comps i samme postnr+kvm+byggeår-segment.
        </p>
      </div>

      {/* ─── PATTERN 1: Bydel-bias ──────────────────────────────────────── */}
      {bydelPatterns.length > 0 && (
        <Section
          n={1}
          title="AVM har systematisk bydel-bias"
          insight="Modellen er trænet på KBH-gennemsnit. Den fanger ikke at nogle bydele (Vesterbro, Frederiksberg) er steget hurtigere end andre. Bias er målt som median(market_ppm − avm_ppm) / avm_ppm."
        >
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] font-medium uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2">Bydel</th>
                  <th className="px-3 py-2 text-right">AVM-fejl</th>
                  <th className="px-3 py-2 text-right">Cases</th>
                  <th className="px-3 py-2">Retning</th>
                </tr>
              </thead>
              <tbody>
                {bydelPatterns.map((p) => (
                  <tr key={p.label} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-900">
                      {p.label.charAt(0).toUpperCase() + p.label.slice(1).replace('oe', 'ø').replace('aer', 'ær')}
                    </td>
                    <td
                      className={
                        'px-3 py-2 text-right tabular-nums font-semibold ' +
                        (Math.abs(p.ourValue) >= 8
                          ? 'text-rose-700'
                          : Math.abs(p.ourValue) >= 4
                          ? 'text-amber-700'
                          : 'text-slate-600')
                      }
                    >
                      {p.ourValue >= 0 ? '+' : ''}
                      {p.ourValue.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-500">n={p.n}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {p.ourValue > 5 ? 'AVM undershooter — vi MISSER fund' : p.ourValue < -5 ? 'AVM overshooter — falske positiver' : 'Næsten kalibreret'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* ─── PATTERN 2: Æra-bias ─────────────────────────────────────────── */}
      {eraPatterns.length > 0 && (
        <Section
          n={2}
          title="AVM har to blinde byggeår-æraer i hver sin retning"
          insight="Træningsdata er sandsynligvis vægtet mod klassisk stock (1900-1950). Beton-æra og post-2010 nybyg er minoriteter — modellen mangler signal. Spredning (stddev) viser hvor usikker modellen er per æra."
        >
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] font-medium uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2">Byggeår-æra</th>
                  <th className="px-3 py-2 text-right">AVM-fejl</th>
                  <th className="px-3 py-2 text-right">Spredning</th>
                  <th className="px-3 py-2 text-right">Cases</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {eraPatterns.map((p) => (
                  <tr key={p.era} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-900">{p.era}</td>
                    <td
                      className={
                        'px-3 py-2 text-right tabular-nums font-semibold ' +
                        (Math.abs(p.ourValue) >= 8
                          ? 'text-rose-700'
                          : Math.abs(p.ourValue) >= 4
                          ? 'text-amber-700'
                          : 'text-slate-600')
                      }
                    >
                      {p.ourValue >= 0 ? '+' : ''}
                      {p.ourValue.toFixed(1)}%
                    </td>
                    <td
                      className={
                        'px-3 py-2 text-right tabular-nums text-xs ' +
                        ((p.spread ?? 0) > 14 ? 'text-rose-700 font-medium' : 'text-slate-500')
                      }
                    >
                      ±{(p.spread ?? 0).toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-500">n={p.n}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {p.era === 'BETON 1950-1990' && '🧱 Overshoot + meget usikker'}
                      {p.era === 'Post 2010' && '🏗 Stor undershoot — modellen er bagud'}
                      {p.era === '1900-1919' && '✓ Klassisk — konsistent undershoot'}
                      {p.era === '1920-1939' && '✓ Pre-krigs — mindre undershoot'}
                      {p.era === '1990-2009' && '✓ Bedst kalibreret'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* ─── PATTERN 3: False negatives ──────────────────────────────────── */}
      {falseNegatives.length >= 3 && (
        <Section
          n={3}
          title="Vi MISSER ægte fund — AVM siger negativ, markedet siger positiv"
          insight={`${falseNegatives.length} cases hvor AVM siger casen er overpriced (α < -5%) men friske comps fra samme segment er solgt OVER udbud. AVM er for konservativ her — sandsynligvis fordi træningsdata er forældet.`}
        >
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] font-medium uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2">Adresse</th>
                  <th className="px-3 py-2 text-right">Bydel</th>
                  <th className="px-3 py-2 text-right">Bygget</th>
                  <th className="px-3 py-2 text-right">AVM α</th>
                  <th className="px-3 py-2 text-right">Marked vs udbud</th>
                </tr>
              </thead>
              <tbody>
                {falseNegatives.map((c) => {
                  const marketDelta = c.marketPpm! / (c.listPrice! / c.kvm!) - 1;
                  return (
                    <tr key={c.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium">
                        <Link href={`/on-market/${c.id}`} className="text-blue-700 hover:underline">
                          {c.address}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-slate-500">{c.bydel}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-500">{c.yearBuilt}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-rose-700 font-medium">
                        {((c.v3Alpha ?? 0) * 100).toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-700">
                        +{(marketDelta * 100).toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* ─── PATTERN 4: Barrier-test ───────────────────────────────────── */}
      <Section
        n={4}
        title="Geografiske skillelinjer — empirisk test"
        insight="Sammenligning af median ppm på tværs af foreslåede skillelinjer (sidste 12 mdr, kvm 40-110). Vi behandler en barriere som BEKRÆFTET hvis prisgap'et er ≥8% mellem postnumrene på hver side — under det er forskellen for lille til at konkludere det er en barriere snarere end almindelig bydels-variation."
      >
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] font-medium uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2">Skillelinje</th>
                <th className="px-3 py-2 text-right">Side A</th>
                <th className="px-3 py-2 text-right">Side B</th>
                <th className="px-3 py-2 text-right">Forskel</th>
                <th className="px-3 py-2">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {barrierResults.map((r) => (
                <tr key={r.name} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-900">{r.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">
                    {r.a ? (
                      <>
                        <span className="text-slate-700">{Math.round(r.a.median).toLocaleString('da-DK')}</span>
                        <span className="text-slate-400"> (n={r.a.n})</span>
                      </>
                    ) : (
                      <span className="text-slate-400">– ikke nok data</span>
                    )}
                    <div className="text-[10px] text-slate-400">{r.sideA.label}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">
                    {r.b ? (
                      <>
                        <span className="text-slate-700">{Math.round(r.b.median).toLocaleString('da-DK')}</span>
                        <span className="text-slate-400"> (n={r.b.n})</span>
                      </>
                    ) : (
                      <span className="text-slate-400">– ikke nok data</span>
                    )}
                    <div className="text-[10px] text-slate-400">{r.sideB.label}</div>
                  </td>
                  <td
                    className={
                      'px-3 py-2 text-right tabular-nums font-semibold ' +
                      (r.gapPct === null
                        ? 'text-slate-400'
                        : r.gapPct >= 15
                        ? 'text-rose-700'
                        : r.gapPct >= 8
                        ? 'text-amber-700'
                        : 'text-slate-500')
                    }
                  >
                    {r.gapPct === null ? '–' : `${r.gapPct.toFixed(1)}%`}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.verdict === 'confirmed' && (
                      <span className="inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                        ✓ Bekræftet barriere
                      </span>
                    )}
                    {r.verdict === 'rejected' && (
                      <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                        ✗ Ikke en reel barriere
                      </span>
                    )}
                    {r.verdict === 'insufficient' && (
                      <span className="inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                        ? For lidt data
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          <strong>Bemærk:</strong> Testen sammenligner kun postnummer-medianer. Reelle barrierer som Søerne og
          Carlsbergvej deler INDEN i et postnummer og kræver street-level data at teste rigoristisk. Tagensvej
          mellem 2100 og 2200 viser kun -1.6% — det er ikke et stort spring i de aggregerede tal, men siger
          ikke noget om gade-niveau på selve Tagensvej.
        </p>
      </Section>

      {/* ─── KATEGORI-EKSEMPLER ─────────────────────────────────────────── */}
      <Section
        n={5}
        title="Værste enkelt-cases pr. fejl-kategori"
        insight="Specifikke eksempler hvor AVM totalt misser en kategori. Send disse til Lambda-teamet som test-cases — modellen skal kunne flag dem korrekt efter retrain."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <CategoryBlock title="🏠 Stueetage (AVM kender ikke etage)" cases={categoryExamples.stueetage} />
          <CategoryBlock title="🧱 Beton-æra 1950-1990" cases={categoryExamples.beton} />
          <CategoryBlock title="📢 Støjgader" cases={categoryExamples.stoejgade} />
          <CategoryBlock title="📐 Over 100 m² (likviditets-rabat)" cases={categoryExamples.forStor} />
          {categoryExamples.nedslidt.length > 0 && (
            <CategoryBlock title="🖼 Nedslidt-stand (Vision-flag)" cases={categoryExamples.nedslidt} />
          )}
        </div>
      </Section>

      {/* ─── Action items ────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/40 p-5">
        <h2 className="text-base font-semibold text-emerald-900">Prioriteret roadmap til Lambda-team</h2>
        <ol className="mt-3 list-decimal pl-5 space-y-2 text-sm text-emerald-900">
          <li>
            <strong>Retrain quarterly på rullende 18-mdr Resight-data</strong> med stratified
            sampling per (bydel × æra). Fanger pattern 1 + 2 automatisk. Data klar i{' '}
            <Link href="/admin/training-export" className="underline">/admin/training-export</Link>.
          </li>
          <li>
            <strong>Tilføj <code>floor_number</code> + <code>is_ground_floor</code></strong> som
            påkrævede inputs. Fanger 8 stueetage-cases med α op til +37%.
          </li>
          <li>
            <strong>Tilføj <code>is_noisy_street</code> boolean</strong> (lookup-tabel haves
            i CRM). Fanger 4 støjgade-cases.
          </li>
          <li>
            <strong>Return <code>prediction_stddev</code></strong> per case. Beton-æra har
            spredning ±16% — modellen ved selv at den ikke er sikker, vi har bare ingen måde
            at vide det på.
          </li>
        </ol>
      </div>
    </div>
  );
}

function Section({
  n,
  title,
  insight,
  children,
}: {
  n: number;
  title: string;
  insight: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
          {n}
        </span>
        <h2 className="text-base font-semibold tracking-tight text-slate-900">{title}</h2>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-slate-600">{insight}</p>
      {children}
    </div>
  );
}

function CategoryBlock({
  title,
  cases,
}: {
  title: string;
  cases: OnMarketCandidate[];
}) {
  if (cases.length === 0) return null;
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/30 p-3">
      <div className="mb-2 text-[12px] font-semibold tracking-tight text-slate-800">{title}</div>
      <ul className="space-y-1.5 text-sm">
        {cases.map((c) => (
          <li key={c.id} className="flex items-baseline justify-between gap-2">
            <Link href={`/on-market/${c.id}`} className="truncate text-blue-700 hover:underline">
              {c.address}
            </Link>
            <span className="flex-none text-xs tabular-nums text-rose-700 font-semibold">
              AVM +{((c.v3Alpha ?? 0) * 100).toFixed(0)}%
            </span>
          </li>
        ))}
        <li className="pt-1 text-[10px] text-slate-400">
          {cases.length === 3 ? '3 værste vist · flere på on-market' : `${cases.length} cases i kategorien`}
        </li>
      </ul>
    </div>
  );
}

