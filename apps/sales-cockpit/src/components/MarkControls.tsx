import { Ban, Check, CircleSlash, RotateCcw, X } from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { statusLabel } from "../lib/format";
import { toast } from "../lib/toast";
import type { CalendarRow, MarkStatus } from "../lib/types";

/**
 * Mark a call: showed, no-show, cancelled or disqualified.
 *
 * A mark on a recent call goes to HighLevel and runs its usual automations
 * (Aziz, 2026-09-24), so a no-show mark sends the lead the no-show message.
 * That is why a tap does not send at once: the row shows the mark with an
 * Undo for five seconds, a strip draining across it, and only then is it
 * sent. Leaving the page inside those seconds sends it, because the rep
 * meant it.
 *
 * Disqualified asks for a reason first, because "why" is what marketing
 * needs from a disqualified call.
 *
 * Once sent, the row keeps saying what it was marked, with no buttons, until
 * the list's next read carries the mark: shown the buttons again in between,
 * a second tap would mark the call twice and write to HighLevel twice.
 */

const UNDO_MS = 5000;

const OPTIONS: {
  status: MarkStatus;
  label: string;
  icon: typeof Check;
  toneStyle: string;
}[] = [
  {
    status: "showed",
    label: "Showed",
    icon: Check,
    toneStyle:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 active:scale-[0.97]",
  },
  {
    status: "noshow",
    label: "No-show",
    icon: X,
    toneStyle:
      "border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 active:scale-[0.97]",
  },
  {
    status: "cancelled",
    label: "Cancelled",
    icon: CircleSlash,
    toneStyle:
      "border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 active:scale-[0.97]",
  },
  {
    status: "invalid",
    label: "Disqualified",
    icon: Ban,
    toneStyle:
      "border-border bg-foreground/[0.04] text-foreground hover:bg-foreground/[0.08] active:scale-[0.97]",
  },
];

const REASONS = [
  "No budget",
  "Not the decision maker",
  "Not a fit for what we do",
  "Not a business",
  "Wrong or fake details",
  "Other",
];

export interface MarkResult {
  /** The mark's own id (the row the calendar then shows as mark_id). */
  id?: number;
  crm: string;
  crm_error: string | null;
  status: string;
}

function said(r: MarkResult): string {
  const what = `Marked ${statusLabel(r.status).toLowerCase()}`;
  if (r.crm === "written") return `${what}. HighLevel is updated.`;
  if (r.crm === "quiet")
    return `${what}. HighLevel is updated without its automations, because the call is more than a week old.`;
  if (r.crm === "skipped")
    return `${what} here. The call is more than a week old, so HighLevel was left as it was.`;
  if (r.crm === "off")
    return `${what} here. Sending marks to HighLevel is switched off.`;
  return what;
}

