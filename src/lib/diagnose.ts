/**
 * Diagnose-flag for en bolig — bruges på on-market-listen + Top picks-cards
 * for at vise på et øjeblik HVORFOR en case er god eller dårlig.
 *
 * Hver flag er en lille chip:
 *   🟢 pass — denne dimension er god
 *   🟡 warn — opmærksomhed (ikke deal-breaker)
 *   🔴 fail — denne dimension er et problem
 *
 * Outputtet sorteres så de vigtigste flag kommer først.
 */
import type { OnMarketCandidate } from './db/schema';
import type { StrongFreshAggregate } from './strongComps';
import { isConcreteEra, isGroundFloor, isNoisyStreet } from './quality';

export type DiagnoseLevel = 'pass' | 'warn' | 'fail';

export interface DiagnoseFlag {
  level: DiagnoseLevel;
  /** Kort label til chip (max ~16 tegn) */
  label: string;
  /** Detaljeret tekst til tooltip */
  detail: string;
  /** Kategori — bruges til sortering og evt. filtering */
  category: 'lokation' | 'byggeri' | 'størrelse' | 'data' | 'stand' | 'marked' | 'safety';
  /** Vægt — højere = vigtigere, vises først */
  weight: number;
}

/**
 * Diagnose en case. Returnerer flag i prioriteret rækkefølge
 * (fail > warn > pass, vægt sekundært).
 */
