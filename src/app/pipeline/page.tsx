import { db } from '@/lib/db/client';
import { properties } from '@/lib/db/schema';
import { Kanban } from './kanban';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pipeline — iBuyReal' };

export default async function PipelinePage() {
  if (!db) return <div className="text-sm text-slate-500">DB ikke konfigureret.</div>;
  const rows = await db.select().from(properties);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
        <p className="mt-1 text-sm text-slate-500">
          Træk kort mellem statusser. {rows.length} cases i alt.
        </p>
      </div>
      <Kanban initial={rows} />
    </div>
  );
}
