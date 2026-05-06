import { db } from '@/lib/db/client';
import { antagelser, properties } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { SettingsClient } from './settings-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Antagelser — iBuyReal' };

export default async function SettingsPage() {
  if (!db) return <div className="text-sm text-slate-500">DB ikke konfigureret.</div>;
  let [row] = await db.select().from(antagelser).where(eq(antagelser.id, 'default'));
  if (!row) {
    [row] = await db.insert(antagelser).values({ id: 'default' }).returning();
  }
  const cases = await db.select().from(properties);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Antagelser</h1>
        <p className="mt-1 text-sm text-slate-500">
          Justér parametre og se konsekvensen live på en valgt case.
        </p>
      </div>
      <SettingsClient antagelser={row} cases={cases} />
    </div>
  );
}
