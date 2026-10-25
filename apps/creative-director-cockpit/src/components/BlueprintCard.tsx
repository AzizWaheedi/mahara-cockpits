import { ArrowUpRight, Copy, Presentation, RotateCw } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import {
  type Answers,
  type BlueprintCall,
  type BlueprintRow,
  blueprintDone,
  blueprintPartDone,
  blueprintSession,
  type Change,
  type Conflict,
  callRoute,
  clickupTask,
  dayShort,
  dayWeek,
  FieldSaver,
  forgetPress,
  KEY_LABEL,
  launchTaskOf,
  missing,
  missingSentence,
  OFFER_LABEL,
  OFFER_MAX,
  type Offer,
  type OfferLine,
  offerOf,
  offerWait,
  outboxOf,
  PART_NAME,
  PARTS,
  type Part,
  type PartState,
  type PressResult,
  partState,
  problem,
  type RunResult,
  readBlueprintCall,
  readBlueprints,
  rehearseBlueprintPart,
  runBlueprintPart,
  type SaveResult,
  saveBlueprint,
  stampOf,
  tidy,
  waited,
  whenLong,
  whenNear,
} from "@/lib/blueprint";
import {
  type NoticeRead,
  type NoticeView,
  noticeOf,
  readNotices,
} from "@/lib/notices";
import { cn } from "@/lib/utils";

/**
 * The Brand Blueprint card on a client's page (docs/brand-blueprint SPEC.md
 * 4.0 and 4.1): the three parts as a run sheet, the way into the call (its
 * page inside this cockpit, EMBED.md 4.1), and the offer slip, where the
 * creative director finishes part 3 a day or two after the call and locks
 * it.
 *
 * Everything the card writes goes through the record's own functions
 * (cockpit_blueprint_save and cockpit_blueprint_part_done) and the creative
 * outbox; nothing here talks to ClickUp. With ?rehearse=1, an admin or the
 * CEO keeps every answer in memory and each press only shows its plan.
 */

export type BlueprintIO = {
  read: (taskId: string) => Promise<{ row: BlueprintRow | null; now: string }>;
  save: (args: {
    taskId: string;
    changes: Record<string, Change>;
    session: string;
    baseRevision: number | null;
  }) => Promise<SaveResult>;
  press: (args: {
    taskId: string;
    part: Part;
    answers: Answers;
  }) => Promise<PressResult & { key: string }>;
  run: (id: string) => Promise<RunResult>;
  forget: (key: string) => void;
  rehearse: (args: {
    taskId: string;
    part: Part;
    answers: Answers;
  }) => Promise<{ missing: string[]; lines: string[] }>;
  session: () => string;
  /**
   * The Blueprint call against the record (cockpit_blueprint_sources'
   * blueprintCall): the nudge when a call was held and nothing was closed.
   */
  call?: (taskId: string) => Promise<BlueprintCall | null>;
  /** The client success cockpit's Slack notices for this card. */
  notices?: (taskId: string) => Promise<NoticeRead>;
};

type Client = NonNullable<ReturnType<typeof useCockpitAuth>["client"]>;

export function supabaseBlueprintIO(client: Client): BlueprintIO {
  return {
    read: async taskId => {
      const { rows, now } = await readBlueprints(client, [taskId]);
      return { row: rows.find(r => r.taskId === taskId) ?? null, now };
    },
    save: args => saveBlueprint(client, args),
    press: args => blueprintPartDone(client, args),
    run: id => runBlueprintPart(client, id),
    forget: forgetPress,
    rehearse: args => rehearseBlueprintPart(client, args),
    session: blueprintSession,
    call: taskId => readBlueprintCall(client, taskId),
    notices: taskId => readNotices(client, taskId),
  };
}

/**
 * Rehearsal saves: an in-memory copy of the record, seeded from the real
 * one, that answers the way cockpit_blueprint_save does. Nothing leaves the
 * page.
 */
function rehearsalIO(real: BlueprintIO, clientName: string): BlueprintIO {
  let mem: BlueprintRow | null = null;
  return {
    ...real,
    read: async taskId => {
      const r = await real.read(taskId);
      mem ??= r.row;
      return { row: mem, now: r.now };
    },
    save: async args => {
      const answers: Answers = { ...(mem?.answers ?? {}) };
      for (const [k, c] of Object.entries(args.changes)) {
        if (c.value === null || c.value === "") delete answers[k];
        else answers[k] = c.value;
      }
      const at = new Date().toISOString();
      mem = {
        taskId: args.taskId,
        clientName: mem?.clientName ?? clientName,
        answers,
        parts: mem?.parts ?? {},
        revision: (mem?.revision ?? 0) + 1,
        launchTaskId: mem?.launchTaskId ?? null,
        outbox: mem?.outbox ?? null,
        updatedAt: at,
      };
      return { row: mem, applied: Object.keys(args.changes), conflicts: [] };
    },
    press: async () => {
      throw new Error("A rehearsal shows the plan only.");
    },
    run: async () => ({ ok: false, error: "A rehearsal sends nothing." }),
  };
}

const CLOSED_AFTER_MS = 35 * 60_000;
/** The stages at which a held Blueprint call with no close is a miss. */
const NUDGE_STAGE = /brand blueprint booked|ready for launch/i;
const IN_ONBOARDING =
  /onboarding|blueprint|launch booked|ready for launch|kick ?off/i;

