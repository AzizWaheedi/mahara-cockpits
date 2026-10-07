import type { CostLine, Payee, Projection } from "./costsModel";

export type Sheet = {
  ready: boolean;
  lines: CostLine[];
  /** The last charge a statement shows for each line with a `match`, by id. */
  lastCharge: Record<number, { day: string; usd: number } | null>;
  /** Everyone working: active, not paused, and a person. */
  people: (Payee & { role: string | null })[];
  plans: {
    id: number;
    title: string;
    periodFrom: string;
    periodTo: string;
    status: string;
  }[];
  plan: {
    id: number;
    title: string;
    periodFrom: string;
    periodTo: string;
    status: string;
  } | null;
  projection: Projection;
  /** What the plan itself says about marketing and the costs it typed. */
  planned: {
    spend: number | null;
    spendRetargeting: number | null;
    labour: number | null;
    overhead: number | null;
  };
  /** Last calendar month's expenses on the statements, by category, in USD. */
  statements: {
    month: string;
    through: string | null;
    byCategory: Record<string, number>;
  } | null;
  usdPer: Record<string, number>;
};

export type CostsSummary = {
  softwareUsd: number;
  overheadUsd: number;
  marketingUsd: number;
  /** Lines in a currency with no rate: the totals leave them out. */
  unpriced: string[];
  people: Payee[];
  usdPer: Record<string, number>;
};
