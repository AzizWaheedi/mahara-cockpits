/**
 * A client's levers: the list, and "Add a lever": the metric it moves, the
 * lever in plain words and the team that owns it. A preview shows the
 * ClickUp task first (nothing is written); filing it sends one task to that
 * team's list and a comment to the client's card, read back by the server.
 */
import { ArrowUpRight, Loader2, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { date, isNum } from "@/components/ceo/format";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import {
  DEPARTMENTS,
  type Department,
  departmentLabel,
  fileLever,
  type Lever,
  type LeverArgs,
  type LeverFiled,
  type LeverPreview,
  newRequestId,
  previewLever,
  type Targets,
} from "@/lib/boardClient";
import { targetList } from "@/lib/boardColumns";
import { cn } from "@/lib/utils";
import { BoardDot, Problem } from "./cells";

function metricLabel(metric: string, targets: Targets): string {
  if (metric === "other") return "Other";
  return targets[metric]?.label ?? metric.replace(/_/g, " ");
}

export function LeverList({
  levers,
  targets,
}: {
  levers: Lever[];
  targets: Targets;
}) {
  if (!levers.length)
    return (
      <p className="text-[13px] text-muted-foreground">
        No lever yet for this client.
      </p>
    );
  return (
    <ul className="divide-y divide-[color:var(--ceo-grid)]">
      {levers.map(l => (
        <li
          key={l.id}
          className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3"
        >
          <div className="min-w-0 space-y-0.5">
            <p className="text-[13px] font-medium" dir="auto">
              {l.lever}
            </p>
            <p className="text-xs text-muted-foreground">
              {[
                metricLabel(l.metric, targets),
                departmentLabel(l.department),
                l.createdByName ?? l.createdBy,
                l.createdAt ? date(Date.parse(l.createdAt)) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {l.status === "reconcile" && l.error ? (
              <p className="text-xs text-muted-foreground">{l.error}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <BoardDot
                status={
                  l.status === "open"
                    ? "good"
                    : l.status === "reconcile"
                      ? "watch"
                      : "too_few"
                }
              />
              {l.status === "open"
                ? "Filed"
                : l.status === "reconcile"
                  ? "Check in ClickUp"
                  : "Sending"}
            </span>
            {l.clickupUrl ? (
              <a
                href={l.clickupUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Open the task
                <ArrowUpRight aria-hidden className="size-3.5" />
              </a>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Request ids of levers previewed and not yet confirmed, for this visit. */
const PENDING = new Map<string, string>();

const DEPT_OF_OWNER: Record<string, Department> = {
  media_buyer: "media_buyer",
  creative: "creative",
  call_center: "call_center",
  client_success: "client_success",
  tech: "tech",
};

export function LeverForm({
  locationId,
  clientName,
  targets,
  initialMetric,
  open,
  onOpenChange,
  from,
  to,
  onFiled,
}: {
  locationId: string;
  clientName: string;
  targets: Targets;
  /** The metric the form starts on, e.g. the client's first break. */
  initialMetric: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  from: string;
  to: string;
  onFiled: (result: LeverFiled) => void;
}) {
  const metrics = useMemo(() => targetList(targets), [targets]);
  const start =
    initialMetric && (initialMetric === "other" || targets[initialMetric])
      ? initialMetric
      : (metrics[0]?.metric ?? "other");
  const [metric, setMetric] = useState(start);
  const [lever, setLever] = useState("");
  const [department, setDepartment] = useState<Department>(
    DEPT_OF_OWNER[targets[start]?.owner ?? ""] ?? "media_buyer",
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"preview" | "file" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    key: string;
    data: LeverPreview;
    requestId: string;
  } | null>(null);
  const [filed, setFiled] = useState<LeverFiled | null>(null);

  const args: LeverArgs = {
    locationId,
    metric,
    lever,
    department,
    note,
    from,
    to,
  };
  const key = JSON.stringify([
    metric,
    lever.trim(),
    department,
    note.trim(),
    from,
    to,
  ]);
  const fresh = preview?.key === key;
  const leverOk = lever.trim().length >= 3 && lever.trim().length <= 200;

  if (!open)
    return (
      <Button size="sm" variant="outline" onClick={() => onOpenChange(true)}>
        <Plus aria-hidden />
        Add a lever
      </Button>
    );

  if (filed)
    return (
      <div className="space-y-3 rounded-xl bg-muted/40 p-4" role="status">
        <p className="flex items-center gap-2 text-[13px] font-medium">
          <BoardDot status="good" />
          {filed.replayed ? "Already filed in ClickUp" : "Filed in ClickUp"}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {filed.ticketUrl ? (
            <a
              href={filed.ticketUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-sm text-[13px] font-medium underline-offset-4 hover:underline"
            >
              Open the task
              <ArrowUpRight aria-hidden className="size-3.5" />
            </a>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </div>
    );

  const runPreview = async () => {
    setBusy("preview");
    setError(null);
    try {
      const data = await previewLever(args);
      // One request id per lever (client and words) until ClickUp confirms
      // it: a retry, a second preview or a reopened form sends the same id,
      // so the server replays a task it already filed instead of a second.
      const id = `${locationId}|${key}`;
      const requestId = PENDING.get(id) ?? newRequestId();
      PENDING.set(id, requestId);
      setPreview({ key, data, requestId });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The preview did not load. Try again.",
      );
    } finally {
      setBusy(null);
    }
  };
  const runFile = async () => {
    if (!preview || !fresh) return;
    setBusy("file");
    setError(null);
    try {
      const result = await fileLever(args, preview.requestId);
      PENDING.delete(`${locationId}|${key}`);
      setFiled(result);
      toast.success(
        result.replayed
          ? "The lever was already filed"
          : "Lever filed in ClickUp",
      );
      onFiled(result);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The lever could not be filed. Try again.",
      );
    } finally {
      setBusy(null);
    }
  };

  const due = preview?.data.plan.dueDate;
  const dueDay = isNum(due)
    ? date(due)
    : typeof due === "string" && due
      ? due
      : null;

  return (
    <form
      className="space-y-4 rounded-xl bg-muted/40 p-4"
      aria-label={`Add a lever for ${clientName}`}
      onSubmit={e => {
        e.preventDefault();
        if (fresh) void runFile();
        else if (leverOk) void runPreview();
      }}
    >
      <div className="grid gap-4 @xl:grid-cols-2">
        <div className="block space-y-1.5">
          <span className="block text-xs font-medium text-muted-foreground">
            The metric it moves
          </span>
          <AnimatedSelect
            aria-label="The metric it moves"
            className="ceo-select-md w-full"
            value={metric}
            onChange={e => {
              const m = e.target.value;
              setMetric(m);
              const owner = DEPT_OF_OWNER[targets[m]?.owner ?? ""];
              if (owner) setDepartment(owner);
            }}
          >
            {metrics.map(m => (
              <option key={m.metric} value={m.metric}>
                {m.target.label}
              </option>
            ))}
            <option value="other">Other</option>
          </AnimatedSelect>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            The lever, in plain words
          </span>
          <input
            name="lever"
            aria-label="The lever, in plain words"
            value={lever}
            onChange={e => setLever(e.target.value)}
            maxLength={200}
            placeholder="Test a 15-second hook on the kitchen video"
            className="h-9 w-full rounded-lg border bg-background px-3 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
            dir="auto"
          />
        </label>
      </div>
      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium text-muted-foreground">
          The team that owns it
        </legend>
        <div className="ceo-scroll-x -my-1 flex flex-wrap gap-1 py-1">
          {DEPARTMENTS.map(d => (
            <button
              key={d.key}
              type="button"
              aria-pressed={department === d.key}
              onClick={() => setDepartment(d.key)}
              className={cn(
                "inline-flex h-8 items-center rounded-full px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                department === d.key
                  ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          A note for the team (optional)
        </span>
        <textarea
          name="note"
          value={note}
          onChange={e => setNote(e.target.value)}
          maxLength={1000}
          rows={2}
          className="w-full rounded-lg border bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
          dir="auto"
        />
      </label>

      {preview && fresh ? (
        <section
          className="space-y-1 rounded-lg border bg-background p-3 text-[13px]"
          aria-label="The task to file"
        >
          <p className="font-medium" dir="auto">
            {preview.data.plan.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {departmentLabel(preview.data.plan.department)}'s list
            {dueDay ? ` · due ${dueDay}` : ""}
          </p>
          <p
            className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground"
            dir="auto"
          >
            {preview.data.plan.description}
          </p>
        </section>
      ) : null}

      {error ? <Problem className="text-[13px]">{error}</Problem> : null}

      <div className="flex flex-wrap items-center gap-2">
        {fresh ? (
          <Button type="submit" size="sm" disabled={busy !== null}>
            {busy === "file" ? (
              <Loader2 aria-hidden className="animate-spin" />
            ) : null}
            File the task
          </Button>
        ) : (
          <Button
            type="submit"
            size="sm"
            variant="teal"
            disabled={!leverOk || busy !== null}
          >
            {busy === "preview" ? (
              <Loader2 aria-hidden className="animate-spin" />
            ) : null}
            Preview the task
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        {!leverOk && lever.trim().length > 0 ? (
          <span className="text-xs text-muted-foreground">
            Write the lever in 3 to 200 characters.
          </span>
        ) : null}
      </div>
    </form>
  );
}
