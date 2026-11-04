/* Hallmark · component: Wins card, Log a win sheet, tie dialog, Money tab wins, Offer Studio stage strip, Client is back, Today bands · genre: modern-minimal · theme: the cockpit's own (Geist, --mahara-teal)
 * states: default · hover · focus-visible · active · disabled (with its reason) · loading · error · success
 * Hallmark · pre-emit critique: P5 H4 E4 S5 R5 V4
 *
 * The wins ledger on the client page, the Money tab and Offer Studio, and
 * Client is back (docs/forms/WAVE56-CONTRACT.md 4.2, 4.3, 4.12, 5.1 to 5.3,
 * 5.11, 5.12). Every call goes through a WinsApi (the live one is winsApi
 * below), so the tests and the harness pass stand-ins. A door that is not
 * open makes no call and says why in one line ("Opens after the next
 * cockpit update." while its functions are missing, "Not switched on yet."
 * once only its switch is off). The design plan is WinRibbon.tsx's.
 */

import { LoaderCircle, Plus } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Chip, Pill, SectionCard, StatTile } from "@/components/kit";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { WinRibbon } from "@/components/WinRibbon";
import { FormSheet } from "@/forms/staff/FormSheet";
import {
  type Departure,
  reactivateDef,
  type WinContext,
  winDef,
} from "@/forms/staff/formDefs";
import type {
  Answers,
  CallPick,
  FormTrailRow,
  Prefill,
  SubmitRef,
} from "@/forms/staff/formSheetCore";
import { cn } from "@/lib/utils";
import {
  linkInvoice,
  logWin,
  markOffered,
  offeredArgs,
  proposeTie,
  tieCandidates,
  trailOf,
  type WinsClient,
  type WinsRead,
  winStage,
  winsList,
  winsRead,
} from "@/lib/wins";
import {
  actionsOf,
  type Band,
  candidateChips,
  candidateLine,
  type Door,
  doorLine,
  kuwaitToday,
  type LogAnswer,
  money,
  mrrPrompt,
  type ReactivateState,
  rangeOf,
  SAY,
  type TieCandidate,
  type WinRow,
  type WinTotals,
} from "@/lib/winsCore";

// --- The api ----------------------------------------------------------------------------

export type WinsApi = {
  read: (taskId: string) => Promise<WinsRead>;
  list: (
    from: string,
    to: string,
  ) => Promise<{ wins: WinRow[]; totals: WinTotals }>;
  log: (
    taskId: string,
    a: Answers,
    requestId: string,
    ctx: Pick<WinContext, "proposals">,
  ) => Promise<LogAnswer & { ref: SubmitRef }>;
  stage: (p: {
    requestId: string;
    winId: string;
    act: "accept" | "void" | "proof";
    agreementUrl?: string | null;
    reason?: string | null;
    proofUrl?: string | null;
  }) => Promise<string>;
  candidates: (winId: string) => Promise<TieCandidate[]>;
  propose: (p: {
    requestId: string;
    winId: string;
    paymentId: string;
  }) => Promise<string>;
  trail: (ref: SubmitRef) => Promise<FormTrailRow>;
  offered: (args: ReturnType<typeof offeredArgs>) => Promise<LogAnswer>;
  linkInvoice: (winId: string, invoiceId: string) => Promise<void>;
};

export function winsApi(c: WinsClient): WinsApi {
  return {
    read: taskId => winsRead(c, taskId),
    list: (from, to) => winsList(c, from, to),
    log: (taskId, a, requestId, ctx) => logWin(c, taskId, a, requestId, ctx),
    stage: p => winStage(c, p),
    candidates: winId => tieCandidates(c, winId),
    propose: p => proposeTie(c, p),
    trail: ref => trailOf(c, ref),
    offered: args => markOffered(c, args),
    linkInvoice: (winId, invoiceId) => linkInvoice(c, winId, invoiceId),
  };
}

