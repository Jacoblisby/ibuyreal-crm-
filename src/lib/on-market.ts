import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { assumptions } from '@/lib/db/schema';
import { rowToAssumptions } from '@/lib/assumptions';

export type ReviewStatus = 'new' | 'interested' | 'passed' | 'imported';
export type CandidateStatus = 'active' | 'sold' | 'ignored';

export type OnMarketListingRow = {
  id: string;
  caseId: string;
  createdAt: Date;
  updatedAt: Date;
  reviewType: ReviewStatus;
  status: string;
  estimatedAlpha: number | null;
  prediction: number | null;
  predictionSource: number | null;
  marketSpread: number | null;
  investedAmount: number | null;
  transactionCost: number | null;
  profitWorstCase: number | null;
  profitBaseCase: number | null;
  profitBestCase: number | null;
  returnWorstCase: number | null;
  returnBaseCase: number | null;
  returnBestCase: number | null;
  predictedAt: Date | null;
  sourceUrl: string | null;
  caseUrl: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  kvm: number | null;
  rooms: number | null;
  yearBuilt: number | null;
  listPrice: number | null;
  monthlyExpense: number | null;
  perAreaPrice: number | null;
  realtorName: string | null;
  daysOnMarket: number | null;
  descriptionTitle: string | null;
  description: string | null;
  energyLabel: string | null;
  hasBalcony: boolean | null;
  hasElevator: boolean | null;
  hasTerrace: boolean | null;
};

type OnMarketRowWithBaseMetrics = Omit<
  OnMarketListingRow,
  | 'profitWorstCase'
  | 'profitBaseCase'
  | 'profitBestCase'
  | 'returnWorstCase'
  | 'returnBaseCase'
  | 'returnBestCase'
>;

type OnMarketDbRow = Omit<
  OnMarketRowWithBaseMetrics,
  'estimatedAlpha' | 'marketSpread' | 'investedAmount' | 'transactionCost'
>;

const BASE_SELECT = sql`
  SELECT
    c.case_id AS "id",
    c.case_id AS "caseId",
    c.created_at AS "createdAt",
    c.updated_at AS "updatedAt",
    c.review_type AS "reviewType",
    c.status AS "status",
    c.prediction AS "prediction",
    c.prediction_source AS "predictionSource",
    c.predicted_at AS "predictedAt",
    l.source_url AS "sourceUrl",
    l.case_url AS "caseUrl",
    l.address AS "address",
    substring(l.address from '(\\d{4})') AS "postalCode",
    substring(l.address from '\\d{4}\\s+(.+)$') AS "city",
    l.unit_area AS "kvm",
    l.number_of_rooms AS "rooms",
    b.year_built AS "yearBuilt",
    l.price AS "listPrice",
    l.monthly_expense AS "monthlyExpense",
    l.price_per_sqm AS "perAreaPrice",
    l.realtor_name AS "realtorName",
    CASE
      WHEN l.first_listed_at IS NULL THEN NULL
      ELSE floor(extract(epoch from (now() - l.first_listed_at)) / 86400)::integer
    END AS "daysOnMarket",
    l.description_title AS "descriptionTitle",
    l.description AS "description",
    l.energy_label AS "energyLabel",
    l.has_balcony AS "hasBalcony",
    l.has_elevator AS "hasElevator",
    l.has_terrace AS "hasTerrace"
  FROM crm.on_market_candidates c
  LEFT JOIN public.listing l ON l.case_id = c.case_id
  LEFT JOIN (
    SELECT DISTINCT ON (p.address_id)
      p.address_id,
      p.building_uuid
    FROM public.property p
    ORDER BY p.address_id, p.id DESC
  ) property_match ON property_match.address_id = l.address_id
  LEFT JOIN bbr.building b ON b.building_uuid = property_match.building_uuid
`;

