import { Check, ChevronDown, Pencil } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { heldCall } from "../lib/afterCall";
import { api } from "../lib/api";
import { type DayReview, reviewed } from "../lib/dayReview";
import { clock, statusLabel } from "../lib/format";
import { toast } from "../lib/toast";
import type { CalendarRow } from "../lib/types";
import { AfterCall } from "./AfterCall";
import {
  AnimatedSelect,
  button,
  buttonPrimary,
  field,
  SectionCard,
  select,
} from "./kit";

export function DayCallReview({
  review,
  onChanged,
  onBusy,
}: {
  review: DayReview;
  onChanged: () => Promise<void>;
  onBusy: (busy: boolean) => void;
}) {
  const [all, setAll] = useState(false);
  const pending = review.calls.filter(r => !reviewed(r));
  const done = review.calls.filter(reviewed);
  return (
    <SectionCard title="Check your calls">
      <p className="muted mb-4 text-sm">
        {!review.linked
          ? "Your HighLevel user needs to be linked on the Team page before we can check your calls."
          : pending.length
            ? `${pending.length} ${pending.length === 1 ? "call needs" : "calls need"} an outcome, or the lead rated and why no demo. Your totals update as you save.`
            : "Every call has an outcome. Your totals are ready to check."}
      </p>
      <div className="divide-y divide-white/10">
        {pending.map(row => (
          <ReviewRow
            key={row.appointment_id}
            row={row}
            open
            onChanged={onChanged}
            onBusy={onBusy}
          />
        ))}
        {all
          ? done.map(row => (
              <ReviewRow
                key={row.appointment_id}
                row={row}
                onChanged={onChanged}
                onBusy={onBusy}
              />
            ))
          : null}
      </div>
      {done.length ? (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className={`${button} mt-3`}
          aria-expanded={all}
        >
          <Check className="size-4" />
          {done.length} already marked
          <ChevronDown className={`size-4 ${all ? "rotate-180" : ""}`} />
        </button>
      ) : null}
      {!review.calls.length && review.linked ? (
        <p className="muted text-sm">
          No assigned calls have started on this day.
        </p>
      ) : null}
    </SectionCard>
  );
}
function ReviewRow({
  row,
  open = false,
  onChanged,
  onBusy,
}: {
  row: CalendarRow;
  open?: boolean;
  onChanged: () => Promise<void>;
  onBusy: (busy: boolean) => void;
}) {
  const current = String(row.marked_status ?? row.status ?? "");
  // Marked already: only the after-call answers may be missing, and they
  // sit under the row; the outcome stays behind its button.
  const marked = [
    "showed",
    "completed",
    "noshow",
    "cancelled",
    "invalid",
  ].includes(current);
  const [editing, setEditing] = useState(open && !marked);
  const [status, setStatus] = useState(
    ["showed", "noshow", "cancelled", "invalid"].includes(current)
      ? current
      : current === "completed"
        ? "showed"
        : "",
  );
  const [note, setNote] = useState(row.mark_note ?? "");
  const [reason, setReason] = useState(row.mark_reason ?? "");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!status) return;
    setBusy(true);
    onBusy(true);
    try {
      const out = await api<{ mark: { crm: string } }>("mark", {
        appointment_id: row.appointment_id,
        status,
        note,
        reason,
        source: "eod",
      });
      toast.success(
        out.mark.crm === "failed"
          ? "Saved here. HighLevel still needs to sync."
          : "Outcome saved. Totals updated.",
      );
      await onChanged();
      setEditing(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <div className="py-4 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Link
            to={`/lead/${row.contact_id}`}
            className="font-medium hover:underline"
          >
            <bdi>{row.contact_name ?? "Unnamed lead"}</bdi>
          </Link>
          <p className="muted mt-0.5 text-xs">
            {row.call_type === "demo"
              ? "Demo"
              : row.call_type === "intro"
                ? "Intro"
                : "Follow-up"}{" "}
            · {clock(row.start_at)}
          </p>
        </div>
        {marked ? (
          <button
            type="button"
            onClick={() => setEditing(!editing)}
            className={button}
          >
            <Pencil className="size-3.5" />
            {statusLabel(current)}
          </button>
        ) : (
          <span className="muted text-xs">Needs your review</span>
        )}
      </div>
      {heldCall(row) && !editing ? (
        <div className="mt-3">
          <AfterCall row={row} canEdit onSaved={() => void onChanged()} />
        </div>
      ) : null}
      {editing ? (
        <div className="mt-3 space-y-3 rounded-2xl bg-muted/30 p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <AnimatedSelect
              aria-label={`Outcome for ${row.contact_name ?? "call"}`}
              className={`${select} flex-1 min-w-40`}
              value={status}
              onChange={e => setStatus(e.target.value)}
            >
              <option value="">Choose outcome</option>
              <option value="showed">Showed</option>
              <option value="noshow">No-show</option>
              <option value="cancelled">Cancelled</option>
              <option value="invalid">Disqualified</option>
            </AnimatedSelect>
            <button
              type="button"
              className={buttonPrimary}
              disabled={
                busy || !status || (status === "invalid" && !reason.trim())
              }
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save outcome"}
            </button>
          </div>
          {status === "invalid" ? (
            <input
              aria-label="Reason for disqualification"
              className={field}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Why was this not a fit?"
              maxLength={300}
            />
          ) : null}
          <input
            aria-label={`Feedback for ${row.contact_name ?? "call"}`}
            className={field}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Quick feedback or next step (optional)"
            maxLength={4000}
          />
          <p className="muted text-xs">
            Saves the outcome and updates HighLevel quietly.
          </p>
        </div>
      ) : null}
    </div>
  );
}
