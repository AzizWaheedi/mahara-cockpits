export type SourceStamp = {
  name: string;
  freshestAt?: number;
  ok: boolean;
  note?: string;
};

export type DailyPoint = {
  date: string;
  metric: string;
  scope: string;
  value: number;
};

export type SectionResult = {
  payload: unknown;
  daily?: DailyPoint[];
  sources: SourceStamp[];
};

export type Adapter = {
  key: string;
  label: string;
  compute: (ctx: any) => Promise<SectionResult>;
};
