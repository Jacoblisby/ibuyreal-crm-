/**
 * Morgen-digest: byg og send dagens overblik som mail.
 *
 * Auth: Bearer CRON_SECRET (samme mønster som /api/cron/scrape).
 * Query:
 *   ?dry=1     byg og returnér HTML uden at sende (test / ekstern afsendelse)
 *   ?record=1  marker dagens cases som rapporteret UDEN at sende. Bruges når
 *              mailen sendes ad anden vej (fx af en planlagt Claude-opgave):
 *              hent HTML med dry=1, send den, og kald derefter record=1 så
 *              næste mail kun viser det der er nyt. Rækkefølgen er vigtig —
 *              record først ville sluge dagens nyheder hvis afsendelsen fejler.
 *
 * Env der skal sættes i Coolify:
 *   SMTP_USER   afsender-adresse (fx jacob@faurholt.com)
 *   SMTP_PASS   Google app-adgangskode (16 tegn, IKKE din normale kode)
 *   DIGEST_TO   modtager — defaulter til SMTP_USER
 *   SMTP_HOST   valgfri, default smtp.gmail.com
 *   SMTP_PORT   valgfri, default 465 (SSL)
 *
 * Cron-linje på hosten (efter scrape kl 07:00):
 *   45 7 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://app.ibrc.dk/api/cron/digest
 */
import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { db } from '@/lib/db/client';
import { digestRuns } from '@/lib/db/schema';
import { buildDigest, renderDigestHtml, renderDigestSubject } from '@/lib/digest';

export const maxDuration = 300;

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET mangler' }, { status: 503 });
  const provided = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (provided !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!db) return NextResponse.json({ error: 'DB ikke konfigureret' }, { status: 500 });

  const params = new URL(req.url).searchParams;
  const dry = params.get('dry') === '1';
  const recordOnly = params.get('record') === '1';

  const data = await buildDigest();
  const html = renderDigestHtml(data);
  const subject = renderDigestSubject(data);

  if (recordOnly) {
    await db.insert(digestRuns).values({
      recipient: process.env.DIGEST_TO ?? 'ekstern-afsendelse',
      ok: true,
      topPickIds: data.seen.topPickIds,
      handymanIds: data.seen.handymanIds,
      priceCutIds: data.seen.priceCutIds,
    });
    return NextResponse.json({ ok: true, recorded: true, subject });
  }

  if (dry) {
    return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const to = process.env.DIGEST_TO || user;
  if (!user || !pass || !to) {
    return NextResponse.json(
      { error: 'SMTP_USER / SMTP_PASS mangler i miljøet — sæt dem i Coolify' },
      { status: 503 },
    );
  }

  try {
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT || 465),
      secure: Number(process.env.SMTP_PORT || 465) === 465,
      auth: { user, pass },
    });
    await transport.sendMail({ from: `iBuyReal CRM <${user}>`, to, subject, html });

    await db.insert(digestRuns).values({
      recipient: to,
      ok: true,
      topPickIds: data.seen.topPickIds,
      handymanIds: data.seen.handymanIds,
      priceCutIds: data.seen.priceCutIds,
    });

    return NextResponse.json({
      ok: true,
      to,
      subject,
      counts: {
        topPicks: data.newTopPicks.length,
        handyman: data.newHandyman.length,
        priceCuts: data.priceCuts.length,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Fejlede kørsler logges MED ok=false, så de ikke tæller som "sidst sendt"
    // og dermed ikke sluger dagens nyheder.
    await db.insert(digestRuns).values({ recipient: to, ok: false, error: msg.slice(0, 500) });
    return NextResponse.json({ error: `Mail-afsendelse fejlede: ${msg}` }, { status: 502 });
  }
}
