import { z } from "zod";

const text = z.string().nullable();
const number = z.number().finite().nullable();
export const departureSchema = z.object({
  id: z.number(),
  client: z.string(),
  clickup_task_id: text,
  left_on: z.string(),
  launched_on: text,
  reason: z.string(),
  mrr_lost_usd: number,
  csm: text,
  note: text,
  source: z.enum(["cockpit", "sheet"]),
  created_by: z.string(),
  created_at: z.string(),
  updated_by: text,
  updated_at: z.string(),
  // The confirm (20261101o). Optional, so a read from before it still parses.
  notice_on: text.optional(),
  exit_call_id: text.optional(),
  survey_response_id: text.optional(),
  survey_state: z
    .enum(["not_sent", "sent", "filled", "declined"])
    .nullable()
    .optional(),
  why_detail: text.optional(),
  how_to_stop: text.optional(),
  churn_type: z.enum(["mid_programme", "completed"]).nullable().optional(),
  confirmed_at: text.optional(),
  confirmed_role: text.optional(),
  billing_event_id: number.optional(),
  card_state: text.optional(),
  card_error: text.optional(),
  churn_type_default: z
    .enum(["mid_programme", "completed"])
    .nullable()
    .optional(),
});
const rating = z.object({ title: z.string(), value: z.number() });
/** A termination survey the cockpit holds (cockpit_form_notices_in, 20261101l). */
export const noticeSchema = z.object({
  responseId: z.string(),
  taskId: text.optional(),
  clientName: text.optional(),
  noticeOn: text.optional(),
  submittedAt: text.optional(),
  matched: z.boolean().optional(),
  departureId: number.optional(),
  ratings: z.array(rating).optional(),
  typeDefault: z.enum(["mid_programme", "completed"]).nullable().optional(),
});
/** A card that reads Stopped with no departure in the register (Q5: a review list). */
export const stoppedSchema = z.object({
  taskId: z.string(),
  clientName: z.string(),
  churnDate: text.optional(),
  stoppedSince: text.optional(),
  mrrUsd: number.optional(),
  csm: text.optional(),
  typeDefault: z.enum(["mid_programme", "completed"]).nullable().optional(),
});
export const monthInputSchema = z.object({
  month: z.string(),
  active_at_start: number,
  new_clients: number,
  lost_before_register: number,
  note: text,
});
export const churnSourceSchema = z.object({
  today: z.string(),
  month: z.string(),
  me: z.object({ email: z.string(), isCeo: z.boolean(), isAdmin: z.boolean() }),
  deps: z.array(departureSchema),
  monthRows: z.array(monthInputSchema),
  cards: z.array(
    z.object({
      clickup_task_id: z.string(),
      client_name: z.string(),
      stage: text,
      stage_group: text,
      churn_date: text,
      csm: text,
      mrr_usd: number,
    }),
  ),
  log: z.array(
    z.object({
      at: z.string(),
      by_whom: z.string(),
      what: z.string(),
      detail: z.object({ key: z.string().optional() }).nullable(),
    }),
  ),
  roster: z.object({
    cards: z.array(
      z.object({
        key: z.string(),
        name: z.string(),
        stage: z.string(),
        launchedOn: text,
        csm: text,
        pausedSince: text,
        pausedDays: number,
      }),
    ),
    left: z.array(
      z.object({
        key: z.string(),
        name: z.string(),
        day: z.string(),
        to: z.string(),
      }),
    ),
    starts: z.array(z.object({ month: z.string(), day: text, paying: number })),
  }),
  notices: z.array(noticeSchema).optional(),
  unmatched: z.array(noticeSchema).optional(),
  stoppedNotInRegister: z.array(stoppedSchema).optional(),
});
export type ChurnSource = z.infer<typeof churnSourceSchema>;
export type DepartureSource = z.infer<typeof departureSchema>;
export type MonthSource = z.infer<typeof monthInputSchema>;
export type NoticeSource = z.infer<typeof noticeSchema>;
export type StoppedSource = z.infer<typeof stoppedSchema>;
