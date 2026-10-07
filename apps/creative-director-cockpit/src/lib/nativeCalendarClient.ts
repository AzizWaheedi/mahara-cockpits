import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
export type CalendarApp = "media-buyer" | "client-success" | "creative";
export type CalendarWriteOptions = {
  apply?: boolean;
  requestId?: string;
  bindingRevision?: number;
};
const appSchema = z.enum(["media-buyer", "client-success", "creative"]);
const revisionSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const eventSchema = z
  .object({
    eventId: z.string().min(1),
    calendarId: z.string().min(1),
    title: z.string(),
    start: z.string().min(1),
    end: z.string().min(1),
    allDay: z.boolean(),
    attendees: z.array(z.string()),
    kind: z.enum(["client", "team", "other"]),
  })
  .passthrough();
const mineSchema = z.object({
  link: z.record(z.string(), z.unknown()).nullable(),
  today: z.array(eventSchema),
  saEmail: z.string().min(1).nullable(),
  sourceNote: z.string().nullable().optional(),
  bindingRevision: revisionSchema,
});
const overviewSchema = z.object({
  today: z.array(eventSchema),
  upcoming: z.array(eventSchema),
  nextCall: z.array(eventSchema),
  calendarConfigured: z.boolean(),
  calendarReady: z.boolean(),
  myCalendar: z.record(z.string(), z.unknown()).nullable(),
  bindingRevision: revisionSchema,
  saEmail: z.string().min(1).nullable(),
  sourceNote: z.string().nullable(),
  syncedAt: z.number().nonnegative().nullable(),
  calendarSources: z.array(
    z.object({
      provider: z.enum(["google", "ghl"]),
      configured: z.boolean().nullable(),
      checkedAt: z.number().nullable(),
      calendars: z.number().int().nonnegative().nullable(),
    }),
  ),
});
const argsSchema = z
  .object({
    app: appSchema,
    calendarId: z.string().min(1).optional(),
    bindingRevision: revisionSchema,
  })
  .strict();
const intentSchema = z
  .object({ id: z.string().uuid(), args: argsSchema })
  .strict();
