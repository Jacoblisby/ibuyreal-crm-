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

/**
 * Auto-detekt hjemfaldspligt fra Boligsiden-beskrivelse + titel.
 *
 * Mæglere er ret pligtige til at oplyse hjemfaldspligt i prospektet,
 * og bruger typisk ordene "hjemfaldspligt" eller "hjemfaldsret".
 * Vi extracter også et udløbsår hvis det står i nærheden.
 *
 * Returnerer kun hjemfaldspligt=true. Hvis vi senere finder ud af
 * det var fejldetektion kan bruger toggle den OFF manuelt — vores
 * UI bevarer "manuelt sat" så scrape ikke overskriver det.
 */
/**
 * Auto-detekt håndværkertilbud / fixer-upper fra Boligsiden-beskrivelse.
 *
 * Specifikke nøgleord der har lav false-positive rate:
 *   - "håndværkertilbud" (specifik mæglerbetegnelse)
 *   - "kræver renovering" / "trænger til renovering"
 *   - "som besigtiget" / "som beset" (mæglerformulering der signalerer "ingen garantier")
 *   - "stor renoveringsopgave"
 *
 * Vi MATCHER IKKE generic "renovering" alene fordi det ofte refererer til
 * bygnings-vedligehold (facade, vinduer m.fl.) som er positivt signal.
 */
function detectHandyman(
  description: string | null | undefined,
  title: string | null | undefined,
): { handymanListing?: boolean; handymanListingNote?: string } {
  const text = `${title ?? ''}\n${description ?? ''}`.toLowerCase();
  const patterns: Array<{ rx: RegExp; label: string }> = [
    { rx: /\bhåndværker-?tilbud\b/, label: 'håndværkertilbud' },
    { rx: /\b(kræver|trænger til) (en )?(total ?)?(istandsættelse|renovering|opdatering)\b/, label: 'kræver renovering' },
    { rx: /\bsom (besigtiget|beset)\b/, label: 'som besigtiget' },
    { rx: /\bstor renoveringsopgave\b/, label: 'stor renoveringsopgave' },
    { rx: /\bfuld(?:t)? istandsættelse(?:s|n)?\b/, label: 'fuld istandsættelse' },
  ];
  for (const { rx, label } of patterns) {
    if (rx.test(text)) {
      return {
        handymanListing: true,
        handymanListingNote: `Auto-detected: "${label}" i beskrivelse`,
      };
    }
  }
  return {};
}

/**
 * Auto-detekt husbåde/flydende boliger. De sælges som "ejerlejlighed" på
 * Boligsiden men er helt uden for fondens scope (AVM kan ikke prise dem,
 * andet finansierings- og risikoprofil). Detekterede cases sættes direkte
 * til status='ignored' så de aldrig optræder i listen.
 */
function detectHouseboat(
  description: string | null | undefined,
  title: string | null | undefined,
): boolean {
  const text = `${title ?? ''}\n${description ?? ''}`.toLowerCase();
  return /\b(husbåd|husbaad|flydende bolig|beboelsesflåde|houseboat)\b/.test(text);
}

function detectHjemfaldspligt(
  description: string | null | undefined,
  title: string | null | undefined,
): { hjemfaldspligt?: boolean; hjemfaldspligtNote?: string } {
  const text = `${title ?? ''}\n${description ?? ''}`.toLowerCase();
  const m = text.match(/\b(hjemfaldspligt|hjemfaldsret|hjemfalds-?ret)\b/);
  if (!m || m.index === undefined) {
    return {};
  }
  // NEGATION: "der er INGEN hjemfaldspligt" / "uden hjemfaldspligt" må ikke flagge.
  const before = text.slice(Math.max(0, m.index - 45), m.index);
  if (/\b(ingen|ikke|uden|fri for)\b[\s\S]{0,30}$/.test(before)) {
    return {};
  }
  // RESOLUTION: "hjemfaldspligten er frikøbt/afløst/indfriet" = ikke længere aktiv.
  const after = text.slice(m.index, m.index + 120);
  if (/\b(frikøbt|afløst|indfriet|aflyst)\b/.test(after)) {
    return {};
  }
  // Forsøg at extracte udløbsår (typisk firecifret 2050-2100)
  const yearMatch = text.match(/hjemfald[\s\S]{0,80}?(20\d{2})/);
  const note = yearMatch
    ? `Auto-detected fra beskrivelse — udløb ${yearMatch[1]}`
    : 'Auto-detected fra beskrivelse';
  return { hjemfaldspligt: true, hjemfaldspligtNote: note };
}

/**
 * Hent mæglerens egen case-side og returner rå tekst (tags strippet).
 *
 * NØDVENDIGT fordi Boligsidens API trunkerer descriptionBody til 500 tegn —
 * "OBS! Lejlighed med Hjemfaldspligt" står ofte længere nede i teksten og
 * findes kun på mæglersiden (Nybolig, Home, EDC m.fl.).
 *
 * Kaldes kun for NYE listings (én gang per case) for at holde volumen nede.
 */
