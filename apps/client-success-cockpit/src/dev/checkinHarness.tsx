/**
 * The 1-1 notes window and its entry points from invented fixtures, to see
 * and screenshot every state of docs/forms/STAGE2-CONTRACT.md 8.5 without
 * signing in. `bunx vite`, then open
 * /client-success/src/dev/checkin-harness.html?state=shadow-admin
 * (state: any key of STATES below, or `index` for the list); theme=light.
 * The cockpit tab's parts are state=today, today-failed and queue;
 * state=header-join is the client header's call line with its Join.
 *
 * Stage 2b (docs/forms/STAGE2B-CONTRACT.md section 5): the Messages card
 * (messages-*), Today's recap rows (today-recap-rows), the window's recap
 * approval (window-recap-approval), impromptu calls on Today
 * (today-impromptu, today-impromptu-failed, today-place-sheet) and Move it
 * here (sheet-admin-move).
 *
 * Nothing leaves the page: the backend is src/dev/checkinFixtures.ts in
 * memory, booking is a stand-in button, and the Typeform links only log.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { StrictMode, useEffect, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { Toaster } from "sonner";
import { AfterCalls } from "@/components/AfterCalls";
import { NextCallLine, UnmatchedQueue } from "@/components/ClientCalls";
import { ClientMessages, RecapsWaiting } from "@/components/ClientMessages";
import { FormsButton } from "@/components/FormsButton";
import type { ImpromptuIO } from "@/components/ImpromptuCalls";
import { ExtLink } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { CheckinWindowView } from "@/forms/CheckinWindow";
import { useCheckin } from "@/forms/useCheckin";
import type { MessageView } from "@/lib/clientMessages";
import { joinLink, type Unmatched } from "@/lib/csmCalls";
import {
  markTypeformOpened,
  primeCheckinEntry,
  primeTypeformSent,
} from "@/lib/formsRegistry";
import {
  cockpitEffects,
  DEFCON_NO_QUOTE,
  DEFCON_READY,
  draft,
  FILLED,
  fakeCheckin,
  fakeMessages,
  type MessagesScenario,
  makeEffects,
  messageFixture,
  messageStates,
  messagesWeek,
  NOTES_AGAIN,
  NOTES_ARABIC,
  NOTES_READY,
  NOW,
  OFF_ASK,
  OFF_PASTE,
  RECAP_READY,
  type Scenario,
  SUMMARY_WAIT,
  TASK,
  TODOS_NONE,
  TODOS_READY,
  TRANSCRIPT_WAIT,
  troubleEffects,
  VIEWS,
} from "./checkinFixtures";
import "@/index.css";

const params = new URLSearchParams(window.location.search);
const state = params.get("state") ?? "index";
if (params.get("theme") === "light")
  document.documentElement.classList.remove("dark");

type Act =
  | "send"
  | "sheet"
  | "repick"
  | "transcript"
  | "notes"
  | "choose"
  | "again"
  | "replace";
type Entry = {
  scenario: Scenario;
  rehearse?: boolean;
  act?: Act;
  /** The client's messages, for a live response's recap step (2b). */
  messages?: MessageView[];
};

const READY = {
  todos: TODOS_READY,
  client_notes: NOTES_READY,
  defcon_priority: DEFCON_READY,
};
const call = (v: (typeof VIEWS)[keyof typeof VIEWS], why = v.why) => ({
  kind: "fathom",
  recordingId: v.recordingId,
  why,
  confirmed: true,
  callId: v.callId,
  shareUrl: v.shareUrl,
  startsAt: v.startsAt,
  endsAt: v.endsAt,
  title: v.title,
  recorder: v.recorder,
});

