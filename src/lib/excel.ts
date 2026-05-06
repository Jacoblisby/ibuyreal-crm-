/**
 * Excel import/export — Screening Overblik V3 format.
 *
 * Format: hver case er en kolonne (B, C, D, ...), faste rækker:
 *   3:  Adresse
 *   5:  Kvarter/bydel
 *   6:  kvm
 *   7:  Værelser
 *   8:  Byggeår
 *   9:  Energimærke
 *   10: Dage på markedet
 *   12: Udbudspris
 *   13: AVM FMV
 *   14: Afvigelse (formel)
 *   15: Decil
 *   16: AVM kr/m²
 *   19: Tx (formel)
 *   22: Natpris (ADR)
 *   23: Belægning
 *   31: Ej.skat
 *   32: Grundskyld
 *   33: Fællesudgift
 *   34: Øvrige
 *   39: Total ejerudgifter
 */
import * as XLSX from 'xlsx';
import { calculateProperty } from './calculator';
import type { Bydel, PropertyStatus } from './types';

export interface ImportedCase {
  address: string;
  bydel: Bydel;
  postnr: string | null;
  kvm: number;
  vaer: number;
  bygaar: number | null;
  energi: string | null;
  dage: number | null;
  udbud: number;
  fmv: number | null;
  decil: number | null;
  ejSkat: number;
  ejGrundskyld: number;
  ejFaelles: number;
  ejOvrige: number;
}

const BYDEL_MAP: Record<string, Bydel> = {
  'indre by': 'indre-by',
  'indreby': 'indre-by',
  vesterbro: 'vesterbro',
  nørrebro: 'noerrebro',
  noerrebro: 'noerrebro',
  østerbro: 'oesterbro',
  oesterbro: 'oesterbro',
  frederiksberg: 'frederiksberg',
  amager: 'amager',
};

function normalizeBydel(s: string | null | undefined): Bydel {
  if (!s) return 'indre-by';
  const k = s.toLowerCase().trim();
  return BYDEL_MAP[k] ?? 'indre-by';
}

function getCell(sheet: XLSX.WorkSheet, col: string, row: number): unknown {
  const ref = `${col}${row}`;
  const c = sheet[ref];
  return c?.v;
}

function asNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Parser en V3 .xlsx buffer og returnerer alle cases (kolonne B, C, D, …).
 */
export function parseScreeningV3(buffer: ArrayBuffer): ImportedCase[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1:A1');

  const out: ImportedCase[] = [];
  // Start fra kolonne B (index 1)
  for (let col = 1; col <= range.e.c; col++) {
    const colLetter = XLSX.utils.encode_col(col);
    const address = getCell(sheet, colLetter, 3);
    const udbud = asNumber(getCell(sheet, colLetter, 12));
    if (!address || !udbud) continue; // spring tomme kolonner over

    const kvm = asNumber(getCell(sheet, colLetter, 6));
    if (!kvm) continue;

    const bydelRaw = getCell(sheet, colLetter, 5) as string;

    out.push({
      address: String(address),
      bydel: normalizeBydel(bydelRaw),
      postnr: null,
      kvm: Math.round(kvm),
      vaer: Math.round(asNumber(getCell(sheet, colLetter, 7)) ?? 2),
      bygaar: asNumber(getCell(sheet, colLetter, 8)) ? Math.round(asNumber(getCell(sheet, colLetter, 8))!) : null,
      energi: (getCell(sheet, colLetter, 9) as string) ?? null,
      dage: asNumber(getCell(sheet, colLetter, 10)) ? Math.round(asNumber(getCell(sheet, colLetter, 10))!) : null,
      udbud,
      fmv: asNumber(getCell(sheet, colLetter, 13)),
      decil: asNumber(getCell(sheet, colLetter, 15)) ? Math.round(asNumber(getCell(sheet, colLetter, 15))!) : null,
      ejSkat: asNumber(getCell(sheet, colLetter, 31)) ?? 0,
      ejGrundskyld: asNumber(getCell(sheet, colLetter, 32)) ?? 0,
      ejFaelles: asNumber(getCell(sheet, colLetter, 33)) ?? 0,
      ejOvrige: asNumber(getCell(sheet, colLetter, 34)) ?? 0,
    });
  }
  return out;
}

/**
 * Bygger en V3-format .xlsx fra en liste af cases.
 * Skriver formler for afvigelse (=14) og tx (=19).
 */
export interface ExportProperty {
  address: string;
  bydel: string;
  kvm: number;
  vaer: number;
  bygaar: number | null;
  energi: string | null;
  dage: number | null;
  udbud: number;
  fmv: number | null;
  decil: number | null;
  adr: number | null;
  occ: number | null;
  ejSkat: number | null;
  ejGrundskyld: number | null;
  ejFaelles: number | null;
  ejOvrige: number | null;
  ejTotal: number | null;
}

