import { db } from '@/lib/db/client';
import { externalSales, onMarketCandidates, scrapeJobs } from '@/lib/db/schema';
import { desc, gte } from 'drizzle-orm';
import { OnMarketClient } from './on-market-client';
import { computeStrongFreshCompMap } from '@/lib/strongComps';
import { computeCalibration } from '@/lib/avmCalibration';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'On-market — iBuyReal' };

export default async function OnMarketPage() {
  if (!db) return <div className="text-sm text-slate-500">DB ikke konfigureret.</div>;

  const rows = await db
    .select()
    .from(onMarketCandidates)
    .orderBy(desc(onMarketCandidates.v3AfkastBest));

  // Pre-load Resight-handler de seneste 4 mdr (lille pool — bruges som
  // ekstra peer-data til strong-fresh-comp gate i Top picks).
  // Curation kører client-side; ekstern data er ikke i candidate-row,
  // så vi pre-computer per-kandidat-tællingen server-side.
  // Bemærk: vi henter 4m så vi har lidt margin over de 3m vi bruger i gate'n.
  const cutoff6m = new Date();
  cutoff6m.setMonth(cutoff6m.getMonth() - 4);
  const cutoff6mStr = cutoff6m.toISOString().slice(0, 10);
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
    .where(gte(externalSales.saleDate, cutoff6mStr));

  const strongFreshMap = computeStrongFreshCompMap(rows, extRows, {
    monthsBack: 3,
  });

  // AVM-kalibrering: brug nuværende cases' AVM vs comp-median for at
  // beregne systematic bias. Genberegnes hver page-load (cheap).
  const calibration = computeCalibration(rows, strongFreshMap);

  const [lastJob] = await db
    .select()
    .from(scrapeJobs)
    .orderBy(desc(scrapeJobs.startedAt))
    .limit(1);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">On-market</h1>
          <p className="mt-1 text-sm text-slate-500">
            Boligsiden — 2-3 vær. ejerlejligheder i København + Frederiksberg
          </p>
        </div>
      </div>
      <OnMarketClient
        initial={rows}
        lastJob={lastJob ?? null}
        strongFreshMap={strongFreshMap}
        calibration={calibration}
      />
    </div>
  );
}
