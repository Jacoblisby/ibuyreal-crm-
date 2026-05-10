import { db } from '@/lib/db/client';
import { getOnMarketRows } from '@/lib/on-market';
import { OnMarketClient } from './on-market-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'On-market — iBuyReal' };

export default async function OnMarketPage() {
  if (!db) return <div className="text-sm text-slate-500">DB ikke konfigureret.</div>;

  const rows = await getOnMarketRows({ status: 'active' });

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">On-market</h1>
          <p className="mt-1 text-sm text-slate-500">
            Boligsiden — 2-3 vær. ejerlejligheder i København + Frederiksberg
          </p>
        </div>
      </div>
      <OnMarketClient initial={rows} />
    </div>
  );
}
