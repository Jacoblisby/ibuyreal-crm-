/**
 * Seed-data: 7 cases fra spec'en + default Antagelser-row.
 *
 * Kør med: npm run db:seed
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { calculateProperty } from '../calculator';
import type { Bydel } from '../types';
import { antagelser, properties } from './schema';

interface SeedCase {
  address: string;
  bydel: Bydel;
  kvm: number;
  vaer: number;
  bygaar: number | null;
  udbud: number;
  fmv: number;
  ejTotal: number;
}

// Cases fra spec'ens seed-tabel. ejTotal er estimat (tabellen viser ikke det).
const SEED_CASES: SeedCase[] = [
  { address: 'Østergade 11, 3.', bydel: 'indre-by', kvm: 89, vaer: 3, bygaar: 1900, udbud: 6_995_000, fmv: 8_328_964, ejTotal: 30_000 },
  { address: 'Store Kongensgade 92D', bydel: 'indre-by', kvm: 105, vaer: 3, bygaar: 1900, udbud: 9_500_000, fmv: 10_955_867, ejTotal: 36_000 },
  { address: 'Fredensgade 13, 1. th.', bydel: 'noerrebro', kvm: 73, vaer: 2, bygaar: 1900, udbud: 6_195_000, fmv: 7_019_310, ejTotal: 26_000 },
  { address: 'Havneholmen 48, 5. th.', bydel: 'vesterbro', kvm: 77, vaer: 2, bygaar: 2010, udbud: 6_995_000, fmv: 7_643_330, ejTotal: 28_000 },
  { address: 'Larsbjørnsstræde 7A, 2.', bydel: 'indre-by', kvm: 135, vaer: 4, bygaar: 1850, udbud: 9_395_000, fmv: 10_196_247, ejTotal: 42_000 },
  { address: 'Nyhavn 31C, 4.', bydel: 'indre-by', kvm: 138, vaer: 4, bygaar: 1850, udbud: 9_995_000, fmv: 10_684_318, ejTotal: 44_000 },
  { address: 'Mariendalsvej 50F, 2. mf.', bydel: 'frederiksberg', kvm: 66, vaer: 2, bygaar: 1900, udbud: 4_995_000, fmv: 5_428_373, ejTotal: 23_000 },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL ikke sat');
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  console.log('→ Sletter eksisterende seed-data...');
  await db.delete(properties);
  await db.delete(antagelser);

  console.log('→ Indsætter default antagelser...');
  await db.insert(antagelser).values({ id: 'default' });

  console.log('→ Indsætter 7 seed cases (med beregnede tal)...');
  for (const c of SEED_CASES) {
    const calc = calculateProperty({
      bydel: c.bydel,
      kvm: c.kvm,
      vaer: c.vaer,
      bygaar: c.bygaar,
      udbud: c.udbud,
      fmv: c.fmv,
      ejTotal: c.ejTotal,
    });
    await db.insert(properties).values({
      address: c.address,
      bydel: c.bydel,
      kvm: c.kvm,
      vaer: c.vaer,
      bygaar: c.bygaar,
      udbud: c.udbud,
      fmv: c.fmv,
      ejTotal: c.ejTotal,
      afvigelse: (c.udbud - c.fmv) / c.fmv,
      avmKvm: c.fmv / c.kvm,
      offMarketPris: calc.offMarket.offMarketPris,
      txKost: calc.tx,
      investeret: calc.investeret,
      adr: calc.airbnb.adr,
      occ: calc.airbnb.occ,
      bruttoAirbnb: calc.airbnb.brutto,
      netAirbnb: calc.airbnb.netAirbnb,
      netCashflow: calc.airbnb.netAirbnb - c.ejTotal,
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
      status: 'screening',
    });
    console.log(`  ✓ ${c.address} — alpha ${(calc.alpha * 100).toFixed(1)}%, best ${(calc.best.afkast * 100).toFixed(1)}%`);
  }

  await client.end();
  console.log('\n✅ Seed færdig');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
