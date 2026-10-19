import type { Overrides } from "./deckData";
import type { DeckKind, SavedPrep } from "./sources";

/**
 * Prep: what the CSM sets up or types live for one client's deck, saved to
 * cockpit_csm_deck_prep through cockpit_csm_deck_prep_save (gated, merged,
 * audited). Typed fields save 600 ms after the last key (DESIGN 16.4), so a
 * slide change mid-sentence loses nothing; a null removes a key. The keys
 * are the server's allow-list: anything else is refused before it is sent.
 */

const TEXT = [
  "service_focus",
  "page_name",
  "project",
  "engineer",
  "selling_point",
  "thank_you",
];
const TWINS = [
  ...TEXT,
  "goals",
  "red_lines",
  "services",
  "budget_band",
  "gate_notes",
];
export const PREP_KEYS: ReadonlySet<string> = new Set([
  ...TEXT,
  "starter_pack",
  "welcome_video",
  "booking_video",
  "call_guide_checked",
  "dwy_os_approved",
  "dialect",
  "language",
  "service_model",
  "pain",
  "go_live",
  "goals",
  "budget_band",
  "gate_notes",
  "access",
  "red_lines",
  "services",
  "dos_donts_hidden",
  "platforms_planned",
  "hidden_slides",
  "shown_slides",
  "form_questions",
  "their_pick",
  "cover_creative",
  "phones",
  "meta_ad_text",
  "form_confirmed",
  "creative_agreed_at",
  "onboarding_presented_at",
  ...TWINS.map(k => `${k}_ar`),
]);

const STAMPS = new Set(["creative_agreed_at", "onboarding_presented_at"]);
const LISTS =
  /^(red_lines|services|dos_donts_hidden|platforms_planned|hidden_slides|shown_slides)(_ar)?$/;

/** A key the server would refuse, said plainly; null when it is kept. */
export function refusedKey(key: string): string | null {
  return PREP_KEYS.has(key) ? null : `Prep does not keep "${key}".`;
}

/**
 * The overrides after a patch, as the server merges it: top-level keys
 * replaced whole, null (or a blank text) removes, lists deduplicated, a
 * stamp keeps its first time.
 */
export function applyPatch(
  overrides: Overrides,
  patch: Overrides,
  now: () => string = () => new Date().toISOString(),
): Overrides {
  const out: Overrides = { ...overrides };
  for (const [k, raw] of Object.entries(patch)) {
    let v = raw;
    if (typeof v === "string" && !v.trim()) v = null;
    if (Array.isArray(v) && LISTS.test(k)) {
      const seen: unknown[] = [];
      for (const x of v)
        if (!(typeof x === "string" && !x.trim()) && !seen.includes(x))
          seen.push(x);
      v = seen.length ? seen : null;
    }
    if (STAMPS.has(k)) {
      if (v === null || v === false) {
        delete out[k];
        continue;
      }
      if (out[k]) continue;
      out[k] = now();
      continue;
    }
    if (v === null || v === undefined) delete out[k];
    else out[k] = v;
  }
  return out;
}

export interface SaverOptions {
  save: (patch: Overrides) => Promise<SavedPrep>;
  onSaved: (row: SavedPrep, sent: Overrides) => void;
  onError: (message: string, sent: Overrides) => void;
  delay?: number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

/**
 * Collects patches and sends them as one save after a pause. One save is in
 * flight at a time; what arrives meanwhile goes in the next one.
 */
export class PrepSaver {
  private pending: Overrides = {};
  private timer: unknown = null;
  private flight: Promise<void> | null = null;
  private readonly delay: number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  private readonly opts: SaverOptions;

  constructor(opts: SaverOptions) {
    this.opts = opts;
    this.delay = opts.delay ?? 600;
    this.schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel =
      opts.cancel ?? (h => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** What is waiting to be sent. */
  get waiting(): Overrides {
    return { ...this.pending };
  }

  /** Queue a patch; `now` sends at once (a tick, a button), else after the pause. */
  set(patch: Overrides, now = false): string | null {
    for (const k of Object.keys(patch)) {
      const refused = refusedKey(k);
      if (refused) return refused;
    }
    Object.assign(this.pending, patch);
    if (this.timer != null) this.cancel(this.timer);
    this.timer = null;
    if (now) void this.flush();
    else
      this.timer = this.schedule(() => {
        this.timer = null;
        void this.flush();
      }, this.delay);
    return null;
  }

  /** Send what is waiting now. Resolves once it (and anything before it) is sent. */
  async flush(): Promise<void> {
    if (this.timer != null) {
      this.cancel(this.timer);
      this.timer = null;
    }
    while (this.flight) await this.flight;
    const sent = this.pending;
    if (!Object.keys(sent).length) return;
    this.pending = {};
    this.flight = (async () => {
      try {
        const row = await this.opts.save(sent);
        this.opts.onSaved(row, sent);
      } catch (e) {
        // Put it back unless something newer replaced it, so a retry sends it.
        for (const [k, v] of Object.entries(sent))
          if (!(k in this.pending)) this.pending[k] = v;
        this.opts.onError(e instanceof Error ? e.message : String(e), sent);
      } finally {
        this.flight = null;
      }
    })();
    await this.flight;
  }
}

/** The two decks' prep, as the server last confirmed it. */
export type PrepRows = Record<
  DeckKind,
  { overrides: Overrides; revision: number }
>;
