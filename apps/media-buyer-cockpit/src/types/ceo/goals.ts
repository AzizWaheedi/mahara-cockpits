import type { MetricDef, Unit } from "./scoreboard";
import type { CostsSummary } from "./costs";

export type PlanRow = {
  id: number;
  periodKind: "month" | "quarter" | "custom";
  periodFrom: string;
  periodTo: string;
  title: string;
  mission: string | null;
  headline: string | null;
  status: "draft" | "live" | "closed";
  workingDays: number;
};

export type TargetRow = {
  id: number;
  groupKey: string;
  metricKey: string;
  label: string;
  unit: Unit;
  direction: "up" | "down";
  target: number | null;
  stretch: number | null;
  baseline: number | null;
  note: string | null;
  sort: number;
  source: "measured" | "typed" | "none";
  sourceText: string;
  actual: number | null;
  pacedTarget: number | null;
  level: boolean;
  onPace: boolean | null;
  progress: number | null;
};

export type Board = {
  plan: PlanRow | null;
  plans: {
    id: number;
    title: string;
    periodFrom: string;
    periodTo: string;
    status: string;
  }[];
  pace: {
    workingDays: number;
    workedSoFar: number;
    daysLeft: number;
    share: number;
    through: string;
  } | null;
  groups: {
    key: string;
    label: string;
    blurb: string;
    targets: TargetRow[];
  }[];
  behind?: {
    label: string;
    actual: number | null;
    pacedTarget: number | null;
  }[];
  behindPace?: TargetRow[];
  catalogue: MetricDef[];
  measured: Record<string, number>;
  callClients: { name: string; leads: number; bookings: number; rate: number | null }[] | null;
  costs: CostsSummary | null;
  [key: string]: any;
};
