import { useEffect, useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import {
  type EntryAnswer,
  type FormClient,
  readEntry,
  readTypeformSent,
} from "@/forms/checkinClient";
import { kuwaitDay, kuwaitTime } from "@/forms/formTime";
import { openForm } from "@/forms/OpenFormButton";
import { checkinFormLink } from "./onboardingCore";

/**
 * Where the 1-1 notes open (docs/forms/STAGE2-CONTRACT.md 8.4 and 8.6). One
 * registry value decides every entry point: while `cockpit_forms.provider`
 * of `checkin` is `typeform`, every entry's main action opens the Typeform
 * with the card ID (the record), and every client-success seat may also try
 * the cockpit's window as a shadow run; once it is `native`, every entry
 * opens the window. A failed read keeps the Typeform path: the record never
 * blocks.
 *
 * The Typeform response reaches the cockpit only through the 15-minute
 * syncs, so after an entry opens the Typeform, that client's nudges say so
 * for 30 minutes instead of inviting a second form, and Typeform itself is
 * asked first (checkin.typeformSent), because the CSM often fills it on a
 * phone or outside the cockpit.
 */

export type CheckinEntry = {
  ready: boolean;
  provider: "typeform" | "native" | null;
  native: boolean;
  mode: "live" | "shadow" | null;
  /** The record path: the Typeform until the cut-over, then the window. */
  open(taskId: string, lastCall?: string | null): void;
  /** The window as a shadow run, for every client-success seat while `mode` is shadow. */
  openShadow(taskId: string): void;
};

/** The main button's title after a failed read (8.4). */
export const ENTRY_FAILED =
  "The cockpit could not read where 1-1 notes go, so this opens the Typeform.";

const STALE_MS = 5 * 60_000;

type Slot = {
  client: FormClient | null;
  seat: string;
  read: EntryAnswer | null;
  failed: boolean;
  at: number;
  busy: boolean;
};

let slot: Slot | null = null;
const entryListeners = new Set<() => void>();
const emitEntry = () => {
  for (const l of entryListeners) l();
};

function readInto(client: FormClient | null, seat: string) {
  const mine: Slot = {
    client,
    seat,
    read: slot?.client === client && slot.seat === seat ? slot.read : null,
    failed: false,
    at: Date.now(),
    busy: true,
  };
  slot = mine;
  emitEntry();
  if (!client) {
    slot = { ...mine, busy: false, failed: true };
    emitEntry();
    return;
  }
  readEntry(client, "checkin").then(
    read => {
      if (slot?.client !== client || slot.seat !== seat) return;
      slot = { ...slot, read, failed: false, busy: false, at: Date.now() };
      emitEntry();
    },
    () => {
      if (slot?.client !== client || slot.seat !== seat) return;
      slot = { ...slot, read: null, failed: true, busy: false, at: Date.now() };
      emitEntry();
    },
  );
}

/**
 * For the harness and tests: answer the entry rule without a read, as the
 * server would for this client and seat.
 */
export function primeCheckinEntry(
  read: EntryAnswer | null,
  client: FormClient | null = null,
  seat = "",
): void {
  slot = { client, seat, read, failed: !read, at: Date.now(), busy: false };
  emitEntry();
}

/** For the harness: what Typeform says for one client's last call. */
export function primeTypeformSent(
  taskId: string,
  lastCall: string | null,
  sent: boolean | null,
  at: string | null,
): void {
  const since = sinceOf(lastCall);
  if (!since) return;
  sentCache.set(sentKey(taskId, since), { sent, at, checkedAt: Date.now() });
  emitSent();
}

/** For tests and a seat change: forget the entry read and the Typeform answers. */
export function forgetFormsRegistry(): void {
  slot = null;
  sentCache.clear();
  queued.clear();
  asking.clear();
  emitEntry();
  emitSent();
}

/**
 * The entry rule for the 1-1 notes: cockpit_form_entry('checkin'), read
 * once per page load and again on focus after five minutes.
 */
export function useCheckinEntry(): CheckinEntry {
  const auth = useCockpitAuth();
  const client = auth.client as FormClient | null;
  const seat = auth.session?.user.id ?? "";
  const s = useSyncExternalStore(
    fn => {
      entryListeners.add(fn);
      return () => entryListeners.delete(fn);
    },
    () => slot,
    () => slot,
  );
  useEffect(() => {
    if (!slot || slot.client !== client || slot.seat !== seat)
      readInto(client, seat);
    const onFocus = () => {
      if (slot && !slot.busy && Date.now() - slot.at > STALE_MS)
        readInto(client, seat);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [client, seat]);
  const mine = s && s.client === client && s.seat === seat ? s : null;
  const read = mine?.read ?? null;
  const provider =
    read?.provider === "native" || read?.provider === "typeform"
      ? read.provider
      : null;
  return useMemo(
    () => ({
      ready: Boolean(mine && !mine.busy) || Boolean(read),
      provider,
      native: read?.native ?? false,
      mode: read?.mode ?? null,
      open: (taskId: string, lastCall?: string | null) => {
        if (provider === "native") void openForm(taskId, "checkin");
        else openTypeform(client, taskId, lastCall ?? null);
      },
      openShadow: (taskId: string) => void openForm(taskId, "checkin"),
    }),
    [mine, read, provider, client],
  );
}

/** The entry read failed: the button opens the Typeform and its title says why. */
export const entryFailed = (e: CheckinEntry) => e.ready && e.provider === null;

// ------------------------------------------------------------ the browser marker

const OPENED_KEY = "mahara-checkin-typeform-opened";
const OPENED_MS = 30 * 60_000;
type Opened = { taskId: string; lastCall: string | null; openedAt: string };

const openedListeners = new Set<() => void>();
let openedVersion = 0;
const emitOpened = () => {
  openedVersion += 1;
  for (const l of openedListeners) l();
};

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The entries still fresh; older ones are dropped. Throws when storage does. */
function readOpened(now: number): Opened[] {
  const s = storage();
  if (!s) return [];
  const raw = s.getItem(OPENED_KEY);
  const list: unknown = raw ? JSON.parse(raw) : [];
  const all = Array.isArray(list) ? (list as Opened[]) : [];
  const fresh = all.filter(
    o =>
      o &&
      typeof o.taskId === "string" &&
      typeof o.openedAt === "string" &&
      now - Date.parse(o.openedAt) < OPENED_MS &&
      Date.parse(o.openedAt) <= now + 60_000,
  );
  if (fresh.length !== all.length) {
    if (fresh.length) s.setItem(OPENED_KEY, JSON.stringify(fresh));
    else s.removeItem(OPENED_KEY);
  }
  return fresh;
}

/** This browser opened the client's 1-1 form for its last call. */
export function markTypeformOpened(
  taskId: string,
  lastCall?: string | null,
  now = Date.now(),
): void {
  try {
    const s = storage();
    if (!s) return;
    const list = readOpened(now).filter(o => o.taskId !== taskId);
    list.push({
      taskId,
      lastCall: lastCall ?? null,
      openedAt: new Date(now).toISOString(),
    });
    s.setItem(OPENED_KEY, JSON.stringify(list));
  } catch {
    // The nudge shows the button, as before.
  }
  emitOpened();
}

/**
 * One call, however it is written: the store's last call, a booking's start
 * or the recording's start are the same call on the same Kuwait day. A
 * marker without a call matches any.
 */
const sameCall = (a?: string | null, b?: string | null) =>
  !a || !b || kuwaitDay(sinceOf(a)) === kuwaitDay(sinceOf(b));

/** When this browser opened the client's 1-1 form for this call, in the last 30 minutes. */
export function typeformOpenedAt(
  taskId: string,
  lastCall?: string | null,
  now = Date.now(),
): string | null {
  try {
    const hit = readOpened(now).find(
      o => o.taskId === taskId && sameCall(o.lastCall, lastCall),
    );
    return hit?.openedAt ?? null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ Typeform asked first

type Sent = { sent: boolean | null; at: string | null; checkedAt: number };
const SENT_MS = 60_000;
const sentCache = new Map<string, Sent>();
const sentListeners = new Set<() => void>();
let sentVersion = 0;
const emitSent = () => {
  sentVersion += 1;
  for (const l of sentListeners) l();
};
const sentKey = (taskId: string, since: string) => `${taskId}|${since}`;

/** The start of the client's last call, as checkin.typeformSent's `since`. */
export function sinceOf(lastCall?: string | null): string | null {
  const v = String(lastCall ?? "").trim();
  if (!v) return null;
  const ms = Date.parse(
    /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00+03:00` : v,
  );
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Asks Typeform for up to six clients at once; an unreadable answer is `null`, never false. */
export async function askTypeformSent(
  client: FormClient | null,
  items: { taskId: string; since: string }[],
): Promise<void> {
  if (!client || !items.length) return;
  for (let i = 0; i < items.length; i += 6) {
    const chunk = items.slice(i, i + 6);
    try {
      const out = await readTypeformSent(client, chunk);
      for (const it of chunk) {
        const hit = out.items.find(x => x.taskId === it.taskId);
        sentCache.set(sentKey(it.taskId, it.since), {
          sent: hit ? hit.sent : null,
          at: hit?.at ?? null,
          checkedAt: Date.now(),
        });
      }
    } catch {
      for (const it of chunk)
        sentCache.set(sentKey(it.taskId, it.since), {
          sent: null,
          at: null,
          checkedAt: Date.now(),
        });
    }
  }
  emitSent();
}

/**
 * Every nudge on a page asks in the same moment: they are gathered for a
 * beat and asked six at a time, and an item already on its way is not
 * asked again.
 */
const queued = new Map<string, { taskId: string; since: string }>();
const asking = new Set<string>();
let queueClient: FormClient | null = null;
let queueTimer: ReturnType<typeof setTimeout> | null = null;
function queueTypeformSent(
  client: FormClient | null,
  items: { taskId: string; since: string }[],
) {
  if (!client) return;
  if (queueClient && queueClient !== client) queued.clear();
  queueClient = client;
  for (const i of items) {
    const k = sentKey(i.taskId, i.since);
    if (!asking.has(k)) queued.set(k, i);
  }
  if (queueTimer || !queued.size) return;
  queueTimer = setTimeout(() => {
    queueTimer = null;
    const batch = [...queued.entries()];
    queued.clear();
    for (const [k] of batch) asking.add(k);
    void askTypeformSent(
      queueClient,
      batch.map(([, i]) => i),
    ).finally(() => {
      for (const [k] of batch) asking.delete(k);
    });
  }, 30);
}

function sentFor(taskId: string, since: string | null): Sent | null {
  return since ? (sentCache.get(sentKey(taskId, since)) ?? null) : null;
}

/**
 * checkin.typeformSent for the nudged clients: asked on render (at most six
 * at once, each answer kept a minute) and again on a click before the
 * Typeform opens.
 */
export function useTypeformSent(
  items: { taskId: string; since: string | null }[],
): Record<string, { sent: boolean | null; at: string | null } | undefined> {
  const auth = useCockpitAuth();
  const client = auth.client as FormClient | null;
  const version = useSyncExternalStore(
    fn => {
      sentListeners.add(fn);
      return () => sentListeners.delete(fn);
    },
    () => sentVersion,
    () => sentVersion,
  );
  const key = items.map(i => `${i.taskId}|${i.since ?? ""}`).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key stands for the items
  useEffect(() => {
    const due = items.filter(
      (i): i is { taskId: string; since: string } =>
        Boolean(i.since) &&
        !(
          sentCache.has(sentKey(i.taskId, i.since as string)) &&
          Date.now() -
            (sentCache.get(sentKey(i.taskId, i.since as string))?.checkedAt ??
              0) <
            SENT_MS
        ),
    );
    if (due.length) queueTypeformSent(client, due);
  }, [key, client]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: version marks a new answer
  return useMemo(() => {
    const out: Record<
      string,
      { sent: boolean | null; at: string | null } | undefined
    > = {};
    for (const i of items) {
      const hit = sentFor(i.taskId, i.since);
      if (hit) out[i.taskId] = { sent: hit.sent, at: hit.at };
    }
    return out;
  }, [key, version]);
}

// ------------------------------------------------------------ the nudges

export type Nudge =
  | { kind: "button" }
  | { kind: "opened"; at: string; line: string }
  | { kind: "sent"; at: string; line: string };

export const openedLine = (at: string) =>
  `1-1 form opened at ${kuwaitTime(at)}. It leaves this list when the notes arrive, up to 15 minutes.`;
export const sentLine = (at: string) =>
  `1-1 form sent at ${kuwaitTime(at)}. It reaches the cockpit at the next sync.`;

/**
 * What a client's nudge shows: the form sent (Typeform says so), opened in
 * this browser in the last 30 minutes, or the button.
 */
export function nudgeFor(
  taskId: string,
  lastCall: string | null | undefined,
  sent: { sent: boolean | null; at: string | null } | undefined,
  now = Date.now(),
): Nudge {
  if (sent?.sent === true) {
    const at = sent.at ?? new Date(now).toISOString();
    return { kind: "sent", at, line: sentLine(at) };
  }
  const opened = typeformOpenedAt(taskId, lastCall, now);
  if (opened) return { kind: "opened", at: opened, line: openedLine(opened) };
  return { kind: "button" };
}

/**
 * The 1-1 notes are filled in the cockpit: the registry's provider is
 * `native`. Not the entry answer's `native` flag, which says the cockpit
 * has a window for this form and is true for `checkin` from the seed
 * (cockpit_form_entry, 20261027f_forms_core.sql:1343), so it cannot key
 * anything that must stay dark until the switch-over
 * (docs/forms/STAGE2B-CONTRACT.md 1.4, "follow the registry").
 */
export const notesNative = (e: Pick<CheckinEntry, "provider">) =>
  e.provider === "native";

/**
 * The nudges of several clients, kept fresh as markers age and answers come.
 * Once the 1-1 notes are native (docs/forms/STAGE2B-CONTRACT.md 4.15 item 2)
 * Typeform is asked nothing and a marker means nothing: every nudge is the
 * button, and the button opens the cockpit's window.
 */
export function useCheckinNudges(
  items: { taskId: string; lastCall?: string | null }[],
): Record<string, Nudge> {
  const entry = useCheckinEntry();
  const native = notesNative(entry);
  // Asked once the entry has answered (or failed, which keeps the Typeform
  // path): a native registry asks Typeform nothing.
  const sent = useTypeformSent(
    entry.ready && !native
      ? items.map(i => ({ taskId: i.taskId, since: sinceOf(i.lastCall) }))
      : [],
  );
  const tick = useSyncExternalStore(
    fn => {
      openedListeners.add(fn);
      // Another window of this browser (the notes window) marked it.
      const onStorage = (e: StorageEvent) => {
        if (e.key === OPENED_KEY || e.key === null) emitOpened();
      };
      window.addEventListener("storage", onStorage);
      // A marker ages out on its own: look again every minute.
      const t = window.setInterval(emitOpened, 60_000);
      return () => {
        openedListeners.delete(fn);
        window.removeEventListener("storage", onStorage);
        window.clearInterval(t);
      };
    },
    () => openedVersion,
    () => openedVersion,
  );
  const key = items.map(i => `${i.taskId}|${i.lastCall ?? ""}`).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key stands for the items
  return useMemo(() => {
    const out: Record<string, Nudge> = {};
    for (const i of items)
      out[i.taskId] = native
        ? { kind: "button" }
        : nudgeFor(i.taskId, i.lastCall, sent[i.taskId]);
    return out;
  }, [key, sent, tick, native]);
}

// ------------------------------------------------------------ the Typeform path

/**
 * Opens the client's 1-1 form in Typeform, unless Typeform says it was
 * already sent for this call. The tab is opened on the click itself, so no
 * popup blocker stops it, and is sent to the form once Typeform answers.
 */
export function openTypeform(
  client: FormClient | null,
  taskId: string,
  lastCall: string | null,
): void {
  const url = checkinFormLink(taskId);
  const since = sinceOf(lastCall);
  const known = sentFor(taskId, since);
  if (known?.sent === true && Date.now() - known.checkedAt < SENT_MS) {
    toast(sentLine(known.at ?? new Date().toISOString()));
    return;
  }
  if (!client || !since) {
    window.open(url, "_blank", "noopener,noreferrer");
    markTypeformOpened(taskId, lastCall);
    return;
  }
  const tab = window.open("about:blank", "_blank");
  try {
    if (tab) tab.opener = null;
  } catch {
    // Another browser's rules; the form still opens.
  }
  const go = () => {
    if (tab) tab.location.replace(url);
    else window.location.assign(url);
    markTypeformOpened(taskId, lastCall);
  };
  askTypeformSent(client, [{ taskId, since }]).then(() => {
    const now = sentFor(taskId, since);
    if (now?.sent === true) {
      tab?.close();
      toast(sentLine(now.at ?? new Date().toISOString()));
      return;
    }
    go();
  }, go);
}
