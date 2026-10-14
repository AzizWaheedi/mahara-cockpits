import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

/**
 * Lead sync: are this client's Facebook leads reaching the CRM?
 *
 * Written every 15 minutes by hermes/lead-sync-watch into
 * public.cockpit_lead_sync_status (RLS: CEO, admins, and the media buyers
 * allowed on the client). Meta's count is read straight from Meta; the CRM
 * count is the GoHighLevel sub-account's new contacts over the same window.
 * A count that could not be read shows "?", never 0.
 */

export type LeadSync = {
  client_key: string;
  client_name: string;
  state: "ok" | "gap" | "stalled" | "watch" | "quiet" | "unknown" | "unlinked";
  reason: string;
  meta_24h: number | null;
  crm_24h: number | null;
  crm_meta_24h: number | null;
  meta_6h: number | null;
  crm_6h: number | null;
  days: { day: string; meta: number | null; crm: number; crmMeta: number }[];
  crm_synced_at: string | null;
  gap_since: string | null;
  checked_at: string;
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const BAD = new Set(["gap", "stalled"]);

let cache: { at: number; rows: LeadSync[] } | null = null;
const listeners = new Set<(r: LeadSync[]) => void>();

async function load(force = false) {
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.rows;
  const { data, error } = await supabase
    .from("cockpit_lead_sync_status")
    .select(
      "client_key,client_name,state,reason,meta_24h,crm_24h,crm_meta_24h,meta_6h,crm_6h,days,crm_synced_at,gap_since,checked_at",
    );
  if (error) throw error;
  cache = { at: Date.now(), rows: (data ?? []) as LeadSync[] };
  for (const l of listeners) l(cache.rows);
  return cache.rows;
}

/** Every client's row this person may see; null while loading, [] on no access. */
export function useLeadSync(): LeadSync[] | null {
  const [rows, setRows] = useState<LeadSync[] | null>(cache?.rows ?? null);
  useEffect(() => {
    listeners.add(setRows);
    load().then(setRows, () => setRows([]));
    const t = setInterval(() => load(true).catch(() => {}), 5 * 60_000);
    return () => {
      listeners.delete(setRows);
      clearInterval(t);
    };
  }, []);
  return rows;
}

export function leadSyncFor(
  rows: LeadSync[] | null,
  client: string,
): LeadSync | undefined {
  if (!rows) return undefined;
  const k = norm(client);
  return rows.find(r => norm(r.client_name) === k);
}

const q = (n: number | null) => (n === null ? "?" : String(n));
const ago = (iso: string | null) => {
  if (!iso) return "";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 60
    ? `${m} min ago`
    : m < 48 * 60
      ? `${Math.round(m / 60)} h ago`
      : `${Math.round(m / 1440)} d ago`;
};

const TONE: Record<LeadSync["state"], { label: string; cls: string }> = {
  gap: {
    label: "Leads missing in CRM",
    cls: "bg-red-500/10 text-red-700 dark:text-red-300 ring-red-500/30",
  },
  stalled: {
    label: "CRM stopped receiving",
    cls: "bg-red-500/10 text-red-700 dark:text-red-300 ring-red-500/30",
  },
  watch: {
    label: "Watching",
    cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/30",
  },
  ok: {
    label: "In sync",
    cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30",
  },
  quiet: {
    label: "Too few leads to compare",
    cls: "bg-muted text-muted-foreground ring-border",
  },
  unknown: {
    label: "Could not check",
    cls: "bg-muted text-muted-foreground ring-border",
  },
  unlinked: {
    label: "No CRM linked",
    cls: "bg-muted text-muted-foreground ring-border",
  },
};

/** The small red badge beside a client's name on the board. Nothing unless something is wrong. */
export function LeadSyncBadge({ client }: { client: string }) {
  const r = leadSyncFor(useLeadSync(), client);
  if (!r || !BAD.has(r.state)) return null;
  return (
    <span
      className="ml-2 inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 align-middle text-[11px] font-medium text-red-700 ring-1 ring-red-500/30 dark:text-red-300"
      title={r.reason}
    >
      <TriangleAlert className="size-3" aria-hidden />
      CRM {q(r.crm_24h)} / Meta {q(r.meta_24h)}
    </span>
  );
}

/** The full panel on a client's page. */
export function LeadSyncPanel({ client }: { client: string }) {
  const rows = useLeadSync();
  const r = leadSyncFor(rows, client);
  if (rows === null) return null;
  if (!r) return null;
  const tone = TONE[r.state];
  return (
    <section
      className="rounded-2xl border bg-card p-4 sm:p-5"
      aria-label="Lead sync"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold">
            Lead sync: Facebook → CRM
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{r.reason}</p>
        </div>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-medium ring-1",
            tone.cls,
          )}
        >
          {tone.label}
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm tabular-nums sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Meta, 24h</dt>
          <dd className="text-lg font-semibold">{q(r.meta_24h)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">CRM, 24h</dt>
          <dd className="text-lg font-semibold">
            {q(r.crm_24h)}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              ({q(r.crm_meta_24h)} tagged Meta)
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Meta, 6h</dt>
          <dd className="text-lg font-semibold">{q(r.meta_6h)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">CRM, 6h</dt>
          <dd className="text-lg font-semibold">{q(r.crm_6h)}</dd>
        </div>
      </dl>
      {r.days?.length > 0 && (
        <table className="mt-4 w-full text-xs tabular-nums">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-normal">Day</th>
              <th className="py-1 text-right font-normal">Meta</th>
              <th className="py-1 text-right font-normal">CRM</th>
            </tr>
          </thead>
          <tbody>
            {r.days.map(d => {
              const short =
                d.meta !== null && d.meta >= 3 && d.crm <= d.meta * 0.7;
              return (
                <tr key={d.day} className="border-t">
                  <td className="py-1">{d.day}</td>
                  <td className="py-1 text-right">{q(d.meta)}</td>
                  <td
                    className={cn(
                      "py-1 text-right",
                      short && "font-semibold text-red-700 dark:text-red-300",
                    )}
                  >
                    {d.crm}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Checked {ago(r.checked_at)}. The cockpit's copy of the CRM was updated{" "}
        {ago(r.crm_synced_at) || "at an unknown time"}.
        {r.gap_since ? ` Gap first seen ${ago(r.gap_since)}.` : ""}
      </p>
    </section>
  );
}

/** One quiet line above the board; lists clients only when leads are going missing. */
export function LeadSyncStrip() {
  const rows = useLeadSync();
  const [open, setOpen] = useState(false);
  if (!rows?.length) return null;
  const bad = rows.filter(r => BAD.has(r.state));
  if (!bad.length) return null;
  return (
    <section className="rounded-2xl border border-red-500/30 bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm">
          <TriangleAlert className="size-4 text-red-600" aria-hidden />
          <span>
            <strong>{bad.length}</strong> client{bad.length === 1 ? "" : "s"}{" "}
            with Facebook leads not reaching the CRM.
          </span>
        </p>
        <button
          type="button"
          className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open && (
        <ul className="mt-3 divide-y text-sm">
          {bad.map(r => (
            <li key={r.client_key} className="py-2">
              <div className="font-medium" dir="auto">
                {r.client_name}{" "}
                <span className="font-normal tabular-nums text-muted-foreground">
                  · Meta {q(r.meta_24h)} / CRM {q(r.crm_24h)} in 24h
                </span>
              </div>
              <div className="text-xs text-muted-foreground">{r.reason}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The CEO's table: every client, worst first. */
export function LeadSyncTable() {
  const rows = useLeadSync();
  if (!rows?.length) return null;
  const order = [
    "stalled",
    "gap",
    "watch",
    "unknown",
    "unlinked",
    "ok",
    "quiet",
  ];
  const sorted = [...rows].sort(
    (a, b) =>
      order.indexOf(a.state) - order.indexOf(b.state) ||
      a.client_name.localeCompare(b.client_name),
  );
  const bad = rows.filter(r => BAD.has(r.state)).length;
  return (
    <section
      className="rounded-2xl border bg-card p-4 sm:p-5"
      aria-label="Lead sync"
    >
      <h3 className="text-[15px] font-semibold">Lead sync: Facebook → CRM</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {bad
          ? `${bad} client${bad === 1 ? "" : "s"} losing leads between Facebook and the CRM.`
          : "Every client with enough leads to compare is in sync."}{" "}
        Meta and CRM over the last 24 hours, checked every 15 minutes.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="py-1.5 text-left font-normal">Client</th>
              <th className="py-1.5 text-right font-normal">Meta 24h</th>
              <th className="py-1.5 text-right font-normal">CRM 24h</th>
              <th className="py-1.5 text-right font-normal">6h</th>
              <th className="py-1.5 pl-3 text-left font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.client_key} className="border-t" title={r.reason}>
                <td className="py-1.5" dir="auto">
                  {r.client_name}
                </td>
                <td className="py-1.5 text-right">{q(r.meta_24h)}</td>
                <td
                  className={cn(
                    "py-1.5 text-right",
                    BAD.has(r.state) &&
                      "font-semibold text-red-700 dark:text-red-300",
                  )}
                >
                  {q(r.crm_24h)}
                </td>
                <td className="py-1.5 text-right text-muted-foreground">
                  {q(r.meta_6h)}/{q(r.crm_6h)}
                </td>
                <td className="py-1.5 pl-3">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
                      TONE[r.state].cls,
                    )}
                  >
                    {TONE[r.state].label}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
