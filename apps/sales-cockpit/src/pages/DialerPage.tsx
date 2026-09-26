import {
  Bell,
  BellRing,
  CalendarClock,
  CalendarPlus,
  Copy,
  ExternalLink,
  Flame,
  ListOrdered,
  PhoneCall,
  PhoneOff,
  Search,
  SkipForward,
  X,
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
import { Link } from "react-router";
import { AdOrigin } from "../components/AdOrigin";
import { CallNotesList, useCallNotes } from "../components/CallNotes";
import { Conversation, useConversation } from "../components/Conversation";
import { HotControl } from "../components/HotList";
import {
  button,
  buttonPrimary,
  EmptyState,
  Failed,
  field,
  StatTile,
  StatusChip,
  type Tone,
} from "../components/kit";
import { Answers } from "../components/LeadAnswers";
import { LeadTimeline, type LiveMessage } from "../components/LeadTimeline";
import { ResearchPanel } from "../components/ResearchPanel";
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
import { api } from "../lib/api";
import { useLead, useLeadActivity, useLeadSearch, useNow } from "../lib/data";
import {
  alertsWanted,
  callbackPicks,
  chime,
  clearDraft,
  countdown,
  type Draft,
  localInput,
  mmss,
  primeSound,
  type QueueItem,
  readDraft,
  setAlertsWanted,
  type UrgentEvent,
  urgentEvents,
  writeDraft,
} from "../lib/dialer";
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
import { type Fill, groupBlocks, personalise } from "../lib/script";
import { toast } from "../lib/toast";
import type { Lead, Me } from "../lib/types";
import type { Moment } from "../lib/whatsapp";

/**
 * The power dialer, level with the call centre's (mahara-power-dialer): the
 * queue in the order the playbook says, one lead at a time with everything
 * about them beside the call, the call placed through Maqsam on the right
 * line for the lead's country, and Maqsam's own record of the call read back
 * while it runs. A call nobody answered saves itself and the next lead comes
 * up; any other outcome is one click and a line of notes, a booking goes on
 * the HighLevel calendar from here, and calling through the dialer is never
 * required before saving.
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
  queue: QueueItem[];
  /** When this copy was asked for, in the browser. */
  loadedAt: number;
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

type ItemKind = "lead" | "intro" | "confirm";

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

function shortAgo(iso: string | null, now: number): string {
  if (!iso) return "";
  const m = Math.round((now - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(m)) return "";
  if (m < 0) {
    const f = -m;
    return f < 60
      ? `in ${f}m`
      : f < 2880
        ? `in ${Math.round(f / 60)}h`
        : `in ${Math.round(f / 1440)}d`;
  }
  if (m < 60) return `${Math.max(m, 0)}m`;
  if (m < 2880) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
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
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
  const [savedAt, setSavedAt] = useState<Record<string, number>>({});
  const [picked, setPicked] = useState<string | null>(null);
  const [tier, setTier] = useState<TierFilter>("all");
  const [term, setTerm] = useState("");
  const [alertsOn, setAlertsOn] = useState(alertsWanted);
  // Bumped to open the lead's conversation from the call pane ("Write to
  // them"), with the ready-made message to start from, if any.
  const [talk, setTalk] = useState<{ n: number; moment: Moment | null }>({
    n: 0,
    moment: null,
  });
  const maqsam = useAgent();

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
          const out = await api<Omit<Queue, "loadedAt">>("dial.queue", {
            as: asked,
            limit: 80,
          });
          if (asked === asRef.current) {
            setQ({ ...out, loadedAt });
            setError(null);
          }
        } catch (e) {
          setError(msg(e));
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

  const open = q?.open ?? null;
  const visible = useMemo(
    () =>
      (q?.queue ?? []).filter(
        i =>
          !skipped.has(i.contact_id) &&
          !(
            savedAt[i.contact_id] && (q?.loadedAt ?? 0) < savedAt[i.contact_id]
          ),
      ),
    [q, skipped, savedAt],
  );
  const priority = visible[0] ?? null;
  const currentId = open?.contact_id ?? picked ?? priority?.contact_id ?? null;
  const current =
    (q?.queue ?? []).find(i => i.contact_id === currentId) ?? null;
  const manual = !open && picked !== null && picked !== priority?.contact_id;
  const urgent = useMemo(
    () =>
      urgentEvents(visible, Date.now()).filter(
        e => e.contact_id !== open?.contact_id,
      ),
    [visible, open?.contact_id],
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
      for (const e of fresh.slice(0, 3))
        new Notification(`${e.title}: ${e.name ?? "a lead"}`, {
          body: e.callback
            ? "Call them back now, as agreed."
            : "Dial within two minutes.",
          tag: e.key,
        });
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

  // Alt+D calls, Alt+N goes to the notes (the call centre's keys).
  const callRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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

  function finished(
    contactId: string,
    how: "saved" | "skipped",
    words?: string,
  ) {
    if (how === "skipped") setSkipped(s => new Set(s).add(contactId));
    else setSavedAt(s => ({ ...s, [contactId]: Date.now() }));
    setPicked(null);
    setQ(prev =>
      prev && prev.open?.contact_id === contactId
        ? { ...prev, open: null }
        : prev,
    );
    if (words) toast.success(words);
    void load();
    void maqsam.check();
  }

  const counts = q?.counts ?? [0, 0, 0, 0];
  const ready = counts.reduce((a, b) => a + b, 0);

  return (
    <main className="mx-auto w-full max-w-[1800px] space-y-4 px-4 py-5 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dialer</h1>
          <p className="muted text-sm">
            {q
              ? ready
                ? `${counts[0] + counts[1]} to call now or today · ${counts[2]} due · ${counts[3]} never called`
                : "Nobody waiting. New leads, replies and call-backs come in by themselves."
              : "Working out who to call…"}
          </p>
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
              onChange={v => {
                setAs(v as As);
                setQ(null);
                setPicked(null);
                setSkipped(new Set());
              }}
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

      <UrgentStrip
        events={urgent}
        locked={Boolean(open)}
        onPick={id => setPicked(id)}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[16rem_minmax(0,1fr)] lg:[grid-template-areas:'queue_call'_'queue_lead'] 2xl:grid-cols-[17rem_minmax(0,1fr)_23rem] 2xl:[grid-template-areas:'queue_lead_call']">
        <QueuePane
          className="lg:[grid-area:queue]"
          loaded={Boolean(q)}
          items={visible}
          counts={counts}
          currentId={currentId}
          manual={manual}
          locked={Boolean(open)}
          tier={tier}
          setTier={setTier}
          term={term}
          setTerm={setTerm}
          onPick={id => setPicked(id)}
          onBack={() => setPicked(null)}
        />
        {currentId ? (
          <>
            <CallPane
              key={`call-${currentId}`}
              className="lg:[grid-area:call] 2xl:sticky 2xl:top-4 2xl:self-start"
              me={me}
              as={as}
              contactId={currentId}
              item={current}
              open={open?.contact_id === currentId ? open : null}
              agent={maqsam}
              callRef={callRef}
              onCalled={a => setQ(prev => (prev ? { ...prev, open: a } : prev))}
              onFinished={finished}
              onTalk={moment =>
                setTalk(t => ({ n: t.n + 1, moment: moment ?? null }))
              }
            />
            <LeadPane
              key={`lead-${currentId}`}
              className="lg:[grid-area:lead]"
              me={me}
              as={as}
              contactId={currentId}
              item={current}
              talk={talk}
            />
          </>
        ) : q ? (
          <div className="panel lg:[grid-area:call] 2xl:[grid-area:lead/lead/call/call]">
            <EmptyState
              icon={PhoneCall}
              title="Nobody to call right now"
              text="New leads, replies and due call-backs appear here as they happen; the queue checks every 15 seconds. Search the queue's box to call someone in particular."
            />
          </div>
        ) : null}
      </div>
    </main>
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
      {/* On a phone the day fits one line, so Call stays near the top. */}
      <p className="muted text-sm sm:hidden">
        {t && ready !== null
          ? `Today: ${t.saved} saved · ${t.answered} of ${t.calls} answered · ${t.booked} booked · ${ready} ready`
          : "Reading today's numbers…"}
      </p>
      <div className="hidden grid-cols-2 gap-3 sm:grid lg:grid-cols-4">
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
              className="shrink-0 text-right text-sm font-semibold tabular-nums"
              style={{ color: late ? "var(--destructive)" : undefined }}
            >
              {countdown(e, now)}
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
  items: QueueItem[];
  counts: number[];
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
              ).map(([k, label, n]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={tier === k}
                  onClick={() => setTier(k)}
                  className={`rounded-full border px-2 py-0.5 text-[11px] tabular-nums ${
                    tier === k
                      ? "border-[color:var(--primary)] font-semibold"
                      : "hairline muted"
                  }`}
                >
                  {label} {n}
                </button>
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
                      ) : null}
                      {i.why}
                    </span>
                    {i.hot_reasons?.length ? (
                      <span
                        className="block truncate text-[11px]"
                        style={{ color: "var(--primary)" }}
                      >
                        {i.hot ? (
                          <Flame
                            className="me-0.5 inline size-3 align-[-2px]"
                            aria-hidden
                          />
                        ) : null}
                        {i.hot_reasons.join(" · ")}
                      </span>
                    ) : null}
                  </span>
                  <span className="muted shrink-0 pt-0.5 text-[11px] tabular-nums">
                    {i.kind === "intro" || i.kind === "confirm"
                      ? clock(i.appointment?.start_at ?? null)
                      : shortAgo(i.inbound_at ?? i.created_at, now)}
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
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The call: the line's state, Call, and how it went
// ---------------------------------------------------------------------------

/** Maqsam's record of the open call, asked every few seconds until it ends. */
function useCallStatus(
  attempt: Attempt | null,
  onAutoSaved: (words: string) => void,
) {
  const [call, setCall] = useState<CallInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
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
        setCall(r.call);
        setError(null);
        if (r.auto_saved) {
          done.current(
            "No answer, saved from Maqsam's record. Next lead is up.",
          );
          again = false;
        } else if (r.attempt?.state !== "placed" || r.call?.final) {
          again = false;
        }
      } catch (e) {
        if (alive) setError(msg(e));
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
  return { call, error };
}

function CallPane({
  className,
  me,
  as,
  contactId,
  item,
  open,
  agent,
  callRef,
  onCalled,
  onFinished,
  onTalk,
}: {
  className: string;
  me: Me;
  as: As;
  contactId: string;
  item: QueueItem | null;
  open: Attempt | null;
  agent: ReturnType<typeof useAgent>;
  callRef: MutableRefObject<(() => void) | null>;
  onCalled: (a: Attempt) => void;
  onFinished: (
    contactId: string,
    how: "saved" | "skipped",
    words?: string,
  ) => void;
  onTalk: (moment?: Moment) => void;
}) {
  const lead = useLead(contactId);
  const l = lead.data;
  const [draft, setDraftState] = useState<Draft>(() => readDraft(contactId));
  const [busy, setBusy] = useState<null | "call" | "save" | "skip">(null);
  // What the form is showing: the outcomes, a booking, a move, or what comes
  // after an outcome that has a next step.
  const [mode, setMode] = useState<
    "outcomes" | "book" | "move" | "held" | "unanswered"
  >("outcomes");
  const [bookKind, setBookKind] = useState<"intro" | "demo" | null>(null);
  // Once the intro is marked held, what follows is ordinary lead work.
  const [kind, setKind] = useState<ItemKind>(item?.kind ?? "lead");
  const appt = item?.appointment ?? null;
  const status = useCallStatus(open, words =>
    onFinished(contactId, "saved", words),
  );
  const outcomes = OUTCOMES[kind];
  const chosen = outcomes.find(o => o.key === draft.outcome) ?? null;
  const dnd = Boolean(l?.dnd);

  function setDraft(d: Partial<Draft>) {
    setDraftState(prev => {
      const next = { ...prev, ...d };
      writeDraft(contactId, next);
      return next;
    });
  }

  async function call() {
    if (busy || open || dnd) return;
    setBusy("call");
    try {
      const out = await api<{
        attempt: Attempt;
        route: { country: string; caller: string };
      }>("dial.call", { contact_id: contactId, as });
      onCalled(out.attempt);
      toast.success(
        `Calling on the ${out.route.country} line. Pick up in the Maqsam softphone.`,
      );
    } catch (e) {
      toast.error(msg(e));
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

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!draft.outcome || busy) return;
    if (draft.outcome === "booked") {
      setBookKind(null);
      setMode("book");
      return;
    }
    if (draft.outcome === "rescheduled") {
      setMode("move");
      return;
    }
    setBusy("save");
    try {
      await api("dial.save", {
        ...(open ? { attempt_id: open.id } : { contact_id: contactId }),
        outcome: draft.outcome,
        note: draft.note,
        as,
        item_kind: kind,
        appointment_id: kind === "lead" ? null : (appt?.id ?? null),
        callback_at:
          draft.outcome === "callback" && draft.callback
            ? new Date(draft.callback).toISOString()
            : null,
      });
      clearDraft(contactId);
      // Two outcomes have a next step before the next lead.
      if (kind === "intro" && draft.outcome === "showed") {
        setKind("lead");
        setDraftState({ outcome: null, note: "", callback: "" });
        setMode("held");
        toast.success("Marked held. Book the demo, or set a call-back.");
        return;
      }
      if (draft.outcome === "no_answer") {
        setMode("unanswered");
        return;
      }
      onFinished(
        contactId,
        "saved",
        `Saved: ${chosen?.label ?? draft.outcome}. Next lead is up.`,
      );
    } catch (err) {
      toast.error(msg(err));
    } finally {
      setBusy(null);
    }
  }

  async function skip() {
    setBusy("skip");
    try {
      if (open) await api("dial.release", { attempt_id: open.id });
      onFinished(contactId, "skipped", "Skipped for now. Next lead is up.");
    } catch (err) {
      toast.error(msg(err));
    } finally {
      setBusy(null);
    }
  }

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
      />
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void call()}
            disabled={Boolean(busy) || Boolean(open) || dnd || !l}
            className={`${buttonPrimary} h-10 px-4 text-[15px]`}
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
            <button
              type="button"
              onClick={() =>
                onFinished(contactId, "saved", "Saved. Next lead is up.")
              }
              className={button}
            >
              Next lead
            </button>
          </NextStep>
        ) : mode === "unanswered" ? (
          <NextStep
            title="No answer. Send them a WhatsApp?"
            text={
              kind === "confirm"
                ? "A short WhatsApp asking them to confirm often gets the answer a call did not. The dialer tries the call again in two hours."
                : "A WhatsApp right after a missed call gets answered far more often than an email. The missed-call message is ready in the box; read it, then send."
            }
          >
            <button
              type="button"
              onClick={() =>
                onTalk(kind === "confirm" ? "confirm" : "missed_call")
              }
              className={buttonPrimary}
            >
              WhatsApp them
            </button>
            <button
              type="button"
              onClick={() =>
                onFinished(contactId, "saved", "Saved. Next lead is up.")
              }
              className={button}
            >
              Next lead
            </button>
          </NextStep>
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
          <form onSubmit={save} className="space-y-3 border-t hairline pt-4">
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
              className="grid grid-cols-2 gap-1.5 sm:grid-cols-3"
              role="group"
              aria-label="Outcome"
            >
              {outcomes.map(o => (
                <button
                  key={o.key}
                  type="button"
                  aria-pressed={draft.outcome === o.key}
                  title={o.hint}
                  onClick={() => {
                    setDraft({ outcome: o.key });
                    if (o.key === "booked") {
                      setBookKind(null);
                      setMode("book");
                    }
                    if (o.key === "rescheduled") setMode("move");
                  }}
                  className={`rounded-[var(--radius-md)] border px-2.5 py-1.5 text-sm ${
                    draft.outcome === o.key
                      ? "border-[color:var(--primary)] bg-[color:color-mix(in_oklch,var(--primary)_10%,transparent)] font-semibold"
                      : "hairline hover:bg-[color:var(--secondary)]"
                  }`}
                >
                  {o.key === "booked" ? (
                    <span className="inline-flex items-center gap-1">
                      <CalendarPlus className="size-3.5" aria-hidden />
                      {o.label}
                    </span>
                  ) : (
                    o.label
                  )}
                </button>
              ))}
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
                  ? "What happened (goes on the lead in HighLevel too) · Alt+N"
                  : "Notes (optional) · Alt+N"}
              </span>
              <textarea
                id="dial-note"
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
                placeholder={
                  draft.outcome ? "" : "Pick how it went, then a line on it"
                }
                className="w-full rounded-[var(--radius-md)] border hairline bg-[color:var(--background)] px-3 py-2 text-sm"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={Boolean(busy) || !draft.outcome}
                className={buttonPrimary}
                title="Ctrl+Enter or Cmd+Enter in the notes"
              >
                {busy === "save"
                  ? "Saving…"
                  : draft.outcome === "booked" ||
                      draft.outcome === "rescheduled"
                    ? "Pick a time"
                    : "Save and next"}
              </button>
              {!open &&
              draft.outcome &&
              draft.outcome !== "booked" &&
              draft.outcome !== "rescheduled" ? (
                <span className="muted text-xs">
                  No call through the dialer: saved as a call made elsewhere.
                </span>
              ) : null}
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

function NextStep({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2 border-t hairline pt-4">
      <p className="text-sm font-medium">{title}</p>
      <p className="muted text-xs">{text}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

/**
 * The line: what the call is doing right now, in one band. Ready; the
 * two-minute countdown for a lead to call now; ringing; Maqsam's record once
 * the call ends; or why it did not go through.
 */
function CallBand({
  item,
  open,
  call,
  callError,
  dnd,
}: {
  item: QueueItem | null;
  open: Attempt | null;
  call: CallInfo | null;
  callError: string | null;
  dnd: boolean;
}) {
  const now = useNow(1000);
  const urgent = useMemo(
    () => (item && !open ? urgentEvents([item], Date.now())[0] : undefined),
    [item, open],
  );
  let color = "var(--border)";
  let title: string;
  let detail: string | null = null;
  let big: string | null = null;
  if (dnd) {
    color = "var(--destructive)";
    title = "Do not disturb is on";
    detail =
      "This lead asked not to be contacted in HighLevel. Save what happened without calling.";
  } else if (open?.state === "failed") {
    color = "var(--destructive)";
    title = "The call did not go through";
    detail = open.error ?? "Maqsam did not take it. Call again or save.";
  } else if (open) {
    const since = now - Date.parse(open.started_at);
    if (call?.final) {
      color = call.answered ? "var(--success)" : "var(--muted-foreground)";
      title = `Maqsam: ${call.words}`;
      big = call.answered ? mmss(call.seconds * 1000) : null;
      detail = call.answered
        ? "Save how it went."
        : "Nobody spoke. Save it as No answer or Call back.";
    } else {
      color = "var(--now)";
      title = "Ringing you in Maqsam, then the lead";
      big = mmss(since);
      detail = callError
        ? `Maqsam's record could not be read: ${callError}. Save how it went when you are done.`
        : call
          ? `Maqsam: ${call.words}.`
          : "Maqsam's record of the call is read every few seconds; an unanswered call saves itself.";
    }
  } else if (urgent) {
    const late = urgent.deadline <= now;
    color = late ? "var(--destructive)" : "var(--warning)";
    title =
      item?.kind === "confirm" || item?.kind === "intro"
        ? item.why
        : urgent.title;
    big = countdown(urgent, now);
    detail =
      item?.kind === "intro"
        ? "Intros are phone calls: call them at the booked time, then say how it went."
        : item?.kind === "confirm"
          ? `Booked ${ago(item.appointment?.booked_at ?? null, now)}; not confirmed yet.`
          : null;
  } else if (item?.kind === "confirm") {
    color = "var(--primary)";
    title = item.why;
    detail = `Booked ${ago(item.appointment?.booked_at ?? null, now)}; not confirmed yet. Call, or message them on WhatsApp.`;
  } else {
    title = "Ready to call";
    detail = item
      ? [
          item.why,
          item.step
            ? `${item.step} unanswered ${item.step === 1 ? "try" : "tries"} so far`
            : null,
          item.last_dial_at
            ? `last called ${ago(item.last_dial_at, now)}`
            : "never called",
        ]
          .filter(Boolean)
          .join(" · ")
      : "Picked from the search. Call, or save what happened.";
  }
  return (
    <div
      className="flex items-center gap-3 border-b hairline px-4 py-3"
      style={{
        borderInlineStart: `4px solid ${color}`,
        background: `color-mix(in oklch, ${color === "var(--border)" ? "var(--secondary)" : color} 9%, transparent)`,
      }}
      aria-live="polite"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        {detail ? <p className="muted text-xs">{detail}</p> : null}
      </div>
      {big ? (
        <p className="shrink-0 font-mono text-xl font-semibold tabular-nums tracking-tight">
          {big}
        </p>
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
  const [tick, setTick] = useState(0);

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
    if (!start || busy) return;
    setBusy(true);
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
      toast.error(msg(err));
      // A time someone else just took: show what is free now.
      if (/taken|already have/i.test(msg(err))) setTick(n => n + 1);
    } finally {
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
          <X className="size-3.5" aria-hidden /> Back to outcomes
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
            className="grid grid-cols-4 gap-1 sm:grid-cols-6 2xl:grid-cols-4"
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
          : start
            ? `${moving ? "Move to" : "Book"} ${dayLabel(start)} ${clock(start)}`
            : "Pick a time"}
      </button>
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
}: {
  className: string;
  me: Me;
  as: As;
  contactId: string;
  item: QueueItem | null;
  /** Changes when the call pane asks for the conversation. */
  talk: { n: number; moment: Moment | null };
}) {
  const lead = useLead(contactId);
  const activity = useLeadActivity(contactId, lead.data?.phone8 ?? null);
  const convo = useConversation(contactId);
  const callNotes = useCallNotes(contactId);
  const [tab, setTab] = useState<LeadTab>("talk");
  const paneRef = useRef<HTMLElement>(null);
  // "Write to them": open the conversation and put the cursor in the box.
  const lastTalk = useRef(talk.n);
  useEffect(() => {
    if (talk.n === lastTalk.current) return;
    lastTalk.current = talk.n;
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
        <HotControl me={me} contactId={contactId} />
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
          <Conversation
            contactId={contactId}
            convo={convo}
            compact
            rep={me.name}
            callAt={item?.appointment?.start_at ?? null}
            prefill={
              talk.moment ? { moment: talk.moment, nonce: talk.n } : null
            }
          />
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
