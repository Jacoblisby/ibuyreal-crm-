import { db } from '@/lib/db/client';
import { externalSales } from '@/lib/db/schema';
import { desc, max, count } from 'drizzle-orm';
import { ExternalSalesUploadClient } from './upload-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Resight upload — iBuyReal' };

export default async function ExternalSalesUploadPage() {
  if (!db)
    return <div className="text-sm text-slate-500">DB ikke konfigureret.</div>;

  const [stats] = await db
    .select({
      total: count(externalSales.id),
      latestSale: max(externalSales.saleDate),
      latestImport: max(externalSales.importedAt),
    })
    .from(externalSales);

  const recentBatches = await db
    .select({
      batch: externalSales.importBatch,
      n: count(externalSales.id),
      latestImport: max(externalSales.importedAt),
    })
    .from(externalSales)
    .groupBy(externalSales.importBatch)
    .orderBy(desc(max(externalSales.importedAt)))
    .limit(5);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Resight upload</h1>
        <p className="mt-1 text-sm text-slate-500">
          Upload friske TransactionsExport-*.xlsx-filer fra Resight. Eksisterende
          handler opdateres (upsert på Handels-ID), nye indsættes. Anbefalet kadence:
          en gang om ugen.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Total handler i DB" value={stats?.total.toLocaleString('da-DK') ?? '–'} />
        <Stat label="Nyeste handelsdato" value={stats?.latestSale ?? '–'} />
        <Stat
          label="Sidste import"
          value={
            stats?.latestImport
              ? new Date(stats.latestImport).toLocaleString('da-DK', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })
              : '–'
          }
        />
      </div>

      <ExternalSalesUploadClient />

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-2 text-xs font-medium uppercase tracking-wider text-slate-500">
          Seneste import-batches
        </div>
        <ul className="divide-y divide-slate-100 text-sm">
          {recentBatches.length === 0 ? (
            <li className="px-4 py-3 text-slate-400 italic">Ingen import endnu</li>
          ) : (
            recentBatches.map((b) => (
              <li key={b.batch ?? 'null'} className="flex items-center justify-between px-4 py-2.5">
                <span className="font-mono text-xs text-slate-700">{b.batch ?? '(uden batch-tag)'}</span>
                <span className="tabular-nums text-xs text-slate-500">{b.n} rows</span>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1.5 text-xl font-bold tabular-nums tracking-tight text-slate-900">{value}</div>
    </div>
  );
}
