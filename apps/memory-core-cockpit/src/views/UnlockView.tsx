import { KeyRound } from "lucide-react";
import { useState } from "react";
import { Wordmark } from "@/components/memory/Wordmark";

/**
 * The door. One code, one person: this app has no user table because it has no
 * second user. The code is checked on the server on every read and write, so
 * hiding this screen is not what protects anything.
 */
export function UnlockView({
  onSubmit,
  message,
  configured,
  checking,
}: {
  onSubmit: (code: string) => void;
  /** What the server said about the last attempt. */
  message: string;
  /** False when the deployment has no code set at all. */
  configured: boolean;
  checking: boolean;
}) {
  const [value, setValue] = useState("");

  return (
    <div className="flex min-h-dvh items-center justify-center px-5 py-12">
      <div className="w-full max-w-md">
        <Wordmark />
        <h1 className="mt-6 text-xl font-semibold tracking-tight text-foreground">
          Open the memory core
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          One box over Notion, Gmail, Google Drive and the facts you save
          yourself. Paste the access code to open it.
        </p>

        <form
          className="mt-6 space-y-3"
          onSubmit={event => {
            event.preventDefault();
            onSubmit(value.trim());
          }}
        >
          <label
            htmlFor="access-code"
            className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            Access code
          </label>
          <input
            id="access-code"
            // biome-ignore lint/a11y/noAutofocus: this screen has exactly one field
            autoFocus
            type="password"
            value={value}
            onChange={event => setValue(event.target.value)}
            placeholder="The code Aziz set on the deployment"
            className="h-10 w-full rounded-xl border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="submit"
            disabled={checking || value.trim().length === 0}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            <KeyRound className="size-4" aria-hidden />
            {checking ? "Checking" : "Open"}
          </button>
        </form>

        {message && !configured ? (
          <p className="mt-4 rounded-lg border bg-card p-3 text-xs leading-relaxed text-foreground">
            {message}
          </p>
        ) : message && value.trim() ? (
          <p className="mt-4 text-xs leading-relaxed text-foreground">
            {message}
          </p>
        ) : null}

        <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
          The code stays in this browser. Lock this browser from Sources when
          you are done on a machine that is not yours.
        </p>
      </div>
    </div>
  );
}
