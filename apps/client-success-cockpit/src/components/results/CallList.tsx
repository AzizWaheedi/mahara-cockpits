import { Check, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { calledText, dayText, plural, queuedText } from "@/lib/resultsModel";
import {
  type CallRow,
  fetchCallList,
  logCall,
  readProblem,
  useRead,
} from "@/lib/resultsReads";
import {
  Notice,
  Problem,
  ResultCard,
  RowsSkeleton,
  SourceNote,
  WarnLine,
} from "./ResultsKit";

/**
 * The CSM call list (Muhammed, 2026-10-21): at most five clients a week, each with the meetings still
 * blank in its sheet after two Thursday reminders, the clients with the most missing first. "Called"
 * records who called and when (cockpit_csm_call_logged, one row a client a week, an audit row for each).
 * The clients past the five show as queued for next week. Pressing Called changes no number and sends
 * nothing: the sheet's blanks stay until the client fills them in.
 */
export function CallList({ className }: { className?: string }) {
  const read = useRead("csm-calls", fetchCallList);
  const [busy, setBusy] = useState<string | null>(null);
  const data =
    read.status === "ready"
      ? read.data
      : read.status === "error"
        ? read.data
        : undefined;
  const calls = (data?.rows ?? []).filter(r => r.status === "call");
  const called = calls.filter(r => r.calledAt).length;
  const queued = queuedText(data?.rows ?? []);

  async function press(row: CallRow) {
    setBusy(row.locationId);
    try {
      const out = await logCall(row.locationId);
      toast.success(
        out.alreadyLogged
          ? `${out.clientName} was already logged as called this week.`
          : `Logged: ${out.clientName} called.`,
      );
      read.reload();
    } catch (e) {
      toast.error(readProblem(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ResultCard
      id="csm-call-list"
      kicker={data ? `Week ${data.week.split("-W")[1]}` : "This week"}
      title="Call these clients this week"
      className={className}
      aside={
        data && calls.length > 0 ? (
          <p className="text-xs text-muted-foreground tabular-nums">
            {called} of {calls.length} called
            <span className="ml-1">· up to {data.cap} a week</span>
          </p>
        ) : undefined
      }
    >
      {read.status === "loading" ? <RowsSkeleton rows={3} /> : null}
      {read.status === "error" ? (
        <Problem message={read.message} onRetry={read.reload} />
      ) : null}
      {data && calls.length === 0 ? (
        <Notice
          title="No client to call this week"
          text="No client has a meeting still blank in its sheet after two Thursday reminders."
        />
      ) : null}
      {calls.length > 0 ? (
        <ul className="divide-y">
          {calls.map(r => (
            <CallLine
              key={r.locationId}
              row={r}
              saving={busy === r.locationId}
              disabled={busy !== null}
              onCalled={() => press(r)}
            />
          ))}
        </ul>
      ) : null}
      {queued ? (
        <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">
          Queued for next week: {queued}
        </p>
      ) : null}
      {data?.notes.map(n => (
        <WarnLine key={n}>{n}</WarnLine>
      ))}
      {data ? (
        <SourceNote>
          A meeting counts when it ended in the last 60 days, its Show cell (or
          Closed cell, after a Show of Y) is still blank in the client's sheet,
          and two Thursday 10:00 reminders have gone by since it ended. A client
          with a call logged this week stays on the list until its sheet is
          filled in.
        </SourceNote>
      ) : null}
    </ResultCard>
  );
}

function CallLine({
  row: r,
  saving,
  disabled,
  onCalled,
}: {
  row: CallRow;
  saving: boolean;
  disabled: boolean;
  onCalled: () => void;
}) {
  const who = calledText(r);
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <Link
            to={`/clients/${encodeURIComponent(r.clientName)}?tab=results`}
            className="inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
          >
            {r.clientName}
            <ChevronRight
              aria-hidden
              className="size-3.5 text-muted-foreground"
            />
          </Link>
          <p className="text-xs text-muted-foreground">
            {plural(r.missing, "meeting")} still blank after 2 Thursday
            reminders
            {r.oldestMeeting ? `, the oldest ${dayText(r.oldestMeeting)}` : ""}
          </p>
        </div>
        {who ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Check aria-hidden className="size-4 text-success" />
            Called by {who}
          </span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={onCalled}
            aria-label={`Log that you called ${r.clientName}`}
          >
            {saving ? "Saving" : "Called"}
          </Button>
        )}
      </div>
      {r.meetings.length > 0 ? (
        <details className="mt-1.5 text-xs">
          <summary className="cursor-pointer select-none text-muted-foreground">
            See the meetings
          </summary>
          <ul className="mt-2 space-y-1 pl-5 text-muted-foreground">
            {r.meetings.map(m => (
              <li key={`${m.day}-${m.name}-${m.cell}`}>
                {m.name}, {dayText(m.day)}: the {m.cell} cell is blank
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}
