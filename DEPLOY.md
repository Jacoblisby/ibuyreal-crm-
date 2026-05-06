# Deploy guide — iBuyReal CRM

Production deploy via **Coolify** på `app.ibr.dk`.

## Forudsætninger

- Coolify-server kørende
- DNS-adgang til `ibr.dk` (A-record til Coolify-server IP)
- GitHub-repo: [Jacoblisby/ibuyreal-crm-](https://github.com/Jacoblisby/ibuyreal-crm-)

## Steps (engangs setup)

### 1. DNS

Tilføj A-record på `ibr.dk`:

```
app.ibr.dk    A    <coolify-server-ip>    proxied=false
```

### 2. Postgres i Coolify

1. Coolify → "+ New Resource" → Database → PostgreSQL 16
2. Navn: `ibuyreal-db`
3. Notér den interne URL (typisk `postgres://postgres:<pass>@ibuyreal-db:5432/postgres`)
4. Deploy → vent på "running"

### 3. App i Coolify

1. Coolify → "+ New Resource" → Application
2. Source: GitHub → Public Repository
3. URL: `https://github.com/Jacoblisby/ibuyreal-crm-`
4. Branch: `main`
5. Build pack: **Dockerfile**
6. Port: `3000`
7. Domain: `https://app.ibr.dk`
8. Environment variables:
   ```
   DATABASE_URL=postgres://postgres:<pass>@ibuyreal-db:5432/postgres
   NEXT_PUBLIC_APP_URL=https://app.ibr.dk
   NODE_ENV=production
   ```
9. Deploy → vent på "running"

### 4. Kør migrations (engang)

Når app'en kører første gang er DB'en tom. Åbn Coolify-terminal til app-containeren og kør:

```bash
DATABASE_URL=$DATABASE_URL npx drizzle-kit migrate
```

Eller alternativt SSH ind på Coolify-serveren og:

```bash
docker exec -it <ibuyreal-app-container> sh -c 'npx drizzle-kit migrate'
```

### 5. (Valgfri) Seed med 7 sample cases

```bash
docker exec -it <ibuyreal-app-container> sh -c 'tsx src/lib/db/seed.ts'
```

Kun nyttigt til demo — i prod fyldes DB'en op via on-market scrape og manuel input.

### 6. Trigger første scrape

Gå til `https://app.ibr.dk/on-market` og klik **"Scrape Boligsiden nu"**. Tager 6-8 sek og henter ~510 listings.

## Re-deploy (efter kode-ændringer)

Coolify auto-deployer **ikke** ved git push. Manuelt:

1. Push til main: `git push origin main`
2. Coolify → app → "Redeploy"

(Se også: `feedback_coolify_deploy.md` i Claude memory om at coordinatet for Redeploy er `(1404, 91)` på din skærm.)

## Hemmeligheder

| Variabel | Hvor sat |
|---|---|
| `DATABASE_URL` | Coolify env vars (ikke i git) |
| `AVM_URL` (fremtid) | Coolify env vars når XGBoost er wired |
| `AVM_API_KEY` (fremtid) | Coolify env vars |

`.env.local` (lokalt) er i `.gitignore` og kommer aldrig i et commit.
