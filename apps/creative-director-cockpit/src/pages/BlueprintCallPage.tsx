import { ArrowLeft, NotebookPen, RotateCw, WifiOff } from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useParams } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import {
  type BlueprintIO,
  type CallRouteState,
  Dot,
  stateView,
  supabaseBlueprintIO,
  type Tone,
} from "@/components/BlueprintCard";
import { DeckFrame, type FrameTrouble } from "@/components/DeckFrame";
import { Button } from "@/components/ui/button";
import {
  type BlueprintRow,
  offerWait,
  openNamed,
  PART_NAME,
  PARTS,
  type Part,
  type PartState,
  partState,
  problem,
  stampOf,
  waited,
} from "@/lib/blueprint";
import {
  blueprintCall,
  blueprintFrame,
  blueprintPathOf,
  type FrameMessage,
  isTaskId,
  NOTES_FEATURES,
  notesWindowName,
  type PartAnchor,
  PRACTICE_CALL,
  PRACTICE_NAME,
  PRACTICE_TASK,
  practiceFrame,
  practicePathOf,
} from "@/lib/deckHost";
import { cn } from "@/lib/utils";

/**
 * The Brand Blueprint call inside the creative director cockpit
 * (docs/brand-blueprint/EMBED.md 4.2 to 4.6), at /creative/blueprint/:taskId.
 * The cockpit's header (back to the client, the three parts, the notes
 * window) over the prep, which the client success app's deck draws in a
 * frame on this origin. Present lays the shared deck over the whole tab:
 * the creative director shares this tab, and the client sees only the
 * deck. Nothing here reads or writes the record but the rail's read; the
 * deck in the frame saves and presses through the seat's own client, as it
 * does in its own window.
 */

// ------------------------------------------------------------ the call's state

export type Stage =
  | { kind: "opening" }
  | { kind: "slow" }
  | { kind: "failed"; message: string }
  | { kind: "offline" }
  | { kind: "signedout" }
  | { kind: "ready" };

/** The presenting layer: its deck frame's key and how far it got. */
export type Layer = {
  kind: "opening" | "live" | "ended" | "failed";
  key: number;
};

export interface Call {
  stage: Stage;
  /** Bumped by Reload: a fresh prep frame. */
  prepKey: number;
  layer: Layer | null;
  /** Deck frames made so far, so Present again is always a fresh one. */
  decks: number;
  /** The client's name from the frame, when nothing else gave it. */
  name: string | null;
  /** Bumped when the deck should take the keyboard. */
  focus: number;
}

export type CallEvent =
  | { type: "message"; from: "prep" | "deck"; m: FrameMessage }
  | { type: "trouble"; from: "prep" | "deck"; t: FrameTrouble }
  | { type: "reload" }
  | { type: "back-to-prep" }
  | { type: "present-again" };

export const startCall: Call = {
  stage: { kind: "opening" },
  prepKey: 0,
  layer: null,
  decks: 0,
  name: null,
  focus: 0,
};

const LEFT =
  "The Blueprint opened another page, so it is hidden here. Reload it.";

function present(s: Call): Call {
  return {
    ...s,
    layer: { kind: "opening", key: s.decks + 1 },
    decks: s.decks + 1,
  };
}

export function callReducer(s: Call, e: CallEvent): Call {
  switch (e.type) {
    case "reload":
      return {
        ...s,
        stage: { kind: "opening" },
        prepKey: s.prepKey + 1,
        layer: null,
      };
    case "back-to-prep":
      return { ...s, layer: null };
    case "present-again":
      return present(s);
    case "message":
      return e.from === "prep" ? fromPrep(s, e.m) : fromDeck(s, e.m);
    case "trouble":
      return e.from === "prep" ? prepTrouble(s, e.t) : deckTrouble(s, e.t);
  }
}

