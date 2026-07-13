/**
 * Pris-klynger for comp-matching.
 *
 * Problem: Indre By/Christianshavn/Vesterbro-C er splittet over ~50
 * mikro-postnumre med 1-7 Resight-handler hver — exact-postnr matching
 * giver 0 comps for næsten alle cases i centrum.
 *
 * Løsning: postnumre samles i klynger som EMPIRISK er samme prismarked
 * (målt i barrier-analysen på /admin/avm-faldgrupper):
 *   - Christianshavn ≈ Indre By: 0,2% gap → merges
 *   - Holmen/Papirøen: +22% vs Indre By → EGEN klynge
 *   - Kalvebod/Havneholmen: +23% vs klassisk Vesterbro → EGEN klynge
 *   - Frederiksberg C (1800-1999): N/S-split på 8% accepteres — 8% støj
 *     er bedre end 0 comps (hver zip har 1-3 handler)
 *
 * Store postnumre (2000, 2100, 2200, 2300...) står alene — de har rigeligt data.
 */

interface Cluster {
  id: string;
  /** [fra, til] inklusive — postnr som heltal */
  ranges: Array<[number, number]>;
}

const CLUSTERS: Cluster[] = [
  { id: 'indre-by+christianshavn', ranges: [[1000, 1435], [1440, 1499]] },
  { id: 'holmen', ranges: [[1436, 1439]] },
  { id: 'vesterbro-havn', ranges: [[1560, 1579], [1780, 1799]] },
  { id: 'vesterbro-klassisk', ranges: [[1600, 1779]] },
  { id: 'frederiksberg-c', ranges: [[1800, 1999]] },
];

/**
 * Klynge-ID for et postnr. Postnumre uden klynge returnerer sig selv
 * (dvs. exact-postnr matching som hidtil).
 */
export function priceClusterId(postnr: string): string {
  const n = parseInt(postnr, 10);
  if (!Number.isFinite(n)) return postnr;
  for (const c of CLUSTERS) {
    for (const [from, to] of c.ranges) {
      if (n >= from && n <= to) return c.id;
    }
  }
  return postnr;
}

/**
 * SQL-venlige ranges for et postnrs klynge — bruges i comparables-API'et
 * hvor matching sker i Postgres. Postnumre uden klynge får [n, n].
 */
export function clusterRanges(postnr: string): Array<[number, number]> {
  const n = parseInt(postnr, 10);
  if (!Number.isFinite(n)) return [];
  for (const c of CLUSTERS) {
    for (const [from, to] of c.ranges) {
      if (n >= from && n <= to) return c.ranges;
    }
  }
  return [[n, n]];
}
