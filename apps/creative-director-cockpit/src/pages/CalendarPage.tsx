import { useMutation, useQuery } from "convex/react";
import {
  ArrowUpRight,
  CalendarDays,
  FolderOpen,
  Plus,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { api } from "@/../convex/_generated/api";
import { PageHeader } from "@/components/PageHeader";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * The scripting calendar.
 *
 * Aziz, 2026-09-08: one screen that answers "what am I writing today", and a
 * place to book proactive scripts for a client into a specific day instead of
 * keeping it in your head.
 *
 * Every card is a real ClickUp task with a real due date. Planning a script
 * creates the task on the creative board, and moving a card writes the due date
 * back, so the board and this screen can never disagree. Friday is off, so it
 * is greyed out rather than hidden.
 */

const KIND_LABEL: Record<string, string> = {
  script: "Script",
  video: "Video",
  post: "Post",
  brandDNA: "Brand DNA",
  onboarding: "Onboarding",
};

/** The small uppercase label: 11px mono is the floor for any label here. */
const LABEL = "font-mono text-[11px] uppercase tracking-[0.08em]";

/** A card around a group of the calendar's own parts. */
const CARD = "rounded-2xl border bg-card p-4 sm:p-6";

function KindLabel({ kind }: { kind: string }) {
  return (
    <span className={`${LABEL} text-muted-foreground`}>
      {KIND_LABEL[kind] ?? kind}
    </span>
  );
}

/** A card's title row: icon, title, one short muted note. */
function CardHead({
  icon: Icon,
  title,
  sub,
}: {
  icon: React.ElementType;
  title: string;
  sub?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <Icon className="size-4 shrink-0 translate-y-0.5 text-muted-foreground" />
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {sub ? (
        <span className="text-xs text-muted-foreground">{sub}</span>
      ) : null}
    </div>
  );
}

function todayKey(): string {
  return new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
}

// biome-ignore lint/suspicious/noExplicitAny: query payload is untyped
function Card({ it, onMove }: { it: any; onMove: (id: string) => void }) {
  return (
    <div
      className={`rounded-lg bg-muted/50 px-2 py-1.5 text-xs leading-snug ${
        it.open ? "" : "opacity-55"
      }`}
    >
      <div className="flex items-center gap-2">
        <KindLabel kind={it.kind} />
        {it.overdue && <span className={`${LABEL} txt-bad`}>Late</span>}
      </div>
      <div className="mt-0.5 font-medium">{it.client ?? "No client tag"}</div>
      <div className="text-muted-foreground">{it.title}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        <span>{it.status}</span>
        {it.url && (
          <a
            href={it.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-primary hover:underline"
          >
            Open
            <ArrowUpRight className="size-3" />
          </a>
        )}
        {it.canSchedule && (
          <button
            type="button"
            className="no-touch relative text-primary after:absolute after:-inset-2 after:content-[''] hover:underline"
            onClick={() => onMove(it.taskId)}
          >
            Move
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The calendar is the spine of the middle of the day, so it renders inside the
 * "Middle of the day" screen rather than on a tab of its own. Aziz, 2026-09-08:
 * the middle of the day IS scripting, the database and the funnels.
 */
/**
 * What to script next.
 *
 * Aziz, 2026-09-08: scripting is not only ads. It is landing pages, the
 * questions on the lead form, VSLs and thank you pages. Every row here is
 * triggered by something real and says what it is reacting to, so it can be
 * argued with instead of trusted blindly.
 */
function QueueRow({
  r,
  onPlan,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: query payload is untyped
  r: any;
  onPlan: (client: string, title: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 text-sm sm:px-6">
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          className={`${LABEL} ${r.priority === 1 ? "txt-bad" : "text-muted-foreground"}`}
        >
          {r.type}
        </span>
        <Link
          to={`/clients/${encodeURIComponent(r.client)}`}
          className="font-medium text-primary hover:underline"
          dir="auto"
        >
          {r.client}
        </Link>
        <span>{r.why}.</span>
        <span className="text-xs text-muted-foreground">{r.evidence}</span>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0"
        onClick={() => onPlan(r.client, r.suggestedTitle)}
      >
        Plan it
      </Button>
    </div>
  );
}

/**
 * What to script next.
 *
 * The main list is deliberately only the writing that always has to happen:
 * ad creative and launch scripts. Aziz, 2026-09-08: funnel questions, landing
 * pages, thank you pages and VSLs are only written when a client is actually
 * being switched onto them, so they sit folded away underneath instead of
 * padding the day out with work nobody asked for.
 */
function ScriptQueue({
  onPlan,
}: {
  onPlan: (client: string, title: string) => void;
}) {
  const q = useQuery(api.creative.scriptQueue, {});
  if (!q) return null;
  // biome-ignore lint/suspicious/noExplicitAny: query payload is untyped
  const rows = q.rows as any[];
  // biome-ignore lint/suspicious/noExplicitAny: query payload is untyped
  const optional = (q.optional ?? []) as any[];
  return (
    <section className={`${CARD} overflow-hidden`}>
      <CardHead
        icon={Sparkles}
        title="What to script next"
        sub={`${rows.length} client${rows.length === 1 ? "" : "s"} need writing today`}
      />
      <div className="-mx-4 -mb-4 mt-4 divide-y border-t sm:-mx-6 sm:-mb-6">
        {rows.map(r => (
          <QueueRow key={`${r.client}-${r.type}`} r={r} onPlan={onPlan} />
        ))}
        {rows.length === 0 && (
          <p className="px-4 py-3 text-sm text-muted-foreground sm:px-6">
            Nothing urgent. Rare, and worth using to get ahead on next week.
          </p>
        )}
        {optional.length > 0 && (
          <details>
            <summary className="px-4 py-3 text-xs text-muted-foreground hover:text-foreground sm:px-6">
              {optional.length} funnel idea{optional.length === 1 ? "" : "s"},
              only if we are switching the client onto them
            </summary>
            <div className="divide-y border-t">
              {optional.map(r => (
                <QueueRow key={`${r.client}-${r.type}`} r={r} onPlan={onPlan} />
              ))}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}

export function ScriptingCalendar({ compact = false }: { compact?: boolean }) {
  const cal = useQuery(api.creative.calendar, {});
  const queueAction = useMutation(api.clients.queueAction);

  const [moving, setMoving] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState(todayKey());
  const [planClient, setPlanClient] = useState("");
  const [planDay, setPlanDay] = useState(todayKey());
  const [planTitle, setPlanTitle] = useState("");
  const [planBrief, setPlanBrief] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [onlyMine, setOnlyMine] = useState<string>("all");

  const clientNames: string[] = useMemo(
    // biome-ignore lint/suspicious/noExplicitAny: query payload is untyped
    () => (cal?.clients ?? []).map((c: any) => c.name),
    [cal],
  );

  if (cal === undefined) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  // biome-ignore lint/suspicious/noExplicitAny: query payload is untyped
  const visible = (items: any[]) =>
    onlyMine === "all" ? items : items.filter(i => i.client === onlyMine);

  async function plan() {
    if (!planClient) {
      setNote("Pick a client first.");
      return;
    }
    await queueAction({
      kind: "planScript",
      payload: {
        client: planClient,
        due: planDay,
        title: planTitle || undefined,
        brief: planBrief,
      },
    });
    setNote(
      `Queued: script for ${planClient} on ${planDay}. It lands on the creative board at the next sync, within 15 minutes.`,
    );
    setPlanTitle("");
    setPlanBrief("");
  }

  async function move(taskId: string, day: string) {
    await queueAction({ kind: "schedule", taskId, payload: { due: day } });
    setMoving(null);
    setNote(`Queued: moved to ${day}. The board updates at the next sync.`);
  }

  const counts = (
    <>
      What is written when, per client. {cal.counts.planned} planned,{" "}
      <span className={cal.counts.overdue ? "txt-bad" : ""}>
        {cal.counts.overdue} late
      </span>
      , {cal.counts.unplanned} with no date on them yet.
    </>
  );

  return (
    <div
      className={
        compact ? "space-y-6" : "mx-auto w-full max-w-[1180px] space-y-6"
      }
    >
      {compact ? (
        // Inside the middle of the day the page already has its title, so
        // the calendar is a section of it, not a second page.
        <CardHead icon={CalendarDays} title="Scripting calendar" sub={counts} />
      ) : (
        <PageHeader title="Scripting calendar" sub={counts} />
      )}

      {note && (
        // A confirmation, not a warning: it goes in a quiet panel.
        <div
          role="status"
          className="rounded-xl bg-muted/60 px-4 py-3 text-sm text-foreground"
        >
          {note}
        </div>
      )}

      {/* Plan proactively ---------------------------------------------------- */}
      <section className={CARD}>
        <CardHead
          icon={Plus}
          title="Plan a script"
          sub="Creates the task on the creative board, tagged to the client"
        />
        <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)]">
          <AnimatedSelect
            value={planClient}
            onChange={e => setPlanClient(e.target.value)}
            aria-label="Client"
            className="h-9 rounded-md border bg-transparent px-3 text-sm"
          >
            <option value="">Which client</option>
            {clientNames.map(n => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </AnimatedSelect>
          <DateInput
            value={planDay}
            onChange={e => setPlanDay(e.target.value)}
            className="h-9 rounded-md border bg-transparent px-3 text-sm"
          />
          <Input
            value={planTitle}
            onChange={e => setPlanTitle(e.target.value)}
            placeholder="Title, or leave blank for New Script Request"
          />
        </div>
        <Textarea
          value={planBrief}
          onChange={e => setPlanBrief(e.target.value)}
          placeholder="The angle, the offer, the hook you want to test. This becomes the task description."
          className="mt-2 min-h-[64px] text-sm"
        />
        <Button className="mt-3" onClick={plan}>
          Put it on the board
        </Button>
      </section>

      <ScriptQueue
        onPlan={(client, title) => {
          setPlanClient(client);
          setPlanTitle(title);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />

      {/* Filter -------------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Show</span>
        <AnimatedSelect
          value={onlyMine}
          onChange={e => setOnlyMine(e.target.value)}
          aria-label="Which client"
          className="h-8 rounded-md border bg-transparent px-3 text-sm"
        >
          <option value="all">every client</option>
          {clientNames.map(n => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </AnimatedSelect>
      </div>

      {/* Move dialog --------------------------------------------------------- */}
      {moving && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 text-sm">
          <span>Move to</span>
          <DateInput
            value={moveTo}
            onChange={e => setMoveTo(e.target.value)}
            className="h-9 rounded-md border bg-transparent px-3"
          />
          <Button size="sm" onClick={() => move(moving, moveTo)}>
            Move it
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMoving(null)}>
            Cancel
          </Button>
        </div>
      )}

      {/* The grid ------------------------------------------------------------ */}
      <div className="grid gap-2 md:grid-cols-4 lg:grid-cols-7">
        {/* biome-ignore lint/suspicious/noExplicitAny: query payload is untyped */}
        {cal.days.map((d: any) => {
          const items = visible(d.items);
          return (
            <div
              key={d.day}
              // An empty day is just its date on a phone, where the week
              // stacks; the 7-column grid gives every day its height.
              className={`rounded-xl border p-2 md:min-h-[96px] ${
                d.isToday ? "border-primary/60 ring-1 ring-primary/40" : ""
              } ${d.isPast ? "opacity-70" : ""} ${
                d.isFriday ? "bg-muted/40" : "bg-card"
              }`}
            >
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold">
                  {d.weekday} {d.label}
                </span>
                {d.isToday && (
                  <span className={`${LABEL} text-primary`}>Today</span>
                )}
              </div>
              {d.isFriday && items.length === 0 && (
                <p className="text-xs text-muted-foreground">Off</p>
              )}
              <div className="space-y-1.5">
                {items.map((it: { id: string }) => (
                  <Card
                    key={it.id}
                    it={it}
                    onMove={id => {
                      setMoving(id);
                      setMoveTo(d.day);
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Older overdue -------------------------------------------------------- */}
      {cal.olderOverdue.length > 0 && (
        <section className={CARD}>
          <CardHead icon={CalendarDays} title="Late from before this window" />
          <div className="mt-4 grid gap-2 md:grid-cols-3">
            {/* biome-ignore lint/suspicious/noExplicitAny: query payload is untyped */}
            {visible(cal.olderOverdue).map((it: any) => (
              <Card key={it.id} it={it} onMove={id => setMoving(id)} />
            ))}
          </div>
        </section>
      )}

      {/* Undated -------------------------------------------------------------- */}
      <section className={CARD}>
        <CardHead
          icon={CalendarDays}
          title="No date on them yet"
          sub="Open work that never appears on a day until it gets one"
        />
        <div className="mt-4 grid gap-2 md:grid-cols-3">
          {/* biome-ignore lint/suspicious/noExplicitAny: query payload is untyped */}
          {visible(cal.unplanned).map((it: any) => (
            <Card key={it.id} it={it} onMove={id => setMoving(id)} />
          ))}
          {visible(cal.unplanned).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Everything open has a date. Rare, enjoy it.
            </p>
          )}
        </div>
      </section>

      {/* Drive ---------------------------------------------------------------- */}
      <section className={`${CARD} overflow-hidden`}>
        <CardHead
          icon={FolderOpen}
          title="Client Drive folders"
          sub="Scripts and footage, straight from the client folder"
        />
        <ul className="-mx-4 -mb-4 mt-4 divide-y border-t sm:-mx-6 sm:-mb-6">
          {/* biome-ignore lint/suspicious/noExplicitAny: query payload is untyped */}
          {cal.clients.map((c: any) => (
            <li
              key={c.name}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm sm:px-6"
            >
              <span className="min-w-0 flex-1 basis-full truncate font-medium sm:basis-auto">
                {c.name}
              </span>
              {c.driveScripts ? (
                <a
                  className="inline-flex items-center gap-0.5 text-primary hover:underline"
                  href={c.driveScripts}
                  target="_blank"
                  rel="noreferrer"
                >
                  Scripts
                  <ArrowUpRight className="size-3.5" />
                </a>
              ) : (
                <span className="text-xs text-muted-foreground">
                  No scripts folder
                </span>
              )}
              {c.driveFootage ? (
                <a
                  className="inline-flex items-center gap-0.5 text-primary hover:underline"
                  href={c.driveFootage}
                  target="_blank"
                  rel="noreferrer"
                >
                  Footage
                  <ArrowUpRight className="size-3.5" />
                </a>
              ) : (
                <span className="text-xs text-muted-foreground">
                  No footage folder
                </span>
              )}
              {c.driveFolder && (
                <a
                  className="inline-flex items-center gap-0.5 text-primary hover:underline"
                  href={c.driveFolder}
                  target="_blank"
                  rel="noreferrer"
                >
                  Whole folder
                  <ArrowUpRight className="size-3.5" />
                </a>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** Standalone route, kept so a bookmarked /calendar still works. */
export function CalendarPage() {
  return <ScriptingCalendar />;
}
