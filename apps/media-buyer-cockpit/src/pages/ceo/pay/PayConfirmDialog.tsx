import { Loader2 } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { decimal, kuwaitDay } from "@/components/ceo/format";
import { KICKER } from "@/components/ceo/Kicker";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, useAction } from "@/lib/cockpitApi";
import { cn } from "@/lib/utils";
import { type Part, pickBand } from "@/types/ceo/payPlan";
import { CheckRow, errorText, FIELD, LABEL, NumberBox } from "./fields";
import { type ConfirmTarget, dayText, payoutLabel } from "./payCopy";

/**
 * "Confirm" (PAY-PLANS.md 8.5, decision 8): a measure whose sources disagree
 * is proposed with the list behind it and confirmed by the CEO. Churn shows
 * every lost card ticked and every candidate (late payment, a long pause)
 * unticked, and the numbers stay editable; the band the figure would pay
 * reads back as it is typed. Owned creative is a list to tick, qualifying
 * clients a count with the data's upper bound offered, a ramp guarantee the
 * contract's first day. The confirmation is stored under its month and
 * audited; removing it puts the part back to missing.
 */

export type ConfirmRequest = ConfirmTarget & {
  person: { personId: number; name: string };
  /** The plan part it feeds, for the band read-back. */
  planPart: Part | null;
  /** The server's proposal (the list behind the measure). */
  proposal: unknown;
  /** Already confirmed: offer to remove it. */
  confirmed: boolean;
  /**
   * The confirmation stored now ({lost, activeAtStart, clients}, {clients},
   * {count}): "Change" starts from it, never from the data's proposal.
   */
  current?: unknown;
  /** Client names by ClickUp id, for ids a confirmation stored without names. */
  names?: Record<string, string>;
  /** The ramp's start the server read, if any. */
  start?: string | null;
};

