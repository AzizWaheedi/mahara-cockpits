/**
 * The layout harness: the real cockpit, signed in as a made-up manager and
 * fed by src/dev/fixtures.ts instead of Supabase, so every screen can be
 * checked at phone and laptop widths without a sign-in. Open
 * /sales/harness.html?path=/ (any route: /calendar, /lead/lead-5,
 * /call/lead-5?script=demo, /dialer, /numbers …) with `bun run dev`.
 *
 * It answers the cockpit's own requests: PostgREST reads (with the filters
 * the cockpit uses), the whoami call, the proposal file and the sales-api
 * function. Nothing leaves the browser. The real scripts are read from
 * tmp/harness/scripts.json when it exists (gitignored); without it the call
 * screen says the script is not imported. A proposal's document is
 * public/tmp/harness/proposal.html when it exists (a deal from the desk's
 * test fakes, built by proposal-template.html), else a one-line page.
 *
 * The proposal writer's states each have a row: /proposal/p-wait (no model
 * answering), /proposal/p-retry (a failed try, slow), /proposal/p-norec
 * (failed, no recording), /proposal/p-nopdf (ready, no PDF), /proposal/p1
 * (needs figures); Draft proposal on a lead's page queues a new one, and
 * Draft again, Stop drafting and Archive answer as sales-api does.
 *
 * The dialer's side of sales-api keeps state, so the next-lead flow behaves
 * as it does live: a call opens, rings and ends; a saved lead leaves the
 * queue; a save sent again is the same save; HighLevel's slow half shows as
 * saved work. The knobs sit on `window.harness` (change them from the
 * console) and can be set in the address too, e.g.
 * /sales/harness.html?path=/dialer&call=noanswer&timeout=5000
 *
 *   agent    available | absent | busy | switched_off | no_address | not_found
 *   call     answer | noanswer | refuse | slow   (dial.call, then Maqsam's record)
 *   save     ok | slow | fail     (slow: stored at once, answered after 60 s, once)
 *   book     verified | unverified | slow | taken
 *   resync   ok | done | fail
 *   crm      pending | failed     (what a save's HighLevel half does)
 *   hot      ok | fail       (hot.save refuses every change: a cell's failed state)
 *   desk     ok | waiting | late   (the proposal writer's health line)
 *   wait     ms every sales-api answer takes (250)
 *   queueWait  ms dial.queue takes; it reads when asked and answers late,
 *            as a slow server does (0: the same as wait)
 *   gap      ms the server wants between two calls (12000)
 *   timeout  ms the cockpit waits for an answer (45000)
 *
 * `window.harnessLog` lists every sales-api call the page made (action,
 * body, when), to count what a double tap sent.
 *
 * Live calls and waves have knobs of their own (src/dev/liveHarness.ts):
 *
 *   room     a video room to start on, for the lead on screen: making |
 *            ready | sent | not_sent | not_sent_zoom | not_confirmed |
 *            opened | waiting | host_in | joined | joined_marked |
 *            joined_not_lead | still_on_call | expired | failed |
 *            failed_handover | down | pending_zoom | booked
 *   offer    the banner: incoming | taken | lost | missed | expired |
 *            refresh | standby | making | standby_failed | away |
 *            available | ready | booked | on_call | down | live_off
 *   rooms    on | test | off   (on here, so the buttons show)
 *   live     on | off          (off, as it ships)
 *   auto     1                 automatic mode after a missed call
 *   create   ok | refused | failed
 *   waves    running | paused | none | off   (the Follow-ups page)
 *   reply    1                 P3's reply alert in the banner
 *   handover 1                 a stand-in for P2's handover strip
 *
 * And the failures every live-call screen must survive:
 *
 *   net      down | drop       sales-api unreachable (drop: after 6 s,
 *                              so "Not updated since" shows)
 *   answer   garbage           sales-api answers 200 with nonsense
 *   auth     expired | 401     no session at all, or sales-api says "Sign
 *                              in again." with a 401
 *   reads    fail | hang       every table read fails, or never answers
 *
 * e.g. /sales/harness.html?path=/dialer&room=sent,
 * /sales/harness.html?path=/dialer&call=noanswer&auto=1,
 * /sales/harness.html?path=/lead/lead-1&room=waiting&offer=incoming,
 * /sales/harness.html?path=/followups&waves=running
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import "../index.css";
import * as F from "./fixtures";
import {
  answerWaves,
  hostRows,
  Refused as LiveRefused,
  liveKnobs,
  liveSettings,
  RoomStage,
  roomStatusRows,
  waveTables,
} from "./liveHarness";

// The Supabase client keeps the fetch it was created with, so the stand-in
// below is installed before the client module is loaded (dynamic imports
// further down), never after.
const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL ?? "");

type Row = Record<string, unknown>;

const knobs = {
  agent: "available",
  call: "answer",
  save: "ok",
  book: "verified",
  resync: "ok",
  crm: "pending",
  hot: "ok",
  desk: "ok",
  wait: 250,
  queueWait: 0,
  gap: 12_000,
  timeout: 45_000,
};
const log: { at: number; action: string; body: Row }[] = [];
(window as unknown as { harnessLog: typeof log }).harnessLog = log;
const params = new URLSearchParams(window.location.search);
for (const k of Object.keys(knobs) as (keyof typeof knobs)[]) {
  const v = params.get(k);
  if (v === null) continue;
  (knobs as Record<string, unknown>)[k] =
    typeof knobs[k] === "number" ? Number(v) : v;
}
(window as unknown as { harness: typeof knobs }).harness = knobs;

// Live calls and waves: the room for the lead on screen (the lead page's
// lead, else the dialer's first), the seat's presence, and the waves.
const live = liveKnobs(params);
const startPath = params.get("path") ?? "/";
const roomLead =
  /^\/lead\/([^/?#]+)/.exec(startPath)?.[1] ??
  String(F.dialItems("setter", Date.now())[0]?.contact_id ?? "lead-1");
const stage = new RoomStage(live, Date.now(), roomLead);
const waves = waveTables(
  live.waves,
  Date.now(),
  F.LEADS as { contact_id: string }[],
);
(window as unknown as { harnessRooms: RoomStage }).harnessRooms = stage;

/**
 * A lead comes in (or back) at the top of the queue, as a new lead does
 * live: `harnessArrive(22)` from the console, or with fields of its own,
 * `harnessArrive(7, { why: "Wrote back minutes ago", inbound_at: … })`.
 */
