/**
 * Next.js instrumentation hook — runs once at server startup before any request is handled.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * If IBUYREAL_DB is already set (e.g. via .env.local in local dev), this is a no-op.
 * Otherwise it fetches credentials from AWS Secrets Manager and sets the env var so
 * that the lazy DB client (client.ts) can initialise on first use.
 */
export async function register() {
  // Only run in the Node.js runtime, not in the Edge runtime.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Already set — nothing to do (local dev with .env.local, or injected by App Runner).
  if (process.env.IBUYREAL_DB) return;

  const { resolveIbuyRealDbUrl } = await import('./lib/db/secrets');
  process.env.IBUYREAL_DB = await resolveIbuyRealDbUrl();
  console.log('[instrumentation] IBUYREAL_DB resolved from AWS Secrets Manager');
}
