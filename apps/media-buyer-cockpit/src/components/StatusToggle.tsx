import { useAction } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";

/**
 * On/off for a live campaign, ad set or ad.
 *
 * This writes straight to the ad account, so it states plainly which way it is
 * about to go and reports the real Meta error if the write is refused, rather
 * than flipping optimistically and letting her believe something is paused when
 * it is still spending.
 */
export function StatusToggle({
  metaId,
  level,
  name,
  clientTag,
  active,
  compact,
}: {
  metaId?: string;
  level: "campaign" | "adset" | "ad";
  name: string;
  clientTag?: string;
  active: boolean;
  compact?: boolean;
}) {
  const setStatus = useAction(api.control.setStatus);
  const [busy, setBusy] = useState(false);
  const [on, setOn] = useState(active);
  if (!metaId) return null;

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const next = !on;
        const res = await setStatus({
          metaId,
          level,
          active: next,
          name,
          clientTag,
        });
        setBusy(false);
        if (res.ok) {
          setOn(next);
          toast.success(
            `${next ? "Turned on" : "Turned off"} — ${name}. Logged to the change log.`,
          );
        } else {
          toast.error(res.error ?? "Meta refused the change.");
        }
      }}
      title={`${on ? "Turn off" : "Turn on"} this ${level}`}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-semibold disabled:opacity-50 ${compact ? "text-[11px]" : "text-[12px]"} ${on ? "tone-good" : "tone-neutral"}`}
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ${on ? "bg-emerald-500" : "bg-muted-foreground/50"}`}
      />
      {busy ? "…" : on ? "On" : "Off"}
    </button>
  );
}
