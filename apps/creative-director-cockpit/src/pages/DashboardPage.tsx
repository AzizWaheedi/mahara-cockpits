import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronRight,
  Circle,
  Dna,
  Film,
  ListChecks,
  MessageSquare,
  Minus,
  MoonStar,
  PenLine,
  Rocket,
  Send,
  Trophy,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import {
  CreativePreview,
  stillPropsFor,
  useLocalStills,
} from "@/components/CreativePreview";
import { PageHeader } from "@/components/PageHeader";
import { TemplateCard } from "@/components/TemplateCard";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { WhatsAppDesk } from "@/components/WhatsAppDesk";
import { CopyButton } from "@/components/WinningAds";
import { fill, TEMPLATES } from "@/lib/creativeTemplates";
import { api } from "../../convex/_generated/api";
import { ScriptingCalendar } from "./CalendarPage";

// biome-ignore lint/suspicious/noExplicitAny: the snapshot is the screen's own shape
type Any = any;

/**
 * Creative director cockpit.
 *
 * Ordered the way the day actually runs: what is late and blocking a client
 * first, then the queue that feeds everything else (Brand DNA), then
 * production, then what the numbers say to make more of.
 */

const DAY = 86_400_000;

function days(ms: number | null | undefined): string {
  if (!ms) return "no date";
  const d = Math.round((ms - Date.now()) / DAY);
  if (d === 0) return "today";
  if (d > 0) return `in ${d}d`;
  return `${Math.abs(d)}d late`;
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** One row of a card's list, edge to edge under the card's divider. */
const ROW = "px-4 py-3 text-sm sm:px-6";
/** The small uppercase label above a number or a group. */
const KICKER =
  "font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground";

/**
 * A card with its title row. `flush` runs the body edge to edge under a
 * divider, for a list of rows; otherwise the body sits inside the padding.
 */
function Section({
  icon: Icon,
  title,
  sub,
  flush = false,
  children,
}: {
  icon: React.ElementType;
  title: string;
  sub?: string;
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Icon className="size-4 shrink-0 translate-y-0.5 text-muted-foreground" />
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </div>
      <div
        className={
          flush ? "-mx-4 -mb-4 mt-4 border-t sm:-mx-6 sm:-mb-6" : "mt-4"
        }
      >
        {children}
      </div>
    </section>
  );
}

/** A status chip: the colour sits on the icon, the words stay plain. */
function StatusChip({
  icon: Icon,
  tone,
  children,
}: {
  icon: React.ElementType;
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium">
      <Icon className={`size-3.5 ${tone}`} aria-hidden />
      {children}
    </span>
  );
}

/** A status chip with a 6px dot instead of an icon. */
function DotChip({
  color,
  children,
}: {
  color: string;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium">
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: color }}
      />
      <span className="truncate">{children}</span>
    </span>
  );
}

type View = "sod" | "eod" | "works";

const TITLES: Record<View, { title: string; sub?: string }> = {
  // Today's line under the title is the day's counts, set below.
  sod: { title: "Today" },
  works: {
    title: "What works",
    sub: "What to make more of, and what is burning out",
  },
  eod: {
    title: "End of day",
    sub: "Your EOD report, already written from today's work",
  },
};

/** Today's parts, one tap away on a long page. */
const PARTS = [
  { id: "morning", label: "Morning" },
  { id: "scripting", label: "Scripting" },
  { id: "videos", label: "Videos" },
  { id: "touchpoints", label: "Touchpoints" },
];

/**
 * Today: the day in order on one page (the simplification audit, approved by
 * Aziz on 2026-10-06). The morning, then scripting and the videos, then the
 * client touchpoints: what were Start of day, Middle of the day and Client
 * touchpoints. Their old addresses land on their part of it.
 */
export function DashboardPage() {
  return <Creative view="sod" />;
}
export function CreativeEodPage() {
  return <Creative view="eod" />;
}

/**
 * Every client, worst first, each opening onto their onboarding, numbers,
 * touchpoints and work. The Clients page's second view (it was /profiles,
 * which nothing linked to).
 */
export function ClientProfilesView() {
  const snap = useQuery(api.creative.snapshot, {}) as Any;
  if (snap === undefined) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  return <ClientProfiles rows={snap.clients} />;
}

/**
 * Sync health strip. Silent when everything is fresh, loud when it is not, so
 * you never work off a board that quietly stopped updating. [aziz, 2026-09-07]
 */
function SyncHealth() {
  const f = useQuery(api.sync.freshness, {});
  if (!f || (f.stale.length === 0 && !f.oldestSyncedAt)) return null;
  const age = f.oldestSyncedAt
    ? Math.round((Date.now() - f.oldestSyncedAt) / 60_000)
    : null;
  if (f.stale.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Everything on this board synced{" "}
        {age === 0 ? "just now" : `${age} min ago`}. Refreshes {f.cadence}.
      </p>
    );
  }
  return (
    <div className="callout-warn rounded-xl border px-4 py-3 text-sm">
      <strong>Some of this is stale.</strong> {f.stale.join(", ")} should
      refresh every {f.expectedEveryMin} minutes right now and have not, so
      treat those numbers as old and tell Aziz, or ask Hermes in the chat.
    </div>
  );
}

