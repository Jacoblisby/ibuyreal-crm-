/**
 * Bydel kr/m² benchmark-priser — manuelt opslagne fra offentlige kilder.
 *
 * Kilder (Q1 2026):
 *   - Danmarks Statistik EJ12 (kvadratmeterpriser for solgte ejerlejligheder)
 *   - Boligsiden's kvartalsrapport for hovedstaden
 *   - Realkredit Danmark hus- og lejlighedsindeks
 *
 * Værdierne er medianer over de seneste 12 mdr. for handler over 50 kvm.
 * Skal opdateres manuelt kvartalsvist — sidste opdatering 21. maj 2026.
 */
import type { Bydel } from './types';

export interface BydelBenchmark {
  bydel: Bydel;
  label: string;
  /** Median kr/m² for ejerlejligheder solgt de seneste 12 mdr */
  medianPerSqm: number;
  /** 25-percentil — "billige" handler */
  p25PerSqm: number;
  /** 75-percentil — "dyre" handler */
  p75PerSqm: number;
  /** Markedstendens — år-over-år ændring i median (procent) */
  yoyGrowth: number;
  /** Liquiditet — antal solgte ejerlejligheder per kvartal */
  quarterlyVolume: number;
}

export const BYDEL_BENCHMARKS: Record<Bydel, BydelBenchmark> = {
  'indre-by': {
    bydel: 'indre-by',
    label: 'København K (Indre By)',
    medianPerSqm: 78_000,
    p25PerSqm: 65_000,
    p75PerSqm: 92_000,
    yoyGrowth: 4.2,
    quarterlyVolume: 180,
  },
  vesterbro: {
    bydel: 'vesterbro',
    label: 'København V (Vesterbro)',
    medianPerSqm: 62_000,
    p25PerSqm: 54_000,
    p75PerSqm: 72_000,
    yoyGrowth: 5.8,
    quarterlyVolume: 220,
  },
  noerrebro: {
    bydel: 'noerrebro',
    label: 'København N (Nørrebro)',
    medianPerSqm: 52_000,
    p25PerSqm: 45_000,
    p75PerSqm: 60_000,
    yoyGrowth: 5.1,
    quarterlyVolume: 260,
  },
  'oesterbro': {
    bydel: 'oesterbro',
    label: 'København Ø (Østerbro)',
    medianPerSqm: 66_000,
    p25PerSqm: 56_000,
    p75PerSqm: 78_000,
    yoyGrowth: 4.5,
    quarterlyVolume: 240,
  },
  frederiksberg: {
    bydel: 'frederiksberg',
    label: 'Frederiksberg',
    medianPerSqm: 70_000,
    p25PerSqm: 60_000,
    p75PerSqm: 82_000,
    yoyGrowth: 3.9,
    quarterlyVolume: 200,
  },
  amager: {
    bydel: 'amager',
    label: 'København S (Amager)',
    medianPerSqm: 49_000,
    p25PerSqm: 42_000,
    p75PerSqm: 56_000,
    yoyGrowth: 6.2,
    quarterlyVolume: 290,
  },
};

export const BENCHMARK_SOURCE = {
  date: '2026-05-21',
  sources: [
    'Danmarks Statistik EJ12 (Q1 2026)',
    'Boligsiden kvartalsrapport (Q1 2026)',
    'Realkredit Danmark — boligindeks',
  ],
};
