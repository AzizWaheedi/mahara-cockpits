import { PhoneOff } from "lucide-react";
import { Link } from "react-router";
import { type CallGaps, minutesWords, type SpeedToLead } from "../lib/calls";
import { count, duration, share } from "../lib/format";
import type { DialStats } from "../lib/pay";
import { EmptyState, Failed, SectionCard, StatTile } from "./kit";

/** The most calls one read returns (useDials); more than this and the counts stop short. */
export const DIALS_CAP = 5000;

/**
 * Maqsam's calls for the window: what the rep dialled, what connected, how
 * long they talked, and what came in. Read by the seat's Maqsam email, the
 * address B2B keeps each agent's calls under.
 */
export function NumbersDials({
  speed,
  gaps,
  stats,
  rows,
  loading,
  error,
  reload,
  hasMaqsam,
  team,
  self,
}: {
  speed: SpeedToLead | null;
  gaps: CallGaps | null;
  stats: DialStats | null;
  /** How many calls the read returned, to tell a full read from a cut one. */
  rows: number;
  loading: boolean;
  error: string | null;
  reload: () => void;
  hasMaqsam: boolean;
  team: boolean;
  self: boolean;
}) {
  const side = <span className="muted text-xs">Maqsam</span>;
  if (!team && !hasMaqsam)
    return (
      <SectionCard title="Dials" side={side}>
        <EmptyState
          compact
          icon={PhoneOff}
          title="No Maqsam email on this seat yet."
          text={
            self ? (
              "Aziz adds it on the Team page. Your dials show here from then on."
            ) : (
              <>
                Add it on the{" "}
                <Link to="/team" className="underline underline-offset-2">
                  Team page
                </Link>{" "}
                and the dials show here.
              </>
            )
          }
        />
      </SectionCard>
    );

  return (
    <SectionCard title="Dials" side={side}>
      <div className="@container">
        {error ? (
          <Failed what="The Maqsam calls" error={error} retry={reload} />
        ) : !stats ? (
          <p className="muted text-sm">
            {loading ? "Loading…" : "No calls read yet."}
          </p>
        ) : (
          <>
            {rows >= DIALS_CAP ? (
              <p className="callout-warn mb-4 rounded-[var(--radius-md)] border px-3 py-2 text-sm">
                More than {count(DIALS_CAP)} calls in this window, so these
                counts stop short. Choose a shorter window for the full count.
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-4 @xl:grid-cols-4">
              <StatTile
                variant="plain"
                label="Outbound dials"
                value={count(stats.outbound)}
              />
              <StatTile
                variant="plain"
                label="Connected"
                value={count(stats.connected)}
                sub={
                  stats.outbound
                    ? `${share(stats.connected, stats.outbound)} of dials`
                    : "No dials yet"
                }
                hint="Outbound calls Maqsam marks completed."
              />
              <StatTile
                variant="plain"
                label="Talk time"
                value={duration(stats.talkSeconds)}
                hint="The length of the connected outbound calls."
              />
              <StatTile
                variant="plain"
                label="Inbound calls"
                value={count(stats.inbound)}
              />
            </div>
          </>
        )}
        <div className="mt-4 grid grid-cols-1 gap-4 @md:grid-cols-2">
          <StatTile
            variant="plain"
            label="Speed to lead"
            value={speed ? (minutesWords(speed.medianMin) ?? "n/a") : null}
            sub={
              speed
                ? [
                    speed.medianWorkingMin !== null
                      ? `${minutesWords(speed.medianWorkingMin)} in working hours`
                      : null,
                    team
                      ? `${speed.called} of ${speed.leads} leads called · ${speed.never} never called`
                      : `${speed.called} leads you called first`,
                    `${speed.within5} within 5 min`,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : undefined
            }
            hint="The CEO cockpit's rule: from a lead coming in (the ROAS-tagged leads of this window) to the first Maqsam call with them by a sales rep, either direction, matched on the phone. Median on the clock and in working hours (10:00 to 18:00, Saturday to Thursday). The leads never called are counted beside it, not inside it. For one rep, the leads whose first call was theirs."
          />
          <StatTile
            variant="plain"
            label="Gap between calls"
            value={gaps ? (minutesWords(gaps.averageMin) ?? "n/a") : null}
            sub={
              gaps
                ? gaps.samples
                  ? `Average of ${gaps.samples} gaps · median ${minutesWords(gaps.medianMin)}`
                  : "Not enough back-to-back calls in working hours"
                : undefined
            }
            hint="The CEO cockpit's rule: from the end of one outbound call (ringing and talk) to the start of the next, never below zero, inside working hours (10:00 to 18:00, Saturday to Thursday, until a rep has a schedule); any other call in between breaks the chain."
          />
        </div>
      </div>
    </SectionCard>
  );
}