/** Every state of 8.5, by name. */
const STATES: Record<string, Entry> = {
  // Opening
  loading: { scenario: { hold: ["open"] } },
  "blocked-list": {
    scenario: {
      open: "fail",
      openError: "That client is not on your access list",
    },
  },
  "blocked-roster": {
    scenario: {
      open: "fail",
      openError: "The client roster is incomplete. Refresh its native source",
    },
  },
  "blocked-live": {
    scenario: {
      open: "fail",
      openError: "The cockpit's 1-1 notes are not live yet.",
    },
  },
  "blocked-read": { scenario: { open: "fail" } },
  "shadow-admin": { scenario: { seat: "admin", drafts: READY } },
  "shadow-csm": { scenario: { seat: "csm", drafts: READY } },
  "started-shadow": {
    scenario: { open: "resumed", answers: FILLED, formMode: "live" },
  },
  rehearsal: { scenario: { seat: "admin" }, rehearse: true },
  resumed: {
    scenario: {
      open: "resumed",
      answers: FILLED,
      // The lists were saved from Fathom's action items: nothing is offered back.
      meta: {
        we_owe: { at: NOW, from: "fathom.action_items", by: "Noor" },
        they_owe: { at: NOW, from: "fathom.action_items", by: "Noor" },
      },
      drafts: READY,
    },
  },
  "unsent-other": {
    scenario: {
      open: "resumed",
      answers: { ...FILLED, call: call(VIEWS.team, "picked") },
      meta: {
        we_owe: { at: NOW, from: "fathom.action_items", by: "Noor" },
        they_owe: { at: NOW, from: "fathom.action_items", by: "Noor" },
      },
      others: [VIEWS.team],
      drafts: READY,
    },
  },
  already: {
    scenario: {
      picked: {
        ...VIEWS.same_room,
        notesAlready: { at: "2026-10-25T08:10:00Z", source: "typeform" },
      },
      drafts: READY,
    },
  },
  // A CSM whose call is already in the Typeform: nothing more to fill there
  "already-csm": {
    scenario: {
      seat: "csm",
      picked: {
        ...VIEWS.same_room,
        notesAlready: { at: "2026-10-25T08:10:00Z", source: "typeform" },
      },
      drafts: READY,
    },
  },
  // This call
  "same-room": { scenario: { drafts: READY } },
  invitee: { scenario: { picked: VIEWS.invitee_email, drafts: READY } },
  pasted: {
    scenario: {
      answers: { call: call(VIEWS.pasted, "pasted") },
      picked: null,
      drafts: READY,
    },
  },
  matched: { scenario: { picked: VIEWS.matched, drafts: READY } },
  likely: { scenario: { picked: VIEWS.likely, drafts: READY } },
  "possible-csm": {
    scenario: { seat: "csm", picked: VIEWS.possible_csm, drafts: READY },
  },
  "possible-admin": {
    scenario: { seat: "admin", picked: VIEWS.possible_admin, drafts: READY },
  },
  "default-csm": {
    scenario: { seat: "csm", picked: VIEWS.default_csm, drafts: READY },
  },
  "default-admin": {
    scenario: { seat: "admin", picked: VIEWS.default_admin, drafts: READY },
  },
  picked: {
    scenario: {
      answers: { call: call(VIEWS.team, "picked") },
      others: [VIEWS.team],
      drafts: READY,
    },
  },
  booking: { scenario: { picked: VIEWS.booking } },
  none: { scenario: { answers: { call: { kind: "none", why: "none" } } } },
  waiting: {
    scenario: {
      picked: null,
      fathom: {
        state: "waiting",
        checkedAt: "2026-10-25T08:03:00Z",
        note: "Fathom hasn't sent this call yet. It usually takes a few minutes after the call ends.",
      },
    },
  },
  "waiting-booking": {
    scenario: {
      picked: VIEWS.booking,
      fathom: {
        state: "waiting",
        checkedAt: "2026-10-25T08:03:00Z",
        note: null,
      },
    },
  },
  "fathom-failed": {
    scenario: {
      picked: null,
      fathom: {
        state: "failed",
        checkedAt: NOW,
        note: "Fathom could not be read just now (503).",
      },
    },
  },
  "fathom-busy": {
    scenario: {
      picked: null,
      fathom: { state: "busy", checkedAt: NOW, note: null },
    },
  },
  // No Fathom key (B7 open): the store still answers; the note is the seat's
  "fathom-off": {
    scenario: {
      picked: null,
      others: [VIEWS.booking],
      fathom: { state: "off", checkedAt: null, note: OFF_ASK },
    },
  },
  "fathom-off-ceo": {
    scenario: {
      picked: null,
      others: [VIEWS.booking],
      fathom: { state: "off", checkedAt: null, note: OFF_PASTE },
    },
  },
  "fathom-off-booking": {
    scenario: {
      seat: "csm",
      picked: VIEWS.booking,
      others: [VIEWS.hint],
      fathom: { state: "off", checkedAt: null, note: OFF_ASK },
    },
  },
  "sheet-off": {
    scenario: {
      seat: "csm",
      picked: VIEWS.booking,
      others: [VIEWS.hint],
      fathom: { state: "off", checkedAt: null, note: OFF_ASK },
    },
    act: "sheet",
  },
  sheet: {
    scenario: {
      others: [VIEWS.team, VIEWS.other_client, VIEWS.booking],
      drafts: READY,
    },
    act: "sheet",
  },
  "sheet-blocked": {
    scenario: {
      others: [
        VIEWS.hint,
        VIEWS.no_sign,
        VIEWS.other_client,
        VIEWS.team_meeting,
        VIEWS.gone,
      ],
      drafts: READY,
    },
    act: "sheet",
  },
  // The CSM's sheet with the recordings A7.3 and A7.14 hold back from her:
  // one on a client she may not see, and from outside Customer Success one
  // on no card and one an admin recorded that a name put on this client
  // (A7.14's two sentences, A7.18), each keeping its recorder's role
  "sheet-csm-blocked": {
    scenario: {
      seat: "csm",
      others: [
        VIEWS.no_sign,
        VIEWS.unnamed,
        VIEWS.outside_cs,
        VIEWS.outside_cs_likely,
      ],
      drafts: READY,
    },
    act: "sheet",
  },
  "paste-unknown": { scenario: { paste: "unknown" }, act: "sheet" },
  "paste-not-fathom": { scenario: { paste: "not_fathom" }, act: "sheet" },
  repicked: {
    scenario: { others: [VIEWS.team], drafts: READY },
    act: "repick",
  },
  "transcript-none": {
    scenario: { drafts: READY, transcript: "none" },
    act: "transcript",
  },
  "booking-future": {
    scenario: {
      picked: VIEWS.booking,
      saveRefusal: {
        key: "call",
        text: "That booked call has not happened yet.",
      },
    },
  },
  "booking-cancelled": {
    scenario: {
      picked: VIEWS.booking,
      saveRefusal: {
        key: "call",
        text: "That booked call was cancelled. Pick its recording or No recording.",
      },
    },
  },
  // Answers and drafts
  "drafts-reading": {
    scenario: {
      drafts: {
        todos: draft("todos", "drafting"),
        client_notes: draft("client_notes", "drafting"),
        defcon_priority: draft("defcon_priority", "drafting"),
      },
    },
  },
  "drafts-off": {
    scenario: {
      drafts: {
        todos: TODOS_READY,
        client_notes: draft(
          "client_notes",
          "off",
          null,
          "AI drafts are off: no DeepSeek key. Fill this by hand.",
        ),
        defcon_priority: draft(
          "defcon_priority",
          "off",
          null,
          "AI drafts are off: no Anthropic key. Fill this by hand.",
        ),
      },
    },
  },
  "drafts-no-quote": {
    scenario: {
      drafts: { ...READY, defcon_priority: DEFCON_NO_QUOTE },
    },
  },
  "drafts-failed": {
    scenario: {
      drafts: {
        ...READY,
        defcon_priority: draft(
          "defcon_priority",
          "failed",
          null,
          "The draft took too long. Draft again.",
        ),
      },
    },
  },
  "drafts-summary-wait": {
    scenario: {
      // The server says it waits for the summary only when there is none.
      picked: { ...VIEWS.same_room, hasSummary: false },
      drafts: {
        todos: TODOS_READY,
        client_notes: draft("client_notes", "skipped", null, SUMMARY_WAIT),
        defcon_priority: draft(
          "defcon_priority",
          "skipped",
          null,
          SUMMARY_WAIT,
        ),
      },
    },
  },
  // The summary is in, but no transcript line can be read yet
  "drafts-transcript-wait": {
    scenario: {
      drafts: {
        todos: TODOS_READY,
        client_notes: draft("client_notes", "skipped", null, TRANSCRIPT_WAIT),
        defcon_priority: draft(
          "defcon_priority",
          "skipped",
          null,
          TRANSCRIPT_WAIT,
        ),
      },
    },
  },
  "todos-none": { scenario: { drafts: { ...READY, todos: TODOS_NONE } } },
  // A line typed before Fathom's action items came: they are offered beside it
  "todos-touched": {
    scenario: {
      open: "resumed",
      answers: {
        call: FILLED.call,
        we_owe: [
          {
            text: "Call the architect about the showroom",
            owner: null,
            at: null,
            href: null,
            from: "csm",
            unsure: false,
          },
        ],
      },
      drafts: READY,
    },
  },
  "notes-arabic": {
    scenario: { drafts: { ...READY, client_notes: NOTES_ARABIC } },
  },
  // Draft again over notes the CSM edited: hers stay until she chooses
  "notes-again-writing": {
    scenario: {
      seat: "csm",
      drafts: READY,
      again: { client_notes: [draft("client_notes", "drafting"), NOTES_AGAIN] },
    },
    act: "again",
  },
  "notes-again-ready": {
    scenario: {
      seat: "csm",
      drafts: READY,
      again: { client_notes: NOTES_AGAIN },
    },
    act: "again",
  },
  "notes-again-replaced": {
    scenario: {
      seat: "csm",
      drafts: READY,
      again: { client_notes: NOTES_AGAIN },
    },
    act: "replace",
  },
  "notes-again-refused": {
    scenario: {
      seat: "csm",
      drafts: READY,
      again: {
        client_notes: { refused: "Five drafts is the limit for this call." },
      },
    },
    act: "again",
  },
  // Saving
  "not-saved": { scenario: { saveError: "Failed to fetch" }, act: "choose" },
  conflict: {
    scenario: {
      drafts: READY,
      conflict: {
        key: "client_notes",
        theirs: "Changed in the other window: wants a call on Thursday.",
      },
    },
    act: "notes",
  },
  // Sending
  "send-call": { scenario: { picked: null } },
  "send-confirm": { scenario: { picked: VIEWS.default_csm, seat: "csm" } },
  "send-choices": { scenario: { drafts: READY } },
  sending: {
    scenario: { open: "resumed", answers: FILLED, hold: ["submit"] },
    act: "send",
  },
  "sent-admin": {
    scenario: { seat: "admin", open: "submitted", answers: FILLED },
  },
  "sent-csm": {
    scenario: { seat: "csm", open: "submitted", answers: FILLED },
  },
  // Sent in shadow by a CSM whose call the Typeform already holds
  "sent-csm-typeform": {
    scenario: {
      seat: "csm",
      open: "submitted",
      answers: FILLED,
      picked: {
        ...VIEWS.same_room,
        notesAlready: { at: "2026-10-25T08:10:00Z", source: "typeform" },
      },
    },
  },
  "sent-none": {
    scenario: {
      seat: "admin",
      open: "submitted",
      answers: {
        ...FILLED,
        call: { kind: "none", why: "none", confirmed: true },
        we_owe: null,
        they_owe: null,
      },
    },
  },
  refused: {
    scenario: {
      open: "resumed",
      answers: FILLED,
      submitRefusal: {
        text: "These notes changed in another window. Read them again, then send.",
        code: "40001",
      },
    },
    act: "send",
  },
  "gate-lost": {
    scenario: {
      open: "resumed",
      answers: FILLED,
      submitRefusal: {
        text: "That client is not on your access list",
        code: "42501",
      },
    },
    act: "send",
  },
  // The trail after the cut-over (2b) and Make's ownership
  "trail-cockpit": {
    scenario: {
      mode: "live",
      open: "submitted",
      answers: FILLED,
      effects: cockpitEffects,
    },
  },
  "trail-trouble": {
    scenario: {
      mode: "live",
      open: "submitted",
      answers: FILLED,
      effects: troubleEffects,
    },
  },
  "trail-make": {
    scenario: { open: "submitted", answers: FILLED, effects: makeEffects },
  },
  // The recap step
  "recap-drafting": {
    scenario: {
      open: "submitted",
      answers: FILLED,
      recap: [draft("recap", "drafting")],
    },
  },
  // Sent before Fathom could give the transcript: the step waits and asks again
  "recap-transcript-wait": {
    scenario: {
      open: "submitted",
      answers: FILLED,
      recap: [draft("recap", "skipped", null, TRANSCRIPT_WAIT)],
    },
  },
  "recap-ready": {
    scenario: { open: "submitted", answers: FILLED, recap: [RECAP_READY] },
  },
  "recap-off": {
    scenario: {
      open: "submitted",
      answers: FILLED,
      recap: [
        draft(
          "recap",
          "off",
          null,
          "AI drafts are off: no Anthropic key. Fill this by hand.",
        ),
      ],
    },
  },
  "recap-failed": {
    scenario: {
      open: "submitted",
      answers: FILLED,
      recap: [
        draft(
          "recap",
          "failed",
          null,
          "The recap named a cost per lead, so it was not kept. Draft again.",
        ),
      ],
    },
  },
  // Draft again for the recap, refused (press it): it rests, said why
  "recap-refused": {
    scenario: {
      open: "submitted",
      answers: FILLED,
      recap: [
        draft(
          "recap",
          "failed",
          null,
          "The recap named a cost per lead, so it was not kept. Draft again.",
        ),
      ],
      again: { recap: { refused: "Five drafts is the limit for this call." } },
    },
  },
  "recap-skipped": {
    scenario: {
      open: "submitted",
      answers: FILLED,
      recap: [
        draft(
          "recap",
          "skipped",
          { skip: true },
          "Nothing worth sending from this call.",
        ),
      ],
    },
  },
  // After the cut-over (2b): the live window books the next check-in
  live: {
    scenario: { mode: "live", drafts: READY, timeline: { ...emptyTimeline() } },
  },
  // 2b, 5.1: a live send's recap step approves the message the cockpit made
  "window-recap-approval": {
    scenario: {
      mode: "live",
      open: "submitted",
      answers: FILLED,
      effects: (a, at) =>
        cockpitEffects(a, at).map(e =>
          e.key === "recap" ? { ...e, state: "queued" as const } : e,
        ),
      recap: [RECAP_READY],
    },
    messages: [messageFixture()],
  },
  // 2b, 5.3: an admin's Change sheet, a recording on another client
  "sheet-admin-move": {
    scenario: {
      seat: "admin",
      others: [VIEWS.other_movable, VIEWS.no_sign],
      drafts: READY,
    },
    act: "sheet",
  },
};

