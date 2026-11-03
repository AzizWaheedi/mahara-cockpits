/* Hallmark · component: "Sales not on a card" band and the CEO's sale-tie line · genre: modern-minimal · theme: the cockpit's own (Geist, --mahara-teal)
 * states: default · hover · focus-visible · active · disabled (saving) · loading · error · success · empty · missing function
 * Hallmark · pre-emit critique: P4 H4 E4 S5 R5 V4
 *
 * CEO item 6 (sale-tie.md 2.7 and 2.10; WAVE56-CONTRACT.md 4.19 and 5.16):
 * the sales the server could not tie to a card by an exact phone or email,
 * each with its plain reason and three answers, like the ticket form's yes or
 * no: Yes, tie it (to the suggested card), Another card, Not a client card
 * (a reason asked). The server gates every decision (the CEO, or a CSM for a
 * card on their list) and never shows a phone or an email. The CEO also reads
 * one line of counts. Same structure as the churn page's "Termination surveys
 * not matched to a card".
 */

import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Chip, SectionCard } from "@/components/kit";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { shortDay } from "@/lib/format";
import {
  candidateWhy,
  EVERY_SALE_TIED,
  NOT_TIED_YET,
  SALES_MISSING,
  type SaleTieApi,
  type SaleTieList,
  type SaleTieRow,
  saleHealthLine,
  saleMissing,
  tiedByTone,
  tiedByWords,
} from "@/lib/saleTie";

type Card = { taskId: string; name: string };

type Load =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "hidden" }
  | { kind: "error"; text: string }
  | { kind: "ready"; list: SaleTieList };

const words = (e: unknown) =>
  String((e as Error)?.message ?? e ?? "").trim() ||
  "The database could not answer just now. Try again in a minute.";

/** Today's band. Not drawn for a CSM with nothing to decide; the CEO always reads the counts. */
export function SalesNotOnCard({
  api,
  cards,
  isCeo,
}: {
  api: SaleTieApi | null;
  /** The clients this seat sees, for "Another card". */
  cards: Card[];
  isCeo: boolean;
}) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const read = useCallback(async () => {
    if (!api) return;
    try {
      setLoad({ kind: "ready", list: await api.list() });
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      setLoad(
        saleMissing(e)
          ? { kind: "missing" }
          : code === "42501"
            ? { kind: "hidden" }
            : { kind: "error", text: words(e) },
      );
    }
  }, [api]);
  useEffect(() => {
    void read();
  }, [read]);

  if (!api || load.kind === "loading" || load.kind === "hidden") return null;
  // Until the sale tie is applied only the CEO hears about it; a CSM has nothing to do yet.
  if (load.kind === "missing")
    return isCeo ? (
      <p className="text-xs text-muted-foreground" data-sale-tie="missing">
        {SALES_MISSING}
      </p>
    ) : null;
  if (load.kind === "error")
    return (
      <p className="text-xs txt-bad" role="alert" data-sale-tie="error">
        Sales not on a card could not be read: {load.text}
      </p>
    );
  const { rows, counts, on } = load.list;
  // Before the CEO turns sale ties on nothing is tied or decided: the CEO hears so, a CSM nothing.
  if (on === false)
    return isCeo ? (
      <p className="text-xs text-muted-foreground" data-sale-tie="off">
        {NOT_TIED_YET} They tie to their cards once sale ties are turned on.
      </p>
    ) : null;
  if (!rows.length && !isCeo) return null;
  return (
    <SectionCard
      title="Sales not on a card"
      count={rows.length}
      sub={
        isCeo
          ? saleHealthLine(counts)
          : "The cockpit could not tie these sales to a card by phone or email. Tie each one, or say it is not a client card."
      }
      flush={rows.length > 0}
    >
      {rows.length ? (
        rows.map(r => (
          <SaleRow
            key={r.responseId}
            row={r}
            api={api}
            cards={cards}
            onDone={() => void read()}
          />
        ))
      ) : (
        <p className="text-sm text-muted-foreground" data-sale-tie="empty">
          {EVERY_SALE_TIED}
        </p>
      )}
    </SectionCard>
  );
}

