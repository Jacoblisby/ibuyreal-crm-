/**
 * Morgen-digest: hvad er nyt på markedet siden sidste mail?
 *
 * Tre sektioner (valgt af Jacob):
 *   1. Nye Top picks   — cases der er kommet ind i top 20 siden sidst
 *   2. Nye håndværkertilbud — renoveringssager (flag, tekst eller Vision-stand ≤4)
 *   3. Prisnedsættelser — aktive cases hvor udbudsprisen er faldet
 *
 * "Nyt siden sidst" afgøres mod digest_runs-tabellen: hver afsendt mail
 * gemmer de rapporterede id'er, så samme case ikke dukker op to gange.
 * Første kørsel uden historik falder tilbage til "set inden for 7 dage"
 * og caps, så den første mail ikke bliver på 900 rækker.
 */
import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { digestRuns, externalSales, onMarketCandidates } from '@/lib/db/schema';
import type { OnMarketCandidate } from '@/lib/db/schema';
import { computeStrongFreshCompMap } from '@/lib/strongComps';
import { computeCalibration } from '@/lib/avmCalibration';
import { pickCurated } from '@/lib/curation';
import { BYDEL_LABEL } from '@/lib/status';

const APP_URL = 'https://app.ibrc.dk';
/** Maks rækker pr. sektion — en mail skal kunne skimmes på en telefon. */
const SECTION_CAP = 12;

export interface DigestRow {
  id: string;
  address: string;
  postalCode: string;
  bydel: string | null;
  kvm: number | null;
  listPrice: number | null;
  ppm: number | null;
  alpha: number | null;
  stand: number | null;
  refurb: number | null;
  sunScore: number | null;
  daysOnMarket: number | null;
  compCount: number;
  /** Kun prisnedsættelser */
  previousListPrice?: number | null;
  cutPct?: number | null;
}

export interface DigestData {
  generatedAt: Date;
  previousRunAt: Date | null;
  isFirstRun: boolean;
  newTopPicks: DigestRow[];
  newHandyman: DigestRow[];
  priceCuts: DigestRow[];
  /** Id'er der skal gemmes så næste mail kun viser nyt */
  seen: { topPickIds: string[]; handymanIds: string[]; priceCutIds: string[] };
  totals: { active: number; untriaged: number };
}

const HANDYMAN_SQL = sql`(
  ${onMarketCandidates.handymanListing}
  OR (${onMarketCandidates.imageAssessment}->>'overall_condition')::int <= 4
  OR lower(coalesce(${onMarketCandidates.descriptionTitle},'') || ' ' || coalesce(${onMarketCandidates.description},''))
     ~ 'håndværkertilbud|som beset|som besigtiget|renoveringsprojekt|gennemgribende renovering|fuld istandsættelse|totalrenovering|trænger til|kærlig hånd'
)`;

function toRow(c: OnMarketCandidate, compCount = 0): DigestRow {
  const assessment = c.imageAssessment as { overall_condition?: number; estimated_refurb_cost?: number } | null;
  return {
    id: c.id,
    address: c.address,
    postalCode: c.postalCode,
    bydel: c.bydel,
    kvm: c.kvm,
    listPrice: c.listPrice,
    ppm: c.kvm && c.listPrice ? Math.round(c.listPrice / c.kvm) : null,
    alpha: c.v3Alpha,
    stand: assessment?.overall_condition ?? null,
    refurb: assessment?.estimated_refurb_cost ?? null,
    sunScore: c.sunScore,
    daysOnMarket: c.daysOnMarket,
    compCount,
  };
}

