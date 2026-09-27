import { useState } from "react";
import { useWho } from "../lib/auth";
import { askFor } from "../lib/data";
import { chip, FIELD } from "./bits";
import { Button } from "./ui/button";

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
            className={chip(kind === k)}
          >
            Add a {k === "DO" ? "do" : "don't"}
          </button>
        ))}
        {!kind ? (
          <span className="text-xs text-muted-foreground">
            From what you were told in revisions
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
            aria-label={kind === "DO" ? "The do" : "The don't"}
            dir="auto"
            className={`${FIELD} resize-y py-2`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={busy || !text.trim()} onClick={send}>
              {busy ? "Adding" : `Add it to ${clientName}`}
            </Button>
            <Button
              variant="ghost"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => {
                setKind(null);
                setText("");
              }}
            >
              Cancel
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            This is added to the client card, signed with your name and today's
            date. Nothing already written can be replaced from here.
          </p>
        </div>
      ) : null}

      {said && (
        <p role="status" className="text-sm text-muted-foreground">
          {said}
        </p>
      )}
    </div>
  );
}
