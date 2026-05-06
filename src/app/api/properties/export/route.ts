import { db } from '@/lib/db/client';
import { properties } from '@/lib/db/schema';
import { buildScreeningV3 } from '@/lib/excel';

export async function GET() {
  if (!db) return new Response(JSON.stringify({ error: 'DB ikke konfigureret' }), { status: 500 });

  const rows = await db.select().from(properties);
  const buffer = buildScreeningV3(
    rows.map((r) => ({
      address: r.address,
      bydel: r.bydel,
      kvm: r.kvm,
      vaer: r.vaer,
      bygaar: r.bygaar,
      energi: r.energi,
      dage: r.dage,
      udbud: r.udbud,
      fmv: r.fmv,
      decil: r.decil,
      adr: r.adr,
      occ: r.occ,
      ejSkat: r.ejSkat,
      ejGrundskyld: r.ejGrundskyld,
      ejFaelles: r.ejFaelles,
      ejOvrige: r.ejOvrige,
      ejTotal: r.ejTotal,
    })),
  );

  const filename = `Screening_Overblik_${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
