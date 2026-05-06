import type { PropertyStatus } from './types';

export const STATUS_LABEL: Record<PropertyStatus, string> = {
  screening: 'Screening',
  analyseret: 'Analyseret',
  tilbud_sendt: 'Tilbud sendt',
  forhandling: 'Forhandling',
  under_kontrakt: 'Under kontrakt',
  koebt: 'Købt',
  afvist: 'Afvist',
  solgt: 'Solgt',
};

export const STATUS_ORDER: PropertyStatus[] = [
  'screening',
  'analyseret',
  'tilbud_sendt',
  'forhandling',
  'under_kontrakt',
  'koebt',
  'solgt',
  'afvist',
];

export const STATUS_COLOR: Record<PropertyStatus, string> = {
  screening: 'bg-slate-100 text-slate-700',
  analyseret: 'bg-blue-100 text-blue-700',
  tilbud_sendt: 'bg-violet-100 text-violet-700',
  forhandling: 'bg-amber-100 text-amber-700',
  under_kontrakt: 'bg-orange-100 text-orange-700',
  koebt: 'bg-emerald-100 text-emerald-700',
  afvist: 'bg-rose-100 text-rose-700',
  solgt: 'bg-emerald-200 text-emerald-800',
};

export const BYDEL_LABEL: Record<string, string> = {
  'indre-by': 'Indre By',
  vesterbro: 'Vesterbro',
  noerrebro: 'Nørrebro',
  oesterbro: 'Østerbro',
  frederiksberg: 'Frederiksberg',
  amager: 'Amager',
};
