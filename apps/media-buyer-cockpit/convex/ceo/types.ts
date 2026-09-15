import type { ActionCtx } from "../_generated/server";

/**
 * The CEO cockpit's contract between data adapters and the screen.
 *
 * Every section is computed by one adapter on the backend, stored as a
 * prepared payload, and read by the screen as is: the screen never calls an
 * outside system and never scans a raw table. A failed read keeps the last
 * good payload and says so, so a number is never silently replaced by 0.
 */

/** Where a section's numbers came from and how fresh that source is. */
export type SourceStamp = {
  name: string;
  /** Newest row or last successful sync at the source, epoch ms. */
  freshestAt?: number;
  ok: boolean;
  note?: string;
};

/** One point of daily history, kept so every headline number has a trend. */
export type DailyPoint = {
  /** Kuwait working day, YYYY-MM-DD. */
  date: string;
  metric: string;
  /** "company", "client:<ClickUp task id>", "person:<key>", "rep:<name>", "agent:<name>". */
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
  compute: (ctx: ActionCtx) => Promise<SectionResult>;
};
