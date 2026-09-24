export type FrequencyFigure = {
  campaigns?: number;
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