(
  window as unknown as { harnessArrive: (i: number, over?: Row) => void }
).harnessArrive = (i, over = {}) => {
  const id = String(F.LEADS[i]?.contact_id ?? "");
  if (!id) return;
  dial.gone.delete(id);
  dial.arrivals.delete(id);
  dial.arrivals.set(id, {
    tier: 0,
    why: "New lead, call now",
    created_at: new Date().toISOString(),
    ...over,
  });
};

/** Wait, unless the cockpit gives up first (its timeout aborts the fetch). */
function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted)
      return reject(new DOMException("The wait was cut short", "AbortError"));
    const t = window.setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(t);
      reject(new DOMException("The wait was cut short", "AbortError"));
    });
  });
}

class Refusal extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// The dialer's state, as sales-api keeps it in cockpit_sales_attempts
// ---------------------------------------------------------------------------

interface Attempt extends Row {
  id: string;
  contact_id: string;
  state: string;
  started_at: string;
  error: string | null;
  outcome: string | null;
  note: string | null;
  saved_at: string | null;
  auto_saved: boolean;
  manual: boolean;
  request_id: string | null;
  item_kind: string;
  /** How Maqsam's record goes for this call (knobs.call when it was placed). */
  plan: string;
  counted: boolean;
}

const START = Date.now();
const MIN = 60_000;
const NEEDS_NOTE = [
  "callback",
  "not_interested",
  "disqualified",
  "wrong_number",
  "handled",
  "showed",
  "cancelled",
  "booked",
];
const dial = {
  seq: 0,
  attempts: new Map<string, Attempt>(),
  lastCallAt: 0,
  /** Leads that left the queue after a save, until when. */
  gone: new Map<string, number>(),
  /** Bookings made here, so a second one is refused as HighLevel's would be. */
  booked: new Map<string, { kind: string; start: string }>(),
  savedWork: F.savedWork(START),
  /** Leads that came in (or came back) while the page is open, first in line. */
  arrivals: new Map<string, Row>(),
  slowUsed: { save: false, book: false },
  today: {
    saved: 23,
    calls: 19,
    answered: 7,
    unmatched: 1,
    talk_s: 1830,
    booked: 2,
    auto_no_answer: 6,
  },
};

const openCall = () =>
  [...dial.attempts.values()].find(a =>
    ["dialing", "placed"].includes(a.state),
  ) ?? null;

const leadOf = (id: string) => F.LEADS.find(l => l.contact_id === id) ?? null;

const kuwaitWords = (s: string) =>
  `${new Date(s).toLocaleDateString("en-GB", { timeZone: "Asia/Kuwait", weekday: "short", day: "numeric", month: "short" })}, ${new Date(s).toLocaleTimeString("en-GB", { timeZone: "Asia/Kuwait", hour: "2-digit", minute: "2-digit" })}`;

/** Where a saved lead goes: most leave the queue; an intro nobody answered stays for its twenty minutes. */
function leave(contactId: string, kind: string, outcome: string) {
  if (kind === "intro" && outcome === "no_answer") return;
  dial.gone.set(
    contactId,
    Date.now() +
      (kind === "confirm" && outcome === "no_answer"
        ? 2 * 60 * MIN
        : 24 * 60 * MIN),
  );
}

function saveAttempt(a: Attempt, b: Row, auto = false) {
  a.state = "saved";
  a.outcome = String(b.outcome);
  a.note = String(b.note ?? "") || null;
  a.saved_at = new Date().toISOString();
  a.auto_saved = auto;
  a.item_kind = String(b.item_kind ?? a.item_kind ?? "lead");
  dial.today.saved += 1;
  if (auto) dial.today.auto_no_answer += 1;
  leave(a.contact_id, a.item_kind, a.outcome);
  // HighLevel's half runs after the answer: its note, tags and stage move.
  const crm = a.outcome === "no_answer" && !a.note ? "skipped" : "pending";
  if (crm === "pending" && knobs.crm === "failed" && !auto)
    dial.savedWork.unshift({
      attempt_id: a.id,
      contact_id: a.contact_id,
      name: leadOf(a.contact_id)?.name ?? null,
      outcome: a.outcome,
      saved_at: a.saved_at,
      crm_note: "failed",
      error: "HighLevel said 429: too many requests",
    });
  return {
    attempt: { ...a, crm_note: auto ? "skipped" : crm },
    state: { contact_id: a.contact_id, last_outcome: a.outcome },
    stage_move: auto || a.outcome === "no_answer" ? null : { state: "pending" },
  };
}

function newAttempt(contactId: string, over: Partial<Attempt>): Attempt {
  const a: Attempt = {
    id: `att-${++dial.seq}`,
    contact_id: contactId,
    state: "dialing",
    started_at: new Date().toISOString(),
    error: null,
    outcome: null,
    note: null,
    saved_at: null,
    auto_saved: false,
    manual: false,
    request_id: null,
    item_kind: "lead",
    plan: knobs.call,
    counted: false,
    ...over,
  };
  dial.attempts.set(a.id, a);
  return a;
}

