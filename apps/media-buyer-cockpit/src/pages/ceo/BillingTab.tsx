import { Loader2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import {
  type BillingApi,
  type BillingPayload,
  BillingSheet,
} from "@/components/billing/BillingSheet";
import { ChecksWaiting } from "@/components/billing/ChecksWaiting";
import type { PendingApi } from "@/components/billing/PendingPayments";
import { EmptyState } from "@/components/ceo/EmptyState";
import { money, shortDate } from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type Doors,
  formDoors,
  ladderRead,
  ladderSet,
  mrrRead,
} from "@/forms/staff/lifecycleClient";
import {
  assignBillingPayer,
  confirmPaid,
  editBillingAccount,
  excludePayment,
  fetchBillingSheet,
  fetchPendingPayments,
  linkDealToCard,
  logBillingPayment,
  staffForms,
  unexcludePayment,
  unlinkDeal,
  withdrawConfirmation,
} from "@/lib/billing";
import {
  DEFAULT_STEPS,
  type MrrDowngrade,
  mrrViewFrom,
} from "@/lib/billingCore";
import { tieOpener } from "./billingTie";
import { AttributeSheet } from "./money/AttributeSheet";
import { freshPending, type MoneyLine, type PendingTie } from "./money/credit";
import type { CeoTabProps } from "./types";

/**
 * Billing: every client on the books, when they pay next, and the decision
 * to make about it (convex/billing.ts, convex/billingCore.ts). The client
 * success cockpit shows the same sheet; here a logged payment goes straight
 * into the ledger the Money tab reads, and money nobody has tied to a client
 * can be tied from the same screen, so LTV adds up.
 *
 * Pending payments sits on top (components/billing/PendingPayments.tsx): who
 * signed and has not finished paying. Here it also carries what only the CEO
 * gets: the deals with no card (Link to a card), Back with sales, and the
 * untied money that could be a part. Its "Tie it" opens the Money section's
 * tie sheet on that payment, here (billingTie.ts).
 *
 * Since 20261101p the sheet's Give more time, Pause, Resume and Set MRR are
 * the staff forms, and two CEO cards sit under it: the overdue steps (the
 * one ladder, editable here) and the MRR that went down this month. Checks
 * waiting sits on top once 20261101n is live.
 */
