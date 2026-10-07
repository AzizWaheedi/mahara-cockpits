export type Profile = {
  personId: number;
  personalGoals: string;
  professionalGoals: string;
  greenFlags: string;
  redFlags: string;
  doThis: string;
  dontDoThis: string;
  notes: string;
  skill: number | null;
  will: number | null;
  culture: number | null;
  gradesNote: string;
  updatedBy: string | null;
  updatedAt: string | null;
  [key: string]: any;
};

export type PersonFile = {
  id: number;
  kind: "cv" | "contract" | "other" | string;
  name: string;
  sizeBytes: number | null;
  mime: string | null;
  uploadedBy: string;
  uploadedAt: string;
  url?: string;
  [key: string]: any;
};

export type ScorecardItem = {
  key: string;
  accountability: string;
  lookingAt: string[];
  scale: { a: string; b: string; c: string; d: string };
  prompts: string[];
  grade: "A" | "B" | "C" | "D" | null;
  comment: string;
  [key: string]: any;
};

export type Scorecard = {
  id: number | null;
  personId: number;
  month: string;
  roleKey: string;
  title: string;
  mission: string;
  items: ScorecardItem[];
  overall: "A" | "B" | "C" | "D" | null;
  summary: string;
  reviewedOn: string | null;
  reviewedBy: string | null;
  status: "draft" | "final";
  competencies: string[];
  bonus: string | null;
  fresh: boolean;
  startedFrom: string | null;
  [key: string]: any;
};
