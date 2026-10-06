import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { changeChurn, readChurnPage } from "@/lib/churnClient";
import { Check, Loader2, Pencil, Plus, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Chip, Kicker, PageHeader, StatTile } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { plural, shortDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  ChurnPage as Page,
  PickClient,
  Waiting,
} from "@/lib/churnClient";
import {
  countsAs,
  type Departure,
  daysIn,
  type MonthRow,
  monthName,
  PROGRAMME_DAYS,
  TARGET_PCT,
  verdictLine,
} from "@/lib/churnCore";

/**
 * The churn tracker (the CEO, 2026-10-01): mahara-context's churn sheet,
 * inside the cockpit. One row per client who left, logged the day it
 * happens; two numbers typed a month; the rest worked out (lib/churnCore).
 * It replaces the Churn Tracker 2026 sheet, whose months are brought in.
 */

const field =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm";

/** What a refused call says, in the words the server wrote. */
function errorText(e: unknown): string {
  const data = (e as { data?: unknown } | null)?.data;
  if (typeof data === "string") return data;
  if (data && typeof (data as { message?: unknown }).message === "string")
    return (data as { message: string }).message;
  const raw = e instanceof Error ? e.message : String(e);
  const m = raw.match(/Uncaught Error: ([\s\S]*?)(?:\n\s+at |$)/);
  return (
    (m ? m[1] : raw).trim().slice(0, 300) ||
    "That did not save, so nothing changed. Try again in a minute."
  );
}

const pct = (n: number | null) => (n === null ? "Not yet" : `${n.toFixed(1)}%`);
const usd = (n: number | null) =>
  n === null ? "" : `$${Math.round(n).toLocaleString("en-US")}`;

type Draft = {
  id?: number;
  client: string;
  clickupTaskId: string | null;
  leftOn: string;
  launchedOn: string;
  reason: string;
  mrrLostUsd: string;
  csm: string;
  note: string;
};

