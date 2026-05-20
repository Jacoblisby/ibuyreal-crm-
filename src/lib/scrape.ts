/**
 * On-market scrape worker.
 *
 * Flow:
 *  1. Insert ny scrape_jobs row (status=running)
 *  2. Hent alle 2-3 vær. ejerlejligheder fra Boligsiden for KBH+Frb
 *  3. Batch-fetch FMV fra iBuyReal AVM (én call per ~150 addresses)
 *  4. UPSERT til on_market_candidates (lastSeenAt = now())
 *     V3-screening køres inline med AVM-FMV (eller listPris fallback)
 *  5. Mark-sold: rows der var active men ikke set i denne run
 *  6. Update job-row med counts + status=success/failed
 */
import { and, eq, notInArray } from 'drizzle-orm';
import { calculateProperty } from './calculator';
import { db } from './db/client';
import { onMarketCandidates, scrapeJobs } from './db/schema';
import { bydelFromPostnr, DEFAULT_SCRAPE_POSTNUMRE } from './postnumre';
import {
  fetchAddressDetailsBatch,
  searchCondos,
  type ScrapedListing,
} from './services/boligsiden';
import { estimateFmv, fetchAvmBatch, type AvmPrediction } from './avm';
import type { Bydel } from './types';

export interface ScrapeRunResult {
  jobId: string;
  scraped: number;
  avmPredicted: number; // hvor mange fik AVM-FMV (ikke fallback)
  newListings: number;
  updated: number;
  markedSold: number;
  durationSeconds: number;
}

export interface ScrapeRunOptions {
  postnumre?: string[];
  minRooms?: number;
  maxRooms?: number;
  runKind?: 'cron' | 'manual';
}

function estimateBsAlpha(listing: ScrapedListing): number | null {
  // Boligsidens egen AVM-spread — kun reference, ikke iBuyReal alpha
  if (!listing.latestValuation || listing.listPrice <= 0) return null;
  return (listing.latestValuation - listing.listPrice) / listing.listPrice;
}

/**
 * Kør V3-screening på en kandidat med given FMV.
 * On-market: tilbudPris = listPris (ingen off-market rabat).
 *
 * FMV-prioritet: manualFmv > AVM-prediction > listPris fallback.
 */
function runV3OnListing(
  listing: ScrapedListing,
  bydel: Bydel | null,
  avmPrediction: AvmPrediction | undefined,
  manualFmv: number | null = null,
) {
  if (!bydel) return null; // V3 kræver bydel for langtidsleje-rate

  const fmvEstimate = manualFmv
    ? { fmv: manualFmv, source: 'manual' as const }
    : estimateFmv({
        listPrice: listing.listPrice,
        kvm: listing.kvm,
        avmPricePerSqm: avmPrediction?.pricePerSqm ?? null,
      });

  const ejTotal = listing.monthlyExpense
    ? listing.monthlyExpense * 12
    : Math.round(listing.kvm * 350);

  const calc = calculateProperty({
    bydel,
    kvm: listing.kvm,
    vaer: listing.rooms ?? 2,
    bygaar: listing.yearBuilt,
    udbud: listing.listPrice,
    fmv: fmvEstimate.fmv,
    ejTotal,
    tilbudPris: listing.listPrice, // on-market: ingen rabat
  });

  return {
    avmUnitUuid: avmPrediction?.unitUuid ?? null,
    avmPricePerSqm: avmPrediction?.pricePerSqm ?? null,
    avmCalculatedAt: new Date(),
    v3Fmv: fmvEstimate.fmv,
    v3FmvSource: fmvEstimate.source,
    v3Alpha: calc.alpha,
    v3Investeret: calc.investeret,
    v3OffMarketPris: null, // ikke relevant for on-market
    v3AfkastWorst: calc.worst.afkast,
    v3AfkastBase: calc.base.afkast,
    v3AfkastBest: calc.best.afkast,
    v3ProfitBest: calc.best.profit,
    v3CalculatedAt: new Date(),
  };
}

