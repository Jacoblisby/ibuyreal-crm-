/**
 * Comparable sales for en on-market kandidat.
 *
 * Returnerer både alle nylige handler i området OG en kurateret "strong comps"-liste —
 * sales der validerer købstesen:
 *   - sold above subject's listPrice/m² (proves underpricing)
 *   - sold near subject's FMV/m² (AVM bekræftet)
 *
 * Similarity-score (0-100) baseret på:
 *   - kvm-nærhed (max 35)
 *   - byggeår-nærhed (max 25)
 *   - dato-nyhed (max 30)
 *   - lokalitet (samme postnr +10, samme bydel +5)
 */
import { NextResponse } from 'next/server';
import { and, eq, gte, isNotNull, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { externalSales, onMarketCandidates } from '@/lib/db/schema';
import { clusterRanges } from '@/lib/postnrClusters';

interface RawSale {
  date: string;
  amount: number;
  type: string;
}

interface CompSale {
  date: string;
  amount: number;
  perAreaPrice: number;
  address: string;
  kvm: number;
  yearBuilt: number | null;
  postalCode: string;
  isSelf: boolean;
  /** Måneder siden handlen */
  ageMonths: number;
  /** Pct delta vs subjectListPpm (positiv = solgt OVER udbud) */
  vsList: number | null;
  /** Pct delta vs subjectFmvPpm (positiv = solgt OVER vores FMV) */
  vsFmv: number | null;
  /** 0-100 similarity til subject */
  similarity: number;
  /** Bekræfter buy-tesen */
  thesisCategory: 'above-list' | 'validating-fmv' | 'reference';
  /** 'internal' = fra vores scrape · 'resight' = ekstern tinglysningsdata */
  source: 'internal' | 'resight';
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!db) return NextResponse.json({ error: 'DB ikke konfigureret' }, { status: 500 });
  const { id } = await params;

  const [subject] = await db.select().from(onMarketCandidates).where(eq(onMarketCandidates.id, id));
  if (!subject) return NextResponse.json({ error: 'Ikke fundet' }, { status: 404 });

  const subjectKvm = subject.kvm ?? 0;
  const subjectYear = subject.yearBuilt ?? null;
  const subjectListPpm = subject.kvm && subject.listPrice ? subject.listPrice / subject.kvm : 0;
  const subjectFmvPpm = subject.kvm && subject.v3Fmv ? subject.v3Fmv / subject.kvm : 0;
  const subjectPostal = subject.postalCode;
  const subjectBydel = subject.bydel;

  // Bredere kvm-tolerance når vi leder efter strong comps (±30%) — vi vil have nok kandidater
  const kvmMin = Math.floor(subjectKvm * 0.7);
  const kvmMax = Math.ceil(subjectKvm * 1.3);

  // Pris-klynge i stedet for exact postnr: centrum har 1-7 handler pr. mikro-zip,
  // så matching sker på empirisk validerede klynger (se postnrClusters.ts).
  // For store postnumre (2000, 2100...) er klyngen = [postnr, postnr] — identisk adfærd.
  const subjectClusterRanges = clusterRanges(subjectPostal);
  const clusterCondition = (col: typeof externalSales.postalCode | typeof onMarketCandidates.postalCode) =>
    or(...subjectClusterRanges.map(([from, to]) => sql`(${col})::int BETWEEN ${from} AND ${to}`));

  async function queryPeers(by: 'postnr' | 'bydel') {
    return db
      .select({
        id: onMarketCandidates.id,
        address: onMarketCandidates.address,
        postalCode: onMarketCandidates.postalCode,
        kvm: onMarketCandidates.kvm,
        yearBuilt: onMarketCandidates.yearBuilt,
        historicalSales: onMarketCandidates.historicalSales,
      })
      .from(onMarketCandidates)
      .where(
        and(
          by === 'postnr'
            ? clusterCondition(onMarketCandidates.postalCode)
            : eq(onMarketCandidates.bydel, subjectBydel ?? ''),
          isNotNull(onMarketCandidates.historicalSales),
          sql`${onMarketCandidates.kvm} BETWEEN ${kvmMin} AND ${kvmMax}`,
        ),
      );
  }

  // Tids-cutoffs — comps SKAL være FRISKE (real-estate standard er 6 mdr).
  // 4y = reference-pool / median-grundlag (bredt nok til CAGR-trend)
  // 6m / 12m / 24m = strong-comps tiers (degraderer kun ved coverage-mangel)
  const now = new Date();
  const offsetMonths = (m: number) => {
    const d = new Date(now);
    d.setMonth(d.getMonth() - m);
    return d.toISOString().slice(0, 10);
  };
  const cutoff4mStr = offsetMonths(4);
  const cutoff6mStr = offsetMonths(6);
  const cutoff12mStr = offsetMonths(12);
  const cutoff24mStr = offsetMonths(24);
  const cutoff4y = new Date(now);
  cutoff4y.setFullYear(cutoff4y.getFullYear() - 4);
  const cutoff4yStr = cutoff4y.toISOString().slice(0, 10);

  // Hard filter: opførselsår skal være indenfor ±25 år af subject
  const yearBuiltTolerance = 25;
  const nowMs = now.getTime();
  const DAY_MS = 1000 * 60 * 60 * 24;

  function similarity(peer: {
    kvm: number | null;
    yearBuilt: number | null;
    postalCode: string;
  }, saleDate: string): number {
    let score = 0;
    // TIME-NÆRHED (max 50) — DOMINANT FAKTOR
    // Lineær falloff: 0 dage = 50, 365 dage = 38, 730 dage = 25, 1460 dage = 0
    const saleMs = new Date(saleDate).getTime();
    const ageDays = Math.max(0, (nowMs - saleMs) / DAY_MS);
    score += Math.max(0, 50 - (ageDays / 1460) * 50);

    // BYGGEÅR-NÆRHED (max 30) — sekundær faktor
    // Hard filter er allerede applied i collectSales, så her bare grade scoring
    if (peer.yearBuilt && subjectYear) {
      const yearDiff = Math.abs(peer.yearBuilt - subjectYear);
      score += Math.max(0, 30 - yearDiff * 1.2);
    } else {
      // Manglende byggeår → del af score gives ikke
      score += 10;
    }

    // KVM-NÆRHED (max 15) — minor faktor
    if (peer.kvm && subjectKvm) {
      const diff = Math.abs(peer.kvm - subjectKvm) / subjectKvm;
      score += Math.max(0, 15 - diff * 60);
    }

    // LOKALITET (max 5) — bonus
    if (peer.postalCode === subjectPostal) score += 5;

    return Math.min(100, Math.round(score));
  }

  function collectSales(
    peerRows: Awaited<ReturnType<typeof queryPeers>>,
    cutoffStr: string,
  ): CompSale[] {
    const sales: CompSale[] = [];
    for (const p of peerRows) {
      const hist = p.historicalSales as RawSale[] | null;
      if (!hist) continue;
      // HARD FILTER: byggeår skal ligge indenfor ±25 år af subject
      if (
        subjectYear &&
        p.yearBuilt &&
        Math.abs(p.yearBuilt - subjectYear) > yearBuiltTolerance
      ) {
        continue;
      }
      for (const s of hist) {
        if (s.type !== 'normal') continue;
        if (s.date < cutoffStr) continue;
        if (!s.amount || s.amount < 100_000) continue;
        const kvm = p.kvm ?? 0;
        const ppm = kvm > 0 ? Math.round(s.amount / kvm) : 0;
        if (ppm === 0) continue;

        // Klassificér thesis-kategori
        let thesisCategory: 'above-list' | 'validating-fmv' | 'reference' = 'reference';
        if (subjectListPpm && ppm >= subjectListPpm * 1.0) {
          // Solgt til mindst udbudsprisen pr m² → beviser at udbud er ikke for høj
          thesisCategory = 'above-list';
        } else if (
          subjectFmvPpm &&
          ppm >= subjectFmvPpm * 0.92 &&
          ppm <= subjectFmvPpm * 1.15
        ) {
          // Solgt indenfor ±15% af AVM-FMV → bekræfter AVM
          thesisCategory = 'validating-fmv';
        }

        const ageMonths =
          Math.max(0, (nowMs - new Date(s.date).getTime()) / DAY_MS) / 30.44;

        sales.push({
          date: s.date,
          amount: s.amount,
          perAreaPrice: ppm,
          address: p.address,
          kvm,
          yearBuilt: p.yearBuilt,
          postalCode: p.postalCode,
          isSelf: p.id === id,
          ageMonths: Math.round(ageMonths * 10) / 10,
          vsList: subjectListPpm ? (ppm - subjectListPpm) / subjectListPpm : null,
          vsFmv: subjectFmvPpm ? (ppm - subjectFmvPpm) / subjectFmvPpm : null,
          similarity: similarity(p, s.date),
          thesisCategory,
          source: 'internal',
        });
      }
    }
    return sales;
  }

  // ─── EKSTERN POOL: Resight tinglysningsdata ──────────────────────────────
  // Friske private handler (≤4 år, samme postnr, kvm ±30%) fra hele KBH-coverage —
  // ikke begrænset til adresser vi pt. scraper. Det giver markant flere comps,
  // især i den 6-mdr-friske ende hvor vores scrape-coverage er tynd.
  async function queryExternalSales(by: 'postnr' | 'bydel'): Promise<CompSale[]> {
    if (by === 'bydel') {
      // external_sales har ikke bydel — vi mapper alle postnr i samme bydel
      // (kun relevant ved fallback, sjældent brugt). Skip for nu.
      return [];
    }
    const rows = await db
      .select({
        address: externalSales.address,
        saleDate: externalSales.saleDate,
        amount: externalSales.amount,
        kvm: externalSales.kvm,
        perAreaPrice: externalSales.perAreaPrice,
        yearBuilt: externalSales.yearBuilt,
        postalCode: externalSales.postalCode,
      })
      .from(externalSales)
      .where(
        and(
          clusterCondition(externalSales.postalCode),
          gte(externalSales.saleDate, cutoff4yStr),
          sql`${externalSales.kvm} BETWEEN ${kvmMin} AND ${kvmMax}`,
        ),
      );

    const out: CompSale[] = [];
    for (const r of rows) {
      if (!r.kvm || r.kvm <= 0 || !r.amount) continue;

      // HARD FILTER: byggeår ±25 år (samme som for internal historicalSales).
      // Hvis Resight har et byggeår OG vi har subject's, så enforce.
      // Hvis Resight ikke har byggeår, accepter (data-mangel skal ikke straffe).
      if (
        subjectYear &&
        r.yearBuilt &&
        Math.abs(r.yearBuilt - subjectYear) > yearBuiltTolerance
      ) {
        continue;
      }

      const ppm = r.perAreaPrice ?? r.amount / r.kvm;
      if (ppm < 5_000) continue; // sanity floor

      let thesisCategory: 'above-list' | 'validating-fmv' | 'reference' = 'reference';
      if (subjectListPpm && ppm >= subjectListPpm * 1.0) {
        thesisCategory = 'above-list';
      } else if (
        subjectFmvPpm &&
        ppm >= subjectFmvPpm * 0.92 &&
        ppm <= subjectFmvPpm * 1.15
      ) {
        thesisCategory = 'validating-fmv';
      }

      const ageMonths =
        Math.max(0, (nowMs - new Date(r.saleDate).getTime()) / DAY_MS) / 30.44;

      out.push({
        date: r.saleDate,
        amount: r.amount,
        perAreaPrice: Math.round(ppm),
        address: r.address,
        kvm: r.kvm,
        yearBuilt: r.yearBuilt,
        postalCode: r.postalCode,
        isSelf: false,
        ageMonths: Math.round(ageMonths * 10) / 10,
        vsList: subjectListPpm ? (ppm - subjectListPpm) / subjectListPpm : null,
        vsFmv: subjectFmvPpm ? (ppm - subjectFmvPpm) / subjectFmvPpm : null,
        similarity: similarity({ kvm: r.kvm, yearBuilt: r.yearBuilt, postalCode: r.postalCode }, r.saleDate),
        thesisCategory,
        source: 'resight',
      });
    }
    return out;
  }

  // ─── DEDUP: undgå at samme handel tælles dobbelt ─────────────────────────
  // (Hvis Resight-handel matcher en internal historicalSales på dato+adresse,
  //  beholder vi den interne — den har byggeår.)
  function dedupe(sales: CompSale[]): CompSale[] {
    const seen = new Set<string>();
    const out: CompSale[] = [];
    // Sortér internal først (foretrukken)
    sales.sort((a, b) => (a.source === 'internal' ? -1 : b.source === 'internal' ? 1 : 0));
    for (const s of sales) {
      const key = `${s.date}|${s.address.toLowerCase().replace(/\s+/g, '')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
    return out;
  }

  // Trin 1: prøv postnr med 4-års vindue (friske comps)
  let scope: 'postnr' | 'bydel' = 'postnr';
  let peers = await queryPeers('postnr');
  const externalForPostnr = await queryExternalSales('postnr');
  let allSales = dedupe([...collectSales(peers, cutoff4yStr), ...externalForPostnr]);

  // Trin 2: hvis < 5 nylige handler, udvid til bydel (stadig 4 år, kun internal)
  if (allSales.length < 5 && subjectBydel) {
    scope = 'bydel';
    peers = await queryPeers('bydel');
    allSales = dedupe([...collectSales(peers, cutoff4yStr), ...externalForPostnr]);
  }

  // Sort by similarity desc, then recency
  allSales.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    return a.date < b.date ? 1 : -1;
  });

  // Median fra hele samlen
  const ppmArr = allSales.map((s) => s.perAreaPrice).sort((a, b) => a - b);
  const median = ppmArr.length > 0 ? ppmArr[Math.floor(ppmArr.length / 2)] : null;
  const compBasedFmv = median && subjectKvm > 0 ? Math.round(median * subjectKvm) : null;

  // Strong comps: thesis-hits (solgt ≥ udbud ELLER inden for FMV-bånd).
  // Cascade fra strikt 4 mdr → 6 mdr → 12 mdr → 24 mdr → 4 år.
  // 6 mdr er real-estate-industriens guld-standard — vi degraderer kun ved coverage-mangel.
  const isThesisHit = (s: CompSale) =>
    s.thesisCategory === 'above-list' || s.thesisCategory === 'validating-fmv';

  const tiers: Array<{ cutoff: string; label: string }> = [
    { cutoff: cutoff4mStr, label: '4m' },
    { cutoff: cutoff6mStr, label: '6m' },
    { cutoff: cutoff12mStr, label: '12m' },
    { cutoff: cutoff24mStr, label: '24m' },
    { cutoff: cutoff4yStr, label: '4y' },
  ];

  let strongComps: CompSale[] = [];
  let strongCompsTier: string = '4y';
  for (const { cutoff, label } of tiers) {
    const tierHits = allSales
      .filter((s) => s.date >= cutoff && isThesisHit(s))
      .slice(0, 10);
    if (tierHits.length >= 3) {
      strongComps = tierHits;
      strongCompsTier = label;
      break;
    }
    // Hold fast i den bedste tier vi har, hvis ingen senere giver ≥3
    if (tierHits.length > strongComps.length) {
      strongComps = tierHits;
      strongCompsTier = label;
    }
  }

  // Aggregate verdict
  const aboveListCount = allSales.filter((s) => s.thesisCategory === 'above-list').length;
  const validatingCount = allSales.filter((s) => s.thesisCategory === 'validating-fmv').length;
  const fresh6mCount = allSales.filter((s) => s.date >= cutoff6mStr).length;
  const fresh12mCount = allSales.filter((s) => s.date >= cutoff12mStr).length;
  const strongCompsMedian =
    strongComps.length > 0
      ? strongComps.map((s) => s.perAreaPrice).sort((a, b) => a - b)[
          Math.floor(strongComps.length / 2)
        ]
      : null;

  // Median delta vs udbud / vores FMV på strong comps (de tal investoren skal læse først)
  const strongCompsVsList =
    strongComps.length > 0 && subjectListPpm
      ? (strongCompsMedian! - subjectListPpm) / subjectListPpm
      : null;
  const strongCompsVsFmv =
    strongComps.length > 0 && subjectFmvPpm
      ? (strongCompsMedian! - subjectFmvPpm) / subjectFmvPpm
      : null;

  return NextResponse.json({
    subjectKvm,
    subjectPostal,
    subjectBydel,
    subjectListPpm,
    subjectFmvPpm,
    scope,
    medianPerSqm: median,
    compBasedFmv,
    strongCompsMedian,
    strongCompsCount: strongComps.length,
    strongCompsTier,
    strongCompsVsList,
    strongCompsVsFmv,
    aboveListCount,
    validatingCount,
    fresh6mCount,
    fresh12mCount,
    sampleSize: allSales.length,
    externalSalesCount: allSales.filter((s) => s.source === 'resight').length,
    internalSalesCount: allSales.filter((s) => s.source === 'internal').length,
    sales: allSales.slice(0, 25),
    strongComps,
  });
}
