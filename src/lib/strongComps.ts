/**
 * Hard gate for curated shortlist: hvor mange friske handler i nær-området
 * blev solgt OVER subject's udbudspris/m² indenfor de seneste N måneder?
 *
 * Bruges som on/off-filter for Curated 20:
 *   - 0 stærke friske comps → kandidaten dumper helt ud af shortlisten
 *   - ≥1 → kandidaten kan curates (men score bestemmer rangering)
 *
 * Peer-definition (skal matche /api/on-market/[id]/comparables for konsistens):
 *   - samme pris-klynge (typisk = postnr; centrum-postnumre samles i klynger,
 *     se postnrClusters.ts — fallback til samme bydel hvis <peerMin peers)
 *   - kvm indenfor ±30%
 *   - byggeår indenfor ±25 år (hard filter)
 *
 * Comp-definition (en handel der "tæller"):
 *   - type === 'normal'  (ikke familie/auktion)
 *   - amount ≥ 100k
 *   - date ≥ cutoff (default 5 mdr siden)
 *   - perAreaPrice ≥ subjectListPpm × (1 + abovePct)   (default abovePct = 0)
 */
import type { OnMarketCandidate } from './db/schema';
import { priceClusterId } from './postnrClusters';

interface RawSale {
  date: string;
  amount: number;
  type: string;
}

export interface StrongFreshCompsOpts {
  /** Hvor mange måneder tilbage tæller som "frisk"? Default 5. */
  monthsBack?: number;
  /** Minimum % over subject's listpris/m². Default 0 (dvs. ≥ udbud). */
  abovePct?: number;
  /** kvm-tolerance (default ±0.30) */
  kvmTolerance?: number;
  /** byggeår-tolerance i år (default 25) */
  yearBuiltTolerance?: number;
  /** "Now" for testbarhed — default Date.now() */
  now?: Date;
}

export interface StrongFreshComp {
  date: string;
  amount: number;
  perAreaPrice: number;
  address: string;
  kvm: number;
  yearBuilt: number | null;
  /** % over subject's listpris/m² */
  vsList: number;
}

/**
 * Returnerer alle "stærke friske comps" — fresh handler i nær-området
 * solgt ≥ subject's listpris/m².
 */
export function findStrongFreshComps(
  subject: OnMarketCandidate,
  pool: OnMarketCandidate[],
  opts: StrongFreshCompsOpts = {},
): StrongFreshComp[] {
  const monthsBack = opts.monthsBack ?? 5;
  const abovePct = opts.abovePct ?? 0;
  const kvmTol = opts.kvmTolerance ?? 0.3;
  const yearTol = opts.yearBuiltTolerance ?? 25;
  const now = opts.now ?? new Date();

  if (!subject.kvm || !subject.listPrice) return [];
  const subjectKvm = subject.kvm;
  const subjectListPpm = subject.listPrice / subjectKvm;
  const subjectYear = subject.yearBuilt;
  const subjectPostal = subject.postalCode;
  const subjectBydel = subject.bydel;

  const kvmMin = subjectKvm * (1 - kvmTol);
  const kvmMax = subjectKvm * (1 + kvmTol);

  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - monthsBack);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const requiredPpm = subjectListPpm * (1 + abovePct);

  const peerFilter = (p: OnMarketCandidate, by: 'postnr' | 'bydel'): boolean => {
    if (p.id === subject.id) return false;
    if (by === 'postnr' && p.postalCode !== subjectPostal) return false;
    if (by === 'bydel' && (!subjectBydel || p.bydel !== subjectBydel)) return false;
    if (!p.kvm || p.kvm < kvmMin || p.kvm > kvmMax) return false;
    if (subjectYear && p.yearBuilt && Math.abs(p.yearBuilt - subjectYear) > yearTol) {
      return false;
    }
    if (!p.historicalSales || (p.historicalSales as unknown[]).length === 0) return false;
    return true;
  };

  let peers = pool.filter((p) => peerFilter(p, 'postnr'));
  if (peers.length < 5 && subjectBydel) {
    peers = pool.filter((p) => peerFilter(p, 'bydel'));
  }

  const hits: StrongFreshComp[] = [];
  for (const p of peers) {
    const hist = p.historicalSales as RawSale[] | null;
    if (!hist) continue;
    for (const s of hist) {
      if (s.type !== 'normal') continue;
      if (s.date < cutoffStr) continue;
      if (!s.amount || s.amount < 100_000) continue;
      const kvm = p.kvm ?? 0;
      if (kvm <= 0) continue;
      const ppm = s.amount / kvm;
      if (ppm < requiredPpm) continue;
      hits.push({
        date: s.date,
        amount: s.amount,
        perAreaPrice: Math.round(ppm),
        address: p.address,
        kvm,
        yearBuilt: p.yearBuilt,
        vsList: (ppm - subjectListPpm) / subjectListPpm,
      });
    }
  }

  // Sortér nyeste først
  hits.sort((a, b) => (a.date < b.date ? 1 : -1));
  return hits;
}

/**
 * Hurtig boolean-check — er der mindst N stærke friske comps?
 */
export function hasStrongFreshComps(
  subject: OnMarketCandidate,
  pool: OnMarketCandidate[],
  minCount = 1,
  opts: StrongFreshCompsOpts = {},
): boolean {
  return findStrongFreshComps(subject, pool, opts).length >= minCount;
}

// ─── EKSTERN POOL (Resight tinglysningsdata) ─────────────────────────────────

