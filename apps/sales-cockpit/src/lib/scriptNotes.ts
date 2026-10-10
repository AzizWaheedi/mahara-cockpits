/**
 * The call's notes, kept as the call goes (sales simplify, 2026-10-10).
 *
 * A call is named by an id made on the rep's device, kept in the device's
 * draft with what was typed, so a refresh mid-call loses nothing and a save
 * sent again lands on the same row (sales-api script.save). The saver sends
 * 2.5 seconds after typing stops, and at once on a part change, when the
 * page is hidden and on Save; one save at a time, a change during a save
 * queues exactly one more, a failure keeps the draft and tries again in 30
 * seconds. Nothing is sent before something is typed.
 */

import { ApiError } from "./apiErrors";

type Values = Record<string, string>;

export interface CallDraft {
  callId: string;
  /** When it last changed (ms). */
  at: number;
  values: Values;
  checked: Record<string, boolean>;
  notes: Record<string, string>;
  /** Something was typed on this call (a seeded answer is not). */
  touched: boolean;
  /** The part on screen (its number), so a reload opens where the rep was. */
  stage?: number;
  /** The furthest part reached (its number). */
  reached?: number;
  /** When the call's screen was first opened (ms): the timer goes on from it. */
  startedAt?: number;
}

/** A draft untouched this long is an old call: the next open starts a new one. */
export const DRAFT_TTL_MS = 6 * 3_600_000;
export const SAVE_PAUSE_MS = 2_500;
export const RETRY_MS = 30_000;

export const draftKey = (contactId: string, key: string) =>
  `sales_call_draft_${contactId}_${key}`;

/** A fresh call id (a uuid, as script.save wants). */
export function newCallId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function store(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const asStrings = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (v && typeof v === "object" && !Array.isArray(v))
    for (const [k, x] of Object.entries(v))
      if (typeof x === "string") out[k] = x;
  return out;
};

/**
 * This lead and script's draft on this device: the call it belongs to and
 * what was typed. A draft from before call ids (values and ticks only) is
 * kept under a new call. One untouched for 6 hours, or unreadable, gives a
 * new empty call.
 */
export function readCallDraft(
  contactId: string,
  key: string,
  now = Date.now(),
  s: Store | null = store(),
): CallDraft & { fresh: boolean } {
  const empty = {
    callId: newCallId(),
    at: now,
    values: {},
    checked: {},
    notes: {},
    touched: false,
    fresh: true,
  };
  let raw: unknown = null;
  try {
    raw = JSON.parse(s?.getItem(draftKey(contactId, key)) ?? "null");
  } catch {
    return empty;
  }
  if (!raw || typeof raw !== "object") return empty;
  const d = raw as Partial<CallDraft> & { checked?: unknown };
  const at = typeof d.at === "number" && Number.isFinite(d.at) ? d.at : null;
  if (at !== null && now - at > DRAFT_TTL_MS) return empty;
  const checked: Record<string, boolean> = {};
  if (d.checked && typeof d.checked === "object")
    for (const [k, v] of Object.entries(d.checked)) checked[k] = v === true;
  const values = asStrings(d.values);
  const notes = asStrings(d.notes);
  const part = (v: unknown) =>
    typeof v === "number" && Number.isInteger(v) && v > 0 && v < 100
      ? v
      : undefined;
  const startedAt =
    typeof d.startedAt === "number" &&
    Number.isFinite(d.startedAt) &&
    d.startedAt <= now &&
    now - d.startedAt <= 2 * DRAFT_TTL_MS
      ? d.startedAt
      : undefined;
  return {
    callId:
      typeof d.callId === "string" && UUID.test(d.callId)
        ? d.callId
        : newCallId(),
    at: at ?? now,
    values,
    checked,
    notes,
    // An old draft holds only what a rep typed.
    touched:
      d.touched === true ||
      (d.touched === undefined &&
        (Object.keys(values).length > 0 || Object.keys(checked).length > 0)),
    stage: part(d.stage),
    reached: part(d.reached),
    startedAt,
    fresh: false,
  };
}

export function writeCallDraft(
  contactId: string,
  key: string,
  d: CallDraft,
  s: Store | null = store(),
): void {
  try {
    s?.setItem(draftKey(contactId, key), JSON.stringify(d));
  } catch {
    // a private window: the call still saves to the lead
  }
}

export function clearCallDraft(
  contactId: string,
  key: string,
  s: Store | null = store(),
): void {
  try {
    s?.removeItem(draftKey(contactId, key));
  } catch {
    // nothing to clear
  }
}

// ------------------------------------------------------------- the saver

export type SaveState =
  /** Nothing typed yet: nothing to save. */
  | { kind: "idle" }
  /** Typed; it saves when typing stops. */
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  /** Kept on this device; `retryAt` when it tries again by itself. */
  | { kind: "failed"; message: string; retryAt: number | null };