function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, ch => {
    const n = Number(ch);
    return (n ^ ((Math.random() * 16) >> (n / 4))).toString(16);
  });
}

const said = (e: unknown, fallback: string) => {
  const msg = String((e as Error)?.message ?? e ?? "").trim();
  if (
    /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(
      msg,
    )
  )
    return fallback;
  return msg || fallback;
};

/** The line a closed door shows; nothing is called behind it. */
export function DoorNote({
  door,
  className,
}: {
  door: Door | null;
  className?: string;
}) {
  const line = doorLine(door);
  if (!line) return null;
  return (
    <p
      className={cn("text-sm text-muted-foreground", className)}
      data-door-closed
    >
      {line}
    </p>
  );
}

// --- Log a win (5.1) ----------------------------------------------------------------------

export function LogWinSheet({
  open,
  onOpenChange,
  api,
  taskId,
  client,
  context,
  preset,
  onSent,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  api: WinsApi;
  taskId: string;
  client: string;
  context: Pick<WinContext, "proposals" | "deals">;
  /** A kind or proposal to start on (Today's "Log it" on a done review ask: review). */
  preset?: Prefill[];
  onSent?: (message: string) => void;
}) {
  const def = useMemo(
    () =>
      winDef({ client, proposals: context.proposals, deals: context.deals }),
    [client, context.proposals, context.deals],
  );
  if (!open) return null;
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      def={def}
      client={{ taskId, name: client }}
      prefill={preset ?? []}
      submit={async (a, requestId) => {
        const out = await api.log(taskId, a, requestId, context);
        if (!out.ok) return { message: "", ref: {}, warning: out.warning };
        toast.success(out.sentence);
        return { message: out.sentence.replace(/\.$/, ""), ref: out.ref };
      }}
      trail={api.trail}
      onSent={onSent}
    />
  );
}

// --- Wins on the client page (5.2) ---------------------------------------------------------

type Ask =
  | { kind: "accept"; win: WinRow }
  | { kind: "void"; win: WinRow }
  | { kind: "tie"; win: WinRow };