export async function buildDigest(): Promise<DigestData> {
  if (!db) throw new Error('DB ikke konfigureret');

  const now = new Date();
  const [lastRun] = await db
    .select()
    .from(digestRuns)
    .where(eq(digestRuns.ok, true))
    .orderBy(desc(digestRuns.sentAt))
    .limit(1);

  const isFirstRun = !lastRun;
  const previousRunAt = lastRun?.sentAt ?? null;
  const seenTop = new Set(lastRun?.topPickIds ?? []);
  const seenHandyman = new Set(lastRun?.handymanIds ?? []);

  // Fallback-vindue ved første kørsel: kun det der er set inden for 7 dage
  const fallbackCutoff = new Date(now);
  fallbackCutoff.setDate(fallbackCutoff.getDate() - 7);

  const rows = await db.select().from(onMarketCandidates);
  const active = rows.filter((r) => r.status === 'active');

  // ── 1. Top picks (samme pipeline som /on-market/triage) ──
  const cutoff4m = new Date(now);
  cutoff4m.setMonth(cutoff4m.getMonth() - 4);
  const extRows = await db
    .select({
      address: externalSales.address,
      saleDate: externalSales.saleDate,
      amount: externalSales.amount,
      kvm: externalSales.kvm,
      perAreaPrice: externalSales.perAreaPrice,
      yearBuilt: externalSales.yearBuilt,
      postalCode: externalSales.postalCode,
    })
    .from(externalSales)
    .where(gte(externalSales.saleDate, cutoff4m.toISOString().slice(0, 10)));

  const strongFreshMap = computeStrongFreshCompMap(rows, extRows, { monthsBack: 3 });
  const calibration = computeCalibration(rows, strongFreshMap);
  const curated = pickCurated(rows, 20, { strongFreshMap, calibration });

  const allTopPickIds = curated.map((c) => c.id);
  const newTopPicks = curated
    .filter((c) => {
      if (!isFirstRun) return !seenTop.has(c.id);
      return (c.firstSeenAt ?? new Date(0)) >= fallbackCutoff;
    })
    .slice(0, SECTION_CAP)
    .map((c) => toRow(c, strongFreshMap[c.id]?.count ?? 0));

  // ── 2. Håndværkertilbud ──
  const handymanRows = await db
    .select()
    .from(onMarketCandidates)
    .where(and(eq(onMarketCandidates.status, 'active'), HANDYMAN_SQL));

  const allHandymanIds = handymanRows.map((c) => c.id);
  const newHandyman = handymanRows
    .filter((c) => {
      if (!isFirstRun) return !seenHandyman.has(c.id);
      return (c.firstSeenAt ?? new Date(0)) >= fallbackCutoff;
    })
    .sort((a, b) => (b.v3Alpha ?? -99) - (a.v3Alpha ?? -99))
    .slice(0, SECTION_CAP)
    .map((c) => toRow(c, strongFreshMap[c.id]?.count ?? 0));

  // ── 3. Prisnedsættelser siden sidste kørsel ──
  const cutSince = previousRunAt ?? fallbackCutoff;
  const cutRows = await db
    .select()
    .from(onMarketCandidates)
    .where(
      and(
        eq(onMarketCandidates.status, 'active'),
        isNotNull(onMarketCandidates.previousListPrice),
        isNotNull(onMarketCandidates.priceChangedAt),
        gte(onMarketCandidates.priceChangedAt, cutSince),
        sql`${onMarketCandidates.listPrice} < ${onMarketCandidates.previousListPrice}`,
      ),
    );

  const priceCuts = cutRows
    .map((c) => {
      const row = toRow(c, strongFreshMap[c.id]?.count ?? 0);
      const prev = c.previousListPrice ?? 0;
      row.previousListPrice = prev;
      row.cutPct = prev > 0 && c.listPrice ? (c.listPrice - prev) / prev : null;
      return row;
    })
    .sort((a, b) => (a.cutPct ?? 0) - (b.cutPct ?? 0))
    .slice(0, SECTION_CAP);

  const untriaged = active.filter((c) => c.reviewStatus === 'ny').length;

  return {
    generatedAt: now,
    previousRunAt,
    isFirstRun,
    newTopPicks,
    newHandyman,
    priceCuts,
    seen: {
      topPickIds: allTopPickIds,
      handymanIds: allHandymanIds,
      priceCutIds: priceCuts.map((r) => r.id),
    },
    totals: { active: active.length, untriaged },
  };
}

// ─── Rendering ───────────────────────────────────────────────────────────

const kr = (n: number | null | undefined) =>
  n == null ? '–' : new Intl.NumberFormat('da-DK', { maximumFractionDigits: 0 }).format(n) + ' kr.';
const pct = (n: number | null | undefined) =>
  n == null ? '–' : `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function rowHtml(r: DigestRow, kind: 'top' | 'handyman' | 'cut'): string {
  const bydel = r.bydel ? BYDEL_LABEL[r.bydel] ?? r.bydel : '';
  const meta = [
    `${r.postalCode} ${bydel}`.trim(),
    r.kvm ? `${r.kvm} m²` : null,
    r.ppm ? `${new Intl.NumberFormat('da-DK').format(r.ppm)} kr/m²` : null,
    r.daysOnMarket != null ? `${r.daysOnMarket} dage` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const chips: string[] = [];
  if (kind === 'cut' && r.cutPct != null) {
    chips.push(
      `<span style="background:#fee2e2;color:#991b1b;padding:2px 7px;border-radius:10px;font-size:12px">${pct(r.cutPct)} · var ${kr(r.previousListPrice)}</span>`,
    );
  }
  if (r.alpha != null) {
    const good = r.alpha >= 0;
    chips.push(
      `<span style="background:${good ? '#dcfce7' : '#f1f5f9'};color:${good ? '#166534' : '#475569'};padding:2px 7px;border-radius:10px;font-size:12px">α ${pct(r.alpha)}</span>`,
    );
  }
  if (r.stand != null) {
    chips.push(
      `<span style="background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:10px;font-size:12px">stand ${r.stand}/10${r.refurb ? ` · ${Math.round(r.refurb / 1000)}k` : ''}</span>`,
    );
  }
  if (r.compCount > 0) {
    chips.push(
      `<span style="background:#e0e7ff;color:#3730a3;padding:2px 7px;border-radius:10px;font-size:12px">${r.compCount} comps</span>`,
    );
  }
  if (r.sunScore != null) {
    chips.push(
      `<span style="background:${r.sunScore >= 60 ? '#ffedd5' : '#f1f5f9'};color:${r.sunScore >= 60 ? '#9a3412' : '#64748b'};padding:2px 7px;border-radius:10px;font-size:12px">sol ${r.sunScore}</span>`,
    );
  }

  return `<tr><td style="padding:12px 0;border-bottom:1px solid #e2e8f0">
  <a href="${APP_URL}/on-market/${r.id}" style="color:#0f172a;font-size:15px;font-weight:500;text-decoration:none">${esc(r.address)}</a>
  <span style="float:right;color:#0f172a;font-size:15px;font-weight:600">${kr(r.listPrice)}</span>
  <div style="color:#64748b;font-size:13px;margin-top:3px">${esc(meta)}</div>
  <div style="margin-top:6px">${chips.join(' ')}</div>
