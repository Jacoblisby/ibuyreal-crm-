/** Formatering til UI. */

const DKK = new Intl.NumberFormat('da-DK', {
  style: 'currency',
  currency: 'DKK',
  maximumFractionDigits: 0,
});

const NUMBER = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 0 });

export function formatKr(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  return DKK.format(Math.round(n));
}

export function formatNum(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  return new Intl.NumberFormat('da-DK', { maximumFractionDigits: digits }).format(n);
}

export function formatPct(decimal: number | null | undefined, digits = 1): string {
  if (decimal === null || decimal === undefined || Number.isNaN(decimal)) return '–';
  return `${(decimal * 100).toFixed(digits)}%`;
}

export { NUMBER };
