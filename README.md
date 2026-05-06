# iBuyReal CRM + Boligberegner

Internt CRM og beregningssystem til iBuyReal-fonden — screening, AVM-arbitrage, scenarie-beregning og deal pipeline for ejerlejligheder i København.

## Stack

- **Next.js 16** (App Router) + React 19
- **TypeScript** strict
- **Tailwind v4** (PostCSS plugin)
- **Drizzle ORM** + `postgres` driver → lokal Postgres 16
- **Vitest** til pure-function tests af `lib/calculator.ts`

Stacken matcher [crm-v2](../crm-v2) bevidst — to separate apps der kan låne mønstre af hinanden.

## Kom i gang

```bash
# 1. Postgres (Homebrew)
brew install postgresql@16
brew services start postgresql@16
createdb ibuyreal_crm

# 2. Installer afhængigheder
cd ibuyreal-crm
npm install

# 3. Konfigurer env
cp .env.local.example .env.local
# (DATABASE_URL er allerede sat til lokal Postgres)

# 4. Push schema + seed
npm run db:push
npm run db:seed

# 5. Start dev-server
npm run dev    # → http://localhost:3000
```

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
    constants.ts          # DEFAULT_ANTAGELSER
    types.ts
    format.ts             # Intl-formattering (DKK, %)
    db/
      schema.ts           # properties, investors, antagelser
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
- [x] **9. Antagelser-side** — alle parametre med live preview pr. case

## Sider

- `/` — Dashboard
- `/calculator` — Boligberegner med live beregning
- `/screening` — Tabel med filtre, sortering, import/eksport
- `/cases/[id]` — Case-detalje med tilbudsmodul + status-skift + noter
- `/pipeline` — Kanban med drag-drop
- `/investors` — Investorer + kapitalallokering
- `/settings` — Antagelser med live preview

## Forretningsregler

Tre afkastkomponenter pr. case:
- **Alpha** = (FMV − købspris) / købspris (samme i alle scenarier)
- **Beta** = markedsudvikling (0% / 7% / 14.8%)
- **CF-yield** = udlejningsstrategi (langtidsleje / expat / Airbnb)

Total afkast = α + β + cf-yield. Fuld spec i `/Users/jacoblisby/Downloads/iBuyReal_CRM_SPEC.md`.