function Creative({ view }: { view: View }) {
  const snap = useQuery(api.creative.snapshot, {}) as Any;
  const [showAllBrand, setShowAllBrand] = useState(false);
  const { hash } = useLocation();

  // An old address (/work, /touchpoints) or a part's link lands on its part
  // once the page has something to scroll to. A jump, not a glide: a glide
  // never runs in a tab opened in the background.
  const ready = snap !== undefined;
  useEffect(() => {
    if (view !== "sod" || !hash || !ready) return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [view, hash, ready]);

  if (snap === undefined) {
    return (
      <div className="mx-auto w-full max-w-6xl text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  const c = snap.counts;
  // Start of day shows only the rows still missing a doc; the rest are
  // housekeeping and sit behind "Show all". [aziz, 2026-09-10]
  const brandOpen = snap.brandDNA.filter(
    (b: { docOnFile?: boolean }) => !b.docOnFile,
  );
  const brandShown = showAllBrand ? snap.brandDNA : brandOpen.slice(0, 8);

  // The day's counts belong to Today; the other screens say what they are
  // for instead.
  const sub =
    view === "sod"
      ? `${c.brandDNA} brand DNA missing · ${c.scripts} scripts open · ${c.overdueVideos} video${c.overdueVideos === 1 ? "" : "s"} late`
      : TITLES[view].sub;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <PageHeader
        title={TITLES[view].title}
        sub={sub}
        actions={
          view === "sod" ? (
            // Sending a cut out, the calendar and the EOD have their own
            // pages; Today links to them rather than carrying second copies.
            <>
              <Button asChild size="sm" variant="outline">
                <Link to="/review">
                  <Send />
                  Send for review
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/meetings">
                  <CalendarDays />
                  Meetings
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/eod">
                  <MoonStar />
                  End of day
                </Link>
              </Button>
            </>
          ) : undefined
        }
      />

      {view === "sod" ? (
        <nav aria-label="On this page" className="-mt-2 flex flex-wrap gap-1.5">
          {PARTS.map(p => (
            <a
              key={p.id}
              href={`#${p.id}`}
              className="rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {p.label}
            </a>
          ))}
        </nav>
      ) : null}

      <SyncHealth />

      {view === "sod" && (
        <>
          {/* The morning: what is late, what clients said, the checks. */}
          <div id="morning" className="scroll-mt-20 space-y-6">
            {/* What is late right now: the most expensive thing on the screen. */}
            {(c.overdueVideos > 0 || snap.overduePosts.length > 0) && (
              <Section
                icon={AlertTriangle}
                title="Late and blocking a client"
                sub="Deal with these first"
                flush
              >
                <ul className="divide-y">
                  {snap.videoJobs
                    .filter((j: Any) => j.overdueDays > 0)
                    .map((j: Any) => (
                      <li key={j.taskId}>
                        <a
                          href={j.url ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                          className={`${ROW} flex items-center gap-3 hover:bg-muted/40`}
                        >
                          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                            <StatusChip icon={Film} tone="txt-bad">
                              {j.overdueDays}d late
                            </StatusChip>
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {j.unidentified ? (
                                <span className="italic text-muted-foreground">
                                  Untitled video request, no client on the task
                                </span>
                              ) : (
                                j.name
                              )}
                            </span>
                            <span className="basis-full text-xs text-muted-foreground sm:basis-auto">
                              {j.status} ·{" "}
                              {j.editors.join(", ") || "unassigned"}
                            </span>
                          </span>
                          <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
                        </a>
                      </li>
                    ))}
                  {snap.overduePosts.slice(0, 4).map((p: Any) => (
                    <li key={p.taskId}>
                      <a
                        href={p.url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className={`${ROW} flex items-center gap-3 hover:bg-muted/40`}
                      >
                        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                          <StatusChip icon={CalendarDays} tone="txt-warn">
                            {p.lateDays}d late
                          </StatusChip>
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {p.name}
                          </span>
                          <span className="basis-full text-xs text-muted-foreground sm:basis-auto">
                            {p.client ?? "No client"}
                          </span>
                        </span>
                        <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
                      </a>
                    </li>
                  ))}
                </ul>
                {snap.overduePosts.length > 4 && (
                  <p
                    className={`${ROW} border-t text-xs text-muted-foreground`}
                  >
                    {snap.overduePosts.length - 4} more unpublished posts past
                    their date.
                  </p>
                )}
              </Section>
            )}
            {/* What clients said on WhatsApp, with the reply already drafted. */}
            <WhatsAppDesk desk="creative" />
            <Checklist phase="sod" checks={snap.checks} />
          </div>

          {/* The middle of the day is scripting, so the sweep and the calendar
              lead it and everything you write from sits below. [aziz, 2026-09-08] */}
          <div id="scripting" className="scroll-mt-20 space-y-6">
            <Checklist phase="mid" checks={snap.checks} />
            <ScriptingCalendar compact />
            {/* Brand DNA. Mostly already written, so the board rows are noise. */}
            <Section
              icon={Dna}
              title="Brand DNA board rows"
              sub="The doc is what counts, not the task. Rows marked done are already written and can be closed"
              flush
            >
              {brandShown.length === 0 ? (
                <p className={`${ROW} text-muted-foreground`}>
                  Every client has a Brand DNA doc on file.
                </p>
              ) : (
                <ul className="divide-y">
                  {brandShown.map((b: Any) => (
                    <li key={b.taskId}>
                      <a
                        href={b.url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className={`${ROW} flex items-center gap-3 hover:bg-muted/40`}
                      >
                        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="min-w-0 truncate font-medium">
                            {b.client}
                          </span>
                          {b.docOnFile && (
                            <DotChip color="var(--success)">
                              Doc on file
                              {b.matchedTo && b.matchedTo !== b.client
                                ? ` under "${b.matchedTo}"`
                                : ""}
                              , close the task
                            </DotChip>
                          )}
                          {b.duplicate && (
                            <DotChip color="var(--warning)">
                              Duplicate task
                            </DotChip>
                          )}
                          <span
                            className={`basis-full text-xs sm:ml-auto sm:basis-auto ${
                              !b.docOnFile && b.ageDays >= 21
                                ? "txt-bad font-semibold"
                                : "text-muted-foreground"
                            }`}
                          >
                            {b.docOnFile
                              ? `Open ${b.ageDays}d`
                              : `Waiting ${b.ageDays}d`}
                          </span>
                        </span>
                        <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {snap.brandDNA.length > brandShown.length || showAllBrand ? (
                <div className="border-t px-2 py-1.5 sm:px-4">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowAllBrand(!showAllBrand)}
                  >
                    {showAllBrand
                      ? "Show fewer"
                      : `Show all ${snap.brandDNA.length}`}
                  </Button>
                </div>
              ) : null}
            </Section>
            {/* Onboarding: the one parent task per client. Aziz, 2026-09-10:
                "just the main task, not the subtasks below it." */}
            {snap.journeys.length > 0 && (
              <Section
                icon={Rocket}
                title="Clients in creative onboarding"
                sub="One task per client, open it in ClickUp for the steps"
                flush
              >
                <ul className="divide-y">
                  {snap.journeys.map((j: Any) => (
                    <li key={j.taskId}>
                      <a
                        href={j.url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className={`${ROW} flex items-center gap-3 hover:bg-muted/40`}
                      >
                        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {j.client}
                          </span>
                          <span className="basis-full text-xs text-muted-foreground sm:basis-auto">
                            {j.status} · day {j.ageDays}
                          </span>
                        </span>
                        <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
                      </a>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            <Section
              icon={PenLine}
              title="Script requests"
              sub={`${snap.staleScripts} sitting 3+ days`}
              flush
            >
              {snap.scripts.length === 0 ? (
                <p className={`${ROW} text-muted-foreground`}>
                  No script request is open.
                </p>
              ) : (
                <ul className="divide-y">
                  {snap.scripts.slice(0, 8).map((s: Any) => (
                    <li key={s.taskId}>
                      <a
                        href={s.url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className={`${ROW} flex items-center gap-3 hover:bg-muted/40`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {s.client ?? (
                                <span className="italic text-muted-foreground">
                                  No client on this task
                                </span>
                              )}
                            </span>
                            <span
                              className={`basis-full text-xs sm:basis-auto ${
                                s.ageDays >= 7
                                  ? "txt-bad font-semibold"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {s.ageDays}d old · {s.status}
                            </span>
                          </span>
                          {s.notes && (
                            <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground">
                              {s.notes}
                            </span>
                          )}
                        </span>
                        <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          {/* The videos: the pipeline, then who owes what. */}
          <div id="videos" className="scroll-mt-20 space-y-6">
            <VideoPipeline snap={snap} />
            <Section icon={Film} title="Editors" sub="Who owes what" flush>
              {snap.editors.length === 0 ? (
                <p className={`${ROW} text-muted-foreground`}>
                  Nothing open in the video pipeline.
                </p>
              ) : (
                <ul className="divide-y">
                  {snap.editors.map((e: Any) => (
                    <li
                      key={e.editor}
                      className={`${ROW} flex flex-wrap items-center gap-x-3 gap-y-1`}
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {e.editor}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {e.open} open
                        {e.overdue > 0 && (
                          <span className="txt-bad ml-1.5 font-semibold">
                            {e.overdue} late
                          </span>
                        )}
                        <span className="ml-1.5">· next {days(e.nextDue)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            {/* Posts are planned on Social, the one calendar since 2026-09-23.
                The ClickUp content list speaks here only when it holds posts
                and a client has nothing scheduled. [audit, 2026-10-06] */}
            {(snap.plannedAhead > 0 || snap.overduePosts.length > 0) &&
              snap.uncovered.length > 0 && (
                <Section
                  icon={CalendarDays}
                  title="Social calendar"
                  sub={`${snap.plannedAhead} posts scheduled ahead on ClickUp`}
                >
                  <div className="callout-warn rounded-xl p-3 text-sm">
                    <strong className="font-semibold">
                      {snap.uncovered.length} client
                      {snap.uncovered.length === 1 ? "" : "s"} with nothing
                      scheduled from today:
                    </strong>{" "}
                    {snap.uncovered.map((u: Any) => u.client).join(", ")}. A
                    paying social client with an empty calendar is a churn risk
                    before they ever complain.
                  </div>
                </Section>
              )}
          </div>

          {/* Who is owed a message, with the SOP templates on the row. */}
          <div id="touchpoints" className="scroll-mt-20 space-y-6">
            <Section
              icon={MessageSquare}
              title="The rule"
              sub="Creative director floor, lighter than the CSM's"
            >
              <p className="text-sm">
                <strong className="font-semibold">
                  1 to 2 messages a week in the client's group per active
                  client.
                </strong>{" "}
                A touchpoint gives them something, a script going out, a video
                to review, a creative refresh, an answer. "Just checking in"
                does not count, and a real concern gets a call, not a text.
              </p>
              <a
                href="https://docs.google.com/document/d/10wQorQfSebiX3Lmh0jXkEUkp3I_xMP68p4b1q-oUxcY/edit"
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                Open the client communication SOP
                <ArrowUpRight className="size-3.5" />
              </a>
            </Section>
            <Touchpoints rows={snap.touchpoints} />
            <AllTemplates roster={snap.clients} />
          </div>
        </>
      )}
      {view === "eod" && <EndOfDay snap={snap} />}

      {/* 7. What the numbers say. */}
      {view === "works" && (
        <Section
          icon={Trophy}
          title="What to make more of"
          sub="From the live ad accounts"
        >
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <h3 className={`mb-2 ${KICKER}`}>Winning creatives</h3>
              {snap.winners.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No ad has enough spend yet to call a winner.
                </p>
              ) : (
                <ul className="divide-y rounded-xl bg-muted/40">
                  {snap.winners.map((w: Any, i: Any) => (
                    <li key={i} className="px-3 py-2.5 text-sm">
                      <div className="font-medium">{w.client}</div>
                      <div className="text-xs text-muted-foreground">
                        {w.adName} · {money(w.cpl)} CPL · {w.leads} leads
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className={`mb-2 ${KICKER}`}>Frequency watch</h3>
              {!snap.anyBurning && (
                <p className="mb-2 text-sm text-muted-foreground">
                  Nothing is fatiguing: the highest frequency in the accounts is{" "}
                  {snap.fatiguing[0]?.frequency.toFixed(1) ?? "n/a"}, well under
                  the {snap.fatigueGate} gate. No replacements needed today.
                </p>
              )}
              {snap.fatiguing.length > 0 && (
                <ul className="divide-y rounded-xl bg-muted/40">
                  {snap.fatiguing.slice(0, 5).map((f: Any, i: Any) => (
                    <li key={i} className="px-3 py-2.5 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <span className="inline-flex min-w-0 items-center gap-1.5 font-medium">
                          {f.burning && (
                            <AlertTriangle
                              className="size-3.5 shrink-0 txt-bad"
                              aria-label="Burning out"
                            />
                          )}
                          <span className="truncate">{f.client}</span>
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          freq {f.frequency.toFixed(2)}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {f.adName}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}

/** The fixed shape of the day, ticked off as you go. */
function Checklist({
  phase,
  checks,
}: {
  phase: "sod" | "mid";
  // biome-ignore lint/suspicious/noExplicitAny: snapshot rows are untyped
  checks: any[];
}) {
  const toggle = useMutation(api.creative.toggleCheck);
  const rows = checks.filter((c: Any) => c.phase === phase);
  const done = rows.filter((c: Any) => c.done).length;

  return (
    <Section
      icon={ListChecks}
      title={phase === "sod" ? "Before you produce anything" : "The sweep"}
      sub={`${done}/${rows.length} done`}
      flush
    >
      <ul className="divide-y">
        {rows.map((c: Any) => (
          <li key={c.key}>
            <button
              type="button"
              aria-pressed={Boolean(c.done)}
              onClick={() => void toggle({ key: c.key, done: !c.done })}
              className={`${ROW} flex w-full items-start gap-3 text-left transition hover:bg-muted/40 ${
                c.done ? "opacity-55" : ""
              }`}
            >
              <span
                className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border ${
                  c.done
                    ? "border-primary bg-primary text-primary-foreground"
                    : ""
                }`}
              >
                {c.done && <Check className="size-3" />}
              </span>
              <span className="min-w-0">
                <span className={`font-medium ${c.done ? "line-through" : ""}`}>
                  {c.label}
                </span>
                {c.detail && (
                  <span className="block text-xs text-muted-foreground">
                    {c.detail}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * Who is owed a message, and why.
 *
 * The reason is the point: you should never have to work out what to say. Each
 * line is something that changed on the creative side today, phrased the way
 * the client communication SOP would have you say it.
 */
function Touchpoints({
  rows,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: snapshot rows are untyped
  rows: any[];
}) {
  const log = useMutation(api.creative.logTouch);

  if (!rows.length) {
    return (
      <Section icon={MessageSquare} title="Nobody is owed a message">
        <p className="text-sm text-muted-foreground">
          Nothing changed on the creative side today that a client needs to hear
          about. That is a good day, not an empty screen.
        </p>
      </Section>
    );
  }

  return (
    <Section
      icon={MessageSquare}
      title="Owed a message today"
      sub={`${rows.filter((r: Any) => !r.done).length} outstanding`}
      flush
    >
      <ul className="divide-y">
        {rows.map((r: Any) => (
          <li key={r.client}>
            <TouchpointRow r={r} onLog={() => void log({ client: r.client })} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * The full SOP library, for a message nobody is owed yet.
 *
 * Collapsed by default: the templates that matter are already on the rows
 * above, attached to a client and a reason. [aziz, 2026-09-08]
 */
function AllTemplates({
  // biome-ignore lint/suspicious/noExplicitAny: snapshot rows are untyped
  roster,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: snapshot rows are untyped
  roster: any[];
}) {
  const [open, setOpen] = useState(false);
  const [client, setClient] = useState("");
  const names: string[] = [
    ...new Set(roster.map((r: Any) => r.client as string)),
  ]
    .filter(Boolean)
    .sort((a: Any, b: Any) => a.localeCompare(b));

  return (
    <Section
      icon={MessageSquare}
      title="Every template in the SOP"
      sub="For a message that is not on the list above"
    >
      <Button
        size="sm"
        variant="outline"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? "Hide the library" : `Show all ${TEMPLATES.length} templates`}
      </Button>
      {open && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Writing to</span>
            <AnimatedSelect
              value={client}
              onChange={e => setClient(e.target.value)}
              className="h-8 rounded-md border bg-transparent px-2 text-sm"
            >
              <option value="">nobody in particular</option>
              {names.map((n: Any) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </AnimatedSelect>
          </div>
          <div className="divide-y rounded-xl bg-muted/40">
            {TEMPLATES.map((t: Any) => (
              <TemplateCard key={t.id} t={t} client={client || undefined} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            A real concern is a call, not a message. Get them on Maqsam or Zoom
            the same day rather than typing it out.
          </p>
        </div>
      )}
    </Section>
  );
}

/**
 * One client owed a message, with the recommended wording right there.
 *
 * The templates used to live on their own page. They belong here: the reason
 * they are owed a message and the message itself are the same decision.
 * [aziz, 2026-09-08]
 */
function TouchpointRow({
  r,
  onLog,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: snapshot rows are untyped
  r: any;
  onLog: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<string>(r.templateId ?? TEMPLATES[0].id);
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const t = TEMPLATES.find((x: Any) => x.id === pick) ?? TEMPLATES[0];
  const [text, setText] = useState(fill(t.ar, r.client));

  const swap = (id: string, l: "ar" | "en") => {
    const next = TEMPLATES.find((x: Any) => x.id === id) ?? TEMPLATES[0];
    setPick(id);
    setLang(l);
    setText(fill(l === "ar" ? next.ar : next.en, r.client));
  };

  return (
    <div className={`text-sm ${r.done ? "opacity-55" : ""}`}>
      <div className={ROW}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="min-w-0 flex-1 truncate font-medium">
            {r.client}
          </span>
          <span className="flex items-center gap-2">
            {/* One button for the one thing: the message went, log it. */}
            {r.done ? (
              <span className="text-xs text-muted-foreground">
                Messaged today
              </span>
            ) : (
              <Button size="sm" variant="outline" onClick={onLog}>
                Log touchpoint
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? "Close" : "Write it"}
            </Button>
          </span>
        </div>
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-muted-foreground">
          {r.reasons.map((reason: string) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>
      {open && (
        <div className="space-y-3 border-t bg-muted/30 px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <AnimatedSelect
              value={pick}
              onChange={e => swap(e.target.value, lang)}
              className="h-8 rounded-md border bg-transparent px-2 text-xs"
            >
              {TEMPLATES.map((x: Any) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </AnimatedSelect>
            <Button
              size="sm"
              variant="outline"
              onClick={() => swap(pick, lang === "ar" ? "en" : "ar")}
            >
              {lang === "ar" ? "English" : "العربية"}
            </Button>
            <span className="text-muted-foreground">{t.when}</span>
          </div>
          {t.internal && (
            <p className="callout-warn rounded-lg px-3 py-2 text-xs">
              <strong>Before you send it:</strong> {t.internal}
            </p>
          )}
          <Textarea
            rows={5}
            dir="auto"
            value={text}
            onChange={e => setText(e.target.value)}
            className="text-sm"
          />
          <CopyButton text={text} label="Copy the message" />
        </div>
      )}
    </div>
  );
}

/**
 * The three sign-offs that actually end creative onboarding.
 *
 * A filled Brand DNA or cheat sheet link means the template was generated, not
 * that the work is done, so completion is read from the closed task, the
 * "Done" on Offer Creation, and a submitted Brand Blueprint form.
 * [aziz, 2026-09-08]
 */
function OnboardingSteps({
  r,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: snapshot rows are untyped
  r: any;
}) {
  const steps = r.onboardingSteps ?? [];
  if (steps.length === 0) return null;
  return (
    <ul className="space-y-1">
      {steps.map(
        (st: {
          done: boolean;
          label: string;
          note: string;
          doc: string | null;
        }) => {
          const skip =
            !r.blueprintExpected &&
            st.label === "Brand Blueprint form submitted" &&
            !st.done;
          const Icon = st.done ? Check : skip ? Minus : Circle;
          return (
            <li key={st.label} className="flex gap-2">
              <Icon
                aria-label={st.done ? "Done" : skip ? "Not needed" : "Not yet"}
                className={`mt-0.5 size-3.5 shrink-0 ${
                  st.done
                    ? "txt-good"
                    : skip
                      ? "text-muted-foreground"
                      : "txt-bad"
                }`}
              />
              <span className="min-w-0">
                {st.doc ? (
                  <a
                    href={st.doc}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    {st.label}
                  </a>
                ) : (
                  st.label
                )}
                <span className="block text-xs text-muted-foreground">
                  {st.note}
                </span>
              </span>
            </li>
          );
        },
      )}
    </ul>
  );
}

type LiveAd = {
  metaId: string;
  name: string;
  campaignName?: string;
  accountId?: string;
  thumbUrl?: string;
  stillKey?: string;
  stillUrl?: string;
  stillTinyUrl?: string;
};

/**
 * One client's live ads as saved pictures. Only rendered for the open client,
 * so the picture look-up runs for the ads on screen and nothing else.
 */
function LiveAdsStrip({ ads, client }: { ads: LiveAd[]; client: string }) {
  const stills = useLocalStills(ads.map(a => a.stillKey));
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
        <span className={KICKER}>Live ads · {ads.length}</span>
        <span className="text-xs text-muted-foreground">
          Click one to watch
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {ads.map(a => (
          <CreativePreview
            key={a.metaId}
            name={a.name}
            metaAdId={a.metaId}
            accountId={a.accountId}
            campaignName={a.campaignName}
            clientName={client}
            thumbUrl={a.thumbUrl}
            {...stillPropsFor(a, stills)}
            size="md"
          />
        ))}
      </div>
    </div>
  );
}

/** One row per client: branding, production, calendar and ad performance. */
function ClientProfiles({
  rows,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: snapshot rows are untyped
  rows: any[];
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Section
      icon={Users}
      title="Every client"
      sub="Worst first: most open, oldest, latest"
      flush
    >
      <ul className="divide-y">
        {rows.map((r: Any) => {
          const isOpen = open === r.client;
          return (
            <li key={r.client}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : r.client)}
                className={`${ROW} flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left hover:bg-muted/40`}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <ChevronRight
                    aria-hidden
                    className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                      isOpen ? "rotate-90" : ""
                    }`}
                  />
                  <span className="min-w-0 truncate font-medium">
                    {r.client}
                  </span>
                </span>
                <span className="flex basis-full flex-wrap gap-x-2 gap-y-0.5 pl-6 text-xs text-muted-foreground sm:basis-auto sm:pl-0">
                  {r.brandDnaOpen > 0 && (
                    <span className="txt-bad">Brand DNA open</span>
                  )}
                  {r.scriptsStale > 0 && (
                    <span>{r.scriptsStale} stale scripts</span>
                  )}
                  {r.videosOverdue > 0 && (
                    <span className="txt-bad">
                      {r.videosOverdue} videos late
                    </span>
                  )}
                  {r.postsLate > 0 && <span>{r.postsLate} posts late</span>}
                  {r.cpl !== undefined && <span>{money(r.cpl)} CPL</span>}
                </span>
              </button>
              {isOpen && (
                <div className="space-y-4 border-t bg-muted/30 px-4 py-4 text-sm sm:px-6">
                  <Link
                    to={`/clients/${encodeURIComponent(r.client)}`}
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  >
                    Open their page
                    <ChevronRight aria-hidden className="size-3.5" />
                  </Link>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Stat label="Creative onboarding">
                      <OnboardingSteps r={r} />
                      {r.stillMissing && (
                        <span className="mt-1 block text-muted-foreground">
                          Missing: {r.stillMissing}
                        </span>
                      )}
                    </Stat>
                    <Stat label="Performance, last 7d">
                      {r.ads > 0 ? (
                        <>
                          {r.leads} leads at {r.cpl ? money(r.cpl) : "n/a"}
                          <span className="block text-muted-foreground">
                            {r.bookings7d} booked
                            {r.showed7d === null ? (
                              <span title="Show data comes from the client reporting sheets, which are not wired in yet">
                                {" "}
                                · shows not tracked yet
                              </span>
                            ) : (
                              <>
                                {" "}
                                · {r.showed7d} showed
                                {r.showRate !== null &&
                                  ` · ${Math.round(r.showRate * 100)}% show`}
                              </>
                            )}
                          </span>
                          {r.costPerBooking !== undefined && (
                            <span className="block text-muted-foreground">
                              {money(r.costPerBooking)} per booking
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">
                          No ads on our boards
                        </span>
                      )}
                    </Stat>
                    <Stat label="Touchpoints this week">
                      {r.touchesThisWeek} of 1 to 2
                      {r.touchesThisWeek === 0 ? (
                        <span className="block txt-bad">
                          None yet this week
                        </span>
                      ) : r.touchesThisWeek === 1 ? (
                        <span className="block text-muted-foreground">
                          Floor met, a second is a bonus
                        </span>
                      ) : null}
                    </Stat>
                  </div>

                  {r.liveAds.length > 0 && (
                    <LiveAdsStrip ads={r.liveAds} client={r.client} />
                  )}

                  {r.videos.length > 0 && (
                    <div>
                      <div className={`mb-2 ${KICKER}`}>Video pipeline</div>
                      <ul className="divide-y overflow-hidden rounded-xl bg-muted/40">
                        {r.videos.map(
                          (v2: {
                            taskId: string;
                            url?: string;
                            name: string;
                            stage: string;
                            hisMove: boolean;
                            editors: string[];
                            overdueDays: number;
                          }) => (
                            <li key={v2.taskId}>
                              <a
                                href={v2.url ?? "#"}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/60"
                              >
                                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                                  <span className="min-w-0 flex-1 truncate">
                                    {v2.name}
                                    <span className="text-muted-foreground">
                                      {" "}
                                      · {v2.stage}
                                    </span>
                                  </span>
                                  <span className="basis-full text-xs text-muted-foreground sm:basis-auto">
                                    {v2.hisMove ? (
                                      <span className="txt-warn font-medium">
                                        Your move
                                      </span>
                                    ) : (
                                      v2.editors.join(", ") || "unassigned"
                                    )}
                                    {v2.overdueDays > 0 &&
                                      ` · ${v2.overdueDays}d late`}
                                  </span>
                                </span>
                                <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
                              </a>
                            </li>
                          ),
                        )}
                      </ul>
                    </div>
                  )}

                  {r.scripts.length > 0 && (
                    <div>
                      <div className={`mb-2 ${KICKER}`}>Scripts</div>
                      <ul className="divide-y overflow-hidden rounded-xl bg-muted/40">
                        {r.scripts.map(
                          (sc: {
                            taskId: string;
                            url?: string;
                            status: string;
                            ageDays: number;
                          }) => (
                            <li key={sc.taskId}>
                              <a
                                href={sc.url ?? "#"}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/60"
                              >
                                <span className="min-w-0 flex-1 truncate">
                                  {sc.status}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {sc.ageDays}d old
                                </span>
                                <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
                              </a>
                            </li>
                          ),
                        )}
                      </ul>
                    </div>
                  )}

                  {r.campaigns.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      Campaigns:{" "}
                      {r.campaigns
                        .map((c2: { campaignName: string }) => c2.campaignName)
                        .join(" · ")}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className={KICKER}>{label}</div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/** A number tile: the label, the value, and what the value leaves out. */
function Tile({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 whitespace-nowrap text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </div>
      {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

/**
 * The EOD.
 *
 * The numbers are already known from the boards, so you are not retyping them,
 * you only add what the data cannot see: what got stuck and what tomorrow looks
 * like.
 */
function EndOfDay({
  snap,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: snapshot is untyped
  snap: any;
}) {
  const save = useMutation(api.creative.saveEod);
  const addItem = useMutation(api.creative.addPlanItem);
  const removeItem = useMutation(api.creative.removePlanItem);
  const [line, setLine] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>(
    snap.eod?.answers ?? {},
  );
  const [saving, setSaving] = useState(false);

  const computed = {
    brandDnaOpen: snap.counts.brandDNA,
    scriptsOpen: snap.counts.scripts,
    scriptsStale: snap.staleScripts,
    videosOpen: snap.counts.videos,
    videosOverdue: snap.counts.overdueVideos,
    postsLate: snap.overduePosts.length,
    checksDone: snap.checks.filter((c: { done: boolean }) => c.done).length,
    checksTotal: snap.checks.length,
    touchpointsDone: snap.touchpoints.filter((t: { done: boolean }) => t.done)
      .length,
  };

  return (
    <>
      <Section
        icon={MoonStar}
        title="Today, from the boards"
        sub="Already counted"
      >
        <div className="@container">
          <div className="grid grid-cols-2 gap-4 @md:grid-cols-3">
            <Tile
              label="Checklist"
              value={`${computed.checksDone}/${computed.checksTotal}`}
              sub="done"
            />
            <Tile
              label="Touchpoints"
              value={computed.touchpointsDone}
              sub="sent"
            />
            <Tile label="Brand DNA open" value={computed.brandDnaOpen} />
            <Tile
              label="Scripts open"
              value={computed.scriptsOpen}
              sub={`${computed.scriptsStale} stale`}
            />
            <Tile label="Videos late" value={computed.videosOverdue} />
            <Tile label="Posts past date" value={computed.postsLate} />
          </div>
        </div>
      </Section>

      <Section
        icon={ListChecks}
        title="Tomorrow"
        sub="Write it now, while it is fresh"
      >
        <div className="flex gap-2">
          <Input
            className="min-w-0 flex-1"
            placeholder="One thing you will finish tomorrow…"
            value={line}
            onChange={e => setLine(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && line.trim().length > 2) {
                void addItem({ text: line });
                setLine("");
              }
            }}
          />
          <Button
            variant="outline"
            onClick={() => {
              if (line.trim().length > 2) {
                void addItem({ text: line });
                setLine("");
              }
            }}
          >
            Add
          </Button>
        </div>
        {snap.plan.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Nothing written yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y rounded-xl bg-muted/40">
            {snap.plan.map((p: { _id: string; text: string }) => (
              <li
                key={p._id}
                className="flex items-center justify-between gap-3 py-1 pr-1 pl-3 text-sm"
              >
                <span className="min-w-0">{p.text}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0 text-muted-foreground"
                  // biome-ignore lint/suspicious/noExplicitAny: Convex id
                  onClick={() => void removeItem({ id: p._id as any })}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        icon={PenLine}
        title="Your EOD"
        sub="Saved in the cockpit only: it does not reach the EOD sheet yet, so still submit the EOD form"
      >
        <div className="space-y-4">
          {EOD_QUESTIONS.map((q: Any) => (
            <div key={q.key}>
              <span className="text-sm font-medium">{q.label}</span>
              {q.choices ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {q.choices.map((ch: Any) => {
                    const on = answers[q.key] === ch;
                    return (
                      <button
                        key={ch}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setAnswers({ ...answers, [q.key]: ch })}
                        className={`no-touch relative h-8 rounded-full px-3 text-xs font-medium transition-colors after:absolute after:inset-x-0 after:-inset-y-1 after:content-[''] ${
                          on
                            ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40"
                            : "border text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        {ch}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <Textarea
                  aria-label={q.label}
                  className="mt-2 min-h-0 text-sm"
                  rows={2}
                  value={answers[q.key] ?? ""}
                  onChange={e =>
                    setAnswers({ ...answers, [q.key]: e.target.value })
                  }
                />
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await save({ answers, computed });
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving
                ? "Saving…"
                : snap.eod
                  ? "Update the draft"
                  : "Save a draft"}
            </Button>
            {snap.eod && (
              <p className="text-xs text-muted-foreground">
                Draft saved at {new Date(snap.eod.at).toLocaleTimeString()}. The
                EOD form is still the record.
              </p>
            )}
          </div>
        </div>
      </Section>
    </>
  );
}

/**
 * His EOD, question for question from the Creative Director — EOD Form.
 *
 * Kept identical on purpose: it feeds the same sheet the rest of the team's
 * EODs land in, so a second wording would create a second source of truth.
 * [aziz, 2026-09-06] The answers are keyed by `key`, so the labels only show.
 */
const EOD_QUESTIONS: { key: string; label: string; choices?: string[] }[] = [
  { key: "scripts", label: "Scripts completed today (count + client/title)" },
  { key: "briefed", label: "Videos briefed to editors today" },
  {
    key: "feedbackLogged",
    label: "Client adjustments: all feedback received & logged?",
    choices: ["Yes", "No", "N/A"],
  },
  {
    key: "clientsReplied",
    label: "Client adjustments: all clients replied to?",
    choices: ["Yes", "No", "N/A"],
  },
  {
    key: "adjustmentsSent",
    label: "Client adjustments: all adjustments sent to editors?",
    choices: ["Yes", "No", "N/A"],
  },
  { key: "ideas", label: "New content ideas" },
  { key: "blockers", label: "Blockers / decisions needed from Aziz" },
  { key: "priorities", label: "Tomorrow's top 3 priorities" },
  { key: "summary", label: "Day summary" },
];

/**
 * The pipeline as stages, not a flat list.
 *
 * The point is the handoff: anything in "client review" is yours to send to the
 * client, and once they pass it you move it on and tell the media buyer.
 * Those are highlighted because they are where work silently stops.
 */
function VideoPipeline({
  snap,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: snapshot is untyped
  snap: any;
}) {
  const stages = snap.videoStages.filter(
    (st: { count: number }) => st.count > 0,
  );
  const mine = snap.videoJobs.filter((j: { hisMove: boolean }) => j.hisMove);

  return (
    <Section
      icon={Film}
      title="Video pipeline"
      sub={
        snap.awaitingHisMove > 0
          ? `${snap.awaitingHisMove} waiting on you`
          : "Nothing waiting on you"
      }
    >
      {stages.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing open in the pipeline.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {stages.map((st: { stage: string; count: number }) => (
            <span
              key={st.stage}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs"
            >
              {st.stage}
              <strong className="font-semibold tabular-nums">{st.count}</strong>
            </span>
          ))}
        </div>
      )}
      {mine.length > 0 && (
        <ul className="-mx-4 -mb-4 mt-4 divide-y border-t sm:-mx-6 sm:-mb-6">
          {mine.map(
            (j: {
              taskId: string;
              url?: string;
              name: string;
              stage: string;
              client?: string;
              editors: string[];
            }) => (
              <li key={j.taskId}>
                <a
                  href={j.url ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className={`${ROW} flex items-center gap-3 hover:bg-muted/40`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <StatusChip icon={Film} tone="txt-warn">
                        {j.stage}
                      </StatusChip>
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {j.client ?? j.name}
                      </span>
                      <span className="basis-full text-xs text-muted-foreground sm:basis-auto">
                        {j.editors.join(", ") || "unassigned"}
                      </span>
                    </span>
                    {j.stage === "client review" && (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        Send it to the client. When they pass it, move the stage
                        and tell the media buyer.
                      </span>
                    )}
                  </span>
                  <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
                </a>
              </li>
            ),
          )}
        </ul>
      )}
    </Section>
  );
}
