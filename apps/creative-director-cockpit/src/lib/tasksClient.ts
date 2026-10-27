import type { SupabaseClient } from "@supabase/supabase-js";
import { useMemo, useSyncExternalStore } from "react";
import { useTaskSeat } from "@/lib/taskSeat";
import {
  type MyTasks,
  TASK_SENTENCES,
  type TaskAlerts,
  type TaskDetail,
  type TaskOp,
} from "@/lib/tasksCore";

/**
 * Reads and writes for Your tasks, the bell and the focus view
 * (docs/requests/CONTRACT.md 3.3, 5.4). The same file in all five cockpits.
 *
 * The card and the bell share one poll per tab: one read of both feeds on
 * mount, every two minutes while the tab is visible, and on focus or a
 * return to the tab, never twice within 30 seconds (the media buyer's
 * ClientAlerts pattern). A press of "Try again" reads at once.
 *
 * The poll belongs to one seat. It is kept per client, cockpit and signed-in
 * user, and it starts empty again once nothing on the page shows it (a
 * sign-out unmounts every card and bell), so the next seat on the same tab
 * never sees the last seat's tasks or alerts, and a read still on its way
 * when the seat changed is dropped (as useLaunchNotices resets per seat).
 */

export type TaskFeedState = {
  tasks: MyTasks | null;
  alerts: TaskAlerts | null;
  /** The sentence for each feed whose last read failed, else null. */
  error: { tasks: string | null; alerts: string | null };
  /** A read is in flight. */
  reading: boolean;
};

export type TaskFeed = TaskFeedState & {
  refresh(): void;
  /** Marks up to 200 of the seat's own alerts read; throws the sentence. */
  markRead(ids: string[]): Promise<void>;
};

const POLL_MS = 120_000;
const MIN_GAP_MS = 30_000;

const EMPTY: TaskFeedState = {
  tasks: null,
  alerts: null,
  error: { tasks: null, alerts: null },
  reading: false,
};

/** A call that answers or throws; a synchronous throw becomes a rejection. */
async function call(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await Promise.resolve().then(() =>
    client.rpc(name, args),
  );
  if (error) throw new Error(error.message || "The read failed");
  return data;
}

class FeedStore {
  state: TaskFeedState = EMPTY;
  private listeners = new Set<() => void>();
  private busy = false;
  private last = 0;
  /** Moves on at every stop: an answer from before it is never shown. */
  private generation = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  private client: SupabaseClient;
  private cockpit: string;
  readonly seat: string;

  constructor(client: SupabaseClient, cockpit: string, seat: string) {
    this.client = client;
    this.cockpit = cockpit;
    this.seat = seat;
  }

  get = (): TaskFeedState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  };

  private set(next: Partial<TaskFeedState>) {
    this.state = { ...this.state, ...next };
    for (const l of this.listeners) l();
  }

  private onWake = () => void this.read();

  private start() {
    void this.read();
    this.timer = setInterval(this.onWake, POLL_MS);
    window.addEventListener("focus", this.onWake);
    document.addEventListener("visibilitychange", this.onWake);
  }

  /**
   * Nothing on the page shows the feed any more (a sign-out, or the last
   * card and bell gone): the poll stops and forgets what it read, so the
   * next mount reads afresh and never paints an earlier seat's rows. A read
   * still out is left to finish and then dropped; the next one may start.
   */
  private stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener("focus", this.onWake);
    document.removeEventListener("visibilitychange", this.onWake);
    this.generation += 1;
    this.busy = false;
    this.last = 0;
    this.state = EMPTY;
    forgetCanLink(this.client);
  }

  async read(force = false): Promise<void> {
    if (this.busy) return;
    if (!force) {
      if (document.visibilityState === "hidden") return;
      if (Date.now() - this.last < MIN_GAP_MS) return;
    }
    const generation = this.generation;
    this.busy = true;
    this.last = Date.now();
    this.set({ reading: true });
    const args = { p_cockpit: this.cockpit };
    const [tasks, alerts] = await Promise.allSettled([
      call(this.client, "cockpit_my_tasks", args),
      call(this.client, "cockpit_task_alerts", args),
    ]);
    // Read before a sign-out or for another seat: never shown.
    if (generation !== this.generation) return;
    const okTasks =
      tasks.status === "fulfilled" &&
      Array.isArray((tasks.value as MyTasks | null)?.tasks);
    const okAlerts =
      alerts.status === "fulfilled" &&
      Array.isArray((alerts.value as TaskAlerts | null)?.alerts);
    this.busy = false;
    // A failed read keeps the last good one on screen and says so.
    this.set({
      reading: false,
      tasks: okTasks
        ? ((tasks as PromiseFulfilledResult<unknown>).value as MyTasks)
        : this.state.tasks,
      alerts: okAlerts
        ? ((alerts as PromiseFulfilledResult<unknown>).value as TaskAlerts)
        : this.state.alerts,
      error: {
        tasks: okTasks ? null : TASK_SENTENCES.notRead,
        alerts: okAlerts ? null : TASK_SENTENCES.bellNotRead,
      },
    });
  }

  async markRead(ids: string[]): Promise<void> {
    const some = [...new Set(ids)].slice(0, 200);
    if (!some.length) return;
    const generation = this.generation;
    try {
      await call(this.client, "cockpit_task_alerts_seen", { p_ids: some });
    } catch {
      throw new Error(TASK_SENTENCES.readNotSaved);
    }
    const alerts = this.state.alerts;
    if (!alerts || generation !== this.generation) return;
    const marked = new Set(some);
    const rows = alerts.alerts.map(a =>
      marked.has(a.id) ? { ...a, read: true } : a,
    );
    this.set({
      alerts: {
        ...alerts,
        alerts: rows,
        unread: Math.max(
          0,
          alerts.unread -
            alerts.alerts.filter(a => !a.read && marked.has(a.id)).length,
        ),
      },
    });
  }
}

