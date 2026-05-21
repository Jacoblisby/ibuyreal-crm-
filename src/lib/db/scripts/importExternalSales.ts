/**
 * Import Resight tinglysningsdata fra TransactionsExport-*.xlsx
 * ind i `external_sales`-tabellen.
 *
 * Brug:
 *   npx tsx --env-file=.env.local src/lib/db/scripts/importExternalSales.ts \
 *     "/path/til/TransactionsExport (4).xlsx" \
 *     "/path/til/TransactionsExport (5).xlsx"
 *
 * Idempotency: handelsId er UNIQUE. Vi bruger ON CONFLICT DO NOTHING,
 * så samme fil kan re-køres uden duplikater.
 *
 * Filter ved import:
 *   - Kun Handelstype === "Private handler" (ikke familie/auktion)
 *   - Kun Handelsmetode === "Almindelig fri handel"
 *   - Skal have valid Handelsdato + Pris + Enhedsareal > 0
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as XLSX from 'xlsx';
import path from 'node:path';
import { externalSales, type NewExternalSale } from '../schema';

interface ResightRow {
  'Handels-ID': string;
  'Handelsnavn': string;
  'Handelstype': string | null;
  'Handelsdato': string | null;
  'Handelsmetode': string | null;
  'Ejendomstype': string | null;
  'Anvendelse': string | null;
  'Kommunekode': number | null;
  'Postnr': number | null;
  'Pris': number | null;
  'Enhedsareal': number | null;
  'Pris pr. m2 (enhedsareal)': number | null;
  'Mægler firma': string | null;
}

interface EjendommeRow {
  'Handels-ID': string;
  'Opførelsesår': number | string | null;
}

function parseYear(v: number | string | null | undefined): number | null {
  if (v == null || v === '-' || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  if (!Number.isFinite(n) || n < 1700 || n > 2100) return null;
  return n;
}

function normalizeRow(
  r: ResightRow,
  yearByHandelsId: Map<string, number>,
  batch: string,
): NewExternalSale | null {
  if (!r['Handels-ID'] || !r['Handelsnavn']) return null;
  if (!r['Handelsdato']) return null;
  if (!r['Pris'] || r['Pris'] < 100_000) return null;
  if (!r['Postnr']) return null;

  // Filter til private + fri handel (samme som scrape-pipeline'en)
  if (r['Handelstype'] !== 'Private handler') return null;
  if (r['Handelsmetode'] !== 'Almindelig fri handel') return null;

  const kvm = r['Enhedsareal'] && r['Enhedsareal'] > 0 ? Math.round(r['Enhedsareal']) : null;
  const ppm =
    r['Pris pr. m2 (enhedsareal)'] && r['Pris pr. m2 (enhedsareal)'] > 0
      ? r['Pris pr. m2 (enhedsareal)']
      : kvm
      ? r['Pris']! / kvm
      : null;

  return {
    handelsId: r['Handels-ID'],
    address: r['Handelsnavn'].trim(),
    saleDate: String(r['Handelsdato']).slice(0, 10),
    amount: r['Pris'],
    kvm,
    perAreaPrice: ppm,
    yearBuilt: yearByHandelsId.get(r['Handels-ID']) ?? null,
    postalCode: String(r['Postnr']),
    municipalityCode: r['Kommunekode'] ?? null,
    handelstype: r['Handelstype'] ?? null,
    handelsmetode: r['Handelsmetode'] ?? null,
    anvendelse: r['Anvendelse'] ?? null,
    broker: r['Mægler firma'] === '-' ? null : r['Mægler firma'] ?? null,
    importBatch: batch,
  };
}

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Usage: importExternalSales.ts <xlsx> [<xlsx>...]');
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const pg = postgres(url, { max: 4 });
  const db = drizzle(pg);

  const batch = `import-${new Date().toISOString().slice(0, 19)}`;
  let totalRead = 0;
  let totalSkipped = 0;
  let totalInserted = 0;

  for (const f of files) {
    const abs = path.resolve(f);
    console.log(`\n[${path.basename(abs)}]`);
    const wb = XLSX.readFile(abs);
    const sheet = wb.Sheets['Stamdata'];
    if (!sheet) {
      console.warn('  ⚠ No "Stamdata" sheet, skipping');
      continue;
    }
    const rows = XLSX.utils.sheet_to_json<ResightRow>(sheet, { defval: null });
    totalRead += rows.length;

    // Build byggeår-lookup fra Ejendomme-sheet (joined på Handels-ID)
    const yearByHandelsId = new Map<string, number>();
    const ejendommeSheet = wb.Sheets['Ejendomme'];
    if (ejendommeSheet) {
      const ejRows = XLSX.utils.sheet_to_json<EjendommeRow>(ejendommeSheet, { defval: null });
      for (const er of ejRows) {
        const yr = parseYear(er['Opførelsesår']);
        if (er['Handels-ID'] && yr) yearByHandelsId.set(er['Handels-ID'], yr);
      }
      console.log(`  byggeår-lookup: ${yearByHandelsId.size} af ${ejRows.length} ejendomme har valid Opførelsesår`);
    } else {
      console.warn('  ⚠ ingen "Ejendomme"-sheet — byggeår vil være null');
    }

    const normalized: NewExternalSale[] = [];
    for (const r of rows) {
      const n = normalizeRow(r, yearByHandelsId, batch);
      if (n) normalized.push(n);
      else totalSkipped++;
    }

    console.log(`  ${rows.length} rows read, ${normalized.length} valid, ${rows.length - normalized.length} skipped`);

    // Batch upsert (250 ad gangen — postgres parameter limit).
    // ON CONFLICT DO UPDATE så re-import overskriver f.eks. nytilkomne yearBuilt
    // eller rettede priser uden at miste data.
    const BATCH = 250;
    for (let i = 0; i < normalized.length; i += BATCH) {
      const chunk = normalized.slice(i, i + BATCH);
      const result = await db
        .insert(externalSales)
        .values(chunk)
        .onConflictDoUpdate({
          target: externalSales.handelsId,
          set: {
            yearBuilt: sql`EXCLUDED.year_built`,
            kvm: sql`EXCLUDED.kvm`,
            perAreaPrice: sql`EXCLUDED.per_area_price`,
            amount: sql`EXCLUDED.amount`,
            address: sql`EXCLUDED.address`,
            saleDate: sql`EXCLUDED.sale_date`,
            anvendelse: sql`EXCLUDED.anvendelse`,
            broker: sql`EXCLUDED.broker`,
            importBatch: sql`EXCLUDED.import_batch`,
          },
        })
        .returning({ id: externalSales.id });
      totalInserted += result.length;
    }
  }

  console.log(`\n✓ Done. Read ${totalRead}, skipped ${totalSkipped}, inserted ${totalInserted} (rest were duplicates).`);

  await pg.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
