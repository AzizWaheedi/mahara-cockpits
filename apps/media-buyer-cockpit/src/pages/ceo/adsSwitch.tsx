import { CircleCheck } from "lucide-react";
import { type ReactNode, useSyncExternalStore } from "react";
import { dateTime } from "@/components/ceo/format";
import { Switch } from "@/components/ui/switch";
import type { B2bAdsPayload } from "@/types/ceo/payloads";
import type { SourceStamp } from "@/types/ceo/types";

/**
 * The on and off switch on every row of the Ads tab, and what it remembers.
 *
 * The CEO, 2026-10-19: "Ads turning on and off in the CEO cockpit isn't
 * working." It was: Meta took every change and read it back. But the switch
 * drew its state from the published b2bAds section, which the worker
 * recomputes every 15 minutes, so after a change it went straight back to
 * the old state until the next refresh, and a second click looked like
 * nothing at all.
 *
 * Now a change Meta confirmed is held for that Meta object, in one store
 * every switch on the page reads (the funnel and the table, a campaign's
 * rows as they open and close), for an hour at most. What ends it early is
 * a payload that has read Meta since the change: its "B2B Meta ad
 * snapshots" stamp, the last sync of the snapshots it was built from, is
 * after the change. When the payload was published says nothing, because
 * the snapshot sync runs on its own 15-minute clock and the first refresh
 * after a change often reads snapshots taken before it.
 *
 * Since the same day the section reads on and off from Meta itself
 * (`statusFrom: "meta"`, hermes b2bAds.js), and says when (`statusReadAt`).
 * Then that read ends the hold: a payload that read Meta's status after the
 * change decides, turned on or off, whatever it says. The switch shows the
 * object's own setting (`switchOn`), the one it changes, not whether it
 * delivers: an ad switched on under a paused campaign is on, not running,
 * and says why. The stored payload is read again every refresh; a picked
 * range (windows.ts) is read once, so its switches follow the stored read
 * whenever that is the newer one (`newer`).
 *
 * When the section fell back to the snapshots (`statusFrom: "snapshots"`, or
 * a payload from before), the snapshot stamp ends it, as before:
 * Turned off: that payload is trusted, whatever it says.
 * Turned on: that payload has to show it on. An ad has no snapshot row until
 * it delivers, and the payload counts an ad as running only with delivery,
 * so an ad just switched on reads as off in every payload until it spends.
 * The switch keeps Meta's answer until then, or until the hour is up, and
 * the note says it shows as running once it delivers.
 *
 * The holds live in this tab's sessionStorage, so a reload inside the hour
 * still shows them. A refusal holds nothing: the switch stays where it was
 * and the server's sentence is shown.
 */

export type SwitchLevel = "campaign" | "adset" | "ad";

/** api.ceo.b2bControl.setStatus, passed in so the rule can be tested without the network. */
export type SetStatus = (args: {
  metaId: string;
  level: SwitchLevel;
  active: boolean;
  name: string;
}) => Promise<{ ok?: boolean; error?: string | null } | null | undefined>;

/** What a hold needs to know about the payload on screen. */
export type PayloadRead = {
  /**
   * When the payload on screen last read Meta (epoch ms): the last sync of
   * the B2B Meta ad snapshots it was built from, not when it was published.
   * Null when the section does not say.
   */
  readAt: number | null;
  /**
   * When the payload on screen read Meta's own on and off (epoch ms): its
   * `statusReadAt` when `statusFrom` is "meta". Null or absent when it fell
   * back to the snapshots; then `readAt` and the old rule decide.
   */
  statusReadAt?: number | null;
  /** The campaigns, ad sets and ads that payload shows on. */
  on: ReadonlySet<string>;
  /** The page's clock (epoch ms), ticking every 30 seconds. */
  now: number;
};

/** What the switches need to know about the payload on screen. */
export type SwitchClock = PayloadRead & {
  /** About when the next refresh lands (epoch ms); null when it is overdue or unknown. */
  refreshAt: number | null;
  /**
   * Where each switch sits in a newer read of Meta's own status than the
   * window on screen (the stored payload under a picked range), by Meta id.
   * A row it holds shows it; null or absent, each row's own.
   */
  newer?: ReadonlyMap<string, boolean> | null;
};

