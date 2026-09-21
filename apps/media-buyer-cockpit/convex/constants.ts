export const APP_NAME = "Mahara Cockpit";

/**
 * The official KPI gates. Aziz, 2026-09-16: $15 per lead and $60 per booking
 * are what we aim for; anything above needs action. Every backend file imports
 * these. Keep in step with src/lib/kpi.ts.
 */
export const CPL_GATE = 15;
export const CPB_GATE = 60;
/**
 * The rate gates the client reports use (reportDocs.ts), in percent: at least
 * a quarter of leads booked, three quarters of booked meetings showing up,
 * one close in five shows. Keep in step with src/lib/kpi.ts.
 */
export const BOOKING_RATE_GATE = 25;
export const SHOW_RATE_GATE = 75;
export const CLOSE_RATE_GATE = 20;
/**
 * The client status rule on the CEO Delivery tab (Aziz, 2026-09-21), in
 * percent and dollars. Good needs a show rate of at least SHOW_RATE_GOOD and
 * a cost per confirmed booking within CPB_GATE; bad is a show rate under
 * SHOW_RATE_BAD or a cost per booking over CPB_BAD. Aziz wrote "(confirm the
 * 40)" beside the bad show rate, so the screen labels it as his to confirm.
 * The bad cost per lead stays CPL_GATE * 1.5 ($22.50) where the sync and the
 * adapters already compute it. Keep in step with src/lib/kpi.ts.
 */
export const SHOW_RATE_GOOD = 60;
export const SHOW_RATE_BAD = 40;
export const CPB_BAD = 80;

/** ClickUp form that creates the campaign card on the ads management board. Aziz, 2026-09-10. */
export const NEW_CAMPAIGN_FORM_URL =
  "https://forms.clickup.com/90182518398/f/2kzmr1ky-3878/1BO7T0R9GQCL88NBHR";

/**
 * Aziz's Slack user id in the MaharaMedia workspace: posting to a user id
 * opens the DM with Mahara Club Bot. U0AJQ8P1ACF, used until 2026-09-14, is
 * Nada's id, so every "tell Aziz" message went to her instead.
 * ALERT_SLACK_TO on the deployment overrides it.
 */
export const AZIZ_SLACK_ID = "U09305KE2KS";