/** Whose appointment this is, from what the queue holds. */
function contactOfAppointment(id: string): string {
  const all = [
    ...dial.arrivals.values(),
    ...F.dialItems("setter", START),
    ...F.dialItems("closer", START),
  ];
  const hit = all.find(
    i => (i.appointment as { id?: string } | null)?.id === id,
  );
  if (hit?.contact_id) return String(hit.contact_id);
  for (const [cid, over] of dial.arrivals)
    if ((over.appointment as { id?: string } | null)?.id === id) return cid;
  return "";
}

/** The queue as it stands now: a copy, so a late answer shows the moment it was read. */
function queue(as: "setter" | "closer") {
  const now = Date.now();
  // The newest arrival first, as the queue puts the freshest lead on top.
  const came = [...dial.arrivals.entries()].reverse().map(([id, over]) =>
    F.queueItem(
      F.LEADS.findIndex(l => l.contact_id === id),
      over,
    ),
  );
  const ids = new Set(came.map(i => i.contact_id));
  const items = [
    ...came,
    ...F.dialItems(as, START).filter(i => !ids.has(i.contact_id)),
  ].filter(i => (dial.gone.get(String(i.contact_id)) ?? 0) < now);
  const counts = [0, 1, 2, 3].map(t => items.filter(i => i.tier === t).length);
  const open = openCall();
  return {
    as,
    counts,
    undialable: { no_phone: 2, other: 1 },
    saved_work: dial.savedWork.map(w => ({ ...w })),
    open: open ? { ...open } : null,
    today: {
      ...dial.today,
      line: {
        calls: dial.today.calls + 5,
        answered: dial.today.answered + 2,
        talk_s: dial.today.talk_s + 380,
        last_at: null,
      },
    },
    queue: items,
  };
}

// ---------------------------------------------------------------------------
// The hot list, as sales-api hot.save keeps it: only the fields sent change,
// each checked with the server's words (supabase/functions/sales-api/hot.ts).
// ---------------------------------------------------------------------------

const HOT_FIELDS = [
  "heat",
  "status",
  "amount",
  "amount_currency",
  "last_objection",
  "note",
  "next_at",
  "next_how",
  "last_fu_at",
  "owner_email",
];

function hotSave(b: Row, now: number): Row {
  const id = String(b.contact_id ?? "");
  if (!leadOf(id)) throw new Refusal("That lead is not in the cockpit.", 404);
  if (knobs.hot === "fail")
    throw new Refusal(
      "The database did not answer (harness knob hot=fail). Try again.",
      503,
    );
  const patch: Row = {};
  for (const k of HOT_FIELDS)
    if (k in b && b[k] !== undefined)
      patch[k] = typeof b[k] === "string" && !String(b[k]).trim() ? null : b[k];
  if (patch.heat && !["red_hot", "hot", "warm"].includes(String(patch.heat)))
    throw new Refusal("The type is red hot, hot or warm.");
  if (
    "status" in patch &&
    !["nurturing", "closed", "lost"].includes(String(patch.status))
  )
    throw new Refusal("The status is nurturing, closed or lost.");
  if (patch.amount !== null && patch.amount !== undefined) {
    const n = Number(String(patch.amount).replace(/[,\s]/g, ""));
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000)
      throw new Refusal("The amount is a number from 0 to 10,000,000.");
    patch.amount = Math.round(n * 100) / 100;
  }
  if (
    "amount_currency" in patch &&
    !["USD", "KWD", "SAR", "AED", "QAR", "BHD", "OMR"].includes(
      String(patch.amount_currency ?? "").toUpperCase(),
    )
  )
    throw new Refusal("Amounts are in USD, KWD, SAR, AED, QAR, BHD or OMR.");
  if (patch.next_at) {
    const t = Date.parse(String(patch.next_at));
    if (
      !Number.isFinite(t) ||
      t < now - 86_400_000 ||
      t > now + 366 * 86_400_000
    )
      throw new Refusal(
        "Pick a next follow-up from yesterday up to a year ahead.",
      );
    patch.next_at = new Date(t).toISOString();
  }
  if (patch.last_fu_at) {
    const t = Date.parse(String(patch.last_fu_at));
    if (!Number.isFinite(t))
      throw new Refusal("Pick when you last followed up.");
    if (t > now + 5 * MIN)
      throw new Refusal("The last follow-up cannot be in the future.");
    patch.last_fu_at = new Date(t).toISOString();
  }
  const at = new Date(now).toISOString();
  const i = F.HOT.findIndex(h => h.contact_id === id);
  const live = i >= 0 && !F.HOT[i].removed_at ? F.HOT[i] : null;
  const row = live
    ? { ...live, ...patch, updated_at: at }
    : { ...F.hotFresh(id, F.ME.email, at), ...patch };
  if (i >= 0) F.HOT[i] = row;
  else F.HOT.push(row);
  return { hot: { ...row } };
}

