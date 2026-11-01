/**
 * FormSheet fixtures (docs/forms/WAVE12-CONTRACT.md 4.12): invented prefill
 * reads, calls and trail rows for the form-sheet test and for screenshots of
 * every state at 375 and 1280 px. Nothing here is a real client's money; the
 * names are the shape of real ones (a company, and one named in Arabic) so
 * the header and the bdi are seen with both.
 */

import type {
  CallPick,
  FormTrailRow,
  Prefill,
} from "@/forms/staff/formSheetCore";
import type { Doors, PrefillRead } from "@/forms/staff/lifecycleClient";

export const FIXTURE_TODAY = "2026-11-01";

export const CLIENT = { taskId: "86ewvnqj5", name: "Liwan Limited" };
export const CLIENT_ARABIC = {
  taskId: "86eyqx2f6",
  name: "حول العمران للمقاولات",
};

export const CALLS: CallPick[] = [
  {
    id: "4211",
    at: "2026-10-28T11:30:00+03:00",
    kind: "Check-in call",
    source: "Fathom, 28 Oct",
  },
  {
    id: "9f1c2d8e-1111-4c4c-8a8a-000000000001",
    at: "2026-10-21T15:00:00+03:00",
    kind: "1-1 notes",
    source: "the 1-1 notes, 21 Oct",
  },
];

export const EXTENSION_PREFILL: Prefill[] = [
  { key: "status", value: "Active", source: "the ClickUp card" },
  { key: "nextDate", value: "2026-11-02", source: "the ClickUp card" },
  { key: "plan", value: "Monthly", source: "the ClickUp card" },
  { key: "nextAmountUsd", value: null, source: "Nobody holds this yet" },
];

export const EXTENSION_READ: PrefillRead = {
  prefill: EXTENSION_PREFILL,
  calls: CALLS,
  hints: [
    {
      key: "hint0",
      value: "The 1-1 notes mention an extension",
      source: "the 1-1 notes, 21 Oct",
    },
  ],
  grant: null,
  card: { status: "Active", nextDate: "2026-11-02", pausedOn: null },
  survey: null,
  churnTypeDefault: null,
};

export const LIVE_GRANT_READ: PrefillRead = {
  ...EXTENSION_READ,
  grant: { grantId: 4021, until: "2026-11-16", weeks: 2 },
};

export const CHURN_PREFILL: Prefill[] = [
  { key: "mrrLostUsd", value: 1500, source: "the ClickUp card" },
  { key: "churnType", value: "mid_programme", source: "the day-90 rule" },
  {
    key: "noticeOn",
    value: "2026-10-30",
    source: "the termination survey, 30 Oct",
  },
  { key: "surveyState", value: "filled", source: "the termination survey" },
];

export const MRR_PREFILL: Prefill[] = [
  { key: "mrrUsd", value: 2000, source: "the ClickUp card" },
];

export const ALL_DOORS: Doors = {
  churnConfirm: true,
  extension: true,
  pause: true,
  mrr: true,
  reviews: true,
  checks: true,
  prefill: true,
};

/** Every state cockpit_form_trail can answer, for the trail's sentences. */
export const TRAIL_ROWS: Record<string, FormTrailRow> = {
  held: {
    stored: { state: "done", at: "2026-11-01T07:42:00Z" },
    card: { state: "held", mode: "dry_run", error: null, at: null },
    notice: {
      kind: "extension.granted",
      state: "failed",
      channelName: "csm-announcements",
      error: null,
    },
  },
  queued: {
    stored: { state: "done", at: "2026-11-01T07:42:00Z" },
    card: { state: "queued" },
    notice: {
      kind: "extension.granted",
      state: "queued",
      channelName: "csm-announcements",
    },
  },
  sending: {
    stored: { state: "done" },
    card: { state: "sending" },
    notice: { state: "queued" },
  },
  retry: {
    stored: { state: "done" },
    card: { state: "retry" },
    notice: { state: "queued" },
  },
  delivered: {
    stored: { state: "done", at: "2026-11-01T07:42:00Z" },
    card: { state: "delivered", at: "2026-11-01T07:43:10Z" },
    notice: {
      kind: "extension.granted",
      state: "posted",
      channelName: "csm-announcements",
      permalink: "https://mahara.slack.com/archives/C09SNG5BP53/p1",
    },
  },
  failed: {
    stored: { state: "done" },
    card: { state: "failed", error: "field 8cb9d308 is locked" },
    notice: { state: "skipped", error: "the event is over 48 hours old" },
  },
  skipped: {
    stored: { state: "done" },
    card: { state: "skipped" },
    notice: { state: "muted" },
  },
  voided: {
    stored: { state: "done" },
    card: { state: "skipped", error: "Voided in the cockpit: churned" },
    notice: { state: "none" },
  },
  none: {
    stored: { state: "none" },
    card: { state: "none" },
    notice: { state: "none" },
  },
};
