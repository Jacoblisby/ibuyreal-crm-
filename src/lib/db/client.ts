/**
 * Drizzle DB-client — lazy initialisation.
 *
 * IBUYREAL_DB is set either by:
 *   - .env.local (local dev)
 *   - src/instrumentation.ts at Next.js startup (production: fetched from AWS Secrets Manager)
 *
 * The connection is created on first use so that instrumentation.ts has time to
 * populate process.env.IBUYREAL_DB before any query is attempted.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

type DB = ReturnType<typeof drizzle<typeof schema>>;

let _db: DB | undefined;

function initDb(): DB {
  if (_db) return _db;
  const connectionString = process.env.IBUYREAL_DB;
  if (!connectionString) {
    throw new Error(
      'IBUYREAL_DB not set. ' +
        'For local dev run `npm run env:pull` to fetch credentials from AWS Secrets Manager, ' +
        'or set IBUYREAL_DB manually in .env.local.',
    );
  }
  _db = drizzle(
    postgres(connectionString, {
      max: process.env.NODE_ENV === 'production' ? 10 : 5,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: 'require',
      connection: { search_path: 'crm' },
    }),
    { schema, logger: process.env.NODE_ENV === 'development' },
  );
  return _db;
}

// Proxy so all call sites keep using `db.select(...)` etc. unchanged.
export const db = new Proxy({} as DB, {
  get(_, prop: string | symbol) {
    return (initDb() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export { schema };