export function BillingTab({ sections, goTab }: CeoTabProps) {
  const auth = useCockpitAuth();

  // Possible money's tie sheet: the Money section's published lines, as on
  // the Transactions tab, and the ties saved here until the next refresh.
  const money = sections.money;
  const lines: MoneyLine[] = money?.payload?.attribution?.transactions ?? [];
  const linesNow = useRef(lines);
  linesNow.current = lines;
  const [tying, setTying] = useState<MoneyLine | null>(null);
  const [saved, setSaved] = useState<PendingTie[]>([]);
  const lastOkAt = money?.lastOkAt ?? null;
  const ties = useMemo(() => freshPending(saved, lastOkAt), [saved, lastOkAt]);

  const pending = useMemo<PendingApi>(() => {
    const signedIn = () => {
      if (!auth.client) throw new Error("Sign in to read pending payments.");
      return auth.client;
    };
    return {
      read: async () => fetchPendingPayments(signedIn()),
      confirm: async p => (await confirmPaid(signedIn(), p, "ceo")).sentence,
      withdraw: async p => withdrawConfirmation(signedIn(), p, "ceo"),
      link: async p => linkDealToCard(signedIn(), p, "ceo"),
      unlink: async p => unlinkDeal(signedIn(), p, "ceo"),
      exclude: async p => excludePayment(signedIn(), p, "ceo"),
      unexclude: async p => unexcludePayment(signedIn(), p, "ceo"),
      // Money's tie sheet on that payment; Transactions when it is not there.
      openTie: tieOpener(() => linesNow.current, setTying, goTab),
    };
  }, [auth.client, goTab]);

  const wired = useMemo<BillingApi>(
    () => ({
      sheet: async () => {
        if (!auth.client) {
          return {
            today: new Date().toISOString().slice(0, 10),
            rows: [],
            cards: [],
            events: [],
            inbox: [],
            syncedAt: null,
            totals: {
              dueThisWeek: { count: 0, usd: 0 },
              overdue: { count: 0, usd: 0 },
              paused: 0,
              extended: 0,
              noMethod: 0,
              noDate: 0,
            },
          } as unknown as BillingPayload;
        }
        return fetchBillingSheet(auth.client, null);
      },
      edit: async args => {
        if (!auth.client) throw new Error("Not signed in");
        return editBillingAccount(auth.client, auth.email, args, "ceo");
      },
      logPayment: async p => {
        if (!auth.client) throw new Error("Not signed in");
        return logBillingPayment(
          auth.client,
          auth.email,
          {
            account: p.account,
            day: p.day,
            amount: p.amount,
            currency: p.currency,
            rail: p.rail,
            reference: p.reference ?? undefined,
            evidenceUrl: p.evidenceUrl ?? undefined,
            note: p.note ?? undefined,
            nextDate: p.nextDate ?? undefined,
            allowRepeat: p.allowRepeat === true,
          },
          "ceo",
        );
      },
      assign: async p => {
        if (!auth.client) throw new Error("Not signed in");
        return assignBillingPayer(auth.client, auth.email, p);
      },
      ledgerLine:
        "It goes straight into the ledger the Money tab reads, and counts toward cash and LTV at the next refresh.",
      pending,
      forms: auth.client ? staffForms(auth.client, "ceo") : undefined,
    }),
    [auth.client, auth.email, pending],
  );

  // The new doors, once per page load; any error reads as all closed.
  const [doors, setDoors] = useState<Doors | null>(null);
  useEffect(() => {
    if (!auth.client) return;
    let live = true;
    void formDoors(auth.client).then(d => {
      if (live) setDoors(d);
    });
    return () => {
      live = false;
    };
  }, [auth.client]);

  return (
    <>
      {doors?.checks && auth.client ? <ChecksWaiting canCheck /> : null}
      <BillingSheet api={wired} />
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <OverdueSteps open={doors === null ? null : doors.reviews} />
        <Downgrades open={doors === null ? null : doors.mrr} />
      </div>
      <AttributeSheet
        subject={tying ? { kind: "payment", line: tying } : null}
        lines={lines}
        lastRefreshAt={lastOkAt}
        pending={ties}
        onTied={t => setSaved(v => [...v, t])}
        onClose={() => setTying(null)}
      />
    </>
  );
}

/** A quiet line while a read is on its way. */
const Reading = ({ words }: { words: string }) => (
  <p className="flex items-center gap-2 text-sm text-muted-foreground">
    <Loader2 className="size-4 animate-spin" aria-hidden />
    {words}
  </p>
);

/** The client's name as written, Arabic included, without flipping the line. */
const Name = ({ children }: { children: string }) => (
  <bdi className="font-medium">{children}</bdi>
);

/**
 * The overdue steps (billing.ladder): the day a late payment gets a pause
 * review and the day it gets a cancel review. Each is a row on Today for a
 * person to decide on a call; neither changes the card by itself. The
 * billing agent's SOP and the portal read the same row when they update.
 */
