import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { db } from '@/lib/db/client';
import { assumptions, properties } from '@/lib/db/schema';
import { rowToAssumptions } from '@/lib/assumptions';
import { CaseDetail } from './case-detail';

export const dynamic = 'force-dynamic';

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  if (!db) return <div className="text-sm text-slate-500">DB ikke konfigureret.</div>;
  const { id } = await params;
  const [row] = await db.select().from(properties).where(eq(properties.id, id));
  if (!row) notFound();
  const [assumptionsRow] = await db.select().from(assumptions).where(eq(assumptions.id, 'default'));
  const assumptionsConfig = rowToAssumptions(assumptionsRow);
  return (
    <div className="space-y-6">
      <div>
        <Link href="/screening" className="text-sm text-slate-500 hover:text-slate-900">
          ← Tilbage til screening
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{row.address}</h1>
      </div>
      <CaseDetail property={row} assumptions={assumptionsConfig} />
    </div>
  );
}
