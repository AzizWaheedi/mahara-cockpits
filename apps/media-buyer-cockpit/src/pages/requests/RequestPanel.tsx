import { ArrowUpRight, CircleAlert, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { StatusChip } from "@/components/ceo/StatusChip";
import { TaskPanel } from "@/components/tasks/TaskPanel";
import { Button } from "@/components/ui/button";
import { cancelRequest, errorWords, readRequest } from "@/lib/requestsClient";
import {
  dayLabel,
  isOpen,
  ownerNote,
  PRIORITIES,
  partChip,
  partWords,
  type RequestDetail,
  type RequestRow,
  stampWords,
  stateChip,
  stateWords,
  verifyWords,
} from "@/lib/requestsCore";
import { useTaskSeat } from "@/lib/taskSeat";

/** What "Make it a request" hands the form (2.10, 6.4). */
export type RouteFrom = {
  typeKey: string;
  client: { taskId: string; name: string } | null;
  details: string | null;
  replacesTaskId: string;
};

const CANCEL_LIMIT = 240;

/**
 * The old form ticket's ClickUp task id. RequestRow carries no task id, so
 * it comes from `importedTaskId` when the server sends one, else from the
 * part's ClickUp link (https://app.clickup.com/t/{id}).
 */
export function importTaskId(
  detail: Pick<RequestDetail, "parts"> & { importedTaskId?: string | null },
): string | null {
  if (detail.importedTaskId) return detail.importedTaskId;
  const url = detail.parts[0]?.url ?? "";
  const m = url.match(/\/t\/(?:\d+\/)?([A-Za-z0-9_-]{1,40})(?:[/?#]|$)/);
  return m ? m[1] : null;
}

/**
 * One request in the shared panel (CONTRACT.md 6.4): what was asked, each
 * ClickUp task with its owner and the 2-minute check, and the history.
 * "Cancel request" while nothing has reached ClickUp; "Make it a request"
 * on a ticket that came in through the old ClickUp form.
 */
export function RequestPanel({
  requestId,
  onClose,
  onChanged,
  onRoute,
}: {
  requestId: string | null;
  onClose: () => void;
  /** After a cancel: the row as the server now has it. */
  onChanged?: (row: RequestRow) => void;
  onRoute?: (from: RouteFrom) => void;
}) {
  const seat = useTaskSeat();
  const client = seat.client;
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const reasonId = useId();

  const load = useCallback(async () => {
    if (!client || !requestId) return;
    setError(null);
    try {
      setDetail(await readRequest(client, requestId));
    } catch (e) {
      setError(errorWords(e));
    }
  }, [client, requestId]);

  useEffect(() => {
    setDetail(null);
    setCancelling(false);
    setReason("");
    setCancelError(null);
    if (requestId) void load();
  }, [requestId, load]);

  async function cancel() {
    if (!client || !detail || busy) return;
    const why = reason.trim();
    if (!why) {
      setCancelError("Say why it is cancelled, in a few words.");
      return;
    }
    setBusy(true);
    setCancelError(null);
    try {
      const row = await cancelRequest(client, detail.id, why);
      seat.toast.success("Request cancelled.");
      setCancelling(false);
      onChanged?.(row);
      await load();
    } catch (e) {
      setCancelError(errorWords(e));
    } finally {
      setBusy(false);
    }
  }

  const canRoute =
    detail?.source === "import" &&
    detail.state === "imported" &&
    detail.canRoute;

  const canCancel = Boolean(detail?.canCancel && isOpen(detail));
  // A footer only when it holds an action, so a request with none ends
  // with its history, not an empty bar.
  const footer =
    detail && !cancelling && (canCancel || canRoute) ? (
      <div className="flex w-full flex-wrap items-center justify-end gap-2">
        {canCancel ? (
          <Button variant="outline" onClick={() => setCancelling(true)}>
            Cancel request
          </Button>
        ) : null}
        {canRoute ? (
          <Button
            onClick={() =>
              onRoute?.({
                typeKey: detail.typeKey,
                client: detail.clientTaskId
                  ? {
                      taskId: detail.clientTaskId,
                      name: detail.clientName ?? "",
                    }
                  : null,
                details: detail.details,
                replacesTaskId: importTaskId(detail) ?? "",
              })
            }
          >
            Make it a request
          </Button>
        ) : null}
      </div>
    ) : null;

  return (
    <TaskPanel
      open={Boolean(requestId)}
      onClose={onClose}
      title={detail?.typeLabel ?? "Request"}
      subtitle={
        detail ? (
          <>
            <bdi dir="auto">{detail.clientName ?? "No client"}</bdi> · from{" "}
            {detail.requesterLabel}
          </>
        ) : undefined
      }
      footer={footer}
    >
      {error ? (
        <div className="flex items-start gap-2 text-sm" role="alert">
          <CircleAlert
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-destructive"
          />
          <div className="space-y-2">
            <p>{error}</p>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        </div>
      ) : !detail ? (
        <p
          className="flex items-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
          Reading the request
        </p>
      ) : (
        <div className="space-y-6 text-sm">
          <Facts detail={detail} />

          {detail.answers.length || detail.details ? (
            <section className="space-y-2">
              <h3 className="text-[13px] font-semibold">What was asked</h3>
              {detail.details ? (
                <p
                  dir="auto"
                  className="whitespace-pre-wrap break-words rounded-xl bg-muted/40 p-3 text-[13px] leading-relaxed"
                >
                  {detail.details}
                </p>
              ) : null}
              {detail.answers.length ? (
                <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
                  {detail.answers.map(a => (
                    <div key={a.key} className="contents">
                      <dt className="text-muted-foreground">{a.label}</dt>
                      <dd dir="auto" className="min-w-0 break-words">
                        {a.display}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </section>
          ) : null}

          <section className="space-y-2">
            <h3 className="text-[13px] font-semibold">
              {detail.parts.length === 1
                ? "The ClickUp task"
                : `The ${detail.parts.length} ClickUp tasks`}
            </h3>
            <ul className="divide-y rounded-xl border">
              {detail.parts.map(p => {
                const chip = partChip(p);
                const note = ownerNote(p.owner);
                const check = verifyWords(p);
                return (
                  <li key={p.part} className="space-y-1.5 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{p.listName}</span>
                      <StatusChip tone={chip.tone} label={chip.label} />
                    </div>
                    <p dir="auto" className="break-words text-[13px]">
                      <bdi>{p.taskName}</bdi>
                    </p>
                    <p className="text-[13px] text-muted-foreground">
                      {partWords(p)}. Owner:{" "}
                      {p.owner.how === "none" || !p.owner.label
                        ? "nobody yet"
                        : p.owner.label}
                      .
                    </p>
                    {note ? (
                      <p className="text-[13px] text-muted-foreground">
                        {note}
                      </p>
                    ) : null}
                    {check ? (
                      <p className="text-[13px] text-muted-foreground">
                        {check}
                      </p>
                    ) : null}
                    {p.url ? (
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-sm text-[13px] font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Open in ClickUp
                        <ArrowUpRight aria-hidden className="size-3.5" />
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          {cancelling ? (
            <section className="space-y-2 rounded-xl bg-muted/40 p-4">
              <label htmlFor={reasonId} className="text-[13px] font-semibold">
                Why cancel it?
              </label>
              <textarea
                id={reasonId}
                dir="auto"
                rows={2}
                maxLength={CANCEL_LIMIT}
                value={reason}
                aria-invalid={cancelError ? true : undefined}
                onChange={e => setReason(e.target.value)}
                className="block w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive"
              />
              {cancelError ? (
                <p className="text-[13px] text-destructive" role="alert">
                  {cancelError}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  aria-busy={busy || undefined}
                  onClick={() => void cancel()}
                >
                  {busy ? (
                    <LoaderCircle aria-hidden className="animate-spin" />
                  ) : null}
                  {busy ? "Cancelling" : "Cancel request"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setCancelling(false);
                    setCancelError(null);
                  }}
                >
                  Keep it
                </Button>
              </div>
            </section>
          ) : null}

          {detail.history.length ? (
            <section className="space-y-2">
              <h3 className="text-[13px] font-semibold">History</h3>
              <ol className="space-y-1.5">
                {detail.history.map((h, i) => (
                  <li
                    key={`${h.at}-${i}`}
                    className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 text-[13px]"
                  >
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      {stampWords(h.at)}
                    </span>
                    <span className="min-w-0 break-words">
                      {h.what}
                      {h.byLabel ? (
                        <span className="text-muted-foreground">
                          {" "}
                          by {h.byLabel}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      )}
    </TaskPanel>
  );
}

/**
 * The request's state and its facts. The client and who asked are in the
 * panel's subtitle, so they are not said again here.
 */
function Facts({ detail }: { detail: RequestDetail }) {
  const chip = stateChip(detail);
  const words = stateWords(detail);
  const priority =
    PRIORITIES.find(p => p.key === detail.priority)?.label ?? detail.priority;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip tone={chip.tone} label={chip.label} size="md" />
        {words.toLowerCase() !== chip.label.toLowerCase() ? (
          <span className="text-[13px] text-muted-foreground">{words}</span>
        ) : null}
      </div>
      <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
        <dt className="text-muted-foreground">Asked</dt>
        <dd className="tabular-nums">{stampWords(detail.createdAt)}</dd>
        <dt className="text-muted-foreground">Due</dt>
        <dd className="tabular-nums">
          {detail.dueOn ? dayLabel(detail.dueOn) : "No due day"}
        </dd>
        <dt className="text-muted-foreground">Priority</dt>
        <dd>{priority}</dd>
        <dt className="text-muted-foreground">Team</dt>
        <dd>{detail.teamLabel}</dd>
      </dl>
    </div>
  );
}
