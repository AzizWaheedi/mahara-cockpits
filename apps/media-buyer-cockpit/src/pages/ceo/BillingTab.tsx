import type { SupabaseClient } from "@supabase/supabase-js";
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
import { money, plural, shortDate } from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import { StatusChip } from "@/components/ceo/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type Door, doorLine } from "@/forms/staff/formSheetCore";
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
import { useW56Doors } from "./moneyImport";
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
  const w56 = useW56Doors(auth.client);

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
      {/* Waves 5-6 (WAVE56-CONTRACT.md 5.5, 5.7): one LTV writer and the agent's own login. */}
      {auth.client ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <LtvCard api={ltvApi(auth.client)} door={w56?.ltv ?? null} />
          <AgentCard api={agentApi(auth.client)} door={w56?.agent ?? null} />
        </div>
      ) : null}
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

// --- Lifetime value (WAVE56-CONTRACT.md 4.4, 5.5) ------------------------------------

export type LtvRow = {
  taskId: string;
  client: string;
  card: number | null;
  target: number | null;
  delta: number | null;
  state: "write" | "same" | "held" | "missing" | "out_of_scope";
  why: string | null;
};
export type LtvRead = {
  on: boolean;
  maxDeltaUsd: number | null;
  lastRun: { at: string | null; note: string | null } | null;
  rows: LtvRow[];
  held: {
    taskId: string;
    client: string;
    target: number | null;
    card: number | null;
    delta: number | null;
    heldOn: string | null;
  }[];
  loggedWaiting: number;
  /** The independent check (6.2 ltv-second-source), when the read carries it: cards that differ. */
  secondSourceDiffer: number | null;
};
export type LtvApi = {
  read: () => Promise<LtvRead>;
  release: (p: {
    taskId: string;
    target: number;
    note: string;
  }) => Promise<string>;
};

const tx = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const nn = (v: unknown): number | null =>
  v === null || v === undefined || v === "" || !Number.isFinite(Number(v))
    ? null
    : Number(v);
const LTV_STATES = ["write", "same", "held", "missing", "out_of_scope"];

export function toLtvRead(d: any): LtvRead {
  const ss = d?.secondSource;
  return {
    on: d?.on === true,
    maxDeltaUsd: nn(d?.maxDeltaUsd),
    lastRun:
      d?.lastRun && typeof d.lastRun === "object"
        ? { at: tx(d.lastRun.at), note: tx(d.lastRun.note) }
        : null,
    rows: (Array.isArray(d?.rows) ? d.rows : [])
      .filter((r: any) => tx(r?.taskId) && LTV_STATES.includes(r?.state))
      .map((r: any) => ({
        taskId: String(r.taskId),
        client: tx(r.client) ?? "A client",
        card: nn(r.card),
        target: nn(r.target),
        delta: nn(r.delta),
        state: r.state,
        why: tx(r.why),
      })),
    held: (Array.isArray(d?.held) ? d.held : [])
      .filter((h: any) => tx(h?.taskId))
      .map((h: any) => ({
        taskId: String(h.taskId),
        client: tx(h.client) ?? "A client",
        target: nn(h.target),
        card: nn(h.card),
        delta: nn(h.delta),
        heldOn: tx(h.heldOn),
      })),
    loggedWaiting: nn(d?.loggedWaiting) ?? 0,
    secondSourceDiffer: ss && typeof ss === "object" ? nn(ss.differ) : nn(ss),
  };
}

async function call(
  c: SupabaseClient,
  name: string,
  args?: Record<string, unknown>,
) {
  const { data, error } = await (args === undefined
    ? c.rpc(name)
    : c.rpc(name, args));
  if (error)
    throw new Error(
      String(error.message ?? "").trim() ||
        "The server refused this with no reason. Try again in a minute.",
    );
  return data;
}

export function ltvApi(c: SupabaseClient): LtvApi {
  return {
    read: async () => toLtvRead(await call(c, "cockpit_ltv_read")),
    release: async p => {
      const d = await call(c, "cockpit_ltv_release", {
        p_task_id: p.taskId,
        p_target: p.target,
        p_note: p.note,
      });
      return (
        tx((d as any)?.sentence) ??
        "Written. It reaches the card within a few minutes."
      );
    },
  };
}

const signed = (n: number | null) =>
  n === null
    ? "not known"
    : `${n > 0 ? "+" : n < 0 ? "−" : ""}${money(Math.abs(n))}`;
const usdOr = (n: number | null) => (n === null ? "not known" : money(n));

/** The second-source line of 5.5: what the figures were checked against, in plain words. */
export function ltvSourceLine(differ: number | null): string {
  if (differ === null) return "Not yet checked against a second source.";
  if (differ === 0) return "Matches the payments tied to each card.";
  return `${plural(differ, "card")} ${differ === 1 ? "differs" : "differ"} from the payments tied to ${differ === 1 ? "it" : "them"}.`;
}

