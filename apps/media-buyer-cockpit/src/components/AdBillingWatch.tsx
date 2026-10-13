import "@/components/ceo/ceo.css";
import {
  ArrowUpRight,
  ChevronRight,
  CreditCard,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useState } from "react";
import { shortDate } from "@/components/ceo/format";
import { STATUS_COLOR, StatusChip } from "@/components/ceo/StatusChip";
import { Button } from "@/components/ui/button";
import {
  type BillingPanel,
  billingStrip,
  chipNeedsAll,
  FIRST_ROWS,
  metaBillingUrl,
  REVIEW_HREF,
  readFold,
  receiptsLine,
  reviewLabel,
  type StripAccount,
  type StripCampaign,
  type StripChip,
  stoppedLine,
  stripChips,
  unmappedLine,
  writeFold,
} from "@/lib/adBillingStrip";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export type { BillingPanel } from "@/lib/adBillingStrip";

/**
 * Payments, on Today and above the Ads board: one quiet row (Aziz,
 * 2026-10-13, "so we can focus on the ads"). It says how many accounts Meta
 * flags, which of them stopped spending, and the one thing to do (review the
 * client messages); Show opens the detail. Nothing at all when every check
 * is fresh and every account is fine. The rules are in lib/adBillingStrip.ts.
 */

const LINK =
  "inline-flex items-center gap-1 whitespace-nowrap text-muted-foreground hover:text-foreground hover:underline";

/**
 * The row itself: icon, "Payments", what it says, and its buttons. One line
 * from `sm` up; on a phone Show or Refresh stays beside the title, what it
 * says takes the next line and the review button the last.
 */
function StripRow({
  labelId,
  children,
  primary,
  toggle,
  panel,
}: {
  labelId: string;
  children: ReactNode;
  /** The one action that matters, such as "Review 9 client messages". */
  primary?: ReactNode;
  /** Show, Hide or Refresh. */
  toggle?: ReactNode;
  panel?: ReactNode;
}) {
  return (
    <section
      aria-labelledby={labelId}
      className="ceo-root rounded-xl border text-sm"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 sm:px-4">
        <CreditCard
          className="order-1 size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <h2
          id={labelId}
          className="order-2 flex-1 text-sm font-medium sm:flex-none sm:shrink-0"
        >
          Payments
        </h2>
        <div className="order-4 flex min-w-0 basis-full flex-wrap items-center gap-x-2 gap-y-1.5 sm:basis-0 sm:flex-1">
          {children}
        </div>
        {primary ? <div className="order-5 shrink-0">{primary}</div> : null}
        {toggle ? (
          <div className="order-3 shrink-0 sm:order-6">{toggle}</div>
        ) : null}
      </div>
      {panel}
    </section>
  );
}

