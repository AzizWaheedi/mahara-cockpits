import { CircleAlert } from "lucide-react";
import { useWorkerStatus } from "../lib/data";
import { ago } from "../lib/format";

/**
 * When the sales desk last did a job, in one line on the page that depends
 * on it: late or failing says so, instead of the page quietly showing
 * nothing new (Aziz's rule: missing is never zero). The same limits alert
 * Aziz through the portal's sales watch.
 */
export function DeskStatus({
  jobs,
}: {
  /** job: the desk's job name; what: what it does, as a person says it; staleMin: when it counts as late. */
  jobs: { job: string; what: string; staleMin: number }[];
}) {
  const status = useWorkerStatus();
  if (status.error)
    return (
      <p className="muted text-xs">
        Whether the sales desk is running could not be read: {status.error}.
      </p>
    );
  if (!status.data) return null;
  return (
    <div className="space-y-1">
      {jobs.map(j => {
        const r = status.data?.find(
          x => x.worker === "sales-desk" && x.job === j.job,
        );
        const late = !r || Date.now() - Date.parse(r.at) > j.staleMin * 60_000;
        const bad = late || !r?.ok;
        return (
          <p
            key={j.job}
            className={`flex items-start gap-1.5 text-xs ${bad ? "" : "muted"}`}
          >
            {bad ? (
              <CircleAlert
                className="mt-px size-3.5 shrink-0"
                style={{ color: "var(--warning)" }}
                aria-hidden
              />
            ) : null}
            <span>
              {!r
                ? `${j.what} has not run yet. Aziz is alerted if it stays that way.`
                : late
                  ? `${j.what} last ran ${ago(r.at)}, later than it should. The sales desk may be down; Aziz is alerted if it stays that way.`
                  : !r.ok
                    ? `${j.what} failed ${ago(r.at)}: ${r.detail ?? "no reason given"}.`
                    : `${j.what} last ran ${ago(r.at)}: ${r.detail ?? "done"}.`}
            </span>
          </p>
        );
      })}
    </div>
  );
}
