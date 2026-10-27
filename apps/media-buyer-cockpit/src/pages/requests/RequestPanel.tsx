import { ArrowUpRight, CircleAlert, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { StatusChip, StatusDot } from "@/components/ceo/StatusChip";
import { TaskPanel } from "@/components/tasks/TaskPanel";
import { Button } from "@/components/ui/button";
import { cancelRequest, errorWords, readRequest } from "@/lib/requestsClient";
import {
  CLICKUP_FORM_URL,
  dayLabel,
  deliveredNote,
  isOpen,
  ownerNote,
  PRIORITIES,
  type Priority,
  partChip,
  partHeld,
  partialNext,
  partWords,
  REQUEST_SENTENCES,
  type RequestDetail,
  type RequestRow,
  requestHeld,
  stampWords,
  stateChip,
  stateWords,
  verifyWords,
} from "@/lib/requestsCore";
import { useTaskSeat } from "@/lib/taskSeat";

/**
 * What "Make it a request" hands the form (2.10, 6.4), or "File it again"
 * for a request where nothing reached ClickUp (its answers as words in
 * `answers`; a request that routed an old form ticket routes it again while
 * the ticket still waits, else goes on its own).
 */
export type RouteFrom = {
  typeKey: string;
  client: { taskId: string; name: string } | null;
  details: string | null;
  replacesTaskId: string;
  answers?: Record<string, string>;
  /**
   * Its own priority and due day: what the person picked for a request filed
   * again, or the old form ticket's. The form starts on them in place of the
   * type's defaults (a due day already past gives the default).
   */
  priority?: Priority;
  dueOn?: string | null;
  /** The request being filed again. */
  againOf?: string;
  /**
   * The seat may cancel the request being filed again: once the new one is
   * sent, the first one is cancelled, so the queue holds the request once.
   */
  againCanCancel?: boolean;
};

/** The start of the writer's sentence for a routing request whose old ticket was handled in ClickUp. */
const OLD_HANDLED = "The old ticket was already moved or closed in ClickUp";

/**
 * The next step a request needs: "again" when nothing reached ClickUp (it
 * can be filed again whole), "partial" when part of it did (filing it again
 * would make the tasks that landed twice, so only the missing task is
 * raised, another way), "old" when a routing request made nothing because
 * the team moved or closed its old form ticket in ClickUp while it waited
 * (the work may be done: check the ticket, never file it again here), else
 * none. A partial request keeps its next step even once its delivered tasks
 * are done: the missing task never went.
 */
export function nextStep(
  row: Pick<RequestRow, "state" | "done"> & {
    replacesTaskId?: string | null;
    parts?: Pick<RequestRow["parts"][number], "error">[];
  },
): "again" | "partial" | "old" | null {
  if (row.state === "partial") return "partial";
  if (row.state === "failed" && !row.done)
    return row.replacesTaskId &&
      (row.parts ?? []).some(p => (p.error ?? "").startsWith(OLD_HANDLED))
      ? "old"
      : "again";
  return null;
}

/**
 * Whether a failed request's task was deleted in ClickUp: the writer keeps the
 * task's link on the only failed part that reached ClickUp (review round 3),
 * so the next step never says nothing reached it.
 */
export const taskDeleted = (
  row: Pick<RequestRow, "state"> & {
    parts?: Pick<RequestRow["parts"][number], "state" | "url">[];
  },
) =>
  row.state === "failed" &&
  (row.parts ?? []).some(p => p.state === "failed" && Boolean(p.url));

/** The cancel reason of a request filed again (contract 2.5, cancel). */
export const AGAIN_REASON = "Filed again as a new request.";

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
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  // "Cancel request" swaps the footer button for the reason box; focus goes
  // to the box, so it never falls out of the dialog onto the page.
  useEffect(() => {
    if (cancelling) reasonRef.current?.focus();
  }, [cancelling]);

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
  // Saved, not sent: every task says so, not "Sending to ClickUp".
  const held = detail ? requestHeld(detail) : false;
  // The state line beside the chip, only where it says more than the chip
  // (factsLine); each task then says only what its chip and this do not.
  const factsWords = detail ? factsLine(detail) : "";
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
                // The old ticket's own priority and due day (2.10).
                priority: detail.priority,
                dueOn: detail.dueOn,
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
        // The panel is a portal outside the page, so it carries its own
        // ceo-root for the status colours.
        <div className="ceo-root space-y-6 text-sm">
          <Facts detail={detail} />
          {nextStep(detail) ? (
            <NextStep
              detail={detail}
              onAgain={
                // Only when nothing reached ClickUp: a partial request filed
                // again would make its delivered tasks twice.
                onRoute && nextStep(detail) === "again"
                  ? () =>
                      onRoute({
                        typeKey: detail.typeKey,
                        client: detail.clientTaskId
                          ? {
                              taskId: detail.clientTaskId,
                              name: detail.clientName ?? "",
                            }
                          : null,
                        details: detail.details,
                        // A routing request routes its old ticket again
                        // (the server put it back in its queue when this
                        // one failed); the form goes on without it if it
                        // was routed meanwhile.
                        replacesTaskId: detail.replacesTaskId ?? "",
                        answers: Object.fromEntries(
                          detail.answers.map(a => [a.key, a.display]),
                        ),
                        // "The same answers": the priority and due day the
                        // person picked too, not the type's defaults.
                        priority: detail.priority,
                        dueOn: detail.dueOn,
                        againOf: detail.id,
                        againCanCancel: detail.canCancel,
                      })
                  : undefined
              }
            />
          ) : null}

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
                const chip = partChip(p, held);
                // One task: the request's chip above is its chip. Each task
                // says only what its chip and the lines above do not.
                const one = detail.parts.length === 1;
                const words = taskWords(p, detail, factsWords);
                const note = ownerNote(p.owner);
                const check = verifyWords(p);
                const unfinished = deliveredNote(p);
                return (
                  <li key={p.part} className="space-y-1.5 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{p.listName}</span>
                      {one ? null : (
                        <StatusChip tone={chip.tone} label={chip.label} />
                      )}
                    </div>
                    <p dir="auto" className="break-words text-[13px]">
                      <bdi>{p.taskName}</bdi>
                    </p>
                    <p className="text-[13px] text-muted-foreground">
                      {words ? `${words}. ` : null}Owner:{" "}
                      {p.owner.how === "none" || !p.owner.label
                        ? "nobody yet"
                        : p.owner.label}
                      .
                    </p>
                    {unfinished ? (
                      // In ClickUp, but a step was refused: a quiet warning
                      // with what to check, never a failure.
                      <p className="flex items-baseline gap-1.5 text-[13px] text-muted-foreground">
                        <StatusDot tone="warning" label="Not finished" />
                        <span className="min-w-0">{unfinished}</span>
                      </p>
                    ) : null}
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
                        className="inline-flex items-center gap-1 rounded-sm text-[13px] font-medium text-[color:var(--tk-ink,var(--primary))] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                ref={reasonRef}
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
 * The state line beside the request's chip, only when it says more than the
 * chip (DESIGN.md, say a thing once): a held request's "when requests open",
 * an old form ticket's way to route it. Nothing for a failed or partial
 * request, whose next step is said once above the tasks and whose reason is
 * on the task that did not reach ClickUp; nothing for one in ClickUp, on its
 * way, routed, cancelled or done, which the chip names (a ClickUp status
 * included: with two tasks, each task's own chip names its status).
 */
export function factsLine(detail: RequestDetail): string {
  if (nextStep(detail)) return "";
  const held = requestHeld(detail);
  if (
    !held &&
    (detail.done ||
      ["delivered", "sending", "routed", "cancelled"].includes(detail.state))
  )
    return "";
  const words = stateWords(detail);
  return words.toLowerCase() === stateChip(detail).label.toLowerCase()
    ? ""
    : words;
}

/**
 * A task's own state words beside its owner, or null when they would repeat
 * what the panel already says: the next step above the tasks (an old ticket
 * handled in ClickUp), the state line, the task's chip (or, with one task,
 * the request's) naming a ClickUp status or "Sending". A refusal's reason,
 * a retry, a check on whether it arrived and a held task's "when requests
 * open" (when the state line does not say it) stay.
 */
export function taskWords(
  part: RequestDetail["parts"][number],
  detail: RequestDetail,
  factsWords: string,
): string | null {
  const held = requestHeld(detail);
  const words = partWords(part, held);
  if (nextStep(detail) === "old" || words === factsWords) return null;
  // Held: the state line above already says when it goes (in the database's
  // words when it sends them), so the task does not say it again.
  if (held && factsWords && words === REQUEST_SENTENCES.heldRequest)
    return null;
  if (part.state === "delivered") return null;
  // On its way, not held: "Sending to ClickUp" beside a "Sending" chip.
  if (["queued", "sending"].includes(part.state) && !partHeld(part, !held))
    return null;
  return words;
}

/**
 * The request's state and its facts. The client and who asked are in the
 * panel's subtitle, so they are not said again here.
 */
function Facts({ detail }: { detail: RequestDetail }) {
  const chip = stateChip(detail);
  const words = factsLine(detail);
  const priority =
    PRIORITIES.find(p => p.key === detail.priority)?.label ?? detail.priority;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip tone={chip.tone} label={chip.label} size="md" />
        {words ? (
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

/**
 * What to do when a request did not reach ClickUp. Nothing reached it: file
 * it again with the same answers, or use the ClickUp request form. Part of
 * it did: name the missing task and raise only that one, with the form or
 * through the systems manager (the cockpit files a whole request, and the
 * tasks that landed must not be made twice). Said once, under the state;
 * the reason is on the task itself.
 */
function NextStep({
  detail,
  onAgain,
}: {
  detail: RequestDetail;
  onAgain?: () => void;
}) {
  const step = nextStep(detail);
  if (step === "old" && detail.replacesTaskId)
    return (
      <section
        className="space-y-3 rounded-xl bg-muted/40 p-4"
        aria-label="What to do next"
      >
        <p className="text-[13px]">{REQUEST_SENTENCES.oldHandledNext}</p>
        <a
          href={`https://app.clickup.com/t/${encodeURIComponent(detail.replacesTaskId)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Open the old ticket in ClickUp
          <ArrowUpRight aria-hidden className="size-3.5" />
        </a>
      </section>
    );
  const some = step === "partial";
  return (
    <section
      className="space-y-3 rounded-xl bg-muted/40 p-4"
      aria-label="What to do next"
    >
      <p className="text-[13px]">
        {some
          ? partialNext(detail)
          : taskDeleted(detail)
            ? REQUEST_SENTENCES.againDeleted
            : REQUEST_SENTENCES.againFailed}
        {some ? null : (
          <>
            {" "}
            <span className="text-muted-foreground">
              If it fails again, tell the systems manager.
            </span>
          </>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {onAgain ? (
          <Button size="sm" onClick={onAgain}>
            File it again
          </Button>
        ) : null}
        <a
          href={CLICKUP_FORM_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Open the ClickUp request form
          <ArrowUpRight aria-hidden className="size-3.5" />
        </a>
      </div>
    </section>
  );
}