export function ClientWins({
  api,
  door,
  taskId,
  client,
  ceo = false,
  onSetMrr,
  onInvoice,
  reloadKey = 0,
  onRead,
}: {
  api: WinsApi | null;
  door: Door | null;
  taskId: string;
  client: string;
  ceo?: boolean;
  /** Opens W12's Set MRR prefilled (reason upsell, the win's id). */
  onSetMrr?: (p: { monthlyUsd: number; winId: string }) => void;
  /** Opens the CSM invoice desk prefilled; resolves with the new invoice's id. */
  onInvoice?: (win: WinRow) => Promise<string | null>;
  reloadKey?: number;
  /** The read, for the page's Log a win (what it can pick from). */
  onRead?: (r: WinsRead) => void;
}) {
  const [read, setRead] = useState<WinsRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const open = door?.open === true;
  const readRef = useRef(onRead);
  readRef.current = onRead;

  const load = useCallback(async () => {
    if (!api || !open) return;
    setError(null);
    try {
      const r = await api.read(taskId);
      setRead(r);
      readRef.current?.(r);
    } catch (e) {
      setError(
        said(
          e,
          "The wins could not be read. Check your connection and try again.",
        ),
      );
    }
  }, [api, open, taskId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey reads again
  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const done = (sentence: string) => {
    setNotice(sentence);
    toast.success(sentence);
    setAsk(null);
    void load();
  };

  let body: ReactNode;
  if (!open) body = <DoorNote door={door} />;
  else if (error)
    body = (
      <div className="grid gap-2">
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
        <div>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      </div>
    );
  else if (!read)
    body = (
      <p
        className="flex items-center gap-2 text-sm text-muted-foreground"
        role="status"
      >
        <LoaderCircle
          className="size-4 animate-spin motion-reduce:animate-none"
          aria-hidden
        />
        Reading the wins
      </p>
    );
  else if (!read.wins.length)
    body = (
      <p className="text-sm text-muted-foreground">
        No wins yet. Log one with Log a win.
      </p>
    );
  else
    body = (
      <ol className="grid divide-y">
        {[...read.wins]
          .sort((a, b) =>
            String(b.wonOn ?? "").localeCompare(String(a.wonOn ?? "")),
          )
          .map(w => (
            <li key={w.id} className="py-3 first:pt-0 last:pb-0">
              <WinRibbon
                win={w}
                actions={
                  <WinActions
                    win={w}
                    ceo={ceo}
                    onAsk={setAsk}
                    onSetMrr={onSetMrr}
                    onInvoice={
                      onInvoice && api
                        ? async () => {
                            try {
                              const id = await onInvoice(w);
                              if (!id) return;
                              await api.linkInvoice(w.id, id);
                              done("Invoice linked to the win.");
                            } catch (e) {
                              setNotice(
                                said(
                                  e,
                                  "The invoice could not be linked. Try again.",
                                ),
                              );
                            }
                          }
                        : undefined
                    }
                  />
                }
              />
            </li>
          ))}
      </ol>
    );

  return (
    <SectionCard
      title="Wins"
      count={
        read && open
          ? read.wins.filter(w => w.stage !== "void").length
          : undefined
      }
      sub="Reviews, testimonials, referrals, renewals and upsells, each with its proof."
    >
      <div
        className="grid gap-3"
        data-client-wins
        role="group"
        aria-label={`${client}: wins`}
      >
        {body}
        {notice ? (
          <p className="text-sm" role="status">
            {notice}
          </p>
        ) : null}
      </div>
      {api && ask?.kind === "accept" ? (
        <ReasonDialog
          title="Mark it accepted"
          label="Signed agreement link"
          placeholder="https://"
          submit="Mark accepted"
          check={v =>
            /^https:\/\/\S+$/i.test(v.trim()) ? null : SAY.acceptNeeds
          }
          onClose={() => setAsk(null)}
          onSubmit={async (v, requestId) =>
            done(
              await api.stage({
                requestId,
                winId: ask.win.id,
                act: "accept",
                agreementUrl: v,
              }),
            )
          }
        />
      ) : null}
      {api && ask?.kind === "void" ? (
        <ReasonDialog
          title="Void this win"
          label="Why are you voiding it?"
          submit="Void"
          destructive
          check={v => {
            const n = v.trim().length;
            return n >= 3 && n <= 300 ? null : SAY.voidReason;
          }}
          onClose={() => setAsk(null)}
          onSubmit={async (v, requestId) =>
            done(
              await api.stage({
                requestId,
                winId: ask.win.id,
                act: "void",
                reason: v,
              }),
            )
          }
        />
      ) : null}
      {api && ask?.kind === "tie" ? (
        <TieDialog
          api={api}
          win={ask.win}
          onClose={() => setAsk(null)}
          onDone={done}
        />
      ) : null}
    </SectionCard>
  );
}

function WinActions({
  win,
  ceo,
  onAsk,
  onSetMrr,
  onInvoice,
}: {
  win: WinRow;
  ceo: boolean;
  onAsk: (a: Ask) => void;
  onSetMrr?: (p: { monthlyUsd: number; winId: string }) => void;
  onInvoice?: () => void;
}) {
  const acts = actionsOf(win);
  const prompt = mrrPrompt(win);
  const out: ReactNode[] = [];
  for (const a of acts) {
    if (a === "accept")
      out.push(
        <Button
          key="accept"
          size="sm"
          variant="outline"
          onClick={() => onAsk({ kind: "accept", win })}
        >
          Mark accepted
        </Button>,
      );
    if (a === "invoice" && onInvoice)
      out.push(
        <Button key="invoice" size="sm" variant="outline" onClick={onInvoice}>
          Invoice this
        </Button>,
      );
    if (a === "tie")
      out.push(
        <Button
          key="tie"
          size="sm"
          variant="outline"
          onClick={() => onAsk({ kind: "tie", win })}
        >
          Tie a payment
        </Button>,
      );
    if (a === "mrr" && prompt && onSetMrr && win.monthlyUsd !== null)
      out.push(
        <Button
          key="mrr"
          size="sm"
          variant="outline"
          onClick={() =>
            onSetMrr({ monthlyUsd: win.monthlyUsd as number, winId: win.id })
          }
        >
          {prompt}
        </Button>,
      );
    if (a === "void")
      out.push(
        <Button
          key="void"
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={() => onAsk({ kind: "void", win })}
        >
          Void
        </Button>,
      );
  }
  // A paid win voids only for the CEO, after its tie is cleared (the database says so).
  if (win.stage === "paid" && ceo)
    out.push(
      <Button
        key="void"
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        onClick={() => onAsk({ kind: "void", win })}
      >
        Void
      </Button>,
    );
  return out.length ? out : null;
}

/** One question, one field, one press: Mark accepted's link and Void's reason. */
function ReasonDialog({
  title,
  label,
  placeholder,
  submit,
  destructive,
  check,
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  placeholder?: string;
  submit: string;
  destructive?: boolean;
  check: (v: string) => string | null;
  onClose: () => void;
  onSubmit: (v: string, requestId: string) => Promise<void>;
}) {
  const id = useId();
  const requestId = useRef(newRequestId());
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const go = async () => {
    const p = check(value);
    if (p) return setProblem(p);
    setBusy(true);
    setProblem(null);
    try {
      await onSubmit(value.trim(), requestId.current);
    } catch (e) {
      setProblem(
        said(e, `Not saved. Check your connection and press ${submit} again.`),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={o => (o ? null : onClose())}>
      <DialogContent className="w-[min(480px,calc(100vw-2rem))]">
        <DialogTitle className="text-[15px]">{title}</DialogTitle>
        <DialogDescription className="sr-only">{label}</DialogDescription>
        <form
          className="grid gap-3"
          onSubmit={e => {
            e.preventDefault();
            void go();
          }}
        >
          <label
            htmlFor={id}
            className="text-xs font-medium text-muted-foreground"
          >
            {label}
          </label>
          <Input
            id={id}
            value={value}
            placeholder={placeholder}
            onChange={e => setValue(e.target.value)}
            aria-invalid={problem ? true : undefined}
            autoFocus
          />
          {problem ? (
            <p className="text-sm text-destructive" role="alert">
              {problem}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              size="sm"
              variant={destructive ? "destructive" : "default"}
              disabled={busy}
            >
              {busy ? (
                <LoaderCircle
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              ) : null}
              {submit}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Tie a payment (5.2): the win's card's payments, not-checked and closer chips, sent to the CEO. */
export function TieDialog({
  api,
  win,
  onClose,
  onDone,
}: {
  api: Pick<WinsApi, "candidates" | "propose">;
  win: WinRow;
  onClose: () => void;
  onDone: (sentence: string) => void;
}) {
  const requestId = useRef(newRequestId());
  const [list, setList] = useState<TieCandidate[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api
      .candidates(win.id)
      .then(l => live && setList(l))
      .catch(
        e =>
          live &&
          setProblem(said(e, "The payments could not be read. Try again.")),
      );
    return () => {
      live = false;
    };
  }, [api, win.id]);
  const send = async () => {
    if (!pick) return setProblem("Pick the payment that paid for this.");
    setBusy(true);
    setProblem(null);
    try {
      onDone(
        await api.propose({
          requestId: requestId.current,
          winId: win.id,
          paymentId: pick,
        }),
      );
    } catch (e) {
      setProblem(
        said(
          e,
          "Not sent. Check your connection and press Send to the CEO again.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        className="w-[min(560px,calc(100vw-2rem))]"
        data-tie-dialog
      >
        <DialogTitle className="text-[15px]">
          Tie a payment to the {win.kindLabel}
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          The CEO confirms the tie. Only a checked payment can be confirmed.
        </DialogDescription>
        {list === null && !problem ? (
          <p className="text-sm text-muted-foreground" role="status">
            Reading the payments on this card
          </p>
        ) : list && !list.length ? (
          <p className="text-sm text-muted-foreground">
            No payment on this card can be tied yet. When the client pays, it
            shows here.
          </p>
        ) : list ? (
          <fieldset className="grid gap-2">
            <legend className="sr-only">Payments on this card</legend>
            {list.map(c => (
              <label
                key={c.paymentId}
                className={cn(
                  "flex cursor-pointer flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                  pick === c.paymentId
                    ? "border-mahara-teal bg-mahara-teal/10"
                    : "hover:bg-muted",
                )}
                data-candidate={c.paymentId}
              >
                <input
                  type="radio"
                  name={`tie-${win.id}`}
                  checked={pick === c.paymentId}
                  onChange={() => setPick(c.paymentId)}
                  className="accent-[var(--mahara-teal)]"
                />
                <span className="font-mono tabular-nums">
                  {candidateLine(c)}
                </span>
                {candidateChips(c).map(chip => (
                  <Chip key={chip} tone="warn">
                    {chip}
                  </Chip>
                ))}
              </label>
            ))}
          </fieldset>
        ) : null}
        {problem ? (
          <p className="text-sm text-destructive" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => void send()}
            disabled={busy || !list?.length}
          >
            {busy ? (
              <LoaderCircle
                className="animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            ) : null}
            Send to the CEO
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The Log a win button for a page header or the client page's actions. */
export function LogWinButton({
  door,
  onClick,
}: {
  door: Door | null;
  onClick: () => void;
}) {
  if (door?.open !== true)
    return (
      <span className="text-xs text-muted-foreground" data-door-closed>
        Log a win: {doorLine(door)}
      </span>
    );
  return (
    <Button size="sm" onClick={onClick} data-log-win>
      <Plus aria-hidden />
      Log a win
    </Button>
  );
}

// --- The Money tab (5.2) ----------------------------------------------------------------------

export function MoneyWins({
  api,
  door,
  now,
}: {
  api: WinsApi | null;
  door: Door | null;
  now?: number;
}) {
  const today = kuwaitToday(now);
  const [preset, setPreset] = useState<"this" | "last" | "pick">("this");
  const [picked, setPicked] = useState(() => rangeOf("this", today));
  const range = preset === "pick" ? picked : rangeOf(preset, today);
  const [data, setData] = useState<{
    wins: WinRow[];
    totals: WinTotals;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = door?.open === true;
  useEffect(() => {
    if (!api || !open) return;
    let live = true;
    setData(null);
    setError(null);
    api
      .list(range.from, range.to)
      .then(d => live && setData(d))
      .catch(
        e =>
          live && setError(said(e, "The wins could not be read. Try again.")),
      );
    return () => {
      live = false;
    };
  }, [api, open, range.from, range.to]);
  const t = data?.totals;
  return (
    <SectionCard
      title="Wins"
      sub="Every win logged across your clients, with where each upsell stands."
      action={
        open ? (
          <div
            className="flex flex-wrap gap-1"
            role="group"
            aria-label="Which days"
          >
            <Pill active={preset === "this"} onClick={() => setPreset("this")}>
              This month
            </Pill>
            <Pill active={preset === "last"} onClick={() => setPreset("last")}>
              Last month
            </Pill>
            <Pill active={preset === "pick"} onClick={() => setPreset("pick")}>
              Pick dates
            </Pill>
          </div>
        ) : null
      }
    >
      {!open ? (
        <DoorNote door={door} />
      ) : (
        <div className="grid gap-4" data-money-wins>
          {preset === "pick" ? (
            <div className="flex flex-wrap items-end gap-3 text-xs">
              <label className="grid gap-1" htmlFor="wins-from">
                From
                <Input
                  id="wins-from"
                  type="date"
                  value={picked.from}
                  max={today}
                  onChange={e =>
                    setPicked(p => ({ ...p, from: e.target.value }))
                  }
                />
              </label>
              <label className="grid gap-1" htmlFor="wins-to">
                To
                <Input
                  id="wins-to"
                  type="date"
                  value={picked.to}
                  max={today}
                  onChange={e => setPicked(p => ({ ...p, to: e.target.value }))}
                />
              </label>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4 sm:grid-cols-4">
            <StatTile
              plain
              label="Upsells offered"
              value={t ? count(t.upsellsOffered) : "…"}
            />
            <StatTile
              plain
              label="Accepted"
              value={t ? count(t.upsellsAccepted) : "…"}
            />
            <StatTile
              plain
              label="Upsell cash (checked)"
              value={t ? money(t.upsellCashChecked) : "…"}
            />
            <StatTile
              plain
              label="Reviews and testimonials"
              value={t ? count(t.reviewsAndTestimonials) : "…"}
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : !data ? (
            <p className="text-sm text-muted-foreground" role="status">
              Reading the wins
            </p>
          ) : !data.wins.length ? (
            <p className="text-sm text-muted-foreground">
              No wins in these days. Log one from a client's page.
            </p>
          ) : (
            <ol className="grid divide-y">
              {data.wins.map(w => (
                <li key={w.id} className="py-3 first:pt-0 last:pb-0">
                  <WinRibbon win={w} client={w.client} />
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </SectionCard>
  );
}

const count = (n: number | null) => (n === null ? "not known" : String(n));

// --- Offer Studio's stage strip (5.3) -----------------------------------------------------------

export type ProposalFacts = {
  id: string;
  taskId: string;
  status: string;
  /** The win kind this offer logs as (upsell_website, upsell_smm, …). */
  kind: string;
  totalUsd: number | null;
  listUsd: number | null;
};

/** The win kind an Offer Studio offer logs as; null for an offer that is not an upsell kind. */
export function upsellKindOf(offerKey: string): string | null {
  const k = String(offerKey ?? "").toLowerCase();
  if (k.includes("website") || k.includes("web")) return "upsell_website";
  if (k.includes("smm") || k.includes("social")) return "upsell_smm";
  if (k.includes("backend") || k.includes("back_end") || k.includes("academy"))
    return "upsell_backend";
  if (k.includes("seo") || k.includes("geo")) return "upsell_seo_geo";
  if (k.includes("campaign")) return "upsell_second_campaign";
  return null;
}

export function MarkOffered({
  api,
  door,
  proposal,
  win,
  onMarked,
  now,
}: {
  api: Pick<WinsApi, "offered"> | null;
  door: Door | null;
  proposal: ProposalFacts;
  /** The win this proposal already made, once offered. */
  win: WinRow | null;
  onMarked?: (sentence: string) => void;
  now?: number;
}) {
  const requestId = useRef(newRequestId());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [mine, setMine] = useState<string | null>(null);
  if (door?.open !== true) return <DoorNote door={door} className="text-xs" />;
  const draft = proposal.status === "draft";
  const accepted =
    proposal.status === "accepted" &&
    win?.stage !== "signed" &&
    win?.stage !== "paid";
  const mark = async () => {
    if (!api || draft) return;
    setBusy(true);
    setProblem(null);
    try {
      const out = await api.offered(
        offeredArgs(
          proposal.taskId,
          {
            proposalId: proposal.id,
            kind: proposal.kind,
            totalUsd: proposal.totalUsd,
            listUsd: proposal.listUsd,
          },
          requestId.current,
          kuwaitToday(now),
        ),
      );
      const sentence = out.ok ? out.sentence : out.warning;
      setMine(sentence);
      toast.success(sentence);
      onMarked?.(sentence);
    } catch (e) {
      setProblem(
        said(
          e,
          "Not saved. Check your connection and press Mark as offered again.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-2" data-mark-offered>
      {accepted ? (
        <p
          className="rounded-lg border border-mahara-teal/50 bg-mahara-teal/10 px-3 py-2 text-sm"
          role="status"
        >
          The client accepted. Send the agreement, then mark it accepted with
          the agreement link.
        </p>
      ) : null}
      {win ? (
        <WinRibbon win={win} />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void mark()}
            disabled={draft || busy}
            aria-describedby={draft ? `${proposal.id}-draft` : undefined}
          >
            {busy ? (
              <LoaderCircle
                className="animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            ) : null}
            Mark as offered
          </Button>
          {draft ? (
            <span
              id={`${proposal.id}-draft`}
              className="text-xs text-muted-foreground"
            >
              {SAY.draft}
            </span>
          ) : null}
        </div>
      )}
      {mine ? (
        <p className="text-sm" role="status">
          {mine}
        </p>
      ) : null}
      {problem ? (
        <p className="text-sm text-destructive" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

// --- Client is back (5.11) -------------------------------------------------------------------

export function ReactivateAction({
  state,
  door,
  onOpen,
}: {
  state: ReactivateState;
  door: Door | null;
  onOpen: () => void;
}) {
  if (!state.show) return null;
  if (door?.open !== true)
    return (
      <span className="text-xs text-muted-foreground" data-door-closed>
        Client is back: {doorLine(door)}
      </span>
    );
  if (!state.enabled)
    return (
      <span
        className="inline-flex flex-wrap items-center gap-2"
        data-reactivate="disabled"
      >
        <Button
          size="sm"
          variant="outline"
          disabled
          aria-describedby="reactivate-why"
        >
          Client is back
        </Button>
        <span id="reactivate-why" className="text-xs text-muted-foreground">
          {state.why}
        </span>
      </span>
    );
  return (
    <Button size="sm" variant="outline" onClick={onOpen} data-reactivate="open">
      Client is back
    </Button>
  );
}

export function ReactivateSheet({
  open,
  onOpenChange,
  taskId,
  client,
  departure,
  calls,
  submit,
  trail,
  onSent,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  taskId: string;
  client: string;
  departure: Departure;
  calls?: CallPick[];
  submit: (
    a: Answers,
    requestId: string,
  ) => Promise<{ message: string; ref: SubmitRef }>;
  trail: (ref: SubmitRef) => Promise<FormTrailRow>;
  onSent?: (message: string) => void;
}) {
  const def = useMemo(
    () => reactivateDef(client, departure),
    [client, departure],
  );
  if (!open) return null;
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      def={def}
      client={{ taskId, name: client }}
      prefill={[]}
      calls={calls}
      submit={async (a, requestId) => {
        const out = await submit(a, requestId);
        toast.success(SAY.reactivated);
        return out;
      }}
      trail={trail}
      onSent={onSent}
    />
  );
}

// --- Today bands (5.12) -------------------------------------------------------------------------

export function WinBands({
  bands,
  onAction,
}: {
  bands: Band[];
  onAction: (b: Band) => void;
}) {
  if (!bands.length) return null;
  return (
    <ul
      className="grid gap-2"
      data-win-bands
      aria-label="Wins and receipts to act on"
    >
      {bands.map(b => (
        <li
          key={b.key}
          data-band={b.kind}
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border bg-card px-4 py-3 text-sm"
        >
          <span className="min-w-0 flex-1 basis-64" dir="auto">
            {b.text}
          </span>
          <Button size="sm" variant="outline" onClick={() => onAction(b)}>
            {b.action}
          </Button>
        </li>
      ))}
    </ul>
  );
}
