import { useState } from "react";
import { useWho } from "../lib/auth";
import { askFor } from "../lib/data";
import type { Job } from "../lib/types";
import { Button } from "./ui/button";

/**
 * Move the card on the board without leaving the desk.
 *
 * Aziz, 2026-09-19: pressing started should put it in In progress, and a
 * round of comments should put it in Update required.
 *
 * Finishing and cancelling are not here on purpose. Those are somebody
 * else's decision on the board, and a button that could close a client's
 * video by mistake is not worth the two seconds it saves. The worker refuses
 * them as well, so the rule holds even if this screen is wrong.
 *
 * It sits in the job's header, under which the card's status is already
 * written, so it does not say the status again.
 */
const MOVES: { to: string; label: string; hint: string }[] = [
  {
    to: "in progress",
    label: "I've started",
    hint: "Moves the card to In progress",
  },
  {
    to: "update required",
    label: "Needs changes",
    hint: "Moves the card to Update required",
  },
];

export default function MoveCard({
  job,
  onMoved,
}: {
  job: Job;
  onMoved: () => void;
}) {
  const { email, name } = useWho();
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const now = (job.status ?? "").trim().toLowerCase();

  async function move(to: string) {
    setBusy(to);
    setSaid(null);
    const err = await askFor(
      "status",
      job.task_id,
      "",
      { email, name },
      { to },
    );
    setBusy(null);
    if (err) setSaid(`That could not be queued: ${err}`);
    else {
      setSaid("Queued. The card moves within a few minutes.");
      onMoved();
    }
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        {MOVES.map(m => {
          const here = now === m.to;
          return (
            <Button
              key={m.to}
              variant="outline"
              size="sm"
              disabled={here || busy !== null}
              title={here ? "The card is already there" : m.hint}
              onClick={() => move(m.to)}
            >
              {busy === m.to ? "Moving" : m.label}
            </Button>
          );
        })}
      </div>
      {said ? (
        <p role="status" className="text-xs text-muted-foreground">
          {said}
        </p>
      ) : null}
    </div>
  );
}
