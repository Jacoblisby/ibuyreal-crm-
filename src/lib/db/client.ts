/**
 * Drizzle DB-client.
 * DATABASE_URL: postgres://user:pass@host:port/dbname
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('[db] DATABASE_URL ikke sat — DB-queries vil fejle indtil den er konfigureret.');
}

const queryClient = connectionString
  ? postgres(connectionString, {
      max: process.env.NODE_ENV === 'production' ? 10 : 5,
      idle_timeout: 20,
      connect_timeout: 10,
    })
  : (null as unknown as ReturnType<typeof postgres>);

export const db = queryClient
  ? drizzle(queryClient, { schema, logger: process.env.NODE_ENV === 'development' })
  : (null as unknown as ReturnType<typeof drizzle<typeof schema>>);

export { schema };
