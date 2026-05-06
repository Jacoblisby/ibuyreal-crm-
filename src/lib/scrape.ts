/**
 * On-market scrape worker.
 *
 * Flow:
 *  1. Insert ny scrape_jobs row (status=running)
 *  2. Hent alle 2-3 vær. ejerlejligheder fra Boligsiden for KBH+Frb
 *  3. UPSERT til on_market_candidates (lastSeenAt = now())
 *  4. Mark-sold: rows der var active men ikke set i denne run
 *  5. Update job-row med counts + status=success/failed
 *
 * Beregner også estimatedAlpha = (latestValuation - listPrice) / listPrice
 * (Boligsidens egen AVM som proxy — vores rigtige AVM kører i et separat job).
 */
import { and, eq, notInArray } from 'drizzle-orm';
import { calculateProperty } from './calculator';
import { db } from './db/client';
import { onMarketCandidates, scrapeJobs } from './db/schema';
import { bydelFromPostnr, DEFAULT_SCRAPE_POSTNUMRE } from './postnumre';
import { searchCondos, type ScrapedListing } from './services/boligsiden';
import type { Bydel } from './types';

export interface ScrapeRunResult {
  jobId: string;
  scraped: number;
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

import { estimateFmv } from './avm';

function estimateAlpha(listing: ScrapedListing): number | null {
  if (!listing.latestValuation || listing.listPrice <= 0) return null;
  return (listing.latestValuation - listing.listPrice) / listing.listPrice;
}

/**
 * Kør V3-screening på en kandidat: estimerer FMV via avm-bridge,
 * beregner full calculator-output (alpha, scenarier, profit) og returnerer
 * felter klar til at gemme på onMarketCandidates.
 */
function runV3OnListing(listing: ScrapedListing, bydel: Bydel | null) {
  const fmvEstimate = estimateFmv({
    listPrice: listing.listPrice,
    latestValuation: listing.latestValuation,
    bydel,
    kvm: listing.kvm,
    rooms: listing.rooms,
    yearBuilt: listing.yearBuilt,
    postalCode: listing.postalCode,
  });

  if (!bydel) return null; // V3 har brug for bydel for langtidsleje-rate

  // Hvis monthlyExpense ikke er sat, antag 350 kr/m²/år som groft estimat
  const ejTotal = listing.monthlyExpense
    ? listing.monthlyExpense * 12
    : Math.round(listing.kvm * 350);

  // On-market: ingen off-market arbitrage. Tilbudspris = listPris (default
  // udgangspunkt; brugeren kan justere på detail-siden via tilbudPris-input).
  const calc = calculateProperty({
    bydel,
    kvm: listing.kvm,
    vaer: listing.rooms ?? 2,
    bygaar: listing.yearBuilt,
    udbud: listing.listPrice,
    fmv: fmvEstimate.fmv,
    ejTotal,
    tilbudPris: listing.listPrice, // ← skip off-market rabat for on-market
  });

  return {
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
  let newListings = 0;
  let updated = 0;
  let markedSold = 0;

  try {
    // 2. Hent fra Boligsiden
    const listings = await searchCondos({ zipCodes: postnumre, minRooms, maxRooms });
    scraped = listings.length;
    const seenSlugs: string[] = listings.map((l) => l.slug);

    // 3. UPSERT
    for (const l of listings) {
      const bydel = bydelFromPostnr(l.postalCode);
      const estimatedAlpha = estimateAlpha(l);

      // Tjek om vi har set den før
      const existing = await db
        .select({ id: onMarketCandidates.id, status: onMarketCandidates.status })
        .from(onMarketCandidates)
        .where(
          and(
            eq(onMarketCandidates.source, 'boligsiden'),
            eq(onMarketCandidates.sourceId, l.slug),
          ),
        );

      const v3 = runV3OnListing(l, bydel);

      const values = {
        source: 'boligsiden',
        sourceId: l.slug,
        sourceUrl: l.url,
        caseUrl: l.caseUrl,
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
            // Re-aktiver hvis tidligere sold (kom tilbage på markedet)
            soldAt: existing[0].status === 'sold' ? null : undefined,
          })
          .where(eq(onMarketCandidates.id, existing[0].id));
        updated++;
      }
    }

    // 4. Mark-sold: alle aktive rows der ikke blev set i dette run
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

    // 5. Job done
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
    newListings,
    updated,
    markedSold,
    durationSeconds: (Date.now() - start) / 1000,
  };
}
