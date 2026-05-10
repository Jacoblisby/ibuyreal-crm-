# iBuyReal CRM + Boligberegner

Internt CRM og beregningssystem til iBuyReal-fonden — screening, AVM-arbitrage, scenarie-beregning og deal pipeline for ejerlejligheder i København.

## Stack

- **Next.js 16** (App Router) + React 19
- **TypeScript** strict
- **Tailwind v4** (PostCSS plugin)
- **Drizzle ORM** + `postgres` driver → PostgreSQL 13+ (testet på PG18)
- **Vitest** til pure-function tests af `lib/calculator.ts`

Stacken matcher [crm-v2](../crm-v2) bevidst — to separate apps der kan låne mønstre af hinanden.

## Kom i gang

### Forudsætninger
- **Node.js 20** (tjek: `node -v`)
- **PostgreSQL 13+** (valideret på PG18) — din eksisterende instans
- **psql-klient** til at køre bootstrap-scriptet: `sudo apt install postgresql-client-common`

```bash
# 1. Opret crm-schema og tabeller i din eksisterende database
psql -d <din_database> -f sql/001_crm_bootstrap.sql

# Verificer at alt er oprettet korrekt:
psql -d <din_database> -f sql/002_crm_verify.sql

# 2. Installer afhængigheder
cd ibuyreal-crm
npm install

# 3. Konfigurer env
cp .env.local.example .env.local
# Sæt IBUYREAL_DB til din eksisterende database
# (forbindelsen hentes fra SecretManager.IBUYREAL_DB — se .env.local.example)

# 4. Start dev-server
npm run dev    # → http://localhost:3000
```

> **Seed-data** er ikke nødvendigt for at komme i gang. Kør `npm run db:seed`
> kun hvis du vil have 7 demo-cases til at teste med.

> **Docker** er ikke nødvendigt til lokal udvikling. Det bruges kun til
> containeriseret deployment på AWS.

## Test

```bash
npm test           # pure-function unit tests af beregningsmotoren
npm run typecheck  # tsc --noEmit
```

## Struktur

```
src/
  app/                    # Next.js App Router pages
    layout.tsx
    page.tsx              # Dashboard (placeholder)
    calculator/           # Boligberegner — live live beregning
    screening/            # Tabel over alle cases
    pipeline/             # Kanban (placeholder)
    api/properties/       # POST + GET
  lib/
    calculator.ts         # ⭐ Forretningslogikken — pure functions
    calculator.test.ts    # Unit tests
    constants.ts          # DEFAULT_ASSUMPTIONS
    types.ts
    format.ts             # Intl-formattering (DKK, %)
    db/
      schema.ts           # properties, investors, assumptions
      client.ts
      seed.ts             # 7 cases fra spec
```

## Build-rækkefølge (fra spec)

- [x] **1. Datamodel + Drizzle schema** — schema, push, seed
- [x] **2. Beregningsmotor** — `lib/calculator.ts` med pure functions + tests
- [x] **3. Boligberegner** — live beregning på `/calculator`
- [x] **4. Screening tabel** — filtre, sortering, Excel-import (SheetJS)
- [x] **5. Dashboard** — KPIs, pipeline-overblik, profit-chart, seneste aktivitet
- [x] **6. Pipeline kanban** — drag-and-drop status-skift
- [x] **7. Excel eksport** — Screening Overblik V3 format med formler
- [x] **8. Investor modul** — committed/deployed kapital + ejendomstildeling
- [x] **9. Assumptions-side** — alle parametre med live preview pr. case

## Sider

- `/` — Dashboard
- `/calculator` — Boligberegner med live beregning
- `/screening` — Tabel med filtre, sortering, import/eksport
- `/cases/[id]` — Case-detalje med tilbudsmodul + status-skift + noter
- `/pipeline` — Kanban med drag-drop
- `/investors` — Investorer + kapitalallokering
- `/settings` — Assumptions med live preview

## Forretningsregler

Tre afkastkomponenter pr. case:
- **Alpha** = (FMV − købspris) / købspris (samme i alle scenarier)
- **Beta** = markedsudvikling (0% / 7% / 14.8%)
- **CF-yield** = udlejningsstrategi (langtidsleje / expat / Airbnb)

Total afkast = α + β + cf-yield. Fuld spec i `/Users/jacoblisby/Downloads/iBuyReal_CRM_SPEC.md`.