/** The Messages card's states of 5.1, by name: rows and how the fake answers. */
const MESSAGE_STATES: Record<
  string,
  { rows: MessageView[]; scenario?: MessagesScenario; press?: string }
> = (() => {
  const st = messageStates();
  return {
    "messages-empty": { rows: [] },
    "messages-read-failed": {
      rows: [],
      scenario: { readError: "Failed to fetch" },
    },
    "messages-draft": { rows: messagesWeek() },
    "messages-warnings": {
      rows: [st.draft],
      scenario: { warn: ["The group already had a team message today."] },
      press: "Approve and send",
    },
    "messages-refused-check": {
      rows: [st.draft],
      scenario: {
        refuse:
          "The recap quoted a money figure. Client messages carry no amounts. Edit the text, then approve again.",
      },
      press: "Approve and send",
    },
    "messages-expired": { rows: [st.expired] },
    "messages-approved": { rows: [st.approved] },
    "messages-sending": { rows: [st.sending] },
    "messages-sent": { rows: [st["sent-checking"], st.sent] },
    "messages-unknown": { rows: [st.unknown] },
    "messages-not-sent": { rows: [st.refused, st.failed] },
    "messages-skipped": { rows: [st.skipped] },
  };
})();

/** The Messages card alone, on the overview column's width. */
function MessagesCard({ name }: { name: string }) {
  const entry = MESSAGE_STATES[name];
  const io = useMemo(
    () => fakeMessages(entry.rows, { ...entry.scenario, latency: 400 }),
    [entry],
  );
  useEffect(() => {
    if (!entry.press) return;
    const t = setTimeout(() => {
      const b = Array.from(document.querySelectorAll("button")).find(
        x => x.textContent?.trim() === entry.press,
      );
      b?.click();
    }, 1200);
    return () => clearTimeout(t);
  }, [entry]);
  return (
    <MemoryRouter>
      <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 lg:p-8">
        <ClientMessages taskId={TASK} native io={io} />
      </div>
    </MemoryRouter>
  );
}