export function MarkControls({
  row,
  onDone,
  compact = false,
  noShowHeld = false,
  variant = "full",
  disqualify = true,
  onMarked,
}: {
  row: CalendarRow;
  onDone: (r: MarkResult) => void;
  compact?: boolean;
  /**
   * The lead's video room is open: No-show is not offered, because
   * HighLevel's no-show automation writes to a lead who may be opening the
   * link now (m1 round 2; sales-api refuses it too).
   */
  noShowHeld?: boolean;
  /**
   * "row" (2026-10-11): the call row's three buttons, Showed, Didn't happen
   * and a quiet Disqualify. Didn't happen marks a no-show through the same
   * hold, whose strip carries "They cancelled instead" (a correction inside
   * the hold, no extra write), so the common case is one press.
   */
  variant?: "full" | "row";
  /** The row variant offers Disqualify (past the call's window only). */
  disqualify?: boolean;
  /** The mark went to the server: the parent opens the picker to book again. */
  onMarked?: (status: MarkStatus) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState<{
    status: MarkStatus;
    reason: string | null;
  } | null>(null);
  const [sending, setSending] = useState(false);
  // The mark the server took, held until the row as read again carries it.
  const [sent, setSent] = useState<{
    status: MarkStatus;
    reason: string | null;
    id: number | null;
  } | null>(null);
  const timer = useRef<number | null>(null);
  const toSend = useRef<{ status: MarkStatus; reason: string | null } | null>(
    null,
  );
  const done = useRef(onDone);
  done.current = onDone;
  const marked = useRef(onMarked);
  marked.current = onMarked;

  async function send(p: { status: MarkStatus; reason: string | null }) {
    toSend.current = null;
    setSending(true);
    try {
      const out = await api<{ mark: MarkResult }>("mark", {
        appointment_id: row.appointment_id,
        status: p.status,
        reason: p.reason,
      });
      if (out.mark.crm === "failed")
        toast.error(
          `Marked ${statusLabel(p.status).toLowerCase()} here, but HighLevel refused it: ${
            out.mark.crm_error ?? "no reason given"
          }. Use Send again on the call.`,
        );
      else toast.success(said(out.mark));
      // Sent: the row is no longer waiting on an undo. It says what it was
      // marked until the list's reload that follows shows the mark.
      setSent({
        ...p,
        id: typeof out.mark.id === "number" ? out.mark.id : null,
      });
      setPending(null);
      done.current(out.mark);
      marked.current?.(p.status);
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
      setPending(null);
    } finally {
      setSending(false);
    }
  }

  function choose(status: MarkStatus, reason: string | null = null) {
    setAsking(false);
    const p = { status, reason };
    setPending(p);
    toSend.current = p;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (toSend.current) void send(toSend.current);
    }, UNDO_MS);
  }

  function undo() {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    toSend.current = null;
    setPending(null);
  }

  /** Inside Didn't happen's hold: it was a cancellation, not a no-show. The hold starts again. */
  function cancelledInstead() {
    choose("cancelled");
  }

  // Leaving the page inside the undo window still sends the mark.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once on unmount
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
      if (toSend.current) void send(toSend.current);
    },
    [],
  );

  if (pending && variant === "row")
    return (
      <div
        role="status"
        className="relative grid min-w-0 max-w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 overflow-hidden rounded-2xl border border-teal-500/30 bg-teal-500/10 py-1 ps-3.5 pe-1 text-sm shadow-sm sm:flex sm:rounded-full"
      >
        {!sending ? (
          <span
            aria-hidden
            className="drain absolute inset-x-0 bottom-0 h-0.5"
            style={
              {
                background: "var(--now)",
                "--undo-ms": `${UNDO_MS}ms`,
              } as CSSProperties
            }
          />
        ) : null}
        <span className="min-w-0 truncate text-xs font-medium">
          {sending
            ? "Sending…"
            : `Marking ${statusLabel(pending.status).toLowerCase()}`}
        </span>
        {!sending && pending.status === "noshow" ? (
          <button
            type="button"
            onClick={cancelledInstead}
            className="col-start-1 row-start-2 justify-self-start text-xs underline underline-offset-2 sm:ms-1"
          >
            They cancelled instead
          </button>
        ) : null}
        {!sending ? (
          <button
            type="button"
            onClick={undo}
            className="col-start-2 row-span-2 row-start-1 inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-semibold text-teal-300 hover:bg-teal-500/15 sm:ms-auto"
          >
            <RotateCcw className="size-3" aria-hidden />
            Undo
          </button>
        ) : null}
      </div>
    );

  if (pending)
    return (
      <div className="relative flex min-w-0 items-center gap-2 overflow-hidden rounded-full border border-teal-500/30 bg-teal-500/10 px-3 py-1 text-sm shadow-sm">
        {!sending ? (
          <span
            aria-hidden
            className="drain absolute inset-x-0 bottom-0 h-0.5"
            style={
              {
                background: "var(--now)",
                "--undo-ms": `${UNDO_MS}ms`,
              } as CSSProperties
            }
          />
        ) : null}
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {sending
            ? "Sending…"
            : `Marking ${statusLabel(pending.status).toLowerCase()}`}
          {pending.reason ? (
            <span className="muted"> · {pending.reason}</span>
          ) : null}
        </span>
        {!sending ? (
          <button
            type="button"
            onClick={undo}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-teal-300 underline-offset-2 hover:underline"
          >
            <RotateCcw className="size-3" aria-hidden />
            Undo
          </button>
        ) : null}
      </div>
    );

  // The row as read again carries this mark (or a later one) once its
  // mark_id reaches the one the server gave it.
  const landed =
    sent !== null &&
    (sent.id !== null
      ? row.mark_id !== null && Number(row.mark_id) >= sent.id
      : row.marked_status === sent.status);
  if (sent && !landed)
    return (
      <div className="flex min-w-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs">
        <span className="min-w-0 flex-1 truncate">
          Marked {statusLabel(sent.status).toLowerCase()}
          {sent.reason ? <span className="muted"> · {sent.reason}</span> : null}
        </span>
      </div>
    );

  if (asking)
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="muted text-xs font-medium">Why:</span>
        {REASONS.map(r => (
          <button
            key={r}
            type="button"
            onClick={() => choose("invalid", r)}
            className="rounded-full border border-border bg-foreground/[0.05] px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-foreground/[0.1] hover:text-foreground"
          >
            {r}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setAsking(false)}
          className="muted text-xs underline underline-offset-2 hover:text-foreground"
        >
          Back
        </button>
      </div>
    );

  if (variant === "row")
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => choose("showed")}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 text-xs font-medium shadow-sm transition-all pointer-coarse:min-h-10 ${OPTIONS[0].toneStyle} ${compact ? "h-8" : "h-9"}`}
        >
          <Check className="size-3.5" aria-hidden />
          Showed
        </button>
        {noShowHeld ? (
          <span className="muted text-xs">
            Didn't happen waits while their video room is open.
          </span>
        ) : (
          <button
            type="button"
            onClick={() => choose("noshow")}
            title="Marks a no-show (HighLevel's no-show message goes). Inside the five seconds: They cancelled instead, or Undo."
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 text-xs font-medium shadow-sm transition-all pointer-coarse:min-h-10 ${OPTIONS[1].toneStyle} ${compact ? "h-8" : "h-9"}`}
          >
            <X className="size-3.5" aria-hidden />
            Didn't happen
          </button>
        )}
        {disqualify ? (
          <button
            type="button"
            onClick={() => setAsking(true)}
            className="muted px-1 text-xs underline underline-offset-2 hover:text-[color:var(--foreground)] pointer-coarse:min-h-10"
          >
            Disqualify
          </button>
        ) : null}
      </div>
    );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {OPTIONS.filter(o => !(noShowHeld && o.status === "noshow")).map(
        ({ status, label, icon: Icon, toneStyle }) => (
          <button
            key={status}
            type="button"
            onClick={() =>
              status === "invalid" ? setAsking(true) : choose(status)
            }
            className={`inline-flex items-center gap-1.5 rounded-full border font-medium shadow-sm transition-all ${toneStyle} ${
              compact ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-xs"
            }`}
          >
            <Icon className="size-3.5" aria-hidden />
            {label}
          </button>
        ),
      )}
    </div>
  );
}

