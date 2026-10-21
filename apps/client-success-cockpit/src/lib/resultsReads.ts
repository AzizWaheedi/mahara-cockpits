/**
 * The reads behind the results and speed screens (Muhammed, 2026-10-21: the gap report, the CSM call
 * list, the speed chart and the morning list). Every number is the database's
 * (supabase/migrations/20261021i_results_speed_reads.sql, over 20261021e to 20261021h):
 *   cockpit_gap_read(from, to)                every client's meetings with no result
 *   cockpit_gap_client_read(location, from, to)  one client's meetings with no result
 *   cockpit_csm_calls_read()                  this week's call list, who called and when
 *   cockpit_csm_call_logged(location)         the one write: "Called"
 *   cockpit_speed_read(from, to, clock)       paid leads by hour, country and speed band, as counts
 *   cockpit_morning_uncalled_read(location)   the leads with no call linked, in groups
 * This file only reads them. A key the screen does not know is kept, a key it needs and does not find is
 * a plain error, and a missing value is never turned into 0.
 *
 * The same file sits in the media buyer and client success cockpits (results-screens.test.ts keeps the
 * two copies equal), like kpi.ts.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

const num = z.number().nullable().optional();
const text = z.string().nullable().optional();
const flag = z.boolean().nullable().optional();

// ---------------------------------------------------------------------------
// The shapes

export const GapRowSchema = z
  .object({
    locationId: z.string(),
    clientName: z.string(),
    serviceMode: text,
    meetings: z.number(),
    withResult: z.number(),
    noResult: z.number(),
    share: num,
    crmConfirmed: z.number(),
    sheetBlank: z.number(),
    sheetMissing: z.number(),
    sheetUnclear: z.number(),
    confirmedAndBlank: z.number(),
    oldestDays: num,
    sheetReadOk: flag,
    sheetCheckedAt: text,
    sheetError: text,
    matchesBoard: flag,
    note: text,
  })
  .passthrough();
export type GapRow = z.infer<typeof GapRowSchema>;

export const GapReportSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    computedAt: z.string(),
    rows: z.array(GapRowSchema),
    quietClients: z.number(),
    totals: z
      .object({
        meetings: z.number(),
        noResult: z.number(),
        sheetBlank: z.number(),
        crmConfirmed: z.number(),
        share: num,
      })
      .passthrough(),
    notes: z.array(z.string()),
  })
  .passthrough();
export type GapReport = z.infer<typeof GapReportSchema>;

export const GapMeetingSchema = z
  .object({
    id: z.string(),
    contactId: text,
    firstName: text,
    meetingAt: z.string(),
    day: z.string(),
    calendar: text,
    crmStatus: text,
    crmConfirmed: flag,
    sheetState: z.string(),
    daysSince: num,
    contactUrl: text,
  })
  .passthrough();
export type GapMeeting = z.infer<typeof GapMeetingSchema>;

export const GapClientSchema = z
  .object({
    locationId: z.string(),
    clientName: z.string(),
    from: z.string(),
    to: z.string(),
    computedAt: z.string(),
    meetings: z.array(GapMeetingSchema),
  })
  .passthrough();
export type GapClient = z.infer<typeof GapClientSchema>;

export const CallMeetingSchema = z
  .object({ name: z.string(), day: z.string(), cell: z.string(), runs: num })
  .passthrough();

export const CallRowSchema = z
  .object({
    locationId: z.string(),
    clientName: z.string(),
    rank: z.number(),
    status: z.enum(["call", "queued"]),
    missing: z.number(),
    missingShow: num,
    missingClosed: num,
    oldestMeeting: text,
    inFirstChase: num,
    meetings: z.array(CallMeetingSchema),
    sheetCheckedAt: text,
    sheetError: text,
    calledAt: text,
    calledBy: text,
    calledByName: text,
  })
  .passthrough();
export type CallRow = z.infer<typeof CallRowSchema>;

export const CallListSchema = z
  .object({
    week: z.string(),
    cap: z.number(),
    computedAt: z.string(),
    runsBasis: z.string(),
    rows: z.array(CallRowSchema),
    notes: z.array(z.string()),
  })
  .passthrough();
export type CallList = z.infer<typeof CallListSchema>;

export const CallLoggedSchema = z
  .object({
    ok: z.boolean(),
    alreadyLogged: z.boolean(),
    locationId: z.string(),
    clientName: z.string(),
    week: z.string(),
    calledAt: z.string(),
    calledBy: z.string(),
  })
  .passthrough();
export type CallLogged = z.infer<typeof CallLoggedSchema>;

/** [arrival hour, country, band, paid leads, bookings, bookings of any kind] */
export const SpeedCellSchema = z.tuple([
  z.number(),
  z.string(),
  z.string(),
  z.number(),
  z.number(),
  z.number(),
]);
export type SpeedCell = z.infer<typeof SpeedCellSchema>;

export const SpeedSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    clock: z.enum(["clock", "working"]),
    settleDays: z.number(),
    windowTo: text,
    computedAt: z.string(),
    cells: z.array(SpeedCellSchema),
    note: z.string(),
  })
  .passthrough();
export type Speed = z.infer<typeof SpeedSchema>;

export const UncalledClientSchema = z
  .object({
    locationId: z.string(),
    clientName: z.string(),
    callable: z.number(),
    exact: z.number(),
    phoneOnly: z.number(),
    outcomeOnly: z.number(),
    neverCalled: z.number(),
    noCallLinked: z.number(),
    uncalledPaid: z.number(),
    boardCallable: num,
    boardVerified: num,
    boardOutcomeOnly: num,
    boardUntouched: num,
    boardComputedAt: text,
    matchesBoard: flag,
  })
  .passthrough();