function SaleRow({
  row: r,
  api,
  cards,
  onDone,
}: {
  row: SaleTieRow;
  api: SaleTieApi;
  cards: Card[];
  onDone: () => void;
}) {
  const id = useId();
  const [mode, setMode] = useState<"pick" | "not" | null>(null);
  const [pick, setPick] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = r.businessName ?? "A sale with no business name";
  // The suggestion and the server's candidates first, then every other card this seat sees.
  const offered = [
    ...(r.suggestion ? [r.suggestion] : []),
    ...r.candidates.filter(c => c.taskId !== r.suggestion?.taskId),
  ];
  const others = cards.filter(c => !offered.some(o => o.taskId === c.taskId));
  const decide = async (
    choice: "yes" | "pick" | "not_client",
    taskId: string | null,
    reason: string | null,
    cardName: string | null,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const out = await api.decide({
        responseId: r.responseId,
        choice,
        taskId,
        note: reason,
      });
      toast.success(
        out.sentence ??
          (choice === "not_client"
            ? "Marked not a client card"
            : `Tied to ${out.cardName ?? cardName ?? "the card"}`),
      );
      onDone();
    } catch (e) {
      setError(words(e));
    } finally {
      setBusy(false);
    }
  };
  // The server's Kuwait day; else the timestamp's own day in Kuwait.
  const signed = r.signedOn
    ? shortDay(r.signedOn)
    : r.signedAt
      ? shortDay(
          new Date(Date.parse(r.signedAt) + 3 * 3600_000)
            .toISOString()
            .slice(0, 10),
        )
      : null;
  return (
    <div className="space-y-2 px-4 py-3 sm:px-6" data-sale-row={r.responseId}>
      <p className="text-sm" dir="auto">
        <bdi className="font-medium">{name}</bdi>
        {signed ? (
          <>
            {" "}
            <span className="text-muted-foreground">signed</span>{" "}
            <span className="font-mono text-sm text-foreground">{signed}</span>
          </>
        ) : null}
        {r.closer ? (
          <span className="text-muted-foreground">
            {" "}
            · closed by <bdi>{r.closer}</bdi>
          </span>
        ) : null}
      </p>
      {r.sentence ? (
        <p className="text-xs text-muted-foreground">{r.sentence}</p>
      ) : null}
      {r.tiedTo ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          Now on{" "}
          <bdi className="text-foreground">
            {r.tiedTo.name ?? r.tiedTo.taskId}
          </bdi>
          <Chip tone={tiedByTone(r.tiedTo.tiedBy)}>
            {tiedByWords(r.tiedTo.tiedBy)}
          </Chip>
        </p>
      ) : null}
      {offered.length ? (
        <ul className="space-y-1">
          {offered.map(c => (
            <li
              key={c.taskId}
              className="flex flex-wrap items-center gap-2 text-xs"
            >
              <Chip tone={c === r.suggestion ? "accent" : "neutral"}>
                <bdi>{c.name ?? c.taskId}</bdi>
              </Chip>
              <span className="text-muted-foreground">{candidateWhy(c)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {r.suggestion ? (
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void decide(
                "yes",
                r.suggestion?.taskId ?? null,
                null,
                r.suggestion?.name ?? null,
              )
            }
          >
            Yes, tie it
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          aria-expanded={mode === "pick"}
          onClick={() => setMode(m => (m === "pick" ? null : "pick"))}
        >
          Another card
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          aria-expanded={mode === "not"}
          onClick={() => setMode(m => (m === "not" ? null : "not"))}
        >
          Not a client card
        </Button>
      </div>
      {mode === "pick" ? (
        <div className="flex w-full flex-wrap items-center gap-2">
          <label htmlFor={`${id}-card`} className="sr-only">
            The sale's card
          </label>
          <div className="w-full min-w-0 max-w-xs text-sm [&_[data-cockpit-select]]:min-h-8! [&_[data-cockpit-select]]:py-1!">
            <AnimatedSelect
              id={`${id}-card`}
              className="w-full"
              value={pick}
              onChange={e => setPick(e.target.value)}
            >
              <option value="">Pick the client…</option>
              {[...offered, ...others].map(c => (
                <option key={c.taskId} value={c.taskId}>
                  {c.name ?? c.taskId}
                </option>
              ))}
            </AnimatedSelect>
          </div>
          <Button
            size="sm"
            disabled={!pick || busy}
            onClick={() =>
              void decide(
                "pick",
                pick,
                null,
                [...offered, ...others].find(c => c.taskId === pick)?.name ??
                  null,
              )
            }
          >
            {busy ? "Saving…" : "Tie it to this card"}
          </Button>
        </div>
      ) : null}
      {mode === "not" ? (
        <form
          className="flex w-full flex-wrap items-center gap-2"
          onSubmit={e => {
            e.preventDefault();
            if (note.trim().length < 3) {
              setError(
                "Say why, in a few words: a test, a duplicate, another business.",
              );
              return;
            }
            void decide("not_client", null, note, null);
          }}
        >
          <label htmlFor={`${id}-why`} className="sr-only">
            Why is this not a client card?
          </label>
          <Input
            id={`${id}-why`}
            value={note}
            maxLength={500}
            onChange={e => setNote(e.target.value)}
            placeholder="Why is this not a client card?"
            className="h-8 min-w-0 flex-1 text-sm"
            dir="auto"
            autoFocus
          />
          <Button size="sm" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </form>
      ) : null}
      {error ? (
        <p className="text-xs txt-bad" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