</td></tr>`;
}

function sectionHtml(title: string, sub: string, rows: DigestRow[], kind: 'top' | 'handyman' | 'cut'): string {
  if (rows.length === 0) {
    return `<h2 style="font-size:16px;color:#0f172a;margin:28px 0 2px">${title}</h2>
<p style="color:#94a3b8;font-size:13px;margin:0 0 10px">${sub} — ingen nye i dag.</p>`;
  }
  return `<h2 style="font-size:16px;color:#0f172a;margin:28px 0 2px">${title} <span style="color:#94a3b8;font-weight:400">(${rows.length})</span></h2>
<p style="color:#94a3b8;font-size:13px;margin:0 0 4px">${sub}</p>
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows.map((r) => rowHtml(r, kind)).join('')}</table>`;
}

export function renderDigestHtml(d: DigestData): string {
  const dato = d.generatedAt.toLocaleDateString('da-DK', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const total = d.newTopPicks.length + d.newHandyman.length + d.priceCuts.length;
  const siden = d.previousRunAt
    ? `siden ${d.previousRunAt.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' })}`
    : 'seneste 7 dage (første mail)';

  return `<!doctype html><html lang="da"><body style="margin:0;padding:0;background:#f8fafc">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 12px">
<tr><td align="center">
<table width="100%" style="max-width:620px;background:#ffffff;border-radius:14px;padding:28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<tr><td>
  <div style="color:#94a3b8;font-size:12px;letter-spacing:.06em;text-transform:uppercase">iBuyReal · morgenoverblik</div>
  <h1 style="font-size:21px;color:#0f172a;margin:6px 0 2px">${dato}</h1>
  <p style="color:#64748b;font-size:14px;margin:0">
    ${total === 0 ? 'Ingen nye cases' : `${total} nye ting`} ${siden} · ${d.totals.active} aktive på markedet · ${d.totals.untriaged} venter i triagen
  </p>

  ${sectionHtml('Nye Top picks', 'Kommet ind i top 20 siden sidste mail', d.newTopPicks, 'top')}
  ${sectionHtml('Nye håndværkertilbud', 'Renoveringssager — value-add-kandidater', d.newHandyman, 'handyman')}
  ${sectionHtml('Prisnedsættelser', 'Aktive cases hvor udbudsprisen er faldet', d.priceCuts, 'cut')}

  <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0">
    <a href="${APP_URL}/on-market/triage" style="background:#0f172a;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px;display:inline-block">Åbn triagen (${d.totals.untriaged})</a>
    <a href="${APP_URL}/on-market" style="color:#475569;padding:10px 14px;text-decoration:none;font-size:14px;display:inline-block">Hele markedet</a>
  </div>
  <p style="color:#cbd5e1;font-size:11px;margin:18px 0 0">α er beregnet mod rå AVM og kender ikke renoveringsbehov — håndværkersager er derfor overvurderet. Genereret automatisk af CRM'et.</p>
</td></tr></table>
</td></tr></table>
</body></html>`;
}

export function renderDigestSubject(d: DigestData): string {
  const n = d.newTopPicks.length;
  const h = d.newHandyman.length;
  const c = d.priceCuts.length;
  if (n + h + c === 0) return 'iBuyReal — ingen nye cases i dag';
  const parts: string[] = [];
  if (n) parts.push(`${n} nye top picks`);
  if (h) parts.push(`${h} håndværker`);
  if (c) parts.push(`${c} prisnedsættelser`);
  return `iBuyReal — ${parts.join(' · ')}`;
}