export function buildScreeningV3(cases: ExportProperty[]): Buffer {
  const wb = XLSX.utils.book_new();
  const sheet: XLSX.WorkSheet = {};

  // Labels i kolonne A
  const labels: Record<number, string> = {
    3: 'Adresse',
    5: 'Bydel',
    6: 'kvm',
    7: 'Værelser',
    8: 'Byggeår',
    9: 'Energimærke',
    10: 'Dage på markedet',
    12: 'Udbudspris',
    13: 'AVM FMV',
    14: 'Afvigelse',
    15: 'Decil',
    16: 'AVM kr/m²',
    19: 'Tx',
    22: 'Natpris (ADR)',
    23: 'Belægning',
    31: 'Ejendomsskat',
    32: 'Grundskyld',
    33: 'Fællesudgift',
    34: 'Øvrige udgifter',
    39: 'Total ejerudgifter',
  };
  for (const [row, label] of Object.entries(labels)) {
    sheet[`A${row}`] = { t: 's', v: label };
  }

  // Hver case = en kolonne fra B
  cases.forEach((c, i) => {
    const col = XLSX.utils.encode_col(i + 1); // B=1, C=2, ...
    const set = (row: number, value: string | number | null) => {
      if (value === null || value === undefined) return;
      sheet[`${col}${row}`] =
        typeof value === 'number' ? { t: 'n', v: value } : { t: 's', v: String(value) };
    };
    const setFormula = (row: number, formula: string) => {
      sheet[`${col}${row}`] = { t: 'n', f: formula };
    };

    set(3, c.address);
    set(5, c.bydel);
    set(6, c.kvm);
    set(7, c.vaer);
    set(8, c.bygaar);
    set(9, c.energi);
    set(10, c.dage);
    set(12, c.udbud);
    set(13, c.fmv);
    // Afvigelse formel: (udbud - fmv) / fmv  → row 14
    setFormula(14, `(${col}12-${col}13)/${col}13`);
    set(15, c.decil);
    // AVM kr/m² formel: fmv / kvm
    setFormula(16, `${col}13/${col}6`);
    // Tx formel: 1850 + 0.006 × udbud
    setFormula(19, `1850+0.006*${col}12`);
    set(22, c.adr);
    set(23, c.occ);
    set(31, c.ejSkat);
    set(32, c.ejGrundskyld);
    set(33, c.ejFaelles);
    set(34, c.ejOvrige);
    setFormula(39, `${col}31+${col}32+${col}33+${col}34`);
  });

  // Sæt range
  const lastCol = XLSX.utils.encode_col(cases.length); // last column letter
  sheet['!ref'] = `A1:${lastCol}40`;

  XLSX.utils.book_append_sheet(wb, sheet, 'Screening Overblik');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Beregn alle felter for en importeret case og returnér data klar til DB-insert.
 */
export function enrichImportedCase(c: ImportedCase) {
  const ejTotal = c.ejSkat + c.ejGrundskyld + c.ejFaelles + c.ejOvrige;
  const fmv = c.fmv ?? c.udbud; // hvis ingen FMV: brug udbud (nul-spread)
  const calc = calculateProperty({
    bydel: c.bydel,
    kvm: c.kvm,
    vaer: c.vaer,
    bygaar: c.bygaar,
    udbud: c.udbud,
    fmv,
    ejTotal,
  });
  return {
    ...c,
    fmv,
    ejTotal,
    afvigelse: c.fmv ? (c.udbud - c.fmv) / c.fmv : null,
    avmKvm: c.fmv ? c.fmv / c.kvm : null,
    offMarketPris: calc.offMarket.offMarketPris,
    txKost: calc.tx,
    investeret: calc.investeret,
    adr: calc.airbnb.adr,
    occ: calc.airbnb.occ,
    bruttoAirbnb: calc.airbnb.brutto,
    netAirbnb: calc.airbnb.netAirbnb,
    netCashflow: calc.airbnb.netAirbnb - ejTotal,
    cfYieldWorst: calc.worst.cfYield,
    cfYieldBase: calc.base.cfYield,
    cfYieldBest: calc.best.cfYield,
    alpha: calc.alpha,
    profitWorst: calc.worst.profit,
    profitBase: calc.base.profit,
    profitBest: calc.best.profit,
    afkastWorst: calc.worst.afkast,
    afkastBase: calc.base.afkast,
    afkastBest: calc.best.afkast,
    status: 'screening' as PropertyStatus,
  };
}
