/**
 * Autosave per field with conflict detection, for any native form
 * (docs/forms/STAGE2-CONTRACT.md 8.2): the Brand Blueprint saver's queue
 * (src/present/blueprintSaver.ts, left as it is) with the form's own check
 * and comparison passed in. Typed fields go 600 ms after the last key,
 * choices and buttons at once, one save in flight, at most 40 keys a save.
 * Each change carries `seen`, the value the server last confirmed to this
 * browser for that key, so the server can tell a change made over someone
 * else's from one made over our own (cockpit_form_save, the
 * cockpit_blueprint_save contract). An answer the form would refuse is
 * refused before anything is sent.
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
    revision: number;
  } | null;
  applied: string[];
  conflicts: SaveConflict[];
}

export interface FieldSaverOptions {
  save: (
    changes: Record<string, Change>,
    baseRevision: number | null,
  ) => Promise<SaveResult>;
  onSaved: (result: SaveResult, sent: Record<string, Change>) => void;
  onConflict?: (c: SaveConflict & { mine: unknown }) => void;
  /** A save failed: `kept` when it waits to be sent again, else it was refused. */
  onError: (message: string, keys: string[], kept: boolean) => void;
  /**
   * Whether a failed save is kept to be sent again (offline, a timeout).
   * A refusal (the server's sentence about a value) is not: sending it again
   * would be refused again. Every failure is kept when this is not given.
   */
  keep?: (error: unknown) => boolean;
  /** The form's own check: the value to send, or why it is refused. */
  check: (
    key: string,
    value: unknown,
  ) => { value: unknown } | { error: string };
  /** The form's own comparison (key order ignored). */
  same: (a: unknown, b: unknown) => boolean;
  delay?: number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

/** At most 40 keys per save (the server's limit). */
const MAX_KEYS = 40;

export class FieldSaver {
  private pending = new Map<string, { value: unknown; from?: string }>();
  private timer: unknown = null;
  private flight: Promise<void> | null = null;
  /** Per key, the value the server last confirmed to this browser. */
  private seenValues = new Map<string, unknown>();
  revision: number | null = null;
  private readonly delay: number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  private readonly opts: FieldSaverOptions;

  constructor(opts: FieldSaverOptions) {
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

  /** A save is on its way. */
  get busy(): boolean {
    return this.flight !== null;
  }

  /**
   * Queue one answer: `now` sends at once (a choice, a button), else after
   * the pause. Returns why it was refused, or null.
   */
  set(
    key: string,
    value: unknown,
    opts: { now?: boolean; from?: string } = {},
  ): string | null {
    const checked = this.opts.check(key, value);
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
  keepMine(
    key: string,
    mine: unknown,
    theirs: unknown,
    from?: string,
  ): string | null {
    this.seenValues.set(key, theirs);
    return this.set(key, mine, { now: true, ...(from ? { from } : {}) });
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
        // overwritten just because this browser saved another key meanwhile.
        const result = await this.opts.save(sent, null);
        const row = result.row;
        for (const k of result.applied)
          this.seenValues.set(
            k,
            row ? (row.answers[k] ?? null) : sent[k].value,
          );
        for (const c of result.conflicts) {
          this.seenValues.set(c.key, c.theirs);
          this.opts.onConflict?.({ ...c, mine: sent[c.key]?.value ?? null });
        }
        if (row) this.revision = row.revision;
        this.opts.onSaved(result, sent);
      } catch (e) {
        // Put it back unless something newer replaced it, so a retry sends it.
        const kept = this.opts.keep ? this.opts.keep(e) : true;
        if (kept)
          for (const [k, c] of Object.entries(sent))
            if (!this.pending.has(k))
              this.pending.set(k, {
                value: c.value,
                ...(c.from ? { from: c.from } : {}),
              });
        this.opts.onError(
          e instanceof Error ? e.message : String(e),
          Object.keys(sent),
          kept,
        );
      } finally {
        this.flight = null;
      }
    })();
    await this.flight;
    if (this.pending.size && batch.length === MAX_KEYS) await this.flush();
  }

  /** Whether a key's value is what the server last confirmed. */
  isSeen(key: string, value: unknown): boolean {
    return this.opts.same(this.seen(key), value);
  }
}
