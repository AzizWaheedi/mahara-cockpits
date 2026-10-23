export const CPL_GATE = 15;
export const CPB_GATE = 60;
export const BOOKING_RATE_GATE = 25;
export const CPB_BAD = 80;
/**
 * Spend with no lead, Aziz, 23 Oct 2026 (cost per booking decisions, 4): "Depends on how much
 * spend if 2x target cpl then yes bad if below that then not enough data". At or over
 * NO_LEAD_MULTIPLE x CPL_GATE ($30) it is bad; above $0 and under it, too few to judge.
 * The line is always computed, never typed. Keep in step with src/lib/kpi.ts.
 */
export const NO_LEAD_MULTIPLE = 2;
export const NEW_CAMPAIGN_FORM_URL =
  "https://forms.clickup.com/90182518398/f/2kzmr1ky-3878/1BO7T0R9GQCL88NBHR";