/** Minimal shape af en ekstern handel (skal matche query i page.tsx). */
export interface ExternalSaleLite {
  address: string;
  saleDate: string;
  amount: number;
  kvm: number | null;
  perAreaPrice: number | null;
  yearBuilt: number | null;
  postalCode: string;
}

/**
 * Per-kandidat aggregat: count + median af friske comps i nær-området.
 *
 * `count` = antal handler i kvm+byggeår+postnr-bånd sidste N måneder
 * `medianPpm` = median pr.m² på de comps (uafhængig af udbudspris)
 * `medianAboveList` = true hvis medianen ≥ subject's udbud/m² (HARD GATE)
 * `aboveListCount` = antal af comps der individuelt var ≥ udbud (info-felt)
 */
export interface StrongFreshAggregate {
  count: number;
  medianPpm: number | null;
  medianAboveList: boolean;
  aboveListCount: number;
}

/**
 * Server-side pre-compute af friske-comp aggregater per kandidat,
 * inkl. både `historicalSales` (internal scrape) og `externalSales` (Resight).
 *
 * Returnerer Map<candidateId, StrongFreshAggregate> — bruges som hard gate
 * i Top picks: `medianAboveList === true` betyder typisk sale i segmentet
 * lå over vores udbud, dvs. vi er definitivt under markedet.
 */
export function computeStrongFreshCompMap(
  candidates: OnMarketCandidate[],
  externalPool: ExternalSaleLite[],
  opts: StrongFreshCompsOpts = {},
): Record<string, StrongFreshAggregate> {
  const monthsBack = opts.monthsBack ?? 5;
  const kvmTol = opts.kvmTolerance ?? 0.3;
  const yearTol = opts.yearBuiltTolerance ?? 25;
  const now = opts.now ?? new Date();

  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - monthsBack);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  // Index per pris-klynge (ikke exact postnr) — centrum-postnumre er for små
  // til exact matching (1-7 handler pr. zip); klyngerne er empirisk samme marked.
  const extByCluster = new Map<string, ExternalSaleLite[]>();
  for (const e of externalPool) {
    if (e.saleDate < cutoffStr) continue;
    if (!e.kvm || e.kvm <= 0 || !e.amount) continue;
    const key = priceClusterId(e.postalCode);
    const arr = extByCluster.get(key) ?? [];
    arr.push(e);
    extByCluster.set(key, arr);
  }

  const candByCluster = new Map<string, OnMarketCandidate[]>();
  for (const x of candidates) {
    const key = priceClusterId(x.postalCode);
    const arr = candByCluster.get(key) ?? [];
    arr.push(x);
    candByCluster.set(key, arr);
  }

  const out: Record<string, StrongFreshAggregate> = {};
  for (const c of candidates) {
    if (c.status !== 'active') continue;
    if (!c.kvm || !c.listPrice) {
      out[c.id] = { count: 0, medianPpm: null, medianAboveList: false, aboveListCount: 0 };
      continue;
    }
    const subjectKvm = c.kvm;
    const subjectListPpm = c.listPrice / subjectKvm;
    const kvmMin = subjectKvm * (1 - kvmTol);
    const kvmMax = subjectKvm * (1 + kvmTol);

    const ppms: number[] = [];

    // 1) Internal historicalSales
    const peersInPostnr = candByCluster.get(priceClusterId(c.postalCode)) ?? [];
    for (const p of peersInPostnr) {
      if (p.id === c.id) continue;
      if (!p.kvm || p.kvm < kvmMin || p.kvm > kvmMax) continue;
      if (c.yearBuilt && p.yearBuilt && Math.abs(p.yearBuilt - c.yearBuilt) > yearTol) continue;
      const hist = p.historicalSales as Array<{ date: string; amount: number; type: string }> | null;
      if (!hist) continue;
      for (const s of hist) {
        if (s.type !== 'normal') continue;
        if (s.date < cutoffStr) continue;
        if (!s.amount || s.amount < 100_000) continue;
        const ppm = s.amount / p.kvm;
        if (ppm < 5_000) continue;
        ppms.push(ppm);
      }
    }

    // 2) Resight external_sales
    const extInPostnr = extByCluster.get(priceClusterId(c.postalCode)) ?? [];
    for (const e of extInPostnr) {
      if (e.kvm! < kvmMin || e.kvm! > kvmMax) continue;
      if (c.yearBuilt && e.yearBuilt && Math.abs(e.yearBuilt - c.yearBuilt) > yearTol) continue;
      // Dedup mod subject's egen historik
      const cleanCand = c.address.toLowerCase().replace(/\s+/g, '');
      const cleanExt = e.address.toLowerCase().replace(/\s+/g, '');
      if (cleanExt.startsWith(cleanCand.slice(0, Math.min(15, cleanCand.length)))) continue;
      const ppm = e.perAreaPrice ?? e.amount / e.kvm!;
      if (ppm < 5_000) continue;
      ppms.push(ppm);
    }

    if (ppms.length === 0) {
      out[c.id] = { count: 0, medianPpm: null, medianAboveList: false, aboveListCount: 0 };
      continue;
    }

    ppms.sort((a, b) => a - b);
    const medianPpm = ppms[Math.floor(ppms.length / 2)];
    const aboveListCount = ppms.filter((p) => p >= subjectListPpm).length;

    out[c.id] = {
      count: ppms.length,
      medianPpm,
      medianAboveList: medianPpm >= subjectListPpm,
      aboveListCount,
    };
  }
  return out;
}
