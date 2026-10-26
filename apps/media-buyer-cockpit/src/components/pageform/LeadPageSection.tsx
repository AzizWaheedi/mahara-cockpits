import { ArrowUpRight } from "lucide-react";
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
  type PageFormsRead,
  type PageFormVersion,
  switchPageForm,
} from "@/lib/pageFormClient";
import { cn } from "@/lib/utils";
import { PageFormEditor } from "./PageFormEditor";
import { PageFormFunnel } from "./PageFormFunnel";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kuwait",
  });

/**
 * Lead page on the client page: the questions on the client's own form page,
 * the editor, and every version with a way back. Shown only for a client who
 * has such a page (Merge Studio first).
 */
export function LeadPageSection({
  read,
  className,
  metaCampaigns = [],
}: {
  read: PageFormsRead;
  className?: string;
  /** The client's website campaigns: Meta's clicks on them go beside the page's visits. */
  metaCampaigns?: string[];
}) {
  const pages = read.data ?? [];
  return (
    <section
      id="lead-page"
      aria-labelledby="lead-page-title"
      className={cn("rounded-2xl border bg-card p-4 sm:p-6", className)}
    >
      <h3 id="lead-page-title" className="text-[15px] font-semibold">
        Lead page
      </h3>
      {read.error ? (
        <div className="callout-warn mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs">
          <span>The lead page could not be read: {read.error}</span>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={read.reload}
          >
            Try again
          </Button>
        </div>
      ) : read.loading && !pages.length ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Reading the lead page…
        </p>
      ) : (
        <div className="mt-4 divide-y">
          {pages.map(page => (
            <PageBlock
              key={page.slug}
              page={page}
              onChanged={read.reload}
              metaCampaigns={metaCampaigns}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PageBlock({
  page,
  onChanged,
  metaCampaigns,
}: {
  page: PageFormPage;
  onChanged: () => void;
  metaCampaigns: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState<PageFormVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const questions = page.current?.questions ?? [];
  const live = page.versions.find(v => v.live);
  const liveLabel = live?.label ?? "v1";

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
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{page.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {questions.length} questions, one per screen. {liveLabel} is live
            {live
              ? `, published ${when(live.at)}`
              : ", the questions the page was built with"}
            .
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            className="inline-flex h-9 items-center gap-1 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            href={page.siteUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open page
            <ArrowUpRight className="size-4" aria-hidden />
          </a>
          <Button
            size="sm"
            disabled={!page.current}
            onClick={() => setEditing(true)}
          >
            Edit questions
          </Button>
        </div>
      </div>

      {page.currentUnreadable && (
        <p className="callout-warn mt-3 rounded-lg border px-3 py-2 text-xs">
          {page.currentUnreadable}
        </p>
      )}
      {error && (
        <p className="callout-warn mt-3 rounded-lg border px-3 py-2 text-xs">
          {error}
        </p>
      )}

      {questions.length > 0 && (
        <ol className="mt-4 space-y-1.5">
          {questions.map((q, i) => (
            <li
              key={q.key}
              className="flex items-center gap-3 rounded-xl bg-muted/40 px-3 py-2"
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-background text-[11px] font-medium tabular-nums">
                {i + 1}
              </span>
              <span
                className="min-w-0 flex-1 truncate text-left text-sm"
                dir="rtl"
              >
                {q.label}
              </span>
              <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                {q.options.length} answers ·{" "}
                {page.bindings[q.key] ? "own CRM field" : "Answers field"}
              </span>
            </li>
          ))}
        </ol>
      )}

      <PageFormFunnel
        slug={page.slug}
        liveLabel={liveLabel}
        tick={page.liveVersion}
        metaCampaigns={metaCampaigns}
      />

      {page.versions.length > 0 && (
        <details className="mt-4 rounded-xl border px-4 py-3">
          <summary className="cursor-pointer select-none text-sm font-medium">
            Versions ({page.versions.length})
          </summary>
          <ul className="mt-2 divide-y">
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
                  <p
                    className="mt-0.5 text-xs text-muted-foreground"
                    dir="auto"
                  >
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
        </details>
      )}

      {editing && page.current && (
        <PageFormEditor
          open={editing}
          onOpenChange={setEditing}
          page={page}
          onPublished={onChanged}
        />
      )}

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
