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
  /** False until Aziz turns it on. Disarmed, messages are drafted, never sent. */
  armed: boolean;
  /** Which actions may fire at all. */
  actions: Record<Action, boolean>;
  channel: "Email" | "SMS" | "WhatsApp";
  /** Days without a move before a candidate is called stale. */
  staleDays: number;
};

export const SETTINGS_KEY = "engine";

export const DEFAULT_SETTINGS: EngineSettings = {
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
  channel: "Email",
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
