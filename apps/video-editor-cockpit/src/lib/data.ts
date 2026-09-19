import { useCallback, useEffect, useState } from "react";
import { STILLS_BUCKET, supabase } from "./supabase";
import type {
  Asset,
  Client,
  EditorPerson,
  Idea,
  Job,
  Note,
  SwipeAd,
  TeamMeeting,
  Version,
  WinnerAd,
  WorkRequest,
} from "./types";

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

/** Every file the desk has read, newest first, for the gallery. */
export function useAllAssets(limit = 300): Loaded<Asset[]> {
  return useQuery<Asset[]>(
    () => supabase.from("editor_assets").select("*").order("at", { ascending: false }).limit(limit),
    [limit],
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

/** The winning ads, cheapest cost per lead first: the ones worth copying. */
export function useWinners(): Loaded<WinnerAd[]> {
  return useQuery<WinnerAd[]>(
    () =>
      supabase
        .from("winner_ads")
        .select("*")
        .order("cpl", { ascending: true, nullsFirst: false })
        .limit(300),
    [],
  );
}

/** The ideation board, shared with the creative director. */
export function useIdeas(): Loaded<Idea[]> {
  return useQuery<Idea[]>(
    () =>
      supabase
        .from("ideation_posts")
        .select(
          "key,platform,url,status,author_handle,author_name,posted_at,views,likes,comments,caption,duration_sec,thumb_url,still_path,media_url,industry,multiplier,tier,format,hook,why_it_works,transcript,saved_by_name,saved_at,saved_note",
        )
        .in("status", ["proposed", "saved"])
        .order("multiplier", { ascending: false, nullsFirst: false })
        .limit(300),
    [],
  );
}

/**
 * Keep or release an idea. The same row the creative director sees, so a
 * save here is a save there: one board, not a copy each (Aziz, 2026-09-19).
 * Only these columns are writable from a browser; the scan's own numbers are
 * granted away at the column level in Postgres.
 */
export async function saveIdea(
  key: string,
  keep: boolean,
  by: { email: string; name: string },
): Promise<string | null> {
  const { error } = await supabase
    .from("ideation_posts")
    .update(
      keep
        ? {
            status: "saved",
            saved_by: by.email,
            saved_by_name: by.name,
            saved_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
        : { status: "proposed", updated_at: new Date().toISOString() },
    )
    .eq("key", key);
  return error ? error.message : null;
}

/** Has an end of day already been filed for this day, and did it land? */
export function useEodToday(day: string): Loaded<WorkRequest[]> {
  return useQuery<WorkRequest[]>(
    () =>
      supabase
        .from("editor_requests")
        .select("*")
        .eq("kind", "eod")
        .eq("task_id", `eod:${day}`)
        .order("created_at", { ascending: false })
        .limit(1),
    [day],
  );
}

/** Team meetings. A row policy decides which ones: the ones you were on. */
export function useMeetings(): Loaded<TeamMeeting[]> {
  return useQuery<TeamMeeting[]>(
    () =>
      supabase
        .from("team_meetings")
        .select("*")
        .order("started_at", { ascending: false, nullsFirst: false })
        .limit(60),
    [],
  );
}

/** The Foreplay swipe file, longest-running first. */
export function useSwipe(): Loaded<SwipeAd[]> {
  return useQuery<SwipeAd[]>(
    () =>
      supabase
        .from("foreplay_ads")
        .select("*")
        .order("running_duration", { ascending: false, nullsFirst: false })
        .limit(300),
    [],
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

/** Frames live in private buckets, so each one needs its own signed link. */
export function useStills(
  paths: (string | null)[],
  bucket: string = STILLS_BUCKET,
): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = paths.filter(Boolean).join("|");

  useEffect(() => {
    const wanted = key ? key.split("|") : [];
    if (!wanted.length) return;
    let alive = true;
    supabase.storage
      .from(bucket)
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
  }, [key, bucket]);

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
