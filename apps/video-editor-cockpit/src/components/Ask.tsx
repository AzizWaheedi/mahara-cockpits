import { useState } from "react";
import { useWho } from "../lib/auth";
import { askFor } from "../lib/data";
import { moment } from "../lib/format";
import type { AskTopic, Job } from "../lib/types";

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
    const err = await askFor("ask", job.task_id, note.trim(), { email, name }, { topic });
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
        <p className="muted text-sm">
          Last asked for {job.asked_for} by {job.asked_by || "someone"} on {moment(job.asked_at)}.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        {TOPICS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTopic(topic === t.key ? null : t.key);
              setSaid(null);
            }}
            aria-pressed={topic === t.key}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              topic === t.key
                ? "bg-[color:var(--primary)] text-[color:var(--primary-foreground)]"
                : "raised muted hover:text-[color:var(--foreground)]"
            }`}
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
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={
              topic === "other" ? "What do you need?" : "Anything worth adding (optional)"
            }
            className="raised w-full resize-y rounded-[var(--radius-md)] border hairline px-3 py-2 text-sm"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={send}
              className="rounded-[var(--radius-md)] bg-[color:var(--primary)] px-3 py-1.5 text-sm font-medium text-[color:var(--primary-foreground)] disabled:opacity-50"
            >
              {busy ? "Sending" : "Put it on the card"}
            </button>
            <button
              type="button"
              onClick={() => {
                setTopic(null);
                setNote("");
              }}
              className="muted text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {said && <p className="muted text-sm">{said}</p>}
    </div>
  );
}
