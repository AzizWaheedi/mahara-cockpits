import { CPB_BAD, CPB_GATE, CPL_BAD, CPL_GATE } from "./kpi";

/**
 * The colour of a cost on the Ads page, from Muhammed's grid in kpi.ts
 * (2026-10-13), not the old single gates: cost per lead is good up to
 * CPL_GATE, a warning up to CPL_BAD and bad above it; cost per booking is
 * good up to CPB_GATE, a warning up to CPB_BAD and bad above it. The board
 * cells, the Blended CPL tile and a client's page all read these two.
 */
export type CostTone = "good" | "warn" | "bad";

const band = (
  v: number | null | undefined,
  gate: number,
  bad: number,
): CostTone | undefined =>
  v === null || v === undefined || !Number.isFinite(v)
    ? undefined
    : v <= gate
      ? "good"
      : v <= bad
        ? "warn"
        : "bad";

/** Cost per lead against $15 and $22.50. Undefined when there is no number. */
export const cplTone = (v: number | null | undefined) =>
  band(v, CPL_GATE, CPL_BAD);
/** Cost per booking against $60 and $80. Undefined when there is no number. */
export const cpbTone = (v: number | null | undefined) =>
  band(v, CPB_GATE, CPB_BAD);

/** The text class for a tone (index.css). */
export const COST_TEXT: Record<CostTone, string> = {
  good: "txt-good",
  warn: "txt-warn",
  bad: "txt-bad",
};
/** The text class for a cost, or none when there is no number. */
export const costText = (tone: CostTone | undefined) =>
  tone ? COST_TEXT[tone] : "";
/** The dot colour for a tone. */
export const COST_DOT: Record<CostTone, string> = {
  good: "var(--success)",
  warn: "var(--warning)",
  bad: "var(--destructive)",
};
