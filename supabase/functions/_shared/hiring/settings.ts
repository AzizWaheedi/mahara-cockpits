/**
 * The hiring engine's switches, stored in cockpit_hiring_meta under "engine".
 *
 * Same shape as apps/media-buyer-cockpit/convex/hiring/settings.ts, because
 * hermes/ceo-refresh/native/adapters/hiring.js reads this row to draw the
 * engine card. Only the CEO changes it, through hiring-api setEngine.
 *
 * The Supabase engine never sends from a schedule. It writes drafts, and a
 * draft leaves only when the CEO presses Send and HIRING_SEND_ENABLED is
 * "true". So "armed" cannot be switched on here; see setEngine.
 */

export const ACTIONS = [
  "loom_request",
  "group_invite",
  "test_project",
  "offer",
  "rejection",
  "bench_note",
] as const;
export type Action = (typeof ACTIONS)[number];

export type EngineSettings = {
  /** GoHighLevel workflows send, or the cockpit drafts. Never both. */
  sender: "gohighlevel" | "cockpit";
  armed: boolean;
  actions: Record<Action, boolean>;
  email: boolean;
  sms: boolean;
  whatsappFallback: boolean;
  staleDays: number;
};

export const SETTINGS_KEY = "engine";

export const DEFAULT_SETTINGS: EngineSettings = {
  sender: "gohighlevel",
  armed: false,
  actions: {
    loom_request: true,
    group_invite: true,
    test_project: true,
    // An offer never leaves without a person reading it first.
    offer: false,
    rejection: true,
    bench_note: true,
  },
  email: true,
  sms: true,
  whatsappFallback: true,
  staleDays: 7,
};

/** The stored row over the defaults, so a missing key reads as its default. */
export function mergeSettings(held: unknown): EngineSettings {
  const h = (held && typeof held === "object" ? held : {}) as Partial<
    EngineSettings
  >;
  return {
    ...DEFAULT_SETTINGS,
    ...h,
    actions: { ...DEFAULT_SETTINGS.actions, ...(h.actions ?? {}) },
  };
}

/** What the screen calls the rails, in one line. */
export function railSummary(s: EngineSettings): string {
  if (s.sender === "gohighlevel")
    return "GoHighLevel sends these, on email and SMS";
  const on = [s.email && "email", s.sms && "SMS"].filter(Boolean) as string[];
  if (!on.length) return "No rail is on";
  const base = on.join(" and ");
  return s.whatsappFallback ? `${base}, WhatsApp as backup` : base;
}

export class SettingsError extends Error {}

/**
 * Turn setEngine's arguments into a patch, or say what is wrong with them.
 * Arming is refused: this engine only drafts, so "Armed and sending" would
 * be a false sentence on the CEO's screen.
 */
export function settingsPatch(
  current: EngineSettings,
  args: Record<string, unknown>,
): Partial<EngineSettings> {
  const patch: Partial<EngineSettings> = {};
  const bool = (k: string): boolean | undefined => {
    const v = args[k];
    if (v === undefined) return undefined;
    if (typeof v !== "boolean") throw new SettingsError(`Choose on or off for ${k}.`);
    return v;
  };
  if (args.sender !== undefined) {
    if (args.sender !== "gohighlevel" && args.sender !== "cockpit")
      throw new SettingsError("Choose GoHighLevel or the cockpit as the sender.");
    patch.sender = args.sender;
  }
  const armed = bool("armed");
  if (armed === true)
    throw new SettingsError(
      "The engine only writes drafts now, so it cannot be armed. Read the drafts and send each one yourself.",
    );
  if (armed === false) patch.armed = false;
  for (const k of ["email", "sms", "whatsappFallback"] as const) {
    const v = bool(k);
    if (v !== undefined) patch[k] = v;
  }
  if (args.staleDays !== undefined) {
    const n = Number(args.staleDays);
    if (!Number.isFinite(n)) throw new SettingsError("Choose a number of days.");
    patch.staleDays = Math.max(1, Math.min(60, Math.round(n)));
  }
  if (args.action !== undefined || args.on !== undefined) {
    const action = String(args.action ?? "");
    if (!(ACTIONS as readonly string[]).includes(action))
      throw new SettingsError(`There is no step called ${action || "that"}.`);
    const on = bool("on");
    if (on === undefined) throw new SettingsError("Choose on or off for the step.");
    patch.actions = { ...current.actions, [action]: on } as Record<Action, boolean>;
  }
  if (!Object.keys(patch).length)
    throw new SettingsError("Nothing to change was given.");
  return patch;
}
