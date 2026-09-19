import { useCallback, useEffect, useState } from "react";
import { STILLS_BUCKET, supabase } from "./supabase";
import type { Asset, Client, EditorPerson, Job, Note, Version, WorkRequest } from "./types";

/** One shape for every read: what came back, whether it is still loading, and
 * why it failed. A screen that cannot say "this failed" lies quietly. */
export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

function useQuery<T>(
  run: () => PromiseLike<{ data: T | null; error: { message: string } | null }>,
  deps: unknown[],
): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  // The caller owns the deps, and `tick` belongs among them: bumping it is
  // what makes reload() run the query again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are the caller's
  const fetcher = useCallback(run, [...deps, tick]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.resolve(fetcher()).then(({ data: rows, error: err }) => {
      if (!alive) return;
      setError(err ? err.message : null);
      setData(rows ?? null);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [fetcher]);

  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}

export function useJobs(): Loaded<Job[]> {
  return useQuery<Job[]>(
    () =>
      supabase
        .from("editor_jobs")
        .select("*")
        .order("due_at", { ascending: true, nullsFirst: false }),
    [],
  );
}

export function useJob(taskId: string): Loaded<Job> {
  return useQuery<Job>(
    () => supabase.from("editor_jobs").select("*").eq("task_id", taskId).maybeSingle(),
    [taskId],
  );
}

export function useClient(clientTaskId: string | null | undefined): Loaded<Client> {
  return useQuery<Client>(
    () =>
      clientTaskId
        ? supabase.from("editor_clients").select("*").eq("task_id", clientTaskId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    [clientTaskId],
  );
}

export function useAssets(taskId: string): Loaded<Asset[]> {
  return useQuery<Asset[]>(
    () =>
      supabase
        .from("editor_assets")
        .select("*")
        .eq("task_id", taskId)
        .order("at", { ascending: true }),
    [taskId],
  );
}

export function useVersions(taskId: string): Loaded<Version[]> {
  return useQuery<Version[]>(
    () =>
      supabase
        .from("editor_versions")
        .select("*")
        .eq("task_id", taskId)
        .order("n", { ascending: false }),
    [taskId],
  );
}

export function useNotes(taskId: string): Loaded<Note[]> {
  return useQuery<Note[]>(
    () =>
      supabase
        .from("editor_notes")
        .select("*")
        .eq("task_id", taskId)
        .order("at", { ascending: false }),
    [taskId],
  );
}

export function useRequests(taskId: string): Loaded<WorkRequest[]> {
  return useQuery<WorkRequest[]>(
    () =>
      supabase
        .from("editor_requests")
        .select("*")
        .eq("task_id", taskId)
        .order("created_at", { ascending: false })
        .limit(12),
    [taskId],
  );
}

/**
 * May this session open the desk at all?
 *
 * This asks `is_editor()`, which is the very function every row policy calls,
 * rather than looking for a row and guessing. An admin with no seat row still
 * gets in, because the function says so, and the screen can never disagree
 * with the database about who is allowed.
 *
 * A refused request is not the same as a "no". On 2026-09-19 four accounts
 * made by another project carried a Postgres role that does not exist, so
 * every request came back 401, and a screen that read that as "no seat" told
 * the owner of the place he had not been invited. So an error leaves `data`
 * null and travels in `error`, and the caller has to tell them apart.
 */
export function useCanOpen(email: string | null): Loaded<boolean> {
  return useQuery<boolean>(
    () =>
      email
        ? (supabase.rpc("is_editor").then(({ data, error }) => ({
            data: error ? null : data === true,
            error,
          })) as PromiseLike<{ data: boolean | null; error: { message: string } | null }>)
        : Promise.resolve({ data: null, error: null }),
    [email],
  );
}

export function useMe(email: string | null): Loaded<EditorPerson> {
  return useQuery<EditorPerson>(
    () =>
      email
        ? supabase.from("editor_people").select("*").ilike("email", email).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    [email],
  );
}

/** Storyboard frames live in a private bucket, so each one needs its own signed link. */
export function useStills(paths: (string | null)[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = paths.filter(Boolean).join("|");

  useEffect(() => {
    const wanted = key ? key.split("|") : [];
    if (!wanted.length) return;
    let alive = true;
    supabase.storage
      .from(STILLS_BUCKET)
      .createSignedUrls(wanted, 3600)
      .then(({ data }) => {
        if (!alive || !data) return;
        const next: Record<string, string> = {};
        for (const row of data) {
          if (row.path && row.signedUrl) next[row.path] = row.signedUrl;
        }
        setUrls(next);
      });
    return () => {
      alive = false;
    };
  }, [key]);

  return urls;
}

/** Ask the worker for something that needs a key the browser must never hold. */
export async function askFor(
  kind: WorkRequest["kind"],
  taskId: string,
  input: string,
  by: { email: string; name: string },
  params: Record<string, unknown> = {},
): Promise<string | null> {
  const id = `${kind}:${taskId}:${Date.now()}`;
  const { error } = await supabase.from("editor_requests").insert({
    id,
    kind,
    task_id: taskId,
    input,
    params,
    status: "queued",
    requested_by: by.email,
    requested_by_name: by.name,
  });
  return error ? error.message : null;
}

export async function addNote(
  taskId: string,
  text: string,
  by: { email: string; name: string },
  atSec: number | null = null,
): Promise<string | null> {
  const { error } = await supabase.from("editor_notes").insert({
    id: `cockpit:${taskId}:${Date.now()}`,
    task_id: taskId,
    text,
    at_sec: atSec,
    by_email: by.email,
    by_name: by.name,
    source: "cockpit",
    done: false,
    at: new Date().toISOString(),
  });
  return error ? error.message : null;
}

export async function markNoteDone(id: string, done: boolean): Promise<string | null> {
  const { error } = await supabase.from("editor_notes").update({ done }).eq("id", id);
  return error ? error.message : null;
}
