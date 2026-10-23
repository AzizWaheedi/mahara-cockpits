import { Clock3, MessageSquare, RefreshCw } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  FEEDBACK_PAGE_SIZE,
  type AppointmentFeedback as Feedback,
  type FeedbackReader,
  type FeedbackScope,
  feedbackDelivery,
  feedbackQuality,
  useAppointmentFeedback,
} from "@/lib/appointmentFeedback";

const attendance: Record<string, string> = {
  showed: "Attended",
  no_show: "No-show",
  unknown: "Attendance not given",
};
const deal: Record<string, string> = {
  won: "Won",
  lost: "Not closed",
  pending: "Still deciding",
};
function date(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Date not recorded";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Riyadh",
  }).format(new Date(value));
}

function Comment({ label, text }: { label: string; text: string | null }) {
  if (!text?.trim()) return null;
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        dir="auto"
        className="whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]"
      >
        {text}
      </p>
    </div>
  );
}

export function AppointmentFeedbackRow({ row }: { row: Feedback }) {
  const quality = feedbackQuality(row);
  const delivery = feedbackDelivery(row.deliveryState);
  const hasWords = [
    row.feedback,
    row.consultationFeedback,
    row.notClosedReason,
  ].some(v => Boolean(v?.trim()));
  return (
    <li className="min-w-0 space-y-4 py-5 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h3
            dir="auto"
            className="break-words text-sm font-semibold [overflow-wrap:anywhere]"
          >
            {row.contactName || "Contact name unavailable"}
          </h3>
          <p className="text-xs text-muted-foreground">
            Appointment · {date(row.startAt)} · Kuwait time
          </p>
          <div className="flex flex-wrap gap-2 pt-1 text-xs text-muted-foreground">
            <span className="rounded-full bg-muted/50 px-2.5 py-1">
              {attendance[row.attendance || ""] || "Attendance not given"}
            </span>
            {deal[row.deal || ""] ? (
              <span className="rounded-full bg-muted/50 px-2.5 py-1">
                {deal[row.deal || ""]}
              </span>
            ) : null}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[11px] text-muted-foreground">Lead quality</p>
          {quality === null ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {row.attendance === "no_show"
                ? "Not scored: no-show"
                : "Not rated"}
            </p>
          ) : (
            <p className="mt-0.5 tabular-nums">
              <span className="text-xl font-semibold">{quality}</span>
              <span className="ml-1 text-xs text-muted-foreground">/ 10</span>
            </p>
          )}
        </div>
      </div>
      {hasWords ? (
        <div className="space-y-4 border-l-2 border-primary/35 pl-4">
          <Comment label="Client comments" text={row.feedback} />
          <Comment
            label="About the consultation"
            text={row.consultationFeedback}
          />
          <Comment label="Why it did not close" text={row.notClosedReason} />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          The client has not added a comment to this appointment.
        </p>
      )}
      {row.adName || row.campaignName ? (
        <p
          dir="auto"
          className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere]"
        >
          {row.adName ? `Ad: ${row.adName}` : `Campaign: ${row.campaignName}`}
        </p>
      ) : null}
      <div className="space-y-1 text-[11px] text-muted-foreground">
        <p>
          {row.source === "portal" ? "Client portal" : "Client feedback"} ·
          Saved {date(row.updatedAt)}
        </p>
        {delivery ? (
          <p className="flex items-start gap-1.5">
            <Clock3 aria-hidden className="mt-0.5 size-3 shrink-0" />
            <span>{delivery}</span>
          </p>
        ) : null}
      </div>
    </li>
  );
}

export function AppointmentFeedback({
  locationId,
  taskId,
  from,
  to,
  reader,
}: Omit<FeedbackScope, "offset"> & { reader?: FeedbackReader }) {
  const identity = JSON.stringify([
    locationId || null,
    taskId || null,
    from || null,
    to || null,
  ]);
  // A keyed body resets pagination and its reads on every client/period change.
  return (
    <FeedbackBody
      key={identity}
      scope={{ locationId, taskId, from, to }}
      reader={reader}
    />
  );
}

