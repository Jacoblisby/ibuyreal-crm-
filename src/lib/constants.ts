import type { Antagelser } from './types';

/**
 * Default antagelser. Disse værdier matcher Antagelser-tabellens defaults
 * i schema.ts og spec'en (iBuyReal_CRM_SPEC.md).
 *
 * I produktion overskrives de af DB-rækken (id='default') i Antagelser-tabellen.
 */
export const DEFAULT_ANTAGELSER: Antagelser = {
  adr: {
    'indre-by': 1609,
    vesterbro: 1195,
    noerrebro: 1100,
    'oesterbro': 1202,
    frederiksberg: 1250,
    amager: 1150,
  },
  occ: {
    'indre-by': 83,
    vesterbro: 80,
    noerrebro: 78,
    'oesterbro': 78,
    frederiksberg: 80,
    amager: 78,
  },
  // Langtidsleje (kr/m²/måned). Realistiske rates for KBH/Frb 2026.
  // NB: Spec'ens defaults var 10x for høje (1500 kr/m²/måned ≈ 1.6M/år for 89kvm).
  // Disse rates ligger på markedsniveau for ejerlejligheder under almindelig udlejning
  // (privat boligreglen, ikke regulerede lejemål).
  langtidsleje: {
    'indre-by': 220,
    'oesterbro': 200,
    noerrebro: 180,
    vesterbro: 195,
    frederiksberg: 210,
    amager: 170,
  },

  room: { studio: 0.7, v1: 0.85, v2: 1.0, v3: 1.4, v4: 1.9 },
  stand: { luksus: 1.15, god: 1.0, aeldre: 0.85 },

  platformPct: 15,
  rengoringKr: 300,
  naetterPerBooking: 2.875,
  adminPct: 10,

  afslagPct: 3,
  convFeePct: 2,
  maeglerSparKr: 80_000,

  txFastKr: 1_850,
  txPct: 0.6,

  beta: { worst: 0, base: 7, best: 14.8 },
};
