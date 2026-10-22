// Fictional, browser-only EOD and retrospective demo flows. Never imported by App.
import EOD_FIELDS from "./eodFields.json";

function eodDay(now: number) {
  const d = new Date(now - 3600000);
  if (d.getUTCDay() === 5) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

import * as F from "./fixtures";
import { Refused } from "./liveHarness";

type Row = Record<string, unknown>;
const receipts: Row[] = [];
const reports = new Map<string, Row>();
let seeded = false;
export function seedDayReview() {
  if (seeded) return;
  seeded = true;
  const start = new Date(Date.now() - 90 * 60_000).toISOString();
  F.APPOINTMENTS.push(
    ...["intro", "demo", "callback"].map((kind, i) => ({
      appointment_id: `review-${i}`,
      contact_id: `lead-${i + 1}`,
      contact_name: F.LEADS[i]?.name ?? "Sample lead",
      call_type: kind,
      start_at: start,
      booked_at: start,
      assigned_user_id: F.ME.ghl_user_id,
      assigned_user_name: F.ME.name,
      status: i === 2 ? "showed" : "confirmed",
      marked_status: null,
      mark_note: null,
      needs_mark: i !== 2,
    })),
  );
}
export function dayReviewAnswer(b: Row): Row | null {
  const action = String(b.action);
  if (action === "demo.plan")
    return {
      hosts: F.TEAM_ROWS,
      calls: F.APPOINTMENTS.filter(c => c.contact_id === b.contact_id),
      receipts: receipts.filter(r => r.contact_id === b.contact_id),
      mine: F.ME.email,
    };
  if (action === "demo.record") {
    const prior = receipts.find(r => r.id === b.request_id);
    if (prior) {
      prior.state = "recorded";
      return { receipt: prior };
    }
    const r = {
      ...b,
      id: b.request_id,
      source_intro_id: b.intro_id,
      by_email: F.ME.email,
      state: "recorded",
      day: String(b.demo_start).slice(0, 10),
    };
    const host = F.TEAM_ROWS.find(p => p.email === b.host_email)!;
    for (const kind of ["intro", "demo"]) {
      const id = String(b[`${kind}_id`] ?? `recorded-${kind}`),
        old = F.APPOINTMENTS.find(c => c.appointment_id === id);
      if (old) {
        old.status = "showed";
        old.marked_status = "showed";
        continue;
      }
      F.APPOINTMENTS.push({
        appointment_id: id,
        contact_id: b.contact_id,
        contact_name: F.LEADS.find(l => l.contact_id === b.contact_id)?.name,
        call_type: kind,
        start_at: b[`${kind}_start`],
        status: "showed",
        assigned_user_id: host.ghl_user_id,
        assigned_user_name: host.name,
        mark_note: b.note,
      });
    }
    receipts.push(r);
    if (new URLSearchParams(location.search).get("demoSave") === "uncertain") {
      r.state = "uncertain";
      throw new Refused(
        "The answer was lost. Use Check saved demo before trying a new one.",
        409,
      );
    }
    return { receipt: r };
  }
  if (!action.startsWith("eod.")) return null;
  const role = b.role === "setter" ? "setter" : "closer",
    day = String(b.day ?? eodDay(Date.now()));
  const calls = F.APPOINTMENTS.filter(
    c =>
      c.assigned_user_id === F.ME.ghl_user_id &&
      typeof c.start_at === "string" &&
      new Date(Date.parse(c.start_at) + 3 * 3600000)
        .toISOString()
        .slice(0, 10) === day &&
      Date.parse(c.start_at) <= Date.now(),
  );
  const attended = (r: Row) =>
    ["showed", "completed", "invalid"].includes(String(r.status));
  const computed = {
    demos_scheduled: calls.filter(c => c.call_type === "demo").length,
    demos_showed: calls.filter(c => c.call_type === "demo" && attended(c))
      .length,
    no_shows: calls.filter(c => c.status === "noshow").length,
    cancels: calls.filter(c => c.status === "cancelled").length,
    intros_scheduled: calls.filter(c => c.call_type === "intro").length,
    intros_booked: 1,
    intro_shows: calls.filter(c => c.call_type === "intro" && attended(c))
      .length,
    demos_booked: 1,
    closed: 0,
    deals_closed: 0,
    cash: 0,
    contracted: 0,
  };
  const review = {
    calls,
    pending: calls.filter(
      c =>
        !["showed", "completed", "invalid", "noshow", "cancelled"].includes(
          String(c.status),
        ),
    ).length,
    version: JSON.stringify(calls),
    linked: true,
  };
  const key = `${role}:${day}`;
  if (action === "eod.submit") {
    if (review.pending)
      throw new Refused("Review your remaining calls first.", 409);
    reports.set(key, {
      id: "eod-sample",
      email: F.ME.email,
      name: F.ME.name,
      role,
      day,
      answers: b.answers,
      computed,
      submitted_at: new Date().toISOString(),
    });
  }
  const eod = reports.get(key) ?? null;
  return {
    day,
    today: eodDay(Date.now()),
    role,
    roles: ["setter", "closer"],
    name: F.ME.name,
    has_slack_id: true,
    has_ghl: true,
    has_maqsam: false,
    fields: EOD_FIELDS[role],
    computed,
    notes: {},
    prefill: Object.keys(computed),
    review,
    eod,
    outbox: eod ? { status: "queued", attempts: 0 } : null,
  };
}