function fromPrep(s: Call, m: FrameMessage): Call {
  switch (m.type) {
    case "ready":
      return { ...s, stage: { kind: "ready" }, name: m.name || s.name };
    case "failed":
      return { ...s, stage: { kind: "failed", message: m.message } };
    case "signed-out":
      return { ...s, stage: { kind: "signedout" }, layer: null };
    case "present":
      return s.stage.kind === "ready" && !s.layer ? present(s) : s;
    case "end":
      return s;
  }
}

function fromDeck(s: Call, m: FrameMessage): Call {
  if (!s.layer) return s;
  switch (m.type) {
    case "ready":
      return s.layer.kind === "opening"
        ? {
            ...s,
            layer: { ...s.layer, kind: "live" },
            focus: s.focus + 1,
            name: s.name ?? (m.name || null),
          }
        : s;
    case "end":
      return { ...s, layer: { ...s.layer, kind: "ended" } };
    case "failed":
    case "signed-out":
      return { ...s, layer: { ...s.layer, kind: "failed" } };
    default:
      return s;
  }
}

function prepTrouble(s: Call, t: FrameTrouble): Call {
  switch (t) {
    case "slow":
      return s.stage.kind === "opening" ? { ...s, stage: { kind: "slow" } } : s;
    case "offline":
      return s.stage.kind === "ready"
        ? s
        : { ...s, stage: { kind: "offline" } };
    case "online":
      return s.stage.kind === "offline"
        ? { ...s, stage: { kind: "opening" } }
        : s;
    case "left":
      return { ...s, stage: { kind: "failed", message: LEFT }, layer: null };
  }
}

function deckTrouble(s: Call, t: FrameTrouble): Call {
  if (!s.layer || t === "online") return s;
  if (t === "slow" && s.layer.kind !== "opening") return s;
  return { ...s, layer: { ...s.layer, kind: "failed" } };
}

// ------------------------------------------------------------- the addresses

/** Where the frames point: the portal's own deck routes, or the harness's. */
export interface CallFrames {
  prep: (at: PartAnchor | null) => string | null;
  deck: () => string | null;
  /** The notes popup, at a /creative address. */
  notes: string | null;
  /** A frame's own path that may show (anything else is hidden). */
  allowed: (pathname: string) => boolean;
}

export function portalFrames(taskId: string, rehearse: boolean): CallFrames {
  const notes = blueprintCall(taskId, rehearse)?.notes ?? null;
  return {
    prep: at => blueprintFrame(taskId, { view: "prep", rehearse, notes, at }),
    deck: () => blueprintFrame(taskId, { view: "present", rehearse, notes }),
    notes,
    allowed: p => {
      const m = blueprintPathOf(p);
      return m?.taskId === taskId && m.view === "deck";
    },
  };
}

/** A direct Vercel address is another origin: another sign-in, no frame. */
export const wrongHost = (host: string) => /\.vercel\.app$/i.test(host);

const PORTAL = "https://cockpit.maharamedia.com";

// ----------------------------------------------------------------- the record

type Read =
  | { row: BlueprintRow | null; now: string; at: number }
  | { error: string }
  | undefined;

/**
 * What a message on the call's channel asks of the rail: a part moved, so
 * read the record at once; or an answer was saved, so read it soon.
 */
export function readsAgain(data: unknown): "now" | "soon" | null {
  const m = data as { type?: unknown; phase?: unknown } | null;
  if (m?.type === "bp-saved") return "soon";
  if (
    m?.type === "bp-part" &&
    (m.phase === "done" ||
      m.phase === "failed" ||
      m.phase === "reconcile" ||
      m.phase === "queued")
  )
    return "now";
  return null;
}

/**
 * The record, as the card reads it: on mount, when the tab comes back into
 * view (5 s at most), at once when the call's channel says a part moved,
 * and within 2 s of a save. A rehearsal's channel is never listened to.
 */
