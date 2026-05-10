/**
 * AVM-bridge.
 *
 * iBuyReal har en proprietær XGBoost-baseret AVM-model der lever uden for
 * dette repo (Python/notebook). Indtil den er wired ind via HTTP eller
 * pickle-fil, bruger vi fallback-logik som placeholder-FMV.
 *
 * Erstat `estimateFmv` med rigtig AVM-kald når den er klar — alle andre
 * kalkulationer bør være uændrede.
 */

export type FmvSource = 'ibuyreal-avm' | 'list-price-fallback';

export interface FmvEstimate {
  fmv: number;
  source: FmvSource;
}

export interface FmvInput {
  listPrice: number;
  latestValuation: number | null;
  bydel: string | null;
  kvm: number;
  rooms: number | null;
  yearBuilt: number | null;
  postalCode: string;
}

/**
 * Estimerer Fair Market Value for en given bolig.
 *
 * **Indtil iBuyReal XGBoost-AVM er wired ind**: vi sætter FMV = listPrice.
 * Det betyder alpha bliver ren arbitrage på handelsomkostninger
 * (~5-7% fra off-market discount alene, ingen FMV-spread bonus).
 *
 * **Når AVM-bridge er klar**: erstat function-body med HTTP-kald (eller
 * lokal model-eval) der returnerer { fmv: number, source: 'ibuyreal-avm' }.
 * `FmvInput` indeholder allerede alle de features modellen typisk bruger:
 * postnr, kvm, vaer, bygaar, listPrice (sælger-signal).
 */
export function estimateFmv(input: FmvInput): FmvEstimate {
  // TODO: kobl iBuyReal XGBoost-AVM ind her.
  // const r = await fetch(process.env.AVM_URL + '/predict', { ... })
  // return { fmv: r.fmv, source: 'ibuyreal-avm' };
  return { fmv: input.listPrice, source: 'list-price-fallback' };
}
