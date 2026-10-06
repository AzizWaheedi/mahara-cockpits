import {
  ArrowLeft,
  Bell,
  BellRing,
  CalendarClock,
  CalendarPlus,
  Check,
  Copy,
  ExternalLink,
  Flame,
  ListOrdered,
  PhoneCall,
  PhoneMissed,
  PhoneOff,
  Search,
  SkipForward,
} from "lucide-react";
import {
  type FormEvent,
  type MutableRefObject,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useSearchParams } from "react-router";
import { AdOrigin } from "../components/AdOrigin";
import { ProofToSend } from "../components/AssetPicker";
import { CallNotesList, useCallNotes } from "../components/CallNotes";
import {
  Conversation,
  ConversationFailed,
  useConversation,
} from "../components/Conversation";
import { SavedWorkLine } from "../components/DialSavedWork";
import { HotControl } from "../components/HotList";
import {
  button,
  buttonPrimary,
  EmptyState,
  Failed,
  FilterChip,
  field,
  StatTile,
  StatusChip,
  type Tone,
} from "../components/kit";
import { Answers } from "../components/LeadAnswers";
import { LeadTimeline, type LiveMessage } from "../components/LeadTimeline";
import { ResearchPanel } from "../components/ResearchPanel";
import { LiveBoundary } from "../components/RoomLine";
import { RoomPanel } from "../components/RoomPanel";
import {
  Blocks,
  BranchGroup,
  countryName,
  type Key,
  type Mode,
  Playbook,
  readPrefs,
  Segmented,
  useScript,
  writePrefs,
} from "../components/ScriptParts";
import {
  AutoVideoStrip,
  createAsk,
  ROOMS_UNREAD,
  type RoomsSetup,
  useLeadRoom,
  useRoomsSetup,
  VideoLinkButton,
  VideoPicker,
} from "../components/VideoLink";
import { ApiError, api, uncertain } from "../lib/api";
import { assetStage, objectionsFrom } from "../lib/assets";
import { CLIENT_NOTE, isClient } from "../lib/clients";
import {
  useLead,
  useLeadActivity,
  useLeadSearch,
  useNow,
  useSetting,
  useSnippets,
  useTemplates,
} from "../lib/data";
import {
  alertsWanted,
  callbackPicks,
  chime,
  clearDraft,
  type Draft,
  localInput,
  mmss,
  primeSound,
  readDraft,
  setAlertsWanted,
  spokeCallbackAt,
  type UrgentEvent,
  writeDraft,
} from "../lib/dialer";
import {
  type AfterMiss,
  afterMiss,
  afterSave,
  countsShown,
  type DialItem,
  type ItemKind,
  isNextLeadKey,
  lateSentence,
  liveSkips,
  type MissMoment,
  missedCallLine,
  openAfterRead,
  plainError,
  readyLine,
  rowTime,
  type SavedWork,
  type Skip,
  shortCountdown,
  skipFor,
  skipHolds,
  type Undialable,
  undialableLine,
  urgentFor,
} from "../lib/dialerUi";
import {
  ago,
  classLabel,
  clock,
  dayLabel,
  duration,
  isArabic,
  plainStage,
  when,
} from "../lib/format";
import {
  errorText,
  leaveToast,
  type RoomView,
  refusalCode,
  roomsApi,
  spokeAt,
  videoJoinedAt,
  workerDownOf,
} from "../lib/rooms";
import { type Fill, groupBlocks, personalise } from "../lib/script";
import { toast } from "../lib/toast";
import type { Lead, Me } from "../lib/types";
import {
  gateLine,
  linkPlanLine,
  missTrigger,
  NOBODY_SPOKE_VIDEO,
  PICKER_NONE,
  providerChoice,
  type Trigger,
  videoAppointmentId,
  videoLinkGate,
} from "../lib/videoLink";
import { firstWord, leadLanguage, type Moment } from "../lib/whatsapp";

/**
 * The power dialer, level with the call centre's (mahara-power-dialer): the
 * queue in the order the playbook says, one lead at a time with everything
 * about them beside the call, the call placed through Maqsam on the right
 * line for the lead's country, and Maqsam's own record of the call read back
 * while it runs. A call nobody answered saves itself and Next lead waits,
 * focused, for Enter; every outcome the rep saves opens the next lead at
 * once (a no-answer can open the message box instead), a booking goes on
 * the HighLevel calendar from here, and calling through the dialer is never
 * required before saving. A save answers as soon as the cockpit has it;
 * HighLevel's half follows, and one it has not taken shows as saved work.
 * No refresh swaps out a lead in a call, a booking or a note, and nothing
 * waits on the server for more than 45 seconds.
 */

interface Attempt {
  id: string;
  contact_id: string;
  state: string;
  started_at: string;
  error: string | null;
  maqsam_call_id?: string | null;
  call_state?: string | null;
  call_duration_s?: number | null;
}

interface Today {
  saved: number;
  calls: number;
  answered: number;
  unmatched: number;
  talk_s: number;
  booked: number;
  auto_no_answer: number;
  line: {
    calls: number;
    answered: number;
    talk_s: number;
    last_at: string | null;
  } | null;
}

interface Queue {
  as: "setter" | "closer";
  counts: number[];
  open: Attempt | null;
  today: Today;
  queue: DialItem[];
  /** Recent open leads the dialer cannot call: no number, or one it has no line for. */
  undialable?: Undialable;
  /** The rep's saves of the last day whose HighLevel half failed or is still waiting. */
  saved_work?: SavedWork[];
  /** When this copy was asked for, in the browser. */
  loadedAt: number;
}

/**
 * dial.queue's answer, or a thrown error: an answer without its queue, its
 * counts or its day is no answer, and the last good queue stays on screen
 * (a garbled 200 must not take the dialer, and an open video room, down).
 */
function readQueue(v: unknown): Omit<Queue, "loadedAt"> {
  const o =
    typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  const today = o?.today;
  if (
    !o ||
    !Array.isArray(o.queue) ||
    !Array.isArray(o.counts) ||
    !o.counts.every(n => typeof n === "number" && Number.isFinite(n)) ||
    typeof today !== "object" ||
    today === null
  )
    // Said after "The queue could not be read:".
    throw new Error(
      "the answer was not one, and the dialer tries again by itself",
    );
  const out = o as unknown as Omit<Queue, "loadedAt">;
  return {
    ...out,
    queue: (o.queue as unknown[]).filter(
      (i): i is DialItem =>
        typeof i === "object" &&
        i !== null &&
        typeof (i as DialItem).contact_id === "string",
    ),
    open:
      typeof o.open === "object" && o.open !== null
        ? (o.open as Attempt)
        : null,
  };
}

interface CallInfo {
  final: boolean;
  answered: boolean;
  seconds: number;
  words: string;
}

interface Slots {
  kind: "intro" | "demo";
  calendar_id: string;
  calendar: string;
  minutes: number;
  with: "me" | "anyone";
  /** Asked for the rep's own times, found none, so these are the team's. */
  fallback: boolean;
  on_team: boolean;
  notice: string;
  existing: { id: string; start: string; words: string } | null;
  /** When moving a booked call: the call as it stands. */
  moving?: { id: string; start: string; words: string } | null;
  days: { day: string; slots: string[] }[];
}

type As = "setter" | "closer";
type TierFilter = "all" | "0" | "1" | "2" | "3";

const TIER: Record<number, { tone: Tone; label: string }> = {
  0: { tone: "critical", label: "Call now" },
  1: { tone: "warning", label: "Today" },
  2: { tone: "neutral", label: "Due" },
  3: { tone: "neutral", label: "Never called" },
};

const TIER_DOT: Record<number, string> = {
  0: "var(--destructive)",
  1: "var(--warning)",
  2: "var(--primary)",
  3: "var(--muted-foreground)",
};

interface OutcomeDef {
  key: string;
  label: string;
  needsNote: boolean;
  hint: string;
}

const LEAD_OUTCOMES: OutcomeDef[] = [
  {
    key: "no_answer",
    label: "No answer",
    needsNote: false,
    hint: "Tries again at 17:00, then the next two mornings, then leaves them as unreachable.",
  },
  {
    key: "callback",
    label: "Call back",
    needsNote: true,
    hint: "Comes back to you at the time you pick.",
  },
  {
    key: "booked",
    label: "Booked",
    needsNote: true,
    hint: "Pick a time on the calendar; it goes on HighLevel from here.",
  },
  {
    key: "not_interested",
    label: "Not interested",
    needsNote: true,
    hint: "Out of the queue until they write again.",
  },
  {
    key: "disqualified",
    label: "Disqualified",
    needsNote: true,
    hint: "Not a fit. Out of the queue until they write again.",
  },
  {
    key: "wrong_number",
    label: "Wrong number",
    needsNote: true,
    hint: "The number is not theirs. Out of the queue.",
  },
  {
    key: "handled",
    label: "Handled",
    needsNote: true,
    hint: "Dealt with another way. A call-back already set stays; otherwise out of the queue.",
  },
];

/** What each kind of dialer item can end in (sales-api dialer.ts appointmentEffect). */
const OUTCOMES: Record<ItemKind, OutcomeDef[]> = {
  lead: LEAD_OUTCOMES,
  intro: [
    {
      key: "showed",
      label: "Held it",
      needsNote: true,
      hint: "Marks the intro showed (in HighLevel too). Then book the demo or set a call-back.",
    },
    {
      key: "disqualified",
      label: "Not a fit",
      needsNote: true,
      hint: "Marks the intro disqualified and closes the lead.",
    },
    {
      key: "no_answer",
      label: "No answer",
      needsNote: false,
      hint: "Nothing is marked yet: try again inside the intro's twenty minutes.",
    },
    {
      key: "noshow",
      label: "No-show",
      needsNote: false,
      hint: "Marks the intro a no-show; the lead comes back to be rebooked.",
    },
    {
      key: "rescheduled",
      label: "Reschedule",
      needsNote: true,
      hint: "Move the intro to another free time with you.",
    },
  ],
  confirm: [
    {
      key: "confirmed",
      label: "Confirmed",
      needsNote: false,
      hint: "They will be there. Kept in the cockpit; the call stays as booked.",
    },
    {
      key: "no_answer",
      label: "No answer",
      needsNote: false,
      hint: "Tries again in two hours (half an hour near the call). Message them too.",
    },
    {
      key: "rescheduled",
      label: "Reschedule",
      needsNote: true,
      hint: "Move the call to a time that suits them; that counts as confirmed.",
    },
    {
      key: "cancelled",
      label: "Cancelled",
      needsNote: true,
      hint: "Marks the call cancelled (in HighLevel too); they come back tomorrow morning to rebook.",
    },
    {
      key: "not_interested",
      label: "Not coming",
      needsNote: true,
      hint: "Cancels the call and closes the lead.",
    },
  ],
};

const msg = (e: unknown) => String((e as Error)?.message ?? e);

/** The server said no with this status (409: its state and the page's differ). */
const refusedWith = (e: unknown, status: number) =>
  e instanceof ApiError && e.status === status;

/** Whether keys go to a text box right now (Alt+→ moves its cursor there). */
function typing(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    (el.tagName === "INPUT" &&
      !["button", "checkbox", "radio", "submit"].includes(
        (el as HTMLInputElement).type,
      ))
  );
}

// ---------------------------------------------------------------------------
// The rep's Maqsam seat
// ---------------------------------------------------------------------------

interface Agent {
  email: string | null;
  from: "seat" | "b2b" | null;
  ready: boolean;
  state: string;
}

/** The rep's Maqsam seat, asked every 30 seconds while the page is open. */
function useAgent() {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const check = useCallback(async () => {
    try {
      setAgent(await api<Agent>("dial.agent", {}));
      setError(null);
    } catch (e) {
      setError(msg(e));
    }
  }, []);
  useEffect(() => {
    void check();
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, 30_000);
    return () => window.clearInterval(t);
  }, [check]);
  return { agent, error, check };
}

const AGENT_WORDS: Record<string, { tone: Tone; chip: string; text: string }> =
  {
    available: {
      tone: "good",
      chip: "Maqsam ready",
      text: "A call rings you in the Maqsam softphone first, then the lead.",
    },
    absent: {
      tone: "warning",
      chip: "Away in Maqsam",
      text: "Set yourself Available in the Maqsam softphone, then call.",
    },
    busy: {
      tone: "neutral",
      chip: "On a call in Maqsam",
      text: "The next call goes once that one ends.",
    },
    switched_off: {
      tone: "critical",
      chip: "Maqsam seat off",
      text: "Your Maqsam seat is switched off. Ask Aziz to turn it on.",
    },
    no_outgoing: {
      tone: "critical",
      chip: "Cannot call out",
      text: "Your Maqsam seat cannot make outgoing calls. Ask Aziz to allow it.",
    },
  };