/** A change Meta confirmed. */
export type Held = {
  /** The state Meta confirmed: true is on. */
  on: boolean;
  /** When Meta confirmed it (epoch ms, this browser's clock). */
  at: number;
  /**
   * When the payload on screen at the time last read Meta: that read never
   * releases its own hold, even when this browser's clock runs behind the
   * server's.
   */
  seen: number | null;
};

/** The longest a change is held over the payload. */
export const HOLD_MS = 60 * 60_000;
/** How often the worker recomputes the section. */
export const REFRESH_EVERY_MS = 15 * 60_000;
/** The sessionStorage key, one per browser tab. */
export const HELD_KEY = "ceo-ads-switches";
/** The section's source stamp that says when it last read Meta's ad states. */
export const META_READ_SOURCE = "B2B Meta ad snapshots";

const LEVEL_WORD: Record<SwitchLevel, string> = {
  campaign: "campaign",
  adset: "ad set",
  ad: "ad",
};

// ---- the store --------------------------------------------------------------

type Store = {
  held: Readonly<Record<string, Held>>;
  /** Meta objects with a request in flight. */
  busy: Readonly<Record<string, true>>;
};

let store: Store | null = null;
const listeners = new Set<() => void>();

function session(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function load(): Record<string, Held> {
  try {
    const raw = session()?.getItem(HELD_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    const out: Record<string, Held> = {};
    if (parsed && typeof parsed === "object")
      for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
        const h = (v ?? {}) as Partial<Held>;
        if (
          typeof h.on === "boolean" &&
          typeof h.at === "number" &&
          Number.isFinite(h.at)
        )
          out[id] = {
            on: h.on,
            at: h.at,
            seen:
              typeof h.seen === "number" && Number.isFinite(h.seen)
                ? h.seen
                : null,
          };
      }
    return out;
  } catch {
    return {};
  }
}

function save(held: Record<string, Held>) {
  try {
    const s = session();
    if (!s) return;
    if (Object.keys(held).length) s.setItem(HELD_KEY, JSON.stringify(held));
    else s.removeItem(HELD_KEY);
  } catch {
    // Storage full or blocked: the holds still work for this page.
  }
}

function current(): Store {
  if (!store) store = { held: load(), busy: {} };
  return store;
}

function commit(next: Store, persist: boolean) {
  store = next;
  if (persist) save({ ...next.held });
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Every switch on the page reads the same holds. */
export function useSwitches(): Store {
  return useSyncExternalStore(subscribe, current, current);
}

/** The holds and the requests in flight, outside React. */
export function switchesNow(): Store {
  return current();
}

/** Remember a change Meta confirmed. */
export function holdSwitch(id: string, held: Held) {
  const s = current();
  commit({ ...s, held: { ...s.held, [id]: held } }, true);
}

function setBusy(id: string, busy: boolean) {
  const s = current();
  const next = { ...s.busy };
  if (busy) next[id] = true;
  else delete next[id];
  commit({ ...s, busy: next }, false);
}

/** Forget the holds a newer read of Meta or the hour has settled, so storage keeps only live ones. */
export function settleSwitches(c: PayloadRead) {
  const s = current();
  const kept: Record<string, Held> = {};
  for (const [id, h] of Object.entries(s.held))
    if (isHeld(id, h, c)) kept[id] = h;
  if (Object.keys(kept).length !== Object.keys(s.held).length)
    commit({ ...s, held: kept }, true);
}

/** Read sessionStorage again on the next look, as a reload would. For tests. */
export function reloadSwitches() {
  store = null;
  for (const l of listeners) l();
}

// ---- the payload -------------------------------------------------------------

/**
 * When a section last read Meta's ad states: its "B2B Meta ad snapshots"
 * stamp. Null when the stamp is missing, and then a change is held for the
 * hour, because nothing says the payload has seen it.
 */
export function metaReadAt(
  sources: readonly SourceStamp[] | null | undefined,
): number | null {
  const at = sources?.find(s => s.name === META_READ_SOURCE)?.freshestAt;
  return typeof at === "number" && Number.isFinite(at) && at > 0 ? at : null;
}

/**
 * When a payload read Meta's own on and off: its `statusReadAt`, only when
 * `statusFrom` says it came from Meta. Null on the snapshot fallback or an
 * older payload.
 */
export function liveStatusAt(
  p: Pick<B2bAdsPayload, "statusFrom" | "statusReadAt"> | null | undefined,
): number | null {
  const at = p?.statusFrom === "meta" ? p.statusReadAt : null;
  return typeof at === "number" && Number.isFinite(at) && at > 0 ? at : null;
}

/**
 * Where a row's switch sits: its own setting in Meta (`switchOn`, read live
 * since 2026-10-19), which is what the switch changes, else `running`.
 * Running (Meta's effective status) still counts what delivers.
 */
export function switchedOn(n: {
  running: boolean;
  switchOn?: boolean;
}): boolean {
  return typeof n.switchOn === "boolean" ? n.switchOn : n.running;
}

/**
 * Where every switch sits in the stored payload, for a window on screen
 * that read Meta's status before it. The stored payload holds the 7 and 30
 * days and reads Meta again every refresh; any other range is read once when
 * it is picked (windows.ts), so after a change its own rows go stale while
 * the stored read catches up. Status is account-wide, so the stored read
 * answers for every row it holds. Null when the window is the stored payload,
 * read Meta as late or later, or the stored payload fell back to the
 * snapshots.
 */
export function newerSwitches(
  stored: B2bAdsPayload | null | undefined,
  shown: B2bAdsPayload | null | undefined,
): ReadonlyMap<string, boolean> | null {
  const at = liveStatusAt(stored);
  if (!stored || at === null || !shown || shown === stored) return null;
  const shownAt = liveStatusAt(shown);
  if (shownAt !== null && shownAt >= at) return null;
  const out = new Map<string, boolean>();
  for (const c of stored.campaigns) {
    out.set(c.id, switchedOn(c));
    for (const s of c.adsets) {
      out.set(s.id, switchedOn(s));
      for (const a of s.ads) out.set(a.id, switchedOn(a));
    }
  }
  return out;
}

/**
 * Why a row whose own switch is on is not running, in Meta's words: an ad
 * set or ad under a paused parent, or a campaign Meta holds back. Null when
 * it runs, is off, or the payload does not know its own switch.
 */
export function onNotRunning(n: {
  running: boolean;
  switchOn?: boolean;
  status?: string;
}): string | null {
  if (n.switchOn !== true || n.running) return null;
  if (n.status === "CAMPAIGN_PAUSED")
    return "On, but its campaign is switched off in Meta, so it is not running.";
  if (n.status === "ADSET_PAUSED")
    return "On, but its ad set is switched off in Meta, so it is not running.";
  const said = (n.status ?? "").toLowerCase().replace(/_/g, " ").trim();
  return said
    ? `On, but not running: Meta says ${said}.`
    : "On, but Meta does not have it running.";
}

/** The campaigns, ad sets and ads a payload shows on. */
export function onIds(p: B2bAdsPayload | null | undefined): Set<string> {
  const on = new Set<string>();
  for (const c of p?.campaigns ?? []) {
    if (c.running) on.add(c.id);
    for (const s of c.adsets) {
      if (s.running) on.add(s.id);
      for (const a of s.ads) if (a.running) on.add(a.id);
    }
  }
  return on;
}

// ---- the rule ---------------------------------------------------------------

/** Whether the payload has read Meta since the change (and since the read on screen when it was made). */
export function readSince(h: Held, readAt: number | null): boolean {
  return readAt !== null && readAt > h.at && readAt > (h.seen ?? 0);
}

/**
 * Whether a confirmed change still outranks the payload. It does for an
 * hour at most, and until the payload has read Meta since the change. With
 * Meta's own status (`statusReadAt`), that read decides either way. On the
 * snapshot fallback, a change that turned something off gives way to the
 * payload, whatever it says; one that turned something on gives way once
 * the payload shows it on, because nothing reads as running before it
 * delivers.
 */
export function isHeld(
  id: string,
  h: Held | undefined,
  c: PayloadRead,
): h is Held {
  if (!h) return false;
  if (c.now - h.at >= HOLD_MS) return false;
  if (typeof c.statusReadAt === "number") return !readSince(h, c.statusReadAt);
  if (!readSince(h, c.readAt)) return true;
  return h.on && !c.on.has(id);
}

/** On or off as the row shows it: the held change, else the payload. */
export function shownOn(
  id: string,
  running: boolean,
  h: Held | undefined,
  c: PayloadRead,
): boolean {
  return isHeld(id, h, c) ? h.on : running;
}

/**
 * About when the next refresh lands: 15 minutes after the last run, rolled
 * on to the next 15 minutes when that has passed. Null when the last run is
 * unknown or older than `staleAfter`, because then any time would be a guess.
 */
export function nextRefreshAt(
  lastRun: number | null,
  now: number,
  staleAfter: number,
): number | null {
  if (lastRun === null || !(lastRun > 0) || now - lastRun > staleAfter)
    return null;
  const steps = Math.max(1, Math.floor((now - lastRun) / REFRESH_EVERY_MS) + 1);
  return lastRun + steps * REFRESH_EVERY_MS;
}

/** A run publishes a little after it starts: the page reads again this long after the refresh is due. */
export const REREAD_GRACE_MS = 2 * 60_000;
/** While a change is held and the payload has not caught up, the page reads again this often. */
export const REREAD_EVERY_MS = 5 * 60_000;

/**
 * How long to wait before the page reads the sections again while a change
 * is held: until just after the next refresh, and at least a minute.
 */
export function rereadDelay(lastRun: number | null, now: number): number {
  if (lastRun === null) return REREAD_EVERY_MS;
  return Math.max(60_000, lastRun + REFRESH_EVERY_MS + REREAD_GRACE_MS - now);
}

/** "Turned on" or "Turned off". */
export const heldWord = (on: boolean) => (on ? "Turned on" : "Turned off");

/**
 * What follows the word: Meta has it, and when the numbers catch up. Once a
 * payload has read Meta since a change that turned something on and still
 * shows it off, the wait is for delivery, not for a refresh.
 */
export function heldTail(h: Held, c: SwitchClock): string {
  if (h.on && typeof c.statusReadAt !== "number" && readSince(h, c.readAt))
    return "Meta has it now; it shows as running here once it delivers";
  return c.refreshAt === null
    ? "Meta has it now; the numbers catch up at the next refresh, which is late: the Machine tab says why"
    : `Meta has it now; the numbers catch up at the next refresh (about ${dateTime(c.refreshAt, c.now)})`;
}

/** "Turned on · Meta has it now; the numbers catch up at the next refresh (about 14:45)". */
export function heldSentence(h: Held, c: SwitchClock): string {
  return `${heldWord(h.on)} · ${heldTail(h, c)}`;
}

/**
 * Ask Meta to turn one object on or off. A second click on the same object
 * while the first is in flight is ignored (null). A change Meta confirmed is
 * held; a refusal, or a request that failed, holds nothing and returns the
 * server's sentence.
 */
export async function changeSwitch(o: {
  metaId: string;
  level: SwitchLevel;
  name: string;
  active: boolean;
  setStatus: SetStatus;
  /** When the payload on screen last read Meta. */
  seen: number | null;
  clock?: () => number;
}): Promise<{ ok: true } | { ok: false; error: string } | null> {
  if (current().busy[o.metaId]) return null;
  setBusy(o.metaId, true);
  try {
    const res = await o.setStatus({
      metaId: o.metaId,
      level: o.level,
      active: o.active,
      name: o.name,
    });
    if (res?.ok) {
      holdSwitch(o.metaId, {
        on: o.active,
        at: (o.clock ?? Date.now)(),
        seen: o.seen,
      });
      return { ok: true };
    }
    return { ok: false, error: res?.error ?? "Meta refused it." };
  } catch (err) {
    return {
      ok: false,
      error: String(err instanceof Error ? err.message : err).slice(0, 200),
    };
  } finally {
    setBusy(o.metaId, false);
  }
}

// ---- the pieces on screen ---------------------------------------------------

/**
 * The switch on a row: the held change while there is one, else the payload.
 * A confirmed change says so in the row's note, so `onDone` gets null and
 * clears any older sentence; a refusal hands it the server's sentence.
 */
export function RowSwitch({
  metaId,
  level,
  name,
  running,
  clock,
  setStatus,
  onDone,
}: {
  metaId: string;
  level: SwitchLevel;
  name: string;
  /** What the payload says: the row's own switch where it knows it (`switchedOn`). */
  running: boolean;
  clock: SwitchClock;
  setStatus: SetStatus;
  onDone: (m: string | null) => void;
}) {
  const s = useSwitches();
  const on = shownOn(
    metaId,
    clock.newer?.get(metaId) ?? running,
    s.held[metaId],
    clock,
  );
  return (
    <Switch
      checked={on}
      aria-label={`${on ? "Turn off" : "Turn on"} ${LEVEL_WORD[level]} ${name}`}
      disabled={s.busy[metaId] === true}
      onClick={e => e.stopPropagation()}
      onCheckedChange={async () => {
        const r = await changeSwitch({
          metaId,
          level,
          name,
          active: !on,
          setStatus,
          // The read on screen, by the clock that ends the hold.
          seen:
            typeof clock.statusReadAt === "number"
              ? clock.statusReadAt
              : clock.readAt,
        });
        if (!r) return;
        onDone(r.ok ? null : r.error);
      }}
      // 24px tall; the invisible margin makes it a 40px target on touch.
      className="relative after:absolute after:-inset-2 after:content-['']"
    />
  );
}

/** The held change for a row, in words, under its switch. Nothing when there is none. */
export function SwitchNote({
  metaId,
  clock,
}: {
  metaId: string;
  clock: SwitchClock;
}) {
  const s = useSwitches();
  const h = s.held[metaId];
  if (!isHeld(metaId, h, clock)) return null;
  return (
    <p className="flex items-start gap-1.5 rounded-md bg-[var(--ceo-emphasis-wash)] px-2 py-1 text-xs text-muted-foreground">
      <CircleCheck
        className="mt-px size-3.5 shrink-0"
        style={{ color: "var(--ceo-emphasis)" }}
        aria-hidden
      />
      <span className="min-w-0">
        <span className="font-medium text-foreground">{heldWord(h.on)}</span>
        {` · ${heldTail(h, clock)}`}
      </span>
    </p>
  );
}

/**
 * Under an ad set or campaign whose own switch is on but that is not
 * running, why (an ad says it in its verdict). Nothing while a change is
 * held, or when a newer read has the switch off.
 */
export function OnNotRunning({
  node,
  clock,
}: {
  node: { id: string; running: boolean; switchOn?: boolean; status?: string };
  clock: SwitchClock;
}) {
  const s = useSwitches();
  const text = onNotRunning(node);
  if (!text || clock.newer?.get(node.id) === false) return null;
  if (isHeld(node.id, s.held[node.id], clock)) return null;
  return <p className="text-xs text-muted-foreground">{text}</p>;
}

/**
 * What a row says about its state from the payload (a verdict chip, its
 * sentence), shown only while no confirmed change outranks the payload.
 */
export function UnlessHeld({
  metaId,
  clock,
  children,
}: {
  metaId: string;
  clock: PayloadRead;
  children: ReactNode;
}) {
  const s = useSwitches();
  return isHeld(metaId, s.held[metaId], clock) ? null : children;
}

/** The holds still live for this payload, for the account line. */
export function liveHolds(
  held: Readonly<Record<string, Held>>,
  c: PayloadRead,
): number {
  return Object.entries(held).filter(([id, h]) => isHeld(id, h, c)).length;
}

/** Whether a live hold turned something on: then "nothing running" is no longer true. */
export function anyTurnedOn(
  held: Readonly<Record<string, Held>>,
  c: PayloadRead,
): boolean {
  return Object.entries(held).some(([id, h]) => h.on && isHeld(id, h, c));
}
