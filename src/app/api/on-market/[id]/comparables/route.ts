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
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { onMarketCandidates } from '@/lib/db/schema';

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
  /** 0-100 similarity til subject */
  similarity: number;
  /** Bekræfter buy-tesen */
  thesisCategory: 'above-list' | 'validating-fmv' | 'reference';
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
            ? eq(onMarketCandidates.postalCode, subjectPostal)
            : eq(onMarketCandidates.bydel, subjectBydel ?? ''),
          isNotNull(onMarketCandidates.historicalSales),
          sql`${onMarketCandidates.kvm} BETWEEN ${kvmMin} AND ${kvmMax}`,
        ),
      );
  }

  // 6-års cutoff for reference, 4-år for strong (vægter recency men holder volume)
  const cutoff6y = new Date();
  cutoff6y.setFullYear(cutoff6y.getFullYear() - 6);
  const cutoff6yStr = cutoff6y.toISOString().slice(0, 10);
  const cutoff4y = new Date();
  cutoff4y.setFullYear(cutoff4y.getFullYear() - 4);
  const cutoff4yStr = cutoff4y.toISOString().slice(0, 10);

  function similarity(peer: {
    kvm: number | null;
    yearBuilt: number | null;
    postalCode: string;
  }, saleDate: string): number {
    let score = 0;
    // kvm-nærhed (max 35) — eksponentiel falloff
    if (peer.kvm && subjectKvm) {
      const diff = Math.abs(peer.kvm - subjectKvm) / subjectKvm;
      score += Math.max(0, 35 - diff * 150);
    }
    // byggeår-nærhed (max 25)
    if (peer.yearBuilt && subjectYear) {
      const yearDiff = Math.abs(peer.yearBuilt - subjectYear);
      score += Math.max(0, 25 - yearDiff * 1.5);
    }
    // dato-nyhed (max 30) — yngre = bedre
    const saleYear = parseInt(saleDate.slice(0, 4));
    const ageYears = 2026 - saleYear;
    score += Math.max(0, 30 - ageYears * 6);
    // lokalitet
    if (peer.postalCode === subjectPostal) score += 10;
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

        sales.push({
          date: s.date,
          amount: s.amount,
          perAreaPrice: ppm,
          address: p.address,
          kvm,
          yearBuilt: p.yearBuilt,
          postalCode: p.postalCode,
          isSelf: p.id === id,
          similarity: similarity(p, s.date),
          thesisCategory,
        });
      }
    }
    return sales;
  }

  // Trin 1: prøv postnr med 6-års vindue
  let scope: 'postnr' | 'bydel' = 'postnr';
  let peers = await queryPeers('postnr');
  let allSales = collectSales(peers, cutoff6yStr);

  // Trin 2: hvis < 5 nylige handler, udvid til bydel
  if (allSales.length < 5 && subjectBydel) {
    scope = 'bydel';
    peers = await queryPeers('bydel');
    allSales = collectSales(peers, cutoff6yStr);
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

  // Strong comps: above-list eller validating-fmv, 4-års vindue, similarity ≥ 30.
  // Hvis < 3 efter strikt filter:
  //   trin 2: drop similarity (4 år, kategori-only)
  //   trin 3: udvid til 6 år (uden similarity)
  let strongComps = allSales
    .filter(
      (s) =>
        s.date >= cutoff4yStr &&
        s.similarity >= 30 &&
        (s.thesisCategory === 'above-list' || s.thesisCategory === 'validating-fmv'),
    )
    .slice(0, 10);

  if (strongComps.length < 3) {
    strongComps = allSales
      .filter(
        (s) =>
          s.date >= cutoff4yStr &&
          (s.thesisCategory === 'above-list' || s.thesisCategory === 'validating-fmv'),
      )
      .slice(0, 10);
  }

  if (strongComps.length < 3) {
    strongComps = allSales
      .filter(
        (s) => s.thesisCategory === 'above-list' || s.thesisCategory === 'validating-fmv',
      )
      .slice(0, 10);
  }

  // Aggregate verdict
  const aboveListCount = allSales.filter((s) => s.thesisCategory === 'above-list').length;
  const validatingCount = allSales.filter((s) => s.thesisCategory === 'validating-fmv').length;
  const strongCompsMedian =
    strongComps.length > 0
      ? strongComps.map((s) => s.perAreaPrice).sort((a, b) => a - b)[
          Math.floor(strongComps.length / 2)
        ]
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
    aboveListCount,
    validatingCount,
    sampleSize: allSales.length,
    sales: allSales.slice(0, 25),
    strongComps,
  });
}
