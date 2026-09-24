import type { CommissionBasis } from "./commission";
import type { Schedule } from "./schedule";

export type DirUser = {
  name: string;
  email: string;
  suspended: boolean;
  title: string | null;
};

export type Directory = { ok: boolean; problem?: string; users: DirUser[] };

export type Person = {
  id: number;
  name: string;
  email: string | null;
  role: string | null;
  engagement: "staff" | "freelancer" | "agency" | "intern" | "bot";
  active: boolean;
  pausedOn: string | null;
  pausedWhy: string | null;
  working: boolean;
  monthlyCost: number | null;
  currency: string;
  monthlyUsd: number | null;
  commission: { basis: CommissionBasis; rate: number | null };
  commissionPct: number | null;
  commissionNote: string | null;
  isSales: boolean;
  startedOn: string | null;
  endedOn: string | null;
  note: string | null;
  schedule: Schedule | null;
  source: string;
};

export type Roster = {
  people: Person[];
  ready?: boolean;
  activeMonthlyUsd: number;
  activeCount: number;
  pausedCount: number;
  pausedMonthlyUsd: number;
  botCount: number;
  salesMonthlyUsd?: number;
  missingCost: string[];
  migrationRan?: boolean;
};
