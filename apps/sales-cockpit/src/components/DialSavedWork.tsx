import { CloudAlert, RefreshCw } from "lucide-react";
import { useId, useState } from "react";
import { ApiError, api } from "../lib/api";
import {
  outcomeWords,
  type SavedWork,
  savedWorkTitle,
  savedWorkWhy,
} from "../lib/dialerUi";
import { ago } from "../lib/format";
import { toast } from "../lib/toast";
import { button } from "./kit";

/**
 * The rep's own saves that HighLevel has not taken yet. A save is stored in
 * the cockpit first and answers at once; HighLevel's half (the note, tags
 * and stage move) runs after it, so a slow or failed one shows here, quietly,
 * with a way to send it again. The outcome itself is never lost.
 */
export function SavedWorkLine({
  items,
  onSent,
}: {
  items: SavedWork[];
  /** HighLevel has it now (or had it already): take it off the list. */
  onSent: (attemptId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const id = useId();
  if (!items.length) return null;

  async function send(w: SavedWork) {
    if (busy) return;
    setBusy(w.attempt_id);
    setFailed(({ [w.attempt_id]: _, ...rest }) => rest);
    const who = w.name ?? "The lead";
    try {
      await api("dial.resync", { attempt_id: w.attempt_id });
      toast.success(`${who}: ${outcomeWords(w.outcome)} is in HighLevel now.`);
      onSent(w.attempt_id);
    } catch (e) {
      if (
        e instanceof ApiError &&
        e.status === 409 &&
        /already in HighLevel/i.test(e.message)
      ) {
        toast.success(`${who}: it is already in HighLevel.`);
        onSent(w.attempt_id);
      } else
        setFailed(f => ({
          ...f,
          [w.attempt_id]: String((e as Error).message ?? e),
        }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      aria-label="Saved work"
      className="rounded-[var(--radius-lg)] bg-[color:var(--secondary)] px-3 py-2"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(o => !o)}
        className="flex w-full min-w-0 items-center gap-2 text-left text-sm"
      >
        <CloudAlert
          className="size-4 shrink-0"
          style={{ color: "var(--warning)" }}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate">
          {savedWorkTitle(items.length)}
        </span>
        <span className="muted shrink-0 text-xs underline-offset-2 hover:underline">
          {open ? "Hide" : "Show"}
        </span>
      </button>
      {open ? (
        <div id={id} className="mt-2 space-y-1 border-t hairline pt-2">
          <p className="muted text-xs leading-relaxed">
            The outcomes are saved in the cockpit; only HighLevel's copy (the
            note, tags and stage) is behind.
          </p>
          <ul className="divide-y hairline">
            {items.map(w => (
              <li
                key={w.attempt_id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2"
              >
                <div className="min-w-0 flex-[1_1_16rem]">
                  <p className="truncate text-sm">
                    <bdi className="font-medium">
                      {w.name ?? "Unnamed lead"}
                    </bdi>
                    {` · ${outcomeWords(w.outcome)} · saved ${ago(w.saved_at)}`}
                  </p>
                  <p
                    className={`text-xs leading-relaxed ${failed[w.attempt_id] ? "" : "muted"}`}
                  >
                    {failed[w.attempt_id] ?? savedWorkWhy(w)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void send(w)}
                  disabled={busy !== null}
                  className={button}
                >
                  <RefreshCw
                    className={`size-3.5 ${busy === w.attempt_id ? "animate-spin" : ""}`}
                    aria-hidden
                  />
                  {busy === w.attempt_id
                    ? "Sending…"
                    : "Send to HighLevel again"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
