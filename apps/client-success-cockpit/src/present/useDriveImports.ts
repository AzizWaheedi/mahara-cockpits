import { useCallback, useEffect, useRef, useState } from "react";
import type { DeckMessage } from "./channel";
import type { Lang } from "./content";
import { DRIVE_REFUSED } from "./driveCopy";
import { parseDriveLink } from "./driveLink";
import { isOpen } from "./driveView";
import {
  type DriveImport,
  DriveImportError,
  type DriveImports,
  problem,
} from "./sources";

/**
 * The Drive box's state for one window (DRIVE-IMPORT.md 8, DESIGN 22.7):
 * the client's imports read on mount, every 5 s while one is queued or
 * working, paused while the window is hidden and read at once on return,
 * stopped when none is open. A read error backs off to 10, 20, then 60 s;
 * a success returns to 5. When a file lands, the tray is read again in
 * every window. It lives as long as the prep view or the notes window, not
 * the ads slide's panel, so files keep arriving while the CSM preps the
 * other slides.
 */

export const POLL_MS = 5_000;
export const BACKOFF_MS = [10_000, 20_000, 60_000] as const;

/** When to read next; null stops the reads until something starts them again. */
export function nextDelay(s: {
  open: boolean;
  errors: number;
  notLive: boolean;
}): number | null {
  if (s.notLive) return null;
  if (s.errors > 0)
    return BACKOFF_MS[Math.min(s.errors, BACKOFF_MS.length) - 1];
  return s.open ? POLL_MS : null;
}

export interface PollerDeps {
  read: () => Promise<DriveImports>;
  /** A read came back; `seq` orders it against requests made meanwhile. */
  onRead: (r: DriveImports, seq: number) => void;
  onError: (e: unknown, notLive: boolean) => void;
  /** The functions are not deployed: no retry until the window is shown again. */
  isNotLive: (e: unknown) => boolean;
  hidden: () => boolean;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
}

/** The reads' clock, apart from React so its rules are tested with fake timers. */
export class DrivePoller {
  private timer: unknown = null;
  private busy = false;
  private again = false;
  private stopped = false;
  private seq = 0;
  errors = 0;
  open = false;
  notLive = false;
  reads = 0;
  private readonly d: PollerDeps;

  constructor(deps: PollerDeps) {
    this.d = deps;
  }

  /** Read at once: on mount, after a request, back from hidden, another window's request. */
  now(): void {
    if (this.stopped) return;
    this.clear();
    if (this.busy) {
      this.again = true;
      return;
    }
    if (this.d.hidden()) return;
    this.busy = true;
    this.reads += 1;
    const mine = ++this.seq;
    // A read that throws at once (no sign-in) fails like any other.
    Promise.resolve()
      .then(() => this.d.read())
      .then(
        r => {
          if (this.stopped) return;
          this.errors = 0;
          this.notLive = false;
          this.open = r.imports.some(isOpen);
          this.d.onRead(r, mine);
        },
        e => {
          if (this.stopped) return;
          if (this.d.isNotLive(e)) this.notLive = true;
          else this.errors += 1;
          this.d.onError(e, this.notLive);
        },
      )
      .finally(() => {
        this.busy = false;
        if (this.stopped) return;
        if (this.again) {
          this.again = false;
          this.now();
        } else this.schedule();
      });
  }

  /** A request just opened an import: the 5 s reads run. */
  opened(): void {
    this.open = true;
    if (!this.timer && !this.busy) this.schedule();
  }

  /** The window was hidden (the reads pause) or shown again (read at once). */
  visibility(hidden: boolean): void {
    if (hidden) this.clear();
    else this.now();
  }

  /** A sequence number for a local change, later than every read started so far. */
  mark(): number {
    this.seq += 1;
    return this.seq;
  }

  stop(): void {
    this.stopped = true;
    this.clear();
  }

  /** Whether a read is waiting on its timer (for the tests). */
  get waiting(): boolean {
    return this.timer !== null;
  }

  private schedule(): void {
    if (this.stopped || this.d.hidden()) return;
    const ms = nextDelay(this);
    if (ms === null) return;
    this.timer = this.d.setTimer(() => {
      this.timer = null;
      this.now();
    }, ms);
  }

  private clear(): void {
    if (this.timer !== null) this.d.clearTimer(this.timer);
    this.timer = null;
  }
}

/**
 * Whether a file landed since the last read: by each import's own count, so
 * an old import leaving the read's 14 days never hides a new landing. The
 * first read only sets the counts (the tray was read with the deck).
 */
export function landedGrew(
  before: Map<string, number> | null,
  imports: DriveImport[],
): { grew: boolean; next: Map<string, number> } {
  const next = new Map(imports.map(i => [i.id, i.landed]));
  if (!before) return { grew: false, next };
  const grew = imports.some(i => i.landed > (before.get(i.id) ?? 0));
  return { grew, next };
}

/** A read with the imports this window requested after it started, newest first. */
export function withLocal(
  read: DriveImports,
  locals: DriveImport[],
): DriveImports {
  const ids = new Set(read.imports.map(i => i.id));
  const extra = locals.filter(i => !ids.has(i.id));
  if (!extra.length) return read;
  const imports = [...extra, ...read.imports].sort(
    (a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt),
  );
  return { ...read, imports: imports.slice(0, 20) };
}