/** Today's recap rows: one waiting, one refused, one not confirmed (an admin). */
function RecapRows() {
  const io = useMemo(() => {
    const st = messageStates();
    return fakeMessages([], {
      waiting: [
        st.draft,
        {
          ...st.refused,
          id: "33333333-0000-4000-8000-0000000000c2",
          taskId: "86exfix02",
          clientName: "Harbor Glassworks",
        },
        {
          ...st.unknown,
          id: "33333333-0000-4000-8000-0000000000c3",
          taskId: "86exfix03",
          clientName: "Juniper Kitchens",
        },
      ],
    });
  }, []);
  return (
    <MemoryRouter>
      <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
        <RecapsWaiting io={io} native />
      </div>
    </MemoryRouter>
  );
}

/** The seat's own impromptu recordings, answered here (5.2). */
const IMPROMPTU: Unmatched[] = [
  {
    id: 801,
    kind: "call",
    title: "Impromptu Google Meet Meeting",
    at: "2026-10-25T07:34:00Z",
    reason: "No booking, invitee or name matched",
    hint: "4 min before Cedar & Stone Interiors's booked call",
    host: "csm@example.test",
    candidate: true,
  },
  {
    id: 802,
    kind: "call",
    title: "Impromptu Zoom Meeting",
    at: "2026-10-23T12:05:00Z",
    reason: "No booking, invitee or name matched",
    host: "csm@example.test",
    candidate: true,
  },
  // Another recorder's: never listed on this seat's Today.
  {
    id: 803,
    kind: "call",
    title: "Impromptu Google Meet Meeting",
    at: "2026-10-24T09:00:00Z",
    reason: "No booking, invitee or name matched",
    host: "other@example.test",
    candidate: true,
  },
];
const impromptuIO = (failed: boolean): ImpromptuIO => ({
  email: "csm@example.test",
  read: async () => {
    await new Promise(r => setTimeout(r, 300));
    if (failed) throw Error("Failed to fetch");
    return IMPROMPTU;
  },
  place: async () => {
    await new Promise(r => setTimeout(r, 400));
    return { ok: true };
  },
  settle: async () => {
    await new Promise(r => setTimeout(r, 400));
    return { ok: true };
  },
});

