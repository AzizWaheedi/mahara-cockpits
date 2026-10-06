import {
  ArrowUpRight,
  CalendarPlus,
  ChevronRight,
  Loader2,
  RefreshCw,
  Star,
} from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  callLabel,
  daysLabel,
  FILTER_LABEL,
  type GoldRow,
  LIKELIHOOD_LABEL,
  LIKELIHOODS,
  type Likelihood,
  metricValue,
  type PlanPatch,
  type PlanStatus,
  type ProjectionsEdit,
  type ProjectionsPage,
  type ProjectionWeek,
  STATE_LABEL,
  STATUS_LABEL,
  STATUSES,
  type StripRow,
  shortDay,
  VERDICT_LABEL,
  type Verdict,
  type WindowFilter,
  type WindowRow,
  weekdayDay,
} from "@/lib/projectionsView";
import { cn } from "@/lib/utils";

/**
 * The Projections screen's parts, the same file in the client success
 * cockpit (its own tab) and the media buyer (the Sunday meeting's page);
 * scripts/check-shared.sh keeps the two identical below the imports.
 *
 * Nothing here reads or writes data: each part takes the page the client
 * success backend built and hands every change back through `onEdit`, so
 * both apps show the same thing and write through the same rules.
 *
 * The signature is the notched track: blood and stretch are two notches on
 * one line and the week's actual fills it in teal, orange while it is below
 * blood, red once the week closed short.
 */

export type Edit = (e: ProjectionsEdit) => Promise<void>;
export type Book = (a: {
  taskId: string;
  day: string;
  time: string;
}) => Promise<void>;

const errorText = (e: unknown) => {
  const data = (e as { data?: { message?: string } })?.data;
  const raw = data?.message ?? (e instanceof Error ? e.message : String(e));
  return raw.replace(/^[\s\S]*?(Uncaught )?(Convex)?Error: /, "").trim();
};

