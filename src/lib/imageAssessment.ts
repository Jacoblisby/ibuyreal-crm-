/**
 * Claude Vision-baseret stand-vurdering af ejerlejligheders interiør.
 *
 * Tager 6-8 fotos fra Boligsiden og returnerer strukturerede signaler:
 *   - overall_condition (1-10)
 *   - estimeret refurb-budget til "ready to rent/sell"
 *   - strengths/weaknesses/deal_breakers
 *
 * Bruges af Top picks-curationen til at fange tilfælde hvor tal-data ser fed
 * ud, men billederne afslører nedslidt køkken/bad eller skjulte mangler.
 */
import crypto from 'node:crypto';
import type { OnMarketCandidate } from './db/schema';

const MODEL = 'claude-sonnet-4-5';
const API_URL = 'https://api.anthropic.com/v1/messages';
const MAX_IMAGES = 8;

export type ImageAssessment = NonNullable<OnMarketCandidate['imageAssessment']>;

/**
 * SHA-256 hash af image-URL'erne — bruges til at detektere om reassess er nødvendig.
 * Inkluderer kun de første N billeder vi faktisk analyserer.
 */
export function hashImages(imageUrls: string[]): string {
  const subset = imageUrls.slice(0, MAX_IMAGES);
  return crypto.createHash('sha256').update(subset.join('|')).digest('hex').slice(0, 16);
}

/**
 * Bygger system + user-prompt for Claude Vision.
 */
function buildPrompt(addressLabel: string, yearBuilt: number | null): string {
  return `Du er ekspert i ejerlejligheds-stand i København/Frederiksberg. Du ser ${MAX_IMAGES} billeder fra en salgsopstilling.

Adresse: ${addressLabel}${yearBuilt ? ` · opført ${yearBuilt}` : ''}

Vurder objektivt interiørets stand. Returner KUN gyldig JSON i dette format:

{
  "overall_condition": <number 1-10, hvor 10 = totalrenoveret klar til indflytning, 1 = håndværkertilbud>,
  "renovation_state": <kort tekst, fx "moderniseret 2018-2022" eller "trænger til opfriskning" eller "originalt fra 90'erne">,
  "kitchen": {
    "age": <"nyt" | "nyere" | "mid" | "old">,
    "quality": <"god" | "standard" | "slidt">
  },
  "bathroom": {
    "tiles_modern": <boolean>,
    "quality": <"god" | "standard" | "slidt">
  },
  "floors": <kort tekst, fx "parket, nyere" eller "lamineret, slidt">,
  "windows": <kort tekst, fx "termo nyere PVC" eller "originale træ, kondens synlig">,
  "walls_ceilings": <kort tekst, fx "ny maling, original stuk bevaret">,
  "estimated_refurb_cost": <kr i danske kroner — hvad det vil koste at få lejligheden i ready-to-rent stand. 0 hvis intet nødvendigt. Vær realistisk: 100k for fuld køkken-renovering, 80k for bad, 50k for gulve i 70m², 30k for maling>,
  "strengths": [<3-5 specifikke styrker, fx "lyst", "originale detaljer bevaret">],
  "weaknesses": [<0-5 specifikke svagheder, fx "bad fra 90'erne", "mørkt soveværelse">],
  "deal_breakers": [<0-3 ALVORLIGE issues hvis nogle, fx "synlig vandskade", "skæv væg", "skimmelsvamp", "alvorligt vedligeholdelsesefterslæb">],
  "confidence": <0-1, hvor confident er din vurdering — lavere hvis få/dårlige billeder>
}

Vær KRITISK — investorer ser denne vurdering og skal kunne stole på den. Ingen friluftspoesi.`;
}

/**
 * Kører Claude Vision på listing's billeder. Returnerer null ved fejl.
 */
export async function assessImages(opts: {
  address: string;
  yearBuilt: number | null;
  imageUrls: string[];
  apiKey?: string;
}): Promise<ImageAssessment | null> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY ikke sat');
  }

  const images = opts.imageUrls.slice(0, MAX_IMAGES);
  if (images.length === 0) return null;

  const promptText = buildPrompt(opts.address, opts.yearBuilt);

  const content: Array<
    | { type: 'image'; source: { type: 'url'; url: string } }
    | { type: 'text'; text: string }
  > = [];
  for (const url of images) {
    content.push({ type: 'image', source: { type: 'url', url } });
  }
  content.push({ type: 'text', text: promptText });

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  const text = data.content.find((c) => c.type === 'text')?.text ?? '';
  // Strip evt. ```json fence
  const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

  try {
    const parsed = JSON.parse(jsonText) as Omit<ImageAssessment, 'images_analyzed' | 'model'>;
    return {
      ...parsed,
      images_analyzed: images.length,
      model: MODEL,
    };
  } catch (e) {
    throw new Error(
      `Claude returnerede ikke gyldig JSON: ${jsonText.slice(0, 200)}... (${e instanceof Error ? e.message : e})`,
    );
  }
}
