import type { DeckKind } from "./sources";

/**
 * The call guide (docs/call-guide/DESIGN.md): each call's steps in order,
 * ticked by what really happened, with the step that is now lit and its
 * control wearing the beacon. Pure: the facts come from the call's channel
 * and the record (useCallFacts.ts); nothing here reads or writes anything.
 */

export type GuideGroup = "before" | "call" | "after";

/** A control the guide may light: `data-guide` on it, and a rule in present.css. */
export type GuideTarget =
  | "present"
  | "notes"
  | "part1"
  | "part2"
  | "part3"
  | "book-blueprint";

export interface CallFacts {
  /** A notes window answered on this call's channel (or this is it). */
  notesOpen: boolean;
  /** The shared deck posted where it is. */
  deckOpen: boolean;
  /** The shared deck was up, then its window closed. */
  deckClosed: boolean;
  /** The furthest slide the deck reached on this call, by its id. */
  reached: ReadonlySet<string>;
  /** The deck reached its last slide. */
  reachedEnd: boolean;
  /** The kickoff was sent, on this call or before it. */
  kickoffSent: boolean;
  /** A Brand Blueprint call is booked or held. */
  blueprintBooked: boolean;
  /** The Blueprint's parts: sent, or rehearsed in a rehearsal or practice. */
  parts: { 1: boolean; 2: boolean; 3: boolean };
}

export const noFacts = (): CallFacts => ({
  notesOpen: false,
  deckOpen: false,
  deckClosed: false,
  reached: new Set(),
  reachedEnd: false,
  kickoffSent: false,
  blueprintBooked: false,
  parts: { 1: false, 2: false, 3: false },
});

export interface GuideStep {
  id: string;
  group: GuideGroup;
  title: string;
  /** One sentence: how to do it, on this screen. */
  how: string;
  /** The control the beacon lights while this step is now. */
  target?: GuideTarget;
  done: (f: CallFacts) => boolean;
}

export const GROUP_NAME: Record<GuideGroup, string> = {
  before: "Before the call",
  call: "On the call",
  after: "After the call",
};

/** Where the guide is drawn: the CSM's own windows, or the creative director's page. */
export interface GuidePlace {
  /** Inside the creative director cockpit's page (host mode). */
  hosted: boolean;
}

const opened = (f: CallFacts) => f.notesOpen || f.deckOpen;

function csmOpening(deck: "onboarding" | "launch"): GuideStep[] {
  return [
    {
      id: "check",
      group: "before",
      title:
        deck === "launch"
          ? "Check the slides and their ads"
          : "Check the slides",
      how:
        deck === "launch"
          ? "Paste their Drive link here so their own ads are in the tray. An orange dot means a slide is missing something."
          : "An orange dot means a slide is missing something. Fix it here, or hide the slide.",
      done: f => opened(f) || f.kickoffSent,
    },
    {
      id: "notes",
      group: "before",
      title: "Open the notes window",
      how: "Keep it on your own screen. It says what to say on each slide and moves the deck with the arrow keys.",
      target: "notes",
      done: f => f.notesOpen || f.kickoffSent,
    },
    {
      id: "present",
      group: "before",
      title: "Present, then share only the deck window",
      how: "Present opens the deck in its own window. In Zoom or Meet, share that window, never the whole screen.",
      target: "present",
      done: f => f.deckOpen || f.kickoffSent,
    },
  ];
}

const ONBOARDING: GuideStep[] = [
  ...csmOpening("onboarding"),
  {
    id: "walk",
    group: "call",
    title: "Walk them through the slides",
    how: "Move with the arrow keys in the notes window. The notes follow each slide.",
    done: f => f.reached.has("kickoff") || f.reachedEnd || f.kickoffSent,
  },
  {
    id: "kickoff",
    group: "call",
    title: "Fill the kickoff form with them",
    how: "It is the last slide. Fill it together and press Submit before you hang up.",
    done: f => f.kickoffSent,
  },
  {
    id: "book",
    group: "call",
    title: "Book the Brand Blueprint call",
    how: "Press Book the Brand Blueprint call on the form's last screen or in the notes window. Pick a time one to three days out.",
    target: "book-blueprint",
    done: f => f.blueprintBooked,
  },
  {
    id: "close",
    group: "after",
    title: "Close the deck and send the group links",
    how: "Close the deck window. The notes window then has the links to copy for their group.",
    done: f => f.deckClosed,
  },
];

const LAUNCH: GuideStep[] = [
  ...csmOpening("launch"),
  {
    id: "walk",
    group: "call",
    title: "Walk them through the slides",
    how: "Move with the arrow keys in the notes window. The notes follow each slide.",
    done: f => f.reachedEnd,
  },
  {
    id: "close",
    group: "after",
    title: "Close the deck and send the summary",
    how: "Close the deck window. The notes window then has the summary and the reply to copy.",
    done: f => f.deckClosed,
  },
];

