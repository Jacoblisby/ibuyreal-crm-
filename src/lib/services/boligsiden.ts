/**
 * Boligsiden search-cases API integration.
 *
 * Bruges af `lib/scrape.ts` til at finde aktivt udbudte ejerlejligheder
 * i København + Frederiksberg.
 *
 * URL: GET https://api.boligsiden.dk/search/cases
 *   ?zipCodes=1100&zipCodes=2100&...     (repeat for hver postnr)
 *   &addressTypes=condo                  (kun ejerlejligheder)
 *   &roomsRange.from=2&roomsRange.to=3   (2-3 værelser)
 *   &per_page=50&page=1                  (paginering)
 *
 * Verificeret 2026-05: zipCodes kan gentages, roomsRange filtrerer korrekt,
 * cityName er broken (returnerer hele DK).
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

interface BoligsidenImage {
  imageSources?: Array<{ url?: string; size?: { width?: number; height?: number } }>;
}

interface BoligsidenCase {
  caseID?: string;
  caseUrl?: string;
  defaultImage?: BoligsidenImage;
  images?: BoligsidenImage[];
  descriptionBody?: string;
  descriptionTitle?: string;
  housingArea?: number;
  numberOfRooms?: number;
  priceCash?: number;
  monthlyExpense?: number;
  perAreaPrice?: number;
  yearBuilt?: number;
  daysOnMarket?: number;
  realtor?: { name?: string };
  slugAddress?: string;
  address?: {
    addressID?: string; // DAWA UUID — bruges som input til iBuyReal AVM
    cityName?: string;
    door?: string;
    floor?: string;
    houseNumber?: string;
    latestValuation?: number;
    livingArea?: number;
    road?: { name?: string };
    roadName?: string;
    zipCode?: number;
    buildings?: Array<{ yearBuilt?: number; numberOfRooms?: number }>;
  };
}

interface SearchResponse {
  cases?: BoligsidenCase[];
  totalHits?: number;
}

export interface AddressDetails {
  registrations: Array<{ date: string; amount: number; type: string }>;
  publicValuation: number | null; // latestValuation (SKAT/offentlig)
}

/**
 * Hent fuld adresse-detalje fra Boligsiden — inkluderer tidligere handler,
 * offentlig vurdering, BBR-data.
 *
 * Cacheable (next.js fetch cache), 24-timers TTL.
 */