/** Shows for clients in onboarding, and for anyone with a Blueprint on record. */
export function BlueprintCard({
  taskId,
  clientName,
  status,
  offerSheet,
  io: given,
  initial,
  rehearse: rehearseGiven,
}: {
  taskId: string;
  clientName: string;
  status?: string | null;
  offerSheet?: string | null;
  /** Stand-ins for the harness and the tests. */
  io?: BlueprintIO;
  /** The harness's rehearsal; the page reads ?rehearse=1 for admins and the CEO. */
  rehearse?: boolean;
  /** A record already read (the harness and the tests render it at once). */
  initial?: {
    row: BlueprintRow | null;
    now: string;
    /** The nudge's read, already made. */
    call?: BlueprintCall | null;
    /** The Slack notices, already read. */
    notices?: NoticeRead | null;
  };
}) {
  const auth = useCockpitAuth();
  const rehearse =
    rehearseGiven ??
    ((auth.isAdmin || auth.isCeo) &&
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("rehearse") === "1");
  const io = useMemo(() => {
    const base =
      given ?? (auth.client ? supabaseBlueprintIO(auth.client) : null);
    return base && rehearse ? rehearsalIO(base, clientName) : base;
  }, [given, auth.client, rehearse, clientName]);

  const [read, setRead] = useState<
    | { row: BlueprintRow | null; now: string; at: number }
    | { error: string }
    | undefined
  >(initial ? { ...initial, at: Date.now() } : undefined);

  const reload = useCallback(async () => {
    if (!io) return;
    try {
      const r = await io.read(taskId);
      setRead({ ...r, at: Date.now() });
    } catch (e) {
      setRead({ error: e instanceof Error ? e.message : problem(e) });
    }
  }, [io, taskId]);

  useEffect(() => {
    if (!initial) void reload();
  }, [reload, initial]);

  // "Lock the offer" on the dashboard lands here (#blueprint): once the
  // record is read and the card is drawn, bring it up and put the caret on
  // the first empty offer line.
  const landed = useRef(false);
  const resolved = read !== undefined && !("error" in read);
  useEffect(() => {
    if (!resolved || landed.current || typeof window === "undefined") return;
    if (window.location.hash !== "#blueprint") return;
    const section = document.getElementById("blueprint");
    if (!section) return;
    landed.current = true;
    section.scrollIntoView({ block: "start" });
    const empty = (["name", "what", "firstStep"] as const)
      .map(l => document.getElementById(`bp-offer-${l}`))
      .find(
        (el): el is HTMLInputElement | HTMLTextAreaElement =>
          (el instanceof HTMLInputElement ||
            el instanceof HTMLTextAreaElement) &&
          !el.disabled &&
          el.value.trim() === "",
      );
    empty?.focus({ preventScroll: true });
  });

  const onboarding = IN_ONBOARDING.test(status ?? "");
  if (read === undefined) return onboarding ? <Shell loading /> : null;
  if ("error" in read)
    return (
      <Shell>
        <p className="text-sm">
          The Blueprint record could not be read: {read.error}{" "}
          <button
            type="button"
            onClick={() => void reload()}
            className="text-primary underline-offset-4 hover:underline"
          >
            Read it again
          </button>
        </p>
      </Shell>
    );
  if (!read.row && !onboarding) return null;
  if (!io) return null;
  return (
    <BlueprintBody
      key={taskId}
      taskId={taskId}
      clientName={clientName}
      status={status ?? null}
      offerSheet={offerSheet ?? null}
      row={read.row}
      serverNow={Date.parse(read.now) || Date.now()}
      readAt={read.at}
      io={io}
      rehearse={rehearse}
      canWrite={read.row?.can?.write !== false}
      reload={reload}
      initialCall={initial?.call}
      initialNotices={initial?.notices}
    />
  );
}

function Shell({
  children,
  loading,
  actions,
}: {
  children?: ReactNode;
  loading?: boolean;
  actions?: ReactNode;
}) {
  return (
    <section
      id="blueprint"
      aria-labelledby="blueprint-title"
      className="scroll-mt-20 rounded-2xl border bg-card p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="blueprint-title" className="text-[15px] font-semibold">
          Brand Blueprint
        </h2>
        {actions}
      </div>
      {loading ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Reading the Blueprint…
        </p>
      ) : (
        <div className="mt-3">{children}</div>
      )}
    </section>
  );
}

type Run = {
  running?: boolean;
  error?: string | null;
  notice?: string | null;
};

/** What the call page shows at once, before it reads the record. */
export type CallRouteState = { clientName: string; status: string | null };

/**
 * The card's way into the call (EMBED.md 4.1): the page in this cockpit, at
 * a part when given, a rehearsal kept, and the name and status riding along
 * so the call page draws its header before it reads anything.
 */
export function callLink(
  taskId: string,
  at: "part1" | "part2" | undefined,
  rehearse: boolean,
  clientName: string,
  status: string | null,
): { to: ReturnType<typeof callRoute>; state: CallRouteState } {
  return {
    to: callRoute(taskId, at, rehearse),
    state: { clientName, status },
  };
}

