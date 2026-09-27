import { ConvexError } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { rest, type SbRow } from "./ceo/sbWrite";
import { flush, note } from "./health";

/**
 * What the team meetings' server modules share (team.ts, teamCalendar.ts,
 * teamPage.ts): who is asking, the Supabase door with the health ledger,
 * refusals a person can read, the change log, and who may manage a meeting.
 */

// biome-ignore lint/suspicious/noExplicitAny: PostgREST rows
export type Any = Record<string, any>;

export type Who = {
  email: string;
  name: string | null;
  isCeo: boolean;
  isAdmin: boolean;
};

export const enc = encodeURIComponent;

export async function db(
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<SbRow[]> {
  let rows: SbRow[] | null;
  try {
    rows = await rest(path, init);
  } catch (e) {
    note("supabase", false, String(e instanceof Error ? e.message : e));
    throw new Error(
      "The team meetings could not be read from Supabase just now. Try again in a minute.",
    );
  }
  note("supabase", true);
  if (rows === null)
    throw new Error(
      "The team meetings tables are not in Supabase yet (migrations 20260922b and 20260927d).",
    );
  return rows;
}

/**
 * A refusal the screen can read. In production Convex hides the text of an
 * error an action throws ("Server Error"), but not a ConvexError's data, so
 * every sentence written for a person is sent as one. [2026-09-23]
 */
export function plain(e: unknown): ConvexError<{ message: string }> {
  if (e instanceof ConvexError) return e as ConvexError<{ message: string }>;
  const raw = e instanceof Error ? e.message : String(e);
  const message =
    raw
      .replace(/^[\s\S]*?Uncaught Error: /, "")
      .split("\n")[0]
      .trim()
      .slice(0, 300) || "That did not work. Try again in a minute.";
  return new ConvexError({ message });
}

export async function noted<T>(
  ctx: ActionCtx,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw plain(e);
  } finally {
    await flush(ctx);
  }
}

export function clean(s: unknown, max: number): string {
  return String(s ?? "")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, max);
}

export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export async function logChange(
  by: string,
  meetingId: string | null,
  what: string,
  detail?: Any,
): Promise<void> {
  await db("team_changes", {
    method: "POST",
    body: { by_whom: by, meeting_id: meetingId, what, detail: detail ?? null },
    prefer: "return=minimal",
  });
}

/** The person on the roster behind the signed-in address, if there is one. */
export function meOf(people: SbRow[], w: Who): SbRow | null {
  return (
    people.find(p => String(p.email ?? "").toLowerCase() === w.email) ?? null
  );
}

/** The CEO or an admin: prize amounts and prize wheels are theirs. */
export function isBoss(w: Who): boolean {
  return w.isCeo || w.isAdmin;
}

export async function canManage(w: Who, meetingId: string): Promise<boolean> {
  if (isBoss(w)) return true;
  const people = await db(
    `team_people?select=id,email&email=ilike.${enc(w.email)}`,
  );
  const me = people[0];
  if (!me) return false;
  const rows = await db(
    `team_meeting_people?select=part&meeting_id=eq.${enc(meetingId)}&person_id=eq.${enc(me.id)}&removed=eq.false`,
  );
  return rows.some(r => r.part === "host");
}

export async function mustManage(w: Who, meetingId: string): Promise<void> {
  if (!(await canManage(w, meetingId)))
    throw new Error(
      "Only this meeting's hosts, admins and the CEO change who is in it, when it meets and what it is for. Ask a host.",
    );
}

export function mustBeBoss(w: Who, what: string): void {
  if (!isBoss(w)) throw new Error(`Only the CEO and admins ${what}.`);
}

export async function meetingOrRefuse(
  id: string,
  select = "*",
): Promise<SbRow> {
  const [m] = await db(`team_meetings?select=${select}&id=eq.${enc(id)}`);
  if (!m)
    throw new Error(
      "That meeting is not in the list any more. Go back to Team meetings.",
    );
  return m;
}