function MaqsamLine({
  agent,
  error,
  onCheck,
}: {
  agent: Agent | null;
  error: string | null;
  onCheck: () => void;
}) {
  if (error)
    return (
      <p className="callout-warn rounded-[var(--radius-md)] border px-3 py-2 text-xs">
        Maqsam could not be asked about your seat: {error}{" "}
        <button type="button" onClick={onCheck} className="underline">
          Ask again
        </button>
      </p>
    );
  if (!agent) return null;
  if (agent.state === "no_address")
    return (
      <p className="callout-warn rounded-[var(--radius-md)] border px-3 py-2 text-xs">
        Your seat has no Maqsam address, so calls cannot go through the dialer.
        Ask Aziz to add it on the Team page. You can still work the list and
        save what happened.
      </p>
    );
  if (agent.state === "not_found")
    return (
      <p className="callout-bad rounded-[var(--radius-md)] border px-3 py-2 text-xs">
        Maqsam has no seat with the address {agent.email}. Ask Aziz to fix it on
        the Team page or in Maqsam.
      </p>
    );
  const w = AGENT_WORDS[agent.state] ?? {
    tone: "neutral" as Tone,
    chip: `Maqsam: ${agent.state}`,
    text: "Set yourself Available in the Maqsam softphone to take calls.",
  };
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip tone={w.tone} label={w.chip} size="md" />
        <button
          type="button"
          onClick={onCheck}
          className="muted text-xs underline underline-offset-2"
        >
          Check again
        </button>
      </div>
      <p className="muted text-xs">
        {w.text} Calls go out as {agent.email}
        {agent.from === "b2b" ? " (from B2B's rep list)" : ""}.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export default function DialerPage({ me }: { me: Me }) {
  const canBoth = me.manager || me.role === "both";
  const [as, setAs] = useState<As>(me.role === "closer" ? "closer" : "setter");
  const [q, setQ] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Skipped leads, with the tier and reason they were skipped for: a skip
  // lapses after 30 minutes, or sooner when the lead moves or writes again.
  const [skipped, setSkipped] = useState<Record<string, Skip>>({});
  // Calls saved or let go on this page: a queue read that left before the
  // save landed must not bring one back as the open call.
  const [spent, setSpent] = useState<ReadonlySet<string>>(() => new Set());
  const [savedAt, setSavedAt] = useState<Record<string, number>>({});
  const [picked, setPicked] = useState<string | null>(null);
  // The lead page's "Open in the dialer", and its room panel's next step
  // after a join (stress2 round 4): that lead on screen, as a search pick.
  const [params, setParams] = useSearchParams();
  const askedLead = params.get("lead");
  useEffect(() => {
    if (!askedLead || !/^[A-Za-z0-9_-]{1,80}$/.test(askedLead)) return;
    setPicked(askedLead);
    setParams(
      p => {
        const next = new URLSearchParams(p);
        next.delete("lead");
        return next;
      },
      { replace: true },
    );
  }, [askedLead, setParams]);
  const [tier, setTier] = useState<TierFilter>("all");
  const [term, setTerm] = useState("");
  const [alertsOn, setAlertsOn] = useState(alertsWanted);
  // Bumped to open the lead's conversation from the call pane ("Write to
  // them"), with the ready-made message to start from, if any.
  const [talk, setTalk] = useState<{ n: number; moment: Moment | null }>({
    n: 0,
    moment: null,
  });
  // Saves sent to HighLevel again from here: off the list at once.
  const [resent, setResent] = useState<ReadonlySet<string>>(() => new Set());
  const maqsam = useAgent();
  const wa = useWaKit();
  // The video room switches, read once for every lead the page shows.
  const roomsSetup = useRoomsSetup();
  // The call this page placed, and when: a read of the queue asked before
  // it cannot know it, so that read must not end it on screen.
  const placed = useRef<{ attempt: Attempt; at: number } | null>(null);

  // One read at a time; a read asked for meanwhile runs right after.
  const asRef = useRef(as);
  asRef.current = as;
  const busyLoad = useRef(false);
  const again = useRef(false);
  const load = useCallback(async () => {
    if (busyLoad.current) {
      again.current = true;
      return;
    }
    busyLoad.current = true;
    try {
      do {
        again.current = false;
        const asked = asRef.current;
        const loadedAt = Date.now();
        try {
          const out = readQueue(
            await api<unknown>("dial.queue", {
              as: asked,
              limit: 80,
            }),
          );
          if (asked === asRef.current) {
            setQ({
              ...out,
              open: openAfterRead(out.open, placed.current, loadedAt),
              loadedAt,
            });
            setError(null);
          }
        } catch (e) {
          if (asked === asRef.current) setError(msg(e));
        }
      } while (again.current);
    } finally {
      busyLoad.current = false;
    }
  }, []);

  // The queue every 15 seconds while the page is in front, 30 behind it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new queue kind starts a new loop
  useEffect(() => {
    let alive = true;
    let t = 0;
    const loop = async () => {
      await load();
      if (!alive) return;
      t = window.setTimeout(
        loop,
        document.visibilityState === "visible" ? 15_000 : 30_000,
      );
    };
    void loop();
    const onShow = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      alive = false;
      window.clearTimeout(t);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [as, load]);

  const open = q?.open && !spent.has(q.open.id) ? q.open : null;
  const visible = useMemo(() => {
    const now = Date.now();
    return (q?.queue ?? []).filter(
      i =>
        !skipHolds(skipped[i.contact_id], i, now) &&
        !(savedAt[i.contact_id] && (q?.loadedAt ?? 0) < savedAt[i.contact_id]),
    );
  }, [q, skipped, savedAt]);
  // Each read of the queue lets go of the skips that no longer hold, so a
  // lead that comes back for a new reason stays back.
  useEffect(() => {
    if (q) setSkipped(s => liveSkips(s, q.queue, Date.now()));
  }, [q]);
  const priority = visible[0] ?? null;
  const currentId = open?.contact_id ?? picked ?? priority?.contact_id ?? null;
  const current =
    (q?.queue ?? []).find(i => i.contact_id === currentId) ?? null;
  const manual = !open && picked !== null && picked !== priority?.contact_id;
  const urgent = useMemo(
    () =>
      urgentFor(visible, Date.now()).filter(
        e => e.contact_id !== open?.contact_id,
      ),
    [visible, open?.contact_id],
  );
  // Nobody shows only because the rep skipped them: say so, and undo it.
  const allSkipped =
    !visible.length &&
    (q?.queue ?? []).some(i => skipHolds(skipped[i.contact_id], i, Date.now()));
  const savedWork = (q?.saved_work ?? []).filter(
    w => !resent.has(w.attempt_id),
  );

  // A "call now" lead the rep has not been told about: a sound, and a
  // desktop notification while the tab is behind another.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!q) return;
    if (seen.current === null) {
      seen.current = new Set(urgent.map(e => e.key));
      return;
    }
    const fresh = urgent.filter(e => !seen.current?.has(e.key));
    for (const e of fresh) seen.current.add(e.key);
    if (!fresh.length || !alertsOn) return;
    chime();
    if (
      document.visibilityState !== "visible" &&
      "Notification" in window &&
      Notification.permission === "granted"
    )
      for (const e of fresh.slice(0, 3)) {
        // Chrome on Android refuses this constructor outside a service
        // worker; the chime has played, so the page carries on without it.
        try {
          new Notification(`${e.title}: ${e.name ?? "a lead"}`, {
            body: e.callback
              ? "Call them back now, as agreed."
              : "Dial within two minutes.",
            tag: e.key,
          });
        } catch {
          break;
        }
      }
  }, [q, urgent, alertsOn]);

  // After a reload the browser wants a click before it plays sound again.
  useEffect(() => {
    if (!alertsOn) return;
    const wake = () => primeSound();
    window.addEventListener("pointerdown", wake, { once: true });
    return () => window.removeEventListener("pointerdown", wake);
  }, [alertsOn]);

  async function toggleAlerts() {
    if (alertsOn) {
      setAlertsOn(false);
      setAlertsWanted(false);
      return;
    }
    primeSound();
    chime();
    if ("Notification" in window && Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        // the sound still works
      }
    }
    setAlertsOn(true);
    setAlertsWanted(true);
    toast.success(
      "Alerts on: a sound for every new lead to call now, and a desktop notice when this tab is behind another.",
    );
  }

  // The call centre's keys: Alt+D calls, Alt+N goes to the notes, and
  // Alt+→ opens the next lead where Next lead shows (not while typing, where
  // it moves the cursor by a word).
  const callRef = useRef<(() => void) | null>(null);
  const nextRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isNextLeadKey(e, typing())) {
        if (!nextRef.current) return;
        e.preventDefault();
        nextRef.current();
        return;
      }
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.code === "KeyD") {
        e.preventDefault();
        callRef.current?.();
      } else if (e.code === "KeyN") {
        e.preventDefault();
        document.getElementById("dial-note")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The lead's call on this page is done (saved, or let go): it is never
  // shown as open again, whatever an earlier read of the queue says.
  function closeCall(contactId: string) {
    const done = open?.contact_id === contactId ? open.id : null;
    if (done) setSpent(s => new Set(s).add(done));
    if (placed.current?.attempt.contact_id === contactId) placed.current = null;
    setQ(prev =>
      prev && prev.open?.contact_id === contactId
        ? { ...prev, open: null }
        : prev,
    );
  }

  function finished(
    contactId: string,
    how: "saved" | "skipped",
    words?: string,
  ) {
    if (how === "skipped") {
      const item = q?.queue.find(i => i.contact_id === contactId);
      if (item)
        setSkipped(s => ({ ...s, [contactId]: skipFor(item, Date.now()) }));
    } else setSavedAt(s => ({ ...s, [contactId]: Date.now() }));
    closeCall(contactId);
    // A save that lands after the rep moved to another lead leaves that
    // lead where it is.
    setPicked(p => (p === contactId ? null : p));
    if (words) toast.success(words);
    void load();
    void maqsam.check();
  }

  // Saved with a next step (the intro held, a no-answer to message): the
  // lead stays on screen, whatever the queue reads next, until the rep
  // moves on. The call it was saved on is done, so anything saved after it
  // is a save of its own.
  function stay(contactId: string) {
    closeCall(contactId);
    setPicked(contactId);
    void load();
    void maqsam.check();
  }

  function switchQueue(v: As) {
    if (v === as) return;
    if (open) {
      toast.error(
        "Save or skip the call that is open first, then switch queues.",
      );
      return;
    }
    setAs(v);
    setQ(null);
    setPicked(null);
    setSkipped({});
  }

  const counts = q?.counts ?? [0, 0, 0, 0];
  const ready = counts.reduce((a, b) => a + b, 0);
  // The chips count what the list shows, not the leads it is hiding.
  const listCounts = q ? countsShown(q.counts, q.queue, visible) : counts;

  return (
    <main className="mx-auto w-full max-w-[1800px] space-y-4 px-4 py-5 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dialer</h1>
          {q && ready ? null : (
            <p className="muted mt-1 text-sm">
              {q
                ? "Nobody waiting. New leads, replies and call-backs come in by themselves."
                : "Working out who to call…"}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canBoth ? (
            <Segmented
              label="Queue"
              value={as}
              options={[
                ["setter", "Setter queue"],
                ["closer", "Closer queue"],
              ]}
              onChange={v => switchQueue(v as As)}
            />
          ) : null}
          <button
            type="button"
            onClick={toggleAlerts}
            aria-pressed={alertsOn}
            className={button}
            title="A sound for every new lead to call now, and a desktop notice when this tab is behind another"
          >
            {alertsOn ? (
              <BellRing className="size-3.5" aria-hidden />
            ) : (
              <Bell className="size-3.5" aria-hidden />
            )}
            {alertsOn ? "Alerts on" : "Turn on alerts"}
          </button>
        </div>
      </header>

      {error ? (
        <div className="callout-bad rounded-[var(--radius-md)] border px-3 py-2 text-sm">
          The queue could not be read: {error}{" "}
          <button type="button" onClick={load} className="underline">
            Try again
          </button>
        </div>
      ) : null}

      <Stats q={q} />

      <SavedWorkLine
        items={savedWork}
        onSent={id => setResent(s => new Set(s).add(id))}
      />

      <UrgentStrip
        events={urgent}
        locked={Boolean(open)}
        onPick={id => setPicked(id)}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[16rem_minmax(0,1fr)] lg:[grid-template-areas:'queue_call'_'queue_lead'] xl:grid-cols-[15rem_minmax(0,1fr)_21rem] xl:[grid-template-areas:'queue_lead_call']">
        <QueuePane
          className="lg:[grid-area:queue]"
          loaded={Boolean(q)}
          items={visible}
          counts={listCounts}
          undialable={undialableLine(q?.undialable)}
          currentId={currentId}
          manual={manual}
          locked={Boolean(open)}
          tier={tier}
          setTier={setTier}
          term={term}
          setTerm={setTerm}
          onPick={id => setPicked(id)}
          onBack={() => {
            setPicked(null);
            setTerm("");
          }}
        />
        {currentId ? (
          <LeadWork
            key={currentId}
            me={me}
            as={as}
            contactId={currentId}
            item={current}
            open={open?.contact_id === currentId ? open : null}
            pinned={picked === currentId}
            agent={maqsam}
            callRef={callRef}
            nextRef={nextRef}
            wa={wa}
            roomsSetup={roomsSetup}
            talk={talk}
            onCalled={a => {
              placed.current = { attempt: a, at: Date.now() };
              setQ(prev => (prev ? { ...prev, open: a } : prev));
            }}
            onFinished={finished}
            onStay={stay}
            onPin={id => setPicked(id)}
            onRefresh={() => void load()}
            onTalk={moment =>
              setTalk(t => ({ n: t.n + 1, moment: moment ?? null }))
            }
          />
        ) : q ? (
          <div className="panel lg:[grid-area:call] xl:[grid-area:lead/lead/call/call]">
            {allSkipped ? (
              <EmptyState
                icon={SkipForward}
                title="Everyone waiting is skipped"
                text="A skip holds for half an hour, or until the lead writes, calls or moves up the queue."
                action={
                  <button
                    type="button"
                    onClick={() => setSkipped({})}
                    className={button}
                  >
                    Show the skipped leads
                  </button>
                }
              />
            ) : (
              <EmptyState
                icon={PhoneCall}
                title="Nobody to call right now"
                text="New leads, replies, missed calls and due call-backs appear here as they happen; the queue checks every 15 seconds. Search the queue's box to call someone in particular."
              />
            )}
          </div>
        ) : null}
      </div>
    </main>
  );
}

/**
 * The lead on screen: the call beside everything about them. One read of
 * the lead's conversation serves both panes, so the call pane knows which
 * channel a message can go on after a missed call.
 */
function LeadWork({
  me,
  as,
  contactId,
  item,
  open,
  pinned,
  agent,
  callRef,
  nextRef,
  wa,
  roomsSetup,
  talk,
  onCalled,
  onFinished,
  onStay,
  onPin,
  onRefresh,
  onTalk,
}: {
  me: Me;
  as: As;
  contactId: string;
  item: DialItem | null;
  open: Attempt | null;
  /** The rep chose this lead (or is working on it), so the queue cannot swap it out. */
  pinned: boolean;
  agent: ReturnType<typeof useAgent>;
  callRef: MutableRefObject<(() => void) | null>;
  /** Next lead, for Alt+→, while it shows. */
  nextRef: MutableRefObject<(() => void) | null>;
  wa: WaKit;
  roomsSetup: RoomsSetup;
  talk: { n: number; moment: Moment | null };
  onCalled: (a: Attempt) => void;
  onFinished: (
    contactId: string,
    how: "saved" | "skipped",
    words?: string,
  ) => void;
  onStay: (contactId: string) => void;
  onPin: (contactId: string) => void;
  /** Read the queue again: the server's state and the page's differ. */
  onRefresh: () => void;
  onTalk: (moment?: Moment) => void;
}) {
  const convo = useConversation(contactId);
  return (
    <>
      <CallPane
        className={`lg:[grid-area:call] xl:sticky xl:top-4 xl:self-start ${
          open ? "glow-teal" : ""
        }`}
        me={me}
        as={as}
        contactId={contactId}
        item={item}
        open={open}
        pinned={pinned}
        agent={agent}
        callRef={callRef}
        nextRef={nextRef}
        convo={convo}
        wa={wa}
        roomsSetup={roomsSetup}
        onCalled={onCalled}
        onFinished={onFinished}
        onStay={onStay}
        onPin={onPin}
        onRefresh={onRefresh}
        onTalk={onTalk}
      />
      <LeadPane
        className="lg:[grid-area:lead]"
        me={me}
        as={as}
        contactId={contactId}
        item={item}
        talk={talk}
        convo={convo}
        // Writing to the lead (a WhatsApp, research) keeps them on screen,
        // as a note in the call pane does.
        onTyping={() => {
          if (!pinned) onPin(contactId);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// The day's numbers and the "call now" strip
// ---------------------------------------------------------------------------

function Stats({ q }: { q: Queue | null }) {
  const t = q?.today ?? null;
  const line = t?.line ?? null;
  const ready = q ? q.counts.reduce((a, b) => a + b, 0) : null;
  return (
    <>
      {/* The day in one line until the tiles fit beside the three columns, so Call stays near the top. */}
      <p className="muted text-sm 2xl:hidden">
        {t && ready !== null
          ? `Today: ${t.saved} saved · ${t.answered} of ${t.calls} answered · ${t.booked} booked · ${ready} ready`
          : "Reading today's numbers…"}
      </p>
      <div className="hidden grid-cols-2 gap-3 lg:grid-cols-4 2xl:grid">
        <StatTile
          label="Saved today"
          value={t ? String(t.saved) : null}
          sub={
            t
              ? t.auto_no_answer
                ? `${t.auto_no_answer} no-answer${t.auto_no_answer === 1 ? "" : "s"} saved from Maqsam's record`
                : "Outcomes saved in the dialer"
              : undefined
          }
          hint="Every outcome saved in the dialer today (Kuwait time), with or without a call through it."
        />
        <StatTile
          label="Answered"
          value={t ? `${t.answered} of ${t.calls}` : null}
          sub={
            t ? (
              <>
                {t.calls
                  ? `${Math.round((t.answered / t.calls) * 100)}% connect rate · ${duration(t.talk_s)} talking`
                  : "No calls through the dialer yet today"}
                {line ? (
                  <span className="block">
                    Your Maqsam line: {line.calls} call
                    {line.calls === 1 ? "" : "s"}, softphone included
                  </span>
                ) : null}
              </>
            ) : undefined
          }
          hint="Calls placed through the dialer today and what Maqsam's record says of each; a call whose record has not come back yet is not counted as answered. The line figure is every outbound call on your Maqsam seat as B2B copies it, a few minutes behind."
        />
        <StatTile
          label="Booked today"
          value={t ? String(t.booked) : null}
          sub="Intros and demos booked from the dialer"
        />
        <StatTile
          label="Ready in queue"
          value={ready === null ? null : String(ready)}
          sub={
            q ? `${q.counts[0]} to call now · ${q.counts[1]} today` : undefined
          }
        />
      </div>
    </>
  );
}

function UrgentStrip({
  events,
  locked,
  onPick,
}: {
  events: UrgentEvent[];
  locked: boolean;
  onPick: (contactId: string) => void;
}) {
  const now = useNow(1000);
  if (!events.length) return null;
  return (
    <section
      aria-label="Leads to call now"
      className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3"
    >
      {events.slice(0, 3).map(e => {
        const late = e.deadline <= now;
        return (
          <button
            key={e.key}
            type="button"
            disabled={locked}
            title={
              locked ? "Save or skip the call that is open first" : undefined
            }
            onClick={() => onPick(e.contact_id)}
            className="panel flex min-w-0 items-center gap-3 border-s-[3px] px-3 py-2.5 text-left hover:bg-[color:var(--secondary)] disabled:opacity-70"
            style={{
              borderInlineStartColor: late
                ? "var(--destructive)"
                : "var(--warning)",
            }}
          >
            <span className="min-w-0 flex-1">
              <span className="muted block text-xs">{e.title}</span>
              <span
                className={`block truncate text-sm font-semibold ${isArabic(e.name) ? "ar" : ""}`}
                dir="auto"
              >
                {e.name ?? "Unnamed lead"}
              </span>
            </span>
            <span
              className="shrink-0 whitespace-nowrap text-right text-sm font-semibold tabular-nums"
              style={{ color: late ? "var(--destructive)" : undefined }}
            >
              {shortCountdown(e, now)}
            </span>
          </button>
        );
      })}
      {events.length > 3 ? (
        <p className="muted self-center text-xs">
          {events.length - 3} more to call now in the queue.
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

function QueuePane({
  className,
  loaded,
  items,
  counts,
  undialable,
  currentId,
  manual,
  locked,
  tier,
  setTier,
  term,
  setTerm,
  onPick,
  onBack,
}: {
  className: string;
  loaded: boolean;
  items: DialItem[];
  counts: number[];
  /** A line on recent leads the dialer cannot call, when there are any. */
  undialable: string | null;
  currentId: string | null;
  manual: boolean;
  locked: boolean;
  tier: TierFilter;
  setTier: (t: TierFilter) => void;
  term: string;
  setTerm: (t: string) => void;
  onPick: (contactId: string) => void;
  onBack: () => void;
}) {
  const [openOnPhone, setOpenOnPhone] = useState(false);
  const now = useNow(60_000);
  const searching = term.trim().length >= 2;
  const found = useLeadSearch(searching ? term : "");
  const list =
    tier === "all" ? items : items.filter(i => String(i.tier) === tier);
  const total = counts.reduce((a, b) => a + b, 0);
  const lockedTitle = "Save or skip the call that is open first";
  // On a phone the list folds away once a lead is picked, so Call is in view.
  const pick = (id: string) => {
    setOpenOnPhone(false);
    onPick(id);
  };

  return (
    <section
      aria-label="Queue"
      className={`panel flex min-w-0 flex-col overflow-hidden lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:self-start ${className}`}
    >
      <header className="flex items-center justify-between gap-2 border-b hairline px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpenOnPhone(o => !o)}
          aria-expanded={openOnPhone}
          className="flex items-center gap-1.5 text-sm font-semibold tracking-tight lg:pointer-events-none"
        >
          <ListOrdered className="size-4" aria-hidden />
          Queue
          <span className="muted font-normal tabular-nums">
            {loaded ? total : "…"}
          </span>
          <span className="muted text-xs font-normal lg:hidden">
            {openOnPhone ? "Hide" : "Show"}
          </span>
        </button>
        {manual ? (
          <button
            type="button"
            onClick={onBack}
            className="text-xs font-medium underline underline-offset-2"
          >
            Back to priority
          </button>
        ) : null}
      </header>
      <div
        className={`${openOnPhone ? "flex" : "hidden"} min-h-0 flex-1 flex-col lg:flex`}
      >
        <div className="space-y-2 border-b hairline p-3">
          <label className="relative block">
            <span className="sr-only">Search leads</span>
            <Search
              className="muted pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
              aria-hidden
            />
            <input
              value={term}
              onChange={e => setTerm(e.target.value)}
              placeholder="Name, company or number"
              className={`${field} h-8 pl-8`}
              dir="auto"
            />
          </label>
          {!searching ? (
            <div
              className="flex flex-wrap gap-1"
              role="group"
              aria-label="Show"
            >
              {(
                [
                  ["all", "All", total],
                  ["0", "Now", counts[0]],
                  ["1", "Today", counts[1]],
                  ["2", "Due", counts[2]],
                  ["3", "Never", counts[3]],
                ] as [TierFilter, string, number][]
              )
                .filter(
                  ([k, , n]) =>
                    n > 0 || (k === "all" ? tier !== "all" : tier === k),
                )
                .map(([k, label, n]) => (
                  <FilterChip
                    key={k}
                    on={tier === k}
                    onClick={() => setTier(k)}
                    count={n}
                  >
                    {label}
                  </FilterChip>
                ))}
            </div>
          ) : null}
        </div>
        <ul className="max-h-[55vh] min-h-0 flex-1 divide-y hairline overflow-y-auto lg:max-h-none">
          {searching ? (
            found.loading && !found.data ? (
              <li className="muted px-3 py-3 text-xs">Searching…</li>
            ) : found.error ? (
              <li className="px-3 py-3">
                <Failed what="The search" error={found.error} />
              </li>
            ) : (found.data ?? []).length ? (
              (found.data ?? []).map(l => (
                <li key={l.contact_id}>
                  <button
                    type="button"
                    disabled={locked && l.contact_id !== currentId}
                    title={locked ? lockedTitle : undefined}
                    aria-current={l.contact_id === currentId}
                    onClick={() => pick(l.contact_id)}
                    className="flex w-full min-w-0 flex-col px-3 py-2 text-left hover:bg-[color:var(--secondary)] disabled:opacity-60 aria-[current=true]:bg-[color:var(--secondary)]"
                  >
                    <span
                      className={`truncate text-sm font-medium ${isArabic(l.name) ? "ar" : ""}`}
                      dir="auto"
                    >
                      {l.name ?? "Unnamed lead"}
                    </span>
                    <span className="muted truncate text-xs">
                      {[
                        classLabel(l.lead_class),
                        l.company,
                        l.lead_created_at
                          ? `came in ${ago(l.lead_created_at, now)}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                </li>
              ))
            ) : (
              <li className="muted px-3 py-3 text-xs">
                No lead matches "{term.trim()}".
              </li>
            )
          ) : !loaded ? (
            <li className="muted px-3 py-3 text-xs">Reading the queue…</li>
          ) : list.length ? (
            list.map(i => (
              <li key={i.contact_id}>
                <button
                  type="button"
                  disabled={locked && i.contact_id !== currentId}
                  title={locked ? lockedTitle : undefined}
                  aria-current={i.contact_id === currentId}
                  onClick={() => pick(i.contact_id)}
                  className="flex w-full min-w-0 items-start gap-2 px-3 py-2 text-left hover:bg-[color:var(--secondary)] disabled:opacity-60 aria-[current=true]:bg-[color:var(--secondary)]"
                >
                  <span
                    className="mt-1.5 size-2 shrink-0 rounded-full"
                    style={{ background: TIER_DOT[i.tier] }}
                    title={TIER[i.tier].label}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-sm font-medium ${isArabic(i.name) ? "ar" : ""}`}
                      dir="auto"
                    >
                      {i.name ?? "Unnamed lead"}
                    </span>
                    <span className="muted block truncate text-xs">
                      {i.kind === "intro" || i.kind === "confirm" ? (
                        <CalendarClock
                          className="me-1 inline size-3 align-[-2px]"
                          aria-hidden
                        />
                      ) : missedCallLine(i, now) ? (
                        <PhoneMissed
                          className="me-1 inline size-3 align-[-2px]"
                          aria-hidden
                        />
                      ) : null}
                      {i.why}
                    </span>
                    {i.hot_reasons?.length ? (
                      // Teal sits on the flame; the words stay in text colour.
                      <span className="dim block truncate text-[11px]">
                        {i.hot ? (
                          <Flame
                            className="me-0.5 inline size-3 align-[-2px]"
                            style={{ color: "var(--primary)" }}
                            aria-hidden
                          />
                        ) : null}
                        {i.hot_reasons.join(" · ")}
                      </span>
                    ) : null}
                  </span>
                  <span className="muted shrink-0 pt-0.5 text-[11px] tabular-nums">
                    {rowTime(i, now)}
                  </span>
                </button>
              </li>
            ))
          ) : (
            <li className="muted px-3 py-3 text-xs">
              {tier === "all"
                ? "Nobody in the queue right now."
                : "Nobody in this part of the queue."}
            </li>
          )}
        </ul>
        {!searching && undialable ? (
          <p className="muted border-t hairline px-3 py-2 text-xs leading-relaxed">
            {undialable}
          </p>
        ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The call: the line's state, Call, and how it went
// ---------------------------------------------------------------------------

/**
 * Maqsam's record of the open call, asked every few seconds until it ends.
 * What it says belongs to that one call: the next call on the same lead
 * starts with no record, never the last call's.
 */
function useCallStatus(attempt: Attempt | null, onAutoSaved: () => void) {
  const [seen, setSeen] = useState<{
    id: string;
    call: CallInfo | null;
    error: string | null;
  } | null>(null);
  const done = useRef(onAutoSaved);
  done.current = onAutoSaved;
  const id = attempt?.id ?? null;
  const placed = attempt?.state === "placed";
  const started = attempt ? Date.parse(attempt.started_at) : 0;
  useEffect(() => {
    if (!id || !placed) return;
    let alive = true;
    let t = 0;
    const tick = async () => {
      let again = true;
      try {
        const r = await api<{
          attempt: Attempt;
          call: CallInfo | null;
          auto_saved: boolean;
        }>("dial.status", { attempt_id: id });
        if (!alive) return;
        setSeen({ id, call: r.call, error: null });
        if (r.auto_saved) {
          done.current();
          again = false;
        } else if (r.attempt?.state !== "placed" || r.call?.final) {
          again = false;
        }
      } catch (e) {
        if (!alive) return;
        setSeen(s => ({
          id,
          call: s?.id === id ? s.call : null,
          error: msg(e),
        }));
        // The call is gone, or not this rep's: asking again cannot help.
        if (refusedWith(e, 404) || refusedWith(e, 403)) again = false;
      }
      if (!alive || !again) return;
      t = window.setTimeout(tick, Date.now() - started < 120_000 ? 4000 : 8000);
    };
    t = window.setTimeout(tick, 2500);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [id, placed, started]);
  const mine = seen && seen.id === id ? seen : null;
  return { call: mine?.call ?? null, error: mine?.error ?? null };
}

/**
 * What WhatsApp can carry, for every lead alike: whether an approved
 * template is live, and which moments have a ready-made message. Read once
 * for the page, not once per lead.
 */
interface WaKit {
  templatesLive: boolean | null;
  moments: ReadonlySet<string> | null;
}

function useWaKit(): WaKit {
  const templates = useTemplates();
  const snippets = useSnippets();
  return useMemo(
    () => ({
      templatesLive: templates.data
        ? templates.data.some(t => t.active && Boolean(t.workflow_id))
        : null,
      moments: snippets.data ? new Set(snippets.data.map(s => s.moment)) : null,
    }),
    [templates.data, snippets.data],
  );
}

/** What can be sent after a no-answer, for the lead on screen. */
function missStep(
  moment: MissMoment,
  convo: ReturnType<typeof useConversation>,
  wa: WaKit,
  video: RoomView | null = null,
  workerDown = false,
): AfterMiss {
  const channels = convo.data?.channels;
  return afterMiss({
    moment,
    whatsapp: channels?.whatsapp ?? null,
    email: channels?.email ?? null,
    templatesLive: wa.templatesLive,
    messageReady: wa.moments ? wa.moments.has(moment) : null,
    video,
    // The panel's clock and health line, so the step never says "on its
    // way" under a panel that says the room will not be made (m1 round 2).
    now: Date.now(),
    workerDown,
  });
}

const NO_DRAFT: Draft = { outcome: null, note: "", callback: "" };

type PaneMode = "outcomes" | "book" | "move" | "held" | "unanswered";

const fine = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(pointer: fine)").matches;

/** How long after a missed call its video link is offered (sales-api says "just now" only inside it). */
const MISS_FRESH_MS = 15 * 60_000;

function CallPane({
  className,
  me,
  as,
  contactId,
  item,
  open,
  pinned,
  agent,
  callRef,
  nextRef,
  convo,
  wa,
  roomsSetup,
  onCalled,
  onFinished,
  onStay,
  onPin,
  onRefresh,
  onTalk,
}: {
  className: string;
  me: Me;
  as: As;
  contactId: string;
  item: DialItem | null;
  open: Attempt | null;
  pinned: boolean;
  agent: ReturnType<typeof useAgent>;
  callRef: MutableRefObject<(() => void) | null>;
  nextRef: MutableRefObject<(() => void) | null>;
  convo: ReturnType<typeof useConversation>;
  wa: WaKit;
  roomsSetup: RoomsSetup;
  onCalled: (a: Attempt) => void;
  onFinished: (
    contactId: string,
    how: "saved" | "skipped",
    words?: string,
  ) => void;
  /** Saved, with a next step: keep this lead on screen and close its call. */
  onStay: (contactId: string) => void;
  /** The rep is working on this lead: keep it on screen. */
  onPin: (contactId: string) => void;
  /** Read the queue again: the server's state and the page's differ. */
  onRefresh: () => void;
  onTalk: (moment?: Moment) => void;
}) {
  const lead = useLead(contactId);
  const l = lead.data;
  // An answer that lands after the rep moved to another lead only does the
  // bookkeeping; it never pulls the screen back to this one.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [draft, setDraftState] = useState<Draft>(() => readDraft(contactId));
  const [busy, setBusyState] = useState<null | "call" | "save" | "skip">(null);
  // The same, at once: a second tap in the same moment finds it set before
  // the button has been drawn as busy, so nothing is sent twice.
  const busyRef = useRef<typeof busy>(null);
  function setBusy(b: typeof busy) {
    busyRef.current = b;
    if (mounted.current) setBusyState(b);
  }
  // What the form is showing: the outcomes, a booking, a move, or what comes
  // after an outcome that has a next step.
  const [mode, setMode] = useState<PaneMode>("outcomes");
  // How the step after a no-answer came about: Maqsam's record saved it
  // (Next lead waits, focused) or the rep chose to message them (the box is
  // open in the conversation).
  const [missBy, setMissBy] = useState<"auto" | "message">("auto");
  const [bookKind, setBookKind] = useState<"intro" | "demo" | null>(null);
  // Once the intro is marked held, what follows is ordinary lead work.
  const [kind, setKind] = useState<ItemKind>(item?.kind ?? "lead");
  // What was saved while the lead stays on screen, for the band.
  const [saved, setSaved] = useState<string | null>(null);
  // A call that may have gone out although no clear answer came back (a
  // server error, or none in time): the band says to check Maqsam first.
  const [doubt, setDoubt] = useState<string | null>(null);
  // Why the last save needs another press, under the button until then.
  const [saveNote, setSaveNote] = useState<string | null>(null);
  // The appointment the lead came up for, kept when the queue lets the item
  // go while the rep is still on the lead.
  const [apptSeen, setApptSeen] = useState(item?.appointment ?? null);
  useEffect(() => {
    if (item?.appointment) setApptSeen(item.appointment);
  }, [item?.appointment]);
  const appt = item?.appointment ?? apptSeen;
  // A save without a call through the dialer carries its own id: made when
  // the rep starts that save, kept for every retry of it, new once a save
  // lands. Another lead is another pane, so another id.
  const saveId = useRef<string | null>(null);
  const missMoment: MissMoment = kind === "confirm" ? "confirm" : "missed_call";
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  // The video link after a call that did not connect (P1): how it missed,
  // and for which call, kept after the call is saved; the picker; and
  // automatic mode's ten seconds.
  const [missed, setMissed] = useState<{
    trigger: Trigger;
    attemptId: string | null;
    /** When the miss was seen: a video link is offered for MISS_FRESH_MS after it (m1 round 1). */
    at: number;
  } | null>(null);
  // The after-miss step left open (the laptop asleep over lunch) no longer
  // offers a video link that would tell the lead "I tried to call you just
  // now" about a call hours old (m1 round 1, stale-miss-just-now).
  const missNow = useNow(30_000);
  const missFresh = missed !== null && missNow - missed.at <= MISS_FRESH_MS;
  const [picking, setPicking] = useState(false);
  const [autoAt, setAutoAt] = useState<number | null>(null);
  const [autoError, setAutoError] = useState<string | null>(null);
  const [autoErrorCode, setAutoErrorCode] = useState<string | null>(null);
  // Automatic mode runs once for each call that missed, Stop or not.
  const autoRan = useRef(new Set<string>());
  const video = useLeadRoom(contactId);
  // While the lead's room has its link out (or on its way), the step after
  // the miss says so and offers no missed-call message (stress2, round 2).
  const miss = missStep(
    missMoment,
    convo,
    wa,
    video.room ?? null,
    workerDownOf(video.live?.health),
  );
  const status = useCallStatus(open, () => {
    // Maqsam's record saved it as No answer. A save of the rep's own on its
    // way decides what shows (only one of the two can land); otherwise the
    // lead stays with Next lead ready for Enter.
    if (busyRef.current) return;
    setMissed(
      m =>
        m ?? {
          trigger: "no_answer",
          attemptId: open?.id ?? null,
          at: Date.now(),
        },
    );
    onStay(contactId);
    setSaved("Saved from Maqsam's record: No answer");
    setMissBy("auto");
    setMode(m => (m === "outcomes" ? "unanswered" : m));
    toast.success("No answer, saved from Maqsam's record.");
  });
  const liveMiss = missTrigger({
    attemptFailed: open?.state === "failed",
    call: status.call,
  });
  const openId = open?.id ?? null;
  useEffect(() => {
    if (liveMiss)
      setMissed({ trigger: liveMiss, attemptId: openId, at: Date.now() });
  }, [liveMiss, openId]);
  const bookedIntro =
    (kind === "intro" || kind === "confirm") && appt?.type === "intro";
  // The intro itself, not its confirmation call (the evening before, or that
  // morning): only the intro's own room carries it, so an empty confirmation
  // room never settles the intro and a join there never marks it shown.
  const introCall = kind === "intro" && appt?.type === "intro";
  const gate = videoLinkGate({
    setting: roomsSetup.rooms,
    contactId,
    seatEmail: me.email,
    purpose: "fallback",
    bookedIntro,
    bookedDemo: appt?.type === "demo",
    client: isClient(l),
    dnd: Boolean(l?.dnd),
    // The lead's clock (stress2 round 6): no link, and no countdown, at
    // night where they are, unless it is their own booked intro's time.
    country: l?.country ?? null,
    phone: l?.phone ?? null,
    now: Date.now(),
    introNow: introCall,
  });
  // A closer's video call is a demo (stress2 round 4): its length, its Zoom
  // rule, and never booked as an intro in a setter's place.
  const roomKind: "intro" | "demo" = as === "closer" ? "demo" : "intro";
  // What the steps after a video join (or a move to the phone) ask about:
  // the call this seat's item is for. A closer's call is a demo, so it never
  // asks how "the intro" went nor leads with Book the demo (stress2 round 5).
  const callAsk =
    kind === "confirm"
      ? `Are they coming to the ${roomKind}?`
      : `How did the ${kind === "intro" ? "intro" : roomKind} go?`;
  // A closer's demo call: Save how it went is the step's teal button.
  const demoSaves =
    roomKind === "demo" && kind !== "confirm" && kind !== "intro";
  const choice = roomsSetup.rooms
    ? providerChoice({
        setting: roomsSetup.rooms,
        role: as,
        me: video.presence,
        kind: roomKind,
      })
    : null;
  const videoAsk = {
    contactId,
    purpose: "fallback" as const,
    callKind: roomKind,
    attemptId: missed?.attemptId ?? null,
    // The intro on its confirmation call too: sales-api keeps a room made
    // outside the intro's window off it (stress2, round 1), and a
    // confirmation call's room off it always (round 2: the item kind).
    appointmentId: videoAppointmentId(kind, appt),
    itemKind:
      kind === "intro" || kind === "confirm" || kind === "lead" ? kind : null,
  };
  // "Send a video link" shows on every outcome but Answered, never for a
  // client, while no room is open for the lead (P1). A room that failed
  // on screen offers its own next step (Try Zoom, or the phone), so the
  // button waits until the rep puts it away.
  const failedOnScreen = video.room?.state === "failed";
  // The lead joined the video room after the missed call: the intro
  // happened, so the step after the miss becomes "How did the intro go?",
  // and neither the missed-call WhatsApp nor another video link is offered
  // (final review).
  const joinedAt = videoJoinedAt(video.room);
  // We are on the phone: the room closed as moved to the phone, or the rep
  // marked the intro from the panel (stress2, round 2). Neither the
  // missed-call WhatsApp nor another video link is offered after it.
  const spoke = spokeAt(video.room);
  const [introMarked, setIntroMarked] = useState(false);
  const offerVideo =
    gate.show &&
    missed !== null &&
    missFresh &&
    choice !== null &&
    !video.open &&
    !failedOnScreen &&
    !joinedAt &&
    !spoke &&
    !introMarked;
  // Where the link would go, said in the picker; when nothing can reach the
  // lead, automatic mode does not send blind: the picker says so instead.
  const planLine = roomsSetup.rooms
    ? linkPlanLine({
        setting: roomsSetup.rooms,
        whatsapp: convo.data?.channels.whatsapp,
        email: convo.data?.channels.email,
        guardOpen: roomsSetup.guard,
        templateLive: roomsSetup.templateLive,
      })
    : null;
  const autoKey = missed ? `${contactId}:${missed.attemptId ?? "save"}` : "";
  useEffect(() => {
    if (
      !offerVideo ||
      !roomsSetup.rooms?.fallback.auto_on_miss ||
      autoRan.current.has(autoKey)
    )
      return;
    autoRan.current.add(autoKey);
    if (planLine === PICKER_NONE) setPicking(true);
    else setAutoAt(Date.now());
  }, [offerVideo, autoKey, roomsSetup.rooms?.fallback.auto_on_miss, planLine]);
  async function autoSend() {
    setAutoAt(null);
    if (!choice || video.open) return;
    // Nothing can reach the lead now (the conversation was read during the
    // ten seconds): the rep decides in the picker.
    if (planLine === PICKER_NONE) {
      setPicking(true);
      return;
    }
    const ask = createAsk({ ...videoAsk, trigger: "auto" }, choice.first);
    try {
      const out = await roomsApi.create(ask);
      video.setRoom(out.room, ask);
    } catch (e) {
      // Said in the picker, which stays for a press of the rep's own (and
      // offers none after the night refusal, stress2 round 6).
      setAutoError(errorText(e));
      setAutoErrorCode(refusalCode(e));
      setPicking(true);
    }
  }
  /**
   * Leaving the lead while automatic mode counts down sends the link now,
   * as an Undo strip does when the rep moves on inside its window (final
   * review): Next lead, Alt+→ or another lead never cancels it silently.
   * The room is made on the server and its link goes from there, so it
   * needs nothing more from this pane; a refusal is said in a toast.
   */
  const leftWithAuto = useRef<string | null>(null);
  function sendOnLeave() {
    if (autoAt === null || !choice || video.open || planLine === PICKER_NONE)
      return;
    if (leftWithAuto.current === autoKey) return;
    leftWithAuto.current = autoKey;
    setAutoAt(null);
    const ask = createAsk({ ...videoAsk, trigger: "auto" }, choice.first);
    const name = firstWord(l?.name ?? null) ?? "the lead";
    roomsApi.create(ask).then(
      out => {
        if (mounted.current) video.setRoom(out.room, ask);
        // A room that failed while room.create waited is said as such, never
        // "on its way" (stress2 round 3); the banner keeps it too.
        const said = leaveToast(out.room, name);
        if (said.ok) toast.success(said.text);
        else toast.error(said.text);
      },
      e => toast.error(`The video link to ${name} did not go. ${errorText(e)}`),
    );
  }
  const leaveRef = useRef(sendOnLeave);
  leaveRef.current = sendOnLeave;
  useEffect(() => () => leaveRef.current(), []);
  async function markIntro(status: "noshow" | "showed") {
    if (!appt) return;
    await api("mark", {
      appointment_id: appt.id,
      status,
      reason: null,
    });
    // Marked from the room panel: the panel stops asking, and "We spoke on
    // the phone" moves the pane to the held step (stress2, round 2).
    setIntroMarked(true);
    if (status === "showed") {
      setSaved("Intro marked held");
      setMode("held");
    }
  }
  // No-show is not offered while the lead's video room is open: HighLevel's
  // no-show automation writes to a lead who may be opening the link now
  // (m1 round 2; sales-api refuses it too).
  const outcomes = OUTCOMES[kind].filter(
    o => !(o.key === "noshow" && video.open),
  );
  const chosen = outcomes.find(o => o.key === draft.outcome) ?? null;
  const dnd = Boolean(l?.dnd);

  function setDraft(d: Partial<Draft>) {
    // Writing about this lead keeps it on screen when another comes up.
    if (!pinned) onPin(contactId);
    setDraftState(prev => {
      const next = { ...prev, ...d };
      writeDraft(contactId, next);
      return next;
    });
  }

  function pickOutcome(o: OutcomeDef) {
    setDraft({ outcome: o.key });
    setSaveNote(null);
    if (o.key === "booked") {
      setBookKind(null);
      setMode("book");
      return;
    }
    if (o.key === "rescheduled") {
      setMode("move");
      return;
    }
    // With a mouse and keyboard the next key goes where it is needed: the
    // notes when a line is asked for, else Save, so Enter saves.
    if (fine())
      window.setTimeout(
        () =>
          (o.needsNote ? noteRef.current : saveRef.current)?.focus({
            preventScroll: true,
          }),
        0,
      );
  }

  async function call() {
    if (busyRef.current || open || dnd || !l) return;
    setBusy("call");
    setDoubt(null);
    try {
      // What the call is for: an intro or a confirmation counts as a try on
      // its appointment, not a miss on the lead. After "Held it" the lead's
      // own work goes on, so a call then is a lead call.
      const forAppt = kind !== "lead" && appt ? appt.id : null;
      const out = await api<{
        attempt: Attempt;
        route: { country: string; caller: string };
      }>("dial.call", {
        contact_id: contactId,
        as,
        item_kind: forAppt ? kind : "lead",
        appointment_id: forAppt,
      });
      onCalled(out.attempt);
      if (!mounted.current) return;
      // A new call: whether it connects is this call's question now.
      setMissed(null);
      setPicking(false);
      setAutoAt(null);
      setAutoError(null);
      setAutoErrorCode(null);
      // Calling again after a saved call: back to saying how this one went.
      setSaved(null);
      setSaveNote(null);
      if (mode === "held" || mode === "unanswered") setMode("outcomes");
      toast.success(
        `Calling on the ${out.route.country} line. Pick up in the Maqsam softphone.`,
      );
    } catch (e) {
      if (uncertain(e)) {
        // A server error, or no answer in time, can still mean it rang (the
        // call centre's rule). The next read of the queue shows the call if
        // it did start; saving is never blocked.
        if (mounted.current)
          setDoubt(
            e instanceof ApiError && e.kind === "server"
              ? `${plainError(msg(e), 200).replace(/\.$/, "")}. A server error can still mean it rang. You can still save this lead's outcome.`
              : "No word came back about the call, so it may be ringing. You can still save this lead's outcome.",
          );
        onRefresh();
      } else {
        toast.error(plainError(msg(e), 240));
        // The server holds a call the page does not know: the next read shows it.
        if (refusedWith(e, 409)) onRefresh();
      }
      void agent.check();
    } finally {
      setBusy(null);
    }
  }
  // Alt+D from anywhere on the page.
  const callNow = useRef(call);
  callNow.current = call;
  useEffect(() => {
    callRef.current = () => void callNow.current();
    return () => {
      callRef.current = null;
    };
  }, [callRef]);

  async function save(
    e?: FormEvent,
    then: "next" | "message" = "next",
    /** An outcome a step's own button saves (the joined step's "Held the intro"). */
    forced?: Partial<Draft>,
  ) {
    e?.preventDefault();
    const d: Draft = forced ? { ...draft, ...forced } : draft;
    if (!d.outcome || busyRef.current) return;
    if (d.outcome === "booked") {
      setBookKind(null);
      setMode("book");
      return;
    }
    if (d.outcome === "rescheduled") {
      setMode("move");
      return;
    }
    const attempt = open;
    setBusy("save");
    setSaveNote(null);
    if (!attempt) saveId.current ??= crypto.randomUUID();
    try {
      const out = await api<{
        attempt?: { outcome?: string | null } | null;
        repeated?: boolean;
      }>("dial.save", {
        ...(attempt
          ? { attempt_id: attempt.id }
          : { contact_id: contactId, request_id: saveId.current }),
        outcome: d.outcome,
        note: d.note,
        as,
        item_kind: kind,
        appointment_id: kind === "lead" ? null : (appt?.id ?? null),
        callback_at:
          d.outcome === "callback" && d.callback
            ? new Date(d.callback).toISOString()
            : null,
      });
      // Stored: HighLevel's half (note, tags, stage) may still be on its
      // way, and a save it does not take shows as saved work.
      saveId.current = null;
      clearDraft(contactId);
      // Saved already (sent again after no answer came back): what landed
      // the first time is what stands.
      const outcome = (out.repeated && out.attempt?.outcome) || d.outcome;
      const label = outcomes.find(o => o.key === outcome)?.label ?? outcome;
      const words = `${out.repeated ? "Already saved" : "Saved"}: ${label}`;
      const next = afterSave(kind, outcome, then === "message");
      if (!mounted.current || next === "next") {
        onFinished(
          contactId,
          "saved",
          mounted.current
            ? `${words}. Next lead is up.`
            : `${words}, for ${l?.name ?? "the lead before"}.`,
        );
        return;
      }
      onStay(contactId);
      setDraftState(NO_DRAFT);
      setDoubt(null);
      if (next === "held") {
        setKind("lead");
        setSaved("Intro marked held");
        setMode("held");
        toast.success("Marked held. Book the demo, or set a call-back.");
        return;
      }
      // A no-answer to message: the box opens with the ready message.
      if (outcome === "no_answer")
        setMissed(
          m =>
            m ?? {
              trigger: "no_answer",
              attemptId: attempt?.id ?? null,
              at: Date.now(),
            },
        );
      setSaved(words);
      setMissBy("message");
      setMode("unanswered");
      if (miss.send) onTalk(miss.send === "whatsapp" ? missMoment : undefined);
    } catch (err) {
      if (attempt && refusedWith(err, 409) && /already saved/i.test(msg(err))) {
        // Saved first, by Maqsam's record (nobody picked up) or an earlier
        // press: that call is done. The outcome is still here, and the next
        // press saves it as a save of its own.
        if (mounted.current) onStay(contactId);
        setSaveNote(
          "This call was already saved, perhaps by Maqsam's record as No answer. Your outcome is still here: press Save again to add it.",
        );
      } else if (uncertain(err)) {
        // A save sent again is the same save (its id, or its call), so the
        // way to check is to press Save again.
        setSaveNote(
          err instanceof ApiError && err.kind === "server"
            ? `${plainError(msg(err), 200).replace(/\.$/, "")}. Press Save again: the dialer keeps a save only once.`
            : "No clear answer came back, so it may have saved already. Press Save again: the dialer keeps a save only once.",
        );
      } else {
        toast.error(msg(err));
        if (refusedWith(err, 409)) onRefresh();
      }
    } finally {
      setBusy(null);
    }
  }

  async function skip() {
    if (busyRef.current) return;
    setBusy("skip");
    try {
      if (open) await api("dial.release", { attempt_id: open.id });
      onFinished(contactId, "skipped", "Skipped for now. Next lead is up.");
    } catch (err) {
      // A call that is gone already needs no letting go.
      if (refusedWith(err, 404))
        onFinished(contactId, "skipped", "Skipped for now. Next lead is up.");
      else toast.error(msg(err));
    } finally {
      setBusy(null);
    }
  }

  // Next lead, and Alt+→ while it shows. The lead was saved already; a
  // video link counting down goes first.
  // After a conversation the step itself asks about (the lead joined the
  // video call, or the call moved to the phone), Next lead never leaves
  // Maqsam's automatic No answer standing, which would close the lead as
  // unreachable or bring them back as "not reached yet" (stress2 round 6,
  // joined-step-next-lead-keeps-auto-no-answer): the talk is saved first,
  // as a call-back the next working morning, then the next lead opens.
  const spokeUnsaved = mode === "unanswered" && Boolean(joinedAt || spoke);
  const spokeNote = joinedAt
    ? "Spoke on video. No outcome was saved, so they come back as a call-back."
    : "Spoke on the phone after the video link. No outcome was saved, so they come back as a call-back.";
  const spokeSaveId = useRef<string | null>(null);
  async function saveSpoke() {
    if (busyRef.current) return;
    setBusy("save");
    spokeSaveId.current ??= crypto.randomUUID();
    try {
      await api("dial.save", {
        contact_id: contactId,
        request_id: spokeSaveId.current,
        outcome: "callback",
        note: draft.note.trim() || spokeNote,
        as,
        item_kind: "lead",
        appointment_id: null,
        callback_at: new Date(spokeCallbackAt(Date.now())).toISOString(),
      });
      spokeSaveId.current = null;
      clearDraft(contactId);
      onFinished(
        contactId,
        "saved",
        "Saved as a call-back tomorrow morning. Next lead is up.",
      );
    } catch (err) {
      toast.error(`${msg(err)} Press Next lead again, or Save how it went.`);
    } finally {
      setBusy(null);
    }
  }
  const toNext = () => {
    leaveRef.current();
    if (spokeUnsaved) {
      void saveSpoke();
      return;
    }
    onFinished(contactId, "saved");
  };
  const toNextRef = useRef(toNext);
  toNextRef.current = toNext;
  const showsNext = mode === "held" || mode === "unanswered";
  useEffect(() => {
    if (!showsNext) return;
    const go = () => {
      leaveRef.current();
      toNextRef.current();
    };
    nextRef.current = go;
    return () => {
      if (nextRef.current === go) nextRef.current = null;
    };
  }, [showsNext, nextRef]);

  // The picker, said where the rep pressed for it: inside the after-miss
  // step in place of its button, or here under the call line otherwise.
  const picker =
    picking && offerVideo && choice && missed ? (
      <VideoPicker
        {...videoAsk}
        trigger={missed.trigger}
        choice={choice}
        planLine={planLine}
        initialError={autoError}
        initialErrorCode={autoErrorCode}
        onRoom={(room, ask) => {
          video.setRoom(room, ask);
          setPicking(false);
          setAutoError(null);
          setAutoErrorCode(null);
        }}
        onCancel={() => {
          setPicking(false);
          setAutoError(null);
          setAutoErrorCode(null);
        }}
      />
    ) : null;
  const pickerInStep = mode === "unanswered";
  // One teal button at a time: while the room panel holds the primary (an
  // open room, or a failed one offering the other provider), or a link is
  // being picked or about to go, Call and Next lead step back.
  const panelLeads =
    video.open || (failedOnScreen && !workerDownOf(video.live?.health));
  const callQuiet = panelLeads || picking || autoAt !== null;

  async function copyNumber() {
    if (!l?.phone) return;
    try {
      await navigator.clipboard.writeText(l.phone);
      toast.success("Number copied.");
    } catch {
      toast.error("The browser would not copy. Select the number instead.");
    }
  }

  return (
    <section
      aria-label="Call"
      className={`panel min-w-0 overflow-hidden ${className}`}
    >
      <CallBand
        item={item}
        open={open}
        call={status.call}
        callError={status.error}
        dnd={dnd}
        saved={
          joinedAt && mode === "unanswered"
            ? `Joined on video at ${clock(joinedAt)}`
            : saved
        }
        doubt={doubt}
        onVideo={
          offerVideo && !picking && autoAt === null
            ? () => setPicking(true)
            : null
        }
      />
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void call()}
            disabled={Boolean(busy) || Boolean(open) || dnd || !l}
            className={`${callQuiet ? button : buttonPrimary} h-10 px-4 text-[15px]`}
            title="Alt+D"
          >
            <PhoneCall className="size-4" aria-hidden />
            {busy === "call" ? "Calling…" : open ? "On the call" : "Call"}
          </button>
          {l?.phone ? (
            <button
              type="button"
              onClick={copyNumber}
              className={button}
              title="Copy the number, to call from the softphone or a mobile"
            >
              <Copy className="size-3.5" aria-hidden />
              <span className="tabular-nums" dir="ltr">
                {l.phone}
              </span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={skip}
            disabled={Boolean(busy)}
            className={`${button} ms-auto`}
            title={
              open
                ? "Let this call go without saving how it went"
                : "Skip this lead for now"
            }
          >
            {open ? (
              <PhoneOff className="size-3.5" aria-hidden />
            ) : (
              <SkipForward className="size-3.5" aria-hidden />
            )}
            Skip
          </button>
        </div>
        <MaqsamLine
          agent={agent.agent}
          error={agent.error}
          onCheck={() => void agent.check()}
        />

        {/* A room still running always shows; a closed one gives way to a
            new link being asked for. */}
        {video.room && (video.open || (!picking && autoAt === null)) ? (
          <RoomPanel
            room={video.room}
            request={video.request}
            onRoomChange={r => video.setRoom(r)}
            talkBelow
            onMarkIntro={
              introCall && appt && !introMarked ? markIntro : undefined
            }
          />
        ) : autoAt !== null && offerVideo ? (
          <AutoVideoStrip
            name={firstWord(l?.name ?? null)}
            startedAt={autoAt}
            onStop={() => setAutoAt(null)}
            onSend={() => void autoSend()}
          />
        ) : picker && !pickerInStep ? (
          picker
        ) : null}

        {mode === "held" ? (
          <NextStep
            title="The intro is marked held. What next?"
            text="Book the demo while they are warm, or set when to call them back."
          >
            <button
              type="button"
              onClick={() => {
                setBookKind("demo");
                setMode("book");
              }}
              className={buttonPrimary}
            >
              <CalendarPlus className="size-3.5" aria-hidden /> Book the demo
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft({ outcome: "callback" });
                setMode("outcomes");
              }}
              className={button}
            >
              Set a call-back
            </button>
            <NextLeadButton onNext={toNext} />
          </NextStep>
        ) : mode === "unanswered" && joinedAt ? (
          <NextStep
            title={`${firstWord(l?.name ?? null) ?? "The lead"} joined the video call. ${callAsk}`}
            text={
              kind === "intro"
                ? "Mark the intro held, then book the demo while they are warm, or save how it went."
                : kind === "confirm"
                  ? "Save that they are coming, or save how it went."
                  : roomKind === "demo"
                    ? "Save how it went: the follow-up, or the contract if they are ready."
                    : "Book the demo while they are warm, or save how it went."
            }
          >
            {kind === "confirm" ? (
              // A confirmation call (the evening before, or that morning):
              // the intro is still ahead, so the step saves the lead's
              // confirmation, never "Book the demo" before it (stress2,
              // round 2).
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() =>
                  void save(undefined, "next", { outcome: "confirmed" })
                }
                className={panelLeads ? button : buttonPrimary}
              >
                <Check className="size-3.5" aria-hidden /> Confirmed the call
              </button>
            ) : kind === "intro" ? (
              // The intro itself was had on video: it is marked held first
              // (as the held path does), so it never comes back as "Intro
              // call now" and B2B counts it once (stress2, round 1). The
              // held step then offers Book the demo.
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() =>
                  void save(undefined, "next", { outcome: "showed" })
                }
                className={panelLeads ? button : buttonPrimary}
              >
                <Check className="size-3.5" aria-hidden /> Held the intro
              </button>
            ) : roomKind === "demo" ? null : (
              <button
                type="button"
                onClick={() => {
                  setBookKind("demo");
                  setMode("book");
                }}
                className={panelLeads ? button : buttonPrimary}
              >
                <CalendarPlus className="size-3.5" aria-hidden /> Book the demo
              </button>
            )}
            <button
              type="button"
              onClick={() => setMode("outcomes")}
              className={demoSaves && !panelLeads ? buttonPrimary : button}
            >
              Save how it went
            </button>
            <NextLeadButton onNext={toNext} />
          </NextStep>
        ) : mode === "unanswered" && spoke ? (
          // We are on the phone (the room closed as moved to the phone): the
          // rep and the lead are talking, so the step after the miss is the
          // call's own question, never the missed-call WhatsApp or another
          // video link (stress2, round 2).
          <NextStep
            title={`You moved to the phone with ${firstWord(l?.name ?? null) ?? "the lead"}. ${kind === "confirm" || kind === "intro" ? callAsk : "How did it go?"}`}
            text={
              kind === "intro"
                ? "Mark the intro held, then book the demo while they are warm, or save how it went."
                : "Save how it went."
            }
          >
            {kind === "intro" ? (
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() =>
                  void save(undefined, "next", { outcome: "showed" })
                }
                className={panelLeads ? button : buttonPrimary}
              >
                <Check className="size-3.5" aria-hidden /> Held the intro
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setMode("outcomes")}
              className={kind === "intro" ? button : buttonPrimary}
            >
              Save how it went
            </button>
            <NextLeadButton onNext={toNext} />
          </NextStep>
        ) : mode === "unanswered" ? (
          <AfterMissStep
            step={miss}
            moment={missMoment}
            focusNext={missBy === "auto" && !picking}
            onTalk={onTalk}
            onSave={() => setMode("outcomes")}
            onNext={toNext}
            onCall={!busy && !open && !dnd && l ? () => void call() : null}
            onVideo={
              offerVideo && !picking && autoAt === null
                ? () => setPicking(true)
                : null
            }
            picker={pickerInStep ? picker : null}
            quietNext={panelLeads}
            videoUnread={
              roomsSetup.error && missed !== null && !video.room
                ? ROOMS_UNREAD
                : missed !== null && !video.room
                  ? gateLine(gate.why)
                  : null
            }
          />
        ) : mode === "book" || mode === "move" ? (
          <BookForm
            me={me}
            as={as}
            contactId={contactId}
            attemptId={open?.id ?? null}
            kindFirst={bookKind}
            moving={
              mode === "move" && appt ? { id: appt.id, itemKind: kind } : null
            }
            note={draft.note}
            onNote={note => setDraft({ note })}
            onClose={() => setMode("outcomes")}
            onBooked={words => {
              clearDraft(contactId);
              onFinished(contactId, "saved", `${words}. Next lead is up.`);
            }}
          />
        ) : (
          <form
            onSubmit={e => void save(e)}
            className="space-y-3 border-t hairline pt-4"
          >
            <p className="text-sm font-medium">
              {kind === "intro"
                ? "How did the intro go?"
                : kind === "confirm"
                  ? "Are they coming?"
                  : open
                    ? "How did it go?"
                    : "Save what happened"}
            </p>
            <div
              className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-2"
              role="group"
              aria-label="Outcome"
            >
              {outcomes.map(o => {
                const isBooked = o.key === "booked";
                const isSelected = draft.outcome === o.key;
                return (
                  <button
                    key={o.key}
                    type="button"
                    aria-pressed={isSelected}
                    title={o.hint}
                    onClick={() => pickOutcome(o)}
                    className={`rounded-[14px] border px-3 py-2 text-sm font-medium transition-all active:scale-[0.98] ${
                      isBooked
                        ? isSelected
                          ? "col-span-2 sm:col-span-3 xl:col-span-2 border-teal-400 bg-gradient-to-r from-[#2e5bd6] to-[#00cfc8] text-white font-bold shadow-lg shadow-teal-500/25 ring-2 ring-teal-400/40"
                          : "col-span-2 sm:col-span-3 xl:col-span-2 border-teal-500/40 bg-gradient-to-r from-[#2e5bd6]/85 to-[#00cfc8]/85 text-white font-semibold hover:brightness-110 shadow-md shadow-teal-500/15"
                        : isSelected
                          ? "border-[color:var(--primary)] bg-[color:color-mix(in_oklch,var(--primary)_15%,transparent)] text-[color:var(--foreground)] font-semibold shadow-sm"
                          : "border-border bg-foreground/[0.03] hover:bg-foreground/[0.07] hover:border-foreground/20 text-foreground"
                    }`}
                  >
                    {isBooked ? (
                      <span className="inline-flex items-center justify-center gap-1.5 py-0.5">
                        <CalendarPlus
                          className="size-4 text-white"
                          aria-hidden
                        />
                        {o.label}
                      </span>
                    ) : (
                      o.label
                    )}
                  </button>
                );
              })}
            </div>
            {chosen ? <p className="muted text-xs">{chosen.hint}</p> : null}

            {draft.outcome === "callback" ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {callbackPicks(Date.now()).map(p => (
                    <button
                      key={p.label}
                      type="button"
                      aria-pressed={draft.callback === localInput(p.at)}
                      onClick={() => setDraft({ callback: localInput(p.at) })}
                      className={`rounded-full border px-2.5 py-0.5 text-xs ${
                        draft.callback === localInput(p.at)
                          ? "border-[color:var(--primary)] font-semibold"
                          : "hairline"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <label className="block max-w-xs space-y-1">
                  <span className="muted block text-xs">
                    Or a time of your own (your clock)
                  </span>
                  <input
                    type="datetime-local"
                    value={draft.callback}
                    onChange={e => setDraft({ callback: e.target.value })}
                    className={field}
                    required
                  />
                </label>
              </div>
            ) : null}

            <label className="block space-y-1">
              <span className="muted block text-xs">
                {chosen?.needsNote
                  ? "What happened (goes on the lead in HighLevel too)"
                  : "Notes (optional)"}
              </span>
              <textarea
                id="dial-note"
                ref={noteRef}
                value={draft.note}
                onChange={e => setDraft({ note: e.target.value })}
                onKeyDown={e => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void save();
                  }
                }}
                rows={3}
                dir="auto"
                required={Boolean(chosen?.needsNote)}
                minLength={chosen?.needsNote ? 3 : undefined}
                placeholder={
                  draft.outcome ? "" : "Pick how it went, then a line on it"
                }
                className="w-full rounded-[var(--radius-md)] border hairline bg-[color:var(--background)] px-3 py-2 text-sm"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                ref={saveRef}
                type="submit"
                disabled={Boolean(busy) || !draft.outcome}
                className={buttonPrimary}
                title="Ctrl+Enter in the notes"
              >
                {busy === "save"
                  ? "Saving…"
                  : draft.outcome === "booked" ||
                      draft.outcome === "rescheduled"
                    ? "Pick a time"
                    : draft.outcome &&
                        afterSave(kind, draft.outcome, false) === "held"
                      ? "Save"
                      : "Save and next"}
              </button>
              {draft.outcome === "no_answer" && miss.send ? (
                // The missed-call message, as its own choice: saved, and the
                // lead stays with the box ready.
                <button
                  type="button"
                  onClick={() => void save(undefined, "message")}
                  disabled={Boolean(busy)}
                  className={button}
                >
                  {miss.send === "whatsapp"
                    ? "Save and WhatsApp them"
                    : "Save and email them"}
                </button>
              ) : null}
              {!open &&
              draft.outcome &&
              draft.outcome !== "booked" &&
              draft.outcome !== "rescheduled" ? (
                <span className="muted text-xs">
                  No call through the dialer: saved as a call made elsewhere.
                </span>
              ) : null}
            </div>
            {saveNote ? (
              <p
                role="status"
                className="callout-warn rounded-[var(--radius-md)] border px-3 py-2 text-xs leading-relaxed"
              >
                {saveNote}
              </p>
            ) : null}
          </form>
        )}
      </div>
      <KeysLine />
    </section>
  );
}

/** The dialer's keys, once, for a mouse and keyboard; a phone has none. */
function KeysLine() {
  const k = "rounded-[4px] border hairline px-1 font-sans text-[10px]";
  return (
    <p className="muted hidden border-t hairline px-4 py-2 text-[11px] leading-5 md:pointer-fine:block">
      Keys: <kbd className={k}>Alt+D</kbd> call · <kbd className={k}>Alt+N</kbd>{" "}
      notes · <kbd className={k}>Ctrl+Enter</kbd> save the notes ·{" "}
      <kbd className={k}>Alt+→</kbd> next lead
    </p>
  );
}

/**
 * Next lead. Focused when Maqsam's record has just saved a no-answer, so
 * Enter moves on, but never taken from a box the rep is typing in.
 */
function NextLeadButton({
  onNext,
  primary = false,
  focus = false,
}: {
  onNext: () => void;
  primary?: boolean;
  focus?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focus && !typing()) ref.current?.focus({ preventScroll: true });
  }, [focus]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onNext}
      className={primary ? buttonPrimary : button}
      title="Alt+→"
    >
      Next lead
    </button>
  );
}

function NextStep({
  title,
  text,
  children,
  after = null,
}: {
  title: string;
  text: string;
  children: ReactNode;
  /** Under the buttons: what one of them opened (the video picker). */
  after?: ReactNode;
}) {
  return (
    <div className="space-y-2 border-t hairline pt-4">
      <p className="text-sm font-medium">{title}</p>
      <p className="muted text-xs">{text}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
      {after}
    </div>
  );
}

/**
 * After a call nobody answered: Next lead first, and the message to send
 * on the channel that can take it now (WhatsApp inside the lead's 24 hours
 * or as a template, else email), said plainly when nothing can go.
 */
function AfterMissStep({
  step,
  moment,
  focusNext,
  onTalk,
  onSave,
  onNext,
  onCall = null,
  onVideo = null,
  picker = null,
  videoUnread = null,
  quietNext = false,
}: {
  step: AfterMiss;
  moment: MissMoment;
  /** Call the lead again: the teal button when the lead was at the door a moment ago (step.callNow). */
  onCall?: (() => void) | null;
  /** Maqsam's record saved it: Next lead takes the focus, so Enter moves on. */
  focusNext: boolean;
  onTalk: (moment?: Moment) => void;
  /** Save how it went: offered when the rep may have spoken with the lead on video (step.talk). */
  onSave: () => void;
  onNext: () => void;
  /** "Send a video link" (P1), while one can be sent for this lead. */
  onVideo?: (() => void) | null;
  /** The video picker, opened from this step: it shows here, under the buttons. */
  picker?: ReactNode;
  /** The video setting could not be read: said where its button would be. */
  videoUnread?: string | null;
  /** Something else on the card holds the teal button (the room panel). */
  quietNext?: boolean;
}) {
  return (
    <NextStep
      title={step.title}
      text={step.text}
      after={
        picker ??
        (videoUnread ? <p className="muted text-xs">{videoUnread}</p> : null)
      }
    >
      {/* The lead was at the door a moment ago: Call first (stress2 round 5). */}
      {step.callNow && onCall ? (
        <button
          type="button"
          onClick={onCall}
          className={!picker && !quietNext ? buttonPrimary : button}
        >
          <PhoneCall className="size-3.5" aria-hidden /> Call them now
        </button>
      ) : null}
      {/* While the picker is open its button is the teal one. */}
      <NextLeadButton
        onNext={onNext}
        primary={!picker && !quietNext && !(step.callNow && onCall)}
        focus={focusNext && !(step.callNow && onCall)}
      />
      {step.talk ? (
        <button type="button" onClick={onSave} className={button}>
          Save how it went
        </button>
      ) : null}
      {step.send ? (
        <button
          type="button"
          // Email opens the box as it is; WhatsApp brings the ready message.
          // A lead who was at the door gets no missed-call message (stress2 round 5).
          onClick={() =>
            onTalk(
              step.send === "whatsapp" && !step.callNow ? moment : undefined,
            )
          }
          className={button}
        >
          {step.send === "whatsapp" ? "WhatsApp them" : "Email them"}
        </button>
      ) : null}
      {onVideo ? <VideoLinkButton onPress={onVideo} /> : null}
    </NextStep>
  );
}

/**
 * The line: what the call is doing right now, in one band. Ready; the
 * two-minute countdown for a lead to call now; a missed call to return;
 * ringing; Maqsam's record once the call ends; a call that may have gone
 * out without a clear answer; or why it did not go through.
 */
function CallBand({
  item,
  open,
  call,
  callError,
  dnd,
  saved,
  doubt,
  onVideo = null,
}: {
  item: DialItem | null;
  open: Attempt | null;
  call: CallInfo | null;
  callError: string | null;
  dnd: boolean;
  /** What was saved while the lead stays on screen for a next step. */
  saved: string | null;
  /** A call that may have gone out although no clear answer came back. */
  doubt: string | null;
  /** "Send a video link" (P1) on the line of a call that did not connect. */
  onVideo?: (() => void) | null;
}) {
  const now = useNow(1000);
  const urgent = useMemo(
    () => (item && !open ? urgentFor([item], Date.now())[0] : undefined),
    [item, open],
  );
  const missed = item && !open ? missedCallLine(item, now) : null;
  const bookedAt = item?.appointment?.booked_at ?? null;
  const booked = bookedAt
    ? `Booked ${ago(bookedAt, now)}`
    : "Booking date not known";
  let color = "var(--border)";
  let title: string;
  let detail: string | null = null;
  let big: string | null = null;
  // The video link sits on the line only while it says the call did not connect.
  let video = false;
  if (dnd) {
    color = "var(--destructive)";
    title = "Do not disturb is on";
    detail =
      "This lead asked not to be contacted in HighLevel. Save what happened without calling.";
  } else if (open?.state === "failed") {
    color = "var(--destructive)";
    title = "The call did not go through";
    detail = open.error
      ? plainError(open.error, 200)
      : "Maqsam did not take it. Call again or save.";
    video = Boolean(onVideo);
  } else if (open) {
    const since = now - Date.parse(open.started_at);
    if (call?.final) {
      color = call.answered ? "var(--success)" : "var(--muted-foreground)";
      title = `Maqsam: ${call.words}`;
      big = call.answered ? mmss(call.seconds * 1000) : null;
      video = !call.answered && Boolean(onVideo);
      detail = call.answered
        ? "Save how it went."
        : video
          ? NOBODY_SPOKE_VIDEO
          : "Nobody spoke. Save it as No answer or Call back.";
    } else {
      color = "var(--now)";
      title = "Ringing you in Maqsam, then the lead";
      big = mmss(since);
      detail = callError
        ? `Maqsam's record could not be read just now (${plainError(callError, 120).replace(/\.$/, "")}). The dialer keeps asking; save how it went when you are done.`
        : call
          ? `Maqsam: ${call.words}.`
          : "Maqsam's record of the call is read every few seconds; an unanswered call saves itself.";
    }
  } else if (doubt) {
    color = "var(--warning)";
    title = "Check the Maqsam softphone before calling again";
    detail = doubt;
  } else if (saved) {
    title = saved;
  } else if (urgent) {
    const late = urgent.deadline <= now;
    color = late ? "var(--destructive)" : "var(--warning)";
    // The queue's own words for booked calls and call-backs ("Call back at
    // 14:30, as agreed"); the call centre's banner for a missed call.
    title =
      item?.kind === "confirm" || item?.kind === "intro" || urgent.callback
        ? (item?.why ?? urgent.title)
        : (missed ?? urgent.title);
    // A few words beside the title; the sentence goes on the line below.
    big = shortCountdown(urgent, now);
    detail =
      item?.kind === "intro"
        ? "Intros are phone calls: call them at the booked time, then say how it went."
        : item?.kind === "confirm"
          ? `${booked}; not confirmed yet.`
          : lateSentence(urgent, now);
  } else if (item?.kind === "confirm") {
    color = "var(--primary)";
    title = item.why;
    detail = `${booked}; not confirmed yet. Call, or message them on WhatsApp.`;
  } else if (item && missed) {
    color = "var(--warning)";
    title = missed;
    detail = readyLine({ ...item, why: "" }, now);
  } else {
    title = "Ready to call";
    detail = item
      ? readyLine(item, now)
      : "Not in the queue right now. Call, or save what happened.";
  }
  return (
    // The clock goes under the words when both do not fit (a phone, the
    // narrow column from 1280px), so the title and its line always show.
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b hairline px-4 py-3 transition-colors ${
        open ? "border-teal-500/30 bg-teal-500/10" : ""
      }`}
      style={{
        borderInlineStart: `4px solid ${color}`,
        background: open
          ? undefined
          : `color-mix(in oklch, ${color === "var(--border)" ? "var(--secondary)" : color} 9%, transparent)`,
      }}
    >
      <div className="min-w-0 flex-[1_1_10rem]">
        <div className="flex items-center gap-2">
          {open ? (
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-teal-500 shadow-[0_0_8px_#00cfc8]" />
            </span>
          ) : null}
          <p
            className="text-sm font-semibold tracking-tight"
            aria-live="polite"
            aria-atomic
          >
            {title}
          </p>
        </div>
        {detail ? (
          <p
            className="muted text-xs mt-0.5"
            aria-live={open ? "polite" : undefined}
          >
            {detail}
          </p>
        ) : null}
      </div>
      {big ? (
        <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-teal-500/30 bg-teal-500/15 px-3 py-1 font-mono text-lg font-bold tracking-tight text-teal-300 tabular-nums shadow-sm">
          {open ? (
            <span className="size-2 rounded-full bg-teal-400 animate-pulse" />
          ) : null}
          {big}
        </div>
      ) : null}
      {video && onVideo ? (
        <VideoLinkButton onPress={onVideo} className="shrink-0" />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Booking on the calendar
// ---------------------------------------------------------------------------

function dayWords(day: string): string {
  const d = new Date(`${day}T12:00:00+03:00`);
  return dayLabel(d.toISOString());
}

function BookForm({
  me,
  as,
  contactId,
  attemptId,
  kindFirst,
  moving,
  note,
  onNote,
  onClose,
  onBooked,
}: {
  me: Me;
  as: As;
  contactId: string;
  attemptId: string | null;
  /** Which call to book first (the demo, right after an intro was held). */
  kindFirst?: "intro" | "demo" | null;
  /** Move this booked call instead of booking a new one. */
  moving?: { id: string; itemKind: ItemKind } | null;
  note: string;
  onNote: (note: string) => void;
  onClose: () => void;
  onBooked: (words: string) => void;
}) {
  const [kind, setKind] = useState<"intro" | "demo">(
    kindFirst ?? (as === "closer" ? "demo" : "intro"),
  );
  const [withWho, setWithWho] = useState<"me" | "anyone">("me");
  const [slots, setSlots] = useState<Slots | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // At once, so a double tap never books twice.
  const booking = useRef(false);
  // A booking that got no clear answer: said until the calendar is read again.
  const [unsure, setUnsure] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // A booking sent without a clear answer: the time it asked for, so the
  // calendar read after it can tell whether it landed.
  const tried = useRef<string | null>(null);
  const bookedRef = useRef(onBooked);
  bookedRef.current = onBooked;

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick asks again after a time was taken
  useEffect(() => {
    let alive = true;
    setSlots(null);
    setError(null);
    setStart(null);
    api<Slots>(
      "book.slots",
      moving
        ? { appointment_id: moving.id }
        : { contact_id: contactId, kind, with: withWho },
    )
      .then(s => {
        if (!alive) return;
        const asked = tried.current;
        tried.current = null;
        if (asked) {
          const there = moving ? s.moving : s.existing;
          if (there && Date.parse(there.start) === Date.parse(asked)) {
            bookedRef.current(
              moving
                ? `Moved to ${there.words} (Kuwait time)`
                : `${s.kind === "demo" ? "Demo" : "Intro"} booked for ${there.words} (Kuwait time)`,
            );
            return;
          }
          setUnsure(
            "The calendar does not show it yet. Pick the time and book again: a booking already on its way is refused, never made twice.",
          );
        }
        setSlots(s);
        setDay(s.days[0]?.day ?? null);
      })
      .catch(e => alive && setError(msg(e)));
    return () => {
      alive = false;
    };
  }, [contactId, kind, withWho, tick, moving?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function book(e: FormEvent) {
    e.preventDefault();
    if (!start || booking.current) return;
    booking.current = true;
    setBusy(true);
    setUnsure(null);
    try {
      const out = await api<{ verified: boolean; words: string }>(
        moving ? "book.move" : "book.create",
        moving
          ? {
              appointment_id: moving.id,
              start,
              note,
              as,
              attempt_id: attemptId,
              item_kind: moving.itemKind,
            }
          : {
              contact_id: contactId,
              kind,
              with: slots?.with ?? withWho,
              start,
              note,
              as,
              attempt_id: attemptId,
            },
      );
      if (!out.verified)
        toast.error(
          "HighLevel took the booking, but reading it back did not match. Open the lead in HighLevel and check the time.",
        );
      onBooked(out.words);
    } catch (err) {
      if (uncertain(err)) {
        // It may have landed: the calendar is read again, and a booking
        // that did land at this time moves on to the next lead.
        tried.current = start;
        setUnsure(
          "No answer came back about the booking, so it may have gone through. Checking the calendar…",
        );
        setTick(n => n + 1);
      } else {
        toast.error(msg(err));
        // A time someone else just took: show what is free now.
        if (/taken|already have/i.test(msg(err))) setTick(n => n + 1);
      }
    } finally {
      booking.current = false;
      setBusy(false);
    }
  }

  const shown = slots?.days.find(d => d.day === day) ?? null;
  return (
    <form onSubmit={book} className="space-y-3 border-t hairline pt-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {moving ? "Move the call" : "Book a time"}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="muted inline-flex items-center gap-1 text-xs hover:underline"
          title="Esc"
        >
          <ArrowLeft className="size-3.5" aria-hidden /> Back to outcomes
        </button>
      </div>
      {moving ? (
        <p className="muted text-sm">
          {slots?.moving
            ? `Now: ${slots.moving.words} (Kuwait time), with the same person. Pick the new time.`
            : "Reading the call…"}
        </p>
      ) : null}
      <div
        className={`flex flex-wrap items-center gap-2 ${moving ? "hidden" : ""}`}
      >
        <Segmented
          label="Which call"
          value={kind}
          options={[
            ["intro", "Intro, 15 min"],
            ["demo", "Demo, 45 min"],
          ]}
          onChange={v => setKind(v as "intro" | "demo")}
        />
        {slots?.on_team && !slots.fallback ? (
          <Segmented
            label="With whom"
            value={withWho}
            options={[
              ["me", `With ${(me.name ?? "me").split(/\s+/)[0]}`],
              ["anyone", "Anyone free"],
            ]}
            onChange={v => setWithWho(v as "me" | "anyone")}
          />
        ) : null}
      </div>
      {error ? (
        <p className="callout-bad rounded-[var(--radius-md)] border px-3 py-2 text-sm">
          The calendar could not be read: {error}
        </p>
      ) : !slots ? (
        <p className="muted text-sm">Reading the calendar's free times…</p>
      ) : slots.existing ? (
        <p className="callout-warn rounded-[var(--radius-md)] border px-3 py-2 text-sm">
          They already have {kind === "intro" ? "an intro" : "a demo"} on{" "}
          {slots.existing.words} (Kuwait time). Move that one in HighLevel
          instead of booking a second; if it was booked from here or by the
          lead, save the call as Handled.
        </p>
      ) : !slots.days.length ? (
        <p className="callout-warn rounded-[var(--radius-md)] border px-3 py-2 text-sm">
          No free times on this calendar in the next few days.{" "}
          {slots.with === "me" && slots.on_team
            ? "Try Anyone free, or book in HighLevel."
            : "Book in HighLevel, or set a call-back instead."}
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Day">
            {slots.days.map(d => (
              <button
                key={d.day}
                type="button"
                aria-pressed={day === d.day}
                onClick={() => {
                  setDay(d.day);
                  setStart(null);
                }}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${
                  day === d.day
                    ? "border-[color:var(--primary)] font-semibold"
                    : "hairline"
                }`}
              >
                {dayWords(d.day)}{" "}
                <span className="muted tabular-nums">{d.slots.length}</span>
              </button>
            ))}
          </div>
          <div
            className="grid grid-cols-4 gap-1 sm:grid-cols-6 xl:grid-cols-4"
            role="group"
            aria-label="Time"
          >
            {(shown?.slots ?? []).map(s => (
              <button
                key={s}
                type="button"
                aria-pressed={start === s}
                onClick={() => setStart(s)}
                className={`rounded-[var(--radius-sm)] border px-1 py-1 text-xs tabular-nums ${
                  start === s
                    ? "border-[color:var(--primary)] bg-[color:color-mix(in_oklch,var(--primary)_14%,transparent)] font-semibold"
                    : "hairline hover:bg-[color:var(--secondary)]"
                }`}
              >
                {clock(s)}
              </button>
            ))}
          </div>
          {slots.fallback ? (
            <p className="muted text-xs">
              You have no free time of your own on this calendar in the next few
              days, so these are the team's; HighLevel's round robin picks who
              takes the call.
            </p>
          ) : null}
          <p className="muted text-xs">
            Kuwait time, {slots.minutes} minutes. {slots.notice}
          </p>
        </div>
      )}
      <label className="block space-y-1">
        <span className="muted block text-xs">
          A line on the call, for whoever takes it (goes on the lead in
          HighLevel too)
        </span>
        <textarea
          id="dial-note"
          value={note}
          onChange={e => onNote(e.target.value)}
          rows={2}
          dir="auto"
          required
          className="w-full rounded-[var(--radius-md)] border hairline bg-[color:var(--background)] px-3 py-2 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={
          busy || !start || Boolean(slots?.existing) || note.trim().length < 3
        }
        className={buttonPrimary}
      >
        <CalendarPlus className="size-3.5" aria-hidden />
        {busy
          ? moving
            ? "Moving…"
            : "Booking…"
          : !start
            ? "Pick a time"
            : note.trim().length < 3
              ? "Write a line on the call first"
              : `${moving ? "Move to" : "Book"} ${dayLabel(start)} ${clock(start)}`}
      </button>
      {unsure ? (
        <p
          role="status"
          className="callout-warn rounded-[var(--radius-md)] border px-3 py-2 text-xs leading-relaxed"
        >
          {unsure}
        </p>
      ) : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// The lead, beside the call
// ---------------------------------------------------------------------------

type LeadTab = "talk" | "script" | "lead" | "history";

function LeadPane({
  className,
  me,
  as,
  contactId,
  item,
  talk,
  convo,
  onTyping,
}: {
  className: string;
  me: Me;
  as: As;
  contactId: string;
  item: DialItem | null;
  /** Changes when the call pane asks for the conversation. */
  talk: { n: number; moment: Moment | null };
  /** The lead's conversation, read once for both panes. */
  convo: ReturnType<typeof useConversation>;
  /** The rep typed in this pane (a message, a note): keep the lead on screen. */
  onTyping: () => void;
}) {
  const lead = useLead(contactId);
  const activity = useLeadActivity(contactId, lead.data?.phone8 ?? null);
  const callNotes = useCallNotes(contactId);
  const pipeline = useSetting<{ roles?: Record<string, string> }>("pipeline");
  const [tab, setTab] = useState<LeadTab>("talk");
  // What goes in the conversation box from outside: the call pane's
  // ready-made message, or a sales asset from "Proof to send".
  const [prefill, setPrefill] = useState<{
    moment?: Moment;
    text?: string;
    asset?: { id: string; url: string | null } | null;
    nonce: number;
  } | null>(null);
  const paneRef = useRef<HTMLElement>(null);
  // "Write to them": open the conversation and put the cursor in the box.
  const lastTalk = useRef(talk.n);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per request (n); the moment rides with it
  useEffect(() => {
    if (talk.n === lastTalk.current) return;
    lastTalk.current = talk.n;
    if (talk.moment) setPrefill({ moment: talk.moment, nonce: talk.n });
    setTab("talk");
    window.setTimeout(() => {
      paneRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      paneRef.current
        ?.querySelector<HTMLTextAreaElement>("form textarea")
        ?.focus();
    }, 50);
  }, [talk.n]);
  const l = lead.data;
  const messages: LiveMessage[] = useMemo(
    () =>
      convo.thread.map(m => ({
        id: m.id,
        direction: m.direction,
        type: m.type,
        status: m.status,
        at: m.at,
        body: m.body,
        has_attachments: m.attachments.length > 0,
        source: m.source,
      })),
    [convo.thread],
  );

  if (lead.error)
    return (
      <div className={className}>
        <Failed what="This lead" error={lead.error} retry={lead.reload} />
      </div>
    );
  if (!l)
    return (
      <div className={`panel p-4 ${className}`}>
        <p className="muted text-sm">
          {lead.loading
            ? "Opening the lead…"
            : "This lead is not in the cockpit yet. It may have arrived in the last few minutes."}
        </p>
      </div>
    );

  const appointments = activity.data?.appointments ?? [];
  const next = appointments
    .filter(
      a =>
        a.start_at &&
        Date.parse(a.start_at) > Date.now() &&
        a.status !== "cancelled",
    )
    .sort(
      (x, y) => Date.parse(String(x.start_at)) - Date.parse(String(y.start_at)),
    )[0];

  return (
    <section
      ref={paneRef}
      aria-label="The lead"
      className={`panel min-w-0 overflow-hidden ${className}`}
      onInput={onTyping}
    >
      <header className="space-y-1.5 border-b hairline px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2
            className={`min-w-0 text-xl font-semibold tracking-tight ${isArabic(l.name) ? "ar" : ""}`}
            dir="auto"
          >
            {l.name ?? "Unnamed lead"}
          </h2>
          <StatusChip
            size="md"
            tone={
              l.lead_class === "qualified"
                ? "good"
                : l.lead_class === "unprepared"
                  ? "warning"
                  : "neutral"
            }
            label={classLabel(l.lead_class)}
          />
          {isClient(l) ? (
            <StatusChip
              size="md"
              tone="good"
              label="Active client"
              title={CLIENT_NOTE}
            />
          ) : null}
          {item ? (
            <StatusChip
              size="md"
              tone={TIER[item.tier].tone}
              label={TIER[item.tier].label}
            />
          ) : null}
          {l.stage_name ? (
            <StatusChip
              size="md"
              tone="neutral"
              label={plainStage(l.stage_name)}
            />
          ) : null}
        </div>
        <p className="muted text-sm">
          {[
            l.company,
            countryName(l.country, "en") ?? l.country,
            l.lead_created_at ? `came in ${ago(l.lead_created_at)}` : null,
            next
              ? `${next.call_type === "demo" ? "Demo" : "Intro"} booked ${when(next.start_at)}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {isClient(l) ? (
          <p className="muted text-xs">{CLIENT_NOTE}</p>
        ) : (
          <HotControl me={me} contactId={contactId} />
        )}
        <div className="flex flex-wrap gap-3 text-xs">
          <Link
            to={`/lead/${contactId}`}
            className="underline underline-offset-2"
          >
            Open the lead
          </Link>
          <a
            href={`https://app.gohighlevel.com/v2/location/7NI8yyJtwsh2OOWA5Icr/contacts/detail/${contactId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline underline-offset-2"
          >
            HighLevel <ExternalLink className="size-3" aria-hidden />
          </a>
        </div>
      </header>
      <div
        className="flex gap-1 overflow-x-auto border-b hairline px-3 pt-2"
        role="tablist"
        aria-label="About the lead"
      >
        {(
          [
            ["talk", "Conversation"],
            ["script", "Script"],
            ["lead", "Lead and ad"],
            ["history", "History"],
          ] as [LeadTab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`-mb-px shrink-0 border-b-2 px-3 pb-2 text-sm ${
              tab === k
                ? "border-[color:var(--primary)] font-semibold"
                : "muted border-transparent hover:text-[color:var(--foreground)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="p-4" role="tabpanel">
        {tab === "talk" ? (
          <div className="space-y-5">
            {/* Its own boundary: a conversation that cannot be drawn never
                takes the call column (and an open video room) with it. */}
            <LiveBoundary fallback={<ConversationFailed />}>
              <Conversation
                contactId={contactId}
                convo={convo}
                compact
                rep={me.name}
                // The lead's booked call, for {day} and {time}: the next intro
                // or demo on any item, else a closer's own demo.
                callAt={
                  item?.appointment?.start_at ??
                  (as === "closer" ? item?.demo_at : null) ??
                  null
                }
                country={l?.country ?? null}
                prefill={prefill}
              />
            </LiveBoundary>
            <div className="border-t hairline pt-4">
              <p className="mb-2 text-sm font-semibold">Proof to send</p>
              <ProofToSend
                contactId={contactId}
                language={leadLanguage(
                  convo.thread
                    .filter(m => m.direction === "inbound")
                    .map(m => m.body),
                )}
                stage={assetStage(
                  pipeline.data?.roles?.[String(l?.stage_id ?? "")] ?? null,
                )}
                objections={objectionsFrom(
                  (callNotes.data ?? []).flatMap(n =>
                    (n.notes.objections ?? []).map(o => o.objection),
                  ),
                )}
                onUse={(text, a) =>
                  setPrefill({
                    text,
                    asset: { id: a.id, url: a.url },
                    nonce: Date.now(),
                  })
                }
              />
            </div>
          </div>
        ) : tab === "script" ? (
          <ScriptTab
            me={me}
            as={as}
            lead={l}
            demo={appointments.find(a => a.call_type === "demo") ?? null}
          />
        ) : tab === "lead" ? (
          <div className="grid gap-5 xl:grid-cols-2">
            {(callNotes.data ?? []).length ? (
              <div className="space-y-2 xl:col-span-2">
                <p className="text-sm font-semibold">
                  What the last call told us
                </p>
                <CallNotesList notes={callNotes.data ?? []} compact />
              </div>
            ) : null}
            <div className="space-y-2">
              <p className="text-sm font-semibold">What they told us</p>
              <Answers lead={l} />
            </div>
            <div className="space-y-5">
              <div className="space-y-2">
                <p className="text-sm font-semibold">Where they came from</p>
                <AdOrigin lead={l} />
              </div>
              <div className="space-y-2">
                <p className="text-sm font-semibold">Research</p>
                <ResearchPanel contactId={contactId} me={me} />
              </div>
            </div>
          </div>
        ) : activity.error ? (
          <Failed
            what="This lead's history"
            error={activity.error}
            retry={activity.reload}
          />
        ) : (
          <LeadTimeline
            appointments={appointments}
            dials={activity.data?.dials ?? []}
            deals={activity.data?.deals ?? []}
            proposals={activity.data?.proposals ?? []}
            messages={messages}
            loading={!activity.data}
            // The conversation tab says when a later read fails; the history
            // says so only when it has none of the messages.
            messagesLoading={!convo.data && !convo.error}
            messagesError={convo.data ? null : convo.error}
            messagesRetry={() => void convo.reload()}
          />
        )}
      </div>
    </section>
  );
}

/** The script beside the call: one stage at a time, the playbook under it. */
function ScriptTab({
  me,
  as,
  lead,
  demo,
}: {
  me: Me;
  as: As;
  lead: Lead;
  demo: { assigned_user_name: string | null; start_at: string | null } | null;
}) {
  const [key, setKey] = useState<Key>(as === "closer" ? "demo" : "intro");
  const [prefs, setPrefs] = useState(readPrefs);
  const script = useScript(key, prefs.lang);
  const [stageIdx, setStageIdx] = useState(0);
  const doc = script.data?.doc;
  const fill: Fill = useMemo(
    () => ({
      name: lead.name?.split(/\s+/)[0] ?? null,
      yourName: (me.name ?? "").split(/\s+/)[0] || null,
      city: countryName(lead.country, prefs.lang),
      closer: demo?.assigned_user_name ?? null,
      date: demo?.start_at ? when(demo.start_at) : null,
    }),
    [lead, me.name, demo, prefs.lang],
  );
  function setPref(p: Partial<{ lang: "en" | "ar"; mode: Mode }>) {
    const next = { ...prefs, ...p };
    setPrefs(next);
    writePrefs(next);
  }
  const stages = doc?.stages ?? [];
  const stage = stages[Math.min(stageIdx, Math.max(stages.length - 1, 0))];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Script"
          value={key}
          options={[
            ["intro", "Intro"],
            ["demo", "Demo"],
          ]}
          onChange={v => {
            setKey(v as Key);
            setStageIdx(0);
          }}
        />
        <Segmented
          label="Language"
          value={prefs.lang}
          options={[
            ["ar", "العربية"],
            ["en", "English"],
          ]}
          onChange={v => setPref({ lang: v as "en" | "ar" })}
        />
        <Segmented
          label="How much to show"
          value={prefs.mode}
          options={[
            ["words", "Word for word"],
            ["bullets", "Bullets"],
          ]}
          onChange={v => setPref({ mode: v as Mode })}
        />
        <Link
          to={`/call/${lead.contact_id}?script=${key}`}
          className="muted ms-auto text-xs underline underline-offset-2"
        >
          Open the guided call, with answers to capture
        </Link>
      </div>
      {script.error ? (
        <Failed what="The script" error={script.error} retry={script.reload} />
      ) : !doc || !stage ? (
        <p className="muted text-sm">
          {script.loading
            ? "Reading the script…"
            : "This script has not been imported yet."}
        </p>
      ) : (
        <>
          <div
            className="flex gap-1 overflow-x-auto pb-1"
            role="group"
            aria-label="Stage"
          >
            {stages.map((s, i) => (
              <button
                key={s.no}
                type="button"
                aria-pressed={i === stageIdx}
                onClick={() => setStageIdx(i)}
                className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs ${
                  i === stageIdx
                    ? "border-[color:var(--primary)] font-semibold"
                    : "hairline muted"
                }`}
              >
                {s.title}
              </button>
            ))}
          </div>
          <div className="space-y-3">
            {stage.goal ? <p className="muted text-sm">{stage.goal}</p> : null}
            {groupBlocks(stage.blocks).map((g, gi) =>
              g.branch ? (
                <BranchGroup
                  key={`${stage.no}-${gi}`}
                  label={personalise(g.branch, fill)}
                >
                  <Blocks blocks={g.blocks} fill={fill} mode={prefs.mode} />
                </BranchGroup>
              ) : (
                <Blocks
                  key={`${stage.no}-${gi}`}
                  blocks={g.blocks}
                  fill={fill}
                  mode={prefs.mode}
                />
              ),
            )}
            {stageIdx < stages.length - 1 ? (
              <button
                type="button"
                className={button}
                onClick={() => setStageIdx(stageIdx + 1)}
              >
                Next: {stages[stageIdx + 1].title}
              </button>
            ) : null}
          </div>
          <Playbook objections={doc.objections} faqs={doc.faqs} fill={fill} />
        </>
      )}
    </div>
  );
}
