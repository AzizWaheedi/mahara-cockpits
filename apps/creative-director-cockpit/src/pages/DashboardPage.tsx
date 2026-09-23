import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  Dna,
  Film,
  ListChecks,
  MessageSquare,
  MoonStar,
  PenLine,
  Rocket,
  Trophy,
  Users,
} from "lucide-react";
import { useState } from "react";
import {
  CreativePreview,
  stillPropsFor,
  useLocalStills,
} from "@/components/CreativePreview";
import { SendForReview } from "@/components/SendForReview";
import { TemplateCard } from "@/components/TemplateCard";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
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

function Section({
  icon: Icon,
  title,
  sub,
  children,
}: {
  icon: React.ElementType;
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-baseline gap-2">
        <Icon className="h-4 w-4 shrink-0 translate-y-0.5 text-muted-foreground" />
        <h2 className="text-[15px] font-bold tracking-tight">{title}</h2>
        {sub && (
          <span className="text-[13px] text-muted-foreground">{sub}</span>
        )}
      </div>
      {children}
    </section>
  );
}

type View = "sod" | "work" | "touch" | "eod" | "works" | "clients";

const TITLES: Record<View, { title: string; sub: string }> = {
  sod: {
    title: "Start of day",
    sub: "Clear communication first, then get into the work",
  },
  work: {
    title: "Middle of the day",
    sub: "Brand DNA, scripts, the video pipeline and the calendar",
  },
  touch: {
    title: "Client touchpoints",
    sub: "One proactive message per client, drafted from what changed, with the SOP templates on the row",
  },
  clients: {
    title: "Clients",
    sub: "The creative picture for one client, end to end",
  },
  works: {
    title: "What works",
    sub: "What to make more of, and what is burning out",
  },
  eod: {
    title: "End of day",
    sub: "Your EOD report, already written from today's work",
  },
};

export function DashboardPage() {
  return <Creative view="sod" />;
}
export function WorkPage() {
  return <Creative view="work" />;
}
export function TouchpointsPage() {
  return <Creative view="touch" />;
}
export function ClientsPage() {
  return <Creative view="clients" />;
}
export function CreativeEodPage() {
  return <Creative view="eod" />;
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
      <p className="mb-3 text-[12px] text-muted-foreground">
        Everything on this board synced{" "}
        {age === 0 ? "just now" : `${age} min ago`}. Refreshes {f.cadence}.
      </p>
    );
  }
  return (
    <div className="callout-warn mb-3 rounded-md border px-3 py-2 text-[13px]">
      <strong>Some of this is stale.</strong> {f.stale.join(", ")} should
      refresh every {f.expectedEveryMin} minutes right now and have not, so
      treat those numbers as old and tell Aziz, or ask Hermes in the chat.
    </div>
  );
}

