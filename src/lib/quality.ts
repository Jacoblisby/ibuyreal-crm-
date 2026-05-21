/**
 * Bolig-kvalitetsfiltre brugt af "Core picks" preset.
 *
 * Disse er heuristics baseret på adresse-streng-matching og byggeår.
 * Ikke videnskab — bare bedste guess fra de data vi har fra Boligsiden.
 */

// Strøget + adjacent støj/turist-gader vi vil ekskludere fra core picks.
// Tilføj her hvis vi finder andre gader vi konsekvent vil filtrere væk.
const NOISY_STREETS = [
  // Strøget proper (gågade-shopping)
  'Frederiksberggade',
  'Nygade',
  'Vimmelskaftet',
  'Amagertorv',
  'Østergade',
  'Strøget',
  // Strøget-tilstødende kvarterer
  'Købmagergade',
  'Pilestræde',
  // Tourist + nattelivshotspots
  'Nyhavn',
  'Strandgade',
  'Gothersgade',
  // Store trafik-gader
  'Vesterbrogade',
  'Nørrebrogade',
  'Amagerbrogade',
  'Strandvejen',
  'Istedgade',
  'Halmtorvet',
  'Vesterport',
];

const NOISY_PATTERN = new RegExp(
  `\\b(${NOISY_STREETS.map((s) => s.replace(/ø/g, '[øo]').replace(/æ/g, '[æae]').replace(/å/g, '[åa]')).join('|')})\\b`,
  'i',
);

/**
 * True hvis adressen ligger på en kendt støj-/turist-gade.
 */
export function isNoisyStreet(address: string | null | undefined): boolean {
  if (!address) return false;
  return NOISY_PATTERN.test(address);
}

/**
 * True hvis adressen er på stueetage eller i kælder.
 * Boligsiden-format: ", st.", ", st tv", ", 0.", ", 0. th", ", stuen", ", kld."
 */
export function isGroundFloor(address: string | null | undefined): boolean {
  if (!address) return false;
  return /,\s*(st\.?(?:\s|$|,)|stuen|0\.?(?:\s|$|,)|kld\.?)/.test(address.toLowerCase());
}

/**
 * True hvis byggeår er i den "dårlige" 1950-1990 periode
 * (betonbyggeri, dårlig isolering, ofte dårlig standard).
 */
export function isConcreteEra(yearBuilt: number | null | undefined): boolean {
  if (!yearBuilt) return false;
  return yearBuilt >= 1950 && yearBuilt <= 1990;
}

/**
 * Helt aggregeret kvalitetstest — true hvis casen klarer ALLE filtre.
 * Brugt af "Core picks" preset.
 */
export function passesQualityFilter(opts: {
  address: string | null | undefined;
  yearBuilt: number | null | undefined;
}): boolean {
  return (
    !isNoisyStreet(opts.address) &&
    !isGroundFloor(opts.address) &&
    !isConcreteEra(opts.yearBuilt)
  );
}