export async function fetchAddressDetails(
  dawaAddressId: string,
): Promise<AddressDetails | null> {
  try {
    const r = await fetch(`https://api.boligsiden.dk/addresses/${dawaAddressId}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      next: { revalidate: 86400 },
    });
    if (!r.ok) return null;
    const data = (await r.json()) as {
      latestValuation?: number;
      registrations?: Array<{ amount?: number; date?: string; type?: string }>;
    };
    const regs = (data.registrations ?? [])
      .filter(
        (x): x is { amount: number; date: string; type: string } =>
          typeof x.amount === 'number' &&
          typeof x.date === 'string' &&
          typeof x.type === 'string',
      )
      .sort((a, b) => (a.date < b.date ? 1 : -1)); // nyeste først
    return {
      registrations: regs,
      publicValuation: data.latestValuation ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Batch-hent adresse-detaljer for mange DAWA IDs samtidigt (parallel).
 * Vi sender op til `concurrency` requests parallelt for at undgå at hænge
 * scrapen på serial 500ms × 500-kald.
 */
export async function fetchAddressDetailsBatch(
  addressIds: string[],
  opts: { concurrency?: number } = {},
): Promise<Map<string, AddressDetails>> {
  const concurrency = opts.concurrency ?? 12;
  const map = new Map<string, AddressDetails>();
  const queue = [...addressIds];
  async function worker() {
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) return;
      const r = await fetchAddressDetails(id);
      if (r) map.set(id, r);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return map;
}

export interface ScrapedListing {
  slug: string;
  url: string;
  caseUrl: string | null;
  addressId: string | null; // DAWA UUID — bruges som input til AVM
  address: string;
  postalCode: string;
  city: string;
  kvm: number;
  rooms: number | null;
  yearBuilt: number | null;
  listPrice: number;
  monthlyExpense: number | null;
  perAreaPrice: number | null;
  latestValuation: number | null;
  realtorName: string | null;
  brokerKind: string;
  daysOnMarket: number | null;
  primaryImage: string | null;
  images: string[];
  description: string | null;
  descriptionTitle: string | null;
}

export interface SearchOptions {
  /** Postnumre at filtrere på (gentages som zipCodes-param). */
  zipCodes: string[];
  /** Min antal værelser. Default 2. */
  minRooms?: number;
  /** Max antal værelser. Default 3. */
  maxRooms?: number;
  /** Hvor mange postnumre der sendes per request (Boligsiden URL-grænse). */
  zipCodeBatchSize?: number;
  /** Max sider pr. batch (50 cases pr. side). */
  maxPagesPerBatch?: number;
}

const DEFAULTS: Required<Pick<SearchOptions, 'minRooms' | 'maxRooms' | 'zipCodeBatchSize' | 'maxPagesPerBatch'>> = {
  minRooms: 2,
  maxRooms: 3,
  zipCodeBatchSize: 30,
  maxPagesPerBatch: 10,
};

function classifyBroker(url: string | null): string {
  if (!url) return 'unknown';
  const u = url.toLowerCase();
  if (u.includes('edc.dk')) return 'edc';
  if (u.includes('nybolig.dk')) return 'nybolig';
  if (u.includes('home.dk')) return 'home';
  if (u.includes('realmaegler')) return 'realmaeglerne';
  if (u.includes('danbolig.dk')) return 'danbolig';
  if (u.includes('estate.dk')) return 'estate';
  if (u.includes('lokalbolig')) return 'lokalbolig';
  if (u.includes('boligone')) return 'boligone';
  if (u.includes('robinhus')) return 'robinhus';
  if (u.includes('liebhaverboligen')) return 'liebhaver';
  if (u.includes('place2live')) return 'place2live';
  if (u.includes('bjerggaard')) return 'bjerggaard';
  if (u.includes('paulink')) return 'paulink';
  return 'other';
}

function pickBestImage(img?: BoligsidenImage): string | null {
  const sources = img?.imageSources ?? [];
  if (sources.length === 0) return null;
  let best = sources[0];
  let bestArea = (best.size?.width ?? 0) * (best.size?.height ?? 0);
  for (const s of sources) {
    const area = (s.size?.width ?? 0) * (s.size?.height ?? 0);
    if (area > bestArea) {
      best = s;
      bestArea = area;
    }
  }
  return best.url ?? null;
}

function parseCase(c: BoligsidenCase): ScrapedListing | null {
  const slug = c.slugAddress;
  if (!slug) return null;
  const addr = c.address ?? {};
  const buildings = addr.buildings ?? [];
  const building = buildings[0] ?? {};
  const roadName = addr.road?.name ?? addr.roadName ?? '';
  const houseNumber = addr.houseNumber ?? '';
  const floor = addr.floor;
  const door = addr.door;
  let address = `${roadName} ${houseNumber}`.trim();
  if (floor) address += `, ${floor}.`;
  if (door) address += ` ${door}`;
  address = address.trim();

  const kvm = c.housingArea ?? addr.livingArea ?? 0;
  const listPrice = c.priceCash ?? 0;
  if (!address || !kvm || !listPrice) return null;

  const galleryImages = (c.images ?? [])
    .map((img) => pickBestImage(img))
    .filter((u): u is string => !!u);
  const primaryImage = pickBestImage(c.defaultImage) ?? galleryImages[0] ?? null;

  return {
    slug,
    url: `https://www.boligsiden.dk/adresse/${slug}`,
    caseUrl: c.caseUrl ?? null,
    addressId: addr.addressID ?? null,
    address,
    postalCode: String(addr.zipCode ?? ''),
    city: addr.cityName ?? '',
    kvm: Math.round(kvm),
    rooms: c.numberOfRooms ?? building.numberOfRooms ?? null,
    yearBuilt: c.yearBuilt ?? building.yearBuilt ?? null,
    listPrice: Math.round(listPrice),
    monthlyExpense: c.monthlyExpense ?? null,
    perAreaPrice: c.perAreaPrice ?? (kvm > 0 ? Math.round(listPrice / kvm) : null),
    latestValuation: addr.latestValuation ?? null,
    realtorName: c.realtor?.name ?? null,
    brokerKind: classifyBroker(c.caseUrl ?? null),
    daysOnMarket: c.daysOnMarket ?? null,
    primaryImage,
    images: galleryImages,
    description: c.descriptionBody ?? null,
    descriptionTitle: c.descriptionTitle ?? null,
  };
}

async function fetchBatch(
  zipCodes: string[],
  page: number,
): Promise<{ cases: BoligsidenCase[]; totalHits: number }> {
  // NB: Boligsidens API ignorerer roomsRange-parameteren — vi filtrerer
  // klient-side på rooms i `searchCondos`.
  const params = new URLSearchParams();
  for (const z of zipCodes) params.append('zipCodes', z);
  params.append('addressTypes', 'condo');
  params.append('per_page', '50');
  params.append('page', String(page));
  const url = `https://api.boligsiden.dk/search/cases?${params.toString()}`;
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!r.ok) {
    throw new Error(`Boligsiden ${r.status}: ${url}`);
  }
  const data = (await r.json()) as SearchResponse;
  return { cases: data.cases ?? [], totalHits: data.totalHits ?? 0 };
}

/**
 * Hent alle aktivt udbudte ejerlejligheder for de givne postnumre.
 *
 * Postnumre batches og pagineres automatisk. Returnerer dedupede listings
 * (samme bolig kan ikke rammes to gange via slug-key).
 */
export async function searchCondos(opts: SearchOptions): Promise<ScrapedListing[]> {
  const minRooms = opts.minRooms ?? DEFAULTS.minRooms;
  const maxRooms = opts.maxRooms ?? DEFAULTS.maxRooms;
  const batchSize = opts.zipCodeBatchSize ?? DEFAULTS.zipCodeBatchSize;
  const maxPages = opts.maxPagesPerBatch ?? DEFAULTS.maxPagesPerBatch;

  const seen = new Set<string>();
  const out: ScrapedListing[] = [];

  for (let i = 0; i < opts.zipCodes.length; i += batchSize) {
    const batch = opts.zipCodes.slice(i, i + batchSize);
    for (let page = 1; page <= maxPages; page++) {
      const { cases } = await fetchBatch(batch, page);
      if (cases.length === 0) break;
      for (const c of cases) {
        const parsed = parseCase(c);
        if (!parsed) continue;
        if (seen.has(parsed.slug)) continue;
        // Klient-side rooms-filter (Boligsidens roomsRange ignoreres)
        if (parsed.rooms !== null && (parsed.rooms < minRooms || parsed.rooms > maxRooms)) {
          continue;
        }
        seen.add(parsed.slug);
        out.push(parsed);
      }
      if (cases.length < 50) break;
    }
  }
  return out;
}
