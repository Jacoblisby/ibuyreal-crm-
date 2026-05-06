import { CalculatorClient } from './calculator-client';

export const metadata = { title: 'Boligberegner — iBuyReal' };

export default function CalculatorPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Boligberegner</h1>
        <p className="mt-1 text-sm text-slate-500">
          Tast en case ind — alpha, beta og cf-yield beregnes live.
        </p>
      </div>
      <CalculatorClient />
    </div>
  );
}