function emptyTimeline() {
  return {
    taskId: TASK,
    clientName: "Cedar & Stone Interiors",
    calls: [],
    forms: [],
    changes: [],
    health: [],
    unmatchedCount: 0,
  };
}

function Window({ entry, name }: { entry: Entry; name: string }) {
  const fake = useMemo(() => fakeCheckin(entry.scenario), [entry]);
  const messages = useMemo(
    () =>
      entry.messages ? fakeMessages(entry.messages, { latency: 400 }) : null,
    [entry],
  );
  const m = useCheckin({
    taskId: TASK,
    rehearse: Boolean(entry.rehearse),
    seat: entry.scenario.seat ?? "admin",
    io: fake.io,
  });
  const did = useRef(false);
  const took = useRef(false);
  useEffect(() => {
    if (entry.act === "replace" && m.notesAgain?.kind === "ready") {
      if (took.current) return;
      took.current = true;
      m.takeNewNotes();
      return;
    }
    if (did.current || m.phase.kind !== "ready" || !m.response) return;
    const callReady = Boolean(m.answers.call);
    if (entry.act === "send" && callReady) {
      did.current = true;
      void m.sendNotes();
    } else if (entry.act === "repick" && m.unsaved.size) {
      did.current = true;
      m.pick(VIEWS.team);
    } else if (entry.act === "transcript" && callReady) {
      did.current = true;
      window.open = () => null;
      m.openTranscript();
    } else if (entry.act === "notes" && callReady) {
      did.current = true;
      m.setNotes("Wants a call on Thursday about the showroom.");
    } else if (entry.act === "choose" && callReady) {
      did.current = true;
      m.choose("defcon", "Happy");
    } else if (
      (entry.act === "again" || entry.act === "replace") &&
      callReady &&
      typeof m.answers.client_notes === "string" &&
      m.origin.client_notes
    ) {
      did.current = true;
      m.setNotes(
        `${m.answers.client_notes} She asked us to call the architect on Thursday before 4.`,
      );
      const again = m.draftAgain;
      setTimeout(() => again("client_notes"), 50);
    }
  });
  return (
    <CheckinWindowView
      key={name}
      m={m}
      messages={messages}
      initialSheet={entry.act === "sheet"}
      onTypeform={() => console.info("The 1-1 form would open in Typeform.")}
      book={() => (
        <Button size="sm" variant="outline">
          Book the next check-in
        </Button>
      )}
    />
  );
}