/** What happened to a mark in HighLevel, in a few words, with a retry when it failed. */
export function CrmLine({
  row,
  onRetried,
}: {
  row: CalendarRow;
  onRetried: () => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!row.marked_status) return null;
  const who = row.marked_by ? row.marked_by.split("@")[0] : "someone";
  let text = "";
  if (row.mark_crm === "written")
    text =
      row.crm_status === row.marked_status
        ? "in HighLevel"
        : "sent to HighLevel, the numbers catch up within 20 minutes";
  else if (row.mark_crm === "quiet")
    text =
      row.crm_status === row.marked_status
        ? "in HighLevel, without its automations"
        : "sent to HighLevel without its automations";
  else if (row.mark_crm === "skipped") text = "kept here, older than a week";
  else if (row.mark_crm === "off") text = "kept here";
  // A send cut off half way (the server stopped between the cockpit's mark
  // and HighLevel's answer) stays "pending": after two minutes it is offered
  // again like a refusal, never left as "sending" for good.
  const markedAt = row.marked_at ? Date.parse(row.marked_at) : Number.NaN;
  const stuck =
    row.mark_crm === "pending" &&
    Number.isFinite(markedAt) &&
    Date.now() - markedAt >= 120_000;
  if (row.mark_crm === "pending" && !stuck) text = "sending to HighLevel";
  return (
    <span className="muted text-xs">
      {statusLabel(row.marked_status)} by {who}
      {text ? ` · ${text}` : ""}
      {row.mark_crm === "failed" || stuck ? (
        <>
          {" · "}
          <span style={{ color: "var(--destructive)" }}>
            {stuck
              ? "HighLevel has not confirmed it"
              : `HighLevel refused it${row.mark_crm_error ? `: ${row.mark_crm_error}` : ""}`}
          </span>{" "}
          <button
            type="button"
            disabled={busy}
            className="underline underline-offset-2"
            onClick={async () => {
              setBusy(true);
              try {
                await api("mark.retry", { appointment_id: row.appointment_id });
                toast.success("Sent to HighLevel.");
                onRetried();
              } catch (e) {
                toast.error(String((e as Error).message ?? e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Send again
          </button>
        </>
      ) : null}
    </span>
  );
}
