import { CreditCard, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

type Delivery = {
  channel: string;
  state: string;
  error: string | null;
  providerId: string | null;
  taskId?: string | null;
  commentRole?: "client" | "ads" | null;
};
type Binding = {
  id: string;
  client: string;
  clientTaskId: string;
  accountId: string;
  signal: string;
  enabled: boolean;
  ready: boolean;
  checkedAt: string | null;
  lastGoodAt: string | null;
  error: string | null;
  deliveries: Delivery[];
};
export type BillingPanel = {
  apply: boolean;
  finishedAt: string | null;
  error: string | null;
  bindings: Binding[];
  roster: { client: string; clientTaskId: string; enrolled: boolean }[];
};
const labels: Record<string, string> = {
  healthy: "No payment warning",
  payment_grace: "Payment grace period",
  unsettled: "Payment needs attention",
  restricted: "Account restriction",
  unknown: "Not yet verified",
};

export function AdBillingSummary({
  data,
  now = Date.now(),
}: {
  data: BillingPanel;
  now?: number;
}) {
  const stale =
    !data.finishedAt || now - Date.parse(data.finishedAt) > 15 * 60_000;
  const missing = data.roster.filter(c => !c.enrolled);
  const attention = data.bindings.filter(
    b =>
      b.signal !== "healthy" ||
      b.error ||
      !b.ready ||
      !b.enabled ||
      !b.lastGoodAt ||
      now - Date.parse(b.lastGoodAt) > 15 * 60_000 ||
      b.deliveries.some(d => !["accepted", "skipped"].includes(d.state)),
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`rounded-full px-3 py-1 font-medium ${data.apply ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
        >
          {data.apply
            ? "Notifications enabled"
            : "Preview mode · no notifications"}
        </span>
        <span className="text-muted-foreground">
          {data.roster.length - missing.length} of {data.roster.length} active
          clients enrolled
        </span>
        <span className="text-muted-foreground">
          {data.finishedAt
            ? `Last run ${new Date(data.finishedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
            : "No completed run"}
        </span>
      </div>
      {(stale || data.error) && (
        <p
          role="alert"
          className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
        >
          {data.error ||
            "Billing checks are overdue. Verify the worker before relying on these results."}
        </p>
      )}
      {missing.length > 0 && (
        <details className="rounded-xl border p-3 text-sm" open>
          <summary className="cursor-pointer font-medium">
            {missing.length} active clients need account mapping
          </summary>
          <div className="mt-3 flex flex-wrap gap-2">
            {missing.map(c => (
              <a
                key={c.clientTaskId}
                href={`https://app.clickup.com/t/${c.clientTaskId}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-muted px-3 py-1 underline-offset-2 hover:underline"
              >
                {c.client}
              </a>
            ))}
          </div>
        </details>
      )}
      {attention.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          {attention.map(b => (
            <article key={b.id} className="rounded-xl border bg-background p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <a
                  className="font-semibold hover:underline"
                  href={`https://app.clickup.com/t/${b.clientTaskId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {b.client}
                </a>
                <span className="text-xs text-amber-700 dark:text-amber-300">
                  {b.error
                    ? "Verification required"
                    : !b.enabled
                      ? "Monitoring disabled"
                      : !b.ready
                        ? "Manual flow cutover needed"
                        : !b.lastGoodAt ||
                            now - Date.parse(b.lastGoodAt) > 15 * 60_000
                          ? "Check overdue"
                          : labels[b.signal] || "Unverified state"}
                </span>
              </div>
              <a
                className="mt-1 block text-xs text-muted-foreground hover:underline"
                href={`https://business.facebook.com/billing_hub/accounts/details/?asset_id=${b.accountId}`}
                target="_blank"
                rel="noreferrer"
              >
                Meta account {b.accountId}
              </a>
              {b.error && (
                <p className="mt-2 text-sm" role="status">
                  {b.error}
                </p>
              )}
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                {b.deliveries.map((d, i) => (
                  <li key={`${d.channel}-${i}`}>
                    {d.channel === "whatsapp"
                      ? "Client WhatsApp"
                      : d.channel === "slack"
                        ? "Media announcements"
                        : d.commentRole === "client"
                          ? "Client task comment"
                          : d.commentRole === "ads"
                            ? "Ads Management comment"
                            : "ClickUp comment"}
                    :{" "}
                    <strong className="font-medium text-foreground">
                      {d.state === "accepted"
                        ? "Accepted by provider"
                        : d.state}
                    </strong>
                    {d.error ? ` · ${d.error}` : ""}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      )}
      {attention.length === 0 &&
        missing.length === 0 &&
        !stale &&
        !data.error &&
        data.bindings.length > 0 && (
          <p className="text-sm text-muted-foreground">
            No payment warnings on the enrolled accounts. Bank declines can
            still occur without a prior warning.
          </p>
        )}
      {data.roster.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No active-client coverage has been verified for your scope yet.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        This checks Meta billing signals. It does not retry payments or switch
        campaigns on. “Accepted” confirms a provider receipt, not that a person
        read the message.
      </p>
    </div>
  );
}

export function AdBillingWatch() {
  const [data, setData] = useState<BillingPanel | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    setBusy(true);
    try {
      const response = await supabase
        .rpc("cockpit_ad_billing_panel")
        .abortSignal(
          signal
            ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
            : AbortSignal.timeout(15_000),
        );
      if (signal?.aborted) return;
      if (
        response.error ||
        !response.data ||
        !Array.isArray(response.data.bindings) ||
        !Array.isArray(response.data.roster)
      ) {
        setError(true);
        setData(null);
      } else {
        setData(response.data as BillingPanel);
        setError(false);
      }
    } catch {
      if (!signal?.aborted) {
        setError(true);
        setData(null);
      }
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(controller.signal);
    }, 60_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [load]);
  return (
    <section
      aria-labelledby="billing-watch-title"
      className="rounded-2xl border bg-card p-5 sm:p-6"
    >
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2
            id="billing-watch-title"
            className="flex items-center gap-2 text-base font-semibold"
          >
            <CreditCard size={18} aria-hidden /> Ad billing watch
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Payment warnings, client coverage, and notification receipts.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void load()}
          aria-label="Refresh billing status"
        >
          <RefreshCw size={14} aria-hidden />
          Refresh
        </Button>
      </header>
      {error ? (
        <p role="alert" className="text-sm text-muted-foreground">
          Billing monitoring is unavailable. Refresh, or ask technical
          operations to check its connection. This does not mean the accounts
          are healthy.
        </p>
      ) : data ? (
        <AdBillingSummary data={data} />
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          Checking billing status…
        </p>
      )}
    </section>
  );
}
