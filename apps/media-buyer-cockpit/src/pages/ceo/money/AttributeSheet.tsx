import { Check, Loader2, Search } from "lucide-react";
import { type ReactNode, useId, useMemo, useState } from "react";
import { money, NA, plural, shortDate } from "@/components/ceo/format";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  type PaymentTie,
  tiedSentence,
  tiePayload,
} from "@/lib/ceoMoneyClient";
import { api, useAction, useQueryState } from "@/lib/cockpitApi";
import { cn } from "@/lib/utils";
import type { TieRef } from "@/types/ceo/payloads";
import {
  creditLine,
  dealOptions,
  linesForPayer,
  type MoneyLine,
  type PendingTie,
  payerScope,
  payerTieOf,
  pendingFor,
  pendingForPayer,
  pendingWords,
  restsOn,
  type SignedDeal,
  searchDeals,
  type TieTarget,
  tiePreview,
  UNTIED_SENTENCE,
} from "./credit";
import { readSignedDeals } from "./dealsRead";

/**
 * The Attribute sheet (MONEY-ATTRIBUTION.md section 2): tie one payment, or
 * every payment from its payer, to a signed deal, a client card, or "not
 * client money", with a note; see what the tie will credit before saving;
 * remove a tie. A side panel on a laptop, the whole screen on a phone. The
 * tie is read by the next money refresh, so after saving the sheet says when
 * it shows and does not start a refresh itself.
 */

export type AttributeSubject =
  /** One money-in row of the Transactions tab. */
  | { kind: "payment"; line: MoneyLine }
  /** A payer from the Money tab's "Who these payers are": their email or billing name. */
  | { kind: "payer"; payer: string };

type Target = TieTarget["kind"];

const RAIL: Record<MoneyLine["rail"], string> = {
  whop: "Whop",
  tap: "Tap",
  transfer: "bank transfer",
  manual: "logged by hand",
  bank: "bank",
};

const field =
  "w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

function errorText(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  return raw.split("\n")[0].trim() || fallback;
}