function BlueprintBody({
  taskId,
  clientName,
  status,
  offerSheet,
  row: firstRow,
  serverNow,
  readAt,
  io,
  rehearse,
  canWrite,
  reload,
  initialCall,
  initialNotices,
}: {
  taskId: string;
  clientName: string;
  status: string | null;
  offerSheet: string | null;
  row: BlueprintRow | null;
  serverNow: number;
  readAt: number;
  io: BlueprintIO;
  rehearse: boolean;
  canWrite: boolean;
  reload: () => Promise<void>;
  initialCall?: BlueprintCall | null;
  initialNotices?: NoticeRead | null;
}) {
  const [row, setRow] = useState(firstRow);
  const [tick, setTick] = useState(() => Date.now());
  const now = serverNow + (tick - readAt);
  const [draft, setDraft] = useState(() => draftOf(firstRow));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<
    Record<string, Conflict & { mine: unknown }>
  >({});
  const [runs, setRuns] = useState<Partial<Record<Part, Run>>>({});
  const [plan, setPlan] = useState<{ part: Part; lines: string[] } | null>(
    null,
  );
  const [open, setOpen] = useState(false);
  const session = useMemo(() => io.session(), [io]);

  // The record read again (after a press, or another window's save): take it,
  // and the typed lines too when nothing here is waiting to save.
  const saver = useRef<FieldSaver | null>(null);
  const pendingMine = useRef<Record<string, unknown>>({});
  useEffect(() => {
    setRow(firstRow);
    saver.current?.adopt(firstRow);
    if (!saver.current?.dirty) setDraft(draftOf(firstRow));
  }, [firstRow]);

  // One saver per card and record session; later reads are adopted above.
  // biome-ignore lint/correctness/useExhaustiveDependencies: firstRow seeds it once
  useEffect(() => {
    const s = new FieldSaver(
      {
        save: (changes, baseRevision) =>
          io.save({ taskId, changes, session, baseRevision }),
      },
      firstRow,
      {
        saved: r => {
          if (r.row) setRow(r.row);
          setSaveError(null);
          setSavedAt(new Date().toISOString());
          setConflicts(prev => {
            const next = { ...prev };
            for (const k of r.applied) delete next[k];
            for (const c of r.conflicts)
              next[c.key] = { ...c, mine: pendingMine.current[c.key] };
            return next;
          });
          // The stored value wins the field; what was typed stays under it.
          if (r.conflicts.length)
            setDraft(d => {
              const next = { ...d };
              for (const c of r.conflicts) {
                if (c.key === "offer") next.offer = offerOf(c.theirs);
                else if (c.key === "scripts_status" || c.key === "scripts_date")
                  next[c.key] = typeof c.theirs === "string" ? c.theirs : "";
              }
              return next;
            });
        },
        failed: message => setSaveError(message),
        busy: setSaving,
      },
    );
    saver.current = s;
    return () => s.dispose();
  }, [io, taskId, session]);

  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // The parts are sent from the call's windows (prep, deck, notes), so read
  // the record again when this tab comes back into view, at most every 5 s,
  // never over lines still being saved; and at once when the call's own
  // channel says a part moved (same origin, same client).
  const lastRead = useRef(0);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    if (typeof window === "undefined") return;
    const again = (force = false) => {
      if (saver.current?.dirty) return;
      if (!force && Date.now() - lastRead.current < 5_000) return;
      lastRead.current = Date.now();
      void reloadRef.current();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") again();
    };
    const onFocus = () => again();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    let ch: BroadcastChannel | null = null;
    if (!rehearse && typeof BroadcastChannel !== "undefined") {
      ch = new BroadcastChannel(`mahara-deck:${taskId}:blueprint`);
      ch.onmessage = e => {
        const m = e.data as { type?: unknown; phase?: unknown } | null;
        if (
          m?.type === "bp-part" &&
          (m.phase === "done" ||
            m.phase === "failed" ||
            m.phase === "reconcile" ||
            m.phase === "queued")
        )
          again(true);
      };
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      ch?.close();
    };
  }, [taskId, rehearse]);

  // The nudge (docs/forms/PLAN.md S8): read only before part 2, at the two
  // stages where a held call with no close means something was missed.
  const closedYet = Boolean(stampOf(row, 2));
  const [call, setCall] = useState<BlueprintCall | null | undefined>(
    initialCall,
  );
  const askCall =
    !rehearse &&
    !closedYet &&
    initialCall === undefined &&
    NUDGE_STAGE.test(status ?? "") &&
    Boolean(io.call);
  useEffect(() => {
    if (!askCall || !io.call) return;
    let gone = false;
    io.call(taskId).then(
      c => !gone && setCall(c),
      () => !gone && setCall(null),
    );
    return () => {
      gone = true;
    };
  }, [askCall, io, taskId]);
  const nudge = !closedYet && call?.nudge && call.heldAt ? call.heldAt : null;

  // The close's Slack notices (STAGE1-CONTRACT.md 6.2), once part 2 is in;
  // read again with the record.
  const [notices, setNotices] = useState<
    NoticeRead | { error: string } | null | undefined
  >(initialNotices);
  const readsNotices =
    !rehearse &&
    closedYet &&
    initialNotices === undefined &&
    Boolean(io.notices);
  const lastSettled = [1, 2, 3]
    .map(p => outboxOf(row, p as Part)?.state ?? "")
    .join(",");
  // A part's run settling is when a notice is queued: `lastSettled` reads
  // the notices again then.
  // biome-ignore lint/correctness/useExhaustiveDependencies: lastSettled re-runs the read
  useEffect(() => {
    if (!readsNotices || !io.notices) return;
    let gone = false;
    io.notices(taskId).then(
      r => !gone && setNotices(r),
      e =>
        !gone &&
        setNotices({ error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      gone = true;
    };
  }, [readsNotices, io, taskId, lastSettled]);
  const noticeRead = notices && !("error" in notices) ? notices : null;

  const stored = row?.answers ?? {};
  const answers: Answers = useMemo(
    () => withDraft(stored, draft),
    [stored, draft],
  );
  const states = useMemo(
    () =>
      Object.fromEntries(
        PARTS.map(p => [
          p,
          partState(row, p, p === 3 ? answers : stored, now, runs[p] ?? {}),
        ]),
      ) as Record<Part, PartState>,
    [row, answers, stored, now, runs],
  );
  // Folds once all three are sent, but not under the hand that just sent one.
  const done = blueprintDone(row, answers, now) && !open && !runs[3];
  const wait = offerWait(row, now);
  const sent1 = stampOf(row, 1);
  const sent2 = stampOf(row, 2);
  const sent3 = stampOf(row, 3);

  function queue(key: string, value: unknown) {
    if (!canWrite) return;
    pendingMine.current[key] = value;
    saver.current?.set(key, value);
  }
  function setOffer(line: OfferLine, value: string) {
    const offer = { ...draft.offer, [line]: value };
    setDraft(d => ({ ...d, offer }));
    queue("offer", offerValue(offer));
  }
  function setScripts(key: "scripts_status" | "scripts_date", value: string) {
    setDraft(d => ({ ...d, [key]: value }));
    if (!canWrite) return;
    pendingMine.current[key] = value || null;
    saver.current?.set(key, value || null, true);
  }
  function keepMine(key: string) {
    const c = conflicts[key];
    if (!c) return;
    if (key === "offer") setDraft(d => ({ ...d, offer: offerOf(c.mine) }));
    else if (key === "scripts_status" || key === "scripts_date")
      setDraft(d => ({
        ...d,
        [key]: typeof c.mine === "string" ? c.mine : "",
      }));
    pendingMine.current[key] = c.mine;
    saver.current?.insist(key, c.mine ?? null, c.theirs);
  }
  function keepTheirs(key: string) {
    const c = conflicts[key];
    if (!c) return;
    setConflicts(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    delete pendingMine.current[key];
    saver.current?.accept(key, c.theirs);
  }

  async function press(part: Part) {
    setRuns(r => ({ ...r, [part]: { running: true } }));
    setPlan(null);
    try {
      await saver.current?.flush();
      if (saver.current?.dirty)
        throw new Error(
          "Your last lines are not saved yet, so nothing was sent. Try again.",
        );
      const latest = saver.current?.answers ?? row?.answers ?? {};
      const lacks = missing(part, latest);
      if (lacks.length) throw new Error(missingSentence(lacks));
      if (rehearse) {
        const r = await io.rehearse({ taskId, part, answers: latest });
        setPlan({
          part,
          lines: r.missing.length
            ? [missingSentence(r.missing)]
            : r.lines.length
              ? r.lines
              : ["Nothing would change."],
        });
        setRuns(r2 => ({ ...r2, [part]: {} }));
        return;
      }
      const p = await io.press({ taskId, part, answers: latest });
      let notice: string | null = null;
      if (p.duplicate)
        notice = `Already sent ${whenLong(p.lastAt ?? p.firstAt)}. Nothing has changed since.`;
      if (p.state === "pending") {
        const r = await io.run(p.id);
        if (r.ok) {
          io.forget(p.key);
          notice = r.note;
        } else {
          setRuns(r2 => ({ ...r2, [part]: { error: r.error } }));
          await reload();
          return;
        }
      } else if (p.state === "done") io.forget(p.key);
      setRuns(r2 => ({ ...r2, [part]: { notice } }));
      await reload();
    } catch (e) {
      const message = e instanceof Error ? e.message : problem(e);
      setRuns(r => ({ ...r, [part]: { error: message } }));
      await reload();
    }
  }

  async function runAgain(part: Part, id: string) {
    setRuns(r => ({ ...r, [part]: { running: true } }));
    const r = await io.run(id);
    setRuns(r2 => ({
      ...r2,
      [part]: r.ok ? { notice: r.note } : { error: r.error },
    }));
    await reload();
  }

  // The call opens here, in this tab (EMBED.md 4.1): links, so Cmd-click
  // still gives a tab of its own.
  const nextIsCall = !sent1;
  const link = (at?: "part1" | "part2") =>
    callLink(taskId, at, rehearse, clientName, status);
  const callButton = (
    <Button size="sm" variant={nextIsCall ? "default" : "outline"} asChild>
      <Link {...link()} title="Opens the call here: prepare it, then Present">
        <Presentation />
        Run the Blueprint call
      </Link>
    </Button>
  );

  if (done)
    return (
      <section
        id="blueprint"
        aria-label="Brand Blueprint"
        className="scroll-mt-20 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-2xl border bg-card px-4 py-3 text-sm sm:px-6"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Dot tone="good" />
          <span className="font-semibold">Brand Blueprint:</span>
          <span className="text-muted-foreground">
            done {dayShort(sent3?.lastAt)}
          </span>
        </span>
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          Open
        </Button>
      </section>
    );

  const offer3 = states[3];
  // A press the server refused three times, or that ran out of time, is
  // pressed again; a press stopped part way needs a person first.
  const again3 = outboxOf(row, 3)?.state === "failed";
  const lockBlocked = !sent2
    ? "Close the call first: part 2 is still open."
    : !canWrite
      ? "Only the creative director locks the offer."
      : offer3.kind === "needs_look" && !again3
        ? `Needs a look first: ask an admin to reconcile request ${offer3.id.slice(0, 8)}.`
        : conflicts.offer || conflicts.scripts_status || conflicts.scripts_date
          ? "Pick yours or theirs first."
          : missing(3, answers).length
            ? "Write the offer's three lines first."
            : null;
  // Part 3 opens under its row once the call is closed, or read only when
  // the call drafted it; before that it is one quiet line.
  const drafted = Object.keys(offerOf(row?.answers?.offer)).length > 0;
  const lockable =
    !lockBlocked &&
    (offer3.kind === "ready" ||
      offer3.kind === "in_progress" ||
      offer3.kind === "changed" ||
      offer3.kind === "not_started" ||
      (offer3.kind === "needs_look" && again3));

  return (
    <Shell
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {open ? (
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Fold
            </Button>
          ) : null}
          {callButton}
        </div>
      }
    >
      {rehearse ? (
        <p className="callout-warn mb-3 rounded-lg border px-3 py-2 text-xs">
          Rehearsal: nothing is saved or sent. Each press shows its plan.
        </p>
      ) : null}
      {!canWrite ? (
        <p className="mb-3 text-xs text-muted-foreground">
          Only the creative director sends the parts.
        </p>
      ) : null}
      {nudge ? (
        <p
          role="note"
          className="callout-warn mb-3 flex gap-2 rounded-lg border px-3 py-2 text-sm"
        >
          <span className="mt-[7px] flex">
            <Dot tone="warn" />
          </span>
          <span className="min-w-0">
            Blueprint call held {dayWeek(nudge)}. No Blueprint record yet.{" "}
            <Link
              {...link()}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Open the call page.
            </Link>
          </span>
        </p>
      ) : null}

      <ol className="divide-y divide-border/70 rounded-xl bg-muted/30">
        {PARTS.map(p => (
          <PartRow
            key={p}
            part={p}
            state={states[p]}
            row={row}
            wait={p === 3 ? wait : null}
            run={runs[p]}
            canWrite={canWrite && !rehearse}
            onRunAgain={id => void runAgain(p, id)}
            onSend={() => void press(p)}
            notices={
              p === 2 && sent2 ? (
                <CloseStops read={notices} />
              ) : p === 3 && sent3 && noticeRead ? (
                <OfferStop n={noticeOf(noticeRead, "blueprint.offer")} />
              ) : null
            }
            action={
              p === 1 && states[1].kind === "ready" ? (
                <Button size="sm" variant="outline" asChild>
                  <Link {...link("part1")}>Open part 1</Link>
                </Button>
              ) : p === 2 &&
                sent1 &&
                !sent2 &&
                // A refused part 1 is pressed again first.
                outboxOf(row, 1)?.state !== "failed" &&
                now - Date.parse(sent1.firstAt) > CLOSED_AFTER_MS ? (
                <Button size="sm" variant="outline" asChild>
                  <Link {...link("part2")}>Finish part 2</Link>
                </Button>
              ) : p === 3 ? (
                offerSheet ? (
                  <a
                    href={offerSheet}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Open the offer sheet
                    <ArrowUpRight aria-hidden className="size-3.5" />
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    No offer sheet on the card
                  </span>
                )
              ) : null
            }
            detail={
              p === 3 && !sent2 && drafted ? (
                <DraftedOffer offer={offerOf(row?.answers?.offer)} />
              ) : p === 3 && sent2 ? (
                <OfferSlip
                  offer={draft.offer}
                  scriptsStatus={draft.scripts_status}
                  scriptsDate={draft.scripts_date}
                  disabled={!canWrite}
                  conflicts={conflicts}
                  onOffer={setOffer}
                  onScripts={setScripts}
                  onUseMine={keepMine}
                  onKeepTheirs={keepTheirs}
                  footer={
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <SaveLine
                        saving={saving}
                        error={saveError}
                        savedAt={savedAt}
                        rehearse={rehearse}
                        onRetry={() => void saver.current?.flush()}
                      />
                      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                        {lockBlocked ? (
                          <span className="text-xs text-muted-foreground">
                            {lockBlocked}
                          </span>
                        ) : null}
                        {offer3.kind === "sent" ? null : (
                          <Button
                            size="sm"
                            variant={
                              lockable && !rehearse ? "default" : "outline"
                            }
                            disabled={!lockable || runs[3]?.running}
                            onClick={() => void press(3)}
                          >
                            {rehearse
                              ? runs[3]?.running
                                ? "Reading the plan…"
                                : "Show the Lock plan"
                              : offer3.kind === "changed"
                                ? "Send the changes"
                                : runs[3]?.running
                                  ? "Locking…"
                                  : "Lock the offer"}
                          </Button>
                        )}
                      </div>
                    </div>
                  }
                />
              ) : null
            }
          />
        ))}
      </ol>

      {plan ? (
        <div className="mt-3 rounded-xl border border-dashed px-4 py-3">
          <p className="text-xs font-medium">
            Rehearsal: what {pressName(plan.part)} would do
          </p>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {plan.lines.map(l => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Shell>
  );
}

const pressName = (p: Part) =>
  p === 1 ? "Send to media" : p === 2 ? "Close the call" : "Lock the offer";

type Draft = { offer: Offer; scripts_status: string; scripts_date: string };

function draftOf(row: BlueprintRow | null): Draft {
  const a = row?.answers ?? {};
  return {
    offer: offerOf(a.offer),
    scripts_status:
      typeof a.scripts_status === "string" ? a.scripts_status : "",
    scripts_date: typeof a.scripts_date === "string" ? a.scripts_date : "",
  };
}

function offerValue(o: Offer): Offer | null {
  const out: Offer = {};
  for (const k of ["name", "what", "firstStep"] as const)
    if (typeof o[k] === "string" && o[k]?.trim()) out[k] = o[k];
  return Object.keys(out).length ? out : null;
}

function withDraft(stored: Answers, d: Draft): Answers {
  const a: Answers = { ...stored };
  const o = offerValue(d.offer);
  if (o) a.offer = offerOf(o);
  else delete a.offer;
  if (d.scripts_status) a.scripts_status = d.scripts_status;
  else delete a.scripts_status;
  if (d.scripts_date) a.scripts_date = d.scripts_date;
  else delete a.scripts_date;
  return a;
}

export type Tone = "good" | "warn" | "bad" | "live" | "quiet";
const DOT: Record<Tone, string> = {
  good: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
  live: "bg-primary",
  quiet: "bg-muted-foreground/50",
};
/** The part's dot; the call page's parts rail draws the same one. */
export function Dot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-1.5 shrink-0 self-center rounded-full",
        DOT[tone],
        pulse && "motion-safe:animate-pulse",
      )}
    />
  );
}

function PartRow({
  part,
  state,
  row,
  wait,
  run,
  canWrite,
  onRunAgain,
  onSend,
  action,
  detail,
  notices,
}: {
  part: Part;
  state: PartState;
  row: BlueprintRow | null;
  wait: { since: string; hours: number; late: boolean } | null;
  run?: Run;
  canWrite: boolean;
  onRunAgain: (id: string) => void;
  onSend: () => void;
  action?: ReactNode;
  detail?: ReactNode;
  /** The part's Slack notices: the close's two posts, the offer's reply. */
  notices?: ReactNode;
}) {
  const view = stateView(part, state, row, wait);
  const box = outboxOf(row, part);
  // The server drain refused this press and tries it again (20261025o).
  const retrying =
    box?.state === "pending" && (box.attempts ?? 0) > 0 && box.error
      ? `This press was refused: ${clause(box.error)}. The cockpit tries again in 2 minutes (${box.attempts} of 3).`
      : null;
  return (
    <li className="px-3 py-3 sm:px-4" data-part={part} data-state={state.kind}>
      <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 sm:grid-cols-[1.5rem_9.5rem_minmax(0,1fr)_auto] sm:items-center">
        <span className="font-mono text-xs leading-5 text-muted-foreground">
          {part}
        </span>
        <span className="text-sm font-medium">{PART_NAME[part]}</span>
        <span className="col-start-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm sm:col-start-3">
          <span className="inline-flex min-w-0 items-baseline gap-2">
            <Dot tone={view.tone} pulse={state.kind === "sending"} />
            <span className={cn("min-w-0", view.toneText)}>{view.text}</span>
          </span>
          {view.extra}
        </span>
        <span className="col-start-2 mt-1.5 flex flex-wrap items-center gap-2 sm:col-start-4 sm:mt-0 sm:justify-end">
          {state.kind === "unconfirmed" && canWrite ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRunAgain(state.id)}
            >
              <RotateCw />
              Run it again
            </Button>
          ) : null}
          {state.kind === "changed" && canWrite && part !== 3 ? (
            <Button size="sm" variant="outline" onClick={onSend}>
              Send the changes
            </Button>
          ) : null}
          {action}
        </span>
      </div>
      {state.kind === "changed" ? (
        <p className="mt-1 pl-8 text-xs text-muted-foreground">
          Changed: {state.keys.map(k => KEY_LABEL[k] ?? k).join(", ")}.
        </p>
      ) : retrying ? (
        <p role="status" className="mt-1 pl-8 text-xs txt-warn">
          {retrying}
        </p>
      ) : state.kind === "unconfirmed" ? (
        <p className="mt-1 pl-8 text-xs text-muted-foreground">
          The press is saved, but ClickUp did not confirm it. Run it again: it
          reuses the same request, so nothing is made twice.
        </p>
      ) : null}
      {notices ? (
        // Under the part's state words, where the grid puts them.
        <div className="mt-1.5 pl-8 sm:pl-48">{notices}</div>
      ) : null}
      {run?.error &&
      state.kind !== "needs_look" &&
      state.kind !== "unconfirmed" ? (
        <p role="alert" className="mt-1 pl-8 text-xs txt-bad">
          {run.error}
        </p>
      ) : run?.notice ? (
        <p role="status" className="mt-1 pl-8 text-xs text-muted-foreground">
          {run.notice}
        </p>
      ) : null}
      {detail ? <div className="mt-3 sm:pl-8">{detail}</div> : null}
    </li>
  );
}