async function salesApi(b: Row, signal?: AbortSignal | null): Promise<Row> {
  log.push({ at: Date.now(), action: String(b.action), body: b });
  if (b.action === "dial.queue") {
    const read = queue(b.as === "closer" ? "closer" : "setter");
    await sleep(knobs.queueWait || knobs.wait, signal);
    return read;
  }
  await sleep(knobs.wait, signal);
  const now = Date.now();
  // Video rooms, live calls and waves keep their own state.
  const rooms = stage.answer(String(b.action), b, now);
  if (rooms) return rooms;
  const wave = answerWaves(String(b.action), b, waves, now);
  if (wave) return wave;
  switch (b.action) {
    case "dial.agent": {
      const state = knobs.agent;
      return {
        email: state === "no_address" ? null : "aziz@maharamedia.com",
        from: state === "no_address" ? null : "seat",
        ready: state === "available",
        state,
      };
    }
    case "dial.call": {
      const contact = String(b.contact_id ?? "");
      if (knobs.agent === "no_address")
        throw new Refusal(
          "Your seat has no Maqsam address yet. Ask Aziz to add it on the Team page.",
          409,
        );
      const lead = leadOf(contact);
      if (!lead) throw new Refusal("That lead is not in the cockpit.", 404);
      if (lead.dnd)
        throw new Refusal(
          "This lead asked not to be contacted (do not disturb is on in HighLevel).",
          409,
        );
      if (now - dial.lastCallAt < knobs.gap)
        throw new Refusal(
          "Give it a few seconds between calls, then call again.",
          429,
        );
      if (knobs.agent === "not_found")
        throw new Refusal(
          "No Maqsam seat has the address aziz@maharamedia.com. Ask Aziz to add it on the Team page or in Maqsam.",
          409,
        );
      if (knobs.agent === "switched_off" || knobs.agent === "no_outgoing")
        throw new Refusal(
          "Your Maqsam seat is switched off or cannot call out. Ask Aziz to turn it on.",
          409,
        );
      if (knobs.agent !== "available")
        throw new Refusal(
          "Open the Maqsam softphone and set yourself Available, then call again.",
          409,
        );
      if (openCall())
        throw new Refusal(
          "You already have a call open. Save how it went, or skip it, first.",
          409,
        );
      const a = newAttempt(contact, {
        item_kind: String(b.item_kind ?? "lead"),
      });
      dial.lastCallAt = now;
      if (knobs.call === "refuse") {
        a.state = "failed";
        a.error = 'Maqsam did not accept the call: {"message":"agent is busy"}';
        throw new Refusal(`The call did not go through: ${a.error}`, 502);
      }
      a.state = "placed";
      dial.today.calls += 1;
      if (knobs.call === "slow") await sleep(60_000, signal);
      return {
        attempt: a,
        route: { country: "Saudi Arabia", caller: "966115203895" },
      };
    }
    case "dial.status": {
      const a = dial.attempts.get(String(b.attempt_id));
      if (!a) throw new Refusal("That call is not there any more.", 404);
      const since = now - Date.parse(a.started_at);
      if (a.state !== "placed")
        return {
          attempt: a,
          call:
            a.plan === "noanswer"
              ? { final: true, answered: false, seconds: 0, words: "No answer" }
              : null,
          auto_saved: false,
        };
      if (a.plan === "noanswer") {
        if (since < 7000) return { attempt: a, call: null, auto_saved: false };
        const out = saveAttempt(
          a,
          {
            outcome: "no_answer",
            note: `No answer: Maqsam's record of the call (mq-${a.id}) shows nobody picked up.`,
            item_kind: a.item_kind,
          },
          true,
        );
        return {
          attempt: out.attempt,
          state: out.state,
          call: {
            final: true,
            answered: false,
            seconds: 0,
            words: "No answer",
          },
          auto_saved: true,
        };
      }
      if (since < 5000) return { attempt: a, call: null, auto_saved: false };
      if (since < 12_000)
        return {
          attempt: a,
          call: {
            final: false,
            answered: false,
            seconds: 0,
            words: "In progress",
          },
          auto_saved: false,
        };
      if (!a.counted) {
        a.counted = true;
        dial.today.answered += 1;
        dial.today.talk_s += 94;
      }
      return {
        attempt: a,
        call: { final: true, answered: true, seconds: 94, words: "Answered" },
        auto_saved: false,
      };
    }
    case "dial.save": {
      const outcome = String(b.outcome ?? "");
      const note = String(b.note ?? "").trim();
      if (!outcome) throw new Refusal("Choose how the call went.");
      if (NEEDS_NOTE.includes(outcome) && note.length < 3)
        throw new Refusal(
          "Write a line on what happened, so the next person knows.",
        );
      if (outcome === "callback") {
        const at = Date.parse(String(b.callback_at ?? ""));
        if (
          !Number.isFinite(at) ||
          at < now - MIN ||
          at > now + 30 * 86_400_000
        )
          throw new Refusal("Pick when to call back, within the next 30 days.");
      }
      if (knobs.save === "fail")
        throw new Refusal(
          "The save did not go through: the database did not answer. Try again.",
          500,
        );
      let a: Attempt | null = null;
      if (b.attempt_id) {
        a = dial.attempts.get(String(b.attempt_id)) ?? null;
        if (!a) throw new Refusal("That call is not there any more.", 404);
        if (a.state === "saved" && a.outcome === outcome)
          return { attempt: a, repeated: true };
        if (!["dialing", "placed", "failed", "released"].includes(a.state))
          throw new Refusal("This call was already saved.", 409);
      } else {
        const contact = String(b.contact_id ?? "");
        const rid = String(b.request_id ?? "");
        const twin = [...dial.attempts.values()].find(
          x => rid && x.request_id === rid,
        );
        if (twin) return { attempt: twin, repeated: true };
        const open = openCall();
        if (open && open.contact_id === contact) a = open;
        else if (open)
          throw new Refusal(
            "You have a call open with another lead. Save or skip it first.",
            409,
          );
        else
          a = newAttempt(contact, {
            manual: true,
            request_id: rid || null,
            item_kind: String(b.item_kind ?? "lead"),
          });
      }
      const out = saveAttempt(a, b);
      if (knobs.save === "slow" && !dial.slowUsed.save) {
        dial.slowUsed.save = true;
        await sleep(60_000, signal);
      }
      return out;
    }
    case "dial.release": {
      const a = dial.attempts.get(String(b.attempt_id));
      if (!a) throw new Refusal("That call is not there any more.", 404);
      if (["dialing", "placed", "failed"].includes(a.state))
        a.state = "released";
      return {};
    }
    case "dial.resync": {
      const id = String(b.attempt_id);
      const i = dial.savedWork.findIndex(w => w.attempt_id === id);
      if (i < 0) throw new Refusal("That save is not there any more.", 404);
      if (knobs.resync === "fail")
        throw new Refusal(
          "HighLevel did not take it this time either. Try again in a few minutes.",
          502,
        );
      dial.savedWork.splice(i, 1);
      if (knobs.resync === "done")
        throw new Refusal("It is already in HighLevel.", 409);
      return { attempt: { id, crm_note: "written" } };
    }
    case "book.slots": {
      const days = [1, 2, 3].map(d => {
        const day = new Date(now + d * 86_400_000 + 3 * 3_600_000)
          .toISOString()
          .slice(0, 10);
        const slots: string[] = [];
        for (let m = 600; m <= 1060; m += 20)
          slots.push(
            `${day}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00+03:00`,
          );
        return { day, slots };
      });
      const kind = b.appointment_id ? "intro" : String(b.kind ?? "intro");
      const had = dial.booked.get(String(b.contact_id ?? ""));
      return {
        kind,
        calendar_id: "cal",
        calendar: kind === "demo" ? "Demo" : "Intro",
        minutes: kind === "demo" ? 45 : 15,
        with: b.with ?? "me",
        fallback: false,
        on_team: true,
        notice:
          "An intro can be booked from 2 hours ahead, up to 3 days out, as the HighLevel calendar allows.",
        existing:
          had && had.kind === kind
            ? { id: "bk-1", start: had.start, words: kuwaitWords(had.start) }
            : null,
        ...(b.appointment_id
          ? {
              moving: {
                id: String(b.appointment_id),
                start: new Date(now + 2 * 3_600_000).toISOString(),
                words: kuwaitWords(new Date(now + 2 * 3_600_000).toISOString()),
              },
            }
          : {}),
        days,
      };
    }
    case "book.create":
    case "book.move": {
      const moving = b.action === "book.move";
      // A move names the appointment; its lead is the one it belongs to.
      const contact = moving
        ? contactOfAppointment(String(b.appointment_id ?? ""))
        : String(b.contact_id ?? "");
      const note = String(b.note ?? "").trim();
      if (note.length < 3)
        throw new Refusal(
          "Write a line on the call, so whoever takes it knows what was said.",
        );
      if (knobs.book === "taken")
        throw new Refusal("That time was just taken. Pick another.", 409);
      const had = dial.booked.get(contact);
      const kind = String(b.kind ?? "intro");
      if (!moving && had && had.kind === kind)
        throw new Refusal(
          `They already have ${kind === "intro" ? "an intro" : "a demo"} on ${kuwaitWords(had.start)} (Kuwait time). Move that one in HighLevel instead of booking a second.`,
          409,
        );
      const start = String(b.start);
      if (!moving) dial.booked.set(contact, { kind, start });
      const a = b.attempt_id ? dial.attempts.get(String(b.attempt_id)) : null;
      if (a)
        saveAttempt(a, {
          outcome: moving ? "rescheduled" : "booked",
          note,
          item_kind: b.item_kind ?? "lead",
        });
      else {
        dial.today.saved += 1;
        leave(contact || "", "lead", "booked");
      }
      if (!moving) dial.today.booked += 1;
      if (knobs.book === "slow" && !dial.slowUsed.book) {
        dial.slowUsed.book = true;
        await sleep(60_000, signal);
      }
      const words = `${moving ? "Moved to" : kind === "demo" ? "Demo booked for" : "Intro booked for"} ${kuwaitWords(start)} (Kuwait time)`;
      return { verified: knobs.book !== "unverified", words };
    }
    case "convo.read":
      return F.conversation(String(b.contact_id), now);
    case "convo.send":
      return {
        message: {
          id: `msg-${now}`,
          channel: b.channel,
          state: "sent",
          sent_by: "aziz@maharamedia.com",
          source: "cockpit",
          ghl_message_id: null,
          error: null,
          created_at: new Date(now).toISOString(),
        },
      };
    case "lead.live":
      return {
        live: {
          contact: { tags: [], dnd: false, assigned_to: "u-sara" },
          contact_error: null,
          conversations: [
            {
              id: "c1",
              type: "TYPE_PHONE",
              unread: 1,
              inbound_whatsapp_at: new Date(now - 2 * 3_600_000).toISOString(),
            },
          ],
          conversations_error: null,
          messages: [
            {
              id: "m1",
              direction: "outbound",
              type: "TYPE_WHATSAPP",
              status: "read",
              at: new Date(now - 5 * 3_600_000).toISOString(),
              body: "هلا! تأكيد مكالمتنا بكرة الساعة ٦ مساءً.",
              has_attachments: false,
              source: "workflow",
            },
            {
              id: "m2",
              direction: "inbound",
              type: "TYPE_WHATSAPP",
              status: "delivered",
              at: new Date(now - 2 * 3_600_000).toISOString(),
              body: "تمام، موجود.",
              has_attachments: false,
              source: null,
            },
          ],
          messages_error: null,
          read_at: new Date(now).toISOString(),
        },
      };
    case "contract.refresh":
      return { checked: 0 };
    case "contract.create": {
      const setup = F.SETTINGS.find(x => x.key === "contracts")?.value as
        | { templates: { id: string; name: string }[] }
        | undefined;
      const t = setup?.templates.find(
        x => x.id === String(b.template_id ?? ""),
      );
      if (!t) throw new Refusal("Pick one of the main contract templates.");
      const row = {
        document_id: `doc-${now}`,
        contact_id: String(b.contact_id ?? ""),
        template_id: t.id,
        template_name: t.name,
        name: t.name,
        status: "draft",
        fields: {
          company_name: String(b.company_name ?? ""),
          ...(b.payment_structure
            ? { payment_structure: String(b.payment_structure) }
            : {}),
          ...(b.daily_ad_spend
            ? { daily_ad_spend: Number(b.daily_ad_spend) }
            : {}),
        },
        created_by: "aziz@maharamedia.com",
        sent_by: null,
        sent_via: null,
        sent_at: null,
        viewed_at: null,
        signed_at: null,
        revision: 1,
        ghl_updated_at: null,
        created_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
        checked_at: new Date(now).toISOString(),
      };
      F.CONTRACTS.unshift(row);
      return { contract: row };
    }
    case "contract.send": {
      const i = F.CONTRACTS.findIndex(
        c => c.document_id === String(b.document_id ?? ""),
      );
      if (i < 0) throw new Refusal("That contract is not here.", 404);
      const company = String(
        (F.CONTRACTS[i].fields as { company_name?: string }).company_name ?? "",
      );
      F.CONTRACTS[i] = {
        ...F.CONTRACTS[i],
        name: /[\u0600-\u06ff]/.test(company)
          ? `${company} X مهارة ميديا`
          : `${company} X Mahara Media`,
        status: "sent",
        sent_at: new Date(now).toISOString(),
        sent_by: "aziz@maharamedia.com",
        sent_via: b.via,
      };
      return {
        contract: F.CONTRACTS[i],
        link:
          b.via === "link"
            ? "https://link.maharamedia.com/documents/v1/demo-link"
            : null,
      };
    }
    case "contract.link":
      return { link: "https://link.maharamedia.com/documents/v1/demo-link" };
    case "contract.templates":
      return {
        templates: [
          { id: "6905c43fc69d72f15bd69206", name: "90 Day Agreement" },
          { id: "69d25fce5d2b0f67fa21caab", name: "90 Day Agreement No G" },
          { id: "6995853c5831c3bd20e03db7", name: "60 Day Agreement" },
          { id: "6905c5456709f1453919ac3c", name: "Month To Month Agreement" },
          { id: "6a4cf9b8da68ef6b3d32c92c", name: "Special Offer" },
          { id: "6a8fb2fd5a4408090a5cf2f6", name: "CSM Contract" },
        ],
      };
    case "contract.templates.save":
      return { templates: b.templates };
    case "hot.save":
      return hotSave(b, now);
    case "hot.remove": {
      const i = F.HOT.findIndex(
        h => h.contact_id === String(b.contact_id ?? "") && !h.removed_at,
      );
      if (i < 0) throw new Refusal("This lead is not on the hot list.", 404);
      F.HOT[i] = {
        ...F.HOT[i],
        removed_at: new Date(now).toISOString(),
        removed_why: String(b.why ?? "") || null,
      };
      return {};
    }
    case "proposal.draft": {
      const id = `p-new-${now}`;
      const contact = String(b.contact_id ?? "");
      const lang = b.lang === "en" ? "en" : "ar";
      F.REQUESTS.unshift({
        id: `q-${id}`,
        kind: "proposal",
        contact_id: contact,
        appointment_id: b.appointment_id ?? null,
        params: { proposal_id: id, lang, offer: b.offer ?? null },
        status: "queued",
        requested_by: F.ME.email,
        requested_at: new Date(now).toISOString(),
        claimed_at: null,
        attempts: 0,
        finished_at: null,
        error: null,
        result: null,
      });
      const row = {
        id,
        request_id: `q-${id}`,
        contact_id: contact,
        appointment_id: b.appointment_id ?? null,
        recording_id: b.recording_id ?? null,
        lang,
        variant: null,
        status: "drafting",
        deal: null,
        validation: null,
        fill_count: null,
        html_path: null,
        pdf_path: null,
        model: null,
        created_by: F.ME.email,
        created_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
        sent_at: null,
        sent_by: null,
        error: null,
      };
      F.PROPOSALS.unshift(row);
      return { proposal: row };
    }
    case "proposal.retry": {
      // Draft again: a new request on the same proposal, as sales-api does.
      const p = F.PROPOSALS.find(x => x.id === String(b.id ?? ""));
      if (!p) throw new Refusal("That proposal is not there any more.", 404);
      if (!["failed", "needs_input", "ready"].includes(String(p.status)))
        throw new Refusal("This proposal is already being written.");
      const rid = `q-${p.id}-${now}`;
      F.REQUESTS.unshift({
        id: rid,
        kind: "proposal",
        contact_id: p.contact_id,
        appointment_id: p.appointment_id ?? null,
        params: { proposal_id: p.id, lang: p.lang },
        status: "queued",
        requested_by: F.ME.email,
        requested_at: new Date(now).toISOString(),
        claimed_at: null,
        attempts: 0,
        finished_at: null,
        error: null,
        result: null,
      });
      Object.assign(p, {
        status: "drafting",
        request_id: rid,
        error: null,
        updated_at: new Date(now).toISOString(),
      });
      return { proposal: p };
    }
    case "request.set": {
      // Stop drafting: sales-api cancels a queued request and archives a
      // first draft (a retry or rebuild goes back to its last version).
      const r = F.REQUESTS.find(x => x.id === String(b.id ?? ""));
      if (!r) throw new Refusal("That request is not there any more.", 404);
      if (r.status === "running")
        throw new Refusal(
          "It is being written right now, so it cannot be stopped. Wait for it to finish.",
          409,
        );
      if (r.status !== "queued")
        throw new Refusal(
          "Only a request that has not started can be cancelled.",
        );
      r.status = "cancelled";
      r.finished_at = new Date(now).toISOString();
      const pid = String((r.params as Row | null)?.proposal_id ?? "");
      const p = F.PROPOSALS.find(x => x.id === pid);
      if (p) {
        const before = String((p.validation as Row | null)?.status ?? "");
        p.status =
          p.html_path && ["needs_input", "ready", "failed"].includes(before)
            ? before
            : "archived";
      }
      return {
        request: r,
        proposal: p ? { id: pid, status: p.status } : null,
      };
    }
    case "proposal.set": {
      const p = F.PROPOSALS.find(x => x.id === String(b.id ?? ""));
      if (!p) throw new Refusal("That proposal is not there any more.", 404);
      const open = F.REQUESTS.filter(
        r =>
          (r.params as Row | null)?.proposal_id === p.id &&
          (r.status === "queued" || r.status === "running"),
      );
      if (b.status === "archived" && open.some(r => r.status === "running"))
        throw new Refusal(
          "It is being written right now. Archive it when it finishes.",
          409,
        );
      if (b.status === "archived") for (const r of open) r.status = "cancelled";
      p.status = String(b.status);
      return { proposal: p };
    }
    case "ghl.users":
      return {
        users: [
          { id: "u-sara", name: "Sara Khalil", email: "sara@example.com" },
          { id: "u-omar", name: "Omar Haddad", email: "omar@example.com" },
        ],
      };
    default:
      return {
        mark: { crm: "written", crm_error: null, status: b.status },
      };
  }
}

