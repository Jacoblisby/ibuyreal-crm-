/**
 * Antagelser: bro mellem databasens flade række og den nestede type
 * beregningerne bruger.
 *
 * Tabellen blev tidligere kun læst af Antagelser-siden selv, så alt hvad
 * du gemte var uden effekt på screeningen — scrapen regnede altid med
 * DEFAULT_ANTAGELSER. Denne fil er det ene sted der oversætter.
 *
 * REN med vilje: ingen db-import, så client-komponenter kan bruge den
 * uden at trække postgres ind i browser-bundlen. Server-indlæsningen
 * ligger i antagelser.server.ts.
 */
import type { AntagelserRow } from '@/lib/db/schema';
import type { Antagelser } from '@/lib/types';

export function rowToAntagelser(r: AntagelserRow): Antagelser {
  return {
    adr: {
      'indre-by': r.adrIndreby,
      vesterbro: r.adrVesterbro,
      noerrebro: r.adrNoerrebro,
      oesterbro: r.adrOsterbro,
      frederiksberg: r.adrFrederiksberg,
      amager: r.adrAmager,
    },
    occ: {
      'indre-by': r.occIndreby,
      vesterbro: r.occVesterbro,
      noerrebro: r.occNoerrebro,
      oesterbro: r.occOsterbro,
      frederiksberg: r.occFrederiksberg,
      amager: r.occAmager,
    },
    langtidsleje: {
      'indre-by': r.ltIndreby,
      oesterbro: r.ltOsterbro,
      noerrebro: r.ltNoerrebro,
      vesterbro: r.ltVesterbro,
      frederiksberg: r.ltFrederiksberg,
      amager: r.ltAmager,
    },
    room: { studio: r.roomStudio, v1: r.room1v, v2: r.room2v, v3: r.room3v, v4: r.room4v },
    stand: { luksus: r.standLuksus, god: r.standGod, aeldre: r.standAeldre },
    platformPct: r.platformPct,
    rengoringKr: r.rengoringKr,
    naetterPerBooking: r.naetterPerBooking,
    adminPct: r.adminPct,
    afslagPct: r.afslagPct,
    convFeePct: r.convFeePct,
    maeglerSparKr: r.maeglerSparKr,
    txFastKr: r.txFastKr,
    txPct: r.txPct,
    beta: { worst: r.betaWorst, base: r.betaBase, best: r.betaBest },
  };
}
