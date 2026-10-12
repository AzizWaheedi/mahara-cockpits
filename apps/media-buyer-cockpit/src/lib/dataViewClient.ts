import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  type ApptRow,
  apptRowSchema,
  type Kind,
  type LeadRow,
  leadRowSchema,
  type RecordData,
  recordSchema,
  rowsPageSchema,
  type Summary,
  summarySchema,
} from "./dataView";

/** Plain words for the errors the data view functions raise. */
function plainError(error: { code?: string; message: string }): string {
  if (error.code === "42501")
    return "Only admins can open the data view. Sign in with an admin account.";
  if (error.code === "57014")
    return "The database took too long. Choose a shorter range or one client.";
  return error.message;
}

/**
 * One RPC as the signed-in admin. The answer is dropped when the account
 * changed while it was in flight, the same rule as the Admin page.
 */
async function rpcAsActor<S extends z.ZodTypeAny>(
  client: SupabaseClient,
  expectedActor: string,
  fn: string,
  args: Record<string, unknown>,
  schema: S,
): Promise<z.infer<S>> {
  let changed = false;
  const subscription = client.auth.onAuthStateChange((_event, session) => {
    if (session?.user.id !== expectedActor) changed = true;
  }).data.subscription;
  try {
    const { data: actor, error: authError } = await client.auth.getUser();
    if (
      changed ||
      authError ||
      actor.user?.id !== expectedActor ||
      !actor.user.email_confirmed_at
    )
      throw new Error(
        "A current confirmed admin sign-in is required. Reload the page.",
      );
    const { data, error } = await client.rpc(fn, args);
    const { data: current, error: sessionError } =
      await client.auth.getSession();
    if (changed || sessionError || current.session?.user.id !== expectedActor)
      throw new Error("The account changed. The answer was discarded.");
    if (error) throw new Error(plainError(error));
    return schema.parse(data);
  } finally {
    subscription.unsubscribe();
  }
}

export type Scope = { location: string | null; days: number };
export type RowQuery = Scope & {
  kind: Kind;
  filter: string;
  search: string;
};

const exportSchema = z.object({
  kind: z.enum(["leads", "appointments"]),
  total: z.number(),
  rows: z.array(z.unknown()),
  truncated: z.boolean(),
});

const parseRows = (kind: Kind, rows: unknown[]) =>
  kind === "leads"
    ? rows.map(r => leadRowSchema.parse(r))
    : rows.map(r => apptRowSchema.parse(r));

export async function fetchSummary(
  client: SupabaseClient,
  actor: string,
  scope: Scope,
): Promise<Summary> {
  return rpcAsActor(
    client,
    actor,
    "cockpit_data_view_summary",
    { p_location: scope.location, p_days: scope.days },
    summarySchema,
  );
}

export async function fetchRows(
  client: SupabaseClient,
  actor: string,
  q: RowQuery,
  cursor: string | null,
) {
  const page = await rpcAsActor(
    client,
    actor,
    "cockpit_data_view_rows",
    {
      p_kind: q.kind,
      p_location: q.location,
      p_days: q.days,
      p_filter: q.filter,
      p_search: q.search.trim() || null,
      p_cursor: cursor,
      p_limit: 150,
    },
    rowsPageSchema,
  );
  return { ...page, rows: parseRows(q.kind, page.rows) };
}

export async function fetchRecord(
  client: SupabaseClient,
  actor: string,
  id: string,
): Promise<RecordData> {
  return rpcAsActor(
    client,
    actor,
    "cockpit_data_view_record",
    { p_id: id },
    recordSchema,
  );
}

