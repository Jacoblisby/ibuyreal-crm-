/**
 * Server-side indlæsning af antagelser. Adskilt fra antagelser.ts, fordi
 * db-importen trækker postgres med — og postgres kan ikke bundles til
 * browseren. Client-komponenter importerer den rene mapper, ikke denne fil.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { antagelser as antagelserTable } from '@/lib/db/schema';
import { DEFAULT_ANTAGELSER } from '@/lib/constants';
import type { Antagelser } from '@/lib/types';
import { rowToAntagelser } from '@/lib/antagelser';

/**
 * Hent de gemte antagelser. Falder tilbage til defaults hvis rækken mangler
 * eller DB er utilgængelig — en screening med defaults er bedre end ingen.
 */
export async function loadAntagelser(): Promise<Antagelser> {
  if (!db) return DEFAULT_ANTAGELSER;
  try {
    const [row] = await db
      .select()
      .from(antagelserTable)
      .where(eq(antagelserTable.id, 'default'));
    return row ? rowToAntagelser(row) : DEFAULT_ANTAGELSER;
  } catch {
    return DEFAULT_ANTAGELSER;
  }
}
