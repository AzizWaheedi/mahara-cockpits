"use node";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";

declare const process: { env: Record<string, string | undefined> };

/**
 * Deploy and schedule the cockpit's Supabase Edge Functions through the
 * Supabase management API, with the management token this deployment
 * already holds for read-only SQL (convex/ceo/migrate.ts). No CLI on this
 * machine, so this is the one door. Every call is run by hand from the
 * command line; nothing here is scheduled or reachable from a screen.
 *
 * Secrets never leave the action: the cron secret is minted inside the
 * database vault, read once here, and pushed to the function's secrets in
 * the same call. It is not returned and not logged.
 */

const API = "https://api.supabase.com/v1/projects";

function token(): string {
  const t = process.env.SUPABASE_ACCESS_TOKEN;
  if (!t)
    throw new Error("SUPABASE_ACCESS_TOKEN is not set on this deployment");
  return t;
}

async function api(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${API}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token()}`, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`Supabase management ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** Run SQL on a project through the management API (the same door applySql uses). */
async function query(
  ref: string,
  sql: string,
): Promise<Record<string, unknown>[]> {
  const out = await api(`${ref}/database/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  return Array.isArray(out) ? (out as Record<string, unknown>[]) : [];
}

/** The functions a project has, names and versions only. */
export const list = internalAction({
  args: { ref: v.string() },
  returns: v.any(),
  handler: async (_ctx, { ref }) => {
    const out = (await api(`${ref}/functions`)) as {
      slug: string;
      version: number;
      status: string;
      verify_jwt: boolean;
      updated_at: number;
    }[];
    return out.map(f => ({
      slug: f.slug,
      version: f.version,
      status: f.status,
      verifyJwt: f.verify_jwt,
      updatedAt: f.updated_at,
    }));
  },
});

/**
 * Set up tap-charges-sync on a project: deploy the function from the source
 * passed in, mint the cron secret in the vault, give the function that
 * secret, and schedule the pg_cron job every 15 minutes.
 */
export const setupTapSync = internalAction({
  args: {
    ref: v.string(),
    source: v.string(),
    schedule: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (_ctx, { ref, source, schedule }) => {
    const slug = "tap-charges-sync";
    // 1. Deploy the function (multipart: metadata + the one file).
    const form = new FormData();
    form.append(
      "metadata",
      JSON.stringify({
        entrypoint_path: "index.ts",
        name: slug,
        verify_jwt: false,
      }),
    );
    form.append(
      "file",
      new Blob([source], { type: "application/typescript" }),
      "index.ts",
    );
    const deployed = (await api(`${ref}/functions/deploy?slug=${slug}`, {
      method: "POST",
      body: form,
    })) as { version?: number; status?: string; id?: string };

    // 2. The cron secret: minted once in the vault, then pushed to the function.
    await query(
      ref,
      `select vault.create_secret(encode(gen_random_bytes(24), 'hex'), 'cockpit_sync_secret', 'Shared secret the pg_cron jobs send to the cockpit''s Edge Functions')
       where not exists (select 1 from vault.secrets where name = 'cockpit_sync_secret')`,
    );
    const rows = await query(
      ref,
      `select decrypted_secret as s from vault.decrypted_secrets where name = 'cockpit_sync_secret' limit 1`,
    );
    const secret = String(rows[0]?.s ?? "");
    if (!secret) throw new Error("the cron secret could not be minted");
    await api(`${ref}/secrets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ name: "CRON_SECRET", value: secret }]),
    });

    // 3. The schedule: every 15 minutes, the secret read from the vault at run time.
    const every = schedule ?? "*/15 * * * *";
    const job = `select net.http_post(
    url := 'https://${ref}.supabase.co/functions/v1/${slug}',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cockpit_sync_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );`;
    await query(
      ref,
      `select cron.unschedule(jobid) from cron.job where jobname = 'mahara-tap-charges-sync'`,
    );
    await query(
      ref,
      `select cron.schedule('mahara-tap-charges-sync', '${every}', $job$${job}$job$)`,
    );
    return {
      deployed: {
        version: deployed?.version ?? null,
        status: deployed?.status ?? null,
      },
      cronSecret: "set on the function, never returned",
      schedule: every,
      note: "Add TAP_SECRET_KEY under Edge Functions, Secrets, in the Supabase dashboard; the job then fills cockpit_tap_charges within 15 minutes.",
    };
  },
});

/** Run the function once now, through the same door the cron job uses, and return its answer. */
export const runTapSyncNow = internalAction({
  args: { ref: v.string() },
  returns: v.any(),
  handler: async (_ctx, { ref }) => {
    const rows = await query(
      ref,
      `select net.http_post(
         url := 'https://${ref}.supabase.co/functions/v1/tap-charges-sync',
         headers := jsonb_build_object('Content-Type', 'application/json',
           'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cockpit_sync_secret')),
         body := '{}'::jsonb, timeout_milliseconds := 120000) as request_id`,
    );
    return {
      requestId: rows[0]?.request_id ?? null,
      note: "the answer lands in cockpit_sync_state within a minute",
    };
  },
});