/** A client page's queue, answered here. */
const queueClient = {
  rpc: async (name: string) => {
    if (name === "cockpit_csm_unmatched_list")
      return {
        data: [
          {
            id: 701,
            kind: "call",
            title: "Impromptu Google Meet Meeting",
            at: "2026-10-24T13:00:00Z",
            reason: "No booking, invitee or name matched",
            hint: "Near Cedar & Stone Interiors's check-in at 16:30",
            host: "csm@example.test",
            candidate: true,
          },
          {
            id: 702,
            kind: "form",
            title: "1-1 call notes form",
            at: "2026-10-23T10:00:00Z",
            reason: "The Client ID matched no card",
            candidate: false,
          },
        ],
        error: null,
      };
    return { data: { ok: true }, error: null };
  },
} as unknown as SupabaseClient;

function Today({
  failed,
  impromptu,
}: {
  failed: boolean;
  /** 2b, 5.2: the 1-1 notes native, with the seat's impromptu calls. */
  impromptu?: "rows" | "failed" | "sheet";
}) {
  useMemo(() => {
    primeCheckinEntry({
      key: "checkin",
      title: "1-1 call notes",
      provider: impromptu ? "native" : "typeform",
      typeformId: "fRokTITH",
      version: 1,
      native: true,
      mode: impromptu ? "live" : "shadow",
      now: NOW,
    });
    markTypeformOpened("86exfix03", "2026-10-23", Date.now() - 4 * 60_000);
    primeTypeformSent("86exfix04", "2026-10-22", true, "2026-10-22T12:20:00Z");
  }, [impromptu]);
  const io = useMemo(
    () => (impromptu ? impromptuIO(impromptu === "failed") : undefined),
    [impromptu],
  );
  useEffect(() => {
    if (impromptu !== "sheet") return;
    const t = setTimeout(() => {
      const b = Array.from(document.querySelectorAll("button")).find(
        x => x.textContent?.trim() === "Place it",
      );
      b?.click();
    }, 700);
    return () => clearTimeout(t);
  }, [impromptu]);
  const snap = useMemo(
    () => ({
      clients: todayClients(),
      callStoreError: failed ? "Failed to fetch" : null,
    }),
    [failed],
  );
  return <TodayPage snap={snap} io={io} />;
}

