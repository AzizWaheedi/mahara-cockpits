export type UnmappedPayer = {
  payer: string;
  name?: string;
  email?: string;
  payments: number;
  usd: number;
  amount?: number;
  currency?: string;
  firstMonth: string;
  lastMonth: string;
  suggestion: { clickupTaskId: string; client: string; why: string } | null;
  mapped: { clickupTaskId: string; client: string; note: string | null } | null;
  [key: string]: any;
};

export type PayerList = {
  payers: UnmappedPayer[];
  canAssign: boolean;
  totalUsd: number;
  mappedUsd: number;
  unmapped?: UnmappedPayer[];
  [key: string]: any;
};
