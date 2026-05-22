/**
 * Kør Claude Vision-vurdering for én case manuelt.
 * Typisk kaldt via en knap på case-detail-siden.
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { onMarketCandidates } from '@/lib/db/schema';
import { assessImages, hashImages } from '@/lib/imageAssessment';

export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!db) return NextResponse.json({ error: 'DB ikke konfigureret' }, { status: 500 });
  const { id } = await params;

  const [row] = await db.select().from(onMarketCandidates).where(eq(onMarketCandidates.id, id));
  if (!row) return NextResponse.json({ error: 'Ikke fundet' }, { status: 404 });

  const images = (row.images as string[] | null) ?? [];
  if (images.length === 0) {
    return NextResponse.json({ error: 'Ingen billeder på casen' }, { status: 400 });
  }

  try {
    const assessment = await assessImages({
      address: row.address,
      yearBuilt: row.yearBuilt,
      imageUrls: images,
    });
    if (!assessment) {
      return NextResponse.json({ error: 'Assessment returnerede null' }, { status: 500 });
    }

    const hash = hashImages(images);
    const [updated] = await db
      .update(onMarketCandidates)
      .set({
        imageAssessment: assessment,
        imageAssessmentAt: new Date(),
        imageAssessmentHash: hash,
        updatedAt: new Date(),
      })
      .where(eq(onMarketCandidates.id, id))
      .returning();

    return NextResponse.json({ ok: true, assessment, candidate: updated });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Assessment fejlede' },
      { status: 500 },
    );
  }
}