export function ChurnPage() {
  const { client, session } = useCockpitAuth();
  const load = useCallback(() => readChurnPage(client), [client, session?.user.id]);
  const { saveDeparture, removeDeparture, saveMonth, dismiss } = useMemo(() => ({
    saveDeparture: (args: Record<string, unknown>) => changeChurn(client, "saveDeparture", args),
    removeDeparture: (args: Record<string, unknown>) => changeChurn(client, "removeDeparture", args),
    saveMonth: (args: Record<string, unknown>) => changeChurn(client, "saveMonth", args),
    dismiss: (args: Record<string, unknown>) => changeChurn(client, "dismiss", args),
  }), [client, session?.user.id]);
  const scope = session?.user.id ?? "";
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [loaded, setLoaded] = useState<{scope:string;page:Page} | null>(null);
  const page = loaded?.scope === scope ? loaded.page : null;
  const setPage = useCallback((next: Page | null) => {
    if (currentScope.current === scope) setLoaded(next ? {scope,page:next} : null);
  }, [scope]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPage(await load());
      if (currentScope.current === scope) setError(null);
    } catch (e) {
      if (currentScope.current === scope) setError(errorText(e));
    }
  }, [load, scope, setPage]);

  useEffect(() => {
    setPage(null);
    setDraft(null);
    setError(null);
    void refresh();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 60_000);
    return () => clearInterval(t);
  }, [refresh, setPage]);

  /** Run a change; the server answers with the page as it now is. */
  const act = async (fn: () => Promise<Page>) => {
    try {
      setPage(await fn());
      if (currentScope.current === scope) setError(null);
    } catch (e) {
      if (currentScope.current === scope) setError(errorText(e));
      throw e;
    }
  };

  const openDraft = (d: Draft) => {
    setDraft(d);
    requestAnimationFrame(() =>
      document
        .getElementById("churn-form")
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };

  if (!page)
    return (
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <PageHeader
          title="Churn tracker"
          sub="A client lost before day 90 is churn. A client who finishes the term is not, renewed or not."
        />
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Reading the
            register
          </p>
        )}
      </div>
    );

  const current = page.months.find(m => m.month === page.month) ?? null;
  const blank = (): Draft => ({
    client: "",
    clickupTaskId: null,
    leftOn: page.today,
    launchedOn: "",
    reason: "",
    mrrLostUsd: "",
    csm: "",
    note: "",
  });

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <PageHeader
        title="Churn tracker"
        sub="A client lost before day 90 is churn. A client who finishes the term is not, renewed or not."
        actions={
          <Button onClick={() => openDraft(blank())}>
            <Plus aria-hidden /> Log a departure
          </Button>
        }
      />

      {draft ? (
        <DepartureForm
          key={draft.id ?? "new"}
          draft={draft}
          page={page}
          onCancel={() => setDraft(null)}
          onSave={async d => {
            await act(() =>
              saveDeparture({
                ...(d.id ? { id: d.id } : {}),
                client: d.client,
                clickupTaskId: d.clickupTaskId,
                leftOn: d.leftOn,
                launchedOn: d.launchedOn || null,
                reason: d.reason,
                mrrLostUsd: d.mrrLostUsd.trim() ? Number(d.mrrLostUsd) : null,
                csm: d.csm || null,
                note: d.note || null,
              }),
            );
            toast.success(d.id ? "Saved" : `Logged ${d.client}`);
            setDraft(null);
          }}
          onRemove={
            draft.id && page.me.canRemove
              ? async why => {
                  await act(() =>
                    removeDeparture({ id: draft.id as number, why }),
                  );
                  toast.success("Taken out of the register");
                  setDraft(null);
                }
              : null
          }
        />
      ) : null}

      {current ? (
        <ThisMonth
          row={current}
          page={page}
          onSave={(month, f) => act(() => saveMonth({ month, ...f }))}
        />
      ) : null}

      {page.waiting.length ? (
        <WaitingList
          items={page.waiting}
          onLog={w =>
            openDraft({
              client: w.client,
              clickupTaskId: w.clickupTaskId,
              leftOn: w.leftOn,
              launchedOn: w.launchedOn ?? "",
              reason: w.reason ?? "",
              mrrLostUsd: w.mrrLostUsd === null ? "" : String(w.mrrLostUsd),
              csm: w.csm ?? "",
              note: "",
            })
          }
          onDismiss={(w, why) =>
            act(() =>
              dismiss({ key: w.key, leftOn: w.leftOn, client: w.client, why }),
            )
          }
        />
      ) : null}

      <Register
        departures={page.departures}
        onEdit={d =>
          openDraft({
            id: d.id,
            client: d.client,
            clickupTaskId: d.clickupTaskId,
            leftOn: d.leftOn,
            launchedOn: d.launchedOn ?? "",
            reason: d.reason,
            mrrLostUsd: d.mrrLostUsd === null ? "" : String(d.mrrLostUsd),
            csm: d.csm ?? "",
            note: d.note ?? "",
          })
        }
        onAdd={() => openDraft(blank())}
      />

      <Months
        rows={page.months}
        onSave={(month, f) => act(() => saveMonth({ month, ...f }))}
      />

      <Rules />
      <Changes log={page.log} />

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// --- this month ----------------------------------------------------------------------

