import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import type { LaunchPipeline } from "./launchModel";
export async function readLaunch(
  client: SupabaseClient,
  id?: string,
): Promise<LaunchPipeline> {
  const { data, error } = await client.rpc("cockpit_launch_pipeline", {
    p_clickup_id: id ?? null,
  });
  if (error) throw Error(error.message);
  if (!data || !Array.isArray(data.clients))
    throw Error("The launch list did not return client records.");
  return data;
}
export function useLaunch(id?: string, enabled = true) {
  const { client } = useCockpitAuth();
  const [data, setData] = useState<LaunchPipeline | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion(v => v + 1), []);
  useEffect(() => {
    if (!enabled || !client) {
      setLoading(false);
      return;
    }
    let ignore = false;
    setLoading(true);
    setError("");
    setData(null);
    readLaunch(client, id)
      .then(d => {
        if (!ignore) setData(d);
      })
      .catch(e => {
        if (!ignore) setError(e.message);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [client, id, enabled, version]);
  return { data, error, loading, refresh, client };
}
function canonical(v: any): string {
  return JSON.stringify(
    v && typeof v === "object"
      ? Array.isArray(v)
        ? v.map(x => JSON.parse(canonical(x)))
        : Object.fromEntries(
            Object.keys(v)
              .sort()
              .map(k => [k, JSON.parse(canonical(v[k]))]),
          )
      : (v ?? null),
  );
}
export async function launchOperation(
  client: SupabaseClient,
  operation: string,
  args: Record<string, unknown>,
  apply = false,
) {
  const session = apply ? await client.auth.getSession() : null;
  const key = `launch-intent:${session?.data.session?.user.id ?? "read"}:${canonical([operation, args])}`;
  let requestId: string | undefined;
  if (apply) {
    requestId = localStorage.getItem(key) ?? crypto.randomUUID();
    localStorage.setItem(key, requestId);
  }
  const { data, error } = await client.functions.invoke("cockpit-media-api", {
    body: { operation, args, apply, requestId },
  });
  if (error) {
    let detail: any;
    try {
      detail = await (error.context as Response)?.json();
    } catch {}
    throw Error(detail?.error ?? error.message);
  }
  if (data?.ok === false && !data?.dryRun)
    throw Error(data.error ?? "The account could not be checked.");
  if (data?.ok === true || data?.dryRun) localStorage.removeItem(key);
  return data;
}