export function AttributeSheet({
  subject,
  lines,
  lastRefreshAt,
  startWith,
  pending,
  onTied,
  onClose,
}: {
  subject: AttributeSubject | null;
  /** The Money section's published lines, for what is tied so far and the preview. */
  lines: MoneyLine[];
  /** When the Money section last published, epoch ms. */
  lastRefreshAt: number | null;
  /** Which target the sheet opens on (the Money tab's payer list opens on a signed deal). */
  startWith?: Target;
  /** Ties saved this session that the published lines do not show yet. */
  pending?: PendingTie[];
  /** A tie saved or removed here, for the rows to say at once. */
  onTied?: (p: PendingTie) => void;
  onClose: () => void;
}) {
  const key = !subject
    ? ""
    : subject.kind === "payment"
      ? `payment:${subject.line.id}`
      : `payer:${subject.payer}`;
  return (
    <Sheet
      open={subject !== null}
      onOpenChange={open => (open ? null : onClose())}
    >
      <SheetContent
        side="right"
        className="ceo-root w-full max-w-none overflow-y-auto p-0 sm:max-w-xl"
      >
        {subject ? (
          <AttributeBody
            key={key}
            subject={subject}
            lines={lines}
            lastRefreshAt={lastRefreshAt}
            startWith={startWith}
            pending={pending}
            onTied={onTied}
            onClose={onClose}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Part({
  title,
  children,
  id,
}: {
  title: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="grid gap-2" aria-labelledby={id}>
      <h3 id={id} className="text-xs font-medium text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** A credit line as the Transactions tab prints it, so before and after read alike. */
function Receipt({
  children,
  tone = "plain",
}: {
  children: ReactNode;
  tone?: "plain" | "next";
}) {
  return (
    <div
      className={cn(
        "rounded-md border-l-2 px-3 py-2 text-sm leading-relaxed",
        tone === "next"
          ? "border-[var(--ceo-emphasis)] bg-[var(--ceo-emphasis-wash)]"
          : "border-[color:var(--ceo-grid)] bg-[var(--ceo-hover)]",
      )}
    >
      {children}
    </div>
  );
}

/** The sheet's content, inside a Sheet: exported for the screen test, which renders it without the portal. */
export function AttributeBody({
  subject,
  lines,
  lastRefreshAt,
  startWith,
  pending = [],
  onTied,
  onClose,
}: {
  subject: AttributeSubject;
  lines: MoneyLine[];
  lastRefreshAt: number | null;
  startWith?: Target;
  pending?: PendingTie[];
  onTied?: (p: PendingTie) => void;
  onClose: () => void;
}) {
  const tie = useAction(api.ceo.money.tie);
  const untie = useAction(api.ceo.money.untie);
  const deals = useQueryState<SignedDeal[]>(readSignedDeals, {});
  const cards = useQueryState<{ name: string; clickupTaskId: string }[]>(
    api.ceo.manualPayments.clientOptions,
    {},
  );
  const uid = useId();

  const line = subject.kind === "payment" ? subject.line : null;
  const payer = useMemo(
    () =>
      subject.kind === "payment"
        ? payerScope(subject.line.payerEmail, subject.line.payerName)
        : subject.payer.includes("@")
          ? payerScope(subject.payer, null)
          : payerScope(null, subject.payer),
    [subject],
  );
  const payerLines = useMemo(() => linesForPayer(lines, payer), [lines, payer]);

  const [scope, setScope] = useState<"payment" | "payer">(
    subject.kind === "payment" ? "payment" : "payer",
  );
  const [target, setTarget] = useState<Target>(startWith ?? "deal");
  const [dealId, setDealId] = useState<string | null>(null);
  const [cardId, setCardId] = useState("");
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState<"tie" | "untie" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState("");

  const inScope: MoneyLine[] =
    scope === "payment" && line ? [line] : payerLines;
  const options = useMemo(
    () => dealOptions(deals.data ?? null, lines),
    [deals.data, lines],
  );
  // What the suggestions match on: the payment's payer, or the payer chosen.
  const payerHint = useMemo(
    () => ({
      email:
        line?.payerEmail ?? ("payerEmail" in payer ? payer.payerEmail : null),
      name: line?.payerName ?? ("payerKey" in payer ? payer.payerKey : null),
      usd: line?.usd ?? null,
      day: line?.day ?? null,
    }),
    [line, payer],
  );
  const hits = useMemo(
    () => searchDeals(options, query, payerHint),
    [options, query, payerHint],
  );
  const deal = options.find(d => d.responseId === dealId) ?? null;
  const card = (cards.data ?? []).find(c => c.clickupTaskId === cardId) ?? null;

  // A tie saved this session that the list does not show yet: said first, and the one to remove.
  const mine: PendingTie | null = line
    ? pendingFor(line, pending)
    : subject.kind === "payer"
      ? pendingForPayer(subject.payer, pending)
      : null;
  // The live tie this sheet can remove: one saved this session, else the payment's own, else its payer's.
  const live: TieRef | null = mine
    ? mine.removed
      ? null
      : {
          id: mine.id,
          scope: mine.scope,
          note: mine.note,
          setBy: null,
          setAt: new Date(mine.at).toISOString(),
        }
    : (line?.tie ?? payerTieOf(payerLines)?.tie ?? null);
  /** Where a tie or a removal applies, for the rows to match it. */
  const scopeKeys = (s: "payment" | "payer") =>
    s === "payment" && line
      ? { paymentId: line.id }
      : "payerEmail" in payer
        ? { payerEmail: payer.payerEmail }
        : "payerKey" in payer
          ? { payerKey: payer.payerKey }
          : {};

  const draft: PaymentTie = {
    note,
    ...(evidence.trim() ? { evidence: evidence.trim() } : {}),
    ...(scope === "payment" && line
      ? { paymentId: line.id }
      : "payerEmail" in payer
        ? { payerEmail: payer.payerEmail }
        : "payerKey" in payer
          ? { payerKey: payer.payerKey }
          : {}),
    ...(target === "deal"
      ? dealId
        ? { dealResponseId: dealId }
        : {}
      : target === "card"
        ? cardId
          ? { clickupTaskId: cardId }
          : {}
        : { notClient: true }),
  };
  let problem: string | null = null;
  try {
    tiePayload(draft);
  } catch (e) {
    problem = errorText(e, "Fill in the tie first.");
  }
  if (target === "deal" && !dealId) problem = "Choose the signed deal.";
  if (target === "card" && !cardId) problem = "Choose the client card.";

  const chosen: TieTarget | null =
    target === "deal"
      ? deal
        ? { kind: "deal", deal }
        : null
      : target === "card"
        ? card
          ? { kind: "card", name: card.name }
          : null
        : { kind: "notClient" };
  const preview = chosen ? tiePreview(chosen, inScope, scope) : [];

  async function save() {
    setBusy("tie");
    setError(null);
    try {
      const out = (await tie(draft)) as { id?: number } | null;
      onTied?.({
        id: Number(out?.id ?? 0),
        scope,
        ...scopeKeys(scope),
        target:
          target === "deal"
            ? (deal?.business ?? "a signed deal")
            : target === "card"
              ? `the card ${card?.name ?? "chosen"}`
              : null,
        notClient: target === "notClient",
        note: note.trim(),
        at: Date.now(),
      });
      setDone(
        tiedSentence(
          lastRefreshAt ? new Date(lastRefreshAt).toISOString() : null,
        ),
      );
    } catch (e) {
      setError(errorText(e, "The money was not tied. Nothing was changed."));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!live) return;
    setBusy("untie");
    setError(null);
    try {
      await untie({ id: live.id, reason: reason.trim() });
      onTied?.({
        id: live.id,
        removed: true,
        scope: live.scope,
        ...(mine && !mine.removed
          ? {
              paymentId: mine.paymentId,
              payerEmail: mine.payerEmail,
              payerKey: mine.payerKey,
            }
          : scopeKeys(live.scope)),
        target: null,
        note: reason.trim(),
        at: Date.now(),
      });
      setDone(UNTIED_SENTENCE);
    } catch (e) {
      setError(errorText(e, "The tie was not removed. Nothing was changed."));
    } finally {
      setBusy(null);
    }
  }

  const payerLabel = "refused" in payer ? null : payer.label;
  const scopeTotal = payerLines.reduce((n, t) => n + t.usd, 0);

  return (
    <div className="grid gap-6 p-5 pt-6 sm:p-6">
      <SheetHeader className="space-y-1 pr-8 text-left">
        <SheetTitle className="text-base">
          {line
            ? "Attribute this payment"
            : `Attribute every payment from ${payerLabel ?? (subject.kind === "payer" ? subject.payer : "this payer")}`}
        </SheetTitle>
        <SheetDescription asChild>
          <div className="grid gap-0.5">
            {line ? (
              <>
                <span className="text-2xl font-semibold tabular-nums text-foreground">
                  {money(line.usd)}
                </span>
                <span>
                  {`${RAIL[line.rail]}, ${shortDate(line.day)} ${line.day.slice(0, 4)}`}
                  {line.payerName || line.payerEmail ? (
                    <>
                      {" · from "}
                      <bdi>{line.payerName ?? line.payerEmail}</bdi>
                    </>
                  ) : null}
                </span>
              </>
            ) : (
              <span>
                {"refused" in payer
                  ? "This payer cannot be tied as a whole."
                  : payerLines.length
                    ? `${plural(payerLines.length, "payment")} in the list, ${money(scopeTotal)}. A tie covers these and every one to come.`
                    : "No payment from this payer is in the Money tab's list yet. A tie covers every one to come."}
              </span>
            )}
          </div>
        </SheetDescription>
      </SheetHeader>

      {subject.kind === "payer" && "refused" in payer ? (
        // A payer tie keys on an email or a full name, never a first name.
        <div className="grid gap-4">
          <Receipt>
            {payer.refused} Attribute each of their payments on the Transactions
            tab instead.
          </Receipt>
          <Button
            variant="outline"
            className="justify-self-start"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      ) : done ? (
        <div className="grid gap-4">
          <Receipt tone="next">
            <span className="flex items-start gap-2">
              <Check
                className="mt-0.5 size-4 shrink-0 text-[var(--ceo-emphasis)]"
                aria-hidden
              />
              <span role="status">{done}</span>
            </span>
          </Receipt>
          <Button
            variant="outline"
            className="justify-self-start"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      ) : (
        <>
          <Part title="Now">
            {mine ? (
              <Receipt tone="next">
                <span role="status">{pendingWords(mine)}</span>
                <span className="block text-xs text-muted-foreground">
                  Until then the list reads as below.
                </span>
              </Receipt>
            ) : null}
            {line ? (
              <Receipt>
                {creditLine(line) ?? "Not credited"}
                {restsOn(line) ? (
                  <span className="block text-xs text-muted-foreground">
                    on <bdi>{restsOn(line)}</bdi>
                  </span>
                ) : null}
              </Receipt>
            ) : payerLines.length ? (
              <ul className="grid gap-1.5">
                {payerLines.slice(0, 4).map(t => (
                  <li key={t.id}>
                    <Receipt>
                      <span className="flex justify-between gap-3 tabular-nums">
                        <span>{shortDate(t.day)}</span>
                        <span>{money(t.usd)}</span>
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {creditLine(t) ?? "Not credited"}
                      </span>
                    </Receipt>
                  </li>
                ))}
                {payerLines.length > 4 ? (
                  <li className="text-xs text-muted-foreground">
                    {`and ${plural(payerLines.length - 4, "more payment")}`}
                  </li>
                ) : null}
              </ul>
            ) : (
              <Receipt>Nothing from this payer is credited yet.</Receipt>
            )}
            {live ? (
              <LiveTie
                tie={live}
                removing={removing}
                setRemoving={setRemoving}
                reason={reason}
                setReason={setReason}
                busy={busy}
                onRemove={remove}
              />
            ) : null}
          </Part>

          {line ? (
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-xs font-medium text-muted-foreground">
                Tie
              </legend>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name={`${uid}-scope`}
                  checked={scope === "payment"}
                  onChange={() => setScope("payment")}
                  className="mt-1 accent-[var(--ceo-emphasis)]"
                />
                This payment only
              </label>
              <label
                className={cn(
                  "flex items-start gap-2 text-sm",
                  "refused" in payer && "text-muted-foreground",
                )}
              >
                <input
                  type="radio"
                  name={`${uid}-scope`}
                  checked={scope === "payer"}
                  disabled={"refused" in payer}
                  onChange={() => setScope("payer")}
                  className="mt-1 accent-[var(--ceo-emphasis)]"
                />
                <span className="min-w-0">
                  {payerLabel ? (
                    <>
                      Every payment from <bdi>{payerLabel}</bdi>
                    </>
                  ) : (
                    "Every payment from this payer"
                  )}
                  <span className="block text-xs text-muted-foreground">
                    {"refused" in payer
                      ? payer.refused
                      : `${plural(payerLines.length, "payment")} in the list, ${money(scopeTotal)}, and every one to come.`}
                  </span>
                </span>
              </label>
            </fieldset>
          ) : null}

          <fieldset className="grid gap-3">
            <legend className="mb-2 text-xs font-medium text-muted-foreground">
              To
            </legend>
            <div
              className="inline-flex w-full flex-wrap gap-1 rounded-lg border p-1"
              role="radiogroup"
              aria-label="What to tie it to"
            >
              {(
                [
                  ["deal", "A signed deal"],
                  ["card", "A client card"],
                  ["notClient", "Not client money"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={target === k}
                  onClick={() => setTarget(k)}
                  className={cn(
                    "min-h-8 flex-1 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    target === k
                      ? "bg-[var(--ceo-emphasis-wash)] text-foreground ring-1 ring-[var(--ceo-emphasis)]"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {target === "deal" ? (
              <DealPicker
                group={`${uid}-deal`}
                query={query}
                setQuery={setQuery}
                hits={hits}
                total={options.length}
                dealId={dealId}
                setDealId={setDealId}
                loading={deals.data === undefined && !deals.error}
                readError={deals.error ? errorText(deals.error, "") : null}
              />
            ) : target === "card" ? (
              cards.error ? (
                <p className="text-sm text-[var(--ceo-critical)]">
                  {`The client cards could not be read: ${errorText(cards.error, "try again")}.`}
                </p>
              ) : (
                <AnimatedSelect
                  aria-label="Client card"
                  value={cardId}
                  onChange={e => setCardId(e.target.value)}
                  className="ceo-select-md w-full"
                >
                  <option value="">
                    {cards.data ? "Choose a client card" : "Reading the cards"}
                  </option>
                  {(cards.data ?? []).map(c => (
                    <option key={c.clickupTaskId} value={c.clickupTaskId}>
                      {c.name}
                    </option>
                  ))}
                </AnimatedSelect>
              )
            ) : (
              <p className="text-xs leading-relaxed text-muted-foreground">
                For money that is not a client's: a refund coming back, a
                partner, your own transfer. It stays on the Transactions tab,
                apart from client money.
              </p>
            )}
          </fieldset>

          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Why
            </span>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Who told you, or what shows it. For example: the payer is the client's partner; the closer confirmed on the call."
              className={cn(field, "min-h-[72px] resize-y")}
            />
            <span className="text-xs text-muted-foreground">
              Required. Kept with the tie and shown on the payment.
            </span>
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Link (optional)
            </span>
            <input
              value={evidence}
              onChange={e => setEvidence(e.target.value)}
              maxLength={1000}
              inputMode="url"
              placeholder="A call recording, a message, the contract"
              className={field}
            />
          </label>

          <Part title="What this tie credits">
            {preview.length ? (
              <Receipt tone="next">
                {preview.map(s => (
                  <span key={s} className="block">
                    {s}
                  </span>
                ))}
              </Receipt>
            ) : (
              <p className="text-xs text-muted-foreground">
                Choose what to tie it to, and this says who it will be credited
                to.
              </p>
            )}
          </Part>

          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={save}
                disabled={problem !== null || busy !== null}
              >
                {busy === "tie" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : null}
                Tie
              </Button>
              <Button
                variant="ghost"
                onClick={onClose}
                disabled={busy !== null}
              >
                Cancel
              </Button>
            </div>
            {error ? (
              <p role="alert" className="text-sm text-[var(--ceo-critical)]">
                {error}
              </p>
            ) : problem ? (
              <p className="text-xs text-muted-foreground">{problem}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                The tie is read by the next money refresh, before any automatic
                match.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function LiveTie({
  tie,
  removing,
  setRemoving,
  reason,
  setReason,
  busy,
  onRemove,
}: {
  tie: TieRef;
  removing: boolean;
  setRemoving: (v: boolean) => void;
  reason: string;
  setReason: (v: string) => void;
  busy: "tie" | "untie" | null;
  onRemove: () => void;
}) {
  const at = tie.setAt ? Date.parse(tie.setAt) : Number.NaN;
  return (
    <div className="grid gap-2 rounded-md border px-3 py-2.5 text-sm">
      <p className="leading-relaxed">
        <span className="font-medium">
          {tie.scope === "payer"
            ? "Your tie covers every payment from this payer"
            : "Your tie on this payment"}
        </span>
        <span className="block text-muted-foreground">
          <q>{tie.note}</q>
          {Number.isFinite(at) || tie.setBy
            ? ` · set${tie.setBy ? ` by ${tie.setBy}` : ""}${Number.isFinite(at) ? ` on ${shortDate(at)}` : ""}`
            : ""}
        </span>
      </p>
      {removing ? (
        <form
          className="grid gap-2"
          onSubmit={e => {
            e.preventDefault();
            onRemove();
          }}
        >
          <input
            value={reason}
            onChange={e => setReason(e.target.value)}
            maxLength={500}
            aria-label="Why the tie goes"
            placeholder="Why the tie goes"
            className={field}
          />
          <span className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={reason.trim().length < 3 || busy !== null}
            >
              {busy === "untie" ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : null}
              Remove the tie
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRemoving(false)}
            >
              Keep it
            </Button>
          </span>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setRemoving(true)}
          className="justify-self-start text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Remove the tie
        </button>
      )}
    </div>
  );
}

function DealPicker({
  group,
  query,
  setQuery,
  hits,
  total,
  dealId,
  setDealId,
  loading,
  readError,
}: {
  group: string;
  query: string;
  setQuery: (v: string) => void;
  hits: ReturnType<typeof searchDeals>;
  total: number;
  dealId: string | null;
  setDealId: (v: string) => void;
  loading: boolean;
  readError: string | null;
}) {
  return (
    <div className="grid gap-2">
      <label className="relative block">
        <span className="sr-only">Search the signed deals</span>
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Business, contact, closer or email"
          className={cn(field, "pl-8")}
        />
      </label>
      {readError ? (
        <p className="text-xs text-[var(--ceo-warning)]">
          {`${readError}. Only deals that already have money tied are listed.`}
        </p>
      ) : null}
      {loading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Reading the closer form
        </p>
      ) : hits.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {query.trim()
            ? `No signed deal matches "${query.trim()}". Search by business, contact, closer or email.`
            : "No signed deal to tie to yet."}
        </p>
      ) : (
        <div
          role="radiogroup"
          aria-label="Signed deals"
          className="grid max-h-[22rem] gap-1.5 overflow-y-auto overscroll-contain pr-1"
        >
          {hits.map(({ deal: d, why }) => {
            const on = d.responseId === dealId;
            return (
              <label
                key={d.responseId}
                className={cn(
                  "grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 rounded-lg border px-3 py-2.5 transition-colors",
                  on
                    ? "border-[var(--ceo-emphasis)] bg-[var(--ceo-emphasis-wash)]"
                    : "hover:bg-[var(--ceo-hover)]",
                )}
              >
                <input
                  type="radio"
                  name={group}
                  checked={on}
                  onChange={() => setDealId(d.responseId)}
                  className="mt-1 accent-[var(--ceo-emphasis)]"
                />
                <span className="min-w-0">
                  <span
                    className="block truncate text-sm font-medium"
                    dir="auto"
                  >
                    {d.business ?? "No business name on the form"}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    <bdi>{d.closer ?? "No closer on the form"}</bdi>
                    {" · "}
                    {d.signedDay
                      ? `signed ${shortDate(d.signedDay)}`
                      : d.fromPaymentsOnly
                        ? "known from its payments"
                        : "signed day not on the form"}
                  </span>
                  {why ? (
                    <span className="mt-0.5 block text-xs font-medium text-[var(--ceo-emphasis)]">
                      {`Suggested: ${why}`}
                    </span>
                  ) : null}
                </span>
                <span className="text-right text-xs tabular-nums text-muted-foreground">
                  <span className="block whitespace-nowrap">
                    <span className="text-sm font-medium text-foreground">
                      {d.contracted === null ? NA : money(d.contracted)}
                    </span>{" "}
                    contract
                  </span>
                  <span className="block whitespace-nowrap">{`${money(d.collected)} collected`}</span>
                </span>
              </label>
            );
          })}
        </div>
      )}
      {!loading && total > hits.length && !query.trim() ? (
        <p className="text-xs text-muted-foreground">
          {`The newest ${hits.length} of ${plural(total, "deal")}. Search to find an older one.`}
        </p>
      ) : null}
    </div>
  );
}