function OverdueSteps({ open }: { open: boolean | null }) {
  const auth = useCockpitAuth();
  const id = useId();
  const [pause, setPause] = useState("");
  const [cancel, setCancel] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!auth.client || !open) return;
    try {
      const r = await ladderRead(auth.client);
      setPause(String(r.pauseReviewDay ?? DEFAULT_STEPS.pauseReviewDay));
      setCancel(String(r.cancelReviewDay ?? DEFAULT_STEPS.cancelReviewDay));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [auth.client, open]);
  useEffect(() => {
    void load();
  }, [load]);

  // The server's own rules, in its words, before the call.
  const problem = (): string | null => {
    const p = Number(pause);
    const c = Number(cancel);
    if (
      !Number.isInteger(p) ||
      !Number.isInteger(c) ||
      pause === "" ||
      cancel === ""
    )
      return "Type each step as a whole number of days late.";
    if (p < 1) return "The pause review is on day 1 or later.";
    if (c <= p) return "The cancel review comes after the pause review.";
    if (c > 60) return "The cancel review is on day 60 or earlier.";
    return null;
  };

  const save = async () => {
    const wrong = problem();
    if (wrong) {
      setError(wrong);
      return;
    }
    if (!auth.client) {
      setError("Sign in again, then save.");
      return;
    }
    setState("saving");
    setError(null);
    try {
      await ladderSet(auth.client, {
        pauseReviewDay: Number(pause),
        cancelReviewDay: Number(cancel),
      });
      setState("saved");
    } catch (e) {
      setState("idle");
      setError(
        e instanceof Error && e.message
          ? e.message
          : "Not saved. Check your connection and press Save again.",
      );
    }
  };

  return (
    <SectionCard
      title="Overdue steps"
      kicker="The ladder"
      description="The day a late payment gets a pause review, and the day it gets a cancel review. Both are rows on Today for a person to decide on a call; neither changes the card."
    >
      {open === null ? (
        <Reading words="Reading the overdue steps" />
      ) : !open ? (
        <p className="text-sm text-muted-foreground">
          Opens after the next cockpit update.
        </p>
      ) : loadError ? (
        <p className="text-sm text-destructive" role="alert">
          {loadError} Reload the page to try again.
        </p>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={e => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid grid-cols-2 gap-4 sm:max-w-sm">
            <label
              className="grid gap-1 text-xs font-medium text-muted-foreground"
              htmlFor={`${id}-p`}
            >
              Pause review on day
              <Input
                id={`${id}-p`}
                inputMode="numeric"
                className="font-mono tabular-nums"
                value={pause}
                onChange={e => {
                  setPause(e.target.value.replace(/[^0-9]/g, ""));
                  setState("idle");
                }}
              />
            </label>
            <label
              className="grid gap-1 text-xs font-medium text-muted-foreground"
              htmlFor={`${id}-c`}
            >
              Cancel review on day
              <Input
                id={`${id}-c`}
                inputMode="numeric"
                className="font-mono tabular-nums"
                value={cancel}
                onChange={e => {
                  setCancel(e.target.value.replace(/[^0-9]/g, ""));
                  setState("idle");
                }}
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              size="sm"
              disabled={state === "saving" || !pause || !cancel}
            >
              {state === "saving" ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : null}
              {state === "saved" ? "Saved" : "Save"}
            </Button>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : state === "saved" ? (
              <p className="text-sm text-muted-foreground" role="status">
                Today's review rows use the new days from the next page load.
              </p>
            ) : null}
          </div>
        </form>
      )}
    </SectionCard>
  );
}

/** One downgrade, as 5.3 words it: "{client}: {from} → {to} from {date}, {reason} · {role}". */
function downgradeLine(d: MrrDowngrade): string {
  return `${money(d.fromUsd)} → ${money(d.toUsd)} from ${d.effective ? shortDate(d.effective) : "an unknown day"}${d.reason ? `, ${d.reason}` : ""} · ${d.seatRole}`;
}

/** Every MRR that went down this Kuwait month (Q13), from Set MRR's own log. */
function Downgrades({ open }: { open: boolean | null }) {
  const auth = useCockpitAuth();
  const [rows, setRows] = useState<MrrDowngrade[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!auth.client || !open) return;
    let live = true;
    mrrRead(auth.client).then(
      raw => {
        if (live) setRows(mrrViewFrom(raw)?.downgrades ?? []);
      },
      e => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      live = false;
    };
  }, [auth.client, open]);

  return (
    <SectionCard
      title="Downgrades this month"
      kicker="Set MRR"
      description="A lower MRR from Set MRR, with the reason and the seat that set it. The card's MRR changes only through Set MRR."
    >
      {open === null ? (
        <Reading words="Reading this month's MRR changes" />
      ) : !open ? (
        <p className="text-sm text-muted-foreground">
          Opens after the next cockpit update.
        </p>
      ) : error ? (
        <p className="text-sm text-destructive" role="alert">
          {error} Reload the page to try again.
        </p>
      ) : rows === null ? (
        <Reading words="Reading this month's MRR changes" />
      ) : rows.length === 0 ? (
        <EmptyState compact title="No MRR went down this month." />
      ) : (
        <ul className="grid gap-2">
          {rows.map((d, i) => (
            <li key={`${d.taskId}-${i}`} className="text-sm leading-relaxed">
              <Name>{d.clientName}</Name>
              <span>: </span>
              <span className="tabular-nums">{downgradeLine(d)}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
