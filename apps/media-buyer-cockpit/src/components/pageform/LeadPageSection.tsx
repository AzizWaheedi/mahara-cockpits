import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { PageFormPage, PageFormsRead } from "@/lib/pageFormClient";
import { cn } from "@/lib/utils";
import { PageFormEditor } from "./PageFormEditor";
import { PageFormFunnel } from "./PageFormFunnel";
import { PageVersions, when } from "./PageVersions";

/**
 * Lead page on the client page: the questions on the client's own form page,
 * the editor, and every version with a way back. Shown only for a client who
 * has such a page (Merge Studio first).
 */
export function LeadPageSection({
  read,
  className,
  metaCampaigns = [],
  waitingCampaigns = [],
}: {
  read: PageFormsRead;
  className?: string;
  /** The client's website campaigns: Meta's clicks on them go beside the page's visits. */
  metaCampaigns?: string[];
  /** Website campaigns on the ads board with no full day in the client's numbers yet. */
  waitingCampaigns?: string[];
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
              waitingCampaigns={waitingCampaigns}
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
  waitingCampaigns,
}: {
  page: PageFormPage;
  onChanged: () => void;
  metaCampaigns: string[];
  waitingCampaigns: string[];
}) {
  const [editing, setEditing] = useState(false);
  const questions = page.current?.questions ?? [];
  const live = page.versions.find(v => v.live);
  const liveLabel = live?.label ?? "v1";

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
            Edit form
          </Button>
        </div>
      </div>

      {page.currentUnreadable && (
        <p className="callout-warn mt-3 rounded-lg border px-3 py-2 text-xs">
          {page.currentUnreadable}
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
        waitingCampaigns={waitingCampaigns}
      />

      {page.versions.length > 0 && (
        <details className="mt-4 rounded-xl border px-4 py-3">
          <summary className="cursor-pointer select-none text-sm font-medium">
            Versions ({page.versions.length})
          </summary>
          <PageVersions page={page} onChanged={onChanged} className="mt-2" />
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
    </div>
  );
}