type Card = {
  clickupId: string;
  name: string;
  why: string | null;
  candidate: boolean;
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const numOr = (v: unknown, d: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : d;

/** The cards behind a churn proposal: losses ticked, candidates not. */
export function churnCards(proposal: unknown): Card[] {
  const p = obj(proposal);
  const one = (x: unknown, candidate: boolean): Card | null => {
    const c = obj(x);
    const id = typeof c.clickupId === "string" ? c.clickupId : null;
    if (!id) return null;
    const term =
      typeof c.dayOfTerm === "number" ? `day ${c.dayOfTerm} of the term` : null;
    const why = [typeof c.why === "string" ? c.why : null, term]
      .filter(Boolean)
      .join(" · ");
    return {
      clickupId: id,
      name: typeof c.name === "string" ? c.name : id,
      why: why || null,
      candidate,
    };
  };
  return [
    ...arr(p.lost).map(x => one(x, false)),
    ...arr(p.candidates).map(x => one(x, true)),
  ].filter((c): c is Card => c !== null);
}

/** The clients behind an owned-creative proposal: theirs ticked, the others not. */
export function ownedCards(proposal: unknown): Card[] {
  const p = obj(proposal);
  const one = (x: unknown, candidate: boolean): Card | null => {
    const c = obj(x);
    const id =
      typeof c.clickupId === "string"
        ? c.clickupId
        : typeof x === "string"
          ? x
          : null;
    if (!id) return null;
    return {
      clickupId: id,
      name: typeof c.name === "string" ? c.name : id,
      why: candidate ? "no script task of theirs on record" : null,
      candidate,
    };
  };
  return [
    ...arr(p.clients).map(x => one(x, false)),
    ...arr(p.others).map(x => one(x, true)),
  ].filter((c): c is Card => c !== null);
}

/** Ids from a stored list: plain ids, or cards with a clickupId. */
const idsOf = (v: unknown): string[] =>
  arr(v)
    .map(x =>
      typeof x === "string"
        ? x
        : typeof obj(x).clickupId === "string"
          ? (obj(x).clickupId as string)
          : null,
    )
    .filter((x): x is string => x !== null);

/**
 * Where the dialog starts: the stored confirmation when there is one (its
 * ticks and its numbers, so "Change" never overwrites them with the data's),
 * else last month's owned clients carried forward (PAY-PLANS.md decision 10),
 * else the data's proposal. Cards the start ticks that the data does not list
 * are added, named from the month's facts.
 */
export function confirmStart(
  request: Pick<ConfirmRequest, "kind" | "proposal" | "current" | "names">,
): {
  cards: Card[];
  ticked: string[];
  from: "confirmed" | "carried" | "data";
  lost: number | null;
  active: number | null;
  count: number | null;
} {
  const p = obj(request.proposal);
  const counts = obj(p.proposal);
  const base =
    request.kind === "churn"
      ? churnCards(request.proposal)
      : request.kind === "owned"
        ? ownedCards(request.proposal)
        : [];
  const current =
    request.current !== null && request.current !== undefined
      ? obj(request.current)
      : null;
  const carried = request.kind === "owned" ? idsOf(p.carried) : [];
  const from: "confirmed" | "carried" | "data" = current
    ? "confirmed"
    : carried.length
      ? "carried"
      : "data";
  const ticked =
    from === "confirmed"
      ? idsOf(current?.clients)
      : from === "carried"
        ? carried
        : base.filter(c => !c.candidate).map(c => c.clickupId);
  const cards = [...base];
  for (const id of ticked)
    if (!cards.some(c => c.clickupId === id))
      cards.push({
        clickupId: id,
        name: request.names?.[id] ?? id,
        why:
          from === "confirmed"
            ? "in your confirmation, not in this month's data"
            : "carried from last month, not in this month's data",
        candidate: false,
      });
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    cards,
    ticked,
    from,
    lost: current ? num(current.lost) : num(counts.lost),
    active: current ? num(current.activeAtStart) : num(counts.activeAtStart),
    count: current ? num(current.count) : num(p.upperBound),
  };
}

/** "5.56%" as a draft the band pick rounds the way the server will. */
export const churnPct = (lost: number, active: number) =>
  active > 0 && Number.isFinite(lost)
    ? ((lost * 100) / active).toFixed(6)
    : null;

export function PayConfirmDialog({
  request,
  onClose,
  onDone,
}: {
  request: ConfirmRequest | null;
  onClose: () => void;
  onDone: (said: string) => Promise<void> | void;
}) {
  return (
    <Dialog open={request !== null} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent className="ceo-root max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {request ? (
          <ConfirmForm
            key={`${request.key}-${request.month}`}
            request={request}
            onClose={onClose}
            onDone={onDone}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ConfirmForm({
  request,
  onClose,
  onDone,
}: {
  request: ConfirmRequest;
  onClose: () => void;
  onDone: (said: string) => Promise<void> | void;
}) {
  const confirm = useAction(api.ceo.pay.confirm);
  const id = useId();
  const [start] = useState(() => confirmStart(request));
  const cards = start.cards;
  const p = obj(request.proposal);
  const [ticked, setTicked] = useState<Set<string>>(
    () => new Set(start.ticked),
  );
  const [lost, setLost] = useState(() =>
    numOr(start.lost, start.ticked.length),
  );
  const [active, setActive] = useState(() =>
    numOr(start.active, arr(p.startSet).length || Number.NaN),
  );
  const [count, setCount] = useState(() => numOr(start.count, Number.NaN));
  const carried = request.kind === "owned" ? idsOf(p.carried) : [];
  const fromData = cards.filter(c => !c.candidate).map(c => c.clickupId);
  const [day, setDay] = useState(
    () =>
      request.start ??
      (typeof p.day === "string" ? p.day : null) ??
      kuwaitDay(),
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const toggle = (cid: string, on: boolean) => {
    const next = new Set(ticked);
    if (on) next.add(cid);
    else next.delete(cid);
    setTicked(next);
    // The count follows the ticks; it stays editable after.
    if (request.kind === "churn")
      setLost(cards.filter(c => next.has(c.clickupId)).length);
  };

  const pct = churnPct(lost, active);
  const band =
    request.kind === "churn" && pct && request.planPart?.kind === "band"
      ? pickBand(request.planPart.bands, pct)
      : null;

  /** The value stored, or a sentence saying what is missing. */
  const value = (): { value: unknown } | { problem: string } => {
    if (request.kind === "churn") {
      if (!Number.isInteger(lost) || lost < 0)
        return { problem: "Type how many were lost, a whole number." };
      if (!Number.isInteger(active) || active <= 0)
        return { problem: "Type how many clients there were at the start." };
      return {
        value: { lost, activeAtStart: active, clients: [...ticked] },
      };
    }
    if (request.kind === "owned") return { value: { clients: [...ticked] } };
    if (request.kind === "qualifying") {
      if (!Number.isInteger(count) || count < 0)
        return { problem: "Type the count, a whole number." };
      return { value: { count } };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
      return { problem: "Pick the contract's first day." };
    return { value: { day } };
  };

  const send = async (remove: boolean) => {
    const v = remove ? { value: null } : value();
    if ("problem" in v) {
      setMsg(v.problem);
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await confirm({
        // A ramp start is stored under its own month.
        month:
          request.kind === "ramp" && !remove ? day.slice(0, 7) : request.month,
        key: request.key,
        value: v.value,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onClose();
      await onDone(
        remove
          ? `Removed the confirmation: ${request.title.toLowerCase()}.`
          : `Confirmed: ${request.title.toLowerCase()}.`,
      );
    } catch (e) {
      setMsg(errorText(e, "It was not confirmed."));
    } finally {
      setBusy(false);
    }
  };

  let body: ReactNode = null;
  if (request.kind === "churn")
    body = (
      <>
        <div className="flex flex-wrap items-end gap-4">
          <div className="grid gap-1">
            <span className={LABEL}>Lost</span>
            <NumberBox
              value={lost}
              onChange={setLost}
              label="Clients lost"
              width="w-20"
              integer
            />
          </div>
          <div className="grid gap-1">
            <span className={LABEL}>Clients at the start</span>
            <NumberBox
              value={active}
              onChange={setActive}
              label="Clients at the start of the month"
              width="w-20"
              integer
            />
          </div>
          <p className="pb-2 text-sm" aria-live="polite">
            <span className="font-mono font-semibold tabular-nums">
              {pct === null ? "n/a" : `${decimal(Number(pct), 2)}%`}
            </span>
            {band && band.amount !== null ? (
              <span className="text-muted-foreground">{` · pays ${payoutLabel(band.amount)}`}</span>
            ) : null}
          </p>
        </div>
        <CardList
          cards={cards}
          ticked={ticked}
          onToggle={toggle}
          empty="No card was lost or late this month on the data."
          heading="Lost, and candidates (late payment or a long pause)"
        />
      </>
    );
  else if (request.kind === "owned")
    body = (
      <>
        {start.from !== "data" || carried.length ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {start.from === "confirmed"
                ? "Ticked as you confirmed them."
                : start.from === "carried"
                  ? "Ticked as last month, carried forward."
                  : "Ticked as the data proposes."}
            </span>
            {carried.length ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setTicked(new Set(carried))}
              >
                Same as last month
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setTicked(new Set(fromData))}
            >
              As the data proposes
            </Button>
          </div>
        ) : null}
        <CardList
          cards={cards}
          ticked={ticked}
          onToggle={toggle}
          empty="No client of the month has a script task of theirs on record. Tick none to confirm that."
          heading="Clients whose running creative they own"
        />
      </>
    );
  else if (request.kind === "qualifying")
    body = (
      <div className="grid gap-2">
        <div className="grid gap-1">
          <span className={LABEL}>Qualifying clients</span>
          <NumberBox
            value={count}
            onChange={setCount}
            label="Qualifying clients"
            width="w-20"
            integer
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {typeof p.upperBound === "number"
            ? `The data says at most ${p.upperBound}: active on every day of the last 30 and not behind on payment${arr(p.paymentNotChecked).length ? `; ${arr(p.paymentNotChecked).length} with no payment record to check` : ""}.`
            : "The data could not give an upper bound this month."}
        </p>
      </div>
    );
  else
    body = (
      <div className="grid gap-1">
        <span className={LABEL}>Contract start</span>
        <DateInput
          value={day}
          onChange={e => setDay(e.target.value)}
          aria-label="The contract's first day"
          className="ceo-select-md w-48"
        />
        <span className="text-xs text-muted-foreground">
          {request.start
            ? `Read as ${dayText(request.start)} so far.`
            : "The roster's added day is not a contract date: type the contract's."}
        </span>
      </div>
    );

  return (
    <form
      className="grid gap-4"
      onSubmit={e => {
        e.preventDefault();
        void send(false);
      }}
    >
      <DialogHeader className="pr-8">
        <DialogTitle>{request.title}</DialogTitle>
        <DialogDescription>
          {`For ${request.person.name}. Kept with your name and the day; it changes the month it is for, never an approved one.`}
        </DialogDescription>
      </DialogHeader>
      {body}
      <label htmlFor={`${id}-note`} className="grid gap-1">
        <span className={LABEL}>Note (optional)</span>
        <input
          id={`${id}-note`}
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Why, if it differs from the data"
          className={cn(FIELD, "w-full")}
          maxLength={300}
        />
      </label>
      {msg ? (
        <p role="alert" className="text-sm text-[var(--ceo-critical)]">
          {msg}
        </p>
      ) : null}
      <DialogFooter className="gap-2">
        {request.confirmed ? (
          <Button
            type="button"
            variant="ghost"
            className="text-muted-foreground sm:mr-auto"
            disabled={busy}
            onClick={() => void send(true)}
          >
            Remove the confirmation
          </Button>
        ) : null}
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Confirm
        </Button>
      </DialogFooter>
    </form>
  );
}

function CardList({
  cards,
  ticked,
  onToggle,
  empty,
  heading,
}: {
  cards: Card[];
  ticked: Set<string>;
  onToggle: (id: string, on: boolean) => void;
  empty: string;
  heading: string;
}) {
  return (
    <div className="grid gap-1.5">
      <span className={KICKER}>{heading}</span>
      {cards.length ? (
        <ul className="grid gap-1">
          {cards.map(c => (
            <li key={c.clickupId}>
              <CheckRow
                checked={ticked.has(c.clickupId)}
                onChange={on => onToggle(c.clickupId, on)}
                align="start"
                className="rounded-md px-1 py-1.5 text-sm hover:bg-muted/40"
              >
                <span className="block">
                  {c.name}
                  {c.candidate ? (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      candidate
                    </span>
                  ) : null}
                </span>
                {c.why ? (
                  <span className="block text-xs text-muted-foreground">
                    {c.why}
                  </span>
                ) : null}
              </CheckRow>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}
