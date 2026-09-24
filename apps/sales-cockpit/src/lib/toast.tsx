import { CircleAlert, CircleCheck, X } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Sonner's `toast.success` / `toast.error`, in about eighty lines.
 *
 * The other three cockpits have sonner; this one keeps its five
 * dependencies. What the ideation page asks of a toast is narrow -- say a
 * sentence, colour it good or bad, go away by itself -- and the part worth
 * getting right is that a message must not be announced silently: the live
 * region below is polite for a success and assertive for a failure, so a
 * screen reader hears the same thing the screen shows.
 */
type Kind = "success" | "error";
type Note = { id: number; kind: Kind; text: string };

let seq = 0;
let notes: Note[] = [];
const listeners = new Set<(n: Note[]) => void>();

function publish(): void {
  for (const l of listeners) l(notes);
}

function drop(id: number): void {
  notes = notes.filter(n => n.id !== id);
  publish();
}

function push(kind: Kind, text: unknown): void {
  const body = String(text ?? "").trim();
  if (!body) return;
  const id = ++seq;
  notes = [...notes, { id, kind, text: body }].slice(-4);
  publish();
  // Long enough to read a sentence; a failure stays twice as long because
  // it usually says what to do next.
  window.setTimeout(() => drop(id), kind === "error" ? 8000 : 4000);
}

export const toast = {
  success: (text: unknown) => push("success", text),
  error: (text: unknown) => push("error", text),
};

export function Toaster() {
  const [shown, setShown] = useState<Note[]>(notes);

  useEffect(() => {
    listeners.add(setShown);
    return () => {
      listeners.delete(setShown);
    };
  }, []);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4"
      style={{ bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
    >
      {shown.map(n => (
        <output
          key={n.id}
          aria-live={n.kind === "error" ? "assertive" : "polite"}
          className={`panel pointer-events-auto flex w-full max-w-md items-start gap-2 px-3 py-2 text-[13px] shadow-lg ${
            n.kind === "error" ? "callout-bad" : "callout-good"
          }`}
        >
          {n.kind === "error" ? (
            <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
          ) : (
            <CircleCheck className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
          )}
          <span className="min-w-0 flex-1" dir="auto">
            {n.text}
          </span>
          <button
            type="button"
            onClick={() => drop(n.id)}
            aria-label="Dismiss"
            className="shrink-0 opacity-70 hover:opacity-100"
          >
            <X className="size-3.5" strokeWidth={2.5} />
          </button>
        </output>
      ))}
    </div>
  );
}
