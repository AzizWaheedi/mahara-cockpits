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
  private timer: ReturnType<typeof setInterval> | null = null;

  private client: SupabaseClient;
  private cockpit: string;

  constructor(client: SupabaseClient, cockpit: string) {
    this.client = client;
    this.cockpit = cockpit;
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

  private stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener("focus", this.onWake);
    document.removeEventListener("visibilitychange", this.onWake);
  }

  async read(force = false): Promise<void> {
    if (this.busy) return;
    if (!force) {
      if (document.visibilityState === "hidden") return;
      if (Date.now() - this.last < MIN_GAP_MS) return;
    }
    this.busy = true;
    this.last = Date.now();
    this.set({ reading: true });
    const args = { p_cockpit: this.cockpit };
    const [tasks, alerts] = await Promise.allSettled([
      call(this.client, "cockpit_my_tasks", args),
      call(this.client, "cockpit_task_alerts", args),
    ]);
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
    try {
      await call(this.client, "cockpit_task_alerts_seen", { p_ids: some });
    } catch {
      throw new Error(TASK_SENTENCES.readNotSaved);
    }
    const alerts = this.state.alerts;
    if (!alerts) return;
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

function storeFor(client: SupabaseClient, cockpit: string): FeedStore {
  let byCockpit = stores.get(client);
  if (!byCockpit) {
    byCockpit = new Map();
    stores.set(client, byCockpit);
  }
  let store = byCockpit.get(cockpit);
  if (!store) {
    store = new FeedStore(client, cockpit);
    byCockpit.set(cockpit, store);
  }
  return store;
}

const noSubscribe = () => () => {};
const noState = () => EMPTY;

/** Your tasks and your alerts, from one shared poll per tab. */
export function useTaskFeed(): TaskFeed {
  const seat = useTaskSeat();
  const store =
    seat.client && seat.signedIn ? storeFor(seat.client, seat.cockpit) : null;
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

const canLink = new WeakMap<SupabaseClient, Promise<boolean>>();

/**
 * Whether this seat may link seats to ClickUp users: the forms editor gate,
 * as cockpit_task_alert_rules_read answers it (canEditOthers). Read once per
 * tab, and only when a card has to say "not linked".
 */
export function readCanLinkSeats(client: SupabaseClient): Promise<boolean> {
  let answer = canLink.get(client);
  if (!answer) {
    answer = call(client, "cockpit_task_alert_rules_read", {})
      .then(
        d => (d as { canEditOthers?: unknown } | null)?.canEditOthers === true,
      )
      .catch(() => false);
    canLink.set(client, answer);
  }
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
