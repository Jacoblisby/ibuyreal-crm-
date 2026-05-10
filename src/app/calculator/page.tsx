import { CalculatorClient } from './calculator-client';
import { eq } from 'drizzle-orm';
import { rowToAssumptions } from '@/lib/assumptions';
import { db } from '@/lib/db/client';
import { assumptions } from '@/lib/db/schema';

export const metadata = { title: 'Boligberegner — iBuyReal' };

export default async function CalculatorPage() {
  const assumptionsConfig = db
    ? rowToAssumptions(
        (await db.select().from(assumptions).where(eq(assumptions.id, 'default')))[0],
      )
    : rowToAssumptions(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Boligberegner</h1>
        <p className="mt-1 text-sm text-slate-500">
          Tast en case ind — alpha, beta og cf-yield beregnes live.
        </p>
      </div>
      <CalculatorClient assumptions={assumptionsConfig} />
    </div>
  );
}
