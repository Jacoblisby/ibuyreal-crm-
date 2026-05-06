import type { Config } from 'drizzle-kit';

export default {
  schema: './src/lib/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgres://placeholder',
  },
  migrations: {
    prefix: 'index',
  },
  verbose: true,
  strict: true,
} satisfies Config;
