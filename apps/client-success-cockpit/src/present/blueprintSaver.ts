import { checkValue, sameValue } from "./blueprintForm";

/**
 * Autosave per field, with conflict detection (docs/brand-blueprint/
 * SPEC.md 2.4). Built on PrepSaver's queue: typed fields go 600 ms after
 * the last key, ticks and buttons at once, one save in flight, what arrives
 * meanwhile in the next. Each change carries `seen`, the value this browser
 * last had confirmed by the server for that key, so the server can tell a
 * change made over someone else's from one made over our own. A key the
 * registry does not know is refused before anything is sent.
 */

export interface Change {
  value: unknown;
  seen: unknown;
  from?: string;
}

export interface SaveConflict {
  key: string;
  theirs: unknown;
  by: string | null;
  at: string | null;
}

export interface SaveResult {
  row: {
    answers: Record<string, unknown>;
    meta?: Record<
      string,
      { by?: string | null; at?: string | null; from?: string | null }
    >;
    parts?: Record<string, unknown>;
    revision: number;
  } | null;
  applied: string[];
  conflicts: SaveConflict[];
}

export interface BlueprintSaverOptions {
  save: (
    changes: Record<string, Change>,
    baseRevision: number | null,
  ) => Promise<SaveResult>;
  onSaved: (result: SaveResult, sent: Record<string, Change>) => void;
  onConflict?: (c: SaveConflict & { mine: unknown }) => void;
  onError: (message: string) => void;
  delay?: number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

/** At most 40 keys per save (the server's limit). */
const MAX_KEYS = 40;

export class BlueprintSaver {
  private pending = new Map<string, { value: unknown; from?: string }>();
  private timer: unknown = null;
  private flight: Promise<void> | null = null;
  /** Per key, the value the server last confirmed to this browser. */
  private seenValues = new Map<string, unknown>();
  revision: number | null = null;
  private readonly delay: number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  private readonly opts: BlueprintSaverOptions;

  constructor(opts: BlueprintSaverOptions) {
    this.opts = opts;
    this.delay = opts.delay ?? 600;
    this.schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel =
      opts.cancel ?? (h => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** The record as read: every value is what this browser has seen. */
  load(answers: Record<string, unknown>, revision: number | null): void {
    this.seenValues = new Map(Object.entries(answers));
    this.revision = revision;
  }

  /** Another window of this browser saved these: they are seen here too. */
  confirm(values: Record<string, unknown>, revision: number | null): void {
    for (const [k, v] of Object.entries(values)) this.seenValues.set(k, v);
    if (revision != null && (this.revision == null || revision > this.revision))
      this.revision = revision;
  }

  seen(key: string): unknown {
    return this.seenValues.has(key) ? this.seenValues.get(key) : null;
  }

  /** What is waiting to be sent. */
  get waiting(): string[] {
    return [...this.pending.keys()];
  }

  /**
   * Queue one answer: `now` sends at once (a tick, a button), else after
   * the pause. Returns why it was refused, or null.
   */
  set(
    key: string,
    value: unknown,
    opts: { now?: boolean; from?: string } = {},
  ): string | null {
    const checked = checkValue(key, value);
    if ("error" in checked) return checked.error;
    this.pending.set(key, {
      value: checked.value,
      ...(opts.from ? { from: opts.from } : {}),
    });
    if (this.timer != null) this.cancel(this.timer);
    this.timer = null;
    if (opts.now) void this.flush();
    else
      this.timer = this.schedule(() => {
        this.timer = null;
        void this.flush();
      }, this.delay);
    return null;
  }

  /**
   * Save again over what the server holds now ("Use mine" after a
   * conflict): this browser has seen theirs, so the server takes it.
   */
  keepMine(key: string, mine: unknown, theirs: unknown): string | null {
    this.seenValues.set(key, theirs);
    return this.set(key, mine, { now: true });
  }

  /** Send what is waiting now. Resolves once it (and anything before it) is sent. */
  async flush(): Promise<void> {
    if (this.timer != null) {
      this.cancel(this.timer);
      this.timer = null;
    }
    while (this.flight) await this.flight;
    if (!this.pending.size) return;
    const batch = [...this.pending.entries()].slice(0, MAX_KEYS);
    for (const [k] of batch) this.pending.delete(k);
    const sent: Record<string, Change> = {};
    for (const [k, p] of batch)
      sent[k] = {
        value: p.value,
        seen: this.seen(k),
        ...(p.from ? { from: p.from } : {}),
      };
    this.flight = (async () => {
      try {
        // No base revision: the server checks every key against what this
        // browser saw, so an answer someone else changed since is never
        // overwritten just because this browser saved another key meanwhile
        // (the revision fast path would apply everything). The same session
        // never conflicts with itself, and Use mine still wins.
        const result = await this.opts.save(sent, null);
        const row = result.row;
        for (const k of result.applied)
          this.seenValues.set(
            k,
            row ? (row.answers[k] ?? null) : sent[k].value,
          );
        if (row && Object.hasOwn(row.answers, "shot_list_due"))
          this.seenValues.set("shot_list_due", row.answers.shot_list_due);
        for (const c of result.conflicts) {
          this.seenValues.set(c.key, c.theirs);
          this.opts.onConflict?.({ ...c, mine: sent[c.key]?.value ?? null });
        }
        if (row) this.revision = row.revision;
        this.opts.onSaved(result, sent);
      } catch (e) {
        // Put it back unless something newer replaced it, so a retry sends it.
        for (const [k, c] of Object.entries(sent))
          if (!this.pending.has(k))
            this.pending.set(k, {
              value: c.value,
              ...(c.from ? { from: c.from } : {}),
            });
        this.opts.onError(e instanceof Error ? e.message : String(e));
      } finally {
        this.flight = null;
      }
    })();
    await this.flight;
    if (this.pending.size && batch.length === MAX_KEYS) await this.flush();
  }

  /** Whether a key's value is what the server last confirmed. */
  isSeen(key: string, value: unknown): boolean {
    return sameValue(this.seen(key), value);
  }
}

/**
 * One ID per browser profile (localStorage), so the deck window and the
 * notes window of one call share it; a fresh one per window when storage
 * throws (a private window).
 */
export function sessionId(
  storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage(),
): string {
  const make = () => {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
    const bytes = new Uint8Array(22);
    crypto.getRandomValues(bytes);
    return [...bytes].map(b => chars[b % chars.length]).join("");
  };
  try {
    const v = storage?.getItem("mahara-bp-session");
    if (v && /^[A-Za-z0-9_-]{8,64}$/.test(v)) return v;
    const id = make();
    storage?.setItem("mahara-bp-session", id);
    return id;
  } catch {
    return make();
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
