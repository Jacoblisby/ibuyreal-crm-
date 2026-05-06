import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db/client';
import { onMarketCandidates } from '@/lib/db/schema';
import { CandidateDetail } from './candidate-detail';

export const dynamic = 'force-dynamic';

export default async function OnMarketCasePage({ params }: { params: Promise<{ id: string }> }) {
  if (!db) return <div className="text-sm text-slate-500">DB ikke konfigureret.</div>;
  const { id } = await params;
  const [cand] = await db.select().from(onMarketCandidates).where(eq(onMarketCandidates.id, id));
  if (!cand) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/on-market" className="text-sm text-slate-500 hover:text-slate-900">
          ← Tilbage til on-market
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{cand.address}</h1>
        <p className="text-sm text-slate-500">
          {cand.postalCode} {cand.city} · {cand.brokerKind}
          {cand.realtorName && <> · {cand.realtorName}</>}
        </p>
      </div>
      <CandidateDetail candidate={cand} />
    </div>
  );
}
