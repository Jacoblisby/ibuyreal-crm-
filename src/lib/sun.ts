/**
 * Sol-score via solnu shadow-engine (https://solnu-kbh.vercel.app).
 *
 * Flow pr. kandidat:
 *   1. Koordinater fra DAWA (addressId hvis vi har det, ellers adressesøgning)
 *   2. Etage parses fra adressen ("3. tv" → 3, "st." → 0)
 *   3. solnu /api/sun-at beregner timeprofil i etagehøjden (jun + mar)
 *
 * Scoren er en approksimation: vi kender ikke lejlighedens facade-orientering,
 * så solnu sampler 8 punkter rundt om bygningen og rapporterer bedste facade.
 * Scoren beregnes ÉN gang pr. kandidat (bygninger flytter sig ikke).
 */

const SOLNU_URL = process.env.SOLNU_URL ?? 'https://solnu-kbh.vercel.app';
const DAWA_URL = 'https://api.dataforsyningen.dk';

export interface SunProfile {
  score: number;
  floor: number;
  heightM: number;
  jun: { sunHours: number; afternoonSunHours: number; firstSun: number | null; lastSun: number | null };
  mar: { sunHours: number; afternoonSunHours: number; firstSun: number | null; lastSun: number | null };
}

/**
 * Etage fra dansk adresseformat. "Adresse 4, 3. tv" → 3 · "st. th" → 0 ·
 * "kld." → 0 · ingen etageangivelse (byhus) → 0.
 */
export function parseFloor(address: string): number {
  const m = address.match(/,\s*(\d{1,2})\.\s*(?:$|[a-zæøå\d])/i);
  if (m) return parseInt(m[1], 10);
  return 0;
}

async function coordsFromDawa(
  addressId: string | null,
  address: string,
  postalCode: string,
): Promise<{ lat: number; lng: number } | null> {
  // 1) Direkte opslag på DAWA-id
  if (addressId) {
    try {
      const res = await fetch(`${DAWA_URL}/adresser/${addressId}?struktur=mini`, {
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const d = (await res.json()) as { x?: number; y?: number };
        if (d.x && d.y) return { lat: d.y, lng: d.x };
      }
    } catch {
      // fald igennem til søgning
    }
  }
  // 2) Adressesøgning (datavask er tolerant overfor Boligsidens format)
  try {
    const q = encodeURIComponent(`${address}, ${postalCode}`);
    const res = await fetch(`${DAWA_URL}/adresser?q=${q}&struktur=mini&per_side=1`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const arr = (await res.json()) as Array<{ x?: number; y?: number }>;
      if (arr[0]?.x && arr[0]?.y) return { lat: arr[0].y, lng: arr[0].x };
    }
  } catch {
    // giver op
  }
  return null;
}

/**
 * Fuld sol-profil for en kandidat. Returnerer null hvis koordinater ikke
 * kan findes eller punktet ligger udenfor solnus KBH-dækning.
 */
export async function fetchSunProfile(candidate: {
  addressId: string | null;
  address: string;
  postalCode: string;
}): Promise<SunProfile | null> {
  const coords = await coordsFromDawa(candidate.addressId, candidate.address, candidate.postalCode);
  if (!coords) return null;

  const floor = parseFloor(candidate.address);
  try {
    const res = await fetch(
      `${SOLNU_URL}/api/sun-at?lat=${coords.lat}&lng=${coords.lng}&floor=${floor}`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (!res.ok) return null;
    const d = (await res.json()) as SunProfile & { jun: { hours?: unknown } };
    // Timeserien gemmes ikke — kun aggregaterne
    return {
      score: d.score,
      floor: d.floor,
      heightM: d.heightM,
      jun: {
        sunHours: d.jun.sunHours,
        afternoonSunHours: d.jun.afternoonSunHours,
        firstSun: d.jun.firstSun,
        lastSun: d.jun.lastSun,
      },
      mar: {
        sunHours: d.mar.sunHours,
        afternoonSunHours: d.mar.afternoonSunHours,
        firstSun: d.mar.firstSun,
        lastSun: d.mar.lastSun,
      },
    };
  } catch {
    return null;
  }
}
