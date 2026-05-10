#!/usr/bin/env node
/**
 * scripts/pull-env.mjs
 *
 * Fetches DB credentials from AWS Secrets Manager and writes IBUYREAL_DB
 * into .env.local. Run this once before using drizzle-kit CLI commands
 * (db:migrate, db:push, db:seed) which bypass the Next.js instrumentation hook.
 *
 * Usage:
 *   npm run env:pull
 *
 * Requires AWS credentials to be configured locally:
 *   aws configure   (or AWS_PROFILE / AWS_ACCESS_KEY_ID env vars)
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REGION = 'eu-north-1';
const SECRET_ID = 'rds!db-c917e4be-d143-4b18-8170-dab18de13074';
const HOST = 'ibuyreal-db.cj2o0y4qa93o.eu-north-1.rds.amazonaws.com';
const PORT = 5432;
const DATABASE = 'ibrc';

const ENV_FILE = resolve(process.cwd(), '.env.local');
const ENV_EXAMPLE = resolve(process.cwd(), '.env.local.example');

async function main() {
  console.log(`Fetching secret ${SECRET_ID} from ${REGION}...`);

  const client = new SecretsManagerClient({ region: REGION });
  const response = await client.send(new GetSecretValueCommand({ SecretId: SECRET_ID }));

  if (!response.SecretString) {
    throw new Error('Secret has no SecretString value');
  }

  const { username, password } = JSON.parse(response.SecretString);
  const url = `postgres://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${HOST}:${PORT}/${DATABASE}?sslmode=require`;

  // Seed from example if .env.local doesn't exist yet.
  let content = existsSync(ENV_FILE)
    ? readFileSync(ENV_FILE, 'utf8')
    : existsSync(ENV_EXAMPLE)
      ? readFileSync(ENV_EXAMPLE, 'utf8')
      : '';

  if (/^IBUYREAL_DB=.*/m.test(content)) {
    content = content.replace(/^IBUYREAL_DB=.*/m, `IBUYREAL_DB=${url}`);
  } else {
    content = content ? `${content.trimEnd()}\nIBUYREAL_DB=${url}\n` : `IBUYREAL_DB=${url}\n`;
  }

  writeFileSync(ENV_FILE, content, 'utf8');
  console.log(`✓ IBUYREAL_DB written to .env.local (host: ${HOST})`);
}

main().catch((err) => {
  console.error('Failed to fetch secret:', err.message);
  process.exit(1);
});