function ThisMonth({
  row,
  page,
  onSave,
}: {
  row: MonthRow;
  page: Page;
  onSave: (
    month: string,
    f: { activeAtStart?: number | null; newClients?: number | null },
  ) => Promise<void>;
}) {
  const start = page.starts.find(s => s.month === row.month);
  const launched = page.launches.find(l => l.month === row.month)?.names ?? [];
  const band = row.band;
  return (
    <section
      className="rounded-2xl border bg-card"
      aria-labelledby="this-month"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-6 sm:pt-6">
        <h2 id="this-month" className="text-[15px] font-semibold">
          {monthName(row.month)}
        </h2>
        {band ? <Chip tone={band.tone}>{band.label}</Chip> : null}
      </div>
      <div className="flex flex-wrap items-end gap-x-10 gap-y-3 px-4 pt-3 sm:px-6">
        <div>
          <div
            className={cn(
              "whitespace-nowrap text-4xl font-semibold tracking-tight tabular-nums",
              row.rolling3Pct === null
                ? "text-muted-foreground"
                : row.rolling3Pct <= TARGET_PCT
                  ? "txt-good"
                  : "txt-bad",
            )}
          >
            {pct(row.rolling3Pct)}
          </div>
          <div className="text-xs text-muted-foreground">
            Churn over the last three months · target under {TARGET_PCT}%
          </div>
        </div>
        <div className="pb-1 text-sm">
          This month{" "}
          <span className="font-semibold tabular-nums">
            {pct(row.churnPct)}
          </span>
          <span className="text-muted-foreground">
            {row.activeAtStart
              ? ` · ${row.churned} of ${row.activeAtStart} active at the start`
              : ""}
          </span>
        </div>
      </div>
      <div className="@container px-4 pb-4 pt-4 sm:px-6 sm:pb-6">
        <div className="grid grid-cols-2 gap-3 @md:grid-cols-3 @3xl:grid-cols-6">
          <StatTile
            plain
            label="Active at the start"
            value={
              <NumberCell
                value={row.activeAtStart}
                label={`Active clients at the start of ${monthName(row.month)}`}
                onSave={n => onSave(row.month, { activeAtStart: n })}
              />
            }
            sub={
              row.startCarried ? (
                "Carried from last month"
              ) : row.activeAtStart === null &&
                start?.paying !== null &&
                start?.paying !== undefined ? (
                <Suggest
                  onUse={() =>
                    onSave(row.month, { activeAtStart: start?.paying ?? null })
                  }
                >
                  Use {start?.paying}, the roster on {shortDay(start?.day)}
                </Suggest>
              ) : row.activeAtStart === null ? (
                "Type it once"
              ) : (
                "Typed"
              )
            }
          />
          <StatTile
            plain
            label="New clients"
            value={
              <NumberCell
                value={row.newClients}
                label={`New clients in ${monthName(row.month)}`}
                onSave={n => onSave(row.month, { newClients: n })}
              />
            }
            sub={
              row.newClients === null && launched.length ? (
                <Suggest
                  onUse={() =>
                    onSave(row.month, { newClients: launched.length })
                  }
                >
                  Use {launched.length}, launched this month
                </Suggest>
              ) : row.newClients === null ? (
                "Type it at month end"
              ) : (
                "Typed"
              )
            }
          />
          <StatTile
            plain
            label="Churned"
            value={row.churned}
            sub="Left before day 90"
            tone={row.churned ? "txt-bad" : undefined}
          />
          <StatTile
            plain
            label="Finished the term"
            value={row.completed}
            sub="Day 90 or later"
          />
          <StatTile
            plain
            label="Active at the end"
            value={row.activeAtEnd ?? "Not yet"}
            sub="Start + new − left"
          />
          <StatTile
            plain
            label="Net growth"
            value={
              row.netGrowth === null
                ? "Not yet"
                : `${row.netGrowth > 0 ? "+" : ""}${row.netGrowth}`
            }
            sub="New − left"
          />
        </div>
        {row.unknown ? (
          <p className="mt-3 text-sm txt-warn">
            {plural(row.unknown, "departure")} this month{" "}
            {row.unknown === 1 ? "has" : "have"} no launch date, so{" "}
            {row.unknown === 1 ? "it does" : "they do"} not count either way
            yet. Open {row.unknown === 1 ? "it" : "them"} below and add one.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Suggest({
  children,
  onUse,
}: {
  children: ReactNode;
  onUse: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onUse();
        } catch {
          // The page shows the error.
        } finally {
          setBusy(false);
        }
      }}
      className="text-left text-primary underline-offset-2 hover:underline disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** A count that turns into a field when clicked; Enter or leaving it saves, Escape puts it back. */
function NumberCell({
  value,
  label,
  onSave,
  className,
}: {
  value: number | null;
  label: string;
  onSave: (n: number | null) => Promise<void>;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value === null ? "" : String(value));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!editing) setText(value === null ? "" : String(value));
  }, [value, editing]);
  const save = async () => {
    const t = text.trim();
    const n = t === "" ? null : Number(t);
    if (n === value || (n !== null && (!Number.isInteger(n) || n < 0))) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onSave(n);
      setEditing(false);
    } catch {
      // The page shows the error; the number stays for another try.
    } finally {
      setBusy(false);
    }
  };
  if (!editing)
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`${label}: ${value ?? "not set"}. Edit`}
        className={cn(
          "group inline-flex items-center gap-1.5 rounded-md text-left tabular-nums underline-offset-4 decoration-muted-foreground/40 hover:underline",
          value === null ? "text-muted-foreground" : "",
          className,
        )}
      >
        {value ?? "Add"}
        <Pencil
          className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:opacity-100"
          aria-hidden
        />
      </button>
    );
  return (
    <span className="inline-flex items-center gap-1">
      <input
        // biome-ignore lint/a11y/noAutofocus: opened by a click on the number itself
        autoFocus
        inputMode="numeric"
        value={text}
        disabled={busy}
        aria-label={label}
        onChange={e => setText(e.target.value.replace(/[^\d]/g, ""))}
        onBlur={() => void save()}
        onKeyDown={e => {
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          }
          if (e.key === "Escape") setEditing(false);
        }}
        className="h-9 w-20 rounded-md border border-input bg-background px-2 text-base font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      {busy ? (
        <Loader2
          className="size-4 animate-spin text-muted-foreground"
          aria-hidden
        />
      ) : null}
    </span>
  );
}

