export type FrequencyFigure = {
  /** Campaigns of the kind that delivered (impressions above 0) in the window. */
  campaigns?: number;
  /** Every campaign of the kind on the account, delivered or not. */
  listed?: number;
  impressions?: number;
  reach?: number;
  frequency?: number | null;
  spend?: number;
  leads?: number;
  cpl?: number;
  freq?: number;
  windowDays?: number;
  note?: string;
  [key: string]: any;
};

export type FrequencyRead = {
  from: string;
  to: string;
  computedAt: number;
  leadGen: FrequencyFigure | null;
  retargeting: FrequencyFigure | null;
  note: string | null;
  [key: string]: any;
};
