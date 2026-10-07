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
});
export type ChurnSource = z.infer<typeof churnSourceSchema>;
export type DepartureSource = z.infer<typeof departureSchema>;
export type MonthSource = z.infer<typeof monthInputSchema>;