export async function fetchExport(
  client: SupabaseClient,
  actor: string,
  q: RowQuery,
) {
  const page = await rpcAsActor(
    client,
    actor,
    "cockpit_data_view_export",
    {
      p_kind: q.kind,
      p_location: q.location,
      p_days: q.days,
      p_filter: q.filter,
      p_search: q.search.trim() || null,
    },
    exportSchema,
  );
  return { ...page, rows: parseRows(q.kind, page.rows) };
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Answers already fetched, newest use last. A tab, chip, client or range seen
 * before comes back at once, the way the cockpit's own tabs switch
 * (Muhammed, 2026-10-12: switching felt like "moving to another page"). Keys
 * start with the signed-in user, so one account never sees another's answers.
 */
const FRESH_MS = 60_000;
function recent<T>(limit: number) {
  const map = new Map<string, { value: T; at: number }>();
  return {
    get(key: string) {
      const hit = map.get(key);
      if (hit) {
        map.delete(key);
        map.set(key, hit);
      }
      return hit;
    },
    set(key: string, value: T) {
      map.delete(key);
      map.set(key, { value, at: Date.now() });
      for (const oldest of map.keys()) {
        if (map.size <= limit) break;
        map.delete(oldest);
      }
    },
  };
}

type SummaryState = {
  key: string | null;
  location: string | null;
  data: Summary | null;
  loading: boolean;
  error: string | null;
};
const NO_SUMMARY: SummaryState = {
  key: null,
  location: null,
  data: null,
  loading: false,
  error: null,
};
const summaries = recent<Summary>(12);
const summaryKey = (actor: string, scope: Scope) =>
  `${actor}|${scope.location ?? "all"}|${scope.days}`;

/**
 * The overview and compare numbers for one scope. While another client or
 * range loads, the last numbers stay on screen with `stale` set, instead of
 * the page going blank. `location` is the scope those numbers are for.
 */
export function useSummary(
  client: SupabaseClient | null,
  actor: string | null,
  scope: Scope,
) {
  const { location, days } = scope;
  const key = actor ? summaryKey(actor, { location, days }) : null;
  const [state, setState] = useState<SummaryState>(() => {
    const hit = key ? summaries.get(key) : undefined;
    return hit ? { ...NO_SUMMARY, key, location, data: hit.value } : NO_SUMMARY;
  });
  const generation = useRef(0);
  const load = useCallback(
    async (quiet: boolean) => {
      if (!client || !actor || !key) return;
      const request = ++generation.current;
      if (!quiet) setState(prior => ({ ...prior, loading: true, error: null }));
      try {
        const data = await fetchSummary(client, actor, { location, days });
        summaries.set(key, data);
        if (generation.current === request)
          setState({ key, location, data, loading: false, error: null });
      } catch (error) {
        if (generation.current === request)
          setState(prior => ({
            key,
            location,
            data: prior.key === key ? prior.data : null,
            loading: false,
            error: message(error),
          }));
      }
    },
    [client, actor, key, location, days],
  );
  useEffect(() => {
    if (!key) return;
    const hit = summaries.get(key);
    if (hit) {
      generation.current++;
      setState({ key, location, data: hit.value, loading: false, error: null });
      if (Date.now() - hit.at > FRESH_MS) void load(true);
      return;
    }
    void load(false);
  }, [key, location, load]);
  const current = state.key === key;
  return {
    data: state.data,
    location: state.location,
    loading: !!key && (!current || state.loading),
    stale: !current,
    error: current ? state.error : null,
    refetch: () => load(false),
  };
}

export type RowsState = {
  key: string | null;
  kind: Kind;
  rows: (LeadRow | ApptRow)[];
  total: number | null;
  next: string | null;
  loading: boolean;
  error: string | null;
};

const EMPTY_ROWS: RowsState = {
  key: null,
  kind: "leads",
  rows: [],
  total: null,
  next: null,
  loading: false,
  error: null,
};
const PAGE = 150;
const pages = recent<RowsState>(48);
const asking = new Map<string, Promise<RowsState>>();
const rowsKey = (actor: string, q: RowQuery) =>
  `${actor}|${q.kind}|${q.location ?? "all"}|${q.days}|${q.filter}|${q.search.trim()}`;

/**
 * The first page of one query. The table and the prefetch share it, so the
 * same question is never in flight twice.
 */
function firstPage(
  client: SupabaseClient,
  actor: string,
  q: RowQuery,
): Promise<RowsState> {
  const key = rowsKey(actor, q);
  const running = asking.get(key);
  if (running) return running;
  const answer = fetchRows(client, actor, q, null)
    .then(page => {
      const state: RowsState = {
        key,
        kind: q.kind,
        rows: page.rows,
        total: page.total,
        next: page.next_cursor,
        loading: false,
        error: null,
      };
      pages.set(key, state);
      return state;
    })
    .finally(() => asking.delete(key));
  asking.set(key, answer);
  return answer;
}

/**
 * First pages fetched before they are clicked, one at a time, skipping any
 * fetched in the last minute. A failure is left for the table: opening that
 * chip asks again and shows the error there.
 */
export async function prefetchRows(
  client: SupabaseClient,
  actor: string,
  queries: RowQuery[],
  cancelled: () => boolean,
) {
  for (const q of queries) {
    if (cancelled()) return;
    const hit = pages.get(rowsKey(actor, q));
    if (hit && Date.now() - hit.at <= FRESH_MS) continue;
    await firstPage(client, actor, q).catch(() => undefined);
  }
}

/**
 * One table's rows, 150 at a time, newest first. While another tab, chip or
 * range loads, the rows on screen stay with `stale` set instead of emptying,
 * so the page keeps its height and its scroll. `kind` is the table those
 * rows belong to.
 */
export function useRows(
  client: SupabaseClient | null,
  actor: string | null,
  q: RowQuery | null,
) {
  const key = actor && q ? rowsKey(actor, q) : null;
  const [state, setState] = useState<RowsState>(
    () => (key ? pages.get(key)?.value : undefined) ?? EMPTY_ROWS,
  );
  const generation = useRef(0);
  const query = useRef(q);
  query.current = q;

  const load = useCallback(
    async (quiet: boolean) => {
      const current = query.current;
      if (!client || !actor || !key || !current) return;
      const request = ++generation.current;
      if (!quiet) setState(prior => ({ ...prior, loading: true, error: null }));
      try {
        const page = await firstPage(client, actor, current);
        if (generation.current === request) setState(page);
      } catch (error) {
        if (generation.current === request)
          setState({
            ...EMPTY_ROWS,
            key,
            kind: current.kind,
            error: message(error),
          });
      }
    },
    [client, actor, key],
  );

  useEffect(() => {
    if (!key) return;
    const hit = pages.get(key);
    if (hit) {
      generation.current++;
      setState({ ...hit.value, loading: false, error: null });
      // Refreshed quietly after a minute, unless more pages were opened:
      // the refresh would fold them back to one page.
      if (Date.now() - hit.at > FRESH_MS && hit.value.rows.length <= PAGE)
        void load(true);
      return;
    }
    void load(false);
  }, [key, load]);

  const loadMore = async () => {
    const current = query.current;
    const cursor = state.key === key ? state.next : null;
    if (!client || !actor || !key || !current || !cursor) return;
    const request = ++generation.current;
    setState(prior => ({ ...prior, loading: true, error: null }));
    try {
      const page = await fetchRows(client, actor, current, cursor);
      if (generation.current !== request) return;
      setState(prior => {
        const next: RowsState = {
          ...prior,
          rows: [...prior.rows, ...page.rows],
          total: page.total,
          next: page.next_cursor,
          loading: false,
        };
        pages.set(key, next);
        return next;
      });
    } catch (error) {
      if (generation.current === request)
        setState(prior => ({
          ...prior,
          loading: false,
          error: message(error),
        }));
    }
  };

  const current = state.key === key;
  return {
    key: state.key,
    kind: state.kind,
    rows: state.rows,
    total: current ? state.total : null,
    next: current ? state.next : null,
    loading: !!key && (!current || state.loading),
    stale: !current,
    error: current ? state.error : null,
    loadMore,
    refetch: () => load(false),
  };
}
