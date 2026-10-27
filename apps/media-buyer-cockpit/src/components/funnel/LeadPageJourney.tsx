import { useState } from "react";
import { count } from "@/components/ceo/format";
import { Kicker } from "@/components/ceo/Kicker";
import { StatusChip } from "@/components/ceo/StatusChip";
import { PageFormEditor } from "@/components/pageform/PageFormEditor";
import { PagePreview } from "@/components/pageform/PageFormParts";
import { PageVersions } from "@/components/pageform/PageVersions";
import { Button } from "@/components/ui/button";
import { pageJourney } from "@/lib/leadPageFunnel";
import type { LeadPageRead, PageFormPage } from "@/lib/pageFormClient";
import { cn } from "@/lib/utils";
import { Rail, type RailStep } from "./JourneyRail";

// Not "Biggest leak": the path above already uses it for its weakest rate.
const leakChip = <StatusChip tone="warning" label="Most stop here" />;

/** The visits that reached a step, on the right of its row; nothing while they are not known. */
function Reached({ visits }: { visits: number | null }) {
  if (visits === null) return null;
  return (
    <span className="shrink-0 text-right">
      <span className="block text-sm font-medium tabular-nums">
        {count(visits)}
      </span>
      <span className="block text-[11px] text-muted-foreground">reached</span>
    </span>
  );
}

/**
 * A lead page in Open funnel, laid out as the instant form is: the steps a
 * lead goes through with Edit form, the versions, and the page itself in the
 * same phone. Each step also names the ad visitors who reached it, from the
 * page's own records, which Meta never gives for an instant form.
 */
export function LeadPageJourney({
  page,
  lead,
}: {
  page: PageFormPage;
  lead: LeadPageRead;
}) {
  const [screen, setScreen] = useState(0);
  const [editing, setEditing] = useState(false);
  const visits = lead.visits;
  const known = visits.data && !visits.error ? visits.data.steps : undefined;
  const steps = pageJourney(page, known);
  const live = page.versions.find(v => v.live)?.label ?? "v1";
  const changed = () => {
    lead.reload();
    visits.reload();
  };

  const rail: RailStep[] = steps.map(step => ({
    id: step.id,
    name: step.name,
    on: true,
    detail: step.detail,
    pickable: step.screen !== null,
    badge: step.leak ? leakChip : undefined,
    side: <Reached visits={step.visits} />,
    children: step.questions?.length ? (
      <ol className="mt-2 space-y-1" aria-label="The questions">
        {step.questions.map(q => (
          <li key={q.key}>
            <button
              type="button"
              onClick={() => setScreen(q.screen)}
              aria-current={screen === q.screen ? "step" : undefined}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg bg-muted/40 px-3 py-2 text-left transition hover:bg-muted/70",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                screen === q.screen &&
                  "bg-muted ring-1 ring-[color:var(--mahara-teal)]/50",
              )}
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-background text-[11px] font-medium tabular-nums">
                {q.screen}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm" dir="rtl">
                  {q.label}
                </span>
                {q.leak && (
                  <span className="mt-1 inline-block">{leakChip}</span>
                )}
              </span>
              {q.visits !== null && (
                <span className="shrink-0 text-sm tabular-nums">
                  {count(q.visits)}
                </span>
              )}
            </button>
          </li>
        ))}
      </ol>
    ) : undefined,
  }));
  // The questions step holds no screen of its own: it stands for the first question.
  const active =
    screen === 0
      ? "intro"
      : screen > (page.current?.questions.length ?? 0)
        ? "contact"
        : "questions";

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Kicker>What a lead goes through</Kicker>
          <Button
            size="sm"
            disabled={!page.current}
            onClick={() => setEditing(true)}
          >
            Edit form
          </Button>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
          {visits.error
            ? `The visits could not be read: ${visits.error}`
            : !visits.data
              ? "Reading the page's visits…"
              : `Reached counts visitors from ads in the last ${visits.data.days} days, on ${visits.data.version}, from the page's own records. Each visitor counts once per screen. Meta's clicks above run a little higher: some people leave before the page loads.`}
          {visits.error && (
            <>
              {" "}
              <button
                type="button"
                className="font-medium text-foreground underline"
                onClick={visits.reload}
              >
                Try again
              </button>
            </>
          )}
        </p>
        {page.currentUnreadable && (
          <p className="callout-warn mb-4 rounded-lg border px-3 py-2 text-xs">
            {page.currentUnreadable}
          </p>
        )}
        <Rail
          steps={rail}
          active={active}
          onPick={id => {
            const step = steps.find(s => s.id === id);
            if (step?.screen !== null && step?.screen !== undefined)
              setScreen(step.screen);
          }}
        />
        {page.versions.length > 1 && (
          <div className="mt-6">
            <Kicker className="mb-2">Versions of the page</Kicker>
            <PageVersions
              page={page}
              onChanged={changed}
              className="rounded-xl border px-3"
            />
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          {live} is live. Edit form publishes a new version at once, and
          visitors see it within a minute.
        </p>
      </div>
      {page.current && (
        <figure className="flex shrink-0 items-start justify-center">
          <PagePreview
            siteUrl={page.siteUrl}
            spec={page.current}
            screen={screen}
            frame="phone"
          />
        </figure>
      )}
      {editing && page.current && (
        <PageFormEditor
          open={editing}
          onOpenChange={setEditing}
          page={page}
          onPublished={changed}
        />
      )}
    </div>
  );
}
