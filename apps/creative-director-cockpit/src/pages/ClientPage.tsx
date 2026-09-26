import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  ArrowUpRight,
  Download,
  Film,
  Lightbulb,
  LoaderCircle,
  MessageSquare,
  MoreHorizontal,
  Rocket,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { ClientUpdates } from "@/components/ClientUpdates";
import {
  CreativePreview,
  stillPropsFor,
  useLocalStills,
} from "@/components/CreativePreview";
import { DosDontsCard } from "@/components/DosDonts";
import { TemplateCard } from "@/components/TemplateCard";
import { bucketDays, TrendChart } from "@/components/TrendChart";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

/** Shorter words on the tab row, so it fits one line on a phone. */
const TAB_LABEL: Record<Tab, string> = {
  "Script from here": "Script",
  "Their funnel": "Funnel",
  "Work in flight": "In flight",
  "Everything we made": "All work",
  "Talk to them": "Talk to them",
};

/**
 * Pre-launch statuses, the only ones worth colour on the status chip.
 * Display only: mirrors PRELAUNCH_STATUSES in convex/clients.ts, which is
 * what decides anything that matters.
 */
const PRELAUNCH = new Set([
  "launch booked",
  "ready for launch🚀",
  "ready for launch",
  "onboarding booked",
]);

/** A group heading inside a tab. */
const H3 = "text-[15px] font-semibold";

function when(ms?: number | null): string {
  if (!ms) return "no date";
  const d = Math.round((ms - Date.now()) / DAY);
  if (d === 0) return "today";
  return d > 0 ? `in ${d}d` : `${Math.abs(d)}d ago`;
}

function money(n?: number | null): string {
  return n === undefined || n === null ? "n/a" : `$${n.toFixed(2)}`;
}