function blueprint(place: GuidePlace): GuideStep[] {
  return [
    {
      id: "prep",
      group: "before",
      title: "Read the prep and draft the offer",
      how: "Check what the kickoff already answered. Write your offer draft in their offer sheet before the call.",
      done: f => opened(f) || f.parts[1],
    },
    {
      id: "notes",
      group: "before",
      title: "Open the notes window on your second screen",
      how: place.hosted
        ? "Use Open the notes window at the top of this page. You type their answers there, slide by slide."
        : "You type their answers there, slide by slide.",
      target: "notes",
      done: f => f.notesOpen || f.parts[1],
    },
    {
      id: "present",
      group: "before",
      title: place.hosted
        ? "Present, then share this tab"
        : "Present, then share only the deck window",
      how: place.hosted
        ? "Present fills this tab with the deck. Share this tab only. F makes it full screen."
        : "Present opens the deck in its own window. Share that window only.",
      target: "present",
      done: f => f.deckOpen || f.parts[1],
    },
    {
      id: "part1",
      group: "call",
      title: "Send the starter ads to media",
      how: "On the starter ads slide, pick the pack, then press Send to media in the notes window.",
      target: "part1",
      done: f => f.parts[1],
    },
    {
      id: "offer",
      group: "call",
      title: "Build the offer with them",
      how: "On the offer slide, share their offer sheet from the notes window and fill it together.",
      done: f =>
        f.reached.has("read-back") || f.reached.has("next") || f.parts[2],
    },
    {
      id: "close",
      group: "call",
      title: "Book the launch call, then close the call",
      how: "On the last slide, book the launch call with them, then press Close the call.",
      target: "part2",
      done: f => f.parts[2],
    },
    {
      id: "lock",
      group: "after",
      title: "Lock the offer once it is final",
      how: "When the offer and the Brand DNA are done, press Lock the offer.",
      target: "part3",
      done: f => f.parts[3],
    },
  ];
}

export function guideFor(deck: DeckKind, place: GuidePlace): GuideStep[] {
  if (deck === "launch") return LAUNCH;
  if (deck === "blueprint") return blueprint(place);
  return ONBOARDING;
}

export type StepState = "done" | "now" | "later";

export interface GuideView {
  steps: (GuideStep & { state: StepState; n: number })[];
  /** The first step not done, or null when every step is done. */
  now: (GuideStep & { n: number }) | null;
  done: number;
  total: number;
}

/**
 * Each step's state. A step counts as done only by its own fact, so a step
 * skipped on the way (the notes window never opened) stays the one that is
 * now until it is done or a later fact covers it.
 */
export function guideView(steps: GuideStep[], f: CallFacts): GuideView {
  let now: GuideView["now"] = null;
  const out = steps.map((s, i) => {
    const n = i + 1;
    const isDone = s.done(f);
    if (!isDone && !now) {
      now = { ...s, n };
      return { ...s, n, state: "now" as const };
    }
    return { ...s, n, state: isDone ? ("done" as const) : ("later" as const) };
  });
  return {
    steps: out,
    now,
    done: out.filter(s => s.state === "done").length,
    total: out.length,
  };
}

/** The last step of "On the call" is done: this call counts towards help off. */
export function callFinished(steps: GuideStep[], f: CallFacts): boolean {
  const onCall = steps.filter(s => s.group === "call");
  const last = onCall[onCall.length - 1];
  return Boolean(last?.done(f));
}

// ---------------------------------------------------------------- help on or off

/** Help is on for a person's first three real calls of each kind. */
export const HELP_CALLS = 3;
export const HELP_KEY = "mahara-call-guide:v1";

interface HelpStore {
  /** Real calls finished in this browser, by deck: the cards they were for. */
  calls: Partial<Record<DeckKind, string[]>>;
  /** The person's own choice; absent follows the count. */
  help?: "on" | "off";
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

const store = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

export function readHelp(s: Storage | null = store()): HelpStore {
  try {
    const raw = s?.getItem(HELP_KEY);
    const v = raw ? (JSON.parse(raw) as HelpStore | null) : null;
    if (!v || typeof v !== "object" || typeof v.calls !== "object" || !v.calls)
      return { calls: {} };
    return v;
  } catch {
    return { calls: {} };
  }
}

function writeHelp(v: HelpStore, s: Storage | null = store()): void {
  try {
    s?.setItem(HELP_KEY, JSON.stringify(v));
  } catch {
    // private window or storage blocked: help stays as it is for this page
  }
}

/** Help on: the person's choice, else on until three real calls of this kind. */
export function helpOn(deck: DeckKind, v: HelpStore = readHelp()): boolean {
  if (v.help === "on") return true;
  if (v.help === "off") return false;
  return (v.calls[deck]?.length ?? 0) < HELP_CALLS;
}

export function setHelp(on: boolean, s: Storage | null = store()): HelpStore {
  const v = { ...readHelp(s), help: on ? ("on" as const) : ("off" as const) };
  writeHelp(v, s);
  return v;
}

/**
 * A real call of this kind finished for this card. Once per card, and never
 * for a rehearsal or a practice run: those are not calls.
 */
export function countCall(
  deck: DeckKind,
  taskId: string,
  s: Storage | null = store(),
): HelpStore {
  const v = readHelp(s);
  const seen = v.calls[deck] ?? [];
  if (seen.includes(taskId) || seen.length >= HELP_CALLS) return v;
  const next = { ...v, calls: { ...v.calls, [deck]: [...seen, taskId] } };
  writeHelp(next, s);
  return next;
}