export async function runScrapeJob(opts: ScrapeRunOptions = {}): Promise<ScrapeRunResult> {
  if (!db) throw new Error('DB ikke konfigureret');

  const postnumre = opts.postnumre ?? DEFAULT_SCRAPE_POSTNUMRE;
  const minRooms = opts.minRooms ?? 2;
  const maxRooms = opts.maxRooms ?? 3;
  const runKind = opts.runKind ?? 'manual';
  const start = Date.now();

  // 1. Job-row
  const [job] = await db
    .insert(scrapeJobs)
    .values({
      runKind,
      postnrCodes: postnumre,
      minRooms,
      maxRooms,
      status: 'running',
    })
    .returning({ id: scrapeJobs.id });

  let scraped = 0;
  let avmPredicted = 0;
  let newListings = 0;
  let updated = 0;
  let markedSold = 0;

  try {
    // 2. Hent fra Boligsiden
    console.log('[scrape] Henter listings fra Boligsiden...');
    const listings = await searchCondos({ zipCodes: postnumre, minRooms, maxRooms });
    scraped = listings.length;
    const seenSlugs: string[] = listings.map((l) => l.slug);
    console.log(`[scrape] ${scraped} listings hentet`);

    // 3a. Batch-fetch AVM predictions
    const addressIds = listings
      .map((l) => l.addressId)
      .filter((x): x is string => !!x);
    console.log(`[scrape] Kalder AVM for ${addressIds.length} addresses...`);
    const avmStart = Date.now();
    const avmMap = await fetchAvmBatch(addressIds);
    avmPredicted = avmMap.size;
    console.log(
      `[scrape] AVM ${avmPredicted}/${addressIds.length} predicted på ${(
        (Date.now() - avmStart) /
        1000
      ).toFixed(1)}s`,
    );

    // 3b. Batch-fetch tidligere handler + offentlig vurdering
    console.log(`[scrape] Henter historik for ${addressIds.length} addresser...`);
    const historyStart = Date.now();
    const historyMap = await fetchAddressDetailsBatch(addressIds, { concurrency: 12 });
    console.log(
      `[scrape] Historik for ${historyMap.size}/${addressIds.length} på ${(
        (Date.now() - historyStart) /
        1000
      ).toFixed(1)}s`,
    );

    // 4. UPSERT
    for (const l of listings) {
      const bydel = bydelFromPostnr(l.postalCode);
      const estimatedAlpha = estimateBsAlpha(l);
      const avmPrediction = l.addressId ? avmMap.get(l.addressId) : undefined;

      const existing = await db
        .select({
          id: onMarketCandidates.id,
          status: onMarketCandidates.status,
          manualFmv: onMarketCandidates.manualFmv,
        })
        .from(onMarketCandidates)
        .where(
          and(
            eq(onMarketCandidates.source, 'boligsiden'),
            eq(onMarketCandidates.sourceId, l.slug),
          ),
        );

      // Hvis brugeren har sat en manuel FMV, vinder den over AVM ved genberegning.
      const manualFmv = existing[0]?.manualFmv ?? null;
      const v3 = runV3OnListing(l, bydel, avmPrediction, manualFmv);

      // Historik fra Boligsiden /addresses/{uuid}
      const history = l.addressId ? historyMap.get(l.addressId) : undefined;
      const lastNormalSale = history?.registrations.find(
        (r) => r.type === 'normal' && r.amount > 100_000,
      );

      const values = {
        source: 'boligsiden',
        sourceId: l.slug,
        sourceUrl: l.url,
        caseUrl: l.caseUrl,
        addressId: l.addressId,
        address: l.address,
        postalCode: l.postalCode,
        city: l.city,
        bydel,
        kvm: l.kvm,
        rooms: l.rooms,
        yearBuilt: l.yearBuilt,
        listPrice: l.listPrice,
        monthlyExpense: l.monthlyExpense,
        perAreaPrice: l.perAreaPrice,
        latestValuation: l.latestValuation,
        brokerKind: l.brokerKind,
        realtorName: l.realtorName,
        daysOnMarket: l.daysOnMarket,
        primaryImage: l.primaryImage,
        images: l.images,
        description: l.description,
        descriptionTitle: l.descriptionTitle,
        estimatedAlpha,
        historicalSales: history?.registrations ?? [],
        lastSaleDate: lastNormalSale?.date ?? null,
        lastSaleAmount: lastNormalSale?.amount ?? null,
        publicValuation: history?.publicValuation ?? null,
        ...(v3 ?? {}),
        lastSeenAt: new Date(),
        status: 'active',
      };

      if (existing.length === 0) {
        await db.insert(onMarketCandidates).values(values);
        newListings++;
      } else {
        await db
          .update(onMarketCandidates)
          .set({
            ...values,
            updatedAt: new Date(),
            soldAt: existing[0].status === 'sold' ? null : undefined,
          })
          .where(eq(onMarketCandidates.id, existing[0].id));
        updated++;
      }
    }

    // 5. Mark-sold
    if (seenSlugs.length > 0) {
      const result = await db
        .update(onMarketCandidates)
        .set({ status: 'sold', soldAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(onMarketCandidates.status, 'active'),
            notInArray(onMarketCandidates.sourceId, seenSlugs),
          ),
        )
        .returning({ id: onMarketCandidates.id });
      markedSold = result.length;
    }

    // 6. Job done
    await db
      .update(scrapeJobs)
      .set({
        finishedAt: new Date(),
        status: 'success',
        scraped,
        newListings,
        updatedListings: updated,
        markedSold,
      })
      .where(eq(scrapeJobs.id, job.id));
  } catch (err) {
    await db
      .update(scrapeJobs)
      .set({
        finishedAt: new Date(),
        status: 'failed',
        scraped,
        newListings,
        updatedListings: updated,
        markedSold,
        errorMsg: err instanceof Error ? err.message : String(err),
      })
      .where(eq(scrapeJobs.id, job.id));
    throw err;
  }

  return {
    jobId: job.id,
    scraped,
    avmPredicted,
    newListings,
    updated,
    markedSold,
    durationSeconds: (Date.now() - start) / 1000,
  };
}
