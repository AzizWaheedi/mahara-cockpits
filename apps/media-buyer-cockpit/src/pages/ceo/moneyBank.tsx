import { useAction, useMutation } from "convex/react";
import { Landmark } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { count, money, plural, shortDate } from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import { StatusChip } from "@/components/ceo/StatusChip";
import type { CeoSection } from "@/components/ceo/useCeo";
import { api } from "../../../convex/_generated/api";
import type { MoneyPayload, Note } from "../../../convex/ceo/payloads";

/**
 * The bank statement door (Aziz, 2026-09-21). CBK has no API, so the CBK
 * Online CSV export is dropped here; the server parses it, gives every line
 * a kind, skips lines it already holds, and the next refresh folds client
 * payments into cash and debits into expenses. The card says how old the
 * newest statement is and warns past seven days.
 */

type Overview = {
  statements: {
    id: string;
    account: string;
    accountKind: string;
    currency: string;
    fromDay: string | null;
    toDay: string | null;
    lines: number;
    totalDebit: number | null;
    totalCredit: number | null;
    closingBalance: number | null;
    fileName: string | null;
    importedAt: number | null;
  }[];
  exclusions: { id: number; kind: "card" | "vendor"; pattern: string; note: string | null }[];
  lastStatementTo: string | null;
  daysSince: number | null;
  stale: boolean;
};

type ImportResult = {
  account: string;
  accountKind: string;
  currency: string;
  fromDay: string | null;
  toDay: string | null;
  read: number;
  kept: number;
  skipped: number;
  problems: string[];
  byKind: { kind: string; label: string; count: number; usd: number }[];
};

const NOTES: Note[] = [
  {
    level: "info",
    text: "Upload the CBK Online CSV export of each account and card, any period. Lines already held (same bank transaction number) are skipped, so overlapping periods are safe. Client payments on an account statement become cash on the Bank rail; Whop payouts, Tap settlements and transfers between Mahara's own accounts are never cash; every debit is an expense unless it is on the exclusion list.",
  },
  {
    level: "info",
    text: "Exclusions keep personal spend out of the P&L by card (the masked account on the statement) or by vendor (a fragment of the line's reference). Excluded lines still show on the Transactions tab. Changing the list re-sorts the lines already held.",
  },
];

function serverMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0].slice(0, 240);
}