/** The state words of 5.5. */
export function ltvStateWords(
  r: Pick<LtvRow, "state">,
  max: number | null,
): string {
  switch (r.state) {
    case "same":
      return "Same";
    case "write":
      return "Writes tomorrow morning";
    case "held":
      return max === null
        ? "Held: a bigger change than the daily limit"
        : `Held: over a ${money(max)} change`;
    case "missing":
      return "No starting value";
    default:
      return "Not on the list";
  }
}

export function LtvCard({ api, door }: { api: LtvApi; door: Door | null }) {
  const [read, setRead] = useState<LtvRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const open = door?.open === true;
  const load = useCallback(async () => {
    if (!open) return;
    try {
      setRead(await api.read());
      setError(null);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }, [api, open]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: read once per open door
  useEffect(() => {
    void load();
  }, [open]);
  const write = async (h: LtvRead["held"][number]) => {
    if (h.target === null) return;
    setBusy(h.taskId);
    try {
      const s = await api.release({
        taskId: h.taskId,
        target: h.target,
        note: "Released by the CEO on the Billing tab.",
      });
      setSaid(x => ({ ...x, [h.taskId]: s }));
      void load();
    } catch (e) {
      setSaid(x => ({ ...x, [h.taskId]: String((e as Error)?.message ?? e) }));
    } finally {
      setBusy(null);
    }
  };
  const writtenToday = read?.lastRun?.note
    ? nn(/(\d+) written/.exec(read.lastRun.note)?.[1])
    : null;
  const rows = (read?.rows ?? []).filter(r => r.state !== "out_of_scope");
  return (
    <SectionCard
      title="Lifetime value"
      description="The card's starting value plus every checked payment tied to the client since. Written to ClickUp each morning."
    >
      {() =>
        !open ? (
          <p className="text-sm text-muted-foreground" data-door-closed>
            {doorLine(door)}
          </p>
        ) : error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : !read ? (
          <Reading words="Reading lifetime value" />
        ) : (
          <div className="grid gap-4" data-ltv-card>
            <p className="text-xs text-muted-foreground" data-ltv-source>
              {ltvSourceLine(read.secondSourceDiffer)}
            </p>
            {!read.on ? (
              <p className="text-sm" data-ltv-off>
                The morning writer is off. Nothing is written to the card.
              </p>
            ) : null}
            {read.loggedWaiting > 0 ? (
              <p className="text-sm text-muted-foreground">
                {plural(read.loggedWaiting, "logged payment")}{" "}
                {read.loggedWaiting === 1 ? "waits" : "wait"} on a check and{" "}
                {read.loggedWaiting === 1 ? "is" : "are"} not counted yet.
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
              <StatTile
                variant="plain"
                label="Cards up to date"
                value={String(rows.filter(r => r.state === "same").length)}
              />
              <StatTile
                variant="plain"
                label="Written today"
                value={
                  writtenToday === null ? "not known" : String(writtenToday)
                }
              />
              <StatTile
                variant="plain"
                label="Waiting for you"
                value={String(read.held.length)}
              />
              <StatTile
                variant="plain"
                label="No starting value"
                value={String(rows.filter(r => r.state === "missing").length)}
              />
            </div>
            <ul className="grid divide-y text-sm">
              {read.held.map(h => (
                <li
                  key={`held-${h.taskId}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                  data-ltv-held={h.taskId}
                >
                  <span className="min-w-0">
                    <Name>{h.client}</Name>{" "}
                    <span className="font-mono tabular-nums text-muted-foreground">
                      · card {usdOr(h.card)} · cockpit {usdOr(h.target)} ·{" "}
                      {signed(h.delta)}
                    </span>
                    <StatusChip
                      tone="warning"
                      label={ltvStateWords({ state: "held" }, read.maxDeltaUsd)}
                      className="ml-2"
                    />
                  </span>
                  {said[h.taskId] ? (
                    <span className="text-xs" role="status">
                      {said[h.taskId]}
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === h.taskId || h.target === null}
                      onClick={() => void write(h)}
                    >
                      Write it
                    </Button>
                  )}
                </li>
              ))}
              {rows
                .filter(r => r.state !== "held")
                .map(r => (
                  <li
                    key={r.taskId}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                    data-ltv-row={r.taskId}
                  >
                    <span className="min-w-0">
                      <Name>{r.client}</Name>{" "}
                      <span className="font-mono tabular-nums text-muted-foreground">
                        · card {usdOr(r.card)} · cockpit {usdOr(r.target)} ·{" "}
                        {signed(r.delta)}
                      </span>
                    </span>
                    <span className="text-xs">
                      {ltvStateWords(r, read.maxDeltaUsd)}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        )
      }
    </SectionCard>
  );
}

// --- The billing agent's login (WAVE56-CONTRACT.md 4.5, 5.7) ---------------------------

export type AgentKey = {
  id: number;
  agent: string;
  note: string | null;
  addedAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  lastCallAt: string | null;
  callsToday: number | null;
};
export type AgentRead = { keys: AgentKey[]; separated: boolean };
export type AgentApi = {
  read: () => Promise<AgentRead>;
  revoke: (id: number, reason: string) => Promise<string>;
};

export function agentApi(c: SupabaseClient): AgentApi {
  return {
    read: async () => {
      const d: any = (await call(c, "cockpit_agent_keys_read")) ?? {};
      return {
        keys: (Array.isArray(d.keys) ? d.keys : [])
          .filter((k: any) => nn(k?.id) !== null)
          .map((k: any) => ({
            id: Number(k.id),
            agent: tx(k.agent) ?? "billing_agent",
            note: tx(k.note),
            addedAt: tx(k.addedAt),
            revokedAt: tx(k.revokedAt),
            revokedReason: tx(k.revokedReason),
            lastCallAt: tx(k.lastCallAt),
            callsToday: nn(k.callsToday),
          })),
        // billing.agent.separated (written by D-AG); anything but true reads as not separated.
        separated: d.separated === true || d.agent?.separated === true,
      };
    },
    revoke: async (id, reason) => {
      const d: any = await call(c, "cockpit_agent_key_revoke", {
        p_id: id,
        p_reason: reason,
      });
      return (
        tx(d?.sentence) ??
        "Revoked. The agent cannot write until a new key is set on the server."
      );
    },
  };
}

export const AGENT_NOT_SEPARATED =
  "The agent writes through its own key, but it can still read the old key on the server. A separate server user fixes this.";

const timeOf = (ts: string | null) => {
  if (!ts) return "none yet";
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return "none yet";
  const k = new Date(ms + 3 * 3600_000);
  return `${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")} on ${shortDate(ts.slice(0, 10))}`;
};

export function AgentCard({ api, door }: { api: AgentApi; door: Door | null }) {
  const [read, setRead] = useState<AgentRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [why, setWhy] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  const open = door?.open === true;
  const load = useCallback(async () => {
    if (!open) return;
    try {
      setRead(await api.read());
      setError(null);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }, [api, open]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: read once per open door
  useEffect(() => {
    void load();
  }, [open]);
  const key = read?.keys.find(k => !k.revokedAt) ?? null;
  // The newest revoked key, when no key is active: the card says so instead of "No key yet".
  const revoked = key ? null : (read?.keys.find(k => k.revokedAt) ?? null);
  const revoke = async () => {
    if (!key) return;
    if (why.trim().length < 3) {
      setSaid("Say why in 3 to 300 characters.");
      return;
    }
    try {
      setSaid(await api.revoke(key.id, why.trim()));
      setAsking(false);
      void load();
    } catch (e) {
      setSaid(String((e as Error)?.message ?? e));
    }
  };
  return (
    <SectionCard
      title="Billing agent login"
      description="The billing agent writes only through its own door. No key is ever shown here."
    >
      {() =>
        !open ? (
          <p className="text-sm text-muted-foreground" data-door-closed>
            {doorLine(door)}
          </p>
        ) : error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : !read ? (
          <Reading words="Reading the agent's login" />
        ) : (
          <div className="grid gap-3 text-sm" data-agent-card>
            {key ? (
              <p>
                Signed in with its own key since{" "}
                {key.addedAt
                  ? shortDate(key.addedAt.slice(0, 10))
                  : "a day not recorded"}{" "}
                · last call {timeOf(key.lastCallAt)} ·{" "}
                {plural(key.callsToday ?? 0, "call")} today
              </p>
            ) : revoked ? (
              <p data-agent-revoked>
                Revoked on{" "}
                {revoked.revokedAt
                  ? shortDate(revoked.revokedAt.slice(0, 10))
                  : "a day not recorded"}
                {revoked.revokedReason ? `: ${revoked.revokedReason}` : ""}. The
                agent cannot write until a new key is set on the server.
              </p>
            ) : (
              <p>
                No key yet. The agent still uses the old access until the next
                deploy step.
              </p>
            )}
            {key && !read.separated ? (
              <p
                className="rounded-lg border px-3 py-2 text-sm"
                style={{
                  borderColor:
                    "color-mix(in srgb, var(--warning) 45%, transparent)",
                }}
                data-not-separated
              >
                {AGENT_NOT_SEPARATED}
              </p>
            ) : null}
            {key ? (
              asking ? (
                <form
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={e => {
                    e.preventDefault();
                    void revoke();
                  }}
                >
                  <label
                    className="grid gap-1 text-xs text-muted-foreground"
                    htmlFor="agent-revoke-why"
                  >
                    Why?
                    <Input
                      id="agent-revoke-why"
                      value={why}
                      onChange={e => setWhy(e.target.value)}
                      maxLength={300}
                      autoFocus
                    />
                  </label>
                  <Button type="submit" size="sm" variant="destructive">
                    Revoke
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setAsking(false)}
                  >
                    Cancel
                  </Button>
                </form>
              ) : (
                <div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive"
                    onClick={() => setAsking(true)}
                  >
                    Revoke
                  </Button>
                </div>
              )
            ) : null}
            {said ? (
              <p className="text-sm" role="status">
                {said}
              </p>
            ) : null}
          </div>
        )
      }
    </SectionCard>
  );
}