export const UncalledLeadSchema = z
  .object({
    locationId: z.string(),
    clientName: z.string(),
    contactId: z.string(),
    firstName: text,
    createdAt: z.string(),
    hoursWaiting: num,
    paid: flag,
    group: z.enum(["phone_only", "outcome_only", "never_called"]),
    callEvidence: text,
    lastCallAt: text,
    lastAttemptAt: text,
    lastOutcome: text,
    phoneLast4: text,
    contactUrl: text,
  })
  .passthrough();
export type UncalledLead = z.infer<typeof UncalledLeadSchema>;

export const MorningSchema = z
  .object({
    asOf: z.string(),
    clients: z.array(UncalledClientSchema),
    leads: z.array(UncalledLeadSchema),
    totals: z
      .object({
        callable: z.number(),
        exact: z.number(),
        phoneOnly: z.number(),
        outcomeOnly: z.number(),
        neverCalled: z.number(),
        noCallLinked: z.number(),
        uncalledPaid: z.number(),
        matchesBoard: flag,
        clientsWithoutBoardRow: num,
      })
      .passthrough(),
  })
  .passthrough();
export type Morning = z.infer<typeof MorningSchema>;
export type UncalledClient = z.infer<typeof UncalledClientSchema>;

// ---------------------------------------------------------------------------
// Reading

export class ReadShapeError extends Error {}

export function parseRead<T>(
  schema: z.ZodType<T>,
  data: unknown,
  what: string,
): T {
  const out = schema.safeParse(data);
  if (out.success) return out.data;
  const first = out.error.issues[0];
  throw new ReadShapeError(
    `The ${what} came back in a shape this page cannot read (${first?.path.join(".") || "top"}). Tell the CEO.`,
  );
}

const FAILED =
  "This did not load. Try again; if it keeps failing, tell the CEO.";

/** A failed read as one plain sentence: the database's own refusals are already written for this page. */
export function readProblem(error: unknown): string {
  if (error instanceof ReadShapeError) return error.message;
  const e = (error ?? {}) as { message?: unknown; code?: unknown };
  const message = typeof e.message === "string" ? e.message.trim() : "";
  const code = typeof e.code === "string" ? e.code : "";
  if (code === "57014")
    return "This took too long to answer. Try again, or pick a shorter time frame.";
  if (code === "PGRST202" || code === "42883")
    return "This read is not on the database yet. Tell the CEO.";
  if (/jwt|token/i.test(message) && /expired|invalid/i.test(message))
    return "Your sign-in has expired. Reload the page.";
  if (/failed to fetch|network|load failed/i.test(message))
    return "This could not be reached. Check the connection and try again.";
  if ((code === "42501" || code === "22023") && message) return message;
  if (/^[A-Z][^\n]{8,300}[.!]$/.test(message)) return message;
  return FAILED;
}

async function rpc(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  // Loaded when a read runs, so a page that only imports the shapes (or a test that mocks the sign-in)
  // does not need the database client.
  const { supabase } = await import("./supabase");
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

export const fetchGap = async (from: string, to: string) =>
  parseRead(
    GapReportSchema,
    await rpc("cockpit_gap_read", { p_from: from, p_to: to }),
    "meetings with no result",
  );

export const fetchGapClient = async (
  location: string,
  from: string,
  to: string,
) =>
  parseRead(
    GapClientSchema,
    await rpc("cockpit_gap_client_read", {
      p_location: location,
      p_from: from,
      p_to: to,
    }),
    "client's meetings",
  );

export const fetchCallList = async () =>
  parseRead(
    CallListSchema,
    await rpc("cockpit_csm_calls_read", {}),
    "call list",
  );

export const logCall = async (location: string) =>
  parseRead(
    CallLoggedSchema,
    await rpc("cockpit_csm_call_logged", { p_location: location }),
    "call log",
  );

export const fetchSpeed = async (
  from: string,
  to: string,
  clock: "clock" | "working",
) =>
  parseRead(
    SpeedSchema,
    await rpc("cockpit_speed_read", { p_from: from, p_to: to, p_clock: clock }),
    "speed numbers",
  );

export const fetchMorning = async (location: string | null = null) =>
  parseRead(
    MorningSchema,
    await rpc("cockpit_morning_uncalled_read", { p_location: location }),
    "uncalled leads",
  );

// ---------------------------------------------------------------------------
// One read in a component: the key says which read it is, a change of key reads again, and a reload
// keeps the numbers on screen until the new ones arrive.

export type Read<T> =
  | { status: "loading" }
  | { status: "ready"; data: T; refreshing: boolean }
  | { status: "error"; message: string; data?: T };

export function useRead<T>(
  key: string,
  run: () => Promise<T>,
): Read<T> & { reload: () => void } {
  const [state, setState] = useState<Read<T>>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const runRef = useRef(run);
  runRef.current = run;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key names the read, tick asks for it again
  useEffect(() => {
    let live = true;
    setState(prev =>
      prev.status === "ready"
        ? { status: "ready", data: prev.data, refreshing: true }
        : prev.status === "error" && prev.data !== undefined
          ? { status: "ready", data: prev.data, refreshing: true }
          : { status: "loading" },
    );
    runRef
      .current()
      .then(data => {
        if (live) setState({ status: "ready", data, refreshing: false });
      })
      .catch(e => {
        if (!live) return;
        setState(prev => ({
          status: "error",
          message: readProblem(e),
          data: prev.status === "ready" ? prev.data : undefined,
        }));
      });
    return () => {
      live = false;
    };
  }, [key, tick]);
  const reload = useCallback(() => setTick(t => t + 1), []);
  return { ...state, reload };
}
