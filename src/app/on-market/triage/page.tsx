/**
 * Triage-inbox: én kandidat ad gangen, tag stilling og videre.
 *
 * Køen = Top picks-kandidaterne (samme pool som pickCurated) filtreret til
 * reviewStatus='ny'. Når køen er tom er du "inbox zero" indtil næste scrape
 * finder nye kandidater.
 *
 * Handlinger: Interesseret (i) · Pas med årsag (p) · Senere (s)
 * Pas-årsager gemmes som træningsdata — over tid lærer vi hvor AVM/gates
 * afviger fra Jacobs faktiske vurdering.
 */
import { db } from '@/lib/db/client';
import { externalSales, onMarketCandidates } from '@/lib/db/schema';
import { desc, gte } from 'drizzle-orm';
import { computeStrongFreshCompMap } from '@/lib/strongComps';
import { computeCalibration } from '@/lib/avmCalibration';
import { TriageClient } from './triage-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Triage — iBuyReal' };

export default async function TriagePage() {
  if (!db) return <div className="text-sm text-slate-500">DB ikke konfigureret.</div>;

  const rows = await db
    .select()
    .from(onMarketCandidates)
    .orderBy(desc(onMarketCandidates.v3AfkastBest));

  const cutoff4m = new Date();
  cutoff4m.setMonth(cutoff4m.getMonth() - 4);
  const extRows = await db
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
    .where(gte(externalSales.saleDate, cutoff4m.toISOString().slice(0, 10)));

  const strongFreshMap = computeStrongFreshCompMap(rows, extRows, { monthsBack: 3 });
  const calibration = computeCalibration(rows, strongFreshMap);

  return (
    <TriageClient initial={rows} strongFreshMap={strongFreshMap} calibration={calibration} />
  );
}
