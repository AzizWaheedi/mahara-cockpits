import { useState } from "react";
import { toast } from "sonner";
import { StatusChip } from "@/components/ceo/StatusChip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  type PageFormPage,
  type PageFormVersion,
  switchPageForm,
} from "@/lib/pageFormClient";

export const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kuwait",
  });

/**
 * Every version of a lead page, newest first, with Switch back on each one
 * that is not live. Shared by the client page's Lead page and Open funnel.
 */
export function PageVersions({
  page,
  onChanged,
  className,
}: {
  page: PageFormPage;
  onChanged: () => void;
  className?: string;
}) {
  const [target, setTarget] = useState<PageFormVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const liveLabel = page.versions.find(v => v.live)?.label ?? "v1";

  const switchBack = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const done = await switchPageForm({
        slug: page.slug,
        base: page.liveVersion,
        version: target.version,
      });
      toast.success(`${done.label} is live again`, {
        description: "Visitors see it within a minute.",
      });
      setTarget(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setTarget(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className}>
      {error && (
        <p className="callout-warn mb-2 rounded-lg border px-3 py-2 text-xs">
          {error}
        </p>
      )}
      <ul className="divide-y">
        {page.versions.map(v => (
          <li
            key={v.version}
            className="flex flex-wrap items-center justify-between gap-2 py-2.5"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm">
                <span className="font-medium tabular-nums">{v.label}</span>
                {v.live && <StatusChip tone="good" label="Live" />}
                {!v.wentLive && !v.live && (
                  <StatusChip tone="warning" label="Never went live" />
                )}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground" dir="auto">
                {v.summary}
                {v.source === "cockpit"
                  ? ` · ${v.by ?? "unknown"} · ${when(v.at)}`
                  : ""}
              </p>
            </div>
            {!v.live && (
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                disabled={busy}
                onClick={() => setTarget(v)}
              >
                Switch back
              </Button>
            )}
          </li>
        ))}
      </ul>

      <AlertDialog
        open={Boolean(target)}
        onOpenChange={o => !o && !busy && setTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Switch the live page to {target?.label}?
            </AlertDialogTitle>
            <AlertDialogDescription dir="auto">
              {target?.summary}. Visitors see {target?.label}'s questions within
              a minute. {liveLabel} stays in the list, so you can switch to it
              again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={e => {
                e.preventDefault();
                void switchBack();
              }}
            >
              {busy ? "Switching…" : `Switch to ${target?.label ?? ""}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
