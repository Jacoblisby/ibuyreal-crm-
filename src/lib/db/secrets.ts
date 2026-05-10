/**
 * Resolves the IBUYREAL_DB connection string from AWS Secrets Manager.
 * Mirrors the Python pattern in src/aws/secret_manager.py + src/postgres/postgres_database.py.
 *
 * The secret (rds!db-c917e4be-d143-4b18-8170-dab18de13074) returns JSON:
 *   { "username": "...", "password": "..." }
 * This function constructs the full postgres:// URL from those fields.
 */
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const REGION = 'eu-north-1';
const SECRET_ID = 'rds!db-c917e4be-d143-4b18-8170-dab18de13074';
const HOST = 'ibuyreal-db.cj2o0y4qa93o.eu-north-1.rds.amazonaws.com';
const PORT = 5432;
const DATABASE = 'ibrc';

export async function resolveIbuyRealDbUrl(): Promise<string> {
  const client = new SecretsManagerClient({ region: REGION });
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: SECRET_ID }),
  );
  if (!response.SecretString) {
    throw new Error(`Secret ${SECRET_ID} has no SecretString value`);
  }
  const { username, password } = JSON.parse(response.SecretString) as {
    username: string;
    password: string;
  };
  return `postgres://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${HOST}:${PORT}/${DATABASE}?sslmode=require`;
}
