import { rest, upsertMerge } from "../ceo/sbWrite";

/**
 * The hiring engine's switches, kept apart from the engine itself.
 *
 * The CEO adapter needs to show whether the engine is armed, and the adapter
 * is reached through `_generated/api`. Reading it straight out of `engine.ts`
 * put that generated module in a cycle with itself and quietly stripped the
 * types off unrelated files (2026-09-22), so anything both sides need lives
 * here, where nothing generated is imported.
 */

export type Action =
  | "loom_request"
  | "group_invite"
  | "test_project"
  | "offer"
  | "rejection"
  | "bench_note";

export type EngineSettings = {
  /**
   * Who sends candidate messages. Aziz, 2026-09-22: "I'm going to publish the
   * GoHighLevel workflows, and then we can use that as the backend." So
   * GoHighLevel owns sending, and the cockpit engine does nothing at all,
   * because two senders would message every candidate twice.
   */
  sender: "gohighlevel" | "cockpit";
  /** Only read when the cockpit is the sender. */
  armed: boolean;
  /** Which actions may fire at all. */
  actions: Record<Action, boolean>;
  /**
   * Which rails a message goes out on. Aziz, 2026-09-22: "make sure to use
   * email and SMS. SMS is WhatsApp, remember, but you can also use WhatsApp as
   * a backup, just in case." So both rails carry every message, and WhatsApp
   * is tried only when the SMS rail refuses.
   */
  email: boolean;
  sms: boolean;
  whatsappFallback: boolean;
  /** Days without a move before a candidate is called stale. */
  staleDays: number;
};

/** What the screen calls the rails, in one line. */
export function railSummary(s: EngineSettings): string {
  if (s.sender === "gohighlevel")
    return "GoHighLevel sends these, on email and SMS";
  const on = [s.email && "email", s.sms && "SMS"].filter(Boolean) as string[];
  if (!on.length) return "No rail is on";
  const base = on.join(" and ");
  return s.whatsappFallback ? `${base}, WhatsApp as backup` : base;
}

export const SETTINGS_KEY = "engine";

export const DEFAULT_SETTINGS: EngineSettings = {
  sender: "gohighlevel",
  armed: false,
  actions: {
    loom_request: true,
    group_invite: true,
    test_project: true,
    // An offer is the one message that should never leave without a person
    // reading it first.
    offer: false,
    rejection: true,
    bench_note: true,
  },
  email: true,
  sms: true,
  whatsappFallback: true,
  staleDays: 7,
};

export async function settings(): Promise<EngineSettings> {
  const rows = await rest(
    `cockpit_hiring_meta?key=eq.${SETTINGS_KEY}&select=value&limit=1`,
  );
  const held = rows?.[0]?.value as Partial<EngineSettings> | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...held,
    actions: { ...DEFAULT_SETTINGS.actions, ...(held?.actions ?? {}) },
  };
}

export async function saveSettings(
  patch: Partial<EngineSettings>,
): Promise<EngineSettings> {
  const next = { ...(await settings()), ...patch };
  await upsertMerge(
    "cockpit_hiring_meta",
    [{ key: SETTINGS_KEY, value: next, updated_at: new Date().toISOString() }],
    "key",
  );
  return next;
}