/** Runs a change, keeps the button busy while it runs, keeps its error. */
function useRun(): {
  busy: boolean;
  error: string | null;
  run: (fn: () => Promise<void>) => Promise<boolean>;
  clear: () => void;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return {
    busy,
    error,
    clear: () => setError(null),
    run: async fn => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        return true;
      } catch (e) {
        setError(errorText(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
  };
}

// --- small pieces --------------------------------------------------------------------

type Tone = "good" | "warn" | "bad" | "neutral" | "accent";

const DOT: Record<Tone, string> = {
  good: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
  neutral: "bg-muted-foreground/60",
  accent: "bg-primary",
};

function StateChip({
  tone,
  children,
  title,
}: {
  tone: Tone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium"
    >
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", DOT[tone])}
      />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

function Pill({
  active,
  onClick,
  children,
  disabled,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={title}
      className={cn(
        "inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        active
          ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function PillRow({ children }: { children: ReactNode }) {
  return (
    <div className="no-scrollbar relative -mx-1 flex flex-nowrap items-center gap-1 overflow-x-auto px-1 py-0.5">
      {children}
    </div>
  );
}

function Card({
  title,
  sub,
  action,
  children,
  flush,
  className,
}: {
  title: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-2xl border bg-card",
        flush ? "" : "p-4 sm:p-6",
        className,
      )}
    >
      <header
        className={cn(
          "flex flex-wrap items-start justify-between gap-3",
          flush ? "px-4 pt-4 sm:px-6 sm:pt-6" : "",
        )}
      >
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {sub ? (
            <p className="mt-0.5 text-sm text-muted-foreground">{sub}</p>
          ) : null}
        </div>
        {action ? (
          <div className="flex flex-wrap items-center gap-2">{action}</div>
        ) : null}
      </header>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="mt-2 text-sm txt-bad">
      {text}
    </p>
  );
}

const onEnter = (fn: () => void) => (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === "Enter") {
    e.preventDefault();
    fn();
  }
};

// --- the notched track -------------------------------------------------------------------

const VERDICT_TONE: Record<Verdict, Tone> = {
  unset: "neutral",
  no_actual: "warn",
  stretch: "accent",
  hit: "good",
  behind: "warn",
  missed: "bad",
};

/** A notch's number, short enough to sit under it: "$4k", "2". */
function notchValue(unit: "count" | "usd", n: number): string {
  if (unit === "usd" && n >= 1000)
    return `$${Math.round(n / 100) / 10}k`.replace(".0k", "k");
  return metricValue(unit, n);
}

/**
 * Blood and stretch as two notches with their numbers under them, the
 * actual as the fill. The one place on the page that carries colour.
 */
export function NotchTrack({ row }: { row: StripRow }) {
  const { blood, stretch, actual, unit, verdict } = row;
  const top = Math.max(
    1,
    (stretch ?? 0) * 1.2,
    (actual ?? 0) * 1.06,
    (blood ?? 0) * 1.5,
  );
  const pct = (n: number) => Math.min(100, Math.max(0, (n / top) * 100));
  const at = (n: number) => `${pct(n)}%`;
  const fill =
    verdict === "missed"
      ? "bg-destructive"
      : verdict === "behind"
        ? "bg-warning"
        : "bg-primary";
  const said = [
    actual === null
      ? "actual not known"
      : `actual ${metricValue(unit, actual)}`,
    blood === null ? "no blood number" : `blood ${metricValue(unit, blood)}`,
    stretch === null ? null : `stretch ${metricValue(unit, stretch)}`,
  ]
    .filter(Boolean)
    .join(", ");
  const showStretch = stretch !== null && stretch !== blood;
  // Two numbers closer than this share one label under the blood notch.
  const close =
    blood !== null &&
    stretch !== null &&
    showStretch &&
    Math.abs(pct(stretch) - pct(blood)) < 9;
  /** Keeps a label inside the track at either end. */
  const place = (n: number) => {
    const x = pct(n);
    return x < 6
      ? { left: `${x}%`, transform: "translateX(0)" }
      : x > 94
        ? { left: `${x}%`, transform: "translateX(-100%)" }
        : { left: `${x}%`, transform: "translateX(-50%)" };
  };
  return (
    <div role="img" aria-label={said} className="relative h-10 w-full min-w-24">
      <div
        className={cn(
          "absolute inset-x-0 top-3 h-1.5 -translate-y-1/2 rounded-full",
          actual === null
            ? "border border-dashed border-muted-foreground/40"
            : "bg-muted",
        )}
      />
      {actual !== null && actual > 0 ? (
        <div
          className={cn(
            "absolute left-0 top-3 h-1.5 -translate-y-1/2 rounded-full motion-safe:transition-[width] motion-safe:duration-500",
            fill,
          )}
          style={{ width: at(actual) }}
        />
      ) : null}
      {blood !== null ? (
        <span
          aria-hidden
          className="absolute top-0 h-6 w-[3px] -translate-x-1/2 rounded-full bg-foreground/85"
          style={{ left: at(blood) }}
        />
      ) : null}
      {showStretch && stretch !== null ? (
        <span
          aria-hidden
          className="absolute top-1 h-4 w-[3px] -translate-x-1/2 rounded-full bg-foreground/35"
          style={{ left: at(stretch) }}
        />
      ) : null}
      {blood !== null ? (
        <span
          aria-hidden
          className="absolute top-6 whitespace-nowrap text-[11px] font-medium tabular-nums text-foreground/85"
          style={place(blood)}
        >
          {notchValue(unit, blood)}
          {close && stretch !== null ? (
            <span className="text-muted-foreground">
              {" "}
              / {notchValue(unit, stretch)}
            </span>
          ) : null}
        </span>
      ) : null}
      {showStretch && stretch !== null && !close ? (
        <span
          aria-hidden
          className="absolute top-6 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground"
          style={place(stretch)}
        >
          {notchValue(unit, stretch)}
        </span>
      ) : null}
    </div>
  );
}

function Legend() {
  return (
    <div
      aria-hidden
      className="flex items-center gap-4 text-xs text-muted-foreground"
    >
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3.5 w-[3px] rounded-full bg-foreground/85" /> Blood
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-[3px] rounded-full bg-foreground/35" /> Stretch
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-4 rounded-full bg-primary" /> Actual
      </span>
    </div>
  );
}

// --- the week strip ------------------------------------------------------------------------

function StripLine({
  row,
  week,
  owner,
  onEdit,
  canEdit,
}: {
  row: StripRow;
  week: ProjectionWeek;
  owner: string;
  onEdit: Edit;
  canEdit: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [blood, setBlood] = useState("");
  const [stretch, setStretch] = useState("");
  const [actual, setActual] = useState("");
  const [why, setWhy] = useState(row.missReason ?? "");
  const r = useRun();
  useEffect(() => setWhy(row.missReason ?? ""), [row.missReason]);
  const start = () => {
    setBlood(row.blood === null ? "" : String(row.blood));
    setStretch(row.stretch === null ? "" : String(row.stretch));
    setActual(
      row.actualFrom === "manual" && row.actual !== null
        ? String(row.actual)
        : "",
    );
    r.clear();
    setOpen(true);
  };
  const save = async () => {
    const ok = await r.run(async () => {
      if (blood.trim() === "" || stretch.trim() === "")
        throw new Error("Give both numbers: blood and stretch.");
      await onEdit({
        kind: "projection",
        weekStart: week.weekStart,
        metric: row.metric,
        blood: Number(blood),
        stretch: Number(stretch),
        forEmail: owner,
      });
      if (row.manualAllowed) {
        const typed = actual.trim() === "" ? null : Number(actual);
        const had = row.actualFrom === "manual" ? row.actual : null;
        if (typed !== had)
          await onEdit({
            kind: "actual",
            weekStart: week.weekStart,
            metric: row.metric,
            actual: typed,
            forEmail: owner,
          });
      }
    });
    if (ok) setOpen(false);
  };
  const saveWhy = () =>
    why.trim() !== (row.missReason ?? "") &&
    r.run(() =>
      onEdit({
        kind: "missReason",
        weekStart: week.weekStart,
        metric: row.metric,
        reason: why,
        forEmail: owner,
      }),
    );
  const showWhy = row.verdict === "missed";
  const usd = row.unit === "usd";
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 md:grid-cols-[9.5rem_minmax(0,1fr)_6.5rem_10.5rem]">
        <div className="min-w-0 text-sm font-medium">{row.label}</div>
        <div className="flex items-center justify-end gap-1 md:order-last">
          <StateChip tone={VERDICT_TONE[row.verdict]}>
            {VERDICT_LABEL[row.verdict]}
          </StateChip>
          {canEdit ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={open ? () => setOpen(false) : start}
              aria-expanded={open}
              aria-controls={`${id}-edit`}
            >
              {open ? "Close" : row.blood === null ? "Set" : "Edit"}
            </Button>
          ) : null}
        </div>
        <div className="col-span-2 pt-2 md:col-span-1 md:pt-3">
          <NotchTrack row={row} />
        </div>
        <div className="col-span-2 md:col-span-1 md:text-right">
          {row.actual !== null ? (
            <span className="whitespace-nowrap text-xl font-semibold tabular-nums tracking-tight">
              {metricValue(row.unit, row.actual)}
            </span>
          ) : row.actualFrom === "missing" && canEdit ? (
            <button
              type="button"
              onClick={start}
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Enter it
            </button>
          ) : (
            <span className="text-sm text-muted-foreground">Not known</span>
          )}
        </div>
      </div>
      <p
        className="mt-1 text-xs text-muted-foreground md:pl-[10.5rem]"
        title={row.note}
      >
        {row.actualFrom === "manual" ? "Typed in by hand. " : ""}
        {row.actualFrom === "manual"
          ? row.note.replace(/^Entered by hand\. /, "")
          : row.note}
      </p>
      {showWhy ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 md:pl-[10.5rem]">
          <label
            htmlFor={`${id}-why`}
            className="text-xs text-muted-foreground"
          >
            Why missed
          </label>
          <Input
            id={`${id}-why`}
            value={why}
            onChange={e => setWhy(e.target.value)}
            onBlur={() => void saveWhy()}
            onKeyDown={onEnter(() => void saveWhy())}
            placeholder="One line: what got in the way"
            disabled={!canEdit}
            className="h-8 min-w-0 flex-1 text-sm"
          />
        </div>
      ) : null}
      {open ? (
        <div
          id={`${id}-edit`}
          className="mt-3 flex flex-wrap items-end gap-3 rounded-xl bg-muted/40 p-3 md:ml-[10.5rem]"
        >
          <div className="grid gap-1">
            <label
              htmlFor={`${id}-blood`}
              className="text-xs text-muted-foreground"
            >
              Blood{usd ? " ($)" : ""}
            </label>
            <Input
              id={`${id}-blood`}
              inputMode="decimal"
              value={blood}
              onChange={e => setBlood(e.target.value)}
              onKeyDown={onEnter(() => void save())}
              className="h-8 w-24 tabular-nums"
            />
          </div>
          <div className="grid gap-1">
            <label
              htmlFor={`${id}-stretch`}
              className="text-xs text-muted-foreground"
            >
              Stretch{usd ? " ($)" : ""}
            </label>
            <Input
              id={`${id}-stretch`}
              inputMode="decimal"
              value={stretch}
              onChange={e => setStretch(e.target.value)}
              onKeyDown={onEnter(() => void save())}
              className="h-8 w-24 tabular-nums"
            />
          </div>
          {row.manualAllowed ? (
            <div className="grid gap-1">
              <label
                htmlFor={`${id}-actual`}
                className="text-xs text-muted-foreground"
              >
                Actual, by hand
              </label>
              <Input
                id={`${id}-actual`}
                inputMode="decimal"
                value={actual}
                onChange={e => setActual(e.target.value)}
                onKeyDown={onEnter(() => void save())}
                placeholder="Leave empty if unknown"
                className="h-8 w-44 tabular-nums"
              />
            </div>
          ) : null}
          <Button
            type="button"
            size="sm"
            onClick={() => void save()}
            disabled={r.busy}
          >
            {r.busy ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
        </div>
      ) : null}
      <ErrorLine text={r.error} />
    </li>
  );
}

/** Blood, stretch and actual for each metric, this week or last. */
export function ProjectionStrip({
  page,
  onEdit,
  canEdit = true,
  initial = "this",
}: {
  page: ProjectionsPage;
  onEdit: Edit;
  canEdit?: boolean;
  initial?: "this" | "last";
}) {
  const [which, setWhich] = useState<"this" | "last">(initial);
  const week = which === "this" ? page.thisWeek : page.lastWeek;
  return (
    <Card
      title={which === "this" ? "This week" : "Last week"}
      sub={`${weekdayDay(week.weekStart)} to ${weekdayDay(week.weekEnd)}`}
      action={
        <PillRow>
          <Pill active={which === "this"} onClick={() => setWhich("this")}>
            This week
          </Pill>
          <Pill active={which === "last"} onClick={() => setWhich("last")}>
            Last week
          </Pill>
        </PillRow>
      }
    >
      <Legend />
      <ul className="mt-4 divide-y">
        {week.rows.map(r => (
          <StripLine
            key={`${week.weekStart}-${r.metric}`}
            row={r}
            week={week}
            owner={page.owner}
            onEdit={onEdit}
            canEdit={canEdit}
          />
        ))}
      </ul>
    </Card>
  );
}

// --- the renewal window -------------------------------------------------------------------------

const STATE_TONE: Record<WindowRow["state"], Tone> = {
  missed: "bad",
  red: "bad",
  outcome_due: "warn",
  booked: "accent",
  planned: "neutral",
  done: "good",
};

function rowChip(r: WindowRow): { tone: Tone; text: string } {
  if (r.state === "done")
    return {
      tone: r.status === "lost" ? "bad" : "good",
      text: STATUS_LABEL[r.status],
    };
  if (r.state === "booked" && r.callBookedFor)
    return { tone: "accent", text: `Call ${callLabel(r.callBookedFor)}` };
  return { tone: STATE_TONE[r.state], text: STATE_LABEL[r.state] };
}

/** What to do before the window can fill: one line, and the clients it is missing for. */
function UnknownDates({ page }: { page: ProjectionsPage }) {
  const [all, setAll] = useState(false);
  const w = page.window;
  const names = w.missing.map(m => m.clientName);
  const shown = all ? names : names.slice(0, 12);
  return (
    <div className="rounded-xl bg-muted/40 p-4 text-sm">
      <p className="font-medium">Renewal date unknown</p>
      <p className="mt-1 text-muted-foreground">
        {w.tracked
          ? `${names.length} client${names.length === 1 ? " has" : "s have"} no "${w.field.name}" on the ClickUp card, so ${names.length === 1 ? "it" : "they"} cannot enter the window.`
          : `No client card has a contract end date yet. Add a ${w.field.type} field named "${w.field.name}" to ${w.field.list} in ClickUp and fill it in: the window fills on the next sync.`}
      </p>
      {names.length ? (
        <p className="mt-2 text-muted-foreground">
          <span className="text-foreground">Missing it: </span>
          {shown.join(", ")}
          {names.length > shown.length ? (
            <>
              {" "}
              <button
                type="button"
                onClick={() => setAll(true)}
                className="text-primary underline-offset-4 hover:underline"
              >
                and {names.length - shown.length} more
              </button>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/** Every client whose contract ends in the next 60 days, red first. */
export function RenewalWindow({
  page,
  onOpen,
}: {
  page: ProjectionsPage;
  onOpen: (taskId: string) => void;
}) {
  const [filter, setFilter] = useState<WindowFilter | "all">("all");
  const rows = page.window.rows;
  const count = (f: WindowFilter) =>
    rows.filter(r => r.filters.includes(f)).length;
  const shown =
    filter === "all"
      ? rows.filter(r => r.state !== "done")
      : rows.filter(r => r.filters.includes(filter));
  const red = rows.filter(
    r => r.state === "red" || r.state === "missed",
  ).length;
  const filters: WindowFilter[] = ["0-30", "31-60", "booked", "done"];
  return (
    <Card
      title="Renewal window"
      sub={
        red
          ? `${red} client${red === 1 ? "" : "s"} inside 30 days with no proactive call booked or reason written`
          : "Every client whose contract ends in the next 60 days"
      }
      action={
        rows.length ? (
          <PillRow>
            <Pill active={filter === "all"} onClick={() => setFilter("all")}>
              Open
            </Pill>
            {filters
              .filter(f => count(f) > 0)
              .map(f => (
                <Pill
                  key={f}
                  active={filter === f}
                  onClick={() => setFilter(f)}
                >
                  {FILTER_LABEL[f]} {count(f)}
                </Pill>
              ))}
          </PillRow>
        ) : null
      }
      flush
    >
      {!page.window.tracked || !rows.length ? (
        <div className="px-4 pb-4 sm:px-6 sm:pb-6">
          {page.window.tracked ? (
            <p className="rounded-xl bg-muted/40 p-4 text-sm text-muted-foreground">
              Nobody renews in the next 60 days.
            </p>
          ) : null}
          {!page.window.tracked || page.window.missing.length ? (
            <div className={page.window.tracked ? "mt-3" : ""}>
              <UnknownDates page={page} />
            </div>
          ) : null}
        </div>
      ) : (
        <>
          {/* A phone gets a list: the state is the point, and a table would
              scroll it off the side. */}
          <ul className="divide-y border-t md:hidden">
            {shown.map(r => {
              const chip = rowChip(r);
              const alarm = r.state === "red" || r.state === "missed";
              return (
                <li
                  key={r.taskId}
                  className={cn(
                    alarm && "shadow-[inset_3px_0_0_var(--destructive)]",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onOpen(r.taskId)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {r.clientName}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Renews {shortDay(r.renewalDate)}, {daysLabel(r.days)}
                        {r.likelihood
                          ? `. ${LIKELIHOOD_LABEL[r.likelihood]}`
                          : ""}
                      </span>
                      <span className="mt-1.5 block">
                        <StateChip tone={chip.tone}>{chip.text}</StateChip>
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              );
            })}
            {!shown.length ? (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                Nothing under this filter.
              </li>
            ) : null}
          </ul>
          <div className="relative hidden overflow-x-auto border-t md:block">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b text-left">
                  {["Client", "Renews", "Likelihood", "Where it stands"].map(
                    h => (
                      <th
                        key={h}
                        className="px-2 py-2 font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-muted-foreground first:pl-4 sm:first:pl-6"
                      >
                        {h}
                      </th>
                    ),
                  )}
                  <th className="w-10 pr-4 sm:pr-6">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {shown.map(r => {
                  const chip = rowChip(r);
                  const alarm = r.state === "red" || r.state === "missed";
                  return (
                    <tr
                      key={r.taskId}
                      onClick={() => onOpen(r.taskId)}
                      className={cn(
                        "cursor-pointer hover:bg-muted/40",
                        alarm && "shadow-[inset_3px_0_0_var(--destructive)]",
                      )}
                    >
                      <td className="max-w-56 truncate px-2 py-3 pl-4 font-medium sm:pl-6">
                        {r.clientName}
                      </td>
                      <td className="whitespace-nowrap px-2 py-3 tabular-nums">
                        {shortDay(r.renewalDate)}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {daysLabel(r.days)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-3 text-muted-foreground">
                        {r.likelihood
                          ? LIKELIHOOD_LABEL[r.likelihood]
                          : "Not set"}
                      </td>
                      <td className="px-2 py-3">
                        <StateChip tone={chip.tone}>{chip.text}</StateChip>
                        {r.notThisCycleReason && r.state !== "done" ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            Not this cycle: {r.notThisCycleReason}
                          </span>
                        ) : null}
                      </td>
                      <td className="pr-4 text-right sm:pr-6">
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            onOpen(r.taskId);
                          }}
                          className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                          aria-label={`Open the plan for ${r.clientName}`}
                        >
                          <ChevronRight className="size-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!shown.length ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-6 text-center text-sm text-muted-foreground sm:px-6"
                    >
                      Nothing under this filter.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {page.window.missing.length ? (
            <div className="border-t px-4 py-4 sm:px-6">
              <UnknownDates page={page} />
            </div>
          ) : (
            <div className="h-2" />
          )}
        </>
      )}
    </Card>
  );
}

// --- one client's plan ----------------------------------------------------------------------

function TextField({
  label,
  value,
  onSave,
  multiline,
  placeholder,
  disabled,
}: {
  label: string;
  value: string | null;
  onSave: (v: string) => Promise<boolean>;
  multiline?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(value ?? "");
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value ?? "");
  }, [value, focused]);
  const commit = async () => {
    setFocused(false);
    if (text.trim() !== (value ?? "").trim()) await onSave(text);
  };
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      {multiline ? (
        <Textarea
          id={id}
          value={text}
          onFocus={() => setFocused(true)}
          onChange={e => setText(e.target.value)}
          onBlur={() => void commit()}
          placeholder={placeholder}
          disabled={disabled}
          rows={2}
          className="min-h-16 text-sm"
        />
      ) : (
        <Input
          id={id}
          value={text}
          onFocus={() => setFocused(true)}
          onChange={e => setText(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={e => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder={placeholder}
          disabled={disabled}
          className="h-9 text-sm"
        />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t pt-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

const SLOTS = Array.from({ length: 16 }, (_, i) => {
  const h = 10 + Math.floor(i / 2);
  return `${String(h).padStart(2, "0")}:${i % 2 ? "30" : "00"}`;
});

/**
 * The app's own booking control, when it has one: the client success
 * cockpit books at HighLevel's free times, the same "Book a call" as a
 * client's page (the simplification audit, 2026-10-06), and records the
 * booked time on the plan through `done`.
 */
export type BookWith = (
  row: WindowRow,
  done: (when: string) => Promise<void>,
) => ReactNode;

function BookCall({
  row,
  onBook,
  onEdit,
  today,
  bookWith,
}: {
  row: WindowRow;
  onBook: Book | null;
  onEdit: Edit;
  today: string;
  bookWith?: BookWith;
}) {
  const id = useId();
  const [day, setDay] = useState("");
  const [time, setTime] = useState("13:00");
  const [elsewhere, setElsewhere] = useState("");
  const r = useRun();
  const book = () =>
    r.run(async () => {
      if (!day) throw new Error("Pick the call's day.");
      if (!onBook) throw new Error("Booking is not available here.");
      await onBook({ taskId: row.taskId, day, time });
      setDay("");
    });
  const setOther = () =>
    r.run(async () => {
      if (!elsewhere) throw new Error("Pick the day of the call.");
      await onEdit({
        kind: "plan",
        taskId: row.taskId,
        patch: { callBookedFor: elsewhere },
      });
      setElsewhere("");
    });
  return (
    <div className="space-y-3">
      {row.callBookedFor ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StateChip tone="accent">
            Call {callLabel(row.callBookedFor)}
          </StateChip>
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            onClick={() =>
              void r.run(() =>
                onEdit({
                  kind: "plan",
                  taskId: row.taskId,
                  patch: { callBookedFor: "" },
                }),
              )
            }
          >
            Take the date off
          </button>
        </div>
      ) : null}
      {bookWith ? (
        <div className="rounded-xl bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">
            Books a results and strategy review on the client check-in calendar
            in GoHighLevel, at a time that is free. The invite never mentions a
            renewal.
          </p>
          <div className="mt-2">
            {bookWith(row, async when => {
              await onEdit({
                kind: "plan",
                taskId: row.taskId,
                patch: { callBookedFor: when },
              });
            })}
          </div>
        </div>
      ) : onBook ? (
        <div className="rounded-xl bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">
            Books a results and strategy review on the client check-in calendar
            in GoHighLevel. The invite never mentions a renewal.
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div className="grid gap-1">
              <label
                htmlFor={`${id}-day`}
                className="text-xs text-muted-foreground"
              >
                Day
              </label>
              <Input
                id={`${id}-day`}
                type="date"
                min={today}
                value={day}
                onChange={e => setDay(e.target.value)}
                className="h-9 w-40"
              />
            </div>
            <div className="grid gap-1">
              <label
                htmlFor={`${id}-time`}
                className="text-xs text-muted-foreground"
              >
                Time, Kuwait
              </label>
              <select
                id={`${id}-time`}
                value={time}
                onChange={e => setTime(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
              >
                {SLOTS.map(s => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => void book()}
              disabled={r.busy}
            >
              {r.busy ? <Loader2 className="animate-spin" /> : <CalendarPlus />}
              Book call
            </Button>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <label
            htmlFor={`${id}-other`}
            className="text-xs text-muted-foreground"
          >
            Booked another way? Its day
          </label>
          <Input
            id={`${id}-other`}
            type="date"
            value={elsewhere}
            onChange={e => setElsewhere(e.target.value)}
            className="h-9 w-40"
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void setOther()}
          disabled={r.busy}
        >
          Save the day
        </Button>
      </div>
      <ErrorLine text={r.error} />
    </div>
  );
}

function StatusPicker({ row, onEdit }: { row: WindowRow; onEdit: Edit }) {
  const id = useId();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState(row.notThisCycleReason ?? "");
  const r = useRun();
  const set = (status: PlanStatus, why?: string) =>
    r.run(() =>
      onEdit({
        kind: "status",
        taskId: row.taskId,
        status,
        ...(why ? { reason: why } : {}),
      }),
    );
  return (
    <div>
      <PillRow>
        {STATUSES.map(s => {
          const blocked =
            s === "resold" &&
            !row.offerGate.ok &&
            row.status !== "resold" &&
            row.offerGate.why?.startsWith("First win");
          return (
            <Pill
              key={s}
              active={row.status === s}
              disabled={r.busy || Boolean(blocked)}
              title={blocked ? (row.offerGate.why ?? undefined) : undefined}
              onClick={() => {
                if (s === "not_this_cycle" && !row.notThisCycleReason)
                  setAsking(true);
                else void set(s);
              }}
            >
              {STATUS_LABEL[s]}
            </Pill>
          );
        })}
      </PillRow>
      {asking || row.status === "not_this_cycle" ? (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div className="grid min-w-0 flex-1 gap-1">
            <label
              htmlFor={`${id}-reason`}
              className="text-xs text-muted-foreground"
            >
              Why not this cycle
            </label>
            <Input
              id={`${id}-reason`}
              value={reason}
              onChange={e => setReason(e.target.value)}
              onKeyDown={onEnter(() => void set("not_this_cycle", reason))}
              placeholder="Paused until Ramadan ends, contract runs to next year..."
              className="h-9 text-sm"
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={r.busy || !reason.trim()}
            onClick={() =>
              void set("not_this_cycle", reason).then(
                ok => ok && setAsking(false),
              )
            }
          >
            Save reason
          </Button>
        </div>
      ) : null}
      <ErrorLine text={r.error} />
    </div>
  );
}

function OfferFields({ row, onEdit }: { row: WindowRow; onEdit: Edit }) {
  const id = useId();
  const [price, setPrice] = useState(row.offer?.price?.toString() ?? "");
  const [months, setMonths] = useState(
    row.offer?.durationMonths?.toString() ?? "",
  );
  const [what, setWhat] = useState(row.offer?.deliverables ?? "");
  const r = useRun();
  useEffect(() => {
    setPrice(row.offer?.price?.toString() ?? "");
    setMonths(row.offer?.durationMonths?.toString() ?? "");
    setWhat(row.offer?.deliverables ?? "");
  }, [row.offer?.price, row.offer?.durationMonths, row.offer?.deliverables]);
  if (!row.offerGate.ok && !row.offer)
    return (
      <p className="rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground">
        {row.offerGate.why}
      </p>
    );
  const save = () =>
    r.run(() =>
      onEdit({
        kind: "plan",
        taskId: row.taskId,
        patch: {
          offer: {
            price: price.trim() ? Number(price) : null,
            deliverables: what,
            durationMonths: months.trim() ? Number(months) : null,
          },
        },
      }),
    );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <div className="grid gap-1">
          <label
            htmlFor={`${id}-price`}
            className="text-xs text-muted-foreground"
          >
            Price ($)
          </label>
          <Input
            id={`${id}-price`}
            inputMode="decimal"
            value={price}
            onChange={e => setPrice(e.target.value)}
            className="h-9 w-28 tabular-nums"
          />
        </div>
        <div className="grid gap-1">
          <label
            htmlFor={`${id}-months`}
            className="text-xs text-muted-foreground"
          >
            Months
          </label>
          <Input
            id={`${id}-months`}
            inputMode="numeric"
            value={months}
            onChange={e => setMonths(e.target.value)}
            className="h-9 w-20 tabular-nums"
          />
        </div>
      </div>
      <div className="grid gap-1">
        <label htmlFor={`${id}-what`} className="text-xs text-muted-foreground">
          Deliverables
        </label>
        <Textarea
          id={`${id}-what`}
          value={what}
          onChange={e => setWhat(e.target.value)}
          rows={2}
          className="min-h-16 text-sm"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void save()}
          disabled={r.busy}
        >
          Save the offer
        </Button>
        {!row.offerGate.ok ? (
          <span className="text-xs text-muted-foreground">
            {row.offerGate.why}
          </span>
        ) : null}
      </div>
      <ErrorLine text={r.error} />
    </div>
  );
}

/** The whole plan for one client, in a drawer. */
export function PlanDrawer({
  page,
  taskId,
  onClose,
  onEdit,
  onBook,
  bookWith,
}: {
  page: ProjectionsPage;
  taskId: string | null;
  onClose: () => void;
  onEdit: Edit;
  onBook: Book | null;
  /** The app's own booking control; the built-in day and time when absent. */
  bookWith?: BookWith;
}) {
  const row = page.window.rows.find(r => r.taskId === taskId) ?? null;
  const r = useRun();
  const save = (patch: PlanPatch) =>
    row
      ? r.run(() => onEdit({ kind: "plan", taskId: row.taskId, patch }))
      : Promise.resolve(false);
  const chip = row ? rowChip(row) : null;
  return (
    <Sheet open={Boolean(row)} onOpenChange={o => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {row && chip ? (
          <>
            <SheetHeader className="text-left">
              <SheetTitle className="text-lg">{row.clientName}</SheetTitle>
              <SheetDescription>
                Renews {weekdayDay(row.renewalDate)}, {daysLabel(row.days)}
              </SheetDescription>
              <div className="pt-1">
                <StateChip tone={chip.tone}>{chip.text}</StateChip>
              </div>
            </SheetHeader>
            <div className="space-y-5 pb-8">
              <Section title="Where they are">
                <dl className="divide-y rounded-xl bg-muted/40 px-3 text-sm">
                  {row.onboardedOn ? (
                    <Fact
                      label="Onboarded"
                      value={shortDay(row.onboardedOn.day)}
                      source={row.onboardedOn.source}
                    />
                  ) : null}
                  {row.facts.map(f => (
                    <Fact
                      key={f.label}
                      label={f.label}
                      value={f.value}
                      source={f.source}
                    />
                  ))}
                  {!row.facts.length && !row.onboardedOn ? (
                    <div className="py-3 text-muted-foreground">
                      Nothing on file yet for this client.
                    </div>
                  ) : null}
                </dl>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {row.factsSaved
                      ? "As saved when the plan started."
                      : "Read live from the sources."}
                  </span>
                  {row.planId ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void save({ refreshFacts: true })}
                      disabled={r.busy}
                    >
                      <RefreshCw />
                      Read again
                    </Button>
                  ) : null}
                </div>
              </Section>
              <Section title="The proactive call">
                <BookCall
                  row={row}
                  onBook={onBook}
                  onEdit={onEdit}
                  today={page.today}
                  bookWith={bookWith}
                />
              </Section>
              <Section title="Status">
                <StatusPicker row={row} onEdit={onEdit} />
              </Section>
              <Section title="The plan">
                <div className="grid gap-1.5">
                  <span className="text-xs text-muted-foreground">
                    Likelihood
                  </span>
                  <PillRow>
                    {LIKELIHOODS.map(l => (
                      <Pill
                        key={l}
                        active={row.likelihood === l}
                        onClick={() =>
                          void save({
                            likelihood:
                              row.likelihood === l ? "" : (l as Likelihood),
                          })
                        }
                      >
                        {LIKELIHOOD_LABEL[l]}
                      </Pill>
                    ))}
                  </PillRow>
                </div>
                <TextField
                  label="Angle"
                  value={row.angle}
                  multiline
                  placeholder="What this renewal is about for them"
                  onSave={v => save({ angle: v })}
                />
                <TextField
                  label="The objection we expect"
                  value={row.objection}
                  onSave={v => save({ objection: v })}
                />
                <TextField
                  label="Our answer to it"
                  value={row.objectionAnswer}
                  multiline
                  onSave={v => save({ objectionAnswer: v })}
                />
              </Section>
              <Section title="The offer">
                <OfferFields row={row} onEdit={onEdit} />
              </Section>
              <Section title="Outcome">
                <TextField
                  label="What happened on the call"
                  value={row.outcomeNote}
                  multiline
                  onSave={v => save({ outcomeNote: v })}
                />
                <TextField
                  label="Call recording link"
                  value={row.callRecordingUrl}
                  placeholder="https://"
                  onSave={v => save({ callRecordingUrl: v })}
                />
                {row.callRecordingUrl ? (
                  <a
                    href={row.callRecordingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
                  >
                    Open the recording
                    <ArrowUpRight className="size-3.5" />
                  </a>
                ) : null}
                <GoldSwitch row={row} canGold={page.canGold} onEdit={onEdit} />
              </Section>
              <ErrorLine text={r.error} />
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Fact({
  label,
  value,
  source,
}: {
  label: string;
  value: string;
  source: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
      <dd className="col-span-2 text-xs text-muted-foreground/80">{source}</dd>
    </div>
  );
}

function GoldSwitch({
  row,
  canGold,
  onEdit,
}: {
  row: WindowRow;
  canGold: boolean;
  onEdit: Edit;
}) {
  const id = useId();
  const r = useRun();
  if (!row.planId) return null;
  const planId = row.planId;
  if (!canGold)
    return row.goldStandard ? (
      <StateChip tone="accent">In the gold-standard library</StateChip>
    ) : (
      <p className="text-xs text-muted-foreground">
        The CEO marks a recorded call as gold standard.
      </p>
    );
  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="checkbox"
          checked={row.goldStandard}
          disabled={r.busy || (!row.callRecordingUrl && !row.goldStandard)}
          onChange={e =>
            void r.run(() =>
              onEdit({ kind: "gold", planId, on: e.target.checked }),
            )
          }
          className="size-4 accent-[var(--primary)]"
        />
        <label
          htmlFor={id}
          className="inline-flex items-center gap-1.5 text-sm"
        >
          <Star className="size-4 text-primary" />
          Gold standard call
        </label>
      </div>
      {!row.callRecordingUrl && !row.goldStandard ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Add the recording link first.
        </p>
      ) : null}
      <ErrorLine text={r.error} />
    </div>
  );
}

// --- the library and the last eight weeks ------------------------------------------------------

export function GoldLibrary({ gold }: { gold: ProjectionsPage["gold"] }) {
  return (
    <Card
      title={`Gold standard calls: ${gold.count} / ${gold.target}`}
      sub="Recorded renewal and re-sell calls the team learns from."
    >
      {gold.rows.length ? (
        <ul className="divide-y">
          {gold.rows.map((g: GoldRow) => (
            <li
              key={g.planId}
              className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {g.clientName}
                </div>
                <div className="text-xs text-muted-foreground">
                  {STATUS_LABEL[g.status]}, renewal {shortDay(g.renewalDate)}
                  {g.outcomeNote ? `. ${g.outcomeNote}` : ""}
                </div>
              </div>
              <a
                href={g.callRecordingUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
              >
                Recording
                <ArrowUpRight className="size-3.5" />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl bg-muted/40 p-4 text-sm text-muted-foreground">
          No calls in the library yet. Add the recording to a renewal plan; the
          CEO marks the best ones from there.
        </p>
      )}
    </Card>
  );
}

const CELL_TONE: Record<Verdict, Tone> = VERDICT_TONE;

function HistoryCell({
  row,
  week,
  owner,
  onEdit,
  canEdit,
}: {
  row: StripRow;
  week: ProjectionWeek;
  owner: string;
  onEdit: Edit;
  canEdit: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState(row.missReason ?? "");
  const r = useRun();
  const save = async () => {
    const ok = await r.run(() =>
      onEdit({
        kind: "missReason",
        weekStart: week.weekStart,
        metric: row.metric,
        reason: why,
        forEmail: owner,
      }),
    );
    if (ok) setOpen(false);
  };
  return (
    <td className="px-2 py-2 align-top">
      <div className="flex items-center gap-1.5 whitespace-nowrap tabular-nums">
        <span
          role="img"
          aria-label={VERDICT_LABEL[row.verdict]}
          title={VERDICT_LABEL[row.verdict]}
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            DOT[CELL_TONE[row.verdict]],
          )}
        />
        <span>{metricValue(row.unit, row.actual)}</span>
        <span className="text-xs text-muted-foreground">
          / {metricValue(row.unit, row.blood)}
        </span>
      </div>
      {row.missReason ? (
        <div
          className="mt-0.5 max-w-40 truncate text-xs text-muted-foreground"
          title={row.missReason}
        >
          {row.missReason}
        </div>
      ) : row.verdict === "missed" && canEdit && !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-0.5 whitespace-nowrap text-xs text-primary underline-offset-4 hover:underline"
        >
          Why missed
        </button>
      ) : null}
      {open ? (
        <div className="mt-1 flex items-center gap-1">
          <label htmlFor={id} className="sr-only">
            Why {row.label.toLowerCase()} was missed
          </label>
          <Input
            id={id}
            autoFocus
            value={why}
            onChange={e => setWhy(e.target.value)}
            onKeyDown={onEnter(() => void save())}
            onBlur={() => void save()}
            className="h-8 w-40 text-xs"
          />
        </div>
      ) : null}
      <ErrorLine text={r.error} />
    </td>
  );
}

/** The eight weeks before this one: actual over blood, and why the misses happened. */
export function HistoryTable({
  page,
  onEdit,
  canEdit = true,
}: {
  page: ProjectionsPage;
  onEdit: Edit;
  canEdit?: boolean;
}) {
  const metrics = page.thisWeek.rows.map(r => ({
    metric: r.metric,
    label: r.label,
  }));
  const any = page.history.some(w => w.rows.some(r => r.blood !== null));
  return (
    <Card title="Last 8 weeks" sub="Actual over blood, week by week." flush>
      {any ? (
        <div className="relative overflow-x-auto border-t">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="whitespace-nowrap px-2 py-2 pl-4 font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-muted-foreground sm:pl-6">
                  Week of
                </th>
                {metrics.map(m => (
                  <th
                    key={m.metric}
                    className="whitespace-nowrap px-2 py-2 font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-muted-foreground"
                  >
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {page.history.map(w => (
                <tr key={w.weekStart}>
                  <td className="whitespace-nowrap px-2 py-2 pl-4 align-top tabular-nums text-muted-foreground sm:pl-6">
                    {shortDay(w.weekStart)}
                  </td>
                  {w.rows.map(r => (
                    <HistoryCell
                      key={r.metric}
                      row={r}
                      week={w}
                      owner={page.owner}
                      onEdit={onEdit}
                      canEdit={canEdit}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="h-2" />
        </div>
      ) : (
        <p className="mx-4 mb-4 rounded-xl bg-muted/40 p-4 text-sm text-muted-foreground sm:mx-6 sm:mb-6">
          No past weeks yet. Set this week's blood and stretch above, and next
          Sunday this table starts filling.
        </p>
      )}
    </Card>
  );
}

/** CSM Daily's corner: the hardest renewal to role-play, and the library's count. */
export function DailyPanel({ page }: { page: ProjectionsPage }) {
  const h = page.hardest;
  return (
    <Card
      title="From the renewal window"
      sub="Tuesday's role play takes the hardest row; Thursday reviews against the library."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-muted/40 p-4">
          <div className="text-xs text-muted-foreground">
            Hardest renewal this week
          </div>
          {h ? (
            <>
              <div className="mt-1 font-medium">{h.clientName}</div>
              <div className="text-sm text-muted-foreground">
                Renews {shortDay(h.renewalDate)}, {daysLabel(h.days)}.{" "}
                {h.likelihood
                  ? LIKELIHOOD_LABEL[h.likelihood]
                  : "Likelihood not set"}
                .
              </div>
              {h.objection ? (
                <div className="mt-1 text-sm">Objection: {h.objection}</div>
              ) : null}
            </>
          ) : (
            <div className="mt-1 text-sm text-muted-foreground">
              {page.window.tracked
                ? "Nobody renews in the next 60 days."
                : "Renewal dates are not on the client cards yet."}
            </div>
          )}
        </div>
        <div className="rounded-xl bg-muted/40 p-4">
          <div className="text-xs text-muted-foreground">
            Gold standard calls
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {page.gold.count} / {page.gold.target}
          </div>
        </div>
      </div>
    </Card>
  );
}
