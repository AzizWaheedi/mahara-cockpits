import { PhoneOff } from "lucide-react";
import { Link } from "react-router";
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
  stats,
  rows,
  loading,
  error,
  reload,
  hasMaqsam,
  team,
  self,
}: {
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
      {error ? (
        <Failed what="The Maqsam calls" error={error} retry={reload} />
      ) : !stats ? (
        <p className="muted text-sm">
          {loading ? "Loading…" : "No calls read yet."}
        </p>
      ) : (
        <>
          {rows >= DIALS_CAP ? (
            <p className="callout-warn mb-3 rounded-[var(--radius-md)] border px-3 py-2 text-sm">
              More than {count(DIALS_CAP)} calls in this window, so these counts
              stop short. Choose a shorter window for the full count.
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Outbound dials" value={count(stats.outbound)} />
            <StatTile
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
              label="Talk time"
              value={duration(stats.talkSeconds)}
              hint="The length of the connected outbound calls."
            />
            <StatTile label="Inbound calls" value={count(stats.inbound)} />
          </div>
        </>
      )}
      <p className="muted mt-3 text-xs">
        The gap between calls and speed to lead come with the dialer.
      </p>
    </SectionCard>
  );
}