export function diagnoseCase(
  c: OnMarketCandidate,
  agg?: StrongFreshAggregate,
): DiagnoseFlag[] {
  const flags: DiagnoseFlag[] = [];

  // ─── SAFETY (kan slå casen helt ud) ─────────────────────────────────────
  if (c.hjemfaldspligt) {
    flags.push({
      level: 'fail',
      label: 'Hjemfald',
      detail: `Hjemfaldspligt markeret manuelt${c.hjemfaldspligtNote ? ` (${c.hjemfaldspligtNote})` : ''}. Skjules fra Top picks.`,
      category: 'safety',
      weight: 100,
    });
  }
  if (isGroundFloor(c.address)) {
    flags.push({
      level: 'fail',
      label: 'Stueetage',
      detail: 'Adressen indeholder "st." eller "0." — stueetage har typisk -10-15% prisrabat, lav efterspørgsel.',
      category: 'lokation',
      weight: 90,
    });
  } else {
    // Forsøg at parse etage
    const m = c.address.toLowerCase().match(/,\s*(\d+)\.?/);
    if (m) {
      const fl = parseInt(m[1], 10);
      if (fl >= 4) {
        flags.push({
          level: 'pass',
          label: `${fl}. sal`,
          detail: `Højt placeret (${fl}. sal) — typisk lyst og attraktivt.`,
          category: 'lokation',
          weight: 50,
        });
      } else if (fl >= 1) {
        flags.push({
          level: 'pass',
          label: `${fl}. sal`,
          detail: `Mellem-etage (${fl}. sal) — solid placering.`,
          category: 'lokation',
          weight: 30,
        });
      }
    }
  }

  // ─── BYGGERI ────────────────────────────────────────────────────────────
  if (isConcreteEra(c.yearBuilt)) {
    flags.push({
      level: 'fail',
      label: `Beton ${c.yearBuilt}`,
      detail: `Byggeår ${c.yearBuilt} (1950-1990) — beton-æra med dårlig isolering og lav markedsappetit. Skjules fra Top picks.`,
      category: 'byggeri',
      weight: 85,
    });
  } else if (c.yearBuilt) {
    if (c.yearBuilt < 1900) {
      flags.push({
        level: 'pass',
        label: `Klassisk ${c.yearBuilt}`,
        detail: `Klassisk pre-krigs (${c.yearBuilt}) — typisk høj kvalitet og charme.`,
        category: 'byggeri',
        weight: 40,
      });
    } else if (c.yearBuilt < 1950) {
      flags.push({
        level: 'pass',
        label: `KBH-klassiker ${c.yearBuilt}`,
        detail: `Pre-krigs københavnerklassiker (${c.yearBuilt}) — premium kvalitet og lokation.`,
        category: 'byggeri',
        weight: 45,
      });
    } else if (c.yearBuilt >= 2010) {
      flags.push({
        level: 'pass',
        label: `Nybyg ${c.yearBuilt}`,
        detail: `Moderne nybyg (${c.yearBuilt}) — energieffektivt, lav vedligehold.`,
        category: 'byggeri',
        weight: 35,
      });
    } else {
      flags.push({
        level: 'pass',
        label: `Bygget ${c.yearBuilt}`,
        detail: `Moderne (${c.yearBuilt}).`,
        category: 'byggeri',
        weight: 20,
      });
    }
  }

  // ─── LOKATION ──────────────────────────────────────────────────────────
  if (isNoisyStreet(c.address)) {
    flags.push({
      level: 'fail',
      label: 'Støjgade',
      detail: 'Adressen er på en kendt støj- eller trafikgade (Strøget, Vesterbrogade m.fl.). Skjules fra Top picks.',
      category: 'lokation',
      weight: 80,
    });
  }

  // ─── STØRRELSE ─────────────────────────────────────────────────────────
  if (c.kvm) {
    if (c.kvm > 110) {
      flags.push({
        level: 'fail',
        label: `${c.kvm} m² for stor`,
        detail: `${c.kvm} m² — markedet for store lejligheder er tyndt, lavere ppm. Skjules fra Top picks.`,
        category: 'størrelse',
        weight: 60,
      });
    } else if (c.kvm > 100) {
      flags.push({
        level: 'warn',
        label: `${c.kvm} m² stor`,
        detail: `${c.kvm} m² — på grænsen for hvad markedet aftager bredt.`,
        category: 'størrelse',
        weight: 40,
      });
    } else if (c.kvm >= 50 && c.kvm <= 90) {
      flags.push({
        level: 'pass',
        label: `${c.kvm} m² sweet`,
        detail: `${c.kvm} m² — sweet-spot for både 1. gangs købere og udlejere.`,
        category: 'størrelse',
        weight: 25,
      });
    }
  }

  // ─── DATA / AVM ────────────────────────────────────────────────────────
  if (c.v3FmvSource === 'ibuyreal-avm') {
    flags.push({
      level: 'pass',
      label: 'AVM dækker',
      detail: 'iBuyReal AVM kan predicte for denne adresse.',
      category: 'data',
      weight: 15,
    });
  } else if (c.v3FmvSource === 'manual') {
    flags.push({
      level: 'pass',
      label: 'Manuel FMV',
      detail: 'FMV er manuelt sat efter vurdering.',
      category: 'data',
      weight: 15,
    });
  } else {
    flags.push({
      level: 'warn',
      label: 'Ingen AVM',
      detail: 'AVM kan ikke predicte denne adresse — vi falder tilbage til udbudspris som FMV.',
      category: 'data',
      weight: 55,
    });
  }

  // ─── MARKED (α + comps) ────────────────────────────────────────────────
  if (c.v3Alpha !== null && c.v3Alpha !== undefined) {
    const alphaPct = c.v3Alpha * 100;
    if (alphaPct >= 10) {
      flags.push({
        level: 'pass',
        label: `α +${alphaPct.toFixed(0)}%`,
        detail: `AVM siger casen er ${alphaPct.toFixed(1)}% under FMV.`,
        category: 'marked',
        weight: 70,
      });
    } else if (alphaPct >= 3) {
      flags.push({
        level: 'pass',
        label: `α +${alphaPct.toFixed(1)}%`,
        detail: `AVM siger casen er ${alphaPct.toFixed(1)}% under FMV.`,
        category: 'marked',
        weight: 50,
      });
    } else if (alphaPct > 0) {
      flags.push({
        level: 'warn',
        label: `α +${alphaPct.toFixed(1)}%`,
        detail: `Marginalt positiv α — ${alphaPct.toFixed(1)}% under FMV.`,
        category: 'marked',
        weight: 20,
      });
    } else {
      flags.push({
        level: 'fail',
        label: `α ${alphaPct.toFixed(1)}%`,
        detail: `Negativ α — udbud over FMV ifølge AVM.`,
        category: 'marked',
        weight: 65,
      });
    }
  }

  // Comp-confidence
  if (agg) {
    if (agg.count >= 10) {
      flags.push({
        level: 'pass',
        label: `${agg.count} friske comps`,
        detail: `${agg.count} handler i samme postnr+kvm+byggeår-segment de seneste 3 mdr.`,
        category: 'marked',
        weight: 30,
      });
    } else if (agg.count >= 5) {
      flags.push({
        level: 'warn',
        label: `${agg.count} comps`,
        detail: `Kun ${agg.count} friske comps i segmentet — moderat sample.`,
        category: 'marked',
        weight: 25,
      });
    } else if (agg.count > 0) {
      flags.push({
        level: 'fail',
        label: `${agg.count} comp${agg.count === 1 ? '' : 's'}`,
        detail: `Få friske comps i segmentet (${agg.count}) — svag validering.`,
        category: 'marked',
        weight: 55,
      });
    } else {
      flags.push({
        level: 'fail',
        label: 'Ingen comps',
        detail: 'Ingen friske handler i samme postnr+kvm+byggeår-segment.',
        category: 'marked',
        weight: 60,
      });
    }

    // Median vs udbud
    if (agg.medianPpm && c.kvm && c.listPrice) {
      const listPpm = c.listPrice / c.kvm;
      const deltaPct = ((agg.medianPpm - listPpm) / listPpm) * 100;
      if (deltaPct >= 5) {
        flags.push({
          level: 'pass',
          label: `Median +${deltaPct.toFixed(0)}%`,
          detail: `Median af friske handler er ${deltaPct.toFixed(1)}% over vores udbud — markedet bekræfter.`,
          category: 'marked',
          weight: 75,
        });
      } else if (deltaPct >= 0) {
        flags.push({
          level: 'pass',
          label: `Median +${deltaPct.toFixed(1)}%`,
          detail: `Median er marginalt over udbud (${deltaPct.toFixed(1)}%).`,
          category: 'marked',
          weight: 35,
        });
      } else if (deltaPct >= -7) {
        flags.push({
          level: 'warn',
          label: `Median ${deltaPct.toFixed(1)}%`,
          detail: `Median lidt under udbud — marginal validering.`,
          category: 'marked',
          weight: 30,
        });
      } else {
        flags.push({
          level: 'fail',
          label: `Median ${deltaPct.toFixed(0)}%`,
          detail: `Median markant under udbud (${deltaPct.toFixed(1)}%) — markedet uenig med AVM.`,
          category: 'marked',
          weight: 70,
        });
      }
    }
  }

  // ─── STAND (Claude Vision) ─────────────────────────────────────────────
  if (c.imageAssessment) {
    const cond = c.imageAssessment.overall_condition;
    const breakers = c.imageAssessment.deal_breakers?.length ?? 0;
    if (breakers > 0) {
      flags.push({
        level: 'fail',
        label: `${breakers} deal-breaker${breakers === 1 ? '' : 's'}`,
        detail: `Vision spottede deal-breakers: ${c.imageAssessment.deal_breakers!.join('; ')}`,
        category: 'stand',
        weight: 95,
      });
    }
    if (cond >= 8) {
      flags.push({
        level: 'pass',
        label: `Stand ${cond}/10`,
        detail: `${c.imageAssessment.renovation_state}. Refurb-budget: ${c.imageAssessment.estimated_refurb_cost.toLocaleString('da-DK')} kr.`,
        category: 'stand',
        weight: 45,
      });
    } else if (cond >= 6) {
      flags.push({
        level: 'pass',
        label: `Stand ${cond}/10`,
        detail: `${c.imageAssessment.renovation_state}. Refurb-budget: ${c.imageAssessment.estimated_refurb_cost.toLocaleString('da-DK')} kr.`,
        category: 'stand',
        weight: 25,
      });
    } else {
      flags.push({
        level: 'fail',
        label: `Stand ${cond}/10`,
        detail: `${c.imageAssessment.renovation_state}. Refurb-budget: ${c.imageAssessment.estimated_refurb_cost.toLocaleString('da-DK')} kr. Skjules fra Top picks.`,
        category: 'stand',
        weight: 88,
      });
    }
  }

  // Sortér: fail først, så warn, så pass; inden for samme level efter weight desc
  const order = { fail: 0, warn: 1, pass: 2 };
  flags.sort((a, b) => {
    if (order[a.level] !== order[b.level]) return order[a.level] - order[b.level];
    return b.weight - a.weight;
  });

  return flags;
}

/**
 * Tæl flag pr level — bruges til summary-badge.
 */
export function summarizeDiagnosis(flags: DiagnoseFlag[]): {
  pass: number;
  warn: number;
  fail: number;
  verdict: 'strong' | 'ok' | 'weak';
} {
  let pass = 0, warn = 0, fail = 0;
  for (const f of flags) {
    if (f.level === 'pass') pass++;
    else if (f.level === 'warn') warn++;
    else fail++;
  }
  const verdict = fail === 0 && pass >= 4 ? 'strong' : fail <= 1 ? 'ok' : 'weak';
  return { pass, warn, fail, verdict };
}