/** The invented clients of Today's card. */
function todayClients() {
  const day = (n: number) => `2026-10-${String(25 - n).padStart(2, "0")}`;
  return [
    ["86exfix01", "Cedar & Stone Interiors", "checkin"],
    ["86exfix02", "Harbor Glassworks", "checkin"],
    ["86exfix03", "Juniper Kitchens", "checkin"],
    ["86exfix04", "Atlas Fit-Out Co", "launch"],
    ["86exfix05", "Saffron Living", "other"],
    ["86exfix06", "Northwind Floors", "checkin"],
    ["86exfix07", "Palm Court Decor", "checkin"],
    ["86exfix08", "Old Harbour Joinery", "onboarding"],
  ].map(([taskId, name, kind], i) => ({
    taskId,
    name,
    noteMissing: true,
    lastCall: day(i),
    lastCallKind: kind,
  }));
}

function TodayPage({
  snap,
  io,
}: {
  snap: {
    clients: ReturnType<typeof todayClients>;
    callStoreError: string | null;
  };
  io: ImpromptuIO | undefined;
}) {
  return (
    <MemoryRouter>
      <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Cedar &amp; Stone Interiors
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <FormsButton
              taskId="86exfix01"
              noteMissing
              lastCall="2026-10-25"
              kickoff
            />
          </div>
        </div>
        <AfterCalls
          snap={snap}
          impromptuIO={io}
          onPlaced={() =>
            console.info("The page would read its snapshot again.")
          }
        />
        <UnmatchedQueue
          client={queueClient}
          taskId="86exfix01"
          clientName="Cedar & Stone Interiors"
          onMatched={() => {}}
        />
      </div>
    </MemoryRouter>
  );
}

