import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { properties } from '@/lib/db/schema';
import { enrichImportedCase, parseScreeningV3 } from '@/lib/excel';

export async function POST(req: Request) {
  if (!db) return NextResponse.json({ error: 'DB ikke konfigureret' }, { status: 500 });

  const formData = await req.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Mangler "file" felt' }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  let cases;
  try {
    cases = parseScreeningV3(buffer);
  } catch (e) {
    return NextResponse.json(
      { error: 'Kunne ikke parse Excel-fil', detail: e instanceof Error ? e.message : null },
      { status: 400 },
    );
  }

  const imported: { id: string; address: string }[] = [];
  for (const c of cases) {
    const enriched = enrichImportedCase(c);
    const [row] = await db
      .insert(properties)
      .values({
        address: enriched.address,
        bydel: enriched.bydel,
        postnr: enriched.postnr ?? null,
        kvm: enriched.kvm,
        vaer: enriched.vaer,
        bygaar: enriched.bygaar,
        energi: enriched.energi,
        dage: enriched.dage,
        udbud: enriched.udbud,
        fmv: enriched.fmv,
        decil: enriched.decil,
        afvigelse: enriched.afvigelse,
        avmKvm: enriched.avmKvm,
        ejSkat: enriched.ejSkat,
        ejGrundskyld: enriched.ejGrundskyld,
        ejFaelles: enriched.ejFaelles,
        ejOvrige: enriched.ejOvrige,
        ejTotal: enriched.ejTotal,
        offMarketPris: enriched.offMarketPris,
        txKost: enriched.txKost,
        investeret: enriched.investeret,
        adr: enriched.adr,
        occ: enriched.occ,
        bruttoAirbnb: enriched.bruttoAirbnb,
        netAirbnb: enriched.netAirbnb,
        netCashflow: enriched.netCashflow,
        cfYieldWorst: enriched.cfYieldWorst,
        cfYieldBase: enriched.cfYieldBase,
        cfYieldBest: enriched.cfYieldBest,
        alpha: enriched.alpha,
        profitWorst: enriched.profitWorst,
        profitBase: enriched.profitBase,
        profitBest: enriched.profitBest,
        afkastWorst: enriched.afkastWorst,
        afkastBase: enriched.afkastBase,
        afkastBest: enriched.afkastBest,
        status: 'screening',
      })
      .returning({ id: properties.id, address: properties.address });
    imported.push(row);
  }

  return NextResponse.json({ count: imported.length, imported });
}
