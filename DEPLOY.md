# Deploy guide — iBuyReal CRM

Production deployment targets **AWS**. Local development does not require Docker or any AWS account.

## Architecture overview

```
Browser → AWS (App Runner / ECS Fargate)
              ↓
          Next.js app (Docker container, port 3000)
              ↓
          PostgreSQL (RDS / existing managed instance)
              schema: crm

Future:
Browser → API Gateway → Lambda  (AVM prediction service)
App     → API Gateway → Lambda  (AVM_URL + AVM_API_KEY)
```

## Local development (no AWS needed)

See README.md for the full local setup. Summary:

```bash
psql -d <your_db> -f sql/001_crm_bootstrap.sql   # one-time DB setup
npm install
# set IBUYREAL_DB in .env.local (sourced from SecretManager.IBUYREAL_DB)
npm run dev   # → http://localhost:3000
```

---

## Production deployment on AWS

### Prerequisites

- AWS account with ECR, App Runner (or ECS Fargate), and Secrets Manager access
- PostgreSQL instance reachable from your AWS VPC (RDS PostgreSQL 13+)
- `crm` schema already bootstrapped: `psql -d <prod_db> -f sql/001_crm_bootstrap.sql`
- Docker installed locally for building/pushing the image

### 1. Build and push Docker image to ECR

```bash
# Authenticate
aws ecr get-login-password --region <region> | \
  docker login --username AWS --password-stdin <account_id>.dkr.ecr.<region>.amazonaws.com

# Build
docker build \
  -t ibuyreal-crm .

# Tag and push
docker tag ibuyreal-crm:latest \
  <account_id>.dkr.ecr.<region>.amazonaws.com/ibuyreal-crm:latest
docker push \
  <account_id>.dkr.ecr.<region>.amazonaws.com/ibuyreal-crm:latest
```

### 2. Store secrets in AWS Secrets Manager

Store the following as individual secrets or a single JSON secret:

| Secret key | Value |
|---|---|
| `IBUYREAL_DB` | Full PostgreSQL connection string |
| `AVM_URL` | API Gateway endpoint for the AVM Lambda (when ready) |
| `AVM_API_KEY` | AVM Lambda API key (when ready) |

### 3. Deploy the app

**Option A — AWS App Runner** (recommended: simplest, no cluster management)

1. AWS Console → App Runner → Create service
2. Source: **Container registry** → ECR → select `ibuyreal-crm:latest`
3. Port: `3000`
4. Environment variables (injected from Secrets Manager at runtime):
   ```
  IBUYREAL_DB      → SecretManager.IBUYREAL_DB
   NEXT_PUBLIC_APP_URL → https://<your-domain>
   NODE_ENV         → production
   ```
5. Deploy

**Option B — ECS Fargate** (more control, needed if VPC peering to RDS is required)

1. Create an ECS Task Definition using the ECR image, port 3000
2. Inject env vars from Secrets Manager in the task definition
3. Create a Fargate service behind an ALB
4. Configure security groups to allow the task to reach your RDS instance

### 4. Bootstrap DB schema (first deploy only)

The app does **not** run migrations automatically on startup. Before first traffic:

```bash
# From any machine with psql access to the production DB:
psql -d <prod_db> -f sql/001_crm_bootstrap.sql
psql -d <prod_db> -f sql/002_crm_verify.sql
```

### 5. First scrape

Navigate to `/on-market` and click **"Scrape Boligsiden nu"**. Takes ~6–8 s, fetches ~510 listings.

### 6. Future: AVM integration

When the prediction model Lambda is ready:

1. Add the API Gateway URL as `AVM_URL` in Secrets Manager
2. Add the API key as `AVM_API_KEY`
3. Inject both into the App Runner / ECS task environment
4. No code changes required — the app already reads these variables

---

## Re-deploy after code changes

```bash
# Build and push new image (see step 1 above), then:
# App Runner: trigger a new deployment in the console or via CLI
aws apprunner start-deployment --service-arn <arn>

# ECS Fargate: force a new deployment
aws ecs update-service --cluster <cluster> --service <service> --force-new-deployment
```

## Secrets reference

| Variable | Source | Notes |
|---|---|---|
| `IBUYREAL_DB` | Secrets Manager | Never in git |
| `NEXT_PUBLIC_APP_URL` | App Runner / ECS env | `https://your-domain` |
| `AVM_URL` | Secrets Manager | Empty until Lambda is ready; app falls back to listPrice |
| `AVM_API_KEY` | Secrets Manager | Empty until Lambda is ready |

`.env.local` (local only) is in `.gitignore` and never committed.