async function main() {
  let scripts: Record<string, Row> = {};
  try {
    const res = await fetch("/sales/tmp/harness/scripts.json");
    if (res.ok) scripts = await res.json();
  } catch {
    // no scripts staged
  }
  let proposalPage =
    "<!doctype html><html dir='rtl'><body style='font-family:system-ui;padding:40px'><h1>مقترح شراكة</h1><p>مشاريعكم القادمة FILL</p></body></html>";
  try {
    const res = await fetch("/sales/tmp/harness/proposal.html");
    const text = res.ok ? await res.text() : "";
    // Vite answers a missing file with the app's own page.
    if (text.includes("proposal") && !text.includes("/src/main.tsx"))
      proposalPage = text;
  } catch {
    // no document staged
  }

  const tables: Record<string, Row[]> = {
    cockpit_sales_leads: F.LEADS,
    cockpit_sales_calendar: F.APPOINTMENTS,
    cockpit_sales_dials: [...F.DIALS, ...F.HOT_DIALS],
    cockpit_sales_deals: F.DEALS,
    cockpit_sales_notes: [],
    cockpit_sales_proposals: F.PROPOSALS,
    cockpit_sales_requests: F.REQUESTS,
    cockpit_sales_recordings: F.RECORDINGS,
    cockpit_sales_client_forms: [],
    cockpit_sales_scorecards: F.scorecards(),
    cockpit_sales_board: F.board(),
    cockpit_sales_people: F.PEOPLE,
    cockpit_sales_team: F.TEAM_ROWS,
    cockpit_sales_reps: F.REPS,
    cockpit_sales_links: F.LINKS,
    cockpit_sales_settings: [
      ...F.SETTINGS.filter(
        r =>
          !["rooms", "live", "whatsapp_guard", "followups"].includes(
            String(r.key),
          ),
      ),
      ...liveSettings(live, roomLead),
    ],
    cockpit_sales_mirror_runs: [F.MIRROR_RUN],
    // The desk's requests job (knobs.desk) beside the room worker's jobs.
    cockpit_sales_worker_status: [
      ...F.workerStatus(knobs.desk),
      ...roomStatusRows(Date.now()),
    ],
    cockpit_sales_room_hosts: hostRows(
      Date.now(),
      F.PEOPLE.map(p => String(p.email)),
    ),
    cockpit_sales_followup_waves: waves.waves,
    cockpit_sales_followup_wave_members: waves.members,
    cockpit_sales_followup_meta: waves.meta,
    cockpit_sales_inbox: [...F.INBOX, ...F.HOT_INBOX],
    cockpit_sales_followups: [...F.FOLLOWUPS, ...waves.openers],
    cockpit_sales_contracts: F.CONTRACTS,
    cockpit_sales_hot: F.HOT,
    cockpit_sales_messages: F.MESSAGES,
    cockpit_sales_snippets: F.SNIPPETS,
    cockpit_sales_wa_templates: F.WA_TEMPLATES,
    cockpit_sales_scripts: Object.values(scripts).map((doc, i) => ({
      id: `s${i}`,
      key: doc.key,
      lang: doc.lang,
      version: 1,
      title: doc.title,
      doc,
      active: true,
      imported_at: new Date().toISOString(),
    })),
  };

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (!url.href.startsWith(SUPABASE_URL)) return realFetch(input, init);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    const path = url.pathname;
    if (path.endsWith("/rpc/cockpit_sales_whoami")) return json(F.ME);
    if (path.startsWith("/functions/v1/sales-api")) {
      // The failure knobs: the server gone, a garbled yes, a lapsed sign-in.
      if (
        live.net === "down" ||
        (live.net === "drop" && Date.now() - START > 6000)
      )
        throw new TypeError("Failed to fetch");
      if (live.auth === "401")
        return json({ ok: false, error: "Sign in again." }, 401);
      if (live.answer === "garbage")
        return json({ ok: true, garbage: [1, { x: null }], error: { no: 1 } });
      const body = JSON.parse(String(init?.body ?? "{}"));
      try {
        return json({ ok: true, ...(await salesApi(body, init?.signal)) });
      } catch (e) {
        // The cockpit gave up waiting: the fetch fails as a browser's does.
        if ((e as Error).name === "AbortError") throw e;
        const status =
          e instanceof Refusal || e instanceof LiveRefused ? e.status : 500;
        const code = e instanceof LiveRefused ? e.code : null;
        return json(
          { ok: false, error: (e as Error).message, ...(code ? { code } : {}) },
          status,
        );
      }
    }
    if (path.startsWith("/storage/v1/object")) {
      return new Response(proposalPage, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    }
    const m = path.match(/\/rest\/v1\/([a-z_]+)$/);
    if (!m) return json([]);
    // Every table read fails, or never answers (until the page gives up).
    if (live.reads === "fail")
      return json(
        { code: "XX000", message: "The harness refused this read." },
        500,
      );
    if (live.reads === "hang") {
      await sleep(10 * 60_000, init?.signal);
      return json([]);
    }
    let rows = [...(tables[m[1]] ?? [])];
    for (const [k, v] of url.searchParams) {
      if (k === "or") {
        // The dialer's search: name.ilike.*x*,email.ilike.*x*,…
        const parts = v
          .replace(/^\(|\)$/g, "")
          .split(",")
          .map(p => p.split("."))
          .filter(p => p.length >= 3);
        rows = rows.filter(r =>
          parts.some(([col, op, ...pat]) => {
            const needle = pat.join(".").replace(/\*/g, "");
            const hay = String(r[col] ?? "");
            return op === "ilike"
              ? hay.toLowerCase().includes(needle.toLowerCase())
              : hay.includes(needle);
          }),
        );
        continue;
      }
      if (["select", "order", "limit", "offset"].includes(k)) continue;
      const [op, ...rest] = v.split(".");
      const val = rest.join(".");
      rows = rows.filter(r => {
        const x = r[k];
        if (op === "eq") return String(x) === val;
        if (op === "neq") return String(x) !== val;
        if (op === "gte") return x !== null && String(x) >= val;
        if (op === "gt") return x !== null && String(x) > val;
        if (op === "lt") return x !== null && String(x) < val;
        if (op === "lte") return x !== null && String(x) <= val;
        if (op === "is")
          return val === "null"
            ? x === null || x === undefined
            : String(x) === val;
        if (op === "in")
          return val
            .replace(/[()]/g, "")
            .split(",")
            .map(v => v.replace(/^"|"$/g, ""))
            .includes(String(x));
        if (op === "not" && rest[0] === "is")
          return !(x === null || x === undefined);
        return true;
      });
    }
    const order = url.searchParams.get("order");
    if (order) {
      const [col, dir] = order.split(",")[0].split(".");
      rows.sort((a, b) => {
        const A = String(a[col] ?? "");
        const B = String(b[col] ?? "");
        return dir === "desc" ? B.localeCompare(A) : A.localeCompare(B);
      });
    }
    const limit = Number(url.searchParams.get("limit"));
    if (limit > 0) rows = rows.slice(0, limit);
    const wantsOne = (new Headers(init?.headers).get("Accept") ?? "").includes(
      "vnd.pgrst.object",
    );
    if (wantsOne) {
      if (!rows.length)
        return json(
          {
            code: "PGRST116",
            details: "The result contains 0 rows",
            hint: null,
            message: "no rows",
          },
          406,
        );
      return json(rows[0]);
    }
    return json(rows);
  };

  const { supabase } = await import("../lib/supabase");
  // api() asks for a session before calling the function; the harness has one.
  supabase.auth.getSession = (async () => ({
    data: {
      session: live.auth === "expired" ? null : { access_token: "harness" },
    },
    error: null,
  })) as unknown as typeof supabase.auth.getSession;
  // No real sign-in here: a refresh finds nothing, as an expired one would.
  supabase.auth.refreshSession = (async () => ({
    data: { session: null, user: null },
    error: null,
  })) as unknown as typeof supabase.auth.refreshSession;
  const { setApiTimeout } = await import("../lib/api");
  setApiTimeout(knobs.timeout);

  const { Seated } = await import("../App");
  const { SalesBanner } = await import("../components/SalesBanner");
  const { replyFixture } = await import("./roomFixtures");
  const { useState } = await import("react");
  // P2's handover strip and P3's reply alert are not built yet: stand-ins,
  // so their banner slots can be seen.
  const reply = live.reply ? replyFixture() : null;
  const handover = live.handover ? (
    <div className="flex min-h-11 items-center gap-3 text-[13px]">
      <span className="inline-flex size-2.5 shrink-0 rounded-full bg-[color:var(--now)]" />
      Finding a closer for Mona. The strip says when one takes it.
    </div>
  ) : null;
  function Harness() {
    const [drawer, setDrawer] = useState(false);
    return (
      <Seated
        me={F.ME as never}
        name="Aziz Waheedi"
        isAdmin
        drawer={drawer}
        setDrawer={setDrawer}
        banner={
          <SalesBanner
            portal={null}
            replyAlert={reply}
            handover={handover}
            handoverActive={Boolean(handover)}
          />
        }
      />
    );
  }
  const { Toaster } = await import("../lib/toast");
  const { SessionProvider } = await import("../lib/auth");
  const start = startPath;
  const root = document.getElementById("root");
  if (!root) throw new Error("no #root");
  createRoot(root).render(
    <StrictMode>
      <MemoryRouter initialEntries={[start]}>
        <SessionProvider>
          <Harness />
          <Toaster />
        </SessionProvider>
      </MemoryRouter>
    </StrictMode>,
  );
}

void main();