export interface SaverDeps {
  /** What to send now, or null when there is nothing to save. */
  build: (final: boolean) => Record<string, unknown> | null;
  send: (payload: Record<string, unknown>) => Promise<unknown>;
  onState: (s: SaveState) => void;
  /** A save landed (final: the rep's own "Save the call's notes"). */
  onSaved?: (final: boolean) => void;
  /** The server says this call's row was deleted: start a new call and save again. */
  onDeleted?: () => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  pauseMs?: number;
  retryMs?: number;
}

/** The words under the notes for each state. */
export function saveWords(s: SaveState, clock: (ms: number) => string): string {
  // Typed and waiting for the pause is said as saving: it is seconds away.
  if (s.kind === "saving" || s.kind === "pending") return "Saving…";
  if (s.kind === "saved") return `Saved at ${clock(s.at)}`;
  if (s.kind === "failed")
    return s.retryAt
      ? "Not saved, kept on this device. Trying again in 30 seconds."
      : `Not saved, kept on this device. ${s.message}`;
  return "";
}

export class NotesSaver {
  private d: Required<
    Pick<SaverDeps, "now" | "setTimer" | "clearTimer" | "pauseMs" | "retryMs">
  > &
    SaverDeps;
  private touched = false;
  private flight: Promise<boolean> | null = null;
  private queued: { final: boolean } | null = null;
  private waiters: ((ok: boolean) => void)[] = [];
  private pause: unknown = null;
  private retry: unknown = null;
  private deletedOnce = false;
  private disposed = false;
  state: SaveState = { kind: "idle" };

  constructor(deps: SaverDeps, touched = false) {
    this.d = {
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: t => clearTimeout(t as ReturnType<typeof setTimeout>),
      pauseMs: SAVE_PAUSE_MS,
      retryMs: RETRY_MS,
      ...deps,
    };
    this.touched = touched;
    // Said through `state`, not onState: a constructor runs while a screen
    // is drawn, where telling it would be a change mid-draw.
    if (touched) this.state = { kind: "pending" };
  }

  get isTouched(): boolean {
    return this.touched;
  }

  private set(s: SaveState) {
    this.state = s;
    if (!this.disposed) this.d.onState(s);
  }

  private stop(t: "pause" | "retry") {
    if (this[t] !== null) this.d.clearTimer(this[t]);
    this[t] = null;
  }

  /** Something was typed: it saves when typing stops. */
  change(): void {
    if (this.disposed) return;
    this.touched = true;
    this.stop("pause");
    this.stop("retry");
    if (!this.flight) this.set({ kind: "pending" });
    this.pause = this.d.setTimer(() => {
      this.pause = null;
      void this.flush();
    }, this.d.pauseMs);
  }

  /**
   * Save now: a part change, the page hidden, Save. Resolves true once what
   * was there at the press is on the server. Before anything is typed there
   * is nothing to save (and nothing is sent), except a final save the rep
   * asked for.
   */
  flush(final = false): Promise<boolean> {
    this.stop("pause");
    if (!this.touched && !final) return Promise.resolve(true);
    if (this.flight) {
      this.queued = { final: Boolean(this.queued?.final || final) };
      return new Promise(res => this.waiters.push(res));
    }
    return this.run(final);
  }

  private async run(final: boolean): Promise<boolean> {
    this.stop("retry");
    const payload = this.d.build(final);
    if (!payload) {
      this.set({ kind: this.touched ? "pending" : "idle" });
      return false;
    }
    this.set({ kind: "saving" });
    let ok = false;
    const go = (async () => {
      try {
        await this.d.send(payload);
        ok = true;
        this.deletedOnce = false;
        this.set({ kind: "saved", at: this.d.now() });
        this.d.onSaved?.(final);
      } catch (e) {
        const err = e instanceof ApiError ? e : null;
        if (err?.code === "deleted" && !this.deletedOnce && this.d.onDeleted) {
          // The row was deleted on the lead page: this call starts again.
          this.deletedOnce = true;
          this.d.onDeleted();
          this.queued = { final: Boolean(this.queued?.final || final) };
          return;
        }
        const message = String((e as Error)?.message ?? e);
        // A refusal the server will give again (too long, not yours, not a
        // lead) waits for the next change; anything else tries again.
        const again = !(err && err.kind === "refused" && err.status !== 409);
        const retryAt = again ? this.d.now() + this.d.retryMs : null;
        this.set({ kind: "failed", message, retryAt });
        if (again)
          this.retry = this.d.setTimer(() => {
            this.retry = null;
            void this.flush();
          }, this.d.retryMs);
      }
    })();
    this.flight = go.then(() => ok);
    await go;
    this.flight = null;
    if (this.queued && !this.disposed) {
      const q = this.queued;
      this.queued = null;
      const waiters = this.waiters;
      this.waiters = [];
      const next = await this.run(q.final);
      for (const w of waiters) w(next);
      return ok && next;
    }
    return ok;
  }

  dispose(): void {
    this.stop("pause");
    this.stop("retry");
    this.disposed = true;
    for (const w of this.waiters) w(false);
    this.waiters = [];
  }
}

/** Whether a value counts as typed: a seeded or blank answer does not. */
export function someText(v: Values | Record<string, string>): boolean {
  return Object.values(v).some(x => typeof x === "string" && x.trim() !== "");
}
