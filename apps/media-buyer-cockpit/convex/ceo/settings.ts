import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { authenticatedAction } from "../functions";
import type { WorkingHours } from "./payloads";
import {
  DEFAULT_WORKING_HOURS,
  describeWorkingHours,
  normalizeWorkingHours,
  WORKING_HOURS_KEY,
  workingHoursFromStored,
} from "./workingHours";

declare const process: { env: Record<string, string | undefined> };

/**
 * Cockpit settings: cockpit_settings in Creative Triage, one row per key with
 * a JSON value, read and written through PostgREST with the service key the
 * way convex/ceo/people.ts does. The first key is working_hours, the clock
 * speed to lead runs on (Aziz, 2026-09-21, item 10).
 *
 * Three doors:
 * - `get` and `setWorkingHours` are the screen's, gated on the CEO, and
 *   every save leaves a ceoAudit row naming the hours before and after.
 * - `workingHoursForAdapters` is a plain function for the section adapters,
 *   which run inside an internal action with no user. It never throws: a
 *   missing table, an unreadable row or a dead connection all come back as
 *   the default hours plus a sentence saying so, so the adapter puts that
 *   sentence beside the number instead of failing the section.
 *
 * The default lives in code (workingHours.ts), so an empty table means
 * "the default", never "no hours".
 */

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TABLE = "cockpit_settings";
const MIGRATION = "supabase/migrations/20260921a_cockpit_settings.sql";

/** A Supabase row; the columns are read by name below. */
type Row = Record<string, any>;

async function rest(
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<Row[] | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
      ...(init.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (res.status === 404 || text.includes("42P01")) return null;
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 220)}`);
  return text ? JSON.parse(text) : [];
}

/** A short error with no URL in it, for a note. */
const brief = (e: unknown) =>
  String(e instanceof Error ? e.message : e)
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 160);

/** A stored value by key, or null when the row or the table is missing. Never throws. */
export async function readSetting(key: string): Promise<unknown | null> {
  try {
    const rows = await rest(
      `${TABLE}?key=eq.${encodeURIComponent(key)}&select=value&limit=1`,
    );
    return rows?.[0]?.value ?? null;
  } catch {
    return null;
  }
}

/** Store a value by key (an upsert), naming who or what wrote it. */
export async function writeSetting(
  key: string,
  value: unknown,
  by: string,
): Promise<void> {
  await rest(`${TABLE}?on_conflict=key`, {
    method: "POST",
    body: [
      { key, value, updated_by: by, updated_at: new Date().toISOString() },
    ],
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}

export type WorkingHoursRead = {
  hours: WorkingHours;
  /** False until the migration has been run. */
  ready: boolean;
  /** Why the default is in force when it should not be, else null. */
  problem: string | null;
};

async function readWorkingHours(): Promise<WorkingHoursRead> {
  try {
    const rows = await rest(
      `${TABLE}?key=eq.${WORKING_HOURS_KEY}&select=key,value,updated_by,updated_at&limit=1`,
    );
    if (rows === null)
      return {
        hours: DEFAULT_WORKING_HOURS,
        ready: false,
        problem: `The cockpit_settings table does not exist yet. Run ${MIGRATION} first.`,
      };
    const row = rows[0];
    if (!row)
      return { hours: DEFAULT_WORKING_HOURS, ready: true, problem: null };
    const at = Date.parse(String(row.updated_at ?? ""));
    const hours = workingHoursFromStored(
      row.value,
      Number.isFinite(at) ? at : null,
    );
    if (!hours)
      return {
        hours: DEFAULT_WORKING_HOURS,
        ready: true,
        problem:
          "The saved working hours could not be read, so the default is in force. Save them again from the Calls tab.",
      };
    return { hours, ready: true, problem: null };
  } catch (e) {
    return {
      hours: DEFAULT_WORKING_HOURS,
      ready: true,
      problem: `Could not read cockpit_settings: ${brief(e)}`,
    };
  }
}

/**
 * For the section adapters: the hours in force, never a throw. Adapters run
 * inside an internal action with no user, so this is not gated; it only
 * reads.
 */
export async function workingHoursForAdapters(): Promise<WorkingHoursRead> {
  return readWorkingHours();
}

/** The working hours for the settings card: saved, or the default. */
export const get = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<WorkingHoursRead> => {
    await ctx.runQuery(internal.ceo.people.gate, { userId: ctx.userId });
    return readWorkingHours();
  },
});

/**
 * Save the working hours: check them, upsert the one row, write the audit
 * row. The sections that use the clock pick the change up on their next
 * refresh, which the card starts.
 */
export const setWorkingHours = authenticatedAction({
  args: {
    start: v.string(),
    end: v.string(),
    /** ISO weekdays, 1 (Monday) to 7 (Sunday). */
    days: v.array(v.number()),
    /** Asia/Kuwait, the only zone for now. */
    timezone: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, a): Promise<{ ok: true; hours: WorkingHours }> => {
    const by: string = await ctx.runQuery(internal.ceo.people.gate, {
      userId: ctx.userId,
    });
    const hours = normalizeWorkingHours(
      { start: a.start, end: a.end, days: a.days, timezone: a.timezone },
      "settings",
    );
    const current = await readWorkingHours();
    if (!current.ready)
      throw new Error(current.problem ?? `Run ${MIGRATION} first.`);

    const value = {
      start: hours.start,
      end: hours.end,
      days: hours.days,
      timezone: hours.timezone,
    };
    const at = Date.now();
    const done = await rest(TABLE, {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=representation",
      body: [
        {
          key: WORKING_HOURS_KEY,
          value,
          updated_by: by,
          updated_at: new Date(at).toISOString(),
        },
      ],
    });
    if (done === null)
      throw new Error(
        `The cockpit_settings table does not exist yet. Run ${MIGRATION} first.`,
      );

    const was = current.hours;
    await ctx.runMutation(internal.ceo.settings.recordWrite, {
      by,
      at,
      what: `Set working hours to ${describeWorkingHours(hours)} (was ${describeWorkingHours(was)}${was.source === "default" ? ", the default" : ""}).`,
      before: {
        start: was.start,
        end: was.end,
        days: was.days,
        timezone: was.timezone,
        source: was.source,
      },
      after: { ...value, source: "settings" },
    });
    return { ok: true, hours: { ...hours, updatedAt: at } };
  },
});

/** The audit row for a settings write, in ceoAudit beside every other CEO write. */
export const recordWrite = internalMutation({
  args: {
    by: v.string(),
    at: v.number(),
    what: v.string(),
    before: v.optional(v.any()),
    after: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, { by, at, what, before, after }) => {
    await ctx.db.insert("ceoAudit", {
      action: "settings.workingHours",
      table: TABLE,
      rowId: WORKING_HOURS_KEY,
      what,
      before,
      after,
      by,
      at,
    });
    return null;
  },
});
