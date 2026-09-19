import { useState } from "react";
import { useWho } from "../lib/auth";
import { askFor } from "../lib/data";

/**
 * Add a do or a don't to the client's card.
 *
 * Aziz, 2026-09-19: an editor should be able to update these from what they
 * were told in revisions. It appends: this is the one list every cockpit
 * reads, written from onboarding calls over months, so a line can be added
 * and nothing can be pasted over. The worker signs it with who and when, the
 * way the onboarding entries are signed.
 */
export default function AddRule({
  clientTaskId,
  clientName,
  onSent,
}: {
  clientTaskId: string;
  clientName: string;
  onSent: () => void;
}) {
  const { email, name } = useWho();
  const [kind, setKind] = useState<"DO" | "DON'T" | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  async function send() {
    if (!text.trim() || !kind) return;
    setBusy(true);
    const err = await askFor(
      "dosdonts",
      `client:${clientTaskId}`,
      text.trim(),
      { email, name },
      { kind, client: clientName },
    );
    setBusy(false);
    if (err) {
      setSaid(`That did not send: ${err}`);
      return;
    }
    setText("");
    setKind(null);
    setSaid("Added. It reaches the client card within a few minutes.");
    onSent();
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {(["DO", "DON'T"] as const).map(k => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setKind(kind === k ? null : k);
              setSaid(null);
            }}
            aria-pressed={kind === k}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              kind === k
                ? "bg-[color:var(--primary)] text-[color:var(--primary-foreground)]"
                : "raised muted hover:text-[color:var(--foreground)]"
            }`}
          >
            Add a {k === "DO" ? "do" : "don't"}
          </button>
        ))}
        {!kind ? (
          <span className="muted text-xs">
            from what you were told in revisions
          </span>
        ) : null}
      </div>

      {kind ? (
        <div className="space-y-2">
          <textarea
            id="new-rule"
            rows={2}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={
              kind === "DO"
                ? "Hold the logo for the last two seconds"
                : "Use the old teal from before the rebrand"
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
              {busy ? "Adding" : `Add it to ${clientName}`}
            </button>
            <button
              type="button"
              onClick={() => {
                setKind(null);
                setText("");
              }}
              className="muted text-sm"
            >
              Cancel
            </button>
          </div>
          <p className="muted text-xs">
            This is added to the client card, signed with your name and today's
            date. Nothing already written can be replaced from here.
          </p>
        </div>
      ) : null}

      {said && <p className="muted text-sm">{said}</p>}
    </div>
  );
}
