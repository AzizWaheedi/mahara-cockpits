import { z } from "zod";

const text = z.string().nullish();
const number = z.number().finite().nullish();
const fact = z.object({
  label: z.string(),
  value: z.string(),
  source: z.string(),
});
export const projectionClientSchema = z.object({
  taskId: z.string(),
  name: z.string(),
  stage: text,
  liveDays: number,
  firstWin: z.boolean().nullish(),
  renewalDate: text,
  renewalTracked: z.boolean().nullish(),
  bucket: text,
  signupDays: number,
  launchDate: text,
  happiness: text,
  lastCall: text,
  lastReport: text,
  reportTracked: z.boolean().nullish(),
  paymentDate: text,
  service: text,
});
export const projectionPlanSchema = z.object({
  _id: z.string(),
  taskId: z.string(),
  clientName: z.string(),
  renewalDate: z.string(),
  updatedAt: z.number(),
  status: z.enum([
    "planned",
    "call_booked",
    "renewed",
    "resold",
    "not_this_cycle",
    "lost",
  ]),
  likelihood: z.enum(["high", "medium", "low"]).nullish(),
  callBookedFor: text,
  notThisCycleReason: text,
  angle: text,
  objection: text,
  objectionAnswer: text,
  outcomeNote: text,
  callRecordingUrl: text,
  goldStandard: z.boolean().nullish(),
  whereTheyAre: z.array(fact).nullish(),
  offer: z
    .object({ price: number, deliverables: text, durationMonths: number })
    .nullish(),
});
export const projectionSourceSchema = z.object({
  today: z.string(),
  owner: z.string(),
  email: z.string(),
  canGold: z.boolean(),
  canEditOthers: z.boolean(),
  clients: z.array(projectionClientSchema),
  plans: z.array(projectionPlanSchema),
  projections: z.array(
    z.object({
      weekStart: z.string(),
      byEmail: z.string(),
      metric: z.enum(["resell", "renewal", "cash", "review", "referral"]),
      at: z.number(),
      blood: number,
      stretch: number,
      actual: number,
      missReason: text,
    }),
  ),
  appointments: z.array(
    z.object({ clientName: text, kind: text, status: text, day: z.string() }),
  ),
  profiles: z.array(
    z.object({
      clientName: text,
      client_name: text,
      performance: z
        .object({
          month: z.record(z.string(), z.number().nullable()).nullish(),
          monthLabel: text,
          allTime: z.record(z.string(), z.number().nullable()).nullish(),
          error: text,
        })
        .nullish(),
    }),
  ),
  decisions: z.array(
    z.object({
      role: z.string(),
      day: z.string(),
      kind: z.string(),
      action: z.string(),
      subject: z.string(),
    }),
  ),
  feed: z.object({
    okAt: z.number().nullable(),
    ledgerSyncedAt: z.number().nullable(),
    error: z.string().nullable(),
    payments: z.array(
      z.object({
        id: z.string(),
        taskId: text,
        clientName: z.string(),
        day: z.string(),
        usd: z.number().finite(),
        side: text,
        kind: text,
      }),
    ),
    accounts: z.array(
      z.object({ taskId: z.string(), clientName: z.string(), ltvUsd: number }),
    ),
  }),
});
export type ProjectionSource = z.infer<typeof projectionSourceSchema>;
export type ProjectionClient = z.infer<typeof projectionClientSchema>;
export type ProjectionPlan = z.infer<typeof projectionPlanSchema>;
