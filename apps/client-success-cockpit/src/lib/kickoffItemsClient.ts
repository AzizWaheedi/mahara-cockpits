import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type DueRead,
  type ItemRow,
  type ItemsRead,
  readDue,
  readItemRow,
  readItems,
} from "./kickoffItems";
import { callRequests, RequestError } from "./requestsClient";

/**
 * The five browser RPCs of kickoff items (WAVE56-CONTRACT.md 4.20), through
 * callRequests: a refusal arrives as the server's own sentence, PostgREST's
 * "no such function" (the migration not applied yet) as a RequestError with
 * code PGRST202 or 42883, which the screens turn into one plain line.
 */

export type RaiseAnswer = {
  raised: boolean;
  reused: boolean;
  /** An open request of the type is already on the card: nothing was written. */
  alreadyOpen: boolean;
  item: ItemRow | null;
  submit: {
    id: string | null;
    state: string | null;
    held: boolean;
    note: string | null;
  } | null;
};

export type KickoffItemsApi = {
  read(taskId: string): Promise<ItemsRead>;
  /** Yes: requestId is kept for the press across retries, so a second press raises nothing twice. */
  raise(taskId: string, item: string, requestId: string): Promise<RaiseAnswer>;
  /** "Change it first" (the ticket form's request) or "Count it" (one already open). */
  link(
    taskId: string,
    item: string,
    requestId: string,
  ): Promise<{ linked: boolean; item: ItemRow | null }>;
  /** No, with an optional note (240 characters at most, trimmed on the server). */
  decline(
    taskId: string,
    item: string,
    note?: string | null,
  ): Promise<{ declined: boolean; item: ItemRow | null }>;
  /** Today's "Kickoff items to decide". */
  due(): Promise<DueRead>;
};

type Any = Record<string, unknown>;
const obj = (v: unknown): Any =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Any) : {};
const txt = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/** True when the error says the kickoff items functions are not on the database yet. */
export function itemsMissing(e: unknown): boolean {
  return (
    e instanceof RequestError && (e.code === "PGRST202" || e.code === "42883")
  );
}

export function kickoffItemsApi(client: SupabaseClient): KickoffItemsApi {
  return {
    read: async taskId =>
      readItems(
        await callRequests(client, "cockpit_kickoff_items_read", {
          p_task_id: taskId,
        }),
        taskId,
      ),
    raise: async (taskId, item, requestId) => {
      const d = obj(
        await callRequests(client, "cockpit_kickoff_item_raise", {
          p_task_id: taskId,
          p_item: item,
          p_request_id: requestId,
        }),
      );
      const s = d.submit ? obj(d.submit) : null;
      return {
        raised: d.raised === true,
        reused: d.reused === true,
        alreadyOpen: d.state === "already_open",
        item: readItemRow(d.item),
        submit: s
          ? {
              id: txt(s.id),
              state: txt(s.state),
              held: s.held === true,
              note: txt(s.note),
            }
          : null,
      };
    },
    link: async (taskId, item, requestId) => {
      const d = obj(
        await callRequests(client, "cockpit_kickoff_item_link", {
          p_task_id: taskId,
          p_item: item,
          p_request_id: requestId,
        }),
      );
      return { linked: d.linked === true, item: readItemRow(d.item) };
    },
    decline: async (taskId, item, note = null) => {
      const d = obj(
        await callRequests(client, "cockpit_kickoff_item_decline", {
          p_task_id: taskId,
          p_item: item,
          p_note: note?.trim() ? note.trim() : null,
        }),
      );
      return { declined: d.declined === true, item: readItemRow(d.item) };
    },
    due: async () =>
      readDue(await callRequests(client, "cockpit_kickoff_items_due")),
  };
}
