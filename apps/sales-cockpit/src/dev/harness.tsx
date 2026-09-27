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
 * screen says the script is not imported.
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
 *   wait     ms every sales-api answer takes (250)
 *   queueWait  ms dial.queue takes; it reads when asked and answers late,
 *            as a slow server does (0: the same as wait)
 *   gap      ms the server wants between two calls (12000)
 *   timeout  ms the cockpit waits for an answer (45000)
 *
 * `window.harnessLog` lists every sales-api call the page made (action,
 * body, when), to count what a double tap sent.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import "../index.css";
import * as F from "./fixtures";

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

async function salesApi(b: Row, signal?: AbortSignal | null): Promise<Row> {
  log.push({ at: Date.now(), action: String(b.action), body: b });
  if (b.action === "dial.queue") {
    const read = queue(b.as === "closer" ? "closer" : "setter");
    await sleep(knobs.queueWait || knobs.wait, signal);
    return read;
  }
  await sleep(knobs.wait, signal);
  const now = Date.now();
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

  const tables: Record<string, Row[]> = {
    cockpit_sales_leads: F.LEADS,
    cockpit_sales_calendar: F.APPOINTMENTS,
    cockpit_sales_dials: F.DIALS,
    cockpit_sales_deals: F.DEALS,
    cockpit_sales_notes: [],
    cockpit_sales_proposals: F.PROPOSALS,
    cockpit_sales_requests: [],
    cockpit_sales_recordings: [],
    cockpit_sales_scorecards: F.scorecards(),
    cockpit_sales_board: F.board(),
    cockpit_sales_people: F.PEOPLE,
    cockpit_sales_team: F.TEAM_ROWS,
    cockpit_sales_reps: F.REPS,
    cockpit_sales_links: F.LINKS,
    cockpit_sales_settings: F.SETTINGS,
    cockpit_sales_mirror_runs: [F.MIRROR_RUN],
    cockpit_sales_worker_status: [],
    cockpit_sales_inbox: F.INBOX,
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
      const body = JSON.parse(String(init?.body ?? "{}"));
      try {
        return json({ ok: true, ...(await salesApi(body, init?.signal)) });
      } catch (e) {
        // The cockpit gave up waiting: the fetch fails as a browser's does.
        if ((e as Error).name === "AbortError") throw e;
        const status = e instanceof Refusal ? e.status : 500;
        return json({ ok: false, error: (e as Error).message }, status);
      }
    }
    if (path.startsWith("/storage/v1/object")) {
      return new Response(
        "<!doctype html><html dir='rtl'><body style='font-family:system-ui;padding:40px'><h1>مقترح شراكة</h1><p>مشاريعكم القادمة FILL</p></body></html>",
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }
    const m = path.match(/\/rest\/v1\/([a-z_]+)$/);
    if (!m) return json([]);
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
    data: { session: { access_token: "harness" } },
    error: null,
  })) as unknown as typeof supabase.auth.getSession;
  const { setApiTimeout } = await import("../lib/api");
  setApiTimeout(knobs.timeout);

  const { Seated } = await import("../App");
  const { useState } = await import("react");
  function Harness() {
    const [drawer, setDrawer] = useState(false);
    return (
      <Seated
        me={F.ME as never}
        name="Aziz Waheedi"
        isAdmin
        drawer={drawer}
        setDrawer={setDrawer}
        banner={null}
      />
    );
  }
  const { Toaster } = await import("../lib/toast");
  const { SessionProvider } = await import("../lib/auth");
  const start = params.get("path") ?? "/";
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