/** One flagged account in the opened panel: a divided row, no card. */
function AccountRow({ a }: { a: StripAccount }) {
  const facts = [
    a.review,
    a.stopped && a.lastSpend ? `Not spent since ${shortDate(a.lastSpend)}` : "",
    receiptsLine(a),
    a.fault,
  ].filter(Boolean);
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-1.5 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1 basis-64">
        <div className="flex flex-wrap items-center gap-2">
          <span className="break-words font-medium" dir="auto">
            {a.client}
          </span>
          <StatusChip tone={a.tone} label={a.label} />
        </div>
        {facts.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            {facts.join(" · ")}
          </p>
        )}
        {a.failures.map((f, i) => (
          <p
            key={`${f.label}-${i}`}
            className="mt-1 flex items-start gap-1.5 text-xs"
          >
            <TriangleAlert
              className="mt-px size-3.5 shrink-0"
              style={{ color: STATUS_COLOR.warning }}
              aria-hidden
            />
            <span>
              {f.label}: {f.state === "unknown" ? "not confirmed" : "failed"}
              {f.error ? `. ${f.error}` : "."}
            </span>
          </p>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-3 text-xs">
        {a.accountId && (
          <a
            className={LINK}
            href={metaBillingUrl(a.accountId)}
            target="_blank"
            rel="noreferrer"
          >
            Meta billing
            <ArrowUpRight className="size-3.5" aria-hidden />
          </a>
        )}
        {a.clientTaskId && (
          <a
            className={LINK}
            href={`https://app.clickup.com/t/${a.clientTaskId}`}
            target="_blank"
            rel="noreferrer"
          >
            ClickUp
            <ArrowUpRight className="size-3.5" aria-hidden />
          </a>
        )}
      </div>
    </li>
  );
}

/**
 * The strip for one panel read: the row, and the detail when open. Pure
 * from its props, so the dev harness draws every state from fixtures.
 */
export function AdBillingSummary({
  data,
  now = Date.now(),
  campaigns,
  open = false,
  onOpenChange,
  onShowOnBoard,
  onRefresh,
  busy = false,
}: {
  data: BillingPanel;
  now?: number;
  /** The snapshot's campaigns: their last day of spend per ad account. */
  campaigns?: StripCampaign[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Turns on the board's Payment problem filter. */
  onShowOnBoard?: () => void;
  onRefresh?: () => void;
  busy?: boolean;
}) {
  const labelId = useId();
  const panelId = useId();
  const [all, setAll] = useState(false);
  const s = billingStrip(data, { now, campaigns });
  if (s.hidden) return null;
  const chips = stripChips(s);
  const stopped = stoppedLine(s);
  const shown = all ? s.accounts : s.accounts.slice(0, FIRST_ROWS);

  const chip = (c: StripChip) => {
    // A count whose accounts are not all on the board opens the panel, with
    // every row shown when one of them sits past the first five.
    const onClick =
      c.action === "board" && onShowOnBoard
        ? onShowOnBoard
        : c.action === "panel" && onOpenChange
          ? () => {
              if (chipNeedsAll(s, c.key)) setAll(true);
              onOpenChange(true);
            }
          : undefined;
    const inner = <StatusChip tone={c.tone} label={c.label} />;
    if (!onClick) return <span key={c.key}>{inner}</span>;
    return (
      <button
        key={c.key}
        type="button"
        onClick={onClick}
        title={
          c.action === "board"
            ? "Show these campaigns on the board"
            : "Show the details"
        }
        className="no-touch relative rounded-full after:absolute after:-inset-1.5 after:content-[''] hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {inner}
      </button>
    );
  };

  const panel = open ? (
    <div
      id={panelId}
      className="mx-2 mb-2 space-y-3 rounded-xl bg-muted/40 p-4 sm:mx-3 sm:mb-3"
    >
      {data.error && (
        <p className="text-xs text-muted-foreground">
          The worker said: {data.error}
        </p>
      )}
      {s.accounts.length > 0 ? (
        <>
          <ul className="divide-y divide-border/60">
            {shown.map(a => (
              <AccountRow key={a.id} a={a} />
            ))}
          </ul>
          {!all && s.accounts.length > FIRST_ROWS && (
            <Button
              size="sm"
              variant="ghost"
              className="-ml-2 h-7 text-xs"
              onClick={() => setAll(true)}
            >
              Show the other {s.accounts.length - FIRST_ROWS}
            </Button>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          No account has a payment warning. A bank can still decline a card
          without one.
        </p>
      )}
      {s.unmapped.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-3 text-xs">
          <span>{unmappedLine(s.unmapped.length)}:</span>
          {s.unmapped.map(c => (
            <a
              key={c.clientTaskId}
              className={LINK}
              href={`https://app.clickup.com/t/${c.clientTaskId}`}
              target="_blank"
              rel="noreferrer"
              dir="auto"
            >
              {c.client}
              <ArrowUpRight className="size-3.5" aria-hidden />
            </a>
          ))}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
        <span>
          {[
            s.apply
              ? "Team approval on"
              : "Client messages paused, checks continue",
            `${s.enrolled} of ${s.rosterSize} active clients enrolled`,
            s.lastRun ? `last check ${s.lastRun}` : "no check finished yet",
          ].join(" · ")}
        </span>
        {onRefresh && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={busy}
            onClick={onRefresh}
          >
            <RefreshCw className={cn(busy && "animate-spin")} aria-hidden />
            Refresh
          </Button>
        )}
      </div>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">
          How this works
        </summary>
        <p className="mt-2 max-w-3xl leading-relaxed">
          This is the ad billing watch. It reads Meta's billing status for each
          enrolled client every five minutes. It does not retry payments or
          switch campaigns on. A client WhatsApp goes out only after the CSM or
          the media buyer approves it, and new Slack posts and client messages
          are limited to once per client every 72 hours. "Sent" means the
          provider accepted it, not that a person read it.
        </p>
      </details>
    </div>
  ) : null;

  return (
    <StripRow
      labelId={labelId}
      panel={panel}
      primary={
        s.pending > 0 ? (
          <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
            <a href={REVIEW_HREF}>
              {reviewLabel(s.pending)}
              <ChevronRight aria-hidden />
            </a>
          </Button>
        ) : null
      }
      toggle={
        onOpenChange || (s.sentence && onRefresh) ? (
          <div className="flex items-center gap-1">
            {/* The sentence says to refresh: the button sits beside it. */}
            {s.sentence && onRefresh && !open ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                disabled={busy}
                onClick={onRefresh}
              >
                <RefreshCw className={cn(busy && "animate-spin")} aria-hidden />
                Refresh
              </Button>
            ) : null}
            {onOpenChange ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                aria-expanded={open}
                aria-controls={open ? panelId : undefined}
                onClick={() => onOpenChange(!open)}
              >
                {open ? "Hide" : "Show"}
              </Button>
            ) : null}
          </div>
        ) : null
      }
    >
      {s.sentence ? (
        <span className="text-xs text-muted-foreground">{s.sentence}</span>
      ) : (
        chips.map(chip)
      )}
      {stopped && (
        <span className="text-xs text-muted-foreground">{stopped}</span>
      )}
    </StripRow>
  );
}

/** The row when the panel could not be read: never "all paid". */
export function BillingUnavailable({
  reason,
  onRefresh,
  busy = false,
}: {
  reason: "failed" | "refused";
  onRefresh?: () => void;
  busy?: boolean;
}) {
  const labelId = useId();
  return (
    <StripRow
      labelId={labelId}
      toggle={
        onRefresh ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={busy}
            onClick={onRefresh}
          >
            <RefreshCw className={cn(busy && "animate-spin")} aria-hidden />
            Refresh
          </Button>
        ) : null
      }
    >
      <span role="alert" className="text-xs text-muted-foreground">
        {reason === "refused"
          ? "Your seat cannot read billing status. Ask technical operations for media buyer access."
          : "Billing status could not load. This does not mean the accounts are paid. Refresh to try again."}
      </span>
    </StripRow>
  );
}

/** The live strip: reads the panel, polls once a minute while visible. */
export function AdBillingWatch({
  campaigns,
  onShowOnBoard,
}: {
  campaigns?: StripCampaign[];
  onShowOnBoard?: () => void;
}) {
  const [data, setData] = useState<BillingPanel | null>(null);
  const [error, setError] = useState<"failed" | "refused" | null>(null);
  const [busy, setBusy] = useState(false);
  // Starts folded and never opens by itself; the choice is kept per device.
  const [open, setOpen] = useState(() => readFold());
  const fold = (next: boolean) => {
    setOpen(next);
    writeFold(next);
  };
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
        setError(response.error?.code === "42501" ? "refused" : "failed");
        setData(null);
      } else {
        setData(response.data as BillingPanel);
        setError(null);
      }
    } catch {
      if (!signal?.aborted) {
        setError("failed");
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

  if (error)
    return (
      <BillingUnavailable
        reason={error}
        onRefresh={() => void load()}
        busy={busy}
      />
    );
  // Nothing while the first read is in flight: the row appears only when
  // there is something to say.
  if (!data) return null;
  return (
    <AdBillingSummary
      data={data}
      campaigns={campaigns}
      open={open}
      onOpenChange={fold}
      onShowOnBoard={onShowOnBoard}
      onRefresh={() => void load()}
      busy={busy}
    />
  );
}
