/**
 * Upload én eller flere Resight TransactionsExport-*.xlsx-filer og
 * merge dem ind i `external_sales`-tabellen.
 *
 * Bruges af /admin/external-sales-siden så user kan uploade en
 * ny ugentlig eksport uden SSH.
 *
 * Bemærk: ingen auth lige nu — app'en er internt brug. Tilføj
 * cookie/IP-restriction hvis vi åbner bredere.
 */
import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { db } from '@/lib/db/client';
import { externalSales, type NewExternalSale } from '@/lib/db/schema';

interface ResightRow {
  'Handels-ID': string;
  'Handelsnavn': string;
  'Handelstype': string | null;
  'Handelsdato': string | null;
  'Handelsmetode': string | null;
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
  if (r['Handelstype'] !== 'Private handler') return null;
  if (r['Handelsmetode'] !== 'Almindelig fri handel') return null;

  const kvm =
    r['Enhedsareal'] && r['Enhedsareal'] > 0 ? Math.round(r['Enhedsareal']) : null;
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

export async function POST(req: Request) {
  if (!db) return NextResponse.json({ error: 'DB ikke konfigureret' }, { status: 500 });

  const formData = await req.formData();
  const files = formData.getAll('file') as File[];
  if (files.length === 0) {
    return NextResponse.json({ error: 'Ingen filer i uploaden' }, { status: 400 });
  }

  const batch = `web-upload-${new Date().toISOString().slice(0, 19)}`;
  let totalRead = 0;
  let totalValid = 0;
  let totalUpserted = 0;
  const filesProcessed: Array<{ name: string; rows: number; valid: number; upserted: number }> = [];

  for (const file of files) {
    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: 'buffer' });
    const stam = wb.Sheets['Stamdata'];
    if (!stam) {
      filesProcessed.push({ name: file.name, rows: 0, valid: 0, upserted: 0 });
      continue;
    }
    const rows = XLSX.utils.sheet_to_json<ResightRow>(stam, { defval: null });

    const yearByHandelsId = new Map<string, number>();
    const ej = wb.Sheets['Ejendomme'];
    if (ej) {
      const ejRows = XLSX.utils.sheet_to_json<EjendommeRow>(ej, { defval: null });
      for (const er of ejRows) {
        const yr = parseYear(er['Opførelsesår']);
        if (er['Handels-ID'] && yr) yearByHandelsId.set(er['Handels-ID'], yr);
      }
    }

    const normalized: NewExternalSale[] = [];
    for (const r of rows) {
      const n = normalizeRow(r, yearByHandelsId, batch);
      if (n) normalized.push(n);
    }
    totalRead += rows.length;
    totalValid += normalized.length;

    let upsertedThisFile = 0;
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
      upsertedThisFile += result.length;
    }
    totalUpserted += upsertedThisFile;
    filesProcessed.push({
      name: file.name,
      rows: rows.length,
      valid: normalized.length,
      upserted: upsertedThisFile,
    });
  }

  return NextResponse.json({
    ok: true,
    totalRead,
    totalValid,
    totalUpserted,
    filesProcessed,
  });
}
