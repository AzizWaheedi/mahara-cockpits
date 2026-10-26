import "@/components/ceo/ceo.css";
import { ChevronRight, CircleCheck, CircleDashed } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { EmptyState } from "@/components/ceo/EmptyState";
import { relative } from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatusChip, type StatusTone } from "@/components/ceo/StatusChip";
import { useNow } from "@/components/ceo/useCeo";
import { supabase } from "@/lib/supabase";

/**
 * Exception alerts: the clients whose numbers broke, on Today.
 *
 * Written every hour by hermes/exception-alerts (run inside the lead sync
 * watch) into public.cockpit_exception_state. RLS: the CEO, admins, and the
 * media buyers allowed on the client. A problem shows after two checks in a
 * row and leaves after two clean ones; the same check messages the client's
 * owner on Slack (a dry run until the go-live). The footer reads
 * cockpit_exception_summary(), because the worker's health row is service
 * only. Cached for 5 minutes and shared, like the lead sync strip.
 */

type Rule = "zero_leads" | "cpb_over_line" | "campaign_stopped" | "lead_sync";

type Row = {
  rule: Rule;
  client_key: string;
  client_name: string;
  state: "open" | "too_little_data";
  reason: string;
  opened_at: string | null;
};

type Summary = {
  checkedAt: string | null;
  lastOkAt: string | null;
  ok: boolean;
  delivery: "live" | "dry";
};

type Data = { rows: Row[]; summary: Summary | null };

const RULE: Record<Rule, { label: string; tone: StatusTone; rank: number }> = {
  zero_leads: { label: "Spend, no leads", tone: "critical", rank: 0 },
  lead_sync: { label: "Leads not in CRM", tone: "serious", rank: 1 },
  campaign_stopped: { label: "Campaign stopped", tone: "serious", rank: 2 },
  cpb_over_line: { label: "Booking cost high", tone: "warning", rank: 3 },
};

const TTL = 5 * 60_000;
let cache: { at: number; data: Data } | null = null;
const listeners = new Set<(d: Data) => void>();

async function load(force = false): Promise<Data> {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.data;
  const [state, summary] = await Promise.all([
    supabase
      .from("cockpit_exception_state")
      .select("rule,client_key,client_name,state,reason,opened_at")
      .in("state", ["open", "too_little_data"]),
    supabase.rpc("cockpit_exception_summary"),
  ]);
  if (state.error) throw state.error;
  const data: Data = {
    rows: (state.data ?? []) as Row[],
    summary: summary.error ? null : ((summary.data as Summary | null) ?? null),
  };
  cache = { at: Date.now(), data };
  for (const l of listeners) l(data);
  return data;
}

/** Open alerts this person may see; null while loading, "none" when the table cannot be read. */
function useExceptions(): Data | null | "none" {
  const [data, setData] = useState<Data | null | "none">(cache?.data ?? null);
  useEffect(() => {
    listeners.add(setData);
    load().then(setData, () => setData("none"));
    const t = setInterval(() => load(true).catch(() => {}), TTL);
    return () => {
      listeners.delete(setData);
      clearInterval(t);
    };
  }, []);
  return data;
}

const since = (iso: string | null, now: number) =>
  iso ? `since ${relative(Date.parse(iso), now).replace(/ ago$/, "")}` : "";

/** The card on Today: nothing while loading, hidden when this person cannot read it. */
export function ExceptionAlerts() {
  const data = useExceptions();
  const now = useNow();
  if (data === null || data === "none") return null;

  const open = data.rows
    .filter(r => r.state === "open")
    .sort(
      (a, b) =>
        RULE[a.rule].rank - RULE[b.rule].rank ||
        (a.opened_at ?? "").localeCompare(b.opened_at ?? ""),
    );
  const thin = new Set(
    data.rows.filter(r => r.state === "too_little_data").map(r => r.client_key),
  ).size;
  const s = data.summary;

  const footer = [
    s?.checkedAt
      ? `Checked ${relative(Date.parse(s.checkedAt), now)}.`
      : "Not checked yet.",
    thin
      ? `${thin} client${thin === 1 ? " has" : "s have"} too little data to judge yet.`
      : null,
    s?.delivery === "live"
      ? "The owner gets a Slack message when one opens."
      : "Slack messages are off for now: nothing is sent.",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <SectionCard
      title="Exception alerts"
      description="Clients whose numbers broke, checked every hour. A client shows here after two checks in a row and leaves after two clean ones."
      actions={
        s && !s.ok ? (
          <StatusChip
            tone="warning"
            label="Last check had a problem"
            hint={
              s.lastOkAt
                ? `Last clean check ${relative(Date.parse(s.lastOkAt), now)}. The list may be out of date.`
                : "No clean check yet. The list may be out of date."
            }
          />
        ) : null
      }
    >
      {open.length === 0 ? (
        <EmptyState
          compact
          icon={s?.checkedAt ? CircleCheck : CircleDashed}
          title={
            s?.checkedAt
              ? "No client has a broken number"
              : "The first check has not run yet"
          }
          text={footer}
        />
      ) : (
        <>
          <ul className="-mx-4 divide-y border-y sm:-mx-6">
            {open.map(r => (
              <li key={`${r.rule}|${r.client_key}`}>
                <Link
                  to={`/ads?account=${encodeURIComponent(r.client_name)}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none sm:px-6"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-medium text-foreground">
                        {r.client_name}
                      </span>
                      <StatusChip
                        tone={RULE[r.rule].tone}
                        label={RULE[r.rule].label}
                      />
                      <span className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                        {since(r.opened_at, now)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-muted-foreground">
                      {r.reason}
                    </p>
                  </div>
                  <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            {footer}
          </p>
        </>
      )}
    </SectionCard>
  );
}