function Creative({ view }: { view: View }) {
  const snap = useQuery(api.creative.snapshot, {}) as Any;
  const [showAllBrand, setShowAllBrand] = useState(false);

  if (snap === undefined) {
    return (
      <div className="p-6 text-[14px] text-muted-foreground">Loading…</div>
    );
  }

  const c = snap.counts;
  // Start of day shows only the rows still missing a doc; the rest are
  // housekeeping and sit behind "Show all". [aziz, 2026-09-10]
  const brandOpen = snap.brandDNA.filter(
    (b: { docOnFile?: boolean }) => !b.docOnFile,
  );
  const brandShown = showAllBrand ? snap.brandDNA : brandOpen.slice(0, 8);

  return (
    <div className="mx-auto max-w-5xl p-4 pb-16">
      <header className="mb-5">
        <h1 className="text-[19px] font-bold tracking-tight">
          {TITLES[view].title}
        </h1>
        <p className="text-[13px] text-muted-foreground">{TITLES[view].sub}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {c.brandDNA} brand DNA missing · {c.scripts} scripts open ·{" "}
          {c.overdueVideos} video{c.overdueVideos === 1 ? "" : "s"} late
        </p>
      </header>

      <SyncHealth />

      {/* What clients said on WhatsApp, with the reply already drafted.
          At the top of the day's screen because an unanswered client is
          the most expensive thing on it. */}
      {view === "sod" && (
        <div className="mb-5">
          <WhatsAppDesk desk="creative" />
        </div>
      )}

      {/* Sending a cut out sits next to answering clients, because they
          are the same job: the reply is usually "here it is". */}
      {view === "sod" && (
        <div className="mb-5">
          <SendForReview />
        </div>
      )}

      {(view === "sod" || view === "work") && (
        <Checklist
          phase={view === "sod" ? "sod" : "mid"}
          checks={snap.checks}
        />
      )}
      {view === "touch" && (
        <>
          <Section
            icon={MessageSquare}
            title="The rule"
            sub="creative director floor, lighter than the CSM's"
          >
            <p className="text-[13px]">
              <strong>
                1 to 2 messages a week in the client's group per active client.
              </strong>{" "}
              A touchpoint gives them something, a script going out, a video to
              review, a creative refresh, an answer. "Just checking in" does not
              count, and a real concern gets a call, not a text.
            </p>
            <a
              href="https://docs.google.com/document/d/10wQorQfSebiX3Lmh0jXkEUkp3I_xMP68p4b1q-oUxcY/edit"
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-[13px] underline underline-offset-2"
            >
              Open the client communication SOP
            </a>
          </Section>
          <Touchpoints rows={snap.touchpoints} />
          <AllTemplates roster={snap.clients} />
        </>
      )}
      {view === "clients" && <ClientProfiles rows={snap.clients} />}
      {view === "eod" && <EndOfDay snap={snap} />}

      {/* 1. What is late right now. */}
      {view === "sod" && (
        <>
          {(c.overdueVideos > 0 || snap.overduePosts.length > 0) && (
            <Section
              icon={AlertTriangle}
              title="Late and blocking a client"
              sub="deal with these first"
            >
              <div className="space-y-1.5">
                {snap.videoJobs
                  .filter((j: Any) => j.overdueDays > 0)
                  .map((j: Any) => (
                    <a
                      key={j.taskId}
                      href={j.url ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="callout-bad flex items-center justify-between rounded-lg border p-2.5 text-[13px] hover:opacity-90"
                    >
                      <span>
                        <strong>{j.overdueDays}d late</strong> ·{" "}
                        {j.unidentified ? (
                          <span className="italic">
                            untitled video request — no client on the task
                          </span>
                        ) : (
                          j.name
                        )}
                        <span className="text-muted-foreground">
                          {" "}
                          · {j.status}
                        </span>
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {j.editors.join(", ") || "unassigned"}
                      </span>
                    </a>
                  ))}
                {snap.overduePosts.slice(0, 4).map((p: Any) => (
                  <a
                    key={p.taskId}
                    href={p.url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="callout-warn flex items-center justify-between rounded-lg border p-2.5 text-[13px] hover:opacity-90"
                  >
                    <span>
                      <strong>{p.lateDays}d late</strong> · {p.name}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {p.client ?? "—"}
                    </span>
                  </a>
                ))}
                {snap.overduePosts.length > 4 && (
                  <p className="pl-1 text-[12px] text-muted-foreground">
                    + {snap.overduePosts.length - 4} more unpublished posts past
                    their date.
                  </p>
                )}
              </div>
            </Section>
          )}
        </>
      )}

      {/* 2. Brand DNA. Mostly already written, so the board rows are noise. */}
      {view === "work" && (
        <>
          {/* The middle of the day is scripting, so the calendar leads it and
              everything you write from sits one line below. [aziz, 2026-09-08] */}
          <ScriptingCalendar compact />
          <Section
            icon={Dna}
            title="Brand DNA board rows"
            sub="the doc is what counts, not the task. Rows marked done are already written and can be closed"
          >
            <div className="space-y-1.5">
              {brandShown.map((b: Any) => (
                <a
                  key={b.taskId}
                  href={b.url ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-lg border p-2.5 text-[13px] hover:bg-accent"
                >
                  <span className="font-medium">
                    {b.client}
                    {b.docOnFile && (
                      <span className="tone-good ml-1.5 rounded px-1 py-0.5 text-[11px] font-semibold">
                        doc on file
                        {b.matchedTo && b.matchedTo !== b.client
                          ? ` under "${b.matchedTo}"`
                          : ""}
                        , close the task
                      </span>
                    )}
                    {b.duplicate && (
                      <span className="tone-warn ml-1.5 rounded px-1 py-0.5 text-[11px] font-semibold">
                        duplicate task
                      </span>
                    )}
                  </span>
                  <span
                    className={
                      !b.docOnFile && b.ageDays >= 21
                        ? "txt-bad shrink-0 font-semibold"
                        : "shrink-0 text-muted-foreground"
                    }
                  >
                    {b.docOnFile
                      ? `open ${b.ageDays}d`
                      : `waiting ${b.ageDays}d`}
                  </span>
                </a>
              ))}
            </div>
            {snap.brandDNA.length > brandShown.length && (
              <Button
                size="sm"
                variant="ghost"
                className="mt-1.5 h-7 text-[12px]"
                onClick={() => setShowAllBrand(!showAllBrand)}
              >
                {showAllBrand
                  ? "Show fewer"
                  : `Show all ${snap.brandDNA.length}`}
              </Button>
            )}
          </Section>
        </>
      )}

      {/* 3. Onboarding: the one parent task per client. Aziz, 2026-09-10:
          "just the main task, not the subtasks below it." */}
      {view === "work" && snap.journeys.length > 0 && (
        <Section
          icon={Rocket}
          title="Clients in creative onboarding"
          sub="one task per client, open it in ClickUp for the steps"
        >
          <div className="divide-y rounded-lg border">
            {snap.journeys.map((j: Any) => (
              <a
                key={j.taskId}
                href={j.url ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between p-2.5 text-[13px] hover:bg-muted/40"
              >
                <span className="font-medium">{j.client}</span>
                <span className="text-muted-foreground">
                  {j.status} · day {j.ageDays}
                </span>
              </a>
            ))}
          </div>
        </Section>
      )}

      {/* 4. Script requests. */}
      {view === "work" && (
        <>
          <Section
            icon={PenLine}
            title="Script requests"
            sub={`${snap.staleScripts} sitting 3+ days`}
          >
            <div className="space-y-1.5">
              {snap.scripts.slice(0, 8).map((s: Any) => (
                <a
                  key={s.taskId}
                  href={s.url ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-lg border p-2.5 text-[13px] hover:bg-accent"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {s.client ?? (
                        <span className="italic text-muted-foreground">
                          no client on this task
                        </span>
                      )}
                    </span>
                    <span
                      className={
                        s.ageDays >= 7
                          ? "txt-bad shrink-0 font-semibold"
                          : "shrink-0 text-muted-foreground"
                      }
                    >
                      {s.ageDays}d old · {s.status}
                    </span>
                  </div>
                  {s.notes && (
                    <p className="mt-0.5 line-clamp-1 text-[12px] text-muted-foreground">
                      {s.notes}
                    </p>
                  )}
                </a>
              ))}
            </div>
          </Section>
        </>
      )}

      {view === "work" && <VideoPipeline snap={snap} />}

      {/* 5. Editors. */}
      {view === "work" && (
        <>
          <Section icon={Film} title="Editors" sub="who owes what">
            <div className="space-y-1.5">
              {snap.editors.length === 0 && (
                <p className="text-[13px] text-muted-foreground">
                  Nothing open in the video pipeline.
                </p>
              )}
              {snap.editors.map((e: Any) => (
                <div
                  key={e.editor}
                  className="flex items-center justify-between rounded-lg border p-2.5 text-[13px]"
                >
                  <span className="font-medium">{e.editor}</span>
                  <span className="text-muted-foreground">
                    {e.open} open
                    {e.overdue > 0 && (
                      <span className="txt-bad ml-1.5 font-semibold">
                        {e.overdue} late
                      </span>
                    )}
                    <span className="ml-1.5">· next {days(e.nextDue)}</span>
                  </span>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}

      {/* 6. Social coverage. */}
      {view === "work" && (
        <>
          <Section
            icon={CalendarDays}
            title="Social calendar"
            sub={`${snap.plannedAhead} posts scheduled ahead`}
          >
            {/* The ClickUp content list holds no real posts yet, so an
                "everyone is uncovered" warning would be noise, not signal.
                [aziz, 2026-09-08] */}
            {snap.plannedAhead === 0 && snap.overduePosts.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                Nothing is on the content calendar list in ClickUp yet, so there
                is nothing to show. Social posts appear here the moment real
                ones are added to the board.
              </p>
            ) : snap.uncovered.length > 0 ? (
              <div className="callout-warn rounded-lg border p-2.5 text-[13px]">
                <strong>
                  {snap.uncovered.length} client
                  {snap.uncovered.length === 1 ? "" : "s"} with nothing
                  scheduled from today:
                </strong>{" "}
                {snap.uncovered.map((u: Any) => u.client).join(", ")}. A paying
                social client with an empty calendar is a churn risk before they
                ever complain.
              </div>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                Every client on the calendar has upcoming posts.
              </p>
            )}
          </Section>
        </>
      )}

      {/* 7. What the numbers say. */}
      {view === "works" && (
        <>
          <Section
            icon={Trophy}
            title="What to make more of"
            sub="from the live ad accounts"
          >
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <h3 className="mb-1.5 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Winning creatives
                </h3>
                <div className="space-y-1.5">
                  {snap.winners.length === 0 && (
                    <p className="text-[13px] text-muted-foreground">
                      No ad has enough spend yet to call a winner.
                    </p>
                  )}
                  {snap.winners.map((w: Any, i: Any) => (
                    <div
                      key={i}
                      className="rounded-lg border p-2 text-[13px] callout-good"
                    >
                      <div className="font-medium">{w.client}</div>
                      <div className="text-muted-foreground">
                        {w.adName} · {money(w.cpl)} CPL · {w.leads} leads
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="mb-1.5 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Frequency watch
                </h3>
                {!snap.anyBurning && (
                  <p className="mb-1.5 text-[13px] text-muted-foreground">
                    Nothing is fatiguing — the highest frequency in the accounts
                    is {snap.fatiguing[0]?.frequency.toFixed(1) ?? "—"}, well
                    under the {snap.fatigueGate} gate. No replacements needed
                    today.
                  </p>
                )}
                <div className="space-y-1.5">
                  {snap.fatiguing.slice(0, 5).map((f: Any, i: Any) => (
                    <div
                      key={i}
                      className={`rounded-lg border p-2 text-[13px] ${
                        f.burning ? "callout-bad" : ""
                      }`}
                    >
                      <div className="flex justify-between">
                        <span className="font-medium">{f.client}</span>
                        <span className="text-muted-foreground">
                          freq {f.frequency.toFixed(2)}
                        </span>
                      </div>
                      <div className="text-muted-foreground">{f.adName}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Section>
        </>
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
    >
      <div className="space-y-1.5">
        {rows.map((c: Any) => (
          <button
            type="button"
            key={c.key}
            onClick={() => void toggle({ key: c.key, done: !c.done })}
            className={`flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left text-[13px] transition hover:bg-muted/50 ${
              c.done ? "opacity-55" : ""
            }`}
          >
            <span
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                c.done ? "bg-primary text-primary-foreground" : ""
              }`}
            >
              {c.done && <Check className="h-3 w-3" />}
            </span>
            <span>
              <span className={`font-semibold ${c.done ? "line-through" : ""}`}>
                {c.label}
              </span>
              {c.detail && (
                <span className="block text-muted-foreground">{c.detail}</span>
              )}
            </span>
          </button>
        ))}
      </div>
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
        <p className="text-[13px] text-muted-foreground">
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
    >
      <div className="space-y-2">
        {rows.map((r: Any) => (
          <TouchpointRow
            key={r.client}
            r={r}
            onLog={() => void log({ client: r.client })}
          />
        ))}
      </div>
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
      sub="for a message that is not on the list above"
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-[13px] underline underline-offset-2"
      >
        {open ? "Hide the library" : `Show all ${TEMPLATES.length} templates`}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-muted-foreground">Writing to</span>
            <AnimatedSelect
              value={client}
              onChange={e => setClient(e.target.value)}
              className="rounded border bg-transparent px-2 py-1 text-[13px]"
            >
              <option value="">nobody in particular</option>
              {names.map((n: Any) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </AnimatedSelect>
          </div>
          {TEMPLATES.map((t: Any) => (
            <TemplateCard key={t.id} t={t} client={client || undefined} />
          ))}
          <p className="text-[12px] text-muted-foreground">
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
    <div
      className={`rounded-lg border text-[13px] ${r.done ? "opacity-55" : ""}`}
    >
      <div className="p-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <strong>{r.client}</strong>
          <span className="flex items-center gap-2">
            {r.done ? (
              <span className="text-[12px] text-muted-foreground">
                messaged today
              </span>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[12px]"
                onClick={onLog}
              >
                Mark as messaged
              </Button>
            )}
            <button
              type="button"
              onClick={() => setOpen(!open)}
              className="rounded border px-1.5 py-0.5 text-[12px] text-muted-foreground hover:bg-muted"
            >
              {open ? "close" : "write it"}
            </button>
          </span>
        </div>
        <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
          {r.reasons.map((reason: string) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>
      {open && (
        <div className="space-y-2 border-t p-3">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <AnimatedSelect
              value={pick}
              onChange={e => swap(e.target.value, lang)}
              className="rounded border bg-transparent px-2 py-1 text-[12px]"
            >
              {TEMPLATES.map((x: Any) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </AnimatedSelect>
            <button
              type="button"
              onClick={() => swap(pick, lang === "ar" ? "en" : "ar")}
              className="rounded border px-1.5 py-0.5 text-muted-foreground hover:bg-muted"
            >
              {lang === "ar" ? "English" : "العربية"}
            </button>
            <span className="text-muted-foreground">{t.when}</span>
          </div>
          {t.internal && (
            <p className="callout-warn rounded px-2 py-1 text-[12px]">
              <strong>Before you send it:</strong> {t.internal}
            </p>
          )}
          <Textarea
            rows={5}
            dir="auto"
            value={text}
            onChange={e => setText(e.target.value)}
            className="text-[13px]"
          />
          <div className="flex flex-wrap gap-2">
            <CopyButton text={text} label="Copy the message" />
            {!r.done && (
              <Button
                size="sm"
                variant="secondary"
                className="h-7 text-[12px]"
                onClick={onLog}
              >
                Sent it, log the touchpoint
              </Button>
            )}
          </div>
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
    <ul className="space-y-0.5">
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
          return (
            <li key={st.label} className="flex gap-1.5">
              <span
                className={
                  st.done
                    ? "txt-good"
                    : skip
                      ? "text-muted-foreground"
                      : "txt-bad"
                }
              >
                {st.done ? "✓" : skip ? "–" : "○"}
              </span>
              <span>
                {st.doc ? (
                  <a
                    href={st.doc}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    {st.label}
                  </a>
                ) : (
                  st.label
                )}
                <span className="block text-[12px] text-muted-foreground">
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
      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        Live ads ({ads.length}), click one to watch
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
      sub="worst first — most open, oldest, latest"
    >
      <div className="space-y-1.5">
        {rows.map((r: Any) => (
          <div key={r.client} className="rounded-lg border">
            <button
              type="button"
              onClick={() => setOpen(open === r.client ? null : r.client)}
              className="flex w-full items-center justify-between gap-2 p-2.5 text-left text-[13px] hover:bg-muted/50"
            >
              <strong>{r.client}</strong>
              <span className="flex shrink-0 gap-2 text-[12px] text-muted-foreground">
                {r.brandDnaOpen > 0 && (
                  <span className="txt-bad">brand DNA open</span>
                )}
                {r.scriptsStale > 0 && (
                  <span>{r.scriptsStale} stale scripts</span>
                )}
                {r.videosOverdue > 0 && (
                  <span className="txt-bad">{r.videosOverdue} videos late</span>
                )}
                {r.postsLate > 0 && <span>{r.postsLate} posts late</span>}
                {r.cpl !== undefined && <span>{money(r.cpl)} CPL</span>}
              </span>
            </button>
            {open === r.client && (
              <div className="space-y-3 border-t p-3 text-[13px]">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Stat label="Creative onboarding">
                    <OnboardingSteps r={r} />
                    {r.stillMissing && (
                      <span className="block text-muted-foreground">
                        Missing: {r.stillMissing}
                      </span>
                    )}
                  </Stat>
                  <Stat label="Performance, last 7d">
                    {r.ads > 0 ? (
                      <>
                        {r.leads} leads at {r.cpl ? money(r.cpl) : "—"}
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
                        no ads on our boards
                      </span>
                    )}
                  </Stat>
                  <Stat label="Touchpoints this week">
                    {r.touchesThisWeek} of 1 to 2
                    {r.touchesThisWeek === 0 ? (
                      <span className="block txt-bad">none yet this week</span>
                    ) : r.touchesThisWeek === 1 ? (
                      <span className="block text-muted-foreground">
                        floor met, a second is a bonus
                      </span>
                    ) : null}
                  </Stat>
                </div>

                {r.liveAds.length > 0 && (
                  <LiveAdsStrip ads={r.liveAds} client={r.client} />
                )}

                {r.videos.length > 0 && (
                  <div>
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      Video pipeline
                    </div>
                    <div className="space-y-1">
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
                          <a
                            key={v2.taskId}
                            href={v2.url ?? "#"}
                            target="_blank"
                            rel="noreferrer"
                            className={`flex items-center justify-between gap-2 rounded border p-2 hover:bg-muted/50 ${
                              v2.hisMove ? "callout-warn" : ""
                            }`}
                          >
                            <span>
                              {v2.name}
                              <span className="text-muted-foreground">
                                {" "}
                                · {v2.stage}
                              </span>
                            </span>
                            <span className="shrink-0 text-[12px] text-muted-foreground">
                              {v2.hisMove
                                ? "your move"
                                : v2.editors.join(", ") || "unassigned"}
                              {v2.overdueDays > 0 &&
                                ` · ${v2.overdueDays}d late`}
                            </span>
                          </a>
                        ),
                      )}
                    </div>
                  </div>
                )}

                {r.scripts.length > 0 && (
                  <div>
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      Scripts
                    </div>
                    <div className="space-y-1">
                      {r.scripts.map(
                        (sc: {
                          taskId: string;
                          url?: string;
                          status: string;
                          ageDays: number;
                        }) => (
                          <a
                            key={sc.taskId}
                            href={sc.url ?? "#"}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center justify-between rounded border p-2 hover:bg-muted/50"
                          >
                            <span>{sc.status}</span>
                            <span className="text-[12px] text-muted-foreground">
                              {sc.ageDays}d old
                            </span>
                          </a>
                        ),
                      )}
                    </div>
                  </div>
                )}

                {r.campaigns.length > 0 && (
                  <div className="text-[12px] text-muted-foreground">
                    Campaigns:{" "}
                    {r.campaigns
                      .map((c2: { campaignName: string }) => c2.campaignName)
                      .join(" · ")}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
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
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div>{children}</div>
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
        sub="already counted"
      >
        <div className="grid gap-2 text-[13px] sm:grid-cols-3">
          <Stat label="Checklist">
            {computed.checksDone}/{computed.checksTotal} done
          </Stat>
          <Stat label="Touchpoints">{computed.touchpointsDone} sent</Stat>
          <Stat label="Brand DNA still open">{computed.brandDnaOpen}</Stat>
          <Stat label="Scripts open">
            {computed.scriptsOpen} ({computed.scriptsStale} stale)
          </Stat>
          <Stat label="Videos late">{computed.videosOverdue}</Stat>
          <Stat label="Posts past date">{computed.postsLate}</Stat>
        </div>
      </Section>

      <Section
        icon={ListChecks}
        title="Tomorrow"
        sub="write it now, while it is fresh"
      >
        <div className="mb-2 flex gap-1.5">
          <input
            className="flex-1 rounded border bg-background p-1.5 text-[13px]"
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
            size="sm"
            variant="outline"
            className="h-8 text-[12px]"
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
        <div className="space-y-1">
          {snap.plan.map((p: { _id: string; text: string }) => (
            <div
              key={p._id}
              className="flex items-center justify-between rounded border p-2 text-[13px]"
            >
              <span>{p.text}</span>
              <button
                type="button"
                className="text-[12px] text-muted-foreground hover:text-foreground"
                // biome-ignore lint/suspicious/noExplicitAny: Convex id
                onClick={() => void removeItem({ id: p._id as any })}
              >
                remove
              </button>
            </div>
          ))}
          {snap.plan.length === 0 && (
            <p className="text-[13px] text-muted-foreground">
              Nothing written yet.
            </p>
          )}
        </div>
      </Section>

      <Section
        icon={PenLine}
        title="Your EOD"
        sub="saved in the cockpit only: it does not reach the EOD sheet yet, so still submit the EOD form"
      >
        <div className="space-y-2">
          {EOD_QUESTIONS.map((q: Any) => (
            <div key={q.key} className="block">
              <span className="text-[12px] font-semibold">{q.label}</span>
              {q.choices ? (
                <div className="mt-1 flex gap-1.5">
                  {q.choices.map((ch: Any) => (
                    <Button
                      key={ch}
                      size="sm"
                      variant={answers[q.key] === ch ? "default" : "outline"}
                      className="h-7 px-2 text-[12px]"
                      onClick={() => setAnswers({ ...answers, [q.key]: ch })}
                    >
                      {ch}
                    </Button>
                  ))}
                </div>
              ) : (
                <textarea
                  aria-label={q.label}
                  className="mt-1 w-full rounded border bg-background p-2 text-[13px]"
                  rows={2}
                  value={answers[q.key] ?? ""}
                  onChange={e =>
                    setAnswers({ ...answers, [q.key]: e.target.value })
                  }
                />
              )}
            </div>
          ))}
          <Button
            size="sm"
            className="h-8 text-[12px]"
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
            <p className="text-[12px] text-muted-foreground">
              Draft saved at {new Date(snap.eod.at).toLocaleTimeString()}. The
              EOD form is still the record.
            </p>
          )}
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
 * [aziz, 2026-09-06]
 */
const EOD_QUESTIONS: { key: string; label: string; choices?: string[] }[] = [
  { key: "scripts", label: "Scripts completed today (count + client/title)" },
  { key: "briefed", label: "Videos briefed to editors today" },
  {
    key: "feedbackLogged",
    label: "Client adjustments — all feedback received & logged?",
    choices: ["Yes", "No", "N/A"],
  },
  {
    key: "clientsReplied",
    label: "Client adjustments — all clients replied to?",
    choices: ["Yes", "No", "N/A"],
  },
  {
    key: "adjustmentsSent",
    label: "Client adjustments — all adjustments sent to editors?",
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

  return (
    <Section
      icon={Film}
      title="Video pipeline"
      sub={
        snap.awaitingHisMove > 0
          ? `${snap.awaitingHisMove} waiting on you`
          : "nothing waiting on you"
      }
    >
      {stages.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Nothing open in the pipeline.
        </p>
      ) : (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {stages.map((st: { stage: string; count: number }) => (
            <span
              key={st.stage}
              className="rounded border px-2 py-1 text-[12px]"
            >
              {st.stage} · <strong>{st.count}</strong>
            </span>
          ))}
        </div>
      )}
      <div className="space-y-1.5">
        {snap.videoJobs
          .filter((j: { hisMove: boolean }) => j.hisMove)
          .map(
            (j: {
              taskId: string;
              url?: string;
              name: string;
              stage: string;
              client?: string;
              editors: string[];
            }) => (
              <a
                key={j.taskId}
                href={j.url ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="callout-warn flex items-center justify-between rounded-lg border p-2.5 text-[13px] hover:opacity-90"
              >
                <span>
                  <strong>{j.stage}</strong> · {j.client ?? j.name}
                  {j.stage === "client review" && (
                    <span className="block text-muted-foreground">
                      Send it to the client. When they pass it, move the stage
                      and tell the media buyer.
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {j.editors.join(", ") || "unassigned"}
                </span>
              </a>
            ),
          )}
      </div>
    </Section>
  );
}
