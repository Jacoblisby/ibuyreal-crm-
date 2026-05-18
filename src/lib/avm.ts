/**
 * iBuyReal AVM bridge.
 *
 * Modellen lever som en AWS Lambda bag API Gateway og predicterer
 * `price_per_sqm` for en liste af DAWA address UUIDs.
 *
 * Request:  POST {AVM_URL}
 *           { "address_ids": ["uuid", "uuid", ...] }
 *
 * Response: { "predictions": [
 *               { "address_id", "unit_uuid", "address",
 *                 "predicted_price_per_sqm" (number | null),
 *                 "reason"? "No unit found for address_id" }
 *             ] }
 *
 * - Lambda timeout: 30s → batch addresses i porre på ~150 (≤ 20s)
 * - ~10 addresses/sek warm, første batch ~25s cold-start
 * - Mange null-værdier er normalt (modellen er trænet på en subset af DK)
 */

const AVM_URL = process.env.AVM_URL ?? '';
const BATCH_SIZE = 150;
const BATCH_TIMEOUT_MS = 28_000;

export type FmvSource = 'ibuyreal-avm' | 'list-price-fallback' | 'manual';

export interface FmvEstimate {
  fmv: number;
  source: FmvSource;
}

export interface AvmPrediction {
  pricePerSqm: number;
  unitUuid: string | null;
}

interface RawPrediction {
  address_id?: string;
  unit_uuid?: string | null;
  address?: string | null;
  predicted_price_per_sqm?: number | null;
  reason?: string;
}

/**
 * Batch-fetch AVM predictions for en liste af DAWA address UUIDs.
 * Returnerer en Map: addressId → prediction (kun for addresses hvor modellen
 * havde en pris; null/missing droppes).
 */
export async function fetchAvmBatch(
  addressIds: string[],
): Promise<Map<string, AvmPrediction>> {
  const map = new Map<string, AvmPrediction>();
  if (!AVM_URL) {
    console.warn('[avm] AVM_URL ikke sat — skipper AVM-kald, falder tilbage til listPrice');
    return map;
  }

  const unique = Array.from(new Set(addressIds.filter(Boolean)));
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS);
    try {
      const res = await fetch(AVM_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address_ids: batch }),
        signal: controller.signal,
      });
      if (!res.ok) {
        console.error(`[avm] HTTP ${res.status} on batch ${i}-${i + batch.length}`);
        continue;
      }
      const data = (await res.json()) as { predictions?: RawPrediction[] };
      for (const p of data.predictions ?? []) {
        if (p.address_id && typeof p.predicted_price_per_sqm === 'number') {
          map.set(p.address_id, {
            pricePerSqm: p.predicted_price_per_sqm,
            unitUuid: p.unit_uuid ?? null,
          });
        }
      }
    } catch (err) {
      console.error(`[avm] Batch ${i}-${i + batch.length} fejlede:`, err);
    } finally {
      clearTimeout(timeout);
    }
  }
  return map;
}

/**
 * Beregn FMV for en bolig ud fra AVM prediction (eller fallback).
 */
export function estimateFmv(opts: {
  listPrice: number;
  kvm: number;
  avmPricePerSqm: number | null;
}): FmvEstimate {
  if (opts.avmPricePerSqm && opts.kvm > 0) {
    return { fmv: Math.round(opts.avmPricePerSqm * opts.kvm), source: 'ibuyreal-avm' };
  }
  return { fmv: opts.listPrice, source: 'list-price-fallback' };
}
