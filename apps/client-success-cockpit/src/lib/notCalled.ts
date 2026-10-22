import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { z } from "zod";
import { fetchMorning, type Morning } from "./resultsReads";

/**
 * Leads not called, per client, on the Today rows (Muhammed, 22 October 2026): leads from the last 30
 * days with no call and no saved result, the "Never called" group of the dialer's Lead coverage list.
 * The number comes from cockpit_morning_uncalled_read, the same SQL the dialer reads, limited to this
 * seat's clients. Clients who call their own leads are not on that list, so their rows show nothing.
 * The rows are ClickUp tasks and the list is CRM locations: cockpit_client_callers holds the link.
 */
export type NotCalledByTask = Map<string, number>;

const LinksSchema = z.object({
  clients: z.array(
    z.object({
      taskId: z.string().nullable().optional(),
      locationId: z.string(),
    }),
  ),
});

/** Never-called leads by ClickUp task id; a task with several CRM locations adds them up. */
export function notCalledByTask(
  links: unknown,
  morning: Pick<Morning, "clients">,
): NotCalledByTask {
  const parsed = LinksSchema.safeParse(links);
  const out: NotCalledByTask = new Map();
  if (!parsed.success) return out;
  const byLocation = new Map(
    morning.clients.map(c => [c.locationId, c.neverCalled]),
  );
  const seen = new Set<string>();
  for (const link of parsed.data.clients) {
    const task = link.taskId?.trim();
    const n = byLocation.get(link.locationId);
    if (!task || n === undefined || seen.has(`${task}|${link.locationId}`))
      continue;
    seen.add(`${task}|${link.locationId}`);
    out.set(task, (out.get(task) ?? 0) + n);
  }
  return out;
}

const reads = new Map<string, Promise<NotCalledByTask>>();

/** Read once per seat and session; a failed read is forgotten so the next page load tries again. */
export function readNotCalled(
  client: SupabaseClient,
  actor: string,
): Promise<NotCalledByTask> {
  const hit = reads.get(actor);
  if (hit) return hit;
  const promise = (async () => {
    const [links, morning] = await Promise.all([
      client.rpc("cockpit_client_callers").then(({ data, error }) => {
        if (error) throw error;
        return data;
      }),
      fetchMorning(null),
    ]);
    return notCalledByTask(links, morning);
  })();
  reads.set(actor, promise);
  promise.catch(() => {
    if (reads.get(actor) === promise) reads.delete(actor);
  });
  return promise;
}

/** undefined while reading or after a failed read: the rows then show no count rather than a wrong one. */
export function useNotCalled(
  client: SupabaseClient | null,
  actor: string,
): NotCalledByTask | undefined {
  const [state, setState] = useState<NotCalledByTask>();
  useEffect(() => {
    if (!client || !actor) return;
    let live = true;
    readNotCalled(client, actor).then(
      map => {
        if (live) setState(map);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [client, actor]);
  return state;
}
