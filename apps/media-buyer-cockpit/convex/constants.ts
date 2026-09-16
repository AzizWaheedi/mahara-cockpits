export const APP_NAME = "Mahara Cockpit";

/**
 * The official KPI gates. Aziz, 2026-09-16: $15 per lead and $60 per booking
 * are what we aim for; anything above needs action. Every backend file imports
 * these. Keep in step with src/lib/kpi.ts.
 */
export const CPL_GATE = 15;
export const CPB_GATE = 60;

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
