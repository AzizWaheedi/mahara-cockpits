import { Link2, Loader2 } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import { LINK_DAYS, useUnlinkedCalls } from "../lib/data";
import { duration, when } from "../lib/format";
import { toast } from "../lib/toast";
import type { Me, Recording } from "../lib/types";
import { button, Failed, partsText, Reading } from "./kit";

const TOUCH = "pointer-coarse:min-h-11!";

/** Whether this seat may link a call to a lead (sales-api recording.link). */
export function canLinkCalls(me: Me): boolean {
  return Boolean(me.manager) || me.role === "closer" || me.role === "both";
}

/**
 * A call no rule could place, linked to this lead by hand (Muhammed,
 * 2026-10-21): محسن's demo was held in a room opened an hour after the
 * booking, so neither the invite nor the booked time named him, and the
 * proposal writer found no call. A closer sees the video calls they recorded
 * in the last three days that no lead has; a manager sees everyone's. Phone
 * calls and team meetings are never offered. Each call asks once before it
 * links, because a wrong link drafts the proposal from another lead's call.
 */
export function LinkCall({
  me,
  contactId,
  onLinked,
}: {
  me: Me;
  contactId: string;
  onLinked: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mine = me.manager
    ? null
    : [me.fathom_email, me.email]
        .filter((e): e is string => Boolean(e))
        .map(e => e.toLowerCase());
  const calls = useUnlinkedCalls(mine, open);

  async function link(r: Recording) {
    setBusy(true);
    try {
      await api("recording.link", {
        recording_id: r.recording_id,
        contact_id: contactId,
      });
      toast.success(
        "Call linked to this lead. Draft the proposal when you are ready.",
      );
      setAsking(null);
      setOpen(false);
      onLinked();
    } catch (err) {
      toast.error(String((err as Error).message ?? err));
      calls.reload();
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${button} ${TOUCH}`}
      >
        <Link2 className="size-3.5" aria-hidden />
        Link a call
      </button>
    );

  const list = calls.data ?? [];
  return (
    <div className="space-y-3 rounded-xl bg-muted/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm">
          {me.manager
            ? `Video calls from the last ${LINK_DAYS} days that no lead has yet.`
            : `Your video calls from the last ${LINK_DAYS} days that no lead has yet.`}
        </p>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setAsking(null);
          }}
          className="muted text-xs underline underline-offset-2"
        >
          Close
        </button>
      </div>
      {calls.error ? (
        <Failed
          what="The calls to link"
          error={calls.error}
          retry={calls.reload}
        />
      ) : !calls.data ? (
        <Reading what="your calls" />
      ) : !list.length ? (
        <p className="muted text-sm">
          No calls to link. A call appears here about half an hour after it ends
          in Fathom. If it is older than {LINK_DAYS} days or another lead has
          it, ask a manager.
        </p>
      ) : (
        <ul className="divide-y hairline">
          {list.map(r => (
            <li key={r.recording_id} className="space-y-2 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="min-w-[10rem] flex-1">
                  <span className="block truncate text-sm" dir="auto">
                    {r.title ?? "Untitled call"}
                  </span>
                  <span className="muted block text-xs">
                    {partsText([
                      when(r.started_at),
                      duration(r.duration_s),
                      me.manager
                        ? (r.recorded_by?.split("@")[0] ?? null)
                        : null,
                    ])}
                  </span>
                </span>
                {asking === r.recording_id ? null : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setAsking(r.recording_id)}
                    className={`${button} ${TOUCH}`}
                  >
                    Link
                  </button>
                )}
              </div>
              {asking === r.recording_id ? (
                <div className="callout-warn rounded-[var(--radius-md)] border px-3 py-2.5">
                  <p className="text-sm" role="alert">
                    Link this call to this lead? The proposal is drafted from
                    it.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void link(r)}
                      className={`${button} ${TOUCH}`}
                    >
                      {busy ? (
                        <Loader2
                          className="size-3.5 animate-spin"
                          aria-hidden
                        />
                      ) : null}
                      Yes, link it
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setAsking(null)}
                      className={`${button} ${TOUCH}`}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