function useRecord(
  taskId: string,
  io: Pick<BlueprintIO, "read"> | null,
  rehearse: boolean,
  initial?: Read,
) {
  const [read, setRead] = useState<Read>(initial);
  const reload = useCallback(async () => {
    if (!io || !isTaskId(taskId)) return;
    try {
      const r = await io.read(taskId);
      setRead({ ...r, at: Date.now() });
    } catch (e) {
      setRead({ error: e instanceof Error ? e.message : problem(e) });
    }
  }, [io, taskId]);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    if (initial === undefined) void reload();
  }, [reload, initial]);

  useEffect(() => {
    if (typeof window === "undefined" || !isTaskId(taskId)) return;
    let last = 0;
    let soon = 0;
    const again = (force = false) => {
      if (!force && Date.now() - last < 5_000) return;
      last = Date.now();
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
        const when = readsAgain(e.data);
        if (when === "now") again(true);
        else if (when === "soon" && !soon)
          soon = window.setTimeout(() => {
            soon = 0;
            again(true);
          }, 2_000);
      };
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.clearTimeout(soon);
      ch?.close();
    };
  }, [taskId, rehearse]);

  return { read, reload };
}

/**
 * What the rail says of a part: only what the record holds and the prep
 * cannot see, so the prep's own "The parts" panel keeps the progress
 * (EMBED.md 11.1). A part sent, sending, changed or needing a look reads in
 * the card's own words; one not sent yet says only that.
 */
export function railView(
  part: Part,
  st: PartState,
  row: BlueprintRow | null,
  wait: { since: string; hours: number; late: boolean } | null,
): { tone: Tone; text: string; toneText?: string } {
  switch (st.kind) {
    case "sent":
    case "sending":
    case "unconfirmed":
    case "needs_look":
    case "changed": {
      const v = stateView(part, st, row, wait);
      return { tone: v.tone, text: v.text, toneText: v.toneText };
    }
    default: {
      const quiet = "text-muted-foreground";
      if (part === 1)
        return { tone: "quiet", text: "Not sent yet", toneText: quiet };
      if (part === 2)
        return { tone: "quiet", text: "Call not closed yet", toneText: quiet };
      if (!stampOf(row, 2))
        return {
          tone: "quiet",
          text: "Opens when the call closes",
          toneText: quiet,
        };
      return wait
        ? {
            tone: wait.late ? "warn" : "quiet",
            text: `Not locked yet · waiting ${waited(wait.hours)}`,
            toneText: wait.late ? "txt-warn" : quiet,
          }
        : { tone: "quiet", text: "Not locked yet", toneText: quiet };
    }
  }
}

