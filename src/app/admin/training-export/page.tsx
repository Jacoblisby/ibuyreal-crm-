import { db } from '@/lib/db/client';
import { externalSales, onMarketCandidates } from '@/lib/db/schema';
import { eq, count, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AVM training export — iBuyReal' };

export default async function TrainingExportPage() {
  if (!db) return <div className="text-sm text-slate-500">DB ikke konfigureret.</div>;

  const [features] = await db
    .select({
      total: count(onMarketCandidates.id),
      withAvm: sql<number>`COUNT(*) FILTER (WHERE ${onMarketCandidates.v3FmvSource} = 'ibuyreal-avm')`,
      withVision: sql<number>`COUNT(*) FILTER (WHERE ${onMarketCandidates.imageAssessment} IS NOT NULL)`,
      withYearBuilt: sql<number>`COUNT(*) FILTER (WHERE ${onMarketCandidates.yearBuilt} IS NOT NULL)`,
    })
    .from(onMarketCandidates)
    .where(eq(onMarketCandidates.status, 'active'));

  const [sales] = await db
    .select({
      total: count(externalSales.id),
      withYearBuilt: sql<number>`COUNT(*) FILTER (WHERE ${externalSales.yearBuilt} IS NOT NULL)`,
    })
    .from(externalSales);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AVM training export</h1>
        <p className="mt-1 text-sm text-slate-500">
          To CSV-eksports til AVM Lambda-teamet: rich features fra current listings + ground
          truth fra Resight tinglysningsdata. Brug til quarterly retrain.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-semibold tracking-tight text-slate-900">
              features.csv
            </h2>
            <span className="text-xs text-slate-400">{features?.total ?? 0} rows</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Current active listings + AVM-predictions + Vision-output + Resight-byggeår
          </p>
          <ul className="mt-3 space-y-1 text-xs text-slate-600">
            <li>· {features?.withAvm ?? 0} med AVM-prediction</li>
            <li>· {features?.withVision ?? 0} med Vision-assessment</li>
            <li>· {features?.withYearBuilt ?? 0} med byggeår</li>
          </ul>
          <a
            href="/api/admin/training-export?which=features"
            download
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-800 active:scale-[0.97]"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download features.csv
          </a>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-semibold tracking-tight text-slate-900">
              sales.csv
            </h2>
            <span className="text-xs text-slate-400">{sales?.total ?? 0} rows</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Resight tinglysningsdata — labeled ground truth (faktiske salgspriser)
          </p>
          <ul className="mt-3 space-y-1 text-xs text-slate-600">
            <li>· {sales?.withYearBuilt ?? 0} med byggeår</li>
            <li>· Kun private handler + almindelig fri handel</li>
          </ul>
          <a
            href="/api/admin/training-export?which=sales"
            download
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-800 active:scale-[0.97]"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download sales.csv
          </a>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 text-xs text-slate-700">
        <strong className="text-slate-900">Hvordan bruges det:</strong>
        <ol className="mt-2 list-decimal pl-5 space-y-1">
          <li>Send begge CSV'er til Lambda-teamet</li>
          <li>De joiner på <code className="font-mono bg-white px-1">address</code> for at finde sales-cases hvor vi har feature-data</li>
          <li>Træn ny model på <code className="font-mono bg-white px-1">amount/kvm</code> som target, med Vision-features + byggeår som nye inputs</li>
          <li>Vi måler bias-reduktion via vores client-side calibration (faktor skulle nærme sig 1.0)</li>
        </ol>
      </div>
    </div>
  );
}
