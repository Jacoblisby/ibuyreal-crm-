import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { investors } from '@/lib/db/schema';

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  committed: z.number().nullable().optional(),
  deployed: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function GET() {
  if (!db) return NextResponse.json({ error: 'DB ikke konfigureret' }, { status: 500 });
  const rows = await db.select().from(investors);
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  if (!db) return NextResponse.json({ error: 'DB ikke konfigureret' }, { status: 500 });
  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Ugyldig input', details: parsed.error.issues }, { status: 400 });
  }
  const [row] = await db.insert(investors).values(parsed.data).returning();
  return NextResponse.json(row, { status: 201 });
}
