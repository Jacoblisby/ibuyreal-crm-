import { db } from '@/lib/db/client';
import { investors, properties } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { InvestorsClient } from './investors-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Investorer — iBuyReal' };

export default async function InvestorsPage() {
  if (!db) return <div className="text-sm text-slate-500">DB ikke konfigureret.</div>;

  const allInvestors = await db.select().from(investors);
  const allProperties = await db.select().from(properties);

  // Aggreger per investor
  const stats = allInvestors.map((inv) => {
    const ejendomme = allProperties.filter((p) => p.investorId === inv.id);
    return {
      ...inv,
      antalEjendomme: ejendomme.length,
      faktiskDeployed: ejendomme.reduce((s, p) => s + (p.investeret ?? 0), 0),
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Investorer</h1>
        <p className="mt-1 text-sm text-slate-500">
          Kapitalallokering og ejendomstildeling.
        </p>
      </div>
      <InvestorsClient initial={stats} properties={allProperties} />
    </div>
  );
}