/**
 * The client page's header call line (CsmPage.tsx, 8.3) around the page's
 * own Join (`joinLink`, the line CsmPage draws): before a call, during one
 * after the next call has moved on, and after it. The rest of the line is a
 * mock with the page's classes; the link is a placeholder.
 */
function HeaderJoin() {
  const now = useMemo(() => Date.now(), []);
  const iso = (ms: number) => new Date(ms).toISOString();
  const link = "https://meeting.example.com/join/TEST";
  const started = now - 2 * 60_000;
  const rows: [string, Parameters<typeof joinLink>[0] & { kind?: string }][] = [
    [
      "Ten minutes before the check-in",
      {
        nextCallAt: iso(now + 10 * 60_000),
        kind: "checkin",
        joinCallAt: iso(now + 10 * 60_000),
        joinCallUrl: link,
        joinCallEndsAt: null,
      },
    ],
    [
      "Two minutes into it, next week's check-in booked",
      {
        nextCallAt: iso(now + 7 * 86_400_000),
        kind: "checkin",
        joinCallAt: iso(started),
        joinCallUrl: link,
        joinCallEndsAt: iso(started + 30 * 60_000),
      },
    ],
    [
      "Two minutes into it, nothing booked after it",
      {
        nextCallAt: null,
        joinCallAt: iso(started),
        joinCallUrl: link,
        joinCallEndsAt: iso(started + 30 * 60_000),
      },
    ],
    [
      "After it ended",
      {
        nextCallAt: iso(now + 7 * 86_400_000),
        kind: "checkin",
        joinCallAt: iso(now - 70 * 60_000),
        joinCallUrl: link,
        joinCallEndsAt: iso(now - 10 * 60_000),
      },
    ],
  ];
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4 sm:p-6">
      {rows.map(([caption, c]) => {
        const join = joinLink(c, now);
        return (
          <section
            key={caption}
            className="space-y-2 rounded-2xl border bg-card p-4 sm:p-6"
          >
            <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
              {caption}
            </p>
            <h2 className="text-xl font-semibold tracking-tight">
              Cedar &amp; Stone Interiors
            </h2>
            <p className="text-xs text-muted-foreground">
              Last message 27 Oct (2d ago) · last call 22 Oct (weekly)
              {c.nextCallAt ? (
                <>
                  {" · "}
                  <NextCallLine at={c.nextCallAt} kind={c.kind} />
                </>
              ) : (
                " · no call booked"
              )}
              {join ? (
                <>
                  {" · "}
                  <ExtLink href={join.href}>{join.label}</ExtLink>
                </>
              ) : null}
              {" · 1-1 notes 22 Oct"}
            </p>
          </section>
        );
      })}
    </div>
  );
}

function Index() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        1-1 notes harness
      </h1>
      <ul className="columns-2 gap-8 text-sm sm:columns-3">
        {[
          ...Object.keys(STATES),
          ...Object.keys(MESSAGE_STATES),
          "today",
          "today-failed",
          "queue",
          "today-recap-rows",
          "today-impromptu",
          "today-impromptu-failed",
          "today-place-sheet",
          "header-join",
        ].map(k => (
          <li key={k}>
            <a
              className="text-primary-ink hover:underline"
              href={`?state=${k}`}
            >
              {k}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function App() {
  useEffect(() => {
    if (state !== "queue") return;
    const t = setTimeout(
      () => document.querySelector("details")?.setAttribute("open", ""),
      300,
    );
    return () => clearTimeout(t);
  }, []);
  if (state === "today" || state === "queue") return <Today failed={false} />;
  if (state === "today-failed") return <Today failed />;
  if (state === "today-impromptu")
    return <Today failed={false} impromptu="rows" />;
  if (state === "today-impromptu-failed")
    return <Today failed={false} impromptu="failed" />;
  if (state === "today-place-sheet")
    return <Today failed={false} impromptu="sheet" />;
  if (state === "today-recap-rows") return <RecapRows />;
  if (MESSAGE_STATES[state]) return <MessagesCard name={state} />;
  if (state === "header-join") return <HeaderJoin />;
  const entry = STATES[state];
  if (!entry) return <Index />;
  return <Window entry={entry} name={state} />;
}

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <Toaster />
      <App />
    </StrictMode>,
  );
