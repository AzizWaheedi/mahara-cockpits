import { AlertTriangle, ArrowRight, Check, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

interface Review {
  id: string;
  version: number;
  body: string;
  state: string;
  reason: string | null;
  createdAt: string;
  actor: string | null;
  decidedAt: string | null;
  delivery: {
    state: string;
    at: string;
    error: string | null;
    receipt: string | null;
  } | null;
}
interface Client {
  bindingId: string;
  client: string;
  clientTaskId: string;
  accountId: string;
  signal: string;
  error: string | null;
  checkedAt: string | null;
  fresh: boolean;
  nextSendAt: string | null;
  review: Review | null;
}
interface Panel {
  apply: boolean;
  finishedAt: string | null;
  error: string | null;
  dailyReviewedAt: string | null;
  clients: Client[];
}
const when = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "Not checked yet";
function useBillingReview() {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const { data, error: failure } = await supabase
        .rpc("cockpit_ad_billing_review_panel")
        .abortSignal(AbortSignal.timeout(15_000));
      if (failure) throw failure;
      if (!data || !Array.isArray(data.clients))
        throw new Error("Billing review returned no verified data.");
      setPanel(data as Panel);
      setError(null);
    } catch (e) {
      setPanel(null);
      setError(
        e instanceof Error
          ? e.message
          : ((e as { message?: string }).message ??
              "Billing review is unavailable. Please refresh."),
      );
    }
  }, []);
  useEffect(() => {
    void reload();
    const id = window.setInterval(() => void reload(), 60_000);
    return () => window.clearInterval(id);
  }, [reload]);
  return { panel, error, reload };
}
export function AdBillingDailyTask() {
  const { panel, error } = useBillingReview();
  const pending =
    panel?.clients.filter(c => c.review?.state === "pending").length ?? 0;
  return (
    <section
      className="rounded-2xl border border-border bg-card p-5 shadow-sm"
      aria-label="Daily ad billing review"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-4 text-warning" /> Daily ad billing
            review
          </p>
          <p className="text-sm text-muted-foreground">
            {error
              ? "Billing review unavailable. Open it to check."
              : !panel
                ? "Loading billing checks…"
                : `${pending} message${pending === 1 ? "" : "s"} awaiting your decision. ${panel.dailyReviewedAt ? "Today’s check recorded." : "Check once today."}`}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/ad-billing">
            Review messages <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
function ReviewCard({
  client,
  apply,
  reload,
  initialMode,
}: {
  client: Client;
  apply: boolean;
  reload: () => Promise<void>;
  initialMode: string | null;
}) {
  const r = client.review;
  const [body, setBody] = useState(r?.body ?? "");
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState(initialMode === "deny" ? "deny" : "edit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const cooling =
    client.nextSendAt === "infinity" ||
    Boolean(client.nextSendAt && Date.parse(client.nextSendAt) > Date.now());
  const ready = r?.state === "pending" && client.fresh && !client.error;
  async function decide(decision: "approve" | "deny") {
    if (!r || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { error: failure } = await supabase.rpc(
        "cockpit_ad_billing_decide",
        {
          p_id: r.id,
          p_version: r.version,
          p_decision: decision,
          p_body: decision === "approve" ? body : null,
          p_reason: decision === "deny" ? reason : null,
        },
      );
      if (failure) throw failure;
      setReceipt(
        decision === "approve"
          ? "Approved and queued. Provider acceptance will appear after the next worker check, normally within five minutes."
          : "Denied. Your reason is recorded; no message will be sent.",
      );
      await reload();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : ((e as { message?: string }).message ??
              "Could not save your decision. Reload before trying again."),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <article
      className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm"
      id={`billing-${client.bindingId}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{client.client}</h2>
          <p className="text-xs text-muted-foreground">
            Meta account {client.accountId} · Checked {when(client.checkedAt)}
          </p>
        </div>
        <a
          className="text-sm underline"
          href={`https://app.clickup.com/t/${client.clientTaskId}`}
          target="_blank"
          rel="noreferrer"
        >
          Client task
        </a>
      </div>
      <p className="text-sm">
        {client.signal === "payment_grace"
          ? "Payment grace period — review before ads are interrupted."
          : client.signal === "unsettled"
            ? "Meta reports an unsettled balance. A bank decline is not confirmed."
            : client.signal === "healthy"
              ? "The billing signal has cleared."
              : "Media buyer investigation required."}
      </p>
      {client.error && (
        <p role="alert" className="text-sm text-red-700">
          {client.error}
        </p>
      )}
      {!r ? (
        <p className="text-sm text-muted-foreground">
          No client message is queued. Investigate this account with the media
          buyer.
        </p>
      ) : (
        <>
          <p className="text-sm font-medium">
            {r.state === "pending"
              ? "Your review is needed"
              : r.state === "approved"
                ? `Approved · ${r.delivery?.state === "accepted" ? "accepted by WhatsApp provider" : (r.delivery?.state ?? "queued")}`
                : r.state === "denied"
                  ? "Denied — no message sent"
                  : "This draft expired after the source or review window changed"}
          </p>
          {r.actor && (
            <p className="text-xs text-muted-foreground">
              Decision by {r.actor} · {when(r.decidedAt)}
            </p>
          )}
          {r.reason && (
            <p className="rounded-xl bg-muted p-3 text-sm">
              Reason: {r.reason}
            </p>
          )}
          {r.delivery?.error && (
            <p role="alert" className="text-sm text-red-700">
              Delivery needs attention: {r.delivery.error}. Do not resend until
              the result is checked.
            </p>
          )}
          <label
            className="block space-y-2 text-sm"
            htmlFor={`message-${r.id}`}
          >
            <span>Message to the client’s verified WhatsApp group</span>
            <textarea
              id={`message-${r.id}`}
              dir="auto"
              value={body}
              onChange={e => setBody(e.target.value)}
              readOnly={!ready || busy}
              maxLength={3000}
              className="min-h-64 w-full rounded-xl border border-input bg-background p-4 text-base leading-8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            />
          </label>
          {r.state === "pending" && (
            <>
              {!apply && (
                <p role="status" className="flex items-start gap-2 text-sm">
                  <AlertTriangle
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-warning"
                  />
                  <span>
                    Outbound delivery is paused. You can review or deny;
                    approval will be available when delivery is enabled.
                  </span>
                </p>
              )}
              {cooling && (
                <p role="status" className="flex items-start gap-2 text-sm">
                  <AlertTriangle
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-warning"
                  />
                  <span>
                    {client.nextSendAt === "infinity"
                      ? "A previous delivery has an uncertain result. Check it before sending again."
                      : `A client message was already sent recently. Next approval available after ${when(client.nextSendAt)}.`}
                  </span>
                </p>
              )}
              {!client.fresh && (
                <p role="status" className="flex items-start gap-2 text-sm">
                  <AlertTriangle
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-warning"
                  />
                  <span>Waiting for a fresh successful source check.</span>
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={
                    !ready ||
                    !apply ||
                    cooling ||
                    busy ||
                    body.trim().length < 10 ||
                    Boolean(receipt)
                  }
                  onClick={() => void decide("approve")}
                >
                  <Check className="size-4" />{" "}
                  {busy ? "Saving…" : "Approve & queue WhatsApp"}
                </Button>
                <Button
                  variant="outline"
                  disabled={!ready || busy}
                  onClick={() => setMode(mode === "deny" ? "edit" : "deny")}
                >
                  Deny with a reason
                </Button>
              </div>
              {mode === "deny" && (
                <div className="space-y-2 rounded-xl bg-muted p-4">
                  <label className="block text-sm" htmlFor={`reason-${r.id}`}>
                    Why should this message not be sent?
                  </label>
                  <textarea
                    id={`reason-${r.id}`}
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    maxLength={1000}
                    className="min-h-24 w-full rounded-lg border border-input bg-background p-3"
                  />
                  <Button
                    variant="outline"
                    disabled={
                      !ready ||
                      busy ||
                      reason.trim().length < 3 ||
                      Boolean(receipt)
                    }
                    onClick={() => void decide("deny")}
                  >
                    Record denial
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {receipt && (
        <p role="status" className="text-sm text-emerald-700">
          {receipt}
        </p>
      )}
    </article>
  );
}
export function AdBillingReviewPage() {
  const { panel, error, reload } = useBillingReview();
  const [params] = useSearchParams();
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [dailyBusy, setDailyBusy] = useState(false);
  async function done() {
    setDailyBusy(true);
    const { error: failure } = await supabase.rpc(
      "cockpit_ad_billing_daily_done",
    );
    setDailyError(failure?.message ?? null);
    await reload();
    setDailyBusy(false);
  }
  const sorted = [...(panel?.clients ?? [])].sort(
    (a, b) =>
      Number(b.bindingId === params.get("binding")) -
      Number(a.bindingId === params.get("binding")),
  );
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Ad billing review</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Check daily. Edit the Arabic draft, approve it, or record why it
            should not be sent. Either the CSM or media buyer can decide; the
            first decision closes the review for both.
          </p>
        </div>
        <Button variant="outline" onClick={() => void reload()}>
          <RefreshCw className="size-4" /> Refresh
        </Button>
      </div>
      <div className="rounded-2xl border border-border bg-card p-5 text-sm leading-6">
        <p>
          New Slack posts: at most once every three days per client in each
          channel. Earlier changes update the same card. Client WhatsApp also
          has a 72-hour cooldown and always needs approval.
        </p>
        <p className="mt-2 text-muted-foreground">
          Approving queues one message to the verified group. The worker
          rechecks the active client and exact ad account before sending.
          Opening a Slack link sends nothing.
        </p>
        {panel && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p>
              {panel.dailyReviewedAt
                ? `Daily check recorded ${when(panel.dailyReviewedAt)}`
                : "Today’s check has not been recorded yet."}
            </p>
            <Button
              variant="outline"
              disabled={dailyBusy}
              onClick={() => void done()}
            >
              {dailyBusy ? "Saving…" : "Record today’s check"}
            </Button>
          </div>
        )}
        {dailyError && (
          <p role="alert" className="mt-2 text-red-700">
            {dailyError}
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">
          {error}
        </p>
      )}
      {panel?.error && (
        <p role="alert" className="text-red-700">
          Monitor: {panel.error}
        </p>
      )}
      {!panel && !error && (
        <p role="status">Loading current billing reviews…</p>
      )}
      {panel && sorted.length === 0 && (
        <p className="rounded-2xl border p-6">No billing items need review.</p>
      )}
      {sorted.map(client => (
        <ReviewCard
          key={`${client.bindingId}-${client.review?.id}-${client.review?.version}`}
          client={client}
          apply={panel?.apply ?? false}
          reload={reload}
          initialMode={
            client.bindingId === params.get("binding")
              ? params.get("mode")
              : null
          }
        />
      ))}
    </div>
  );
}
