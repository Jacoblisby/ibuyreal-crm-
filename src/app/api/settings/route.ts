import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { assumptions } from '@/lib/db/schema';

export async function GET() {
  if (!db) return NextResponse.json({ error: 'DB ikke konfigureret' }, { status: 500 });
  const [row] = await db.select().from(assumptions).where(eq(assumptions.id, 'default'));
  if (!row) {
    const [created] = await db.insert(assumptions).values({ id: 'default' }).returning();
    return NextResponse.json(created);
  }
  return NextResponse.json(row);
}

export async function PATCH(req: Request) {
  if (!db) return NextResponse.json({ error: 'DB ikke konfigureret' }, { status: 500 });
  const body = await req.json();

  // Tillad kun numeriske felter — id er låst
  const allowed: Record<string, number> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'id' || k === 'updatedAt') continue;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    if (Number.isFinite(n)) allowed[k] = n;
  }

  const [row] = await db
    .update(assumptions)
    .set({ ...allowed, updatedAt: new Date() })
    .where(eq(assumptions.id, 'default'))
    .returning();
  return NextResponse.json(row);
}