/** A part's words and tone, for the card's rows and the call page's rail. */
export function stateView(
  part: Part,
  s: PartState,
  row: BlueprintRow | null,
  wait: { since: string; hours: number; late: boolean } | null,
): { tone: Tone; text: string; toneText?: string; extra?: ReactNode } {
  switch (s.kind) {
    case "sent": {
      if (part === 1) {
        const launch = launchTaskOf(row);
        return {
          tone: "good",
          text: `Sent ${whenLong(s.at)}`,
          extra: launch ? (
            <a
              href={clickupTask(launch)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 whitespace-nowrap text-primary underline-offset-4 hover:underline"
            >
              Launch task
              <ArrowUpRight aria-hidden className="size-3.5" />
            </a>
          ) : null,
        };
      }
      const before = stampOf(row, (part - 1) as Part)?.lastAt;
      return {
        tone: "good",
        text: `${part === 2 ? "Call closed" : "Offer locked"} ${whenNear(s.at, before)}`,
      };
    }
    case "sending":
      return { tone: "live", text: "Sending…" };
    case "unconfirmed":
      return {
        tone: "warn",
        text: "Saved, not confirmed",
        toneText: "txt-warn",
        extra: s.error ? (
          <span className="text-xs text-muted-foreground">{s.error}</span>
        ) : null,
      };
    case "needs_look": {
      const o = outboxOf(row, part);
      // The drain's ends (20261025o): three refusals, or 30 minutes.
      if (o?.state === "failed" && (o.attempts ?? 0) >= 3)
        return {
          tone: "bad",
          text: `This press was refused: ${clause(s.error)}. Fix it and press again.`,
          toneText: "txt-bad",
          extra: <CopyId id={s.id} />,
        };
      if (o?.state === "failed" && /within 30 minutes/i.test(s.error))
        return {
          tone: "bad",
          text: s.error,
          toneText: "txt-bad",
          extra: <CopyId id={s.id} />,
        };
      return {
        tone: "bad",
        text: `Needs a look: ${s.error}`,
        toneText: "txt-bad",
        extra: <CopyId id={s.id} />,
      };
    }
    case "changed":
      return { tone: "warn", text: "Changed since sent" };
    case "ready":
      return {
        tone: "live",
        text:
          part === 3
            ? wait
              ? `Ready to lock · waiting ${waited(wait.hours)}`
              : "Ready to lock"
            : part === 1
              ? "Ready: Send to media on the call"
              : "Ready: Close the call",
        toneText: part === 3 && wait?.late ? "txt-warn" : undefined,
      };
    case "in_progress":
    case "not_started": {
      const count =
        s.kind === "in_progress"
          ? part === 3
            ? `${s.done} of 3 lines`
            : `${s.done} of ${s.of}`
          : null;
      if (part === 3 && wait)
        return {
          tone: wait.late ? "warn" : "quiet",
          toneText: wait.late ? "txt-warn" : undefined,
          text: `Waiting · ${waited(wait.hours)}${count ? ` · ${count}` : ""}`,
        };
      if (part === 3 && !stampOf(row, 2))
        return {
          tone: "quiet",
          text: count ? `Drafted · ${count}` : "Opens when the call closes",
          toneText: "text-muted-foreground",
        };
      return count
        ? { tone: "quiet", text: `In progress · ${count}` }
        : {
            tone: "quiet",
            text:
              part === 1
                ? "Not started · confirm it in the prep before the call"
                : "Not started",
            toneText: "text-muted-foreground",
          };
    }
  }
}

/** A reason inside a sentence: its own last full stop goes. */
const clause = (t: string) => t.trim().replace(/\.\s*$/, "");

/** "Tell the tech lead.", unless the reason already says who to tell. */
const tell = (reason: string) =>
  /tech lead/i.test(reason) ? "" : " Tell the tech lead.";

/** "at 14:03" on the read's Kuwait day, else "on Sun 25 Oct 14:03". */
const noticeTime = (n: NoticeView, now: string) => {
  const w = whenNear(n.at, now);
  return /^\d\d:\d\d$/.test(w) ? `at ${w}` : `on ${w}`;
};
const place = (n: NoticeView) =>
  n.channel?.name ? `#${n.channel.name}` : (n.channel?.id ?? "Slack");

/**
 * One notice as a stop (STAGE1-CONTRACT.md 6.2): "Posted in #csm-general at
 * 14:03", or "Not posted in #media-general: … Tell the tech lead.", or what
 * it waits for.
 */
function NoticeStop({
  n,
  now,
  reply,
  fallback,
}: {
  n: NoticeView | null;
  now: string;
  reply?: boolean;
  /** Said when there is no notice of this kind. */
  fallback: string;
}) {
  if (!n)
    return (
      <span className="flex items-baseline gap-2 text-xs text-muted-foreground">
        <Dot tone="quiet" />
        {fallback}
      </span>
    );
  const where = place(n);
  const reason = clause(n.reason ?? "") || "no reason was given";
  const [tone, text]: [Tone, string] =
    n.state === "posted"
      ? [
          "good",
          `${reply ? "Reply posted" : "Posted"} in ${where} ${noticeTime(n, now)}`,
        ]
      : n.state === "failed"
        ? ["warn", `Not posted in ${where}: ${reason}.${tell(reason)}`]
        : n.state === "unknown"
          ? ["warn", `Not confirmed in ${where}: ${reason}.${tell(reason)}`]
          : n.state === "muted"
            ? ["quiet", "Not posted: it is off in the client success Settings."]
            : n.state === "skipped"
              ? ["quiet", `Not posted: ${reason}.`]
              : n.state === "sending"
                ? ["live", `Posting in ${where} now.`]
                : ["live", `Waiting to post in ${where}.`];
  return (
    <span
      className={cn(
        "flex gap-2 text-xs",
        tone === "warn" ? "txt-warn" : "text-muted-foreground",
      )}
    >
      <span className="mt-[5px] flex">
        <Dot tone={tone} />
      </span>
      <span className="min-w-0">
        {text}
        {n.state === "posted" && n.permalink ? (
          <>
            {" "}
            <a
              href={n.permalink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 whitespace-nowrap text-primary underline-offset-4 hover:underline"
            >
              Open in Slack
              <ArrowUpRight aria-hidden className="size-3.5" />
            </a>
          </>
        ) : null}
      </span>
    </span>
  );
}

/** Part 2's two posts: #csm-general and #media-general. */
function CloseStops({
  read,
}: {
  read: NoticeRead | { error: string } | null | undefined;
}) {
  if (read === undefined) return null;
  if (read === null || "error" in read)
    return (
      <span className="flex items-baseline gap-2 text-xs text-muted-foreground">
        <Dot tone="quiet" />
        The cockpit could not read the Slack notices just now.
      </span>
    );
  return (
    <span className="flex flex-col gap-0.5">
      <NoticeStop
        n={noticeOf(read, "blueprint.close")}
        now={read.now}
        fallback="No #csm-general notice is on record for this close."
      />
      <NoticeStop
        n={noticeOf(read, "blueprint.media")}
        now={read.now}
        fallback="No #media-general notice is on record for this close."
      />
    </span>
  );
}

/** Part 3's reply under the close. */
function OfferStop({ n }: { n: NoticeView | null }) {
  if (!n) return null;
  return <NoticeStop n={n} now={n.at} reply fallback="" />;
}

function CopyId({ id }: { id: string }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      title="Copy the outbox request ID for whoever reconciles it"
      onClick={() => {
        navigator.clipboard.writeText(id).then(
          () => toast.success("Request ID copied"),
          () => toast.error("The copy did not work."),
        );
      }}
    >
      <Copy aria-hidden className="size-3" />
      Request {id.slice(0, 8)}
    </button>
  );
}

const SCRIPTS = [
  { key: "in_progress", label: "In progress" },
  { key: "with_editors", label: "With the editors" },
] as const;

/**
 * The offer slip: the three lines the client watched being typed on the
 * call, on ruled lines with a teal caret, and the custom scripts' status.
 */
function OfferSlip({
  offer,
  scriptsStatus,
  scriptsDate,
  disabled,
  conflicts,
  onOffer,
  onScripts,
  onUseMine,
  onKeepTheirs,
  footer,
}: {
  offer: Offer;
  scriptsStatus: string;
  scriptsDate: string;
  disabled: boolean;
  conflicts: Record<string, Conflict & { mine: unknown }>;
  onOffer: (line: OfferLine, value: string) => void;
  onScripts: (key: "scripts_status" | "scripts_date", value: string) => void;
  onUseMine: (key: string) => void;
  onKeepTheirs: (key: string) => void;
  footer: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1" role="group" aria-label="Your offer">
        {(["name", "what", "firstStep"] as const).map(line => {
          const value = offer[line] ?? "";
          const id = `bp-offer-${line}`;
          const near = value.length > OFFER_MAX[line] * 0.85;
          return (
            <div
              key={line}
              className="grid gap-x-4 sm:grid-cols-[10.5rem_minmax(0,1fr)] sm:items-end"
            >
              <label
                htmlFor={id}
                className="pt-2 text-xs text-muted-foreground sm:pb-2.5"
              >
                {OFFER_LABEL[line]}
              </label>
              <div className="relative">
                {/* One line that grows: the whole offer stays readable, on a
                    phone too. Enter moves to the next line, never a newline. */}
                <textarea
                  id={id}
                  dir="auto"
                  rows={1}
                  value={value}
                  maxLength={OFFER_MAX[line]}
                  disabled={disabled}
                  onChange={e =>
                    onOffer(line, e.target.value.replace(/[\r\n]+/g, " "))
                  }
                  onKeyDown={e => {
                    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                    e.preventDefault();
                    const next =
                      line === "name"
                        ? "bp-offer-what"
                        : line === "what"
                          ? "bp-offer-firstStep"
                          : null;
                    if (next) document.getElementById(next)?.focus();
                  }}
                  placeholder={
                    line === "firstStep" ? "What it is, and who gives it" : ""
                  }
                  className={cn(
                    "block w-full resize-none overflow-hidden border-0 border-b border-border bg-transparent px-0 pt-2 pb-1.5 text-[17px] leading-7 caret-primary outline-none transition-[border-color,box-shadow] [field-sizing:content] placeholder:text-muted-foreground/60",
                    "focus-visible:border-primary focus-visible:shadow-[0_1px_0_0_var(--primary)] disabled:opacity-60",
                    line === "name" && "font-semibold",
                  )}
                />
                {near ? (
                  <span className="absolute right-0 bottom-2 font-mono text-[11px] text-muted-foreground">
                    {OFFER_MAX[line] - value.length}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
        {conflicts.offer ? (
          <ConflictLine
            c={conflicts.offer}
            mine={offerDiff(conflicts.offer.mine, conflicts.offer.theirs)}
            onUseMine={() => onUseMine("offer")}
            onKeepTheirs={() => onKeepTheirs("offer")}
          />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-xs text-muted-foreground">Custom scripts</span>
        <div
          role="group"
          aria-label="Custom scripts"
          className="inline-flex rounded-[0.65rem] border p-0.5"
        >
          {SCRIPTS.map(s => (
            <button
              key={s.key}
              type="button"
              disabled={disabled}
              aria-pressed={scriptsStatus === s.key}
              onClick={() =>
                onScripts(
                  "scripts_status",
                  scriptsStatus === s.key ? "" : s.key,
                )
              }
              className={cn(
                "h-8 whitespace-nowrap rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                scriptsStatus === s.key
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <DateInput
          value={scriptsDate}
          disabled={disabled}
          aria-label="When the custom scripts are due"
          placeholder="Due date"
          onChange={e => onScripts("scripts_date", e.target.value)}
          className="is-compact h-8 text-xs"
        />
      </div>
      {(["scripts_status", "scripts_date"] as const).map(k =>
        conflicts[k] ? (
          <ConflictLine
            key={k}
            c={conflicts[k]}
            mine={[
              `${k === "scripts_status" ? "The scripts' status" : "The scripts' date"}: yours was “${tidy(String(conflicts[k].mine ?? "")) || "blank"}”`,
            ]}
            onUseMine={() => onUseMine(k)}
            onKeepTheirs={() => onKeepTheirs(k)}
          />
        ) : null,
      )}
      <div className="border-t pt-3">{footer}</div>
    </div>
  );
}

/** Only the offer lines that differ: "The free first step: yours was '…'". */
function offerDiff(mine: unknown, theirs: unknown): string[] {
  const m = offerOf(mine);
  const t = offerOf(theirs);
  const lines = (["name", "what", "firstStep"] as const)
    .filter(k => (m[k] ?? "") !== (t[k] ?? ""))
    .map(k => `${OFFER_LABEL[k]}: yours was “${m[k] ?? "blank"}”`);
  return lines.length ? lines : ["Yours was the same as theirs"];
}

function ConflictLine({
  c,
  mine,
  onUseMine,
  onKeepTheirs,
}: {
  c: Conflict;
  mine: string[];
  onUseMine: () => void;
  onKeepTheirs: () => void;
}) {
  return (
    <div
      role="alert"
      className="callout-warn mt-2 rounded-lg border px-3 py-2 text-xs"
    >
      <p>
        Changed in another window
        {c.by ? ` by ${c.by}` : ""}
        {c.at ? ` at ${whenNear(c.at, new Date().toISOString())}` : ""}.
      </p>
      <ul className="mt-1 space-y-0.5">
        {mine.map(l => (
          <li key={l}>
            <bdi>{l}</bdi>.
          </li>
        ))}
      </ul>
      <p className="mt-1.5 flex flex-wrap gap-x-4">
        <button
          type="button"
          onClick={onUseMine}
          className="font-medium underline underline-offset-4"
        >
          Use mine
        </button>
        <button
          type="button"
          onClick={onKeepTheirs}
          className="font-medium underline underline-offset-4"
        >
          Keep theirs
        </button>
      </p>
    </div>
  );
}

/** Part 3 before the call closes: the call's draft, read only. */
function DraftedOffer({ offer }: { offer: Offer }) {
  return (
    <div className="space-y-1 text-sm">
      <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground">
        Drafted on the call
      </p>
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[10.5rem_minmax(0,1fr)]">
        {(["name", "what", "firstStep"] as const).map(l =>
          offer[l] ? (
            <div key={l} className="contents">
              <dt className="text-xs text-muted-foreground">
                {OFFER_LABEL[l]}
              </dt>
              <dd className={cn("min-w-0", l === "name" && "font-medium")}>
                <bdi>{offer[l]}</bdi>
              </dd>
            </div>
          ) : null,
        )}
      </dl>
    </div>
  );
}

function SaveLine({
  saving,
  error,
  savedAt,
  rehearse,
  onRetry,
}: {
  saving: boolean;
  error: string | null;
  savedAt: string | null;
  rehearse: boolean;
  onRetry: () => void;
}) {
  if (error)
    return (
      <p role="alert" className="text-xs txt-bad">
        Not saved: {error}{" "}
        <button
          type="button"
          onClick={onRetry}
          className="font-medium underline underline-offset-4"
        >
          Try again
        </button>
      </p>
    );
  return (
    <p className="text-xs text-muted-foreground" aria-live="polite">
      {saving
        ? "Saving…"
        : savedAt
          ? `${rehearse ? "Kept in this page" : "Saved"} ${whenNear(savedAt, savedAt)}`
          : "Saves as you type"}
    </p>
  );
}
