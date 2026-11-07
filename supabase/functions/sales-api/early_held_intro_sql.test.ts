// bun test supabase/functions/sales-api/early_held_intro_sql.test.ts
//
// 20261107a_sales_early_held_intro.sql (Did the intro now, 2026-11-07): the
// calendar view and the funnel count "after the intro" from the mark for a
// call marked held more than ten minutes before the time it was marked
// against (only Did the intro now and a video room's join can: the Calls
// card's marks keep the booked start), and the funnel counts a held call as
// due. Read as text, as the other migration checks here do: with the anchor
// and the due rule put back, both are exactly 20261029a's, so nothing else
// about them changed (the same columns in the same order, the same security,
// the same grants). The live check (no row differs today) is in the
// migration's header.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const dir = new URL("../../migrations/", import.meta.url);
const before = readFileSync(new URL("20261029a_sales_call_outcomes.sql", dir), "utf8");
const after = readFileSync(new URL("20261107a_sales_early_held_intro.sql", dir), "utf8");

/** The text from `from` up to and including `to`. */
function cut(src: string, from: string, to: string): string {
  const s = src.indexOf(from);
  if (s < 0) throw new Error(`not found: ${from}`);
  const e = src.indexOf(to, s);
  if (e < 0) throw new Error(`not found after ${from}: ${to}`);
  return src.slice(s, e + to.length);
}

const VIEW_FROM = "create or replace view public.cockpit_sales_calendar";
const VIEW_TO = "on o.appointment_id = a.appointment_id;";
const FN_FROM = "create or replace function public.cockpit_sales_funnel";
const FN_TO = "grant execute on function public.cockpit_sales_funnel(date, date, text) to authenticated, service_role;";
const ANCHOR = "case when d.status = 'showed' and d.marked_at < d.start_at - interval '10 minutes' then d.marked_at";
const DUE = "           -- A call held early (Did the intro now) is due once held.\n           (c.start_at <= now() or c.status = 'showed') as due,";

/** The column names a view's select list gives, in order. */
function columns(view: string): string[] {
  const list = view.slice(view.indexOf("select ") + 7, view.indexOf("\n  from public.cockpit_sales_appointments a"));
  const out: string[] = [];
  let depth = 0;
  let item = "";
  for (const ch of list) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(item);
      item = "";
    } else item += ch;
  }
  out.push(item);
  return out.map(i => {
    const t = i.trim();
    const as = /\sas\s+([a-z_]+)\s*$/i.exec(t);
    return as ? String(as[1]) : String(t.split(".").pop());
  });
}

describe("20261107a: the calendar view", () => {
  const was = cut(before, VIEW_FROM, VIEW_TO);
  const now = cut(after, VIEW_FROM, VIEW_TO);

  test("the same columns in the same order (create or replace view can only keep them)", () => {
    expect(columns(now)).toEqual(columns(was));
    // The live view's columns, read with pg_get_viewdef on 7 Nov 2026.
    expect(columns(now)).toEqual([
      "appointment_id", "contact_id", "contact_name", "calendar_id", "call_type", "start_at", "booked_at",
      "crm_status", "assigned_user_id", "assigned_user_name", "ad_id", "origin", "mirrored_at", "mark_id",
      "marked_status", "mark_reason", "mark_note", "marked_by", "marked_at", "mark_crm", "mark_crm_error",
      "status", "needs_mark", "meet_url", "crm_rescheduled_at", "rescheduled_at", "rescheduled_from",
      "rescheduled_by", "lead_quality", "quality_by", "quality_role", "no_demo_reason", "no_demo_note",
      "outcome_at", "demo_after_at", "signed_after",
    ]);
  });

  test("only demo_after_at and signed_after read the new anchor; with it put back, the view is 20261029a's", () => {
    expect(now).toContain("with (security_invoker = true) as");
    expect(now.match(/k\.after_from - interval '30 minutes'/g)).toHaveLength(3);
    expect(now).toContain(ANCHOR);
    // Only a mark made more than ten minutes before its time moves the anchor.
    expect(now).not.toContain("d.marked_at < a.start_at");
    const lateral = cut(now, "  -- \"After the intro\" starts at the mark", "  ) k\n");
    const back = now.replace(lateral, "").replaceAll("k.after_from - interval", "a.start_at - interval");
    expect(back).toBe(was);
  });

  test("the grants are the live ones: authenticated reads, service_role all, nothing for anon", () => {
    expect(after).toContain("grant select on public.cockpit_sales_calendar to authenticated;");
    expect(after).toContain("grant all on public.cockpit_sales_calendar to service_role;");
    expect(after).not.toMatch(/grant [a-z ,]+ on public\.cockpit_sales_calendar to [a-z_, ]*anon/);
  });
});

describe("20261107a: the funnel", () => {
  const was = cut(before, FN_FROM, FN_TO);
  const now = cut(after, FN_FROM, FN_TO);

  test("still a function with the same signature, security definer, empty search_path and grants", () => {
    expect(now).toContain(
      "create or replace function public.cockpit_sales_funnel(p_from date, p_to date, p_host text default null)\nreturns jsonb language plpgsql stable security definer set search_path = '' as $$",
    );
    expect(now).toContain("revoke all on function public.cockpit_sales_funnel(date, date, text) from public, anon;");
    expect(now).toContain(FN_TO);
    expect(after).not.toMatch(/create or replace view public\.cockpit_sales_funnel/);
  });

  test("only advanced and signed read the new anchor, and due counts a held call; with both put back, the funnel is 20261029a's", () => {
    expect(now.match(/h\.after_from - interval '30 minutes'/g)).toHaveLength(2);
    expect(now).toContain(ANCHOR);
    expect(now).toContain(DUE);
    const back = now
      .replace(
        cut(now, ",\n           -- \"After the intro\" starts at the mark", "else a.start_at end as after_from"),
        "",
      )
      .replaceAll("h.after_from - interval", "h.start_at - interval")
      .replace(DUE, "           c.start_at <= now() as due,")
      .replace("(30 minutes of grace; from the mark for a call marked held more than ten minutes before its time)", "(30 minutes of grace)")
      .replace(" a call marked held counts as due,", "");
    expect(back).toBe(was);
  });

  test("the file is one transaction and reloads PostgREST's schema", () => {
    expect(after.trimEnd().endsWith("notify pgrst, 'reload schema';\ncommit;")).toBe(true);
    expect(after.match(/^begin;$/gm)).toHaveLength(1);
  });
});