const stores = new WeakMap<SupabaseClient, Map<string, FeedStore>>();

/**
 * The one poll for this client, cockpit and signed-in user. Another user on
 * the same client and cockpit gets a store of its own; the earlier seat's
 * store is dropped from the map (it empties itself once its last card or
 * bell unmounts), so nothing of it is ever handed to the next seat.
 */
function storeFor(
  client: SupabaseClient,
  cockpit: string,
  seat: string,
): FeedStore {
  let byCockpit = stores.get(client);
  if (!byCockpit) {
    byCockpit = new Map();
    stores.set(client, byCockpit);
  }
  let store = byCockpit.get(cockpit);
  if (!store || store.seat !== seat) {
    store = new FeedStore(client, cockpit, seat);
    byCockpit.set(cockpit, store);
  }
  return store;
}

const noSubscribe = () => () => {};
const noState = () => EMPTY;

/** Your tasks and your alerts, from one shared poll per tab and seat. */
export function useTaskFeed(): TaskFeed {
  const seat = useTaskSeat();
  const store =
    seat.client && seat.signedIn
      ? storeFor(seat.client, seat.cockpit, seat.seatId ?? "")
      : null;
  const state = useSyncExternalStore(
    store ? store.subscribe : noSubscribe,
    store ? store.get : noState,
    noState,
  );
  return useMemo(
    () => ({
      ...state,
      refresh: () => void store?.read(true),
      markRead: (ids: string[]) =>
        store ? store.markRead(ids) : Promise.resolve(),
    }),
    [state, store],
  );
}

const canLink = new WeakMap<
  SupabaseClient,
  { seat: string; answer: Promise<boolean> }
>();

/** A sign-out forgets the answer, so the next seat asks for its own. */
function forgetCanLink(client: SupabaseClient) {
  canLink.delete(client);
}

/**
 * Whether this seat may link seats to ClickUp users: the forms editor gate,
 * as cockpit_task_alert_rules_read answers it (canEditOthers). Read once per
 * seat on a tab, and only when a card has to say "not linked"; another seat
 * on the same tab reads its own.
 */
export function readCanLinkSeats(
  client: SupabaseClient,
  seat: string | null = null,
): Promise<boolean> {
  const key = seat ?? "";
  const known = canLink.get(client);
  if (known && known.seat === key) return known.answer;
  const answer = call(client, "cockpit_task_alert_rules_read", {})
    .then(
      d => (d as { canEditOthers?: unknown } | null)?.canEditOthers === true,
    )
    .catch(() => false);
  canLink.set(client, { seat: key, answer });
  return answer;
}

/** The sentence an Edge Function answered with, or the fallback. */
async function invokeSentence(error: unknown, fallback: string) {
  const context = (error as { context?: unknown } | null)?.context;
  if (context && typeof (context as Response).text === "function") {
    try {
      const text = await (context as Response).text();
      try {
        const body = JSON.parse(text) as Record<string, unknown>;
        const said = [body.error, body.message, body.note].find(
          v => typeof v === "string" && v.trim(),
        );
        if (typeof said === "string") return said;
      } catch {
        if (text.trim() && text.length < 300) return text.trim();
      }
    } catch {
      // The body was already read or never came: the fallback says it.
    }
  }
  return fallback;
}

/**
 * One task for the focus view, through cockpit-tasks (the seat's own sign-in
 * decides, in the database). `refresh` reads ClickUp again now.
 */
export async function readTaskDetail(
  client: SupabaseClient,
  taskId: string,
  refresh: boolean,
): Promise<TaskDetail> {
  let answer: { data: unknown; error: unknown };
  try {
    answer = await client.functions.invoke("cockpit-tasks", {
      body: { op: "detail", taskId, refresh },
    });
  } catch {
    throw new Error(TASK_SENTENCES.notOpened);
  }
  if (answer.error)
    throw new Error(
      await invokeSentence(answer.error, TASK_SENTENCES.notOpened),
    );
  const data = answer.data as Partial<TaskDetail> & { error?: unknown };
  if (!data?.task || typeof data.task !== "object")
    throw new Error(
      typeof data?.error === "string" && data.error.trim()
        ? data.error
        : TASK_SENTENCES.notOpened,
    );
  return data as TaskDetail;
}

export type TaskActResult = {
  id: string;
  state: string;
  reused: boolean;
  /** The id this press sent; the detail's action row carries one of the two. */
  actionId: string;
};

/** A tick, comment or Mark done, queued for ClickUp; throws the sentence. */
export async function actOnTask(
  client: SupabaseClient,
  action: { taskId: string; op: TaskOp; payload: Record<string, unknown> },
): Promise<TaskActResult> {
  const actionId = crypto.randomUUID();
  let data: unknown;
  try {
    data = await call(client, "cockpit_task_act", {
      p_action_id: actionId,
      p_task_id: action.taskId,
      p_op: action.op,
      p_payload: action.payload,
    });
  } catch (err) {
    throw new Error((err as Error).message || TASK_SENTENCES.notSent);
  }
  const answer = (data ?? {}) as Partial<TaskActResult>;
  return {
    id: String(answer.id ?? actionId),
    state: String(answer.state ?? "queued"),
    reused: Boolean(answer.reused),
    actionId,
  };
}

/** The address with the focus view opened on a task, or closed (null). */
export function focusSearch(search: string, taskId: string | null): string {
  const params = new URLSearchParams(search);
  if (taskId) params.set("focus", taskId);
  else params.delete("focus");
  const next = params.toString();
  return next ? `?${next}` : "";
}
