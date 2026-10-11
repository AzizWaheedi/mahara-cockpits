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

type Load<T> = {
  key: string | null;
  data: T | null;
  loading: boolean;
  error: string | null;
};
const idle = <T>(): Load<T> => ({
  key: null,
  data: null,
  loading: false,
  error: null,
});

/** The overview and compare numbers for one scope. */
export function useSummary(
  client: SupabaseClient | null,
  actor: string | null,
  scope: Scope,
) {
  const { location, days } = scope;
  const key = actor ? `${actor}|${location ?? "all"}|${days}` : null;
  const [state, setState] = useState<Load<Summary>>(idle);
  const generation = useRef(0);
  const refetch = useCallback(async () => {
    if (!client || !actor || !key) return;
    const request = ++generation.current;
    setState(prior => ({
      key,
      data: prior.key === key ? prior.data : null,
      loading: true,
      error: null,
    }));
    try {
      const data = await fetchSummary(client, actor, { location, days });
      if (generation.current === request)
        setState({ key, data, loading: false, error: null });
    } catch (error) {
      if (generation.current === request)
        setState({
          key,
          data: null,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
    }
  }, [client, actor, key, location, days]);
  useEffect(() => {
    void refetch();
  }, [refetch]);
  return { ...(state.key === key ? state : idle<Summary>()), refetch };
}

type RowsState = {
  key: string | null;
  rows: (LeadRow | ApptRow)[];
  total: number | null;
  next: string | null;
  loading: boolean;
  error: string | null;
};

const EMPTY_ROWS: RowsState = {
  key: null,
  rows: [],
  total: null,
  next: null,
  loading: false,
  error: null,
};

/** One table's rows, 150 at a time, newest first. */
export function useRows(
  client: SupabaseClient | null,
  actor: string | null,
  q: RowQuery | null,
) {
  const key =
    actor && q
      ? `${actor}|${q.kind}|${q.location ?? "all"}|${q.days}|${q.filter}|${q.search.trim()}`
      : null;
  const [state, setState] = useState<RowsState>(EMPTY_ROWS);
  const generation = useRef(0);
  const query = useRef(q);
  query.current = q;

  const load = useCallback(
    async (cursor: string | null) => {
      const current = query.current;
      if (!client || !actor || !key || !current) return;
      const request = ++generation.current;
      setState(prior => ({
        ...(prior.key === key && cursor ? prior : { ...EMPTY_ROWS, key }),
        key,
        loading: true,
        error: null,
      }));
      try {
        const page = await fetchRows(client, actor, current, cursor);
        if (generation.current !== request) return;
        setState(prior => ({
          key,
          rows:
            cursor && prior.key === key
              ? [...prior.rows, ...page.rows]
              : page.rows,
          total: page.total,
          next: page.next_cursor,
          loading: false,
          error: null,
        }));
      } catch (error) {
        if (generation.current === request)
          setState(prior => ({
            ...prior,
            key,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          }));
      }
    },
    [client, actor, key],
  );
  useEffect(() => {
    void load(null);
  }, [load]);
  const shown = state.key === key ? state : { ...EMPTY_ROWS, loading: !!key };
  return {
    ...shown,
    loadMore: () => (state.next ? load(state.next) : undefined),
    refetch: () => load(null),
  };
}
