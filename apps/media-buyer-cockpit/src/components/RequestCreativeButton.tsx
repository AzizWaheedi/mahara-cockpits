import { useAction } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { api } from "../../convex/_generated/api";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

const REASONS = [
  { value: "more_ads", label: "More ads to test" },
  { value: "new_angle", label: "New message, angle, or hook" },
  { value: "fatigue", label: "Refresh a fatigued ad" },
  { value: "edit_visuals", label: "Improve the edit or visuals" },
] as const;
type Reason = (typeof REASONS)[number]["value"];

/** Campaign and ad entry points share the same director request and result trace. */
export function RequestCreativeButton({
  campaignName,
  adId,
  adName,
  ads,
  compact = false,
}: {
  campaignName: string;
  adId?: string;
  adName?: string;
  ads?: { metaId: string; name: string }[];
  compact?: boolean;
}) {
  const request = useAction(api.creativeRequests.request);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [taskUrl, setTaskUrl] = useState<string | null>(null);
  const [reason, setReason] = useState<Reason | null>(null);
  const [pickedAd, setPickedAd] = useState("");
  const [note, setNote] = useState("");
  if (!adId && !ads) return null;

  const send = async () => {
    if (busy || !reason) return;
    setBusy(true);
    try {
      const row = await request({
        campaignName,
        sourceAdId: adId || pickedAd || undefined,
        reason,
        note: note.trim() || undefined,
      });
      if (row.script_task_url) {
        setTaskUrl(row.script_task_url);
        setOpen(false);
        setReason(null);
        setPickedAd("");
        setNote("");
        toast.success(
          row.already_open
            ? "An open creative request already exists for this ad or reason."
            : "New creative request sent to the director.",
        );
      } else {
        toast.error(
          "Request saved, but the ClickUp task needs checking. See Changes & Results.",
        );
      }
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not send the request.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className={
              compact
                ? "h-7 whitespace-nowrap px-2 text-xs"
                : "h-7 whitespace-nowrap px-2 text-[12px]"
            }
          >
            New creative
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New creative</DialogTitle>
            <DialogDescription>
              Choose why you need it. The director will decide whether to make a
              script, a new edit, or both.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-[13px] font-semibold">Reason</legend>
              {REASONS.map(option => (
                <label
                  key={option.value}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-[13px] has-[:checked]:border-primary has-[:checked]:bg-primary/10"
                >
                  <input
                    type="radio"
                    name={`creative-reason-${campaignName}-${adId ?? "campaign"}`}
                    value={option.value}
                    checked={reason === option.value}
                    onChange={() => setReason(option.value)}
                    className="accent-primary"
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>
            {adId ? (
              <p className="text-[12px] text-muted-foreground">
                Ad attached:{" "}
                <strong className="text-foreground">{adName ?? adId}</strong>.
                Its current results will be included.
              </p>
            ) : (
              <>
                {/* biome-ignore lint/a11y/noLabelWithoutControl: The custom control renders a button inside this label. */}
                <label className="block text-[12px] font-semibold">
                  Affected ad{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                  <AnimatedSelect
                    value={pickedAd}
                    onChange={event => setPickedAd(event.target.value)}
                    className="mt-1 block min-h-10 w-full rounded-md border bg-background px-2 text-[13px] font-normal"
                  >
                    <option value="">Campaign-wide request</option>
                    {ads?.map(ad => (
                      <option key={ad.metaId} value={ad.metaId}>
                        {ad.name}
                      </option>
                    ))}
                  </AnimatedSelect>
                </label>
              </>
            )}
            <label className="block text-[12px] font-semibold">
              Note for the director{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
              <textarea
                value={note}
                onChange={event => setNote(event.target.value)}
                maxLength={500}
                rows={3}
                className="mt-1 block w-full resize-y rounded-md border bg-background p-2 text-[13px] font-normal"
                placeholder="What should the team know?"
              />
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button disabled={!reason || busy} onClick={() => void send()}>
              {busy ? "Sending…" : "Send to creative director"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {taskUrl && (
        <a
          href={taskUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-semibold underline"
        >
          Open request
        </a>
      )}
    </div>
  );
}
