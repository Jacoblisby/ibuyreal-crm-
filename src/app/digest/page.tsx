/**
 * Forhåndsvisning af morgen-digesten — præcis den HTML der sendes som mail.
 * Nyttig til at se indholdet uden at vente på cron-mailen.
 */
import { buildDigest, renderDigestHtml } from '@/lib/digest';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Morgen-digest — iBuyReal' };

export default async function DigestPreviewPage() {
  const data = await buildDigest();
  const html = renderDigestHtml(data);
  const body = html.slice(html.indexOf('<body'), html.lastIndexOf('</body>'));

  return (
    <div>
      <p className="mb-4 text-sm text-slate-500">
        Forhåndsvisning af morgenmailen. Sendes automatisk hver dag kl. 07:45 når cron-linjen er sat op.
      </p>
      <div
        className="overflow-hidden rounded-xl border border-slate-200"
        dangerouslySetInnerHTML={{ __html: body.replace(/^<body[^>]*>/, '') }}
      />
    </div>
  );
}