// --- logging a departure --------------------------------------------------------------

function DepartureForm({
  draft,
  page,
  onCancel,
  onSave,
  onRemove,
}: {
  draft: Draft;
  page: Page;
  onCancel: () => void;
  onSave: (d: Draft) => Promise<void>;
  onRemove: ((why: string) => Promise<void>) | null;
}) {
  const [d, setD] = useState<Draft>(draft);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [why, setWhy] = useState("");
  const ids = useId();
  const set = (patch: Partial<Draft>) => setD(x => ({ ...x, ...patch }));

  /** Picking a known client fills what the cockpit already knows about them. */
  const pick = (name: string) => {
    const c: PickClient | undefined = page.clients.find(
      x => x.name.toLowerCase() === name.trim().toLowerCase(),
    );
    if (!c) {
      set({ client: name, clickupTaskId: null });
      return;
    }
    set({
      client: c.name,
      clickupTaskId: c.key,
      launchedOn: d.launchedOn || c.launchedOn || "",
      csm: d.csm || c.csm || "",
      mrrLostUsd: d.mrrLostUsd || (c.mrrUsd === null ? "" : String(c.mrrUsd)),
    });
  };

  const verdict = d.leftOn
    ? {
        kind: countsAs({ leftOn: d.leftOn, launchedOn: d.launchedOn || null }),
        line: verdictLine({
          leftOn: d.leftOn,
          launchedOn: d.launchedOn || null,
        }),
      }
    : null;
  const ready = d.client.trim() && d.leftOn && d.reason;

  return (
    <form
      id="churn-form"
      className="scroll-mt-6 rounded-2xl border bg-card p-4 sm:p-6"
      onSubmit={async e => {
        e.preventDefault();
        if (!ready) return;
        setBusy(true);
        try {
          await onSave(d);
        } catch {
          // The page shows the error; the form keeps what was typed.
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-[15px] font-semibold">
          {d.id ? `Correct ${draft.client}` : "Log a departure"}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close"
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-10"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-1 sm:col-span-2">
          <label
            htmlFor={`${ids}-client`}
            className="text-xs font-medium text-muted-foreground"
          >
            Client
          </label>
          <Input
            id={`${ids}-client`}
            value={d.client}
            onChange={e => pick(e.target.value)}
            list="churn-clients"
            placeholder="Start typing a client"
            dir="auto"
            autoComplete="off"
          />
          <datalist id="churn-clients">
            {page.clients.map(c => (
              <option key={c.key} value={c.name} />
            ))}
          </datalist>
        </div>
        <div className="grid gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            Left on
          </span>
          <DateInput
            value={d.leftOn}
            max={page.today}
            onChange={e => set({ leftOn: e.target.value })}
            aria-label="Left on"
          />
        </div>
        <div className="grid gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            Launched on
          </span>
          <DateInput
            value={d.launchedOn}
            max={d.leftOn || page.today}
            onChange={e => set({ launchedOn: e.target.value })}
            aria-label="Launched on"
          />
        </div>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground sm:col-span-2">
          Why they left
          <select
            value={d.reason}
            onChange={e => set({ reason: e.target.value })}
            className={field}
          >
            <option value="" disabled>
              Pick one
            </option>
            {page.reasons.map(r => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-1">
          <label
            htmlFor={`${ids}-mrr`}
            className="text-xs font-medium text-muted-foreground"
          >
            Monthly value lost ($)
          </label>
          <Input
            id={`${ids}-mrr`}
            value={d.mrrLostUsd}
            onChange={e =>
              set({ mrrLostUsd: e.target.value.replace(/[^\d.]/g, "") })
            }
            inputMode="decimal"
            placeholder="0"
          />
        </div>
        <div className="grid gap-1">
          <label
            htmlFor={`${ids}-csm`}
            className="text-xs font-medium text-muted-foreground"
          >
            CSM
          </label>
          <Input
            id={`${ids}-csm`}
            value={d.csm}
            onChange={e => set({ csm: e.target.value })}
            placeholder="Who looked after them"
          />
        </div>
        <div className="grid gap-1 sm:col-span-2 lg:col-span-4">
          <label
            htmlFor={`${ids}-note`}
            className="text-xs font-medium text-muted-foreground"
          >
            Note
          </label>
          <Textarea
            id={`${ids}-note`}
            value={d.note}
            onChange={e => set({ note: e.target.value })}
            rows={2}
            placeholder="What happened, in a sentence. Optional."
            className="resize-none"
            dir="auto"
          />
        </div>
      </div>
      {verdict ? (
        <p className="mt-4 flex items-center gap-2 text-sm">
          <Chip
            tone={
              verdict.kind === "churn"
                ? "bad"
                : verdict.kind === "completed"
                  ? "neutral"
                  : "warn"
            }
          >
            {verdict.kind === "churn"
              ? "Churn"
              : verdict.kind === "completed"
                ? "Finished the term"
                : "Needs a launch date"}
          </Chip>
          <span className="text-muted-foreground">{verdict.line}</span>
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy || !ready}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {d.id ? "Save changes" : "Log it"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <span className="flex-1" />
        {onRemove ? (
          removing ? (
            <span className="flex flex-wrap items-center gap-2">
              <Input
                value={why}
                onChange={e => setWhy(e.target.value)}
                placeholder="Why it comes out"
                className="h-8 w-56 text-sm"
                aria-label="Why it comes out of the register"
              />
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={busy || why.trim().length < 4}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onRemove(why);
                  } catch {
                    // The page shows the error.
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Take it out
              </Button>
            </span>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => setRemoving(true)}
            >
              Take out of the register
            </Button>
          )
        ) : null}
      </div>
    </form>
  );
}

// --- waiting to be logged -------------------------------------------------------------

function WaitingList({
  items,
  onLog,
  onDismiss,
}: {
  items: Waiting[];
  onLog: (w: Waiting) => void;
  onDismiss: (w: Waiting, why: string) => Promise<void>;
}) {
  return (
    <section className="rounded-2xl border bg-card" aria-labelledby="waiting">
      <div className="px-4 pt-4 sm:px-6 sm:pt-5">
        <h2 id="waiting" className="text-[15px] font-semibold">
          Not in the register yet
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          ClickUp and the daily roster say these clients left. Log each one, or
          say it was not a departure.
        </p>
      </div>
      <ul className="mt-3 divide-y border-t">
        {items.map(w => (
          <WaitingRow key={w.key} w={w} onLog={onLog} onDismiss={onDismiss} />
        ))}
      </ul>
    </section>
  );
}

function WaitingRow({
  w,
  onLog,
  onDismiss,
}: {
  w: Waiting;
  onLog: (w: Waiting) => void;
  onDismiss: (w: Waiting, why: string) => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          <bdi>{w.client}</bdi>
        </div>
        <div className="text-xs text-muted-foreground">
          Left {shortDay(w.leftOn)} · {w.why}
        </div>
      </div>
      {asking ? (
        <span className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Not a departure?</span>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onDismiss(w, "");
              } catch {
                // The page shows the error.
              } finally {
                setBusy(false);
              }
            }}
          >
            <Check aria-hidden /> Yes, hide it
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
            Keep
          </Button>
        </span>
      ) : (
        <span className="flex items-center gap-1">
          <Button size="sm" onClick={() => onLog(w)}>
            Log it
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => setAsking(true)}
          >
            Not a departure
          </Button>
        </span>
      )}
    </li>
  );
}

// --- the register -------------------------------------------------------------------

/** Where in the 90 days they left: a slim track, the marker at their day. */
function TermBar({ days }: { days: number | null }) {
  if (days === null)
    return (
      <span
        className="block h-1.5 w-16 rounded-full border border-dashed border-warning/60"
        aria-hidden
      />
    );
  const at = Math.min(days, PROGRAMME_DAYS) / PROGRAMME_DAYS;
  const churn = days < PROGRAMME_DAYS;
  return (
    <span
      className="relative block h-1.5 w-16 rounded-full bg-muted"
      aria-hidden
    >
      <span
        className={cn(
          "absolute inset-y-0 left-0 rounded-full",
          churn ? "bg-destructive/70" : "bg-primary/70",
        )}
        style={{ width: `${at * 100}%` }}
      />
    </span>
  );
}

function Register({
  departures,
  onEdit,
  onAdd,
}: {
  departures: Departure[];
  onEdit: (d: Departure) => void;
  onAdd: () => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? departures : departures.slice(0, 50);
  return (
    <section className="rounded-2xl border bg-card" aria-labelledby="register">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 sm:px-6 sm:pt-5">
        <h2 id="register" className="text-[15px] font-semibold">
          Departures
        </h2>
        <span className="text-xs text-muted-foreground">
          {departures.length
            ? `${plural(departures.length, "client")} logged · click a row to correct it`
            : ""}
        </span>
      </div>
      {departures.length ? (
        <ul className="mt-3 divide-y border-t">
          {shown.map(d => {
            const n = daysIn(d);
            const kind = countsAs(d);
            return (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => onEdit(d)}
                  className="grid w-full gap-1 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6 sm:px-6"
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium">
                        <bdi>{d.client}</bdi>
                      </span>
                      <Chip
                        tone={
                          kind === "churn"
                            ? "bad"
                            : kind === "completed"
                              ? "neutral"
                              : "warn"
                        }
                      >
                        {kind === "churn"
                          ? `Churn · day ${n}`
                          : kind === "completed"
                            ? `Finished the term · day ${n}`
                            : "Needs a launch date"}
                      </Chip>
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Left {shortDay(d.leftOn)}
                      {d.launchedOn
                        ? ` · launched ${shortDay(d.launchedOn)}`
                        : ""}
                      {` · ${d.reason}`}
                      {d.csm ? ` · ${d.csm}` : ""}
                      {d.note ? ` · ${d.note}` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-4 sm:justify-end">
                    <TermBar days={n} />
                    <span className="w-20 text-right text-sm tabular-nums">
                      {usd(d.mrrLostUsd)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="px-4 pb-6 pt-3 sm:px-6">
          <p className="text-sm text-muted-foreground">
            Nobody is in the register yet. Log a client the day they leave, and
            the month below counts it.
          </p>
          <Button size="sm" variant="outline" className="mt-3" onClick={onAdd}>
            <Plus aria-hidden /> Log a departure
          </Button>
        </div>
      )}
      {departures.length > 50 ? (
        <button
          type="button"
          onClick={() => setAll(a => !a)}
          className="w-full border-t px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground sm:px-6"
        >
          {all ? "Show the latest 50" : `Show all ${departures.length}`}
        </button>
      ) : null}
    </section>
  );
}

// --- by month -----------------------------------------------------------------------

function Months({
  rows,
  onSave,
}: {
  rows: MonthRow[];
  onSave: (
    month: string,
    f: { activeAtStart?: number | null; newClients?: number | null },
  ) => Promise<void>;
}) {
  return (
    <section className="rounded-2xl border bg-card" aria-labelledby="months">
      <div className="px-4 pt-4 sm:px-6 sm:pt-5">
        <h2 id="months" className="text-[15px] font-semibold">
          By month
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Click a start or a new-clients count to change it. A blank start
          carries from the month before.
        </p>
      </div>
      <div className="mt-3 overflow-x-auto border-t">
        <table className="w-full min-w-[46rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              {[
                "Month",
                "Start",
                "New",
                "Churned",
                "Finished term",
                "End",
                "Churn",
                "3 months",
                "",
              ].map(h => (
                <th
                  key={h}
                  className="px-4 py-2 font-medium first:pl-4 sm:first:pl-6"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(r => (
              <tr key={r.month} className="tabular-nums">
                <td className="whitespace-nowrap px-4 py-2.5 sm:pl-6">
                  {monthName(r.month)}
                  {r.lostBeforeRegister !== null ? (
                    <span
                      className="block text-xs text-muted-foreground"
                      title={r.note ?? undefined}
                    >
                      from the old sheet
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2.5">
                  <NumberCell
                    value={r.activeAtStart}
                    label={`Active clients at the start of ${monthName(r.month)}`}
                    onSave={n => onSave(r.month, { activeAtStart: n })}
                    className={r.startCarried ? "text-muted-foreground" : ""}
                  />
                </td>
                <td className="px-4 py-2.5">
                  <NumberCell
                    value={r.newClients}
                    label={`New clients in ${monthName(r.month)}`}
                    onSave={n => onSave(r.month, { newClients: n })}
                  />
                </td>
                <td className={cn("px-4 py-2.5", r.churned ? "txt-bad" : "")}>
                  {r.churned}
                </td>
                <td className="px-4 py-2.5">{r.completed}</td>
                <td className="px-4 py-2.5">{r.activeAtEnd ?? "–"}</td>
                <td className="px-4 py-2.5">{pct(r.churnPct)}</td>
                <td className="px-4 py-2.5 font-medium">
                  {pct(r.rolling3Pct)}
                </td>
                <td className="px-4 py-2.5 pr-4 sm:pr-6">
                  {r.band ? (
                    <Chip tone={r.band.tone}>{r.band.label}</Chip>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// --- the rules, and what changed ---------------------------------------------------------

function Rules() {
  return (
    <details className="rounded-2xl border bg-card px-4 py-3 sm:px-6">
      <summary className="cursor-pointer text-[15px] font-semibold">
        How churn is counted
      </summary>
      <ul className="mt-3 grid list-disc gap-2 pb-2 pl-5 text-sm leading-relaxed">
        <li>
          Churn is a client lost before day {PROGRAMME_DAYS} from launch. A
          client who finishes the {PROGRAMME_DAYS} days and does not renew has
          finished the term: it is counted on its own line and is never churn,
          so one client leaving is never counted twice.
        </li>
        <li>
          The day they left is the day they said they were stopping, 14 days
          after a payment-failure pause, or 14 days with no reply across three
          channels. A paused client asked to pause in writing has not left.
        </li>
        <li>
          Churn is never reversed. A client who comes back is a reactivation,
          and their churn stays in the month it happened.
        </li>
        <li>
          Each month needs two numbers: clients active at the start (left blank,
          it carries from the month before) and new clients. Everything else is
          worked out from the register.
        </li>
        <li>
          Manage against the three-month figure: at 17 clients one departure is
          5.9%, so a single month says little. 0 to 4% is excellent, 5 to 8%
          good, 9 to 10% on target, 11 to 12% watch, 13 to 15% bad, over 15%
          critical.
        </li>
      </ul>
    </details>
  );
}

function Changes({ log }: { log: Page["log"] }) {
  if (!log.length) return null;
  return (
    <details className="rounded-2xl border bg-card px-4 py-3 sm:px-6">
      <summary className="cursor-pointer text-sm font-semibold">
        What changed
      </summary>
      <Kicker className="mt-3">Latest first</Kicker>
      <ul className="mt-2 grid gap-1.5 pb-2 text-xs">
        {log.slice(0, 15).map((l, i) => (
          <li key={i}>
            <span className="text-muted-foreground">
              {shortDay(l.at.slice(0, 10))}:{" "}
            </span>
            {l.by.split("@")[0]} {l.what}
          </li>
        ))}
      </ul>
    </details>
  );
}