function FeedbackBody({
  scope,
  reader,
}: {
  scope: FeedbackScope;
  reader?: FeedbackReader;
}) {
  const titleId = useId();
  const [offset, setOffset] = useState(0);
  const [allTime, setAllTime] = useState(false);
  const selected = {
    ...scope,
    ...(allTime ? { from: null, to: null } : {}),
    offset,
  };
  const read = useAppointmentFeedback(selected, reader);
  const page = read.data;
  const hasPeriod = Boolean(scope.from && scope.to);
  return (
    <section
      aria-labelledby={titleId}
      className="min-w-0 rounded-2xl border bg-card p-4 sm:p-6"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id={titleId}
            className="flex items-center gap-2 text-[15px] font-semibold"
          >
            <MessageSquare aria-hidden className="size-4 text-primary" />
            Client feedback
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            What the client reported for each appointment. Newest feedback
            first.
          </p>
        </div>
        {read.enabled ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={read.refreshing}
            onClick={read.reload}
            aria-label="Refresh client feedback"
          >
            <RefreshCw
              aria-hidden
              className={`size-3.5 ${read.refreshing ? "motion-safe:animate-spin" : ""}`}
            />
            Refresh
          </Button>
        ) : null}
      </header>
      {hasPeriod ? (
        <div
          className="mt-4 flex flex-wrap gap-2"
          role="group"
          aria-label="Feedback dates"
        >
          {[false, true].map(all => (
            <button
              key={String(all)}
              type="button"
              aria-pressed={allTime === all}
              onClick={() => {
                setAllTime(all);
                setOffset(0);
              }}
              className={`rounded-full px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${allTime === all ? "bg-primary/15 ring-1 ring-inset ring-primary/40" : "bg-muted/40 text-muted-foreground"}`}
            >
              {all ? "All feedback" : "Selected period"}
            </button>
          ))}
        </div>
      ) : null}
      {!read.enabled ? (
        <p className="mt-4 text-sm text-muted-foreground">
          This client needs a linked workspace before appointment feedback can
          be shown. Ask the team to check the client connection.
        </p>
      ) : null}
      {read.enabled && read.status === "loading" ? (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          Reading client feedback…
        </p>
      ) : null}
      {read.status === "error" ? (
        <div role="alert" className="mt-4 rounded-xl bg-muted/40 p-3 text-sm">
          <p>{read.message}</p>
          {page ? (
            <p className="mt-1 text-xs text-muted-foreground">
              The feedback below is the last successful read. Newer comments may
              be missing.
            </p>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={read.reload}
            className="mt-2"
          >
            Try again
          </Button>
        </div>
      ) : null}
      {page ? (
        <>
          <div className="mt-4 flex flex-wrap justify-between gap-2 border-b pb-3 text-xs text-muted-foreground">
            <span>
              {page.total} {page.total === 1 ? "appointment" : "appointments"}{" "}
              with client feedback
              {hasPeriod && !allTime ? " in this period" : ""}
            </span>
            <span>
              {read.readAt
                ? `Last checked ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" }).format(read.readAt)} · Kuwait time`
                : "Updates automatically"}
            </span>
          </div>
          {page.items.length === 0 ? (
            <div className="py-6 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">
                {offset ? "No more feedback on this page" : "No feedback yet"}
              </p>
              <p className="mt-1 text-xs leading-5">
                {offset
                  ? "Go to the previous page to see the latest client reports."
                  : hasPeriod && !allTime
                    ? "Try All feedback, or ask the client to report their appointment in the portal."
                    : "When the client rates an appointment or leaves a comment in the portal, it appears here."}
              </p>
            </div>
          ) : (
            <ul className="mt-4 min-w-0 divide-y">
              {page.items.map(row => (
                <AppointmentFeedbackRow
                  key={JSON.stringify([
                    row.appointmentId,
                    row.contactId,
                    row.startAt,
                  ])}
                  row={row}
                />
              ))}
            </ul>
          )}
          {offset > 0 || page.hasMore ? (
            <nav
              aria-label="Client feedback pages"
              className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4"
            >
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={offset === 0 || read.refreshing}
                onClick={() =>
                  setOffset(n => Math.max(0, n - FEEDBACK_PAGE_SIZE))
                }
              >
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {Math.floor(offset / FEEDBACK_PAGE_SIZE) + 1}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!page.hasMore || read.refreshing}
                onClick={() => setOffset(n => n + FEEDBACK_PAGE_SIZE)}
              >
                Next
              </Button>
            </nav>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
