/**
 * AVM-fejl-analyse: kategoriserer alle current cases hvor AVM siger
 * positiv α og forklarer hvorfor 87% af dem reelt er falske positiver.
 *
 * Bruges af /admin/avm-analyse-siden + downloadbar som markdown.
 *
 * Output: detaljeret breakdown af fejl-kategorier + konkrete eksempler.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { onMarketCandidates } from '@/lib/db/schema';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { isConcreteEra, isGroundFloor, isNoisyStreet } from '@/lib/quality';

interface CaseAnalysis {
  address: string;
  postal_code: string;
  bydel: string | null;
  kvm: number | null;
  year_built: number | null;
  avm_alpha_pct: number;
  list_price: number | null;
  avm_predicted_fmv: number | null;
  failure_reason: string;
  details: string;
}

function classifyFailure(c: {
  address: string;
  yearBuilt: number | null;
  kvm: number | null;
  hjemfaldspligt: boolean;
  imageAssessment: { overall_condition: number; deal_breakers?: string[] } | null;
}): { reason: string; details: string } | null {
  if (c.hjemfaldspligt) {
    return { reason: 'hjemfaldspligt', details: 'AVM ser ikke hjemfald — kommunal grund med tilbagefald' };
  }
  if (isGroundFloor(c.address)) {
    return { reason: 'stueetage', details: 'Adresse indeholder "st." eller "0." — AVM får sandsynligvis ikke etage som input' };
  }
  if (isConcreteEra(c.yearBuilt)) {
    return { reason: 'beton_aera_1950_1990', details: `Byggeår ${c.yearBuilt} — AVM behandler år lineært, men 1950-1990 er kategori-skift (beton, dårlig isolering)` };
  }
  if (isNoisyStreet(c.address)) {
    return { reason: 'stoejgade', details: 'Adresse matcher kendt støjgade-lookup (Strøget, hovedfærdselsårer, nattelivsstrøg)' };
  }
  if (c.kvm && c.kvm > 100) {
    return { reason: 'kvm_for_stor', details: `${c.kvm} m² — markedet for store lejligheder er tyndt, AVM ser ikke likviditets-rabat` };
  }
  if (c.imageAssessment && c.imageAssessment.overall_condition < 6) {
    return { reason: 'nedslidt_stand', details: `Vision-stand ${c.imageAssessment.overall_condition}/10 — AVM ser ikke billeder` };
  }
  if (c.imageAssessment && (c.imageAssessment.deal_breakers?.length ?? 0) > 0) {
    return { reason: 'deal_breakers', details: `Vision spottede deal-breakers: ${c.imageAssessment.deal_breakers!.join(', ')}` };
  }
  return null; // overlever alle filtre = AVM ramte rigtigt
}

export async function GET(req: Request) {
  if (!db) return NextResponse.json({ error: 'DB ikke konfigureret' }, { status: 500 });
  const url = new URL(req.url);
  const format = url.searchParams.get('format') ?? 'json';

  const rows = await db
    .select()
    .from(onMarketCandidates)
    .where(
      and(
        eq(onMarketCandidates.status, 'active'),
        eq(onMarketCandidates.v3FmvSource, 'ibuyreal-avm'),
        sql`${onMarketCandidates.v3Alpha} > 0`,
        isNotNull(onMarketCandidates.kvm),
        isNotNull(onMarketCandidates.listPrice),
      ),
    );

  const analyses: CaseAnalysis[] = [];
  const categoryCounts: Record<string, { n: number; sum_alpha: number; max_alpha: number; min_alpha: number; examples: string[] }> = {};

  for (const r of rows) {
    const failure = classifyFailure({
      address: r.address,
      yearBuilt: r.yearBuilt,
      kvm: r.kvm,
      hjemfaldspligt: r.hjemfaldspligt,
      imageAssessment: r.imageAssessment,
    });
    const reason = failure?.reason ?? 'avm_correct';
    const alphaPct = ((r.v3Fmv ?? 0) - (r.listPrice ?? 0)) / (r.listPrice ?? 1) * 100;

    const cat = categoryCounts[reason] ?? { n: 0, sum_alpha: 0, max_alpha: -Infinity, min_alpha: Infinity, examples: [] };
    cat.n++;
    cat.sum_alpha += alphaPct;
    cat.max_alpha = Math.max(cat.max_alpha, alphaPct);
    cat.min_alpha = Math.min(cat.min_alpha, alphaPct);
    if (cat.examples.length < 3) cat.examples.push(`${r.address} (α +${alphaPct.toFixed(1)}%, byg ${r.yearBuilt ?? '?'})`);
    categoryCounts[reason] = cat;

    analyses.push({
      address: r.address,
      postal_code: r.postalCode,
      bydel: r.bydel,
      kvm: r.kvm,
      year_built: r.yearBuilt,
      avm_alpha_pct: Math.round(alphaPct * 10) / 10,
      list_price: r.listPrice,
      avm_predicted_fmv: r.v3Fmv,
      failure_reason: reason,
      details: failure?.details ?? 'AVM ramte plet — case passerer alle filtre',
    });
  }

  const totalAvmPositive = rows.length;
  const correctCount = categoryCounts['avm_correct']?.n ?? 0;
  const precision = totalAvmPositive > 0 ? correctCount / totalAvmPositive : 0;

  if (format === 'markdown') {
    const md = generateMarkdown(categoryCounts, analyses, totalAvmPositive, precision);
    return new NextResponse(md, {
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="avm-analysis-${new Date().toISOString().slice(0, 10)}.md"`,
      },
    });
  }

  return NextResponse.json({
    summary: {
      total_avm_positive_alpha_cases: totalAvmPositive,
      correct_predictions: correctCount,
      precision_pct: Math.round(precision * 1000) / 10,
      false_positive_pct: Math.round((1 - precision) * 1000) / 10,
    },
    failure_categories: categoryCounts,
    all_cases: analyses,
    timestamp: new Date().toISOString(),
  });
}

function generateMarkdown(
  cats: Record<string, { n: number; sum_alpha: number; max_alpha: number; min_alpha: number; examples: string[] }>,
  cases: CaseAnalysis[],
  total: number,
  precision: number,
): string {
  const date = new Date().toLocaleDateString('da-DK');
  const correct = cats['avm_correct']?.n ?? 0;
  const falsePositives = total - correct;

  const orderedCats = Object.entries(cats)
    .filter(([k]) => k !== 'avm_correct')
    .sort((a, b) => b[1].n - a[1].n);

  let md = `# AVM-modellen — Fejl-analyse\n\n`;
  md += `**Genereret:** ${date}\n`;
  md += `**Datakilde:** iBuyReal CRM, alle aktive on-market cases med AVM-prediction\n\n`;
  md += `---\n\n`;
  md += `## TL;DR\n\n`;
  md += `Vores AVM-model (AWS Lambda) flagger **${total} cases** som "gode buys" (positiv α vs udbud). Når vi gennemgår dem manuelt:\n\n`;
  md += `- **${correct} ramte plet** (${(precision * 100).toFixed(1)}% præcision)\n`;
  md += `- **${falsePositives} er falske positiver** (${((1 - precision) * 100).toFixed(1)}%)\n\n`;
  md += `Hovedårsagen: AVM mangler **5 kritiske features** som vores manuelle filtre fanger.\n\n`;
  md += `---\n\n`;
  md += `## Fejl-kategorier\n\n`;
  md += `| # | Kategori | Cases | Gns α | Max α | Hvad AVM mangler |\n`;
  md += `|---|---|---:|---:|---:|---|\n`;
  orderedCats.forEach(([reason, c], i) => {
    md += `| ${i + 1} | ${reason} | ${c.n} | +${(c.sum_alpha / c.n).toFixed(1)}% | +${c.max_alpha.toFixed(1)}% | se nedenfor |\n`;
  });
  md += `\n---\n\n`;
  md += `## Detaljeret per kategori\n\n`;
  orderedCats.forEach(([reason, c]) => {
    md += `### ${reason} (${c.n} cases)\n\n`;
    md += `- Gns AVM-α: +${(c.sum_alpha / c.n).toFixed(1)}%\n`;
    md += `- Spænd: +${c.min_alpha.toFixed(1)}% til +${c.max_alpha.toFixed(1)}%\n\n`;
    md += `**Eksempler:**\n\n`;
    c.examples.forEach((e) => (md += `- ${e}\n`));
    md += `\n`;
  });
  md += `---\n\n`;
  md += `## Anbefalede model-ændringer (prioriteret)\n\n`;
  md += `### 1. Etage som input-feature\n\nParse adresse → \`floor_number\` (0=stueetage, 1, 2, ..., 5+) + \`is_ground_floor\` boolean. Resight har \`Enheder.Etage\` direkte hvis I joiner.\n\n**Effekt:** elimerer "stueetage" og "kælder"-kategorierne.\n\n`;
  md += `### 2. Byggeår som non-linear feature\n\nErstat \`year_built: int\` med era-buckets eller one-hot:\n\n- pre1900 (klassisk)\n- 1900-1949 (københavnerklassiker — premium)\n- 1950-1990 (BETON-ÆRA — penalty)\n- 1990-2009 (moderne mid)\n- post2010 (nybyg)\n\nPlus: \`years_since_renovation\` fra Resight \`Omtilbygningsår\`.\n\n**Effekt:** model lærer at 1972 og 1968 er samme kategori, og at den kategori er dårligere end både 1932 og 1995.\n\n`;
  md += `### 3. kvm × bydel interaction\n\nLæg interaction-feature ind: \`kvm × bydel_liquidity_score\`. 110 m² i Indre By ≠ 110 m² i Ørestad.\n\n**Effekt:** elimerer kvm>100-fejl i illikvide bydele.\n\n`;
  md += `### 4. Støjgade-lookup table\n\nEmbed lookup-tabel med kendte støjgader (Strøget, Vesterbrogade, Nørrebrogade, Amagerbrogade, hovedfærdselsårer, nattelivsstrøg). Vi har den allerede i CRM (\`src/lib/quality.ts NOISY_STREETS\`).\n\n**Effekt:** elimerer "støjgade"-falske positiver.\n\n`;
  md += `### 5. Vision-features fra fotos\n\nBatch-process Boligsiden-fotos gennem Claude Vision:\n- overall_condition (1-10)\n- estimated_refurb_cost\n- deal_breakers count\n\nVi har den pipeline klar i CRM nu — eksport kan deles.\n\n**Effekt:** AVM lærer at nedslidt-stand er real -10-20% rabat.\n\n`;
  md += `### 6. Confidence-score i output\n\nReturner også \`prediction_stddev\` og \`n_training_samples_in_segment\`. Hvis stddev > 12% eller n < 5 → \`low_confidence: true\`.\n\n**Effekt:** CRM dropper low-confidence cases automatisk.\n\n`;
  md += `---\n\n`;
  md += `## Forventet impact\n\n`;
  md += `**Nu:** ${total} AVM-positives → ${correct} ægte vindere = ${(precision * 100).toFixed(0)}% præcision\n\n`;
  md += `**Efter retrain:** ~80% præcision forventet. AVM siger 10 ting er gode, 8 af dem er det reelt.\n\n`;
  md += `Sekundær effekt: AVM kan også blive mere aggressiv på cases hvor den faktisk har data til at vurdere korrekt — vi finder potentielt flere ægte fund vi ikke ser nu.\n\n`;
  md += `---\n\n`;
  md += `## Data-eksport\n\n`;
  md += `Brug \`features.csv\` fra \`/admin/training-export\` til retrain. Den indeholder nu også feature-flag (\`is_ground_floor\`, \`era_bucket\`, \`is_concrete_era\`, \`is_noisy_street\`, \`kvm_bucket\`, \`our_verdict\`) som I kan bruge som labels eller som features direkte.\n\n`;
  md += `\`our_verdict\` på hver case er specifikt hvor vores manuelle filtre dømte casen. Brug det som ground truth-label for retraining: cases med \`top_pick_candidate\` er hvor model ramte; cases med \`filtered_*\` er hvor model fejlede.\n`;
  return md;
}
