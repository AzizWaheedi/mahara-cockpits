/**
 * Creative Triage through PostgREST with the service key, for the client
 * messages sender (docs/forms/STAGE2B-CONTRACT.md 4.3, 3b). Three doors only:
 * the client message RPCs (names must match the outbox's), the provider
 * ledger (cockpit_csm_provider_health) and the health row (cockpit_sync_state).
 * Every message write is an RPC, so every write leaves its audit row.
 */
import type { InsertReceipt } from "./ledger.ts";

export const SUPABASE = "https://bldgtotkfmhoxmlzowdx.supabase.co";
export const RPC_NAME = /^cockpit_client_messages?_[a-z_]+$/;

export type Health = {
  key: string;
  ok: boolean;
  note: string;
  detail: Record<string, unknown>;
};
export type Db = {
  rpc: <T = any>(name: string, args?: Record<string, unknown>) => Promise<T>;
  receipt: InsertReceipt;
  health: (h: Health, now?: Date) => Promise<void>;
};

export class DbError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** The database door. SUPABASE_URL must be this project exactly; another project's never wins. */
export function makeDb(
  env: Record<string, string | undefined>,
  request: typeof fetch = fetch,
): Db {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing named key: SUPABASE_SERVICE_ROLE_KEY");
  const base = String(env.SUPABASE_URL ?? "").replace(/\/$/, "");
  if (base !== SUPABASE)
    throw new Error(
      "SUPABASE_URL must be the Creative Triage project (bldgtotkfmhoxmlzowdx).",
    );
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  async function call(
    path: string,
    body: unknown,
    prefer: string | null,
  ): Promise<any> {
    const res = await request(`${base}${path}`, {
      method: "POST",
      headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) {
      let message = `The database refused ${path.split("?")[0]} (${res.status}).`;
      try {
        const j = JSON.parse(text);
        if (typeof j?.message === "string" && j.message)
          message = j.message.slice(0, 240);
      } catch {}
      throw new DbError(message, res.status);
    }
    return text ? JSON.parse(text) : null;
  }
  return {
    rpc: async (name, args = {}) => {
      if (!RPC_NAME.test(name))
        throw new Error(
          "Only the client message RPCs are called from this worker.",
        );
      return call(`/rest/v1/rpc/${name}`, args, null);
    },
    receipt: async row => {
      await call("/rest/v1/cockpit_csm_provider_health", row, "return=minimal");
    },
    health: async (h, now = new Date()) => {
      const at = now.toISOString();
      await call(
        "/rest/v1/cockpit_sync_state?on_conflict=key",
        [
          {
            key: h.key,
            last_run_at: at,
            ...(h.ok ? { last_ok_at: at } : {}),
            ok: h.ok,
            note: h.note.slice(0, 500),
            detail: h.detail,
            updated_at: at,
          },
        ],
        "resolution=merge-duplicates,return=minimal",
      );
    },
  };
}
