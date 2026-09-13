import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  FileText,
  Film,
  MessageSquare,
  Rocket,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { CreativePreview } from "@/components/CreativePreview";
import { TemplateCard } from "@/components/TemplateCard";
import { bucketDays, TrendChart } from "@/components/TrendChart";
import { Button } from "@/components/ui/button";
import { CopyButton, WinningAds } from "@/components/WinningAds";
import { TEMPLATES } from "@/lib/creativeTemplates";
import { FunnelRow } from "@/pages/FunnelsPage";
import { api } from "../../convex/_generated/api";

/**
 * One client, fullscreen.
 *
 * Aziz, 2026-09-07: when the creative director sits down to script for a
 * client you should see everything about them on one screen. What they bought,
 * the brand direction and offer you already wrote, every script and video we
 * have ever made for them, what is running on their account right now as a
 * watchable preview, and the ads that won for other firms in the same service
 * line. Then you write.
 *
 * Two rules hold everywhere: the client comes from ClickUp tags, and the stage
 * shown is the raw ClickUp status, never a label we invented.
 */

const DAY = 86_400_000;

const TABS = [
  "Script from here",
  "Their funnel",
  "Work in flight",
  "Everything we made",
  "Talk to them",
] as const;
type Tab = (typeof TABS)[number];

function when(ms?: number | null): string {
  if (!ms) return "no date";
  const d = Math.round((ms - Date.now()) / DAY);
  if (d === 0) return "today";
  return d > 0 ? `in ${d}d` : `${Math.abs(d)}d ago`;
}

function money(n?: number | null): string {
  return n === undefined || n === null ? "—" : `$${n.toFixed(2)}`;
}

function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "good" | "warn" | "bad" | "neutral";
}) {
  return (
    <span
      className={`tone-${tone} rounded-full px-2 py-0.5 text-[11px] font-medium`}
    >
      {children}
    </span>
  );
}