export function BankStatementsCard({
  section,
  payload,
  order,
}: {
  section: CeoSection<"money"> | null;
  payload: MoneyPayload | null;
  order: number;
}) {
  const overviewAction = useAction(api.ceo.bankImport.overview);
  const importAction = useAction(api.ceo.bankImport.importStatement);
  const addExclusion = useAction(api.ceo.bankImport.addExclusion);
  const removeExclusion = useAction(api.ceo.bankImport.removeExclusion);
  const refreshNow = useMutation(api.ceo.queries.refreshNow);
  const [ov, setOv] = useState<Overview | null>(null);
  const [ovError, setOvError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [exKind, setExKind] = useState<"vendor" | "card">("vendor");
  const [exPattern, setExPattern] = useState("");
  const [exNote, setExNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const r = (await overviewAction({})) as Overview | null | undefined;
      if (!r || !Array.isArray(r.statements))
        throw new Error("the statement list did not come back");
      setOv({ ...r, exclusions: Array.isArray(r.exclusions) ? r.exclusions : [] });
      setOvError(null);
    } catch (e) {
      setOvError(serverMessage(e));
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => {
    void load();
  }, []);

  const onFile = async (file: File) => {
    setBusy(true);
    setProblem(null);
    setResult(null);
    try {
      const text = await file.text();
      const r = (await importAction({ fileName: file.name, text })) as ImportResult;
      setResult(r);
      await load();
      await refreshNow({ only: ["money", "expenses"] });
    } catch (e) {
      setProblem(serverMessage(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onAddExclusion = async () => {
    if (exPattern.trim().length < 3) {
      setProblem("An exclusion needs at least three characters.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await addExclusion({ kind: exKind, pattern: exPattern.trim(), note: exNote.trim() || undefined });
      setExPattern("");
      setExNote("");
      await load();
      await refreshNow({ only: ["money", "expenses"] });
    } catch (e) {
      setProblem(serverMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onRemoveExclusion = async (id: number) => {
    setBusy(true);
    setProblem(null);
    try {
      await removeExclusion({ id });
      await load();
      await refreshNow({ only: ["money", "expenses"] });
    } catch (e) {
      setProblem(serverMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const bank = payload?.bank ?? null;
  const daysSince = ov?.daysSince ?? bank?.daysSince ?? null;
  const stale = ov ? ov.stale : (bank?.stale ?? true);
  const lastTo = ov?.lastStatementTo ?? bank?.lastStatementTo ?? null;

  return (
    <SectionCard
      kicker={
        lastTo
          ? `Newest statement ends ${shortDate(lastTo)}`
          : "No statement uploaded yet"
      }
      title="Bank statements"
      section={section}
      notes={NOTES}
      order={order}
      actions={
        <StatusChip
          tone={stale ? "serious" : "good"}
          label={
            daysSince === null
              ? "Nothing uploaded"
              : daysSince > 7
                ? `${daysSince} days old`
                : daysSince === 0
                  ? "Up to date"
                  : `${plural(daysSince, "day")} old`
          }
        />
      }
    >
      {() => (
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex h-9 cursor-pointer items-center rounded-md border bg-card px-3 text-sm font-medium hover:bg-accent">
              {busy ? "Working" : "Upload a CBK statement"}
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="sr-only"
                disabled={busy}
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                }}
              />
            </label>
            <span className="text-xs text-muted-foreground">
              CBK Online, Accounts, Statement, Export CSV. Thirty seconds, once a week.
              {stale && daysSince !== null
                ? ` The newest statement is ${daysSince} days old, so cash and expenses since then are missing, not zero.`
                : ""}
            </span>
          </div>
          {problem ? (
            <p className="text-sm text-destructive" role="alert">
              {problem}
            </p>
          ) : null}
          {result ? (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <p className="font-medium">
                {result.account} ({result.accountKind}),{" "}
                {result.fromDay ? shortDate(result.fromDay) : "?"} to{" "}
                {result.toDay ? shortDate(result.toDay) : "?"}: {count(result.read)} lines read,{" "}
                {count(result.kept)} new, {count(result.skipped)} already held.
              </p>
              {result.byKind.length ? (
                <ul className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                  {result.byKind.map(k => (
                    <li key={k.kind}>
                      {k.label}: {count(k.count)} · {money(k.usd)}
                    </li>
                  ))}
                </ul>
              ) : null}
              {result.problems.length ? (
                <ul className="mt-2 text-xs text-destructive">
                  {result.problems.map(p => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-2 text-xs text-muted-foreground">
                Cash and expenses pick the new lines up on the refresh that was just started.
              </p>
            </div>
          ) : null}

          {ovError ? (
            <p className="text-xs text-muted-foreground">
              The statement list could not be read: {ovError}
            </p>
          ) : ov && ov.statements.length ? (
            <div className="grid gap-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Statements held
              </p>
              <ul className="grid gap-1 text-sm">
                {ov.statements.slice(0, 12).map(s => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 tabular-nums"
                  >
                    <span className="min-w-0 truncate">
                      {s.account}{" "}
                      <span className="text-muted-foreground">
                        ({s.accountKind}, {s.currency})
                      </span>
                    </span>
                    <span className="text-muted-foreground">
                      {s.fromDay ? shortDate(s.fromDay) : "?"} to{" "}
                      {s.toDay ? shortDate(s.toDay) : "?"} · {plural(s.lines, "line")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : ov ? (
            <EmptyState
              title="No statement held yet"
              text="Upload the CBK Online CSV export for each account and card."
              icon={Landmark}
              compact
            />
          ) : null}

          {bank ? (
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 border-t pt-5 sm:grid-cols-4">
              <StatTile
                variant="plain"
                label="Lines, 12 months"
                value={count((bank.kinds ?? []).reduce((t, k) => t + k.count, 0))}
                sub={`${plural((bank.accounts ?? []).length, "account")}`}
              />
              <StatTile
                variant="plain"
                label="Whop payouts dropped"
                value={money(bank.payouts.usd)}
                sub={`${count(bank.payouts.matched)} of ${count(bank.payouts.count)} matched to Whop payments`}
                hint="Whop payouts on the statements are not cash: the payments behind them already count on the Whop rail. Matched means a run of Whop payments within 3% and 14 days adds up to the payout."
              />
              <StatTile
                variant="plain"
                label="Tap settlements"
                value={money(bank.tapSettlements.usd)}
                sub={`${count(bank.tapSettlements.chargesCovered)} Tap charges covered`}
                hint="A Tap charge and its settlement on the bank are one payment: the bank line counts, the Tap charge confirms it."
              />
              <StatTile
                variant="plain"
                label="Not sorted"
                value={count(bank.unknown)}
                sub={`${count(bank.manualCovered)} hand-logged payments now on a statement`}
                hint="Lines the rules could not give a kind. Mark them on the Transactions tab."
              />
            </div>
          ) : null}

          <div className="grid gap-3 border-t pt-5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Kept out of the P&L
            </p>
            {ov?.exclusions.length ? (
              <ul className="grid gap-1 text-sm">
                {ov.exclusions.map(x => (
                  <li key={x.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="text-muted-foreground">
                        {x.kind === "card" ? "Card" : "Vendor"}
                      </span>{" "}
                      {x.pattern}
                      {x.note ? (
                        <span className="text-muted-foreground"> · {x.note}</span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onRemoveExclusion(x.id)}
                      className="rounded-sm text-xs text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                Nothing is excluded. Personal spend on a business card belongs here.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={exKind}
                onChange={e => setExKind(e.target.value as "vendor" | "card")}
                aria-label="Exclusion kind"
                className="h-9 rounded-md border bg-card px-2 text-sm"
              >
                <option value="vendor">Vendor</option>
                <option value="card">Card</option>
              </select>
              <input
                value={exPattern}
                onChange={e => setExPattern(e.target.value)}
                placeholder={exKind === "card" ? "537015XXXXXX4348" : "netflix"}
                aria-label="Exclusion pattern"
                className="h-9 min-w-0 flex-1 rounded-md border bg-card px-2 text-sm"
              />
              <input
                value={exNote}
                onChange={e => setExNote(e.target.value)}
                placeholder="why (optional)"
                aria-label="Exclusion note"
                className="h-9 min-w-0 flex-1 rounded-md border bg-card px-2 text-sm"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void onAddExclusion()}
                className="h-9 rounded-md border bg-card px-3 text-sm font-medium hover:bg-accent"
              >
                Exclude
              </button>
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

/** Expenses from the statements by month, with the exclusions apart. */
export function BankExpensesBody({ p }: { p: MoneyPayload }): ReactNode {
  const months = p.bank?.expenses ?? [];
  if (!months.length)
    return (
      <EmptyState
        title="No statement debits yet"
        text="Upload a statement and its debits appear here by month and category."
        icon={Landmark}
        compact
      />
    );
  return (
    <div className="grid gap-4">
      {months.slice(0, 6).map(m => (
        <div key={m.month} className="grid gap-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">{m.month}</span>
            <span className="tabular-nums">
              {money(m.total)}
              <span className="text-muted-foreground">
                {" "}
                · {money(m.fees)} fees · {money(m.excluded.usd)} excluded (
                {plural(m.excluded.lines, "line")})
              </span>
            </span>
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
            {m.byCategory.map(c => (
              <li key={c.category}>
                {c.category} {money(c.usd)}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