/** One link the box could not send: the parser's refusal or the server's. */
export interface DriveRefusal {
  link: string;
  code: string | null;
  /** The sentence in English, as the server or the parser wrote it. */
  message: string;
  /** About the link itself (link_*): its line goes under the field. */
  aboutLink: boolean;
}

export interface DriveBoxState {
  /** The box shows: this deck can request and read imports. */
  enabled: boolean;
  /** The box's language (the prep and notes UI is English today). */
  lang: Lang;
  read: DriveImports | null;
  /** Why the last read failed, until a read succeeds. */
  readProblem: string | null;
  /** The two functions are not deployed yet. */
  notLive: boolean;
  sending: boolean;
  /** Each link in turn, in the paste's order; resolves with the refusals. */
  send: (links: string[]) => Promise<{ sent: number; refused: DriveRefusal[] }>;
}

export interface DriveIO {
  requestDriveImport?: (
    link: string,
  ) => Promise<DriveImport & { existing: boolean }>;
  readDriveImports?: () => Promise<DriveImports>;
}

const notLiveError = (e: unknown) => e instanceof DriveImportError && e.notLive;

export function useDriveImports(o: {
  /** Null turns the box off (the onboarding deck, a deck still loading). */
  taskId: string | null;
  io?: DriveIO;
  hub?: {
    on: (fn: (m: DeckMessage) => void) => () => void;
    post: (m: DeckMessage) => void;
  };
  /** A file landed: read the tray again in this window and the others. */
  onLanded?: () => void;
  lang?: Lang;
}): DriveBoxState {
  const read = o.io?.readDriveImports;
  const request = o.io?.requestDriveImport;
  const enabled = Boolean(o.taskId && read && request);
  const [data, setData] = useState<DriveImports | null>(null);
  const [readProblem, setReadProblem] = useState<string | null>(null);
  const [notLive, setNotLive] = useState(false);
  const [sending, setSending] = useState(false);
  const poller = useRef<DrivePoller | null>(null);
  const last = useRef<DriveImports | null>(null);
  const locals = useRef(new Map<string, { imp: DriveImport; seq: number }>());
  const landed = useRef<Map<string, number> | null>(null);
  const onLanded = useRef(o.onLanded);
  onLanded.current = o.onLanded;
  const hub = o.hub;

  const show = useCallback(() => {
    const base = last.current;
    const mine = [...locals.current.values()].map(l => l.imp);
    if (!base && !mine.length) return;
    setData(
      withLocal(
        base ?? {
          imports: [],
          workerSeenAt: null,
          at: mine[0]?.requestedAt ?? new Date().toISOString(),
        },
        mine,
      ),
    );
  }, []);

  useEffect(() => {
    if (!enabled || !read) return;
    last.current = null;
    landed.current = null;
    locals.current.clear();
    setData(null);
    setReadProblem(null);
    setNotLive(false);
    const hidden = () =>
      typeof document !== "undefined" && document.visibilityState === "hidden";
    const p = new DrivePoller({
      read,
      onRead: (r, mine) => {
        for (const [id, l] of locals.current)
          if (l.seq < mine) locals.current.delete(id);
        last.current = r;
        const g = landedGrew(landed.current, r.imports);
        landed.current = g.next;
        setReadProblem(null);
        setNotLive(false);
        show();
        if (g.grew) onLanded.current?.();
      },
      onError: (e, off) => {
        if (off) setNotLive(true);
        else setReadProblem(problem(e, "try again", "no connection"));
      },
      isNotLive: notLiveError,
      hidden,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: t => clearTimeout(t as ReturnType<typeof setTimeout>),
    });
    poller.current = p;
    p.now();
    const onVisible = () => p.visibility(hidden());
    document.addEventListener("visibilitychange", onVisible);
    const off = hub?.on(m => {
      if (m.type === "drive") p.now();
    });
    return () => {
      p.stop();
      poller.current = null;
      document.removeEventListener("visibilitychange", onVisible);
      off?.();
    };
  }, [enabled, read, hub, show]);

  const send = useCallback(
    async (links: string[]) => {
      const refused: DriveRefusal[] = [];
      let sent = 0;
      if (!request || !links.length) return { sent, refused };
      setSending(true);
      try {
        for (const link of links) {
          const parsed = parseDriveLink(link);
          if (!parsed.ok) {
            refused.push({
              link,
              code: parsed.code,
              message: DRIVE_REFUSED[parsed.code].en,
              aboutLink: true,
            });
            continue;
          }
          try {
            // The rebuilt link: no authuser email ever leaves the browser.
            const imp = await Promise.resolve().then(() =>
              request(parsed.link),
            );
            locals.current.set(imp.id, {
              imp,
              seq: poller.current?.mark() ?? 0,
            });
            sent += 1;
            show();
          } catch (e) {
            const err = e instanceof DriveImportError ? e : null;
            if (err?.notLive) setNotLive(true);
            refused.push({
              link,
              code: err?.code ?? null,
              message:
                err?.message ??
                problem(e, "This link was not sent. Try again."),
              aboutLink: err?.aboutLink ?? false,
            });
          }
        }
      } finally {
        setSending(false);
      }
      if (sent) {
        poller.current?.opened();
        hub?.post({ type: "drive" });
      }
      return { sent, refused };
    },
    [request, hub, show],
  );

  return {
    enabled,
    lang: o.lang ?? "en",
    read: data,
    readProblem,
    notLive,
    sending,
    send,
  };
}