/** The card's three rows folded into one line: where each part was sent. */
export function PartsRail({
  read,
  onRetry,
  now: nowGiven,
}: {
  read: Read;
  onRetry: () => void;
  now?: number;
}) {
  if (read === undefined)
    return (
      <p className="text-[13px] text-muted-foreground">
        Reading the Blueprint…
      </p>
    );
  if ("error" in read)
    return (
      <p className="text-[13px]">
        The Blueprint record could not be read: {read.error}{" "}
        <button
          type="button"
          onClick={onRetry}
          className="text-primary underline-offset-4 hover:underline"
        >
          Read it again
        </button>
      </p>
    );
  const served = Date.parse(read.now);
  const now =
    nowGiven ??
    (Number.isFinite(served) ? served + (Date.now() - read.at) : Date.now());
  const stored = read.row?.answers ?? {};
  const wait = offerWait(read.row, now);
  return (
    <ol
      aria-label="The three parts"
      className="flex flex-wrap items-center gap-x-7 gap-y-1.5 text-[13px]"
    >
      {PARTS.map(p => {
        const st = partState(read.row, p, stored, now);
        const v = railView(p, st, read.row, p === 3 ? wait : null);
        return (
          <li
            key={p}
            data-part={p}
            data-state={st.kind}
            className="inline-flex min-w-0 max-w-full items-center gap-2"
          >
            <span className="font-mono text-xs text-muted-foreground">{p}</span>
            <span className="whitespace-nowrap font-medium">
              {PART_NAME[p]}
            </span>
            <Dot tone={v.tone} pulse={st.kind === "sending"} />
            <span
              className={cn(
                "min-w-0 truncate",
                v.toneText ?? "text-muted-foreground",
              )}
              title={v.text}
            >
              {v.text}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// -------------------------------------------------------------------- the page

function useOnline(forcedOffline?: boolean) {
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine !== false,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return forcedOffline ? false : online;
}

export function BlueprintCall({
  taskId,
  rehearse,
  io,
  clientName,
  at = null,
  frames: framesGiven,
  initial,
  initialRead,
  frameless = false,
  offline: forcedOffline,
  host,
  readOnly: readOnlyGiven,
  onSignIn,
  practice = false,
}: {
  taskId: string;
  rehearse: boolean;
  io: Pick<BlueprintIO, "read"> | null;
  /** From the card, through the router (EMBED.md 4.1). */
  clientName?: string | null;
  /** The part the address names (#part1 to #part3). */
  at?: PartAnchor | null;
  /** The harness's frames; the portal's routes otherwise. */
  frames?: CallFrames;
  /** The harness's and the tests' state, to see one at once. */
  initial?: Call;
  initialRead?: Read;
  /** No frame at all (the harness's forced states). */
  frameless?: boolean;
  offline?: boolean;
  /** The page's own host, for the wrong-host state. */
  host?: string;
  readOnly?: boolean;
  /**
   * Signs this browser out, so the cockpit's own sign-in gate sends him to
   * sign in and back here. Left out (the harness), a link to the sign-in.
   */
  onSignIn?: () => void;
  /**
   * The practice client (docs/call-guide/DESIGN.md): made up, nothing is
   * saved or sent, and Back goes to All clients.
   */
  practice?: boolean;
}) {
  const valid = isTaskId(taskId);
  const frames = useMemo(
    () => framesGiven ?? portalFrames(taskId, rehearse),
    [framesGiven, taskId, rehearse],
  );
  const [s, send] = useReducer(callReducer, initial ?? startCall);
  const { read, reload } = useRecord(
    taskId,
    valid ? io : null,
    rehearse,
    initialRead,
  );
  const online = useOnline(forcedOffline);
  const row = read && !("error" in read) ? read.row : null;
  const name =
    clientName?.trim() || row?.clientName?.trim() || s.name?.trim() || null;
  const readOnly = readOnlyGiven ?? row?.can?.write === false;

  // The prep frame's address is set once per frame; a later #part is
  // passed to the frame's own address.
  const prepRef = useRef<HTMLIFrameElement>(null);
  const deckRef = useRef<HTMLIFrameElement>(null);
  const atRef = useRef(at);
  atRef.current = at;
  // biome-ignore lint/correctness/useExhaustiveDependencies: one address per prep frame (prepKey)
  const prepSrc = useMemo(
    () => frames.prep(atRef.current),
    [frames, s.prepKey],
  );
  // The first part rides in the frame's own address; only a later change is
  // passed on, and never to a frame still on about:blank (a hash there
  // would cancel the deck's load).
  const firstAt = useRef(at);
  useEffect(() => {
    if (!at || at === firstAt.current) return;
    firstAt.current = null;
    try {
      const w = prepRef.current?.contentWindow;
      if (!w || w.location.href === "about:blank") return;
      if (w.location.hash !== `#${at}`) w.location.hash = at;
    } catch {
      // not ours to steer
    }
  }, [at]);

  // The deck takes the keyboard once it is drawn: arrows, Space, N, F, L.
  useEffect(() => {
    if (!s.focus) return;
    deckRef.current?.focus();
    deckRef.current?.contentWindow?.focus();
  }, [s.focus]);

  // While presenting, the cockpit beneath is out of reach: no key, no tab
  // stop and no click lands on prep or the rail.
  const presenting = Boolean(s.layer);
  useEffect(() => {
    if (!presenting) return;
    const root = document.getElementById("root");
    root?.setAttribute("inert", "");
    return () => root?.removeAttribute("inert");
  }, [presenting]);

  // Back (a swipe, the mouse's back button, Cmd+[) while the deck is shared
  // keeps the deck up, as the old deck window did: it had no history to go
  // back to. The guard copies the router's own state, so the router sees
  // the same place and the page stays as it is.
  useEffect(() => {
    if (!presenting) return;
    const hold = () =>
      window.history.pushState({ ...window.history.state, bpDeck: true }, "");
    hold();
    window.addEventListener("popstate", hold);
    return () => {
      window.removeEventListener("popstate", hold);
      if (window.history.state?.bpDeck) window.history.back();
    };
  }, [presenting]);

  // The prep's toolbar and body end where this header ends, past the
  // frame's own scrollbar, at every width: the frame's breakpoints are its
  // own, not the page's, so the page tells it how far that is (--host-end).
  // A hidden or overlay scrollbar takes no room, and the sum still holds.
  const prepShown = s.stage.kind === "ready";
  // biome-ignore lint/correctness/useExhaustiveDependencies: a fresh prep frame (prepKey) is measured again
  useEffect(() => {
    if (!prepShown) return;
    const frame = prepRef.current;
    const head = headRef.current;
    const w = frame?.contentWindow;
    if (!frame || !head || !w) return;
    const fit = () => {
      try {
        const doc = w.document.documentElement;
        const bar = w.innerWidth - doc.clientWidth;
        const end =
          frame.getBoundingClientRect().right -
          head.getBoundingClientRect().right -
          bar;
        doc.style.setProperty(
          "--host-end",
          `${Math.max(0, Math.round(end))}px`,
        );
      } catch {
        // not ours to measure
      }
    };
    fit();
    window.addEventListener("resize", fit);
    let ro: ResizeObserver | null = null;
    try {
      // The frame's own scrollbar comes and goes with its content.
      const RO = (w as unknown as { ResizeObserver?: typeof ResizeObserver })
        .ResizeObserver;
      if (RO) {
        ro = new RO(fit);
        ro.observe(w.document.documentElement);
      }
    } catch {
      ro = null;
    }
    return () => {
      window.removeEventListener("resize", fit);
      ro?.disconnect();
    };
  }, [prepShown, s.prepKey]);

  // The page itself never scrolls; the prep does. A wheel over the header
  // scrolls the prep, as a wheel anywhere scrolls every other cockpit page.
  const wheel = (e: { deltaY: number; deltaMode: number }) => {
    const k =
      e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
    try {
      prepRef.current?.contentWindow?.scrollBy({ top: e.deltaY * k });
    } catch {
      // not ours to scroll
    }
  };

  // The stage is the viewport below its own top edge, so the frame scrolls
  // inside and the page never shows two scrollbars.
  const stageRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      setHeight(Math.max(560, Math.floor(window.innerHeight - top)));
    };
    fit();
    window.addEventListener("resize", fit);
    const ro =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    if (headRef.current) ro?.observe(headRef.current);
    return () => {
      window.removeEventListener("resize", fit);
      ro?.disconnect();
    };
  }, []);

  const openNotes = () => {
    if (frames.notes)
      openNamed(
        frames.notes,
        notesWindowName(taskId, rehearse),
        NOTES_FEATURES,
      );
  };

  const backTo =
    name && !practice
      ? `/clients/${encodeURIComponent(name)}#blueprint`
      : "/clients";
  // The name comes from the card at once; a pasted address waits for the
  // record, then the frame. Until one answers, a quiet line, never a guess.
  const waiting = !name && (read === undefined || s.stage.kind === "opening");
  const back = waiting ? (
    <span
      data-skeleton=""
      className="mb-3 inline-flex h-4 items-center gap-1 text-xs text-muted-foreground"
    >
      <ArrowLeft aria-hidden className="size-3.5 shrink-0" />
      <span className="inline-block h-3 w-32 rounded bg-muted motion-safe:animate-pulse" />
    </span>
  ) : (
    <Link
      to={backTo}
      className="mb-3 inline-flex max-w-full items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft aria-hidden className="size-3.5 shrink-0" />
      {name && !practice ? (
        <bdi className="truncate">{name}</bdi>
      ) : (
        "All clients"
      )}
    </Link>
  );

  const stage = s.stage;
  if (!valid)
    return (
      <Notice
        title="No client card with that ID."
        action={
          <Button asChild size="sm" variant="outline">
            <Link to="/clients">All clients</Link>
          </Button>
        }
      />
    );
  if (host && wrongHost(host)) {
    const there = practice
      ? `${PORTAL}${PRACTICE_CALL.call}`
      : `${PORTAL}/creative/blueprint/${taskId}${rehearse ? "?rehearse=1" : ""}${at ? `#${at}` : ""}`;
    return (
      <Notice
        title="The Blueprint opens on cockpit.maharamedia.com."
        line="This address is another sign-in, so the call cannot open here."
        action={
          <Button asChild size="sm">
            <a href={there}>Open it there</a>
          </Button>
        }
      />
    );
  }

  const mounted =
    !frameless &&
    prepSrc !== null &&
    (stage.kind === "opening" ||
      stage.kind === "slow" ||
      stage.kind === "ready" ||
      stage.kind === "offline");
  const reloadButton = (
    <Button
      size="sm"
      variant="outline"
      onClick={() => send({ type: "reload" })}
    >
      <RotateCw aria-hidden />
      Reload
    </Button>
  );

  return (
    <>
      {/* The stage's width, not the client page's: the header's edges meet
          the prep's own (16 px in from the frame), so the two read as one
          page at every width, 1920 included. */}
      <div ref={headRef} className="w-full" onWheel={wheel}>
        {back}
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">
              {practice ? (
                <>
                  Brand Blueprint call · <bdi>{name}</bdi>
                </>
              ) : (
                "Brand Blueprint call"
              )}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Present fills this tab with the deck. Share only this tab on the
              call.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Offline before the prep opens, the stage says it; the chip is
                for a call already under way. */}
            {online || stage.kind !== "ready" ? null : (
              <span
                role="status"
                className="tone-warn inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
              >
                <WifiOff aria-hidden className="size-3.5" />
                Offline: what you type saves when the connection is back.
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={openNotes}
              disabled={!frames.notes}
            >
              <NotebookPen aria-hidden />
              Open the notes window
            </Button>
          </div>
        </header>
        {practice ? (
          <p
            data-practice-note=""
            className="mt-4 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-medium"
          >
            Practice client: made up. Nothing is saved, sent or booked. Each
            press shows its plan.
          </p>
        ) : rehearse ? (
          <p className="callout-warn mt-4 rounded-lg border px-3 py-2 text-xs">
            Rehearsal: nothing is saved or sent. Each press shows its plan.
          </p>
        ) : null}
        {readOnly ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Only the creative director sends the parts.
          </p>
        ) : null}
        <div className="mt-5">
          <PartsRail read={read} onRetry={() => void reload()} />
        </div>
      </div>

      {/* The seam: the prep is the lower half of this page, flush under one
          hairline the page's full width, with no card around it. The frame
          sits in on the left by the page's padding less the prep's own
          16 px, and reaches the window's right edge, so its scrollbar is
          where every cockpit page has one; the prep pads its right side to
          meet the header's edge (EMBED.md 11.1). */}
      <div
        ref={stageRef}
        data-stage={stage.kind}
        className="relative -mx-4 -mb-24 mt-4 border-t sm:-mx-6 lg:-mx-8 lg:-mb-12"
        style={{ height: height ?? 560 }}
      >
        {mounted && prepSrc ? (
          <div className="absolute inset-y-0 right-0 left-0 sm:left-2 lg:left-4">
            <DeckFrame
              key={s.prepKey}
              src={prepSrc}
              title="Brand Blueprint prep"
              allowed={frames.allowed}
              onMessage={m => send({ type: "message", from: "prep", m })}
              onTrouble={t => send({ type: "trouble", from: "prep", t })}
              shown={stage.kind === "ready"}
              inert={presenting}
              frameRef={prepRef}
            />
          </div>
        ) : null}
        {stage.kind === "ready" ? null : (
          <StageLine>
            {stage.kind === "opening" ? (
              <p className="text-sm text-muted-foreground">
                Opening the Blueprint…
              </p>
            ) : stage.kind === "slow" ? (
              <>
                <p className="text-[15px] font-semibold">
                  The Blueprint did not open.
                </p>
                <p className="text-sm text-muted-foreground">
                  Reload it. Nothing you saved is lost.
                </p>
                <div>{reloadButton}</div>
              </>
            ) : stage.kind === "failed" ? (
              <>
                <p className="text-[15px] font-semibold">
                  The Blueprint did not open.
                </p>
                <p className="max-w-lg text-balance text-sm text-muted-foreground">
                  {stage.message}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  {reloadButton}
                  <Link
                    to={backTo}
                    className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    {name ? (
                      <>
                        Back to <bdi>{name}</bdi>
                      </>
                    ) : (
                      "All clients"
                    )}
                  </Link>
                </div>
              </>
            ) : stage.kind === "offline" ? (
              <p className="text-sm text-muted-foreground">
                You're offline. The Blueprint opens when the connection is back.
              </p>
            ) : (
              <>
                <p className="text-[15px] font-semibold">
                  Sign in to the cockpit again.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  {onSignIn ? (
                    <Button size="sm" onClick={onSignIn}>
                      Sign in
                    </Button>
                  ) : (
                    <Button asChild size="sm">
                      <Link
                        to={`/login?next=${encodeURIComponent(`/blueprint/${taskId}`)}`}
                      >
                        Sign in
                      </Link>
                    </Button>
                  )}
                  <button
                    type="button"
                    onClick={() => send({ type: "reload" })}
                    className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    Reload
                  </button>
                </div>
              </>
            )}
          </StageLine>
        )}
      </div>

      {s.layer ? (
        <Presenting
          layer={s.layer}
          src={frames.deck()}
          allowed={frames.allowed}
          deckRef={deckRef}
          onMessage={m => send({ type: "message", from: "deck", m })}
          onTrouble={t => send({ type: "trouble", from: "deck", t })}
          onBack={() => send({ type: "back-to-prep" })}
          onAgain={() => send({ type: "present-again" })}
        />
      ) : null}
    </>
  );
}

function StageLine({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="absolute inset-0 flex flex-col items-center justify-start gap-3 px-6 pt-24 text-center"
    >
      {children}
    </div>
  );
}

function Notice({
  title,
  line,
  action,
}: {
  title: string;
  line?: string;
  action: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="mx-auto max-w-md space-y-3 py-16 text-center">
        <h1 className="text-lg font-semibold">{title}</h1>
        {line ? <p className="text-sm text-muted-foreground">{line}</p> : null}
        <div>{action}</div>
      </div>
    </div>
  );
}

/**
 * The shared deck over the whole tab, on the deck's own ground, above the
 * rail, the chat and any dialog. The prep stays mounted beneath it.
 */
function Presenting({
  layer,
  src,
  allowed,
  deckRef,
  onMessage,
  onTrouble,
  onBack,
  onAgain,
}: {
  layer: Layer;
  src: string | null;
  allowed: (pathname: string) => boolean;
  deckRef: RefObject<HTMLIFrameElement | null>;
  onMessage: (m: FrameMessage) => void;
  onTrouble: (t: FrameTrouble) => void;
  onBack: () => void;
  onAgain: () => void;
}) {
  const againRef = useRef<HTMLButtonElement>(null);
  // The two buttons sit on the shared tab, so they speak the deck's
  // language: the deck's own document says which (same origin).
  const [ar, setAr] = useState(false);
  useLayoutEffect(() => {
    if (layer.kind !== "ended") return;
    let lang: string | undefined;
    try {
      lang = deckRef.current?.contentDocument?.documentElement.lang;
    } catch {
      lang = undefined;
    }
    setAr(lang === "ar");
  }, [layer.kind, deckRef]);
  useEffect(() => {
    if (layer.kind === "ended") againRef.current?.focus();
  }, [layer.kind]);
  const pill =
    "inline-flex h-9 items-center rounded-full px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-deck-ground";
  const body = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="The shared deck"
      data-layer={layer.kind}
      className="fixed inset-0 z-[60] bg-deck-ground text-deck-ink"
    >
      {layer.kind !== "failed" && src ? (
        <DeckFrame
          key={layer.key}
          src={src}
          title="Brand Blueprint deck"
          allowed={allowed}
          onMessage={onMessage}
          onTrouble={onTrouble}
          shown={layer.kind !== "opening"}
          frameRef={deckRef}
        />
      ) : null}
      {layer.kind === "opening" ? (
        <p className="absolute inset-0 grid place-content-center text-sm text-deck-ink/60">
          Opening the deck…
        </p>
      ) : null}
      {layer.kind === "ended" ? (
        <div
          dir={ar ? "rtl" : "ltr"}
          lang={ar ? "ar" : "en"}
          className="absolute inset-x-0 top-[calc(50%+3.5rem)] flex justify-center gap-3"
        >
          <button
            type="button"
            onClick={onBack}
            className={cn(
              pill,
              "border border-white/25 text-deck-ink hover:bg-white/10",
            )}
          >
            {ar ? "رجوع للتحضير" : "Back to prep"}
          </button>
          <button
            ref={againRef}
            type="button"
            onClick={onAgain}
            className={cn(
              pill,
              "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            {ar ? "اعرض مرة ثانية" : "Present again"}
          </button>
        </div>
      ) : null}
      {layer.kind === "failed" || !src ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center">
          <strong className="text-2xl font-semibold">
            The deck did not open.
          </strong>
          <button
            type="button"
            onClick={onBack}
            className={cn(
              pill,
              "border border-white/25 text-deck-ink hover:bg-white/10",
            )}
          >
            Back to prep
          </button>
        </div>
      ) : null}
    </div>
  );
  // Out of the page's own stacking (its fade wrapper), straight onto the
  // body; inline where there is no document (the tests' static render).
  return typeof document === "undefined"
    ? body
    : createPortal(body, document.body);
}

/** The route: /creative/blueprint/:taskId (EMBED.md 4.1). */
export function BlueprintCallPage() {
  const { taskId = "" } = useParams();
  const location = useLocation();
  const auth = useCockpitAuth();
  const rehearse =
    (auth.isAdmin || auth.isCeo) &&
    new URLSearchParams(location.search).get("rehearse") === "1";
  const io = useMemo(
    () => (auth.client ? supabaseBlueprintIO(auth.client) : null),
    [auth.client],
  );
  const routed = (location.state ?? null) as Partial<CallRouteState> | null;
  const hash = location.hash.slice(1);
  const at = /^part[123]$/.test(hash) ? (hash as PartAnchor) : null;
  return (
    <BlueprintCall
      key={`${taskId}:${rehearse}`}
      taskId={taskId}
      rehearse={rehearse}
      io={io}
      clientName={
        typeof routed?.clientName === "string" ? routed.clientName : null
      }
      at={at}
      host={typeof window === "undefined" ? undefined : window.location.host}
      onSignIn={() => void auth.signOut()}
    />
  );
}

/** The practice client's frames: its own deck paths in the client success app. */
export const practiceFrames: CallFrames = {
  prep: at => practiceFrame("prep", at),
  deck: () => practiceFrame("present"),
  notes: PRACTICE_CALL.notes,
  allowed: p => practicePathOf(p) === "deck",
};

/**
 * The route: /creative/blueprint/practice (docs/call-guide/DESIGN.md). The
 * same call on the practice client, with the call guide. No record is read:
 * the rail stays at "Not sent yet", as nothing is ever sent.
 */
export function PracticeCallPage() {
  const auth = useCockpitAuth();
  const [read] = useState<Read>(() => ({
    row: null,
    now: new Date().toISOString(),
    at: Date.now(),
  }));
  return (
    <BlueprintCall
      taskId={PRACTICE_TASK}
      rehearse={false}
      practice
      io={null}
      clientName={PRACTICE_NAME}
      frames={practiceFrames}
      initialRead={read}
      host={typeof window === "undefined" ? undefined : window.location.host}
      onSignIn={() => void auth.signOut()}
    />
  );
}
