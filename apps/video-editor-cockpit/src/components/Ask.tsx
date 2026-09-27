import { useState } from "react";
import { useWho } from "../lib/auth";
import { askFor } from "../lib/data";
import { moment } from "../lib/format";
import type { AskTopic, Job } from "../lib/types";
import { chip, FIELD } from "./bits";
import { Button } from "./ui/button";

/**
 * The editor is short of something.
 *
 * This sits next to whatever is blocking the job, because the moment a person
 * reads "the footage folder has no video in it yet" is the moment they want
 * to ask for it. It posts to the ClickUp card, where the creative director is
 * already looking, and remembers what was asked so nobody asks twice.
 */

const TOPICS: { key: AskTopic; label: string }[] = [
  { key: "footage", label: "More footage" },
  { key: "brief", label: "A brief" },
  { key: "script", label: "The script" },
  { key: "brand", label: "Brand assets" },
  { key: "music", label: "Music" },
  { key: "access", label: "Folder access" },
  { key: "approval", label: "A decision" },
  { key: "other", label: "Something else" },
];

export default function Ask({ job, onSent }: { job: Job; onSent: () => void }) {
  const { email, name } = useWho();
  const [topic, setTopic] = useState<AskTopic | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  async function send() {
    if (!topic) return;
    if (topic === "other" && !note.trim()) {
      setSaid("Say what you need and it will go on the card.");
      return;
    }
    setBusy(true);
    const err = await askFor(
      "ask",
      job.task_id,
      note.trim(),
      { email, name },
      { topic },
    );
    setBusy(false);
    if (err) {
      setSaid(`That did not send: ${err}`);
      return;
    }
    setTopic(null);
    setNote("");
    setSaid("Sent. It will be on the ClickUp card within a few minutes.");
    onSent();
  }

  return (
    <div className="space-y-3">
      {job.asked_for ? (
        <p className="text-sm text-muted-foreground">
          Last asked for {job.asked_for} by {job.asked_by || "someone"} on{" "}
          {moment(job.asked_at)}.
        </p>
      ) : null}

      {/* Eight choices: one row that slides sideways on a phone (to the
          card's edges, which pad 16px there), wrapping from a tablet up. */}
      <div className="-mx-4 flex flex-nowrap gap-2 overflow-x-auto px-4 no-scrollbar sm:mx-0 sm:flex-wrap sm:px-0">
        {TOPICS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTopic(topic === t.key ? null : t.key);
              setSaid(null);
            }}
            aria-pressed={topic === t.key}
            className={chip(topic === t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {topic && (
        <div className="space-y-2">
          <textarea
            id="ask-note"
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={2}
            placeholder={
              topic === "other"
                ? "What do you need?"
                : "Anything worth adding (optional)"
            }
            aria-label="What you need"
            dir="auto"
            className={`${FIELD} resize-y py-2 text-foreground`}
          />
          <div className="flex items-center gap-2">
            <Button disabled={busy} onClick={send}>
              {busy ? "Sending" : "Put it on the card"}
            </Button>
            <Button
              variant="ghost"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => {
                setTopic(null);
                setNote("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {said && (
        <p role="status" className="text-sm text-muted-foreground">
          {said}
        </p>
      )}
    </div>
  );
}
