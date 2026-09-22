/**
 * The Typeform behind each role's careers page, checked 2026-09-22.
 *
 * Kept away from `intake.ts` so a screen can name a form without importing
 * the action that reads it. None of the five had a webhook, so the cockpit
 * polls them; see `intake.ts`.
 */
export const FORMS: Record<string, { id: string; title: string }> = {
  "media-buyer": { id: "zo1Zm6u6", title: "Media Buyer Application" },
  csm: { id: "oW8CWRhi", title: "Client Success Manager Application" },
  // The careers card says "Setter / Closer" but this form asks a closer's
  // questions only, so a setter and a closer cannot be told apart from the
  // answers. The form has to be split before the funnel can split them.
  "sales-rep": { id: "rqv3Fkts", title: "High-Ticket Closer Job Application" },
  "call-centre": { id: "jYTRw2Sx", title: "Call Centre Agent Application" },
  "video-editor": { id: "tigKbFlO", title: "Video Editor Application" },
};