async function fetchCaseFullText(caseUrl: string | null): Promise<string | null> {
  if (!caseUrl) return null;
  try {
    const res = await fetch(caseUrl, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const raw = await res.text();
    return raw
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ');
  } catch {
    return null;
  }
}

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
          hjemfaldspligt: onMarketCandidates.hjemfaldspligt,
          hjemfaldspligtNote: onMarketCandidates.hjemfaldspligtNote,
          handymanListing: onMarketCandidates.handymanListing,
          handymanListingNote: onMarketCandidates.handymanListingNote,
          avmPricePerSqm: onMarketCandidates.avmPricePerSqm,
          avmUnitUuid: onMarketCandidates.avmUnitUuid,
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

      // STICKY AVM: hvis dagens AVM-kald ikke gav prediction (Lambda-batch
      // fejlede eller flaky), genbrug seneste kendte AVM-værdi i stedet for
      // at falde tilbage til listPris. Uden dette mister cases deres alpha
      // hver gang en batch fejler — Top picks kollapser tilfældigt.
      const effectivePrediction: AvmPrediction | undefined =
        avmPrediction ??
        (existing[0]?.avmPricePerSqm
          ? {
              pricePerSqm: existing[0].avmPricePerSqm,
              unitUuid: existing[0].avmUnitUuid ?? null,
            }
          : undefined);

      const v3 = runV3OnListing(l, bydel, effectivePrediction, manualFmv);

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
        ...detectHjemfaldspligt(l.description, l.descriptionTitle),
        ...detectHandyman(l.description, l.descriptionTitle),
        lastSeenAt: new Date(),
        status: 'active',
      };

      // Husbåde er uden for scope — sæt direkte til 'ignored'.
      const isHouseboat = detectHouseboat(l.description, l.descriptionTitle);

      if (existing.length === 0) {
        // Deep-scan mæglersiden for NYE listings: Boligsiden trunkerer
        // beskrivelsen til 500 tegn, så hjemfald/håndværker-signaler kan
        // være skåret væk. Fuld tekst hentes én gang fra caseUrl.
        const fullText = await fetchCaseFullText(l.caseUrl);
        const deepFlags = fullText
          ? {
              ...detectHjemfaldspligt(fullText, null),
              ...detectHandyman(fullText, null),
            }
          : {};
        const deepHouseboat = isHouseboat || (fullText ? detectHouseboat(fullText, null) : false);
        await db.insert(onMarketCandidates).values({
          ...values,
          ...deepFlags,
          ...(deepHouseboat ? { status: 'ignored' as const } : {}),
        });
        newListings++;
      } else {
        // Bevar 'ignored' — bruger har aktivt markeret denne case som
        // fjernet. Scrape må kun sætte status tilbage til 'active' hvis
        // den fx var 'sold' og er kommet tilbage på markedet.
        // Husbåde tvinges altid til 'ignored'.
        const preservedStatus =
          isHouseboat || existing[0].status === 'ignored' ? 'ignored' : values.status;
        // Bevar manuelt-sat hjemfaldspligt: hvis bruger allerede har
        // taget stilling (true ELLER false med ikke-auto note), så lader
        // vi det stå. Scrape må kun ADD'e hjemfald, ikke fjerne det.
        // Manuel-toggle preservation: hvis bruger har taget stilling
        // (note der IKKE starter med "Auto-detected") så bevares værdien.
        const hjemfaldNoteAuto = (existing[0].hjemfaldspligtNote ?? '').startsWith('Auto-detected');
        const handymanNoteAuto = (existing[0].handymanListingNote ?? '').startsWith('Auto-detected');
        const preserveHjemfald = existing[0].hjemfaldspligt === true && !hjemfaldNoteAuto
          ? {
              hjemfaldspligt: existing[0].hjemfaldspligt,
              hjemfaldspligtNote: existing[0].hjemfaldspligtNote,
            }
          : {};
        const preserveHandyman = existing[0].handymanListing === true && !handymanNoteAuto
          ? {
              handymanListing: existing[0].handymanListing,
              handymanListingNote: existing[0].handymanListingNote,
            }
          : {};
        await db
          .update(onMarketCandidates)
          .set({
            ...values,
            ...preserveHjemfald,
            ...preserveHandyman,
            status: preservedStatus,
            updatedAt: new Date(),
            soldAt: existing[0].status === 'sold' ? null : undefined,
          })
          .where(eq(onMarketCandidates.id, existing[0].id));
        updated++;
      }
    }

    // 5. Mark-sold (kun aktive der ikke længere ses + ikke manuelt ignored)
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