function DocCard({
  href,
  label,
  hint,
}: {
  href?: string | null;
  label: string;
  hint: string;
}) {
  if (!href) {
    return (
      <div className="rounded-lg border border-dashed p-2.5 text-[12px] text-muted-foreground">
        <div className="font-semibold">{label}</div>
        <div>Not on the client record yet.</div>
      </div>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="rounded-lg border p-2.5 text-[12px] transition hover:bg-muted/50"
    >
      <div className="flex items-center gap-1.5 font-semibold">
        <FileText className="h-3.5 w-3.5" />
        {label}
        <ExternalLink className="ml-auto h-3 w-3 text-muted-foreground" />
      </div>
      <div className="mt-0.5 text-muted-foreground">{hint}</div>
    </a>
  );
}

/**
 * Extract everything we hold on a client into one markdown file.
 *
 * Aziz, 2026-09-08: when scripting, or when handing the client to another LLM,
 * the context should be one download, not a hunt across ClickUp, Meta and Drive.
 * The pack is built server side by clients.contextPack so nothing on it is
 * assembled from what happens to be rendered on screen.
 */
function ExtractContext({ name }: { name: string }) {
  const [wanted, setWanted] = useState(false);
  const pack = useQuery(api.clients.contextPack, wanted ? { name } : "skip");
  const [done, setDone] = useState(false);

  function download() {
    if (!pack) {
      setWanted(true);
      return;
    }
    const blob = new Blob([pack.markdown], {
      type: "text/markdown;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name.replace(/[^\w\u0600-\u06FF -]/g, "")} context.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    setDone(true);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={download}>
        <Download className="mr-1 h-3.5 w-3.5" />
        {wanted && !pack
          ? "Building the pack…"
          : pack
            ? "Download the context pack"
            : "Extract client context"}
      </Button>
      {pack && (
        <span className="text-[12px] text-muted-foreground">
          {pack.counts.campaigns} campaigns, {pack.counts.ads} ads,{" "}
          {pack.counts.transcripts} transcripts, {pack.counts.funnels} funnels,{" "}
          {pack.counts.plays} ad sets, {pack.counts.tasks} board rows,{" "}
          {pack.counts.videos} videos. Documents are linked, not embedded.
          {done ? " Downloaded." : ""}
        </span>
      )}
    </div>
  );
}

/**
 * What happens after the lead. Aziz, 2026-09-08: cost per lead alone does not
 * tell you whether the writing worked, so the client tab carries booking, show,
 * quotation and close rate off their own stat sheet.
 *
 * A rate with no denominator is shown as "no data", never as 0%.
 */
// biome-ignore lint/suspicious/noExplicitAny: query payload is untyped
function ClientStats({ s }: { s: any }) {
  if (!s) {
    return (
      <p className="mt-2 text-[12px] text-muted-foreground">
        No appointments on their stat sheet this month, so booking, show,
        quotation and close rates cannot be worked out yet.
      </p>
    );
  }
  const cells: { label: string; value: number | null; sub: string }[] = [
    {
      label: "Booking rate",
      value: s.bookingRate,
      sub: `${s.booked} booked off ${s.leads30} leads`,
    },
    {
      label: "Show rate",
      value: s.showRate,
      sub: `${s.shows} showed off ${s.booked} booked`,
    },
    {
      label: "Quotation rate",
      value: s.quotationRate,
      sub: `${s.quotes} quoted off ${s.shows} shows`,
    },
    {
      label: "Close rate",
      value: s.closeRate,
      sub: `${s.closes} closed off ${s.quotes} quotes`,
    },
  ];
  return (
    <div className="mt-2">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {cells.map(c => (
          <div key={c.label} className="rounded-lg border px-2.5 py-1.5">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {c.label}
            </p>
            <p className="text-[17px] font-bold leading-tight">
              {c.value === null ? "no data" : `${c.value}%`}
            </p>
            <p className="text-[11px] text-muted-foreground">{c.sub}</p>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {s.month} on their stat sheet. Booking rate counts appointments against
        the leads Meta reported in the last 30 days, so treat it as a direction,
        not an exact ratio.
      </p>
    </div>
  );
}

/** What the client's ads did, per day, last 90 days: the creative director's scoreboard. */
// biome-ignore lint/suspicious/noExplicitAny: client row
function ClientTrends({ client }: { client: any }) {
  // biome-ignore lint/suspicious/noExplicitAny: series rows
  const daily: any[] = client?.daily ?? [];
  if (daily.length < 2) return null;
  const from = daily[0].date;
  const to = daily[daily.length - 1].date;
  const buckets = bucketDays(daily, from, to);
  // biome-ignore lint/suspicious/noExplicitAny: series rows
  const sum = (rows: any[], k: string) =>
    rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const leads = buckets.map(b => ({ x: b.key, y: sum(b.rows, "leads") }));
  const spend = buckets.map(b => ({
    x: b.key,
    y: Math.round(sum(b.rows, "spend")),
  }));
  const cpl = buckets.map(b => {
    const l = sum(b.rows, "leads");
    return {
      x: b.key,
      y: l ? Math.round((sum(b.rows, "spend") / l) * 100) / 100 : null,
    };
  });
  const weekly = (Date.parse(to) - Date.parse(from)) / 86400_000 > 45;
  const per = weekly ? "per week" : "per day";
  return (
    <section>
      <h2 className="mb-2 text-[12px] font-bold uppercase tracking-widest text-teal-600">
        Trends, last 90 days
      </h2>
      <div className="grid gap-3 md:grid-cols-3">
        <TrendChart title={`Leads ${per}`} points={leads} kind="bar" />
        <TrendChart title={`Spend ${per}`} points={spend} unit="$" />
        <TrendChart
          title="Cost per lead"
          points={cpl}
          unit="$"
          mode="avg"
          goodWhen="down"
          hint="Cheaper leads after a new creative went live is the win to look for."
        />
      </div>
    </section>
  );
}

export function ClientPage() {
  const params = useParams();
  const name = decodeURIComponent(params.name ?? "");
  const d = useQuery(api.clients.detail, name ? { name } : "skip");
  const [tab, setTab] = useState<Tab>("Script from here");

  if (d === undefined) {
    return <p className="p-4 text-[14px] text-muted-foreground">Loading…</p>;
  }
  if (d === null) {
    return (
      <div className="p-4 text-[14px]">
        <p className="txt-bad">
          No client called “{name}” on the ClickUp client board.
        </p>
        <Link to="/clients" className="underline underline-offset-2">
          Back to clients
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <Link
        to="/clients"
        className="mb-2 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        All clients
      </Link>

      <header className="mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-bold tracking-tight" dir="auto">
            {d.client.name}
          </h1>
          <Pill tone={d.client.clientStatus ? "warn" : "neutral"}>
            {d.client.clientStatus ?? "no status"}
          </Pill>
          {d.client.url && (
            <a
              href={d.client.url}
              target="_blank"
              rel="noreferrer"
              className="text-[12px] underline underline-offset-2"
            >
              ClickUp record
            </a>
          )}
        </div>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {d.serviceLine ?? "Service not set"} · launch{" "}
          {when(d.client.launchDate)} · {d.liveNow.length} ads live ·{" "}
          {d.videos.filter((v: { open: boolean }) => v.open).length} videos in
          flight
        </p>
        <ClientStats s={d.stats} />
        <div className="mt-2">
          <ExtractContext name={d.client.name} />
        </div>
      </header>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <DocCard
          href={d.client.docs.brandDna}
          label="Brand DNA"
          hint="How they are allowed to sound and look"
        />
        <DocCard
          href={d.client.docs.offerCheatSheet}
          label="Offer creation strategy"
          hint="The offer every script has to sell"
        />
        <DocCard
          href={d.client.docs.research}
          label="Market research"
          hint="Their market, their buyer"
        />
        <DocCard
          href={d.client.docs.drive}
          label="Drive folder"
          hint="Raw footage and brand assets"
        />
      </div>

      <div className="mb-3 flex flex-wrap gap-1 border-b">
        {TABS.map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-2.5 py-1.5 text-[13px] font-semibold transition ${
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Script from here" && <ScriptFromHere d={d} />}
      {tab === "Their funnel" && <TheirFunnel name={d.client.name} />}
      {tab === "Work in flight" && <WorkInFlight d={d} name={d.client.name} />}
      {tab === "Everything we made" && <Everything d={d} />}
      {tab === "Talk to them" && <TalkToThem d={d} name={d.client.name} />}
    </div>
  );
}

/** Live ads, their own history, then what won elsewhere in the same service. */
// biome-ignore lint/suspicious/noExplicitAny: query payload is untyped
function ScriptFromHere({ d }: { d: any }) {
  const service = d.serviceLine ?? "";
  const [scope, setScope] = useState<"service" | "all">("service");
  const winners = useQuery(api.winners.list, {
    serviceLine: scope === "service" ? serviceLineOf(service) : undefined,
    excludeClient: d.client.name,
    limit: 40,
  });

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-1.5 flex items-center gap-1.5 text-[14px] font-bold">
          <Rocket className="h-3.5 w-3.5" />
          Live on their account right now ({d.liveNow.length})
        </h3>
        {d.liveNow.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            Nothing active. Whatever you write next is what goes live first.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {/* biome-ignore lint/suspicious/noExplicitAny: query rows are untyped */}
            {(d.liveNow as any[]).map(a => (
              <div
                key={a.metaId}
                className="flex items-center gap-2 rounded-lg border p-2"
              >
                <CreativePreview
                  name={a.name}
                  thumbUrl={a.thumbUrl ?? undefined}
                  previewSrc={a.previewSrc ?? undefined}
                  metaAdId={a.metaId}
                  size="md"
                />
                <span className="min-w-0 text-[12px]">
                  <span className="block truncate font-medium" dir="auto">
                    {a.name}
                  </span>
                  <span className="block truncate text-muted-foreground">
                    {a.campaignName}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {d.history.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-[14px] font-bold">
            What has already run for them ({d.history.length})
          </h3>
          <div className="divide-y rounded-lg border">
            {/* biome-ignore lint/suspicious/noExplicitAny: query rows are untyped */}
            {(d.history as any[]).slice(0, 12).map(a => (
              <div
                key={`${a.campaignName}:${a.adName}`}
                className="flex items-center gap-3 px-3 py-2 text-[13px]"
              >
                <CreativePreview
                  name={a.adName}
                  thumbUrl={a.thumbnailUrl ?? undefined}
                  previewSrc={a.previewSrc ?? undefined}
                />
                <span className="min-w-0 flex-1 truncate" dir="auto">
                  {a.adName}
                </span>
                <span className="shrink-0 text-[12px] text-muted-foreground">
                  {money(a.spend)} spend · {a.leads} leads · {money(a.cpl)} CPL
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <ClientTrends client={d.client} />

      <section>
        <div className="mb-1 flex items-center gap-2">
          <h3 className="text-[14px] font-bold">
            Proven ads to build this script on
          </h3>
          <select
            value={scope}
            onChange={e => setScope(e.target.value as "service" | "all")}
            className="ml-auto rounded border bg-transparent px-2 py-0.5 text-[12px]"
          >
            <option value="service">
              {serviceLineOf(service) || "Their service line"}
            </option>
            <option value="all">Every service line</option>
          </select>
        </div>
        <WinningAds
          rows={winners?.rows}
          title=""
          sub="Same database the media buyer works from. Every ad here spent real money and stayed cheap. Read the hook and the transcript, then write theirs."
        />
      </section>
    </div>
  );
}

/**
 * The client board and the winners archive use different service wording, so
 * map rather than filter on an exact string and silently show nothing.
 */
function serviceLineOf(service: string): string | undefined {
  const s = service.toLowerCase();
  if (s.includes("interior")) return "Interior design";
  if (s.includes("architect") || s.includes("engineer")) {
    return "Architecture and engineering";
  }
  if (
    s.includes("build") ||
    s.includes("construct") ||
    s.includes("contract")
  ) {
    return "Construction and contracting";
  }
  return undefined;
}

// biome-ignore lint/suspicious/noExplicitAny: query payload is untyped
function WorkInFlight({ d, name }: { d: any; name: string }) {
  const queue = useMutation(api.clients.queueAction);
  // biome-ignore lint/suspicious/noExplicitAny: outbox rows are untyped
  const outbox = useQuery(api.clients.outbox, {}) as any[] | undefined;
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState<{
    tone: "warn" | "bad";
    text: string;
  } | null>(null);

  // A task with a row still in the outbox takes no second click: the drain
  // executes every row it finds, so a repeat would post twice on ClickUp.
  const inFlight = new Set<string>();
  const lastFailed = new Map<string, string>();
  // Rows arrive newest first: only the most recent settled row per task
  // decides whether a red "last one failed" line shows.
  const settled = new Set<string>();
  for (const r of outbox ?? []) {
    if (!r.taskId) continue;
    if (r.state === "pending" || r.state === "sending") inFlight.add(r.taskId);
    else if (r.state === "done") settled.add(r.taskId);
    else if (r.state === "failed" && !settled.has(r.taskId)) {
      settled.add(r.taskId);
      lastFailed.set(r.taskId, String(r.result ?? "failed"));
    }
  }

  async function act(kind: string, taskId?: string, payload: unknown = {}) {
    setBusy(`${kind}:${taskId ?? ""}`);
    try {
      await queue({ kind, taskId, payload });
      setNote("");
      setFeedback({
        tone: "warn",
        text: "Queued. It reaches ClickUp within a minute; this screen shows the change at the next board sync, within 10 minutes.",
      });
    } catch (e) {
      setFeedback({
        tone: "bad",
        text: `Not queued: ${String((e as Error)?.message ?? e).slice(0, 200)}`,
      });
    } finally {
      setBusy(null);
    }
  }

  const openVideos = (d.videos as { open: boolean }[]).filter(v2 => v2.open);

  return (
    <div className="space-y-4 text-[13px]">
      {feedback && (
        <div
          className={`${feedback.tone === "bad" ? "callout-bad" : "callout-warn"} rounded-md border p-2`}
        >
          {feedback.text}
        </div>
      )}
      {d.tasks.length === 0 && openVideos.length === 0 ? (
        <p className="text-muted-foreground">Nothing open for this client.</p>
      ) : (
        <div className="space-y-1">
          {/* biome-ignore lint/suspicious/noExplicitAny: query rows are untyped */}
          {(d.tasks as any[]).map(t => (
            <div
              key={t.taskId}
              className="flex items-center justify-between gap-2 rounded border px-2 py-1.5"
            >
              <span className="min-w-0 truncate" dir="auto">
                <a
                  href={t.url}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  {t.name}
                </a>
                {t.otherClients.length > 0 && (
                  <span className="text-muted-foreground">
                    {" "}
                    (also {t.otherClients.join(", ")})
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Pill>{t.status}</Pill>
                <span className="text-muted-foreground">
                  opened {when(t.createdAt)}
                </span>
                <TaskActions
                  taskId={t.taskId}
                  act={act}
                  busy={busy}
                  pending={inFlight.has(t.taskId)}
                  failed={lastFailed.get(t.taskId)}
                />
              </span>
            </div>
          ))}
          {/* biome-ignore lint/suspicious/noExplicitAny: query rows are untyped */}
          {(d.videos as any[])
            .filter(v2 => v2.open)
            .map(v2 => (
              <div
                key={v2.taskId}
                className="flex items-center justify-between gap-2 rounded border px-2 py-1.5"
              >
                <span className="flex min-w-0 items-center gap-1.5 truncate">
                  <Film className="h-3 w-3 shrink-0" />
                  <a
                    href={v2.url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate hover:underline"
                    dir="auto"
                  >
                    {v2.name}
                  </a>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Pill
                    tone={
                      (v2.status || "").toLowerCase() === "client review"
                        ? "warn"
                        : "neutral"
                    }
                  >
                    {v2.status}
                  </Pill>
                  <span className="text-muted-foreground">
                    {v2.editors.length ? v2.editors.join(", ") : "unassigned"}
                  </span>
                  <TaskActions
                    taskId={v2.taskId}
                    act={act}
                    busy={busy}
                    pending={inFlight.has(v2.taskId)}
                    failed={lastFailed.get(v2.taskId)}
                  />
                </span>
              </div>
            ))}
        </div>
      )}

      <div>
        <h4 className="mb-1.5 font-semibold">Comment on their newest task</h4>
        {d.tasks[0] && (
          <p className="mb-1 text-[12px] text-muted-foreground" dir="auto">
            Posting to: {d.tasks[0].name}
          </p>
        )}
        <div className="flex gap-2">
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Your update, posted to ClickUp"
            className="flex-1 rounded border bg-transparent px-2 py-1.5 text-[13px] outline-none"
          />
          <Button
            size="sm"
            disabled={
              !note.trim() ||
              busy !== null ||
              d.tasks.length === 0 ||
              inFlight.has(d.tasks[0]?.taskId)
            }
            onClick={() => act("comment", d.tasks[0]?.taskId, { text: note })}
          >
            Post
          </Button>
        </div>
      </div>

      <NewVideoRequest
        client={name}
        drive={d.client.docs?.drive}
        onQueue={act}
        busy={busy}
      />
    </div>
  );
}

function TaskActions({
  taskId,
  act,
  busy,
  pending,
  failed,
}: {
  taskId: string;
  act: (kind: string, taskId?: string, payload?: unknown) => Promise<void>;
  busy: string | null;
  /** A queued row for this task has not reached ClickUp yet. */
  pending?: boolean;
  /** The last queued row for this task failed, with the drain's reason. */
  failed?: string;
}) {
  const [text, setText] = useState("");
  const [show, setShow] = useState(false);
  if (pending) {
    return <Pill tone="warn">queued, reaches ClickUp within a minute</Pill>;
  }
  return (
    <>
      {failed && (
        <span className="txt-bad text-[12px]" title={failed}>
          last one failed: {failed.slice(0, 60)}
        </span>
      )}
      {show && (
        <span className="flex items-center gap-1">
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Comment"
            className="w-40 rounded border bg-transparent px-1.5 py-1 text-[12px] outline-none"
          />
          <Button
            size="sm"
            className="h-6 px-2 text-[12px]"
            disabled={!text.trim() || busy !== null}
            onClick={async () => {
              await act("comment", taskId, { text });
              setText("");
              setShow(false);
            }}
          >
            Post
          </Button>
        </span>
      )}
      {!show && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[12px]"
          onClick={() => setShow(true)}
        >
          Comment
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2 text-[12px]"
        disabled={busy !== null}
        onClick={() => act("complete", taskId)}
        title="Moves it to the list's own done status: complete on Media / Creative, live on the Video Pipeline"
      >
        Mark done
      </Button>
    </>
  );
}

// biome-ignore lint/suspicious/noExplicitAny: query payload is untyped
function Everything({ d }: { d: any }) {
  return (
    <div className="text-[13px]">
      <p className="mb-2 text-muted-foreground">
        Every script request and video job ever tagged to this client, newest
        first, with the status ClickUp actually holds.
      </p>
      <div className="divide-y rounded-lg border">
        {/* biome-ignore lint/suspicious/noExplicitAny: query rows are untyped */}
        {(d.allTasks as any[]).map(t => (
          <div
            key={t.taskId}
            className="flex items-center justify-between gap-2 px-3 py-1.5"
          >
            <a
              href={t.url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 truncate hover:underline"
              dir="auto"
            >
              {t.name}
            </a>
            <span className="flex shrink-0 items-center gap-2 text-[12px] text-muted-foreground">
              <span>{t.kind}</span>
              <Pill tone={t.open ? "neutral" : "good"}>{t.status}</Pill>
              <span>{when(t.createdAt)}</span>
            </span>
          </div>
        ))}
        {/* biome-ignore lint/suspicious/noExplicitAny: query rows are untyped */}
        {(d.videos as any[]).map(v2 => (
          <div
            key={v2.taskId}
            className="flex items-center justify-between gap-2 px-3 py-1.5"
          >
            <span className="flex min-w-0 items-center gap-1.5 truncate">
              <Film className="h-3 w-3 shrink-0" />
              <a
                href={v2.editedLink || v2.url}
                target="_blank"
                rel="noreferrer"
                className="truncate hover:underline"
                dir="auto"
              >
                {v2.name}
              </a>
            </span>
            <span className="flex shrink-0 items-center gap-2 text-[12px] text-muted-foreground">
              <Pill tone={v2.open ? "neutral" : "good"}>{v2.status}</Pill>
              <span>
                {v2.editors.length ? v2.editors.join(", ") : "unassigned"}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The SOP touchpoint floor, with a message you can send in one click. */
// biome-ignore lint/suspicious/noExplicitAny: query payload is untyped
function TalkToThem({ d, name }: { d: any; name: string }) {
  const log = useMutation(api.creative.logTouch);
  const t = d.touch;

  return (
    <div className="space-y-4 text-[13px]">
      <div className="rounded-lg border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <MessageSquare className="h-3.5 w-3.5" />
          <strong>{t.thisWeek} of 2 touchpoints this week</strong>
          <span className="text-muted-foreground">
            {t.lastTouchAt
              ? `last logged ${when(t.lastTouchAt)}`
              : "nothing logged yet"}
          </span>
          {d.client.phone && (
            <a
              href={`https://wa.me/${String(d.client.phone).replace(/[^0-9]/g, "")}`}
              target="_blank"
              rel="noreferrer"
              className="ml-auto underline underline-offset-2"
            >
              Open their WhatsApp
            </a>
          )}
        </div>
        {t.reasons.length > 0 && (
          <ul className="mt-2 list-disc space-y-0.5 pl-4 text-muted-foreground">
            {t.reasons.map((r: string) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </div>

      {t.drafts.length === 0 ? (
        <p className="text-muted-foreground">
          Nothing on the creative side needs saying today. That is a good day,
          not an empty screen.
        </p>
      ) : (
        t.drafts.map((dr: { label: string; en: string; ar: string }) => (
          <Draft key={dr.label} draft={dr} />
        ))
      )}

      <section>
        <h3 className="mb-1.5 text-[14px] font-bold">
          Templates from the SOP, their name already in them
        </h3>
        <div className="space-y-2">
          {TEMPLATES.map(t => (
            <TemplateCard key={t.id} t={t} client={name} />
          ))}
        </div>
      </section>

      <Button
        size="sm"
        variant="outline"
        onClick={() => void log({ client: name })}
      >
        I messaged them, log the touchpoint
      </Button>
      <p className="text-[12px] text-muted-foreground">
        Your floor is 1 to 2 touchpoints a week per active client, small wins
        included, and a call rather than a text when it is a real concern. Read
        the draft before sending, it is a starting point and not a substitute
        for knowing the client.
      </p>
    </div>
  );
}

function Draft({
  draft,
}: {
  draft: { label: string; en: string; ar: string };
}) {
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const text = lang === "ar" ? draft.ar : draft.en;
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-1.5 flex items-center gap-2">
        <strong className="text-[13px]">{draft.label}</strong>
        <button
          type="button"
          onClick={() => setLang(lang === "ar" ? "en" : "ar")}
          className="rounded border px-1.5 py-0.5 text-[12px] text-muted-foreground hover:bg-muted"
        >
          {lang === "ar" ? "English" : "العربية"}
        </button>
        <span className="ml-auto">
          <CopyButton text={text} label="Copy message" />
        </span>
      </div>
      <p dir="auto" className="whitespace-pre-wrap">
        {text}
      </p>
    </div>
  );
}

/** One click from "this client needs a video" to a task the editors see. */
function NewVideoRequest({
  client,
  drive,
  onQueue,
  busy,
}: {
  client: string;
  drive?: string | null;
  onQueue: (kind: string, taskId?: string, payload?: unknown) => Promise<void>;
  busy: string | null;
}) {
  const [show, setShow] = useState(false);
  const [type, setType] = useState("New Video Request 🎥");
  const [brief, setBrief] = useState("");
  // Their raw footage folder is already on the client record, so you never
  // pastes it by hand. He can still override it for a one-off folder.
  const [footage, setFootage] = useState(drive ?? "");
  const [due, setDue] = useState("");

  if (!show) {
    return (
      <Button size="sm" variant="outline" onClick={() => setShow(true)}>
        <Film className="mr-1.5 h-3.5 w-3.5" />
        New video request for {client}
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border p-2.5">
      <h4 className="font-semibold">New video request</h4>
      <div className="grid gap-2 sm:grid-cols-2">
        <select
          value={type}
          onChange={e => setType(e.target.value)}
          className="rounded border bg-transparent px-2 py-1.5 text-[13px]"
        >
          <option>New Video Request 🎥</option>
          <option>Edit Video Request 🎥</option>
        </select>
        <input
          type="date"
          value={due}
          onChange={e => setDue(e.target.value)}
          className="rounded border bg-transparent px-2 py-1.5 text-[13px]"
        />
      </div>
      <input
        value={footage}
        onChange={e => setFootage(e.target.value)}
        placeholder="Raw footage folder link"
        className="w-full rounded border bg-transparent px-2 py-1.5 text-[13px]"
      />
      <textarea
        value={brief}
        onChange={e => setBrief(e.target.value)}
        placeholder="The brief: hook, angle, what the client must not say"
        rows={3}
        className="w-full rounded border bg-transparent px-2 py-1.5 text-[13px]"
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!brief.trim() || busy !== null}
          onClick={async () => {
            await onQueue("videoRequest", undefined, {
              client,
              type,
              brief,
              footage,
              due,
            });
            setShow(false);
            setBrief("");
          }}
        >
          Send to the editors
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShow(false)}>
          Cancel
        </Button>
      </div>
      <p className="text-[12px] text-muted-foreground">
        Creates a tagged task on the Video Pipeline on the next sync, within 15
        minutes. Needs a brief and nothing else, the rest is filled from their
        client record. If you would rather use the ClickUp form directly, open{" "}
        <a
          href="https://forms.clickup.com/90182518398/f/2kzmr1ky-1058/E1LP6F3OHFC3WACLU8"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          the video request form
        </a>
        .
      </p>
    </div>
  );
}

/**
 * The funnel behind this client's ads: the form and its exact questions, or the
 * page the ads point at. Read from Meta, matched to the client's ad account.
 */
function TheirFunnel({ name }: { name: string }) {
  const data = useQuery(api.funnels.list, { client: name });
  if (!data) return <p className="text-[13px]">Loading…</p>;
  if (data.rows.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        Nothing live to script against. Either no ad has spent in the last 30
        days, or their Meta ad account name does not match the client name on
        the board. The full list is on the Funnels and forms page.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-[13px] text-muted-foreground">
        Where their leads come in right now. If the ad promises one thing and
        the form asks another, that is the leak, and it is yours to fix.
      </p>
      {/* biome-ignore lint/suspicious/noExplicitAny: untyped payload */}
      {data.rows.map((r: any) => (
        <FunnelRow key={`${r.account}-${r.formId || r.url || r.kind}`} r={r} />
      ))}
    </div>
  );
}
