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

      <div className="rounded-xl border border-amber-200/70 bg-amber-50/40 p-5 shadow-sm">
        <div className="flex items-baseline justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-amber-900">
              📊 AVM Fejl-analyse
            </h2>
            <p className="mt-1 text-xs text-amber-800">
              Markdown-dokument der opsummerer hvorfor 87% af AVMs "positive α"-cases er
              falske positiver, plus prioriterede model-anbefalinger til retrain.
            </p>
          </div>
          <a
            href="/api/admin/avm-analysis?format=markdown"
            download
            className="inline-flex items-center gap-2 rounded-md bg-amber-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-800 active:scale-[0.97]"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download analyse.md
          </a>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 text-xs text-slate-700">
        <strong className="text-slate-900">Hvordan bruges det:</strong>
        <ol className="mt-2 list-decimal pl-5 space-y-1">
          <li>Send <code className="font-mono bg-white px-1">analyse.md</code> til Lambda-team som kontekst-dokument</li>
          <li>Send <code className="font-mono bg-white px-1">features.csv</code> + <code className="font-mono bg-white px-1">sales.csv</code> som data</li>
          <li>
            Features.csv har nu også vores diagnostik-flag (<code className="font-mono bg-white px-1">is_ground_floor</code>, <code className="font-mono bg-white px-1">era_bucket</code>, <code className="font-mono bg-white px-1">is_noisy_street</code>, <code className="font-mono bg-white px-1">kvm_bucket</code>, <code className="font-mono bg-white px-1">our_verdict</code>) som de kan bruge som features eller som ground-truth labels
          </li>
          <li>Træn ny model på <code className="font-mono bg-white px-1">amount/kvm</code> som target, med Vision-features + byggeår + etage som nye inputs</li>
        </ol>
      </div>
    </div>
  );
}
