import { useAction } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/** A buyer can send the ad and its campaign evidence straight to the director. */
export function RequestCreativeButton({
  campaignName,
  adId,
}: {
  campaignName: string;
  adId?: string;
}) {
  const request = useAction(api.creativeRequests.request);
  const [busy, setBusy] = useState(false);
  const [taskUrl, setTaskUrl] = useState<string | null>(null);
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState("");
  if (!adId) return null;
  const send = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const row = await request({
        campaignName,
        sourceAdId: adId,
        note: note.trim() || undefined,
      });
      if (row.script_task_url) {
        setTaskUrl(row.script_task_url);
        toast.success("Creative request sent to the director's Work queue.");
      } else {
        toast.error(
          "Request saved, but the ClickUp task needs checking. See Changes & Results.",
        );
      }
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not send the creative request.",
      );
    } finally {
      setBusy(false);
    }
  };
  return taskUrl ? (
    <a
      href={taskUrl}
      target="_blank"
      rel="noreferrer"
      className="text-[11px] font-semibold underline"
    >
      Creative requested
    </a>
  ) : (
    <div className="flex flex-wrap items-center gap-1">
      <Button
        size="sm"
        variant="outline"
        className="h-7 whitespace-nowrap px-2 text-[11px]"
        disabled={busy}
        onClick={() => void send()}
        title="Send this ad and its campaign evidence to the creative director"
      >
        {busy ? "Sending…" : "Request creative"}
      </Button>
      <button
        type="button"
        className="text-[11px] text-muted-foreground underline"
        onClick={() => setShowNote(v => !v)}
      >
        {showNote ? "Hide note" : "Add note"}
      </button>
      {showNote && (
        <Input
          aria-label="Note for the creative director"
          value={note}
          onChange={event => setNote(event.target.value)}
          maxLength={500}
          placeholder="Optional context for the director"
          className="min-w-48 flex-1 text-[12px]"
        />
      )}
    </div>
  );
}