function withBaseMetrics(rows: OnMarketDbRow[]): OnMarketRowWithBaseMetrics[] {
  return rows.map((row) => {
    const listPrice = row.listPrice;
    const prediction = row.predictionSource !== null ? row.prediction : listPrice;
    const transactionCost =
      listPrice !== null && listPrice > 0 ? Math.round(listPrice * 0.006) : null;
    const investedAmount =
      listPrice !== null && transactionCost !== null ? listPrice + transactionCost : null;
    const estimatedAlpha =
      prediction !== null && listPrice !== null && listPrice > 0
        ? (prediction - listPrice) / listPrice
        : null;
    const marketSpread =
      prediction !== null && investedAmount !== null && investedAmount > 0
        ? (prediction - investedAmount) / investedAmount
        : null;

    return {
      ...row,
      estimatedAlpha,
      marketSpread,
      investedAmount,
      transactionCost,
    };
  });
}

function withScenarioMetrics(
  rows: OnMarketRowWithBaseMetrics[],
  beta: { worst: number; base: number; best: number },
): OnMarketListingRow[] {
  const worst = beta.worst / 100;
  const base = beta.base / 100;
  const best = beta.best / 100;

  return rows.map((row) => {
    if (row.marketSpread === null) {
      return {
        ...row,
        profitWorstCase: null,
        profitBaseCase: null,
        profitBestCase: null,
        returnWorstCase: null,
        returnBaseCase: null,
        returnBestCase: null,
      };
    }

    const returnWorstCase = row.marketSpread + worst;
    const returnBaseCase = row.marketSpread + base;
    const returnBestCase = row.marketSpread + best;

    return {
      ...row,
      returnWorstCase,
      returnBaseCase,
      returnBestCase,
      profitWorstCase:
        row.investedAmount !== null ? row.investedAmount * returnWorstCase : null,
      profitBaseCase:
        row.investedAmount !== null ? row.investedAmount * returnBaseCase : null,
      profitBestCase:
        row.investedAmount !== null ? row.investedAmount * returnBestCase : null,
    };
  });
}

export async function getOnMarketAssumptions() {
  const [row] = await db.select().from(assumptions).where(eq(assumptions.id, 'default'));
  return rowToAssumptions(row);
}

export async function getOnMarketRows(filters: {
  status: CandidateStatus;
  review?: ReviewStatus;
}): Promise<OnMarketListingRow[]> {
  const whereReview = filters.review
    ? sql` AND c.review_type = ${filters.review}`
    : sql``;

  const result = await db.execute(sql`
    ${BASE_SELECT}
    WHERE c.status = ${filters.status}
    ${whereReview}
    ORDER BY c.updated_at DESC
  `);

  const assumptionsConfig = await getOnMarketAssumptions();
  const rowsWithBaseMetrics = withBaseMetrics(result as unknown as OnMarketDbRow[]);
  const rows = withScenarioMetrics(rowsWithBaseMetrics, assumptionsConfig.beta);

  return rows.sort((a, b) => {
    const aUpdated = new Date(a.updatedAt).getTime();
    const bUpdated = new Date(b.updatedAt).getTime();
    if (a.returnBestCase === null && b.returnBestCase === null) return bUpdated - aUpdated;
    if (a.returnBestCase === null) return 1;
    if (b.returnBestCase === null) return -1;
    if (b.returnBestCase !== a.returnBestCase) return b.returnBestCase - a.returnBestCase;
    return bUpdated - aUpdated;
  });
}

export async function getOnMarketRow(caseId: string): Promise<OnMarketListingRow | null> {
  const result = await db.execute(sql`
    ${BASE_SELECT}
    WHERE c.case_id = ${caseId}::uuid
    LIMIT 1
  `);

  const row = (result[0] as OnMarketDbRow | undefined) ?? null;
  if (!row) return null;

  const assumptionsConfig = await getOnMarketAssumptions();
  return withScenarioMetrics(withBaseMetrics([row]), assumptionsConfig.beta)[0] ?? null;
}
