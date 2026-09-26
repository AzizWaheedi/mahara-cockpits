import { useMutation, useQuery } from "convex/react";
import {
  CalendarDays,
  ExternalLink,
  FolderOpen,
  Plus,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { api } from "@/../convex/_generated/api";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
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
  creativeBatch: "Creative batch",
  video: "Video",
  post: "Post",
  brandDNA: "Brand DNA",
  onboarding: "Onboarding",
};

function KindPill({ kind }: { kind: string }) {
  const tone =
    kind === "script" || kind === "creativeBatch"
      ? "tone-good"
      : kind === "video"
        ? "tone-neutral"
        : kind === "brandDNA"
          ? "tone-warn"
          : "tone-neutral";
  return (
    <span
      className={`${tone} rounded px-1 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide`}
    >
      {KIND_LABEL[kind] ?? kind}
    </span>
  );
}

function todayKey(): string {
  return new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
}

// biome-ignore lint/suspicious/noExplicitAny: query payload is untyped
function Card({ it, onMove }: { it: any; onMove: (id: string) => void }) {
  return (
    <div
      className={`rounded border px-1.5 py-1 text-[12px] leading-tight ${
        it.overdue ? "callout-warn" : ""
      } ${it.open ? "" : "opacity-55"}`}
    >
      <div className="flex items-center gap-1">
        <KindPill kind={it.kind} />
        {it.overdue && (
          <span className="txt-bad text-[9.5px] font-semibold">LATE</span>
        )}
      </div>
      <div className="mt-0.5 font-medium">{it.client ?? "no client tag"}</div>
      <div className="text-muted-foreground">{it.title}</div>
      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>{it.status}</span>
        {it.url && (
          <a
            href={it.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 underline underline-offset-2"
          >
            open <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
        {it.canSchedule && (
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => onMove(it.taskId)}
          >
            move
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
    <div
      className={`flex flex-wrap items-baseline gap-2 rounded border px-2 py-1.5 text-[12px] ${
        r.priority === 1 ? "callout-warn" : ""
      }`}
    >
      <span
        className={`${r.priority === 1 ? "tone-bad" : "tone-neutral"} rounded px-1 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide`}
      >
        {r.type}
      </span>
      <Link
        to={`/clients/${encodeURIComponent(r.client)}`}
        className="font-medium underline underline-offset-2"
        dir="auto"
      >
        {r.client}
      </Link>
      <span>{r.why}.</span>
      <span className="text-muted-foreground">{r.evidence}</span>
      <button
        type="button"
        className="ml-auto shrink-0 underline underline-offset-2"
        onClick={() => onPlan(r.client, r.suggestedTitle)}
      >
        plan it
      </button>
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
  const [showOptional, setShowOptional] = useState(false);
  if (!q) return null;
  // biome-ignore lint/suspicious/noExplicitAny: query payload is untyped
  const rows = q.rows as any[];
  // biome-ignore lint/suspicious/noExplicitAny: query payload is untyped
  const optional = (q.optional ?? []) as any[];
  return (
    <section className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4" />
        <h2 className="text-[14px] font-bold">What to script next</h2>
        <span className="text-[12px] text-muted-foreground">
          {rows.length} client{rows.length === 1 ? "" : "s"} need writing today
        </span>
      </div>
      <div className="mt-2 space-y-1">
        {rows.map(r => (
          <QueueRow key={`${r.client}-${r.type}`} r={r} onPlan={onPlan} />
        ))}
        {rows.length === 0 && (
          <p className="text-[13px] text-muted-foreground">
            Nothing urgent. Rare, and worth using to get ahead on next week.
          </p>
        )}
      </div>
      {optional.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            className="text-[12px] text-muted-foreground underline underline-offset-2"
            onClick={() => setShowOptional(v => !v)}
          >
            {showOptional ? "hide" : "show"} {optional.length} funnel idea
            {optional.length === 1 ? "" : "s"}, only if we are switching the
            client onto them
          </button>
          {showOptional && (
            <div className="mt-1 space-y-1">
              {optional.map(r => (
                <QueueRow key={`${r.client}-${r.type}`} r={r} onPlan={onPlan} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

type BatchClient = {
  taskId: string;
  name: string;
  hasCampaign: boolean;
  autoPlan: boolean;
  state: string;
  taskUrl: string | null;
  error: string | null;
};

/** One real ClickUp card per client and fortnight; automatic creation is opt-in. */
function CreativeBatchPlanner() {
  const preview = useQuery(api.creativeCadence.preview, {}) as
    | {
        cycle: string;
        approvalTarget: string;
        launch: string;
        clients: BatchClient[];
      }
    | undefined;
  const planNextBatch = useMutation(api.creativeCadence.planNextBatch);
  const setAutoPlan = useMutation(api.creativeCadence.setAutoPlan);
  const [clientTaskId, setClientTaskId] = useState("");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!preview) return null;
  const selected = preview.clients.find(c => c.taskId === clientTaskId);
  const mapped = preview.clients.filter(c => c.hasCampaign);
  const missing = mapped.filter(c => c.state === "not planned");

  async function plan(clientId?: string) {
    setWorking(true);
    try {
      const result = await planNextBatch(
        clientId ? { clientTaskId: clientId } : {},
      );
      setMessage(
        `${result.queued} batch${result.queued === 1 ? "" : "es"} queued for ${result.cycle}; ${result.skipped} already planned. ClickUp and this calendar update at the next sync.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not plan batches.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function toggleAuto(client: BatchClient) {
    setWorking(true);
    try {
      const enabled = await setAutoPlan({
        clientTaskId: client.taskId,
        enabled: !client.autoPlan,
      });
      setMessage(
        `${client.name}: automatic fortnightly planning ${enabled ? "on" : "off"}.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not change auto-planning.",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4" />
        <h2 className="text-[14px] font-bold">Next creative batch</h2>
        <span className="text-[12px] text-muted-foreground">
          {preview.cycle}
        </span>
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground">
        One video and two image concepts per client. Brief together, get client
        approval ahead of launch, and keep a winning ad live. The card is a
        ClickUp task you can move in this calendar.
      </p>
      <p className="mt-1 text-[12px] font-medium">
        Brief {preview.cycle} · Approval target {preview.approvalTarget} · First
        launch window {preview.launch}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <AnimatedSelect
          value={clientTaskId}
          onChange={event => setClientTaskId(event.target.value)}
          className="min-w-[190px] rounded border bg-transparent px-2 py-1 text-[13px]"
        >
          <option value="">Choose an active client</option>
          {preview.clients.map(client => (
            <option key={client.taskId} value={client.taskId}>
              {client.name}
            </option>
          ))}
        </AnimatedSelect>
        <Button
          size="sm"
          disabled={selected?.state !== "not planned" || working}
          onClick={() => selected && plan(selected.taskId)}
        >
          Schedule this client
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={missing.length === 0 || working}
          onClick={() => plan()}
        >
          Fill {missing.length} mapped client{missing.length === 1 ? "" : "s"}
        </Button>
        {selected?.hasCampaign && (
          <button
            type="button"
            disabled={working}
            className="text-[12px] underline underline-offset-2 disabled:opacity-50"
            onClick={() => toggleAuto(selected)}
          >
            Auto-plan {selected.autoPlan ? "on" : "off"}
          </button>
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Auto-plan is off until enabled for a mapped client. It prepares their
        next batch each Thursday morning. No ad is published and no client is
        messaged.
      </p>
      {selected && (
        <p className="mt-2 text-[12px]">
          {selected.name}: <strong>{selected.state}</strong>
          {selected.taskUrl && (
            <a
              href={selected.taskUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-2 underline underline-offset-2"
            >
              open task
            </a>
          )}
          {selected.error && (
            <span className="txt-bad ml-2">{selected.error}</span>
          )}
          {!selected.hasCampaign && (
            <span className="ml-2 text-muted-foreground">
              No exact ad mapping; manual planning only.
            </span>
          )}
        </p>
      )}
      {message && (
        <p className="mt-2 text-[12px]" role="status">
          {message}
        </p>
      )}
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
    return <p className="p-4 text-[14px] text-muted-foreground">Loading…</p>;
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

  return (
    <div className={compact ? "space-y-4" : "space-y-4 p-3 md:p-5"}>
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4" />
          <h1 className="text-[15px] font-bold tracking-tight">
            Scripting calendar
          </h1>
        </div>
        <p className="text-[13px] text-muted-foreground">
          What is written when, per client. {cal.counts.planned} planned,{" "}
          <span className={cal.counts.overdue ? "txt-bad" : ""}>
            {cal.counts.overdue} late
          </span>
          , {cal.counts.unplanned} with no date on them yet.
        </p>
      </header>

      {note && (
        <div className="callout-warn rounded p-2 text-[13px]">{note}</div>
      )}

      <CreativeBatchPlanner />

      {/* Plan proactively ---------------------------------------------------- */}
      <section className="rounded-lg border p-3">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          <h2 className="text-[14px] font-bold">Plan a script</h2>
          <span className="text-[12px] text-muted-foreground">
            creates the task on the creative board, tagged to the client
          </span>
        </div>
        <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_150px_minmax(0,1fr)]">
          <AnimatedSelect
            value={planClient}
            onChange={e => setPlanClient(e.target.value)}
            className="rounded border bg-transparent px-2 py-1 text-[13px]"
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
            className="rounded border bg-transparent px-2 py-1 text-[13px]"
          />
          <input
            value={planTitle}
            onChange={e => setPlanTitle(e.target.value)}
            placeholder="Title, or leave blank for New Script Request"
            className="rounded border bg-transparent px-2 py-1 text-[13px]"
          />
        </div>
        <Textarea
          value={planBrief}
          onChange={e => setPlanBrief(e.target.value)}
          placeholder="The angle, the offer, the hook you want to test. This becomes the task description."
          className="mt-2 min-h-[60px] text-[13px]"
        />
        <Button size="sm" className="mt-2" onClick={plan}>
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
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-muted-foreground">Show</span>
        <AnimatedSelect
          value={onlyMine}
          onChange={e => setOnlyMine(e.target.value)}
          className="rounded border bg-transparent px-2 py-1 text-[13px]"
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
        <div className="flex flex-wrap items-center gap-2 rounded-lg border p-2 text-[13px]">
          <span>Move to</span>
          <DateInput
            value={moveTo}
            onChange={e => setMoveTo(e.target.value)}
            className="rounded border bg-transparent px-2 py-1"
          />
          <Button size="sm" onClick={() => move(moving, moveTo)}>
            Move it
          </Button>
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => setMoving(null)}
          >
            cancel
          </button>
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
              className={`min-h-[92px] rounded-lg border p-1.5 ${
                d.isToday ? "ring-2 ring-primary" : ""
              } ${d.isPast ? "opacity-70" : ""} ${
                d.isFriday ? "bg-muted/40" : ""
              }`}
            >
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-[12px] font-semibold">
                  {d.weekday} {d.label}
                </span>
                {d.isToday && (
                  <span className="txt-good text-[9.5px] font-bold">TODAY</span>
                )}
              </div>
              {d.isFriday && items.length === 0 && (
                <p className="text-[11px] text-muted-foreground">off</p>
              )}
              <div className="space-y-1">
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
        <section className="space-y-1">
          <h2 className="text-[14px] font-bold">
            Late from before this window
          </h2>
          <div className="grid gap-1 md:grid-cols-3">
            {/* biome-ignore lint/suspicious/noExplicitAny: query payload is untyped */}
            {visible(cal.olderOverdue).map((it: any) => (
              <Card key={it.id} it={it} onMove={id => setMoving(id)} />
            ))}
          </div>
        </section>
      )}

      {/* Undated -------------------------------------------------------------- */}
      <section className="space-y-1">
        <h2 className="text-[14px] font-bold">No date on them yet</h2>
        <p className="text-[12px] text-muted-foreground">
          Open work that will never appear on a day until it gets one. Give it a
          date and it moves into the calendar.
        </p>
        <div className="grid gap-1 md:grid-cols-3">
          {/* biome-ignore lint/suspicious/noExplicitAny: query payload is untyped */}
          {visible(cal.unplanned).map((it: any) => (
            <Card key={it.id} it={it} onMove={id => setMoving(id)} />
          ))}
          {visible(cal.unplanned).length === 0 && (
            <p className="text-[13px] text-muted-foreground">
              Everything open has a date. Rare, enjoy it.
            </p>
          )}
        </div>
      </section>

      {/* Drive ---------------------------------------------------------------- */}
      <section className="space-y-1">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4" />
          <h2 className="text-[14px] font-bold">Client Drive folders</h2>
          <span className="text-[12px] text-muted-foreground">
            scripts and footage, straight from the client folder
          </span>
        </div>
        <div className="grid gap-1 md:grid-cols-2">
          {/* biome-ignore lint/suspicious/noExplicitAny: query payload is untyped */}
          {cal.clients.map((c: any) => (
            <div
              key={c.name}
              className="flex flex-wrap items-center gap-2 rounded border px-2 py-1 text-[12px]"
            >
              <span className="font-medium">{c.name}</span>
              {c.driveScripts ? (
                <a
                  className="txt-good underline underline-offset-2"
                  href={c.driveScripts}
                  target="_blank"
                  rel="noreferrer"
                >
                  scripts
                </a>
              ) : (
                <span className="text-muted-foreground">no scripts folder</span>
              )}
              {c.driveFootage ? (
                <a
                  className="txt-good underline underline-offset-2"
                  href={c.driveFootage}
                  target="_blank"
                  rel="noreferrer"
                >
                  footage
                </a>
              ) : (
                <span className="text-muted-foreground">no footage folder</span>
              )}
              {c.driveFolder && (
                <a
                  className="ml-auto underline underline-offset-2"
                  href={c.driveFolder}
                  target="_blank"
                  rel="noreferrer"
                >
                  whole folder
                </a>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/** Standalone route, kept so a bookmarked /calendar still works. */
export function CalendarPage() {
  return (
    <div className="p-3 md:p-5">
      <ScriptingCalendar />
    </div>
  );
}
