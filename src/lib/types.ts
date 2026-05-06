/**
 * Shared types for iBuyReal CRM domain.
 */

export type Bydel =
  | 'indre-by'
  | 'vesterbro'
  | 'noerrebro'
  | 'oesterbro'
  | 'frederiksberg'
  | 'amager';

export type Scenarie = 'worst' | 'base' | 'best';

export type PropertyStatus =
  | 'screening'
  | 'analyseret'
  | 'tilbud_sendt'
  | 'forhandling'
  | 'under_kontrakt'
  | 'koebt'
  | 'afvist'
  | 'solgt';

export interface Antagelser {
  // Airbnb base rates (kr/nat)
  adr: Record<Bydel, number>;
  // Belægning (%)
  occ: Record<Bydel, number>;
  // Langtidsleje sats (kr/m²/måned)
  langtidsleje: Record<Bydel, number>;

  // Room factors (justerer ADR)
  room: { studio: number; v1: number; v2: number; v3: number; v4: number };

  // Stand factors baseret på byggeår
  stand: { luksus: number; god: number; aeldre: number };

  // Airbnb expense parametre
  platformPct: number; // % af brutto
  rengoringKr: number; // kr per booking
  naetterPerBooking: number;
  adminPct: number; // % af (brutto - platform - rengøring)

  // Off-market parametre
  afslagPct: number; // % under udbud
  convFeePct: number; // % af udbud
  maeglerSparKr: number; // kr

  // Transaction
  txFastKr: number;
  txPct: number; // % af købspris

  // Beta scenarier (% markedsudvikling under hold)
  beta: { worst: number; base: number; best: number };
}
