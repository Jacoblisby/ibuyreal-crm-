import { db } from '@/lib/db/client';
import { properties } from '@/lib/db/schema';
import { ImportButton } from './import-button';
import { ScreeningTable } from './screening-table';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Screening — iBuyReal' };

export default async function ScreeningPage() {
  if (!db) return <div className="text-sm text-slate-500">DB ikke konfigureret.</div>;
  const rows = await db.select().from(properties);
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Screening</h1>
          <p className="mt-1 text-sm text-slate-500">{rows.length} cases i pipelinen.</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportButton />
          <a
            href="/api/properties/export"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Eksportér Excel
          </a>
          <a
            href="/calculator"
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            + Ny case
          </a>
        </div>
      </div>
      <ScreeningTable rows={rows} />
    </div>
  );
}
