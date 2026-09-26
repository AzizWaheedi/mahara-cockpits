import { z } from "zod";

const amount = z.number().finite().positive().max(1_000_000_000);
const rate = z.number().finite().min(0).max(1);
const people = z.number().int().min(0).max(1_000_000_000);
const band = (n: typeof amount) => z.object({ low: n, high: n }).strict();
export const webinarTargetsSchema = z
  .object({
    plannedSpend: amount,
    costPerRegistration: band(amount).extend({ plan: amount }).strict(),
    registrations: band(people).extend({ plan: people }).strict(),
    pageConversion: band(rate).extend({ floor: rate }).strict(),
    showRate: band(rate),
    retentionAtPitch1: rate,
    attendeeToBooked: band(rate),
    bookedToHeld: rate,
    closeRate: rate,
    killRule: z
      .object({ spendAfter: amount, costPerRegistrationAbove: amount })
      .strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const key of [
      "costPerRegistration",
      "registrations",
      "pageConversion",
      "showRate",
      "attendeeToBooked",
    ] as const) {
      const b = v[key];
      if (b.low > b.high)
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Minimum must not exceed maximum.",
        });
      if ("plan" in b && (b.plan < b.low || b.plan > b.high))
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Plan must be within the target range.",
        });
    }
    if (v.pageConversion.floor > v.pageConversion.low)
      ctx.addIssue({
        code: "custom",
        path: ["pageConversion"],
        message: "Floor must not exceed the minimum target.",
      });
  });
export type WebinarTargets = z.infer<typeof webinarTargetsSchema>;
export const WEBINAR_TARGETS: WebinarTargets = {
  plannedSpend: 2000,
  costPerRegistration: { low: 6, high: 10, plan: 8 },
  registrations: { low: 200, high: 330, plan: 250 },
  pageConversion: { low: 0.15, high: 0.25, floor: 0.1 },
  showRate: { low: 0.3, high: 0.4 },
  retentionAtPitch1: 0.5,
  attendeeToBooked: { low: 0.1, high: 0.15 },
  bookedToHeld: 0.6,
  closeRate: 0.2,
  killRule: { spendAfter: 500, costPerRegistrationAbove: 15 },
};
export type TargetVersion = {
  scope_key: string;
  revision: number;
  values: WebinarTargets;
  changed_at: string;
  changed_by: string;
};
export type TargetSelection = {
  values: WebinarTargets;
  revision: number;
  basis: "round" | "defaults" | "original";
  savedAt: string | null;
};
export function selectTargets(
  versions: TargetVersion[],
  scope: string,
  startedAt: number | null,
): TargetSelection {
  const own = versions
    .filter(v => v.scope_key === scope)
    .sort((a, b) => b.revision - a.revision)[0];
  // Future defaults never rewrite a round that has already started collecting data.
  const inherited =
    scope !== "defaults" && startedAt !== null
      ? versions
          .filter(
            v =>
              v.scope_key === "defaults" &&
              Date.parse(v.changed_at) <= startedAt,
          )
          .sort((a, b) => b.revision - a.revision)[0]
      : undefined;
  const hit = own ?? inherited;
  return {
    values: hit
      ? webinarTargetsSchema.parse(hit.values)
      : structuredClone(WEBINAR_TARGETS),
    revision: own?.revision ?? 0,
    basis:
      own && scope !== "defaults" ? "round" : hit ? "defaults" : "original",
    savedAt: hit?.changed_at ?? null,
  };
}
export function roundTargetStart(round: {
  spendFrom: string | null;
  registration: { firstRegisteredAt: number | null };
}): number | null {
  const dates = [
    round.registration.firstRegisteredAt,
    round.spendFrom ? Date.parse(`${round.spendFrom}T00:00:00+03:00`) : null,
  ].filter((n): n is number => n !== null && Number.isFinite(n) && n > 0);
  return dates.length ? Math.min(...dates) : null;
}
export type TargetEditorState = {
  scope: string;
  selection: TargetSelection;
  history: TargetVersion[];
};
export const TARGET_FIELDS = [
  ["plannedSpend", "Planned spend", "$", "Acquisition"],
  ["registrations.low", "Registrations · minimum", "people", "Acquisition"],
  ["registrations.plan", "Registrations · plan", "people", "Acquisition"],
  ["registrations.high", "Registrations · maximum", "people", "Acquisition"],
  [
    "costPerRegistration.low",
    "Cost per registration · minimum",
    "$",
    "Acquisition",
  ],
  [
    "costPerRegistration.plan",
    "Cost per registration · plan",
    "$",
    "Acquisition",
  ],
  [
    "costPerRegistration.high",
    "Cost per registration · maximum",
    "$",
    "Acquisition",
  ],
  ["pageConversion.floor", "Page conversion · floor", "%", "Conversion"],
  ["pageConversion.low", "Page conversion · minimum", "%", "Conversion"],
  ["pageConversion.high", "Page conversion · maximum", "%", "Conversion"],
  ["showRate.low", "Show rate · minimum", "%", "Conversion"],
  ["showRate.high", "Show rate · maximum", "%", "Conversion"],
  ["retentionAtPitch1", "Still watching at pitch 1", "%", "Conversion"],
  ["attendeeToBooked.low", "Attendee to booked · minimum", "%", "Sales"],
  ["attendeeToBooked.high", "Attendee to booked · maximum", "%", "Sales"],
  ["bookedToHeld", "Booked calls held", "%", "Sales"],
  ["closeRate", "Close rate", "%", "Sales"],
  [
    "killRule.spendAfter",
    "Review after spend reaches",
    "$",
    "Review thresholds",
  ],
  [
    "killRule.costPerRegistrationAbove",
    "Flag cost per registration above",
    "$",
    "Review thresholds",
  ],
] as const;
export function targetsToInputs(
  values: WebinarTargets,
): Record<string, string> {
  return Object.fromEntries(
    TARGET_FIELDS.map(([path, , unit]) => {
      const [top, child] = path.split(".");
      const group = values[top as keyof WebinarTargets];
      const n = child
        ? (group as Record<string, number>)[child]
        : (group as number);
      return [path, String(Number((n * (unit === "%" ? 100 : 1)).toFixed(8)))];
    }),
  );
}
export function inputsToTargets(
  inputs: Record<string, string>,
): WebinarTargets {
  const out: Record<string, unknown> = {};
  for (const [path, label, unit] of TARGET_FIELDS) {
    const raw = inputs[path]?.trim();
    if (!raw || !/^\d+(\.\d+)?$/.test(raw))
      throw new Error(`Enter a number for ${label.toLowerCase()}.`);
    const entered = Number(raw);
    if (unit === "%" && entered > 100)
      throw new Error(`${label} must be between 0 and 100%.`);
    if (unit === "people" && !Number.isInteger(entered))
      throw new Error(`${label} must be a whole number.`);
    if (unit === "$" && entered === 0)
      throw new Error(`${label} must be greater than $0.`);
    const n = entered / (unit === "%" ? 100 : 1);
    const [top, child] = path.split(".");
    if (child) {
      out[top] ??= {};
      (out[top] as Record<string, number>)[child] = n;
    } else out[top] = n;
  }
  const result = webinarTargetsSchema.safeParse(out);
  if (!result.success)
    throw new Error(
      `${result.error.issues[0].path.join(" · ")}: ${result.error.issues[0].message}`,
    );
  return result.data;
}