type Intent = z.infer<typeof intentSchema>;
const pending = new Map<string, Promise<Intent>>();
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
export class NativeCalendarNotAppliedError extends Error {
  readonly code = "CALENDAR_CAS_NOT_APPLIED";
  constructor() {
    super(
      "The calendar binding changed and this request was not applied. Reload the current calendar before making a new request.",
    );
    this.name = "NativeCalendarNotAppliedError";
  }
}
async function accountGuard(client: SupabaseClient) {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user)
    throw new Error("Sign in again before using calendars.");
  const id = data.user.id;
  let changed = false;
  const subscription = client.auth.onAuthStateChange((_event, session) => {
    if (session?.user.id !== id) changed = true;
  }).data.subscription;
  return {
    id,
    check: async () => {
      const current = await client.auth.getSession();
      if (changed || current.error || current.data.session?.user.id !== id)
        throw new Error(
          "The signed-in account changed. This response was discarded; reload the view.",
        );
    },
    release: () => subscription.unsubscribe(),
  };
}
type Guard = Awaited<ReturnType<typeof accountGuard>>;
async function readMine(
  client: SupabaseClient,
  app: CalendarApp,
  guard: Guard,
) {
  await guard.check();
  const { data, error } = await client.rpc("cockpit_media_calendar_mine", {
    p_app: app,
  });
  await guard.check();
  if (error) throw new Error(error.message);
  return mineSchema.parse(data);
}
export async function calendarMine(client: SupabaseClient, app: CalendarApp) {
  appSchema.parse(app);
  const guard = await accountGuard(client);
  try {
    return await readMine(client, app, guard);
  } finally {
    guard.release();
  }
}
export async function calendarWrite(
  client: SupabaseClient,
  app: CalendarApp,
  operation: "personalCalendars.link" | "personalCalendars.unlink",
  args: Record<string, unknown>,
  options: CalendarWriteOptions = {},
): Promise<{ ok: boolean; id?: string; dryRun?: boolean }> {
  appSchema.parse(app);
  if (
    operation !== "personalCalendars.link" &&
    operation !== "personalCalendars.unlink"
  )
    throw new Error("Unsupported calendar operation.");
  const desired =
    operation === "personalCalendars.link"
      ? { app, calendarId: z.string().min(1).parse(args.calendarId) }
      : { app };
  const guard = await accountGuard(client);
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(canonical([operation, desired])),
    );
    const key = `cockpit-calendar-intent:${guard.id}:${app}:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
    let storage: Storage | undefined;
    try {
      if (typeof window !== "undefined") storage = window.localStorage;
    } catch {}
    const requestId = z
      .string()
      .uuid()
      .parse(options.requestId ?? crypto.randomUUID());
    let intent: Intent | undefined;
    let preparation: Promise<Intent> | undefined;
    const retire = () => {
      if (preparation && pending.get(key) === preparation) pending.delete(key);
      try {
        const saved = storage?.getItem(key);
        if (saved && intentSchema.parse(JSON.parse(saved)).id === intent?.id)
          storage?.removeItem(key);
      } catch {}
    };
    if (options.apply === true) {
      preparation = pending.get(key);
      if (!preparation) {
        preparation = (async () => {
          let saved: string | null = null;
          try {
            saved = storage?.getItem(key) ?? null;
          } catch {
            storage = undefined;
          }
          if (saved) {
            const existing = intentSchema.parse(JSON.parse(saved));
            const { bindingRevision: _revision, ...original } = existing.args;
            if (canonical(original) !== canonical(desired))
              throw new Error(
                "The stored calendar intent does not match these inputs. Reconcile it before continuing.",
              );
            return existing;
          }
          if (
            !storage &&
            (!options.requestId || options.bindingRevision === undefined)
          )
            throw new Error(
              "Without durable storage, supply the original requestId and bindingRevision. Never rebase an uncertain calendar intent.",
            );
          const bindingRevision = revisionSchema.parse(
            options.bindingRevision ??
              (await readMine(client, app, guard)).bindingRevision,
          );
          const prepared = {
            id: requestId,
            args: { ...desired, bindingRevision },
          };
          storage?.setItem(key, JSON.stringify(prepared));
          return prepared;
        })();
        pending.set(key, preparation);
        preparation.catch(() => {
          if (pending.get(key) === preparation) pending.delete(key);
        });
      }
      intent = await preparation;
      if (options.requestId && intent.id !== options.requestId)
        throw new Error(
          "An uncertain request already exists for these inputs. Retry its original operation ID.",
        );
    }
    await guard.check();
    const { data, error } = await client.rpc("cockpit_media_native_write", {
      p_operation: operation,
      p_args: intent?.args ?? desired,
      p_request_id: intent?.id ?? requestId,
      p_apply: options.apply === true,
    });
    await guard.check();
    if (error) throw new Error(error.message);
    const result = z.record(z.string(), z.unknown()).parse(data);
    if (options.apply !== true) {
      if (result.dryRun !== true || result.ok !== false)
        throw new Error("The calendar dry-run result is invalid.");
      return { ok: false, dryRun: true };
    }
    if (!intent) throw new Error("The original calendar intent is missing.");
    if (
      result.ok === false &&
      result.applied === false &&
      result.code === "CALENDAR_CAS_NOT_APPLIED" &&
      result.id === intent.id &&
      result.expectedRevision === intent.args.bindingRevision &&
      revisionSchema.safeParse(result.currentRevision).success
    ) {
      retire();
      throw new NativeCalendarNotAppliedError();
    }
    if (result.ok !== true || result.id !== intent.id)
      throw new Error(
        "The calendar write returned no matching receipt. Retain the operation ID and reconcile before retrying.",
      );
    const revision = revisionSchema.parse(result.bindingRevision);
    if (revision !== intent.args.bindingRevision + 1)
      throw new Error(
        "The calendar receipt does not match the original binding intent.",
      );
    const current = await readMine(client, app, guard);
    if (current.bindingRevision !== revision) {
      retire();
      throw new Error(
        "This calendar request completed earlier. A newer binding is now active; the old receipt did not restore it. Reload and review the current calendar.",
      );
    }
    retire();
    return { ok: true, id: intent.id };
  } finally {
    guard.release();
  }
}
export async function calendarOverview(
  client: SupabaseClient,
  app: CalendarApp,
) {
  appSchema.parse(app);
  const guard = await accountGuard(client);
  try {
    await guard.check();
    const { data, error } = await client.rpc("cockpit_calendar_overview", {
      p_app: app,
    });
    await guard.check();
    if (error) throw new Error(error.message);
    return overviewSchema.parse(data);
  } finally {
    guard.release();
  }
}
