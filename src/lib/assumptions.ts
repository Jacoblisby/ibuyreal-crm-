import type { AssumptionsRow } from '@/lib/db/schema';
import { DEFAULT_ASSUMPTIONS } from '@/lib/constants';
import type { Assumptions } from '@/lib/types';

export function rowToAssumptions(row: AssumptionsRow | null | undefined): Assumptions {
  if (!row) return DEFAULT_ASSUMPTIONS;

  return {
    adr: {
      'indre-by': row.adrIndreby,
      vesterbro: row.adrVesterbro,
      noerrebro: row.adrNoerrebro,
      'oesterbro': row.adrOsterbro,
      frederiksberg: row.adrFrederiksberg,
      amager: row.adrAmager,
    },
    occ: {
      'indre-by': row.occIndreby,
      vesterbro: row.occVesterbro,
      noerrebro: row.occNoerrebro,
      'oesterbro': row.occOsterbro,
      frederiksberg: row.occFrederiksberg,
      amager: row.occAmager,
    },
    langtidsleje: {
      'indre-by': row.ltIndreby,
      'oesterbro': row.ltOsterbro,
      noerrebro: row.ltNoerrebro,
      vesterbro: row.ltVesterbro,
      frederiksberg: row.ltFrederiksberg,
      amager: row.ltAmager,
    },
    room: {
      studio: row.roomStudio,
      v1: row.room1v,
      v2: row.room2v,
      v3: row.room3v,
      v4: row.room4v,
    },
    stand: {
      luksus: row.standLuksus,
      god: row.standGod,
      aeldre: row.standAeldre,
    },
    platformPct: row.platformPct,
    rengoringKr: row.rengoringKr,
    naetterPerBooking: row.naetterPerBooking,
    adminPct: row.adminPct,
    afslagPct: row.afslagPct,
    convFeePct: row.convFeePct,
    maeglerSparKr: row.maeglerSparKr,
    txFastKr: row.txFastKr,
    txPct: row.txPct,
    beta: { worst: row.betaWorst, base: row.betaBase, best: row.betaBest },
  };
}