/** A status chip: the words stay plain, a dot carries the colour. */
function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "good" | "warn" | "bad" | "neutral";
}) {
  const dot =
    tone === "good"
      ? "var(--success)"
      : tone === "warn"
        ? "var(--warning)"
        : tone === "bad"
          ? "var(--destructive)"
          : null;
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium">
      {dot ? (
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full"
          style={{ background: dot }}
        />
      ) : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** One document on the client record, as a chip: one icon, the arrow out. */
function DocChip({
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
      <span
        title="Not on the client record yet"
        className="inline-flex h-8 items-center rounded-full border border-dashed px-3 text-xs text-muted-foreground"
      >
        {label}, not on file
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={hint}
      className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors hover:bg-muted"
    >
      {label}
      <ArrowUpRight className="size-3.5 text-muted-foreground" />
    </a>
  );
}

type PackCounts = {
  campaigns: number;
  ads: number;
  transcripts: number;
  funnels: number;
  plays: number;
  tasks: number;
  videos: number;
};

/**
 * Extract everything we hold on a client into one markdown file.
 *
 * Aziz, 2026-09-08: when scripting, or when handing the client to another LLM,
 * the context should be one download, not a hunt across ClickUp, Meta and Drive.
 * The pack is built server side by clients.contextPack so nothing on it is
 * assembled from what happens to be rendered on screen.
 *
 * The first press (from the page's More menu) builds it; the panel under the
 * header then offers the download, as the button always did.
 */
function useContextPack(name: string) {
  const [wanted, setWanted] = useState(false);
  const pack = useQuery(api.clients.contextPack, wanted ? { name } : "skip");
  // What the last download held. The query is switched off once the file is
  // built, so the pack does not keep re-running on every feed.
  const [done, setDone] = useState<null | PackCounts>(null);

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
    setDone(pack.counts);
    setWanted(false);
  }

  const label =
    wanted && !pack
      ? "Building the pack…"
      : pack
        ? "Download the context pack"
        : done
          ? "Extract client context again"
          : "Extract client context";
  return {
    active: wanted || Boolean(pack) || Boolean(done),
    building: wanted && !pack,
    label,
    counts: (pack?.counts ?? done) as PackCounts | null,
    downloaded: Boolean(done) && !pack,
    download,
  };
}

function ContextPackPanel({ ctx }: { ctx: ReturnType<typeof useContextPack> }) {
  if (!ctx.active) return null;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl bg-muted/40 px-4 py-3">
      <Button
        size="sm"
        variant="outline"
        disabled={ctx.building}
        onClick={ctx.download}
      >
        {ctx.building ? (
          <LoaderCircle className="animate-spin" />
        ) : (
          <Download />
        )}
        {ctx.label}
      </Button>
      {ctx.counts && (
        <span className="min-w-0 text-xs text-muted-foreground">
          {ctx.counts.campaigns} campaigns, {ctx.counts.ads} ads,{" "}
          {ctx.counts.transcripts} transcripts, {ctx.counts.funnels} funnels,{" "}
          {ctx.counts.plays} ad sets, {ctx.counts.tasks} board rows,{" "}
          {ctx.counts.videos} videos. Documents are linked, not embedded.
          {ctx.downloaded ? " Downloaded." : ""}
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
 * A rate with no denominator is shown as "no data", never as 0%. One compact
 * row: the rates in view, what each is counted from folded under them.
 */
// biome-ignore lint/suspicious/noExplicitAny: query payload is untyped
function ClientStats({ s }: { s: any }) {
  if (!s) {
    return (
      <p className="text-sm text-muted-foreground">
        No appointments on their stat sheet this month, so booking, show,
        quotation and close rates cannot be worked out yet.
      </p>
    );
  }
  const cells: {
    label: string;
    short: string;
    value: number | null;
    sub: string;
  }[] = [
    {
      label: "Booking rate",
      short: "Booking",
      value: s.bookingRate,
      sub: `${s.booked} booked off ${s.leads30} leads`,
    },
    {
      label: "Show rate",
      short: "Show",
      value: s.showRate,
      sub: `${s.shows} showed of ${s.due ?? s.booked} that came due`,
    },
    {
      label: "Quotation rate",
      short: "Quotation",
      value: s.quotationRate,
      sub: `${s.quotes} quoted off ${s.shows} shows`,
    },
    {
      label: "Close rate",
      short: "Close",
      value: s.closeRate,
      sub: `${s.closes} closed off ${s.quotes} quotes`,
    },
  ];
  return (
    <section className="rounded-2xl border bg-card p-4 sm:p-6">
      <div className="grid grid-cols-4 gap-2 sm:gap-6">
        {cells.map(c => (
          <div key={c.label} className="min-w-0" title={c.sub}>
            {c.value === null ? (
              <div className="flex h-7 items-end text-sm text-muted-foreground">
                no data
              </div>
            ) : (
              <div className="whitespace-nowrap text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
                {c.value}%
              </div>
            )}
            <div className="truncate text-xs text-muted-foreground">
              <span className="sm:hidden">{c.short}</span>
              <span className="hidden sm:inline">{c.label}</span>
            </div>
          </div>
        ))}
      </div>
      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="w-fit">From their {s.month} stat sheet</summary>
        <ul className="mt-2 space-y-0.5">
          {cells.map(c => (
            <li key={c.label}>
              {c.label}: {c.sub}
            </li>
          ))}
        </ul>
        <p className="mt-2">
          {s.month} on their stat sheet. Booking rate counts appointments
          against the leads Meta reported in the last 30 days, so treat it as a
          direction, not an exact ratio.
        </p>
      </details>
    </section>
  );
}

/** One click puts a client's own ad on the Ideation board (Aziz, 2026-09-18). */
function SaveAdToIdeation(props: {
  metaAdId: string;
  client: string;
  name?: string;
  campaignName?: string;
  thumbUrl?: string;
  spend?: number;
  leads?: number;
  cpl?: number;
  live?: boolean;
}) {
  const save = useAction(api.ideation.saveFromClientAd);
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const label =
    state === "busy" ? "Saving…" : state === "done" ? "Saved" : "To Ideation";
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={state !== "idle"}
      onClick={() => {
        setState("busy");
        void save(props)
          .then(() => {
            setState("done");
            toast.success("On the Ideation board, under Saved ideas.");
            setTimeout(() => setState("idle"), 2500);
          })
          .catch(e => {
            setState("idle");
            toast.error(String((e as Error)?.message ?? e).split("\n")[0]);
          });
      }}
      className="shrink-0"
      title="Save this ad to the Ideation board"
      aria-label={label}
    >
      <Lightbulb />
      {/* Just the bulb on a phone, so the ad's name keeps its room; the
          toast still says where it went. */}
      <span className="hidden sm:inline">{label}</span>
    </Button>
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
      <h3 className={`mb-3 ${H3}`}>Trends, last 90 days</h3>
      <div className="grid gap-4 md:grid-cols-3">
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
  const ctx = useContextPack(d?.client?.name ?? name);

  if (d === undefined) {
    return (
      <p className="mx-auto w-full max-w-6xl text-sm text-muted-foreground">
        Loading…
      </p>
    );
  }
  if (d === null) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-2 text-sm">
        <p className="txt-bad">
          No client called “{name}” on the ClickUp client board.
        </p>
        <Link to="/clients" className="text-primary hover:underline">
          Back to clients
        </Link>
      </div>
    );
  }

  const status: string | undefined = d.client.clientStatus;
  const prelaunch = PRELAUNCH.has((status ?? "").toLowerCase());

  return (
    <div className="mx-auto w-full max-w-6xl">
      <Link
        to="/clients"
        className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All clients
      </Link>

      {/* The page header, with the client's status beside the name. */}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1
              className="min-w-0 text-2xl font-semibold tracking-tight sm:text-[28px] sm:leading-9"
              dir="auto"
            >
              {d.client.name}
            </h1>
            <Pill tone={prelaunch ? "warn" : "neutral"}>
              {status ?? "No status"}
            </Pill>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {d.serviceLine ?? "Service not set"} · launch{" "}
            {when(d.client.launchDate)} · {d.liveNow.length} ads live ·{" "}
            {d.videos.filter((v: { open: boolean }) => v.open).length} videos in
            flight
          </p>
        </div>
        <div className="flex items-center gap-2">
          {d.client.url && (
            <Button asChild size="sm" variant="outline">
              <a href={d.client.url} target="_blank" rel="noreferrer">
                ClickUp record
                <ArrowUpRight />
              </a>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" aria-label="More">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={ctx.download}>
                <Download />
                {ctx.label}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <ContextPackPanel ctx={ctx} />

      <div className="mb-6 space-y-4">
        <ClientStats s={d.stats} />

        <div className="flex flex-wrap gap-2">
          <DocChip
            href={d.client.docs.brandDna}
            label="Brand DNA"
            hint="How they are allowed to sound and look"
          />
          <DocChip
            href={d.client.docs.offerCheatSheet}
            label="Offer creation strategy"
            hint="The offer every script has to sell"
          />
          <DocChip
            href={d.client.docs.research}
            label="Market research"
            hint="Their market, their buyer"
          />
          <DocChip
            href={d.client.docs.drive}
            label="Drive folder"
            hint="Raw footage and brand assets"
          />
        </div>

        {/* Side by side when both show; one alone takes the full width. */}
        <div className="flex flex-wrap gap-4 [&>*]:min-w-0 [&>*]:flex-1 [&>*]:basis-80">
          <DosDontsCard text={d.client.dosDonts} url={d.client.url} />
          <ClientUpdates
            updates={d.client.updates}
            focus="creative"
            url={d.client.url}
          />
        </div>
      </div>

      {/* One row that scrolls sideways on a phone instead of wrapping. */}
      <div
        role="tablist"
        aria-label="Client"
        className="-mx-4 mb-6 flex flex-nowrap overflow-x-auto border-b px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {TABS.map(t => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            title={t}
            onClick={() => setTab(t)}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {TAB_LABEL[t]}
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
  // One look-up for every saved picture this tab shows.
  const history = (d.history as any[]).slice(0, 12);
  const stills = useLocalStills([
    ...(d.liveNow as any[]).map(a => a.stillKey),
    ...history.map(a => a.stillKey),
    ...((winners?.rows ?? []) as any[]).map(r => r.stillKey),
  ]);

  return (
    <div className="space-y-8">
      <section>
        <h3 className={`mb-3 flex items-center gap-2 ${H3}`}>
          <Rocket className="size-4 text-muted-foreground" />
          Live on their account right now ({d.liveNow.length})
        </h3>
        {d.liveNow.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing active. Whatever you write next is what goes live first.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {/* biome-ignore lint/suspicious/noExplicitAny: query rows are untyped */}
            {(d.liveNow as any[]).map(a => (
              <div
                key={a.metaId}
                className="flex items-center gap-3 rounded-xl border bg-card p-3"
              >
                <CreativePreview
                  name={a.name}
                  metaAdId={a.metaId}
                  accountId={a.accountId ?? undefined}
                  campaignName={a.campaignName}
                  clientName={d.client.name}
                  thumbUrl={a.thumbUrl ?? undefined}
                  {...stillPropsFor(a, stills)}
                  size="md"
                />
                <span className="min-w-0 flex-1 text-xs">
                  <span
                    className="block truncate text-sm font-medium"
                    dir="auto"
                  >
                    {a.name}
                  </span>
                  <span className="block truncate text-muted-foreground">
                    {a.campaignName}
                  </span>
                </span>
                <SaveAdToIdeation
                  metaAdId={String(a.metaId)}
                  client={d.client.name}
                  name={a.name}
                  campaignName={a.campaignName}
                  thumbUrl={a.thumbUrl ?? undefined}
                  live
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {d.history.length > 0 && (
        <section>
          <h3 className={`mb-3 ${H3}`}>
            What has already run for them ({d.history.length})
          </h3>
          <div className="divide-y rounded-xl border">
            {history.map(a => (
              <div
                key={`${a.campaignName}:${a.adName}`}
                className="flex items-center gap-3 px-3 py-2.5 text-sm"
              >
                <CreativePreview
                  name={a.adName}
                  metaAdId={a.metaAdId ?? undefined}
                  accountId={a.accountId ?? undefined}
                  campaignName={a.campaignName}
                  clientName={d.client.name}
                  thumbUrl={a.thumbnailUrl ?? undefined}
                  {...stillPropsFor(a, stills)}
                />
                {/* The numbers take their own line on a phone rather than
                    squeezing the ad's name to nothing. */}
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span className="min-w-0 flex-1 truncate" dir="auto">
                    {a.adName}
                  </span>
                  <span className="basis-full text-xs text-muted-foreground tabular-nums sm:basis-auto">
                    {money(a.spend)} spend · {a.leads} leads · {money(a.cpl)}{" "}
                    CPL
                  </span>
                </span>
                {a.metaAdId ? (
                  <SaveAdToIdeation
                    metaAdId={String(a.metaAdId)}
                    client={d.client.name}
                    name={a.adName}
                    campaignName={a.campaignName}
                    thumbUrl={a.thumbnailUrl ?? undefined}
                    spend={a.spend}
                    leads={a.leads}
                    cpl={a.cpl}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </section>
      )}

      <ClientTrends client={d.client} />

      <section>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className={H3}>Proven ads to build this script on</h3>
          <AnimatedSelect
            value={scope}
            onChange={e => setScope(e.target.value as "service" | "all")}
            aria-label="Service line"
            className="ml-auto h-8 rounded-md border bg-transparent px-3 text-xs"
          >
            <option value="service">
              {serviceLineOf(service) || "Their service line"}
            </option>
            <option value="all">Every service line</option>
          </AnimatedSelect>
        </div>
        <WinningAds
          rows={winners?.rows}
          local={stills}
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
    <div className="space-y-6 text-sm">
      {feedback && (
        // A queued change is a confirmation, so it is quiet; only a
        // failure gets colour.
        <div
          role="status"
          className={
            feedback.tone === "bad"
              ? "callout-bad rounded-xl border px-4 py-3"
              : "rounded-xl bg-muted/60 px-4 py-3"
          }
        >
          {feedback.text}
        </div>
      )}
      {d.tasks.length === 0 && openVideos.length === 0 ? (
        <p className="text-muted-foreground">Nothing open for this client.</p>
      ) : (
        <div className="divide-y rounded-xl border">
          {/* biome-ignore lint/suspicious/noExplicitAny: query rows are untyped */}
          {(d.tasks as any[]).map(t => (
            <div
              key={t.taskId}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
            >
              <span
                className="min-w-0 flex-1 basis-full truncate sm:basis-0"
                dir="auto"
              >
                <a
                  href={t.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium hover:underline"
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
              <Pill>{t.status}</Pill>
              <span className="text-xs text-muted-foreground">
                opened {when(t.createdAt)}
              </span>
              <TaskActions
                taskId={t.taskId}
                act={act}
                busy={busy}
                pending={inFlight.has(t.taskId)}
                failed={lastFailed.get(t.taskId)}
              />
            </div>
          ))}
          {/* biome-ignore lint/suspicious/noExplicitAny: query rows are untyped */}
          {(d.videos as any[])
            .filter(v2 => v2.open)
            .map(v2 => (
              <div
                key={v2.taskId}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
              >
                <span className="flex min-w-0 flex-1 basis-full items-center gap-2 sm:basis-0">
                  <Film className="size-3.5 shrink-0 text-muted-foreground" />
                  <a
                    href={v2.url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate font-medium hover:underline"
                    dir="auto"
                  >
                    {v2.name}
                  </a>
                </span>
                <Pill
                  tone={
                    (v2.status || "").toLowerCase() === "client review"
                      ? "warn"
                      : "neutral"
                  }
                >
                  {v2.status}
                </Pill>
                <span className="text-xs text-muted-foreground">
                  {v2.editors.length ? v2.editors.join(", ") : "unassigned"}
                </span>
                <TaskActions
                  taskId={v2.taskId}
                  act={act}
                  busy={busy}
                  pending={inFlight.has(v2.taskId)}
                  failed={lastFailed.get(v2.taskId)}
                />
              </div>
            ))}
        </div>
      )}

      <section>
        <h3 className={H3}>Comment on their newest task</h3>
        {d.tasks[0] && (
          <p className="mt-1 text-xs text-muted-foreground" dir="auto">
            Posting to: {d.tasks[0].name}
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <Input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Your update, posted to ClickUp"
            className="min-w-0 flex-1"
          />
          <Button
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
      </section>

      <NewVideoRequest
        client={name}
        drive={d.client.docs?.drive}
        onQueue={act}
        busy={busy}
      />
    </div>
  );
}

/**
 * A row's two actions, and the comment box on its own line when open. The
 * row is a wrapping flex line, so these sit right on a wide screen and drop
 * under the title on a phone.
 */
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
    return (
      <span className="ml-auto text-xs text-muted-foreground">
        Queued, reaches ClickUp within a minute
      </span>
    );
  }
  return (
    <>
      <span className="ml-auto flex items-center gap-2">
        {!show && (
          <Button size="sm" variant="ghost" onClick={() => setShow(true)}>
            Comment
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => act("complete", taskId)}
          title="Moves it to the list's own done status: complete on Media / Creative, live on the Video Pipeline"
        >
          Mark done
        </Button>
      </span>
      {failed && (
        <span className="txt-bad basis-full text-xs" title={failed}>
          Last one failed: {failed.slice(0, 60)}
        </span>
      )}
      {show && (
        <span className="flex basis-full items-center gap-2">
          <Input
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Comment"
            aria-label="Comment"
            className="h-8 min-w-0 flex-1"
          />
          <Button
            size="sm"
            disabled={!text.trim() || busy !== null}
            onClick={async () => {
              await act("comment", taskId, { text });
              setText("");
              setShow(false);
            }}
          >
            Post
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShow(false)}>
            Cancel
          </Button>
        </span>
      )}
    </>
  );
}

// biome-ignore lint/suspicious/noExplicitAny: query payload is untyped
function Everything({ d }: { d: any }) {
  return (
    <div className="text-sm">
      <p className="mb-3 text-muted-foreground">
        Every script request and video job ever tagged to this client, newest
        first, with the status ClickUp actually holds.
      </p>
      <div className="divide-y rounded-xl border">
        {/* biome-ignore lint/suspicious/noExplicitAny: query rows are untyped */}
        {(d.allTasks as any[]).map(t => (
          <div
            key={t.taskId}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5"
          >
            <a
              href={t.url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 truncate hover:underline"
              dir="auto"
            >
              {t.name}
            </a>
            <span className="flex basis-full flex-wrap items-center gap-2 text-xs text-muted-foreground sm:basis-auto">
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
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5"
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <Film className="size-3.5 shrink-0 text-muted-foreground" />
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
            <span className="flex basis-full flex-wrap items-center gap-2 text-xs text-muted-foreground sm:basis-auto">
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
    <div className="space-y-6 text-sm">
      <section className="rounded-2xl border bg-card p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
          <strong className="font-semibold">
            {t.thisWeek} of 2 touchpoints this week
          </strong>
          <span className="text-xs text-muted-foreground">
            {t.lastTouchAt
              ? `last logged ${when(t.lastTouchAt)}`
              : "nothing logged yet"}
          </span>
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {d.client.phone && (
              <Button asChild size="sm" variant="ghost">
                <a
                  href={`https://wa.me/${String(d.client.phone).replace(/[^0-9]/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open their WhatsApp
                  <ArrowUpRight />
                </a>
              </Button>
            )}
            {/* The same log as the touchpoints screen, under the same name. */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => void log({ client: name })}
            >
              Log touchpoint
            </Button>
          </span>
        </div>
        {t.reasons.length > 0 && (
          <ul className="mt-3 list-disc space-y-0.5 pl-4 text-muted-foreground">
            {t.reasons.map((r: string) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="w-fit">How the floor works</summary>
          <p className="mt-1">
            Your floor is 1 to 2 touchpoints a week per active client, small
            wins included, and a call rather than a text when it is a real
            concern. Read the draft before sending, it is a starting point and
            not a substitute for knowing the client.
          </p>
        </details>
      </section>

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
        <h3 className={`mb-3 ${H3}`}>
          Templates from the SOP, their name already in them
        </h3>
        <div className="divide-y rounded-xl border">
          {TEMPLATES.map(t => (
            <TemplateCard key={t.id} t={t} client={name} />
          ))}
        </div>
      </section>
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
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <strong className="min-w-0 text-sm font-semibold">{draft.label}</strong>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setLang(lang === "ar" ? "en" : "ar")}
        >
          {lang === "ar" ? "English" : "العربية"}
        </Button>
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
  // The value is ClickUp's own option name, emoji and all; only the label
  // on screen is plain.
  const [type, setType] = useState("New Video Request 🎥");
  const [brief, setBrief] = useState("");
  // Their raw footage folder is already on the client record, so you never
  // pastes it by hand. He can still override it for a one-off folder.
  const [footage, setFootage] = useState(drive ?? "");
  const [due, setDue] = useState("");

  if (!show) {
    return (
      <Button
        variant="outline"
        className="max-w-full"
        onClick={() => setShow(true)}
      >
        <Film />
        <span className="truncate">New video request for {client}</span>
      </Button>
    );
  }

  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4 sm:p-6">
      <h3 className={H3}>New video request</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        <AnimatedSelect
          value={type}
          onChange={e => setType(e.target.value)}
          aria-label="Kind of request"
          className="h-9 rounded-md border bg-transparent px-3 text-sm"
        >
          <option value="New Video Request 🎥">New video</option>
          <option value="Edit Video Request 🎥">Edit video</option>
        </AnimatedSelect>
        <DateInput
          value={due}
          onChange={e => setDue(e.target.value)}
          className="h-9 rounded-md border bg-transparent px-3 text-sm"
        />
      </div>
      <Input
        value={footage}
        onChange={e => setFootage(e.target.value)}
        placeholder="Raw footage folder link"
      />
      <Textarea
        value={brief}
        onChange={e => setBrief(e.target.value)}
        placeholder="The brief: hook, angle, what the client must not say"
        rows={3}
        className="text-sm"
      />
      <div className="flex gap-2">
        <Button
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
        <Button variant="ghost" onClick={() => setShow(false)}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Creates a tagged task on the Video Pipeline on the next sync, within 15
        minutes. Needs a brief and nothing else, the rest is filled from their
        client record. If you would rather use the ClickUp form directly, open{" "}
        <a
          href="https://forms.clickup.com/90182518398/f/2kzmr1ky-1058/E1LP6F3OHFC3WACLU8"
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline"
        >
          the video request form
        </a>
        .
      </p>
    </section>
  );
}

/**
 * The funnel behind this client's ads: the form and its exact questions, or the
 * page the ads point at. Read from Meta, matched to the client's ad account.
 */
function TheirFunnel({ name }: { name: string }) {
  const data = useQuery(api.funnels.list, { client: name });
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (data.rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing live to script against. Either no ad has spent in the last 30
        days, or their Meta ad account name does not match the client name on
        the board. The full list is on the Funnels and forms page.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
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
