/**
 * Bolig-kvalitetsfiltre brugt af "Core picks" preset.
 *
 * Disse er heuristics baseret på adresse-streng-matching og byggeår.
 * Ikke videnskab — bare bedste guess fra de data vi har fra Boligsiden.
 */

// Strøget + adjacent støj/turist-gader vi vil ekskludere fra core picks.
// Tilføj her hvis vi finder andre gader vi konsekvent vil filtrere væk.
const NOISY_STREETS = [
  // ─── HØJ STØJ (≥-20% pristraf empirisk målt eller stort trafikkort) ──
  'Lyngbyvej',                  // -34.9% målt (motorvej-feeder)
  'Folehaven',                  // -30.1% målt (Ring 2)
  'Bispeengen',                 // Bispeengbuen — hævet motorvej
  'Åboulevard',                 // Bispeengbuens fortsættelse
  'H.C. Andersens Boulevard',   // 6 spor trafik
  'Borups Allé',                // Nordvest-grænse
  'Vesterbrogade',
  'Nørrebrogade',
  'Amagerbrogade',              // -7.2% målt
  'Strandvejen',
  'Istedgade',
  'Halmtorvet',

  // ─── MELLEM STØJ ──────────────────────────────────────────────────────
  'Jagtvej',                    // Gammel bygrænse, central trafik
  'Tagensvej',                  // -9.8% målt
  'Frederikssundsvej',          // -7.0% målt
  'Falkoner Allé',              // Frederiksberg central trafik
  'Roskildevej',                // Frederiksberg → Valby
  'Englandsvej',                // Amager-hovedgade
  'Sundbyvestervej',            // Amager
  'Vigerslev Allé',             // Valby
  'Sjælør Boulevard',           // Sydhavn
  'Gammel Kongevej',            // Frederiksberg/Vesterbro grænse
  'Smallegade',                 // Frederiksberg
  'Søndre Fasanvej',            // Frederiksberg vest
  'Vester Voldgade',            // Indre By voldring
  'Nørre Voldgade',
  'Øster Voldgade',
  'Tomsgårdsvej',               // Nordvest

  // ─── TURIST + NATTELIV ────────────────────────────────────────────────
  'Frederiksberggade',
  'Nygade',
  'Vimmelskaftet',
  'Amagertorv',
  'Østergade',
  'Strøget',
  'Købmagergade',
  'Pilestræde',
  'Nyhavn',
  'Strandgade',
  'Gothersgade',

  // ─── STATIONS-AKSEN (Hovedbanen + S-tog) ──────────────────────────────
  'Vesterport',
  'Reventlowsgade',
  'Tietgensgade',
  'Helgolandsgade',
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

// ─── Ejerudgift-niveau ─────────────────────────────────────────────────────
// Heuristik baseret på kr/m²/år. Høj udgift indikerer typisk:
//   - Stort restgæld i ejerforeningen (afdrag indregnet i fællesudgift)
//   - Igangværende vedligeholdelsesplan (facade, tag, vinduer)
//   - Stor reservefonds-opbygning
//   - Eller bare ekstravagant servicebureau-niveau
// Tærskler er kalibreret på Q1 2026 KBH+Frb-data.

export type EjerudgiftLevel = 'lav' | 'normal' | 'høj' | 'meget høj';

export interface EjerudgiftInfo {
  level: EjerudgiftLevel;
  perSqmPerYear: number | null;
  pctOfListPrice: number | null;
  warning: string | null;
}

/**
 * Klassificér ejerudgiften som lav/normal/høj/meget-høj baseret på kr/m²/år.
 * Returnerer null felter hvis vi mangler data.
 */
export function classifyEjerudgift(opts: {
  monthlyExpense: number | null | undefined;
  kvm: number | null | undefined;
  listPrice: number | null | undefined;
}): EjerudgiftInfo {
  const me = opts.monthlyExpense ?? 0;
  const kvm = opts.kvm ?? 0;
  const list = opts.listPrice ?? 0;
  if (!me || !kvm) {
    return { level: 'normal', perSqmPerYear: null, pctOfListPrice: null, warning: null };
  }
  const perSqm = Math.round((me * 12) / kvm);
  const pctOfList = list > 0 ? (me * 12) / list : null;

  let level: EjerudgiftLevel = 'normal';
  let warning: string | null = null;
  if (perSqm > 1800) {
    level = 'meget høj';
    warning =
      'Meget høj ejerudgift — næsten altid stor restgæld i ejerforeningen eller stort vedligeholdelsesprojekt. Tjek salgsopstilling.';
  } else if (perSqm > 1200) {
    level = 'høj';
    warning =
      'Høj ejerudgift — kan indikere restgæld eller igangværende renovering. Undersøg salgsopstilling før bud.';
  } else if (perSqm < 800) {
    level = 'lav';
  }
  return { level, perSqmPerYear: perSqm, pctOfListPrice: pctOfList, warning };
}
