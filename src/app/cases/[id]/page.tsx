import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { db } from '@/lib/db/client';
import { properties } from '@/lib/db/schema';
import { CaseDetail } from './case-detail';

export const dynamic = 'force-dynamic';

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  if (!db) return <div className="text-sm text-slate-500">DB ikke konfigureret.</div>;
  const { id } = await params;
  const [row] = await db.select().from(properties).where(eq(properties.id, id));
  if (!row) notFound();
  return (
    <div className="space-y-6">
      <div>
        <Link href="/screening" className="text-sm text-slate-500 hover:text-slate-900">
          ← Tilbage til screening
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{row.address}</h1>
      </div>
      <CaseDetail property={row} />
    </div>
  );
}
