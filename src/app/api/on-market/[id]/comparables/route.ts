/**
 * Comparable sales for en on-market kandidat.
 *
 * Slår op i vores egen DB (alle scrapede kandidaters historical_sales)
 * og finder handler indenfor de seneste 5 år i samme postnummer
 * med ±25% kvm-tolerance.
 */
import { NextResponse } from 'next/server';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { onMarketCandidates } from '@/lib/db/schema';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!db) return NextResponse.json({ error: 'DB ikke konfigureret' }, { status: 500 });
  const { id } = await params;

  const [subject] = await db.select().from(onMarketCandidates).where(eq(onMarketCandidates.id, id));
  if (!subject) return NextResponse.json({ error: 'Ikke fundet' }, { status: 404 });

  const subjectKvm = subject.kvm ?? 0;
  const kvmMin = Math.floor(subjectKvm * 0.75);
  const kvmMax = Math.ceil(subjectKvm * 1.25);
  const subjectPostal = subject.postalCode;
  const subjectBydel = subject.bydel;

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

  // Trin 1: prøv samme postnr (mest precise sammenligning)
  let scope: 'postnr' | 'bydel' = 'postnr';
  let peers = await queryPeers('postnr');

  // Udflad historik til en flad liste af handler
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 5);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  interface Sale {
    date: string;
    amount: number;
    perAreaPrice: number;
    address: string;
    kvm: number;
    yearBuilt: number | null;
    isSelf: boolean;
  }

  function collectSales(peerRows: typeof peers): Sale[] {
    const sales: Sale[] = [];
    for (const p of peerRows) {
      const hist = p.historicalSales as Array<{
        date: string;
        amount: number;
        type: string;
      }> | null;
      if (!hist) continue;
      for (const s of hist) {
        if (s.type !== 'normal') continue;
        if (s.date < cutoffStr) continue;
        if (!s.amount || s.amount < 100_000) continue;
        const kvm = p.kvm ?? 0;
        sales.push({
          date: s.date,
          amount: s.amount,
          perAreaPrice: kvm > 0 ? Math.round(s.amount / kvm) : 0,
          address: p.address,
          kvm,
          yearBuilt: p.yearBuilt,
          isSelf: p.id === id,
        });
      }
    }
    sales.sort((a, b) => (a.date < b.date ? 1 : -1));
    return sales;
  }

  let sales = collectSales(peers);

  // Trin 2: hvis < 3 NYLIGE filtrerede handler, udvid til hele bydelen
  if (sales.length < 3 && subjectBydel) {
    scope = 'bydel';
    peers = await queryPeers('bydel');
    sales = collectSales(peers);
  }

  const ppm = sales.filter((s) => s.perAreaPrice > 0).map((s) => s.perAreaPrice).sort((a, b) => a - b);
  const median = ppm.length > 0 ? ppm[Math.floor(ppm.length / 2)] : null;

  const compBasedFmv = median && subjectKvm > 0 ? Math.round(median * subjectKvm) : null;

  return NextResponse.json({
    subjectKvm,
    subjectPostal,
    subjectBydel,
    scope,
    medianPerSqm: median,
    compBasedFmv,
    sampleSize: sales.length,
    sales: sales.slice(0, 25),
  });
}
