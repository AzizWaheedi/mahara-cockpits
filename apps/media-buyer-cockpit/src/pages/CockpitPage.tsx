import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  MessageSquareWarning,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { AccountView } from "@/components/AccountView";
import { BuildPanel } from "@/components/BuildPanel";
import { CampaignRange } from "@/components/CampaignRange";
import { CityPicker } from "@/components/CityPicker";
import {
  type ClientUpdate,
  ClientUpdateList,
  relevantUpdates,
} from "@/components/ClientUpdates";
import { CockpitSelect } from "@/components/CockpitSelect";
import { CreativePreview } from "@/components/CreativePreview";
import { DosDontsList, parseDosDonts } from "@/components/DosDonts";
import { EditPanel } from "@/components/EditPanel";
import { LostLeads } from "@/components/LostLeads";
import { Onboardings } from "@/components/Onboardings";
import { RangePicker } from "@/components/RangePicker";
import { StatusToggle } from "@/components/StatusToggle";
import { TodayMeetings } from "@/components/TodayMeetings";
import { TrackingIssues } from "@/components/TrackingIssues";
import { PortfolioTrends } from "@/components/Trends";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ViktorStatus } from "@/components/ViktorStatus";
import { WhatsAppDesk } from "@/components/WhatsAppDesk";
import { useContentTransition } from "@/hooks/use-content-transition";
import { CPB_GATE, CPL_GATE, LEARNING_DAYS } from "@/lib/kpi";
import { defaultRange, type Range } from "@/lib/range";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { CampaignChangesResults } from "../components/CampaignChangesResults";
import { CampaignChat } from "../components/CampaignChat";
import { RequestCreativeButton } from "../components/RequestCreativeButton";

/** What one role can actually ask another for. Picking the request picks the board. */
const REQUESTS: { label: string; dept: string; deptLabel: string }[] = [
  {
    label: "Thank-you video to lift show rate",
    dept: "creative",
    deptLabel: "Creative director",
  },
  { label: "Switch to a landing page", dept: "tech", deptLabel: "Tech" },
  {
    label: "Add qualification questions to the lead form",
    dept: "tech",
    deptLabel: "Tech",
  },
  {
    label: "Landing page or tracking is broken",
    dept: "tech",
    deptLabel: "Tech",
  },
  {
    label: "Lead quality: client needs a conversation",
    dept: "client_success",
    deptLabel: "CSM",
  },
  {
    label: "Leads are not being called",
    dept: "call_center",
    deptLabel: "Call centre",
  },
  {
    label: "Show rate SOP needed for this account",
    dept: "call_center",
    deptLabel: "Call centre",
  },
];
const REASONS = [
  "Client hasn't approved the budget",
  "Waiting on creative",
  "Card / payment issue",
  "Already actioned elsewhere",
  "Disagree with the call",
];
const CLOCKS = [
  "Tomorrow",
  "In 3 days",
  "Next week",
  "Only if the number gets worse",
];

/** One problem at a time — the filters mirror the way the SOP prioritises the day. */
const FILTERS: { label: string; test: (c: Campaign) => boolean }[] = [
  { label: "Everything", test: () => true },
  {
    label: "Critical",
    test: c =>
      c.verdict === "kill" ||
      c.verdict === "off board" ||
      (c.leads7d === 0 && c.spend7d > 20),
  },
  { label: "Below KPI", test: c => c.cpl !== undefined && c.cpl > CPL_GATE },
  {
    label: "Fatiguing",
    test: c => c.verdict === "fatiguing" || (c.daysLive ?? 0) >= 14,
  },
  { label: "Under the floor", test: c => c.dayRate < 30 },
  {
    label: `Cost per booking over $${CPB_GATE}`,
    test: c => (c.costPerBooking ?? 0) > CPB_GATE,
  },
  { label: "No bookings", test: c => c.bookings7d === 0 && c.spend7d > 20 },
  { label: "Not touched in 4+ days", test: c => (c.daysSinceTouch ?? 99) >= 4 },
  // Needs today's decisions, so the page applies it (see `passes`).
  { label: "Undecided today", test: () => true },
];

/** Straight into Ads Manager, filtered to that one campaign. Meta blocks iframes. */
function adsManagerUrl(c: Campaign): string | undefined {
  if (!c.metaAccountId) return undefined;
  const base = `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${c.metaAccountId}`;
  return c.metaCampaignId
    ? `${base}&selected_campaign_ids=${c.metaCampaignId}&filter_set=SEARCH_BY_CAMPAIGN_GROUP_ID-STRING%1EEQUAL%1E"${c.metaCampaignId}"`
    : base;
}

const money = (n: number | null | undefined, d = 0) =>
  n === null || n === undefined
    ? "—"
    : `$${n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d })}`;

/** An empty value in a cell reads "n/a", never a dash. */
const moneyOr = (n: number | null | undefined, d = 0) =>
  n === null || n === undefined ? "n/a" : money(n, d);

type Tone = "good" | "warn" | "bad" | "neutral";
const TONE_DOT: Record<Tone, string> = {
  good: "var(--success)",
  warn: "var(--warning)",
  bad: "var(--destructive)",
  neutral: "var(--muted-foreground)",
};
const VERDICT_TONE: Record<string, Tone> = {
  scale: "good",
  hold: "warn",
  kill: "bad",
  fatiguing: "warn",
  "off board": "bad",
  "no delivery": "neutral",
  "below KPI": "warn",
};

/** "off board" -> "Off board": raw keys are shown in sentence case. */
const sentence = (s: unknown) => {
  const t = String(s ?? "");
  return t ? t[0].toUpperCase() + t.slice(1) : t;
};

/** Meta's ACTIVE / CAMPAIGN_PAUSED, as words. */
const metaStatus = (s: unknown) =>
  s ? sentence(String(s).toLowerCase().replace(/_/g, " ")) : "Unknown";

/** The status chip: the colour sits on a small dot, the words stay plain. */
function StatusChip({
  tone,
  title,
  children,
}: {
  tone: Tone;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium text-foreground"
    >
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: TONE_DOT[tone] }}
      />
      {children}
    </span>
  );
}

/** Filters and view switches: one selected style everywhere, teal. */
const pill = (on: boolean) =>
  `inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors ${
    on
      ? "border-primary/40 bg-primary/15 text-foreground"
      : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
  }`;
/** Option chips in a form: the same selected style, a hairline when not picked. */
const choice = (on: boolean) =>
  `inline-flex min-h-8 items-center rounded-full border px-3 py-1 text-left text-xs font-medium transition-colors ${
    on
      ? "border-primary/40 bg-primary/15 text-foreground"
      : "text-muted-foreground hover:bg-muted hover:text-foreground"
  }`;
const CARD = "rounded-2xl border bg-card p-4 sm:p-6";
const KICKER =
  "font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground";

// biome-ignore lint/suspicious/noExplicitAny: snapshot payload is untyped by design
type Campaign = any;

/** Who a decision was sent to, in words: "client_success" reads "CSM". */
const DEPT_LABEL: Record<string, string> = Object.fromEntries(
  REQUESTS.map(r => [r.dept, r.deptLabel]),
);
const deptLabel = (key: string) =>
  DEPT_LABEL[key] ?? sentence(key.replace(/_/g, " "));

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
/** "2026-09-12" -> "12 Sep". */
const dayMonth = (iso: unknown) => {
  const [, m, d] = String(iso ?? "")
    .split("-")
    .map(Number);
  return m && d ? `${d} ${MONTHS[m - 1]}` : String(iso ?? "");
};

/**
 * The live Meta structure under one campaign: ad sets, then each ad as a card
 * with its saved picture. "Watch" swaps in Meta's live preview in place, and
 * only one ad per campaign panel plays at a time, so an open panel never loads
 * a wall of iframes.
 */
function LiveInMeta({ c, tree }: { c: Campaign; tree: Campaign[] }) {
  const [openAdId, setOpenAdId] = useState<string | null>(null);
  if (tree.length === 0) {
    return (
      <p className="mt-4 text-xs text-muted-foreground">
        Ad sets and creative can't be shown for this account yet. It isn't
        shared with our Meta partner ID.
      </p>
    );
  }
  return (
    <div className="mt-6 space-y-3">
      <div className={KICKER}>Live in Meta</div>
      {tree
        .filter((t: Campaign) => t.kind === "adset")
        .map((set: Campaign) => (
          <div key={set._id} className="rounded-xl bg-muted/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{set.name}</span>
              <StatusChip
                tone={
                  (set.effectiveStatus ?? set.status) === "ACTIVE"
                    ? "good"
                    : "neutral"
                }
              >
                {metaStatus(set.effectiveStatus ?? set.status)}
              </StatusChip>
              {set.dailyBudget !== undefined && (
                <span className="text-xs text-muted-foreground">
                  {money(set.dailyBudget, 2)}
                  /day
                </span>
              )}
              <StatusToggle
                compact
                metaId={set.metaId}
                level="adset"
                name={set.name}
                clientTag={c.clientTag}
                campaignName={c.campaignName}
                active={(set.effectiveStatus ?? set.status) === "ACTIVE"}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-3">
              {tree
                .filter(
                  (t: Campaign) => t.kind === "ad" && t.adsetId === set.metaId,
                )
                .map((ad: Campaign) => (
                  <div key={ad._id} className="w-[340px] max-w-full">
                    <div className="mb-1 flex items-center gap-1.5 text-xs">
                      <StatusToggle
                        compact
                        metaId={ad.metaId}
                        level="ad"
                        name={ad.name}
                        clientTag={c.clientTag}
                        campaignName={c.campaignName}
                        active={(ad.effectiveStatus ?? ad.status) === "ACTIVE"}
                      />
                      <span className="min-w-0 truncate font-semibold">
                        {ad.name}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {metaStatus(ad.effectiveStatus ?? ad.status)}
                      </span>
                    </div>
                    <CreativePreview
                      variant="card"
                      name={ad.name}
                      metaAdId={ad.metaId}
                      accountId={ad.accountId ?? c.metaAccountId ?? undefined}
                      stillUrl={ad.stillUrl}
                      stillTinyUrl={ad.stillTinyUrl}
                      thumbUrl={ad.thumbUrl}
                      // Old stored link: used only while under 20 hours old.
                      previewSrc={ad.previewSrc}
                      previewAt={ad.previewAt}
                      open={openAdId === ad.metaId}
                      onOpenChange={open =>
                        setOpenAdId(open ? ad.metaId : null)
                      }
                    />
                  </div>
                ))}
            </div>
          </div>
        ))}
    </div>
  );
}

/**
 * Which recommendation labels are things I can actually carry out in Meta.
 *
 * Everything else is a judgement call and only gets logged. The distinction is
 * shown to her, so a button never implies more than it does. [aziz, 2026-09-06]
 */
function isExecutable(action: string): boolean {
  return (
    action === "Turn it off" ||
    action === "Cut the worst ad" ||
    action === "Scale the winner" ||
    action.startsWith("Raise to")
  );
}

function actionsFor(c: Campaign): string[] {
  if (!c.onBoard && !c.internal)
    return ["Add to Ads Management board", "Confirm it should be running"];
  if (c.verdict === "kill") return ["Turn it off", "Cut the worst ad"];
  if (c.verdict === "fatiguing")
    return ["Queue replacement creative", "Cut the worst ad"];
  // Only a campaign inside the $15 gate earns a one-click raise; the server's
  // "hold" verdict starts just above it and says "watch, do not scale".
  if (c.dayRate < 30 && c.cpl !== undefined && c.cpl <= CPL_GATE) {
    const target =
      c.contractedBudget && c.contractedBudget > c.dayRate
        ? c.contractedBudget
        : 30;
    return [`Raise to $${Math.round(target)}/day`, "Duplicate the winner"];
  }
  // "below KPI" is over the gate too (the ad works, the page does not), so a
  // Meta-executing "Scale the winner" is the wrong first button for it.
  if (c.verdict === "hold" || c.verdict === "below KPI")
    return ["Cut the worst ad", "Watch for 3 days"];
  return ["Scale the winner", "Duplicate the winner"];
}

type View = "sod" | "ads" | "tasks" | "touch" | "eod";

/** Ad Status values that take a campaign out of the active list (the board is the truth). */
const OFF_STATUSES = ["Paused", "Dead Campaign", "Lost Client"];
const isOffOnBoard = (c: Campaign) =>
  OFF_STATUSES.some(
    s => s.toLowerCase() === String(c?.boardAdStatus ?? "").toLowerCase(),
  );
const clientOf = (c: Campaign | undefined) =>
  String(c?.clientName ?? c?.accountName ?? "Unassigned");

/** Digested comments for the client whose links these are (matched on the card id). */
function updatesFor(all: ClientUpdate[] | undefined, links?: Campaign) {
  const taskId = String(links?.url ?? "")
    .split("/")
    .pop();
  return relevantUpdates(
    (all ?? []).filter(
      (u: Campaign) =>
        (taskId && u.taskId === taskId) || u.clientName === links?.name,
    ) as ClientUpdate[],
    "ads",
  );
}

/** The client's name row: their links, and their do's and don'ts and latest card comments one click away. */
function ClientHeader({
  name,
  links,
  updates,
  onOpen,
}: {
  name: string;
  links?: Campaign;
  updates: ClientUpdate[];
  /** Shows this one client in full, in place of the table. */
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const hasRules = parseDosDonts(links?.dosDonts).length > 0;
  return (
    <>
      {onOpen ? (
        <button
          type="button"
          className="campaign-client-name text-left hover:underline"
          onClick={onOpen}
          title={`Show ${name} in full`}
        >
          {name}
        </button>
      ) : (
        <span className="campaign-client-name">{name}</span>
      )}
      <ClientLinks
        links={links}
        dosOpen={open}
        hasUpdates={updates.length > 0}
        onDos={() => setOpen(o => !o)}
      />
      {open && (
        <div className="mt-2 grid max-w-4xl gap-3 rounded-xl bg-card p-3 font-normal text-foreground">
          {hasRules ? <DosDontsList text={links?.dosDonts} /> : null}
          {updates.length ? (
            <div className={hasRules ? "border-t pt-3" : ""}>
              <p className={`mb-1 ${KICKER}`}>From the ClickUp card</p>
              <ClientUpdateList updates={updates} focus="ads" limit={2} />
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}

/** Inside an open campaign: the client's do's and don'ts, and what the last card comment said for the ads. */
function ClientRules({
  name,
  links,
  updates,
}: {
  name: string;
  links?: Campaign;
  updates: ClientUpdate[];
}) {
  const hasRules = parseDosDonts(links?.dosDonts).length > 0;
  const recent = updates.filter(u => Date.now() - u.at < 30 * 86_400_000);
  if (!hasRules && !recent.length) return null;
  return (
    <div className="tone-warn mb-4 grid gap-3 rounded-xl p-3 sm:p-4">
      {hasRules ? (
        <div>
          <p className="mb-2 text-xs font-semibold">
            {name}: do's and don'ts from the client card
          </p>
          <DosDontsList text={links?.dosDonts} />
        </div>
      ) : null}
      {recent.length ? (
        <div>
          <p className="mb-1 text-xs font-semibold">
            From the latest card comment
          </p>
          <ClientUpdateList updates={recent} focus="ads" limit={1} />
        </div>
      ) : null}
    </div>
  );
}

/** A client's links from the ClickUp client list, matched by name or alias. */
function findClientLinks(list: Campaign[], name: string): Campaign | undefined {
  const key = name.trim().toLowerCase();
  const tight = key.replace(/[^a-z0-9\u0600-\u06ff]+/g, "");
  return (
    list.find(l => String(l.name).trim().toLowerCase() === key) ??
    list.find(l =>
      (l.aliases ?? []).some(
        (a: string) =>
          a === key || a.replace(/[^a-z0-9\u0600-\u06ff]+/g, "") === tight,
      ),
    )
  );
}

/** Drive folder, Brand DNA and offer sheet beside the client's name; a missing one says so. */
function ClientLinks({
  links,
  dosOpen,
  hasUpdates,
  onDos,
}: {
  links?: Campaign;
  dosOpen?: boolean;
  hasUpdates?: boolean;
  onDos?: () => void;
}) {
  const item = (href: string | undefined, label: string) =>
    href ? (
      <a
        key={label}
        href={href}
        target="_blank"
        rel="noreferrer"
        className="font-semibold text-primary underline"
      >
        {label}
      </a>
    ) : (
      <span key={label} className="text-muted-foreground">
        no {label}
      </span>
    );
  if (!links)
    return (
      <span className="ml-2 text-xs font-normal text-muted-foreground">
        not on the ClickUp client list
      </span>
    );
  return (
    <span className="campaign-client-assets ml-2 inline-flex flex-wrap gap-2 text-xs font-normal">
      {item(links.driveLink, "Drive")}
      {item(links.brandDnaDoc, "Brand DNA")}
      {item(links.offerCheatSheet, "Offer")}
      {onDos &&
        (parseDosDonts(links.dosDonts).length || hasUpdates ? (
          <button
            type="button"
            onClick={onDos}
            className="font-semibold text-primary underline"
          >
            {dosOpen
              ? "Hide"
              : parseDosDonts(links.dosDonts).length
                ? hasUpdates
                  ? "Do's & don'ts · latest update"
                  : "Do's & don'ts"
                : "Latest update"}
          </button>
        ) : (
          <span className="text-muted-foreground">no do's & don'ts</span>
        ))}
      {item(links.url, "ClickUp")}
    </span>
  );
}

/** The ClickUp options, fetched once per page load and shared by every picker. */
let statusOptionsCache: Promise<string[]> | null = null;

/** The card's Ad Status on the Ads Management board, editable in place. */
function AdStatusPicker({
  campaignName,
  status,
  hasCard,
  taskId,
  clientTag,
}: {
  campaignName: string;
  status?: string;
  hasCard: boolean;
  /** For a board card with no campaign row. */
  taskId?: string;
  clientTag?: string;
}) {
  const loadOptions = useAction(api.board.adStatusOptions);
  const setStatus = useAction(api.board.setAdStatus);
  const [options, setOptions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!hasCard) return;
    if (!statusOptionsCache) statusOptionsCache = loadOptions({});
    statusOptionsCache.then(setOptions).catch(() => setOptions([]));
  }, [hasCard, loadOptions]);
  if (!hasCard) return null;
  const list = options.length ? options : status ? [status] : [];
  return (
    <CockpitSelect
      value={status ?? ""}
      disabled={busy}
      label={`Ad Status for ${campaignName}`}
      placeholder="No status"
      options={Array.from(new Set([...(status ? [status] : []), ...list])).map(
        value => ({ value, label: value }),
      )}
      onValueChange={async next => {
        setBusy(true);
        try {
          const r = await setStatus({
            campaignName,
            status: next,
            ...(taskId ? { taskId, clientTag } : {}),
          });
          if (r.ok) toast.success(`Ad status set to ${next} on the board.`);
          else toast.error(r.error ?? "ClickUp refused that.");
        } catch (err) {
          toast.error(String((err as Error).message ?? err));
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

/** Rename a board card to the campaign it now tracks, instead of waiting for a decision. */
function RenameCardButton({ campaignName }: { campaignName: string }) {
  const rename = useAction(api.board.renameCard);
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="font-semibold underline disabled:opacity-50"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await rename({ campaignName });
          if (r.ok) toast.success("Card renamed on ClickUp.");
          else toast.error(r.error ?? "ClickUp refused that.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Renaming…" : "Rename the card now"}
    </button>
  );
}

/**
 * Every card on the Ads Management board, old ones included: paused, dead and
 * setup cards she can read, reopen in ClickUp, or set back to Live.
 */
function BoardView({
  cards,
  campaigns,
}: {
  cards: Campaign[];
  campaigns: Campaign[];
}) {
  const [tab, setTab] = useState<"notLive" | "live" | "all">("notLive");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  if (!cards.length) return null;
  const spending = new Set(campaigns.map(c => c.taskId).filter(Boolean));
  const isLive = (c: Campaign) =>
    String(c.adStatus ?? "").toLowerCase() === "live";
  const shown = cards
    .filter(c =>
      tab === "all" ? true : tab === "live" ? isLive(c) : !isLive(c),
    )
    .filter(c =>
      `${c.name} ${c.tag ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()),
    )
    .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0));
  const count = (t: "notLive" | "live" | "all") =>
    cards.filter(c =>
      t === "all" ? true : t === "live" ? isLive(c) : !isLive(c),
    ).length;
  return (
    <div className="mt-6 border-t pt-4">
      <button
        type="button"
        className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-sm font-semibold">
          The Ads Management board{" "}
          <span className="font-normal text-muted-foreground">
            {cards.length} cards
          </span>
        </span>
        <span className="text-xs text-muted-foreground">
          {open ? "Hide" : "Show old and paused campaigns"}
        </span>
      </button>
      {open && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {(
              [
                ["notLive", "Not live"],
                ["live", "Live"],
                ["all", "All"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                aria-pressed={tab === k}
                className={pill(tab === k)}
              >
                {label}
                <span className="ml-1.5 tabular-nums opacity-70">
                  {count(k)}
                </span>
              </button>
            ))}
            <input
              className="h-8 w-full rounded-lg border bg-background px-2 text-xs sm:ml-auto sm:w-56"
              placeholder="Find a campaign or client"
              value={q}
              onChange={e => setQ(e.target.value)}
            />
          </div>
          <ul className="mt-3 divide-y text-sm">
            {shown.slice(0, 200).map(c => (
              <li
                key={c.taskId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5"
              >
                <span className="min-w-0 font-medium">{c.name}</span>
                {c.tag && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {c.tag}
                  </span>
                )}
                {spending.has(c.taskId) && (
                  <span className="text-xs txt-good">spending now</span>
                )}
                <span className="text-xs text-muted-foreground sm:ml-auto">
                  {c.updatedAt
                    ? `updated ${new Date(Number(c.updatedAt)).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`
                    : ""}
                </span>
                <AdStatusPicker
                  campaignName={String(c.name)}
                  status={c.adStatus}
                  hasCard
                  taskId={String(c.taskId)}
                  clientTag={c.tag}
                />
                <div className="basis-full">
                  <CityPicker
                    campaignName={String(c.name)}
                    cities={c.advertisingCities}
                    hasCard
                    taskId={String(c.taskId)}
                    clientTag={c.tag}
                  />
                </div>
                {c.url && (
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    ClickUp
                    <ArrowUpRight className="size-3.5" aria-hidden />
                  </a>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Setting a card back to Live puts it in the active list on the next
            sync if its campaign is spending. Past campaigns stay here as
            history.
          </p>
        </>
      )}
    </div>
  );
}

/** Spending campaigns with no card on the ads board, with a button to add one. */
function OffBoardCampaigns({ rows }: { rows: Campaign[] }) {
  const addToBoard = useAction(api.board.addToBoard);
  const dismiss = useAction(api.board.dismissOffBoard);
  const [client, setClient] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (!rows.length) return null;
  return (
    <div className="mt-6 border-t pt-4">
      <h3 className="text-sm font-semibold">
        Spending but not on the ClickUp board{" "}
        <span className="font-normal text-muted-foreground">{rows.length}</span>
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        These campaigns spend on an ad account with no card on the Ads
        Management board, so no other screen tracks them. Add the card here, the
        same card the new-campaign form makes, and it joins the list on the next
        sync.
      </p>
      <ul className="mt-3 divide-y text-sm">
        {rows.map(r => {
          const name = client[r.campaignName] ?? r.clientName ?? "";
          return (
            <li
              key={r.campaignName}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5"
            >
              <span className="min-w-0 font-medium">{r.campaignName}</span>
              <span className="text-xs text-muted-foreground">
                {r.accountName} · ${Number(r.spend7d).toFixed(0)} in 7 days ·{" "}
                {r.leads7d} leads
              </span>
              <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
                <input
                  className="h-8 w-full rounded-lg border bg-background px-2 text-xs sm:w-44"
                  placeholder="Client name (the card's tag)"
                  value={name}
                  onChange={e =>
                    setClient({ ...client, [r.campaignName]: e.target.value })
                  }
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  disabled={!name.trim() || busy === r.campaignName}
                  onClick={async () => {
                    setBusy(r.campaignName);
                    try {
                      const res = await addToBoard({
                        campaignName: r.campaignName,
                        clientName: name.trim(),
                        status: "Live",
                      });
                      if (res.ok) toast.success("Card added to the ads board.");
                      else toast.error(res.error ?? "ClickUp refused that.");
                    } catch (err) {
                      toast.error(String((err as Error).message ?? err));
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {busy === r.campaignName ? "Adding…" : "Add to ClickUp"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs text-muted-foreground"
                  disabled={busy === r.campaignName}
                  onClick={async () => {
                    setBusy(r.campaignName);
                    try {
                      const res = await dismiss({
                        campaignName: r.campaignName,
                      });
                      if (res.ok)
                        toast.success("Removed. It will not be listed again.");
                      else toast.error(res.error ?? "Could not remove it.");
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  Not our campaign
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function StartOfDayPage() {
  return <Cockpit view="sod" />;
}
export function AdsPage() {
  return <Cockpit view="ads" />;
}
export function TaskListPage() {
  return <Cockpit view="tasks" />;
}
export function TouchpointsPage() {
  return <Cockpit view="touch" />;
}
export function EndOfDayPage() {
  return <Cockpit view="eod" />;
}

const TITLES: Record<View, string> = {
  sod: "Start of day",
  ads: "Ads management",
  tasks: "Task list",
  touch: "Client touchpoints",
  eod: "End of day",
};

function Cockpit({ view }: { view: View }) {
  const adsTransition = useContentTransition();
  const snap = useQuery(api.cockpit.snapshot, {});
  const toggleCheck = useMutation(api.cockpit.toggleCheck);
  const decide = useMutation(api.cockpit.decide);
  const run = useAction(api.execute.runAction);
  const addPlanItems = useMutation(api.cockpit.addPlanItems);
  const askForDetail = useMutation(api.cockpit.askForDetail);
  const setClientLanguage = useMutation(api.cockpit.setClientLanguage);
  const removeDecision = useMutation(api.cockpit.removeDecision);
  const saveEod = useMutation(api.cockpit.saveEod);
  const resubmitEod = useMutation(api.cockpit.resubmitEod);
  const sendFeedback = useMutation(api.cockpit.sendFeedback);
  /** Today's EOD row, if one was saved: the submitted state lives here, not in the tab. */
  const eodRow = (snap?.eod ?? null) as {
    submittedAt?: number;
    error?: string;
    answers?: Record<string, unknown>;
  } | null;

  const [open, setOpen] = useState<string | null>(null);
  // The window each campaign is being read over. One default for the screen,
  // overridable per campaign — she often wants "today" on one client while
  // the rest stay on the 7-day read. [aziz, 2026-09-07]
  const [globalRange, setGlobalRange] = useState<Range>(defaultRange);
  const [ranges, setRanges] = useState<Record<string, Range>>({});
  const rangeFor = (name: string) => ranges[name] ?? globalRange;
  const setRange = (name: string, r: Range) =>
    setRanges(prev => ({ ...prev, [name]: r }));
  const [mode, setMode] = useState<"ads" | "reroute" | "leave">("ads");
  const [campaignPanelTab, setCampaignPanelTab] = useState<
    "recommendations" | "changes"
  >("recommendations");
  const [dept, setDept] = useState(REQUESTS[0].label);
  const [reason, setReason] = useState(REASONS[0]);
  const [clock, setClock] = useState(CLOCKS[1]);
  const [dump, setDump] = useState("");
  const [ask, setAsk] = useState<string | null>(null);
  const [askText, setAskText] = useState("");
  const [askWho, setAskWho] = useState<string>("");
  const [filter, setFilter] = useState(FILTERS[0].label);
  // Ads management has two tabs: what is running, and what the board has off
  // with nothing running on Meta. [Aziz, 2026-09-14]
  const [adsTab, setAdsTab] = useState<"running" | "off">("running");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [onePercent, setOnePercent] = useState("");
  const [eodSending, setEodSending] = useState(false);
  /** When set, the ads tab shows one client in full instead of the table. */
  const [accountView, setAccountView] = useState<string | null>(null);
  /** The EOD form's own human answers. Numbers are filled in for her. */
  const [eodForm, setEodForm] = useState<Record<string, string>>({
    focus: "",
    energy: "",
    biology: "",
    dashboard: "Yes",
    onBudget: "Yes",
    flagged: "Yes",
    videoRequests: "Yes",
    creativesUploaded: "Yes",
    launchedPaused: "Yes",
    accountSummary: "",
    outOfKpi: "",
  });
  const setEod = (k: string, val: string) =>
    setEodForm(f => ({ ...f, [k]: val }));
  // Switching tabs remounts this component and a reload clears it, but
  // today's row may already be saved: show what was filed rather than an
  // empty form under a "Submitted" button.
  const eodSeeded = useRef(false);
  useEffect(() => {
    const a = eodRow?.answers;
    if (!a || eodSeeded.current) return;
    eodSeeded.current = true;
    setEodForm(f => {
      const next = { ...f };
      for (const k of Object.keys(f)) {
        const val = a[k];
        if (typeof val === "string") next[k] = val;
      }
      return next;
    });
    if (typeof a.one_percent_better === "string")
      setOnePercent(a.one_percent_better);
  }, [eodRow]);

  /**
   * A touchpoint is owed when something changed on the account today, or when the
   * numbers moved enough that the client should hear it from us first.
   */
  const touchpoints = useMemo(() => {
    const out: {
      campaign: Campaign;
      key: string;
      client: string;
      lang: "ar" | "en";
      why: string;
      short: string;
      message: string;
    }[] = [];
    const seen = new Set<string>();
    /** Her saved choice wins; the client's own name is only the fallback guess. */
    // biome-ignore lint/suspicious/noExplicitAny: pref row
    const prefLang = new Map<string, string>(
      ((snap?.prefs ?? []) as any[]).map(p => [p.clientName, p.language]),
    );
    const isArabic = (t: string) =>
      prefLang.get(t) ? prefLang.get(t) === "ar" : /[\u0600-\u06FF]/.test(t);
    const decided = new Map<string, string>();
    for (const d of snap?.decisions ?? []) {
      if (d.kind !== "touch") decided.set(d.subject, d.action);
    }
    for (const c of (snap?.campaigns ?? []) as Campaign[]) {
      if (c.internal) continue;
      const change = decided.get(c.campaignName);
      const client = c.clientName ?? c.campaignName;
      // One message per client, not per campaign.
      if (seen.has(client)) continue;
      const ar = isArabic(client);
      if (change) {
        out.push({
          campaign: c,
          key: c.campaignName,
          client,
          lang: ar ? "ar" : "en",
          why: `You changed something today: ${change}`,
          short: change,
          message: ar
            ? `صباح الخير 👋 عدّلنا شي على الحملة اليوم — ${change}.\n\n` +
              `وضعكم الحالي: ${c.leads7d} عميل محتمل خلال آخر أسبوع، بتكلفة ${money(c.cpl, 2)} للعميل` +
              `${c.bookings7d ? ` و${c.bookings7d} حجز موعد` : ""}.\n\n` +
              `بنشوف تأثير التعديل خلال يومين ثلاثة وأخبركم.`
            : `Morning 👋 we changed something on your campaign today — ${change}.\n\n` +
              `Where you stand: ${c.leads7d} leads this week at ${money(c.cpl, 2)} each` +
              `${c.bookings7d ? `, ${c.bookings7d} of them booked a call` : ""}.\n\n` +
              `Give it two or three days and I'll tell you what it did.`,
        });
      } else if (c.verdict === "scale" && c.leads7d >= 5) {
        out.push({
          campaign: c,
          key: c.campaignName,
          client,
          lang: ar ? "ar" : "en",
          why: "Good week: send the win before they have to ask",
          short: "shared the week's result",
          message: ar
            ? `أسبوع زين عندكم 👌 ${c.leads7d} عميل محتمل بتكلفة ${money(c.cpl, 2)} للواحد` +
              `${c.bookings7d ? ` و${c.bookings7d} حجز` : ""}.\n\n` +
              `خلّينا على نفس الخط، وأنا أجرب زاوية جديدة أنزّل فيها التكلفة أكثر.`
            : `Good week on your side 👌 ${c.leads7d} leads at ${money(c.cpl, 2)} each` +
              `${c.bookings7d ? `, ${c.bookings7d} booked calls` : ""}.\n\n` +
              `I'm leaving it running and testing one new angle to get the cost down further.`,
        });
      } else if (c.verdict === "fatiguing" || c.verdict === "kill") {
        out.push({
          campaign: c,
          key: c.campaignName,
          client,
          lang: ar ? "ar" : "en",
          why: "Tell them before the number gets worse, not after",
          short: "flagged performance and the fix",
          message: ar
            ? `حبيت أكلمكم قبل ما تسألون 🙏 الإعلان الحالي بدأ يتعب` +
              `${c.cpl ? ` وتكلفة العميل صارت ${money(c.cpl, 2)}` : ""}.\n\n` +
              `أنا شغّالة عليه: ${c.findings?.[0]?.constraint === "Creative" ? "نجهّز إعلانات جديدة" : "نعدّل الاستهداف والميزانية"}.\n\n` +
              `أخبركم بالنتيجة خلال أيام.`
            : `Wanted to tell you before you had to ask 🙏 the current ad is tiring out` +
              `${c.cpl ? ` and your cost per lead is ${money(c.cpl, 2)}` : ""}.\n\n` +
              `I'm on it: ${c.findings?.[0]?.constraint === "Creative" ? "new creative is being made" : "adjusting targeting and budget"}.\n\n` +
              `I'll come back to you in a few days with the result.`,
        });
      }
      if (out.length && out[out.length - 1].campaign === c) seen.add(client);
    }
    return out.slice(0, 8);
  }, [snap]);

  /** The four blocks the SOP asks for, filled in from what actually happened today. */
  /**
   * The EOD form's own fields, filled in from what actually happened. She types the
   * two human answers; every number is already known.
   */
  /**
   * The numbers the EOD form asks for. The form says "today", so these are
   * today's, not the 7-day window the rest of the cockpit runs on.
   */
  const eodNumbers = useMemo(() => {
    const cs = ((snap?.campaigns ?? []) as Campaign[]).filter(c => !c.internal);
    const spend = cs.reduce((t, c) => t + (c.spendToday ?? 0), 0);
    const leads = cs.reduce((t, c) => t + (c.leadsToday ?? 0), 0);
    const over = cs.filter(c => (c.cpl ?? 0) > CPL_GATE);
    return {
      spend: Math.round(spend),
      leads,
      cpl: leads > 0 ? (spend / leads).toFixed(0) : "0",
      accounts: cs.length,
      overGate: over.length ? "Yes" : "No",
      overNames: over.map(c => c.clientName ?? c.campaignName),
      through: cs
        .map(c => c.dataThrough)
        .filter(Boolean)
        .sort()
        .pop(),
    };
  }, [snap]);

  const eodReport = useMemo(() => {
    const cs = ((snap?.campaigns ?? []) as Campaign[]).filter(c => !c.internal);
    const ds = (snap?.decisions ?? []) as {
      subject: string;
      action: string;
      kind: string;
      reason?: string;
    }[];
    const spend = cs.reduce((t, c) => t + c.spend7d, 0);
    const leads = cs.reduce((t, c) => t + c.leads7d, 0);
    const bookings = cs.reduce((t, c) => t + (c.bookings7d ?? 0), 0);
    const overGate = cs.filter(c => (c.cpl ?? 0) > CPL_GATE);
    const outOfKpi = cs.filter(
      c =>
        (c.cpl ?? 0) > CPL_GATE ||
        (c.serviceMode !== "DWY" && (c.costPerBooking ?? 0) > CPB_GATE),
    );
    const lines: string[] = [
      `EOD — ${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}`,
      "",
      `Active client accounts managed: ${cs.length}`,
      `Total ad spend (7d): ${money(spend)}`,
      `Total leads (7d): ${leads}`,
      `Average CPL: ${money(leads > 0 ? spend / leads : undefined, 2)}`,
      `Bookings (7d): ${bookings}${bookings > 0 ? ` · cost per booking ${money(spend / bookings, 0)}` : ""}`,
      `Any client with CPL above ${"$"}${CPL_GATE} today: ${overGate.length ? `Yes — ${overGate.map(c => c.clientName ?? c.campaignName).join(", ")}` : "No"}`,
      "",
      "ACCOUNT BY ACCOUNT — WHAT I CHANGED AND WHY",
      ...(ds.length
        ? ds.map(
            d =>
              `• ${d.subject} — ${d.action}${d.reason ? ` (${d.reason})` : ""}`,
          )
        : ["• No changes logged today"]),
      "",
      "CLIENTS OUT OF KPI — METRIC AND NEXT ACTION",
      ...(outOfKpi.length
        ? outOfKpi
            .slice(0, 8)
            .map(
              c =>
                `• ${c.clientName ?? c.campaignName} — ${
                  c.serviceMode !== "DWY" && (c.costPerBooking ?? 0) > 80
                    ? `cost per booking ${money(c.costPerBooking, 0)}`
                    : `CPL ${money(c.cpl, 2)}`
                } → ${c.findings?.[0]?.fixes?.[0] ?? "watching it"}`,
            )
        : ["• None"]),
    ];
    return lines.join("\n");
  }, [snap]);

  const decidedBySubject = useMemo(() => {
    const m = new Map<string, { action: string; reroutedTo?: string }>();
    for (const d of snap?.decisions ?? [])
      m.set(d.subject, { action: d.action, reroutedTo: d.reroutedTo });
    return m;
  }, [snap]);

  if (snap === undefined) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Loading today's numbers…
      </div>
    );
  }

  const t = snap.totals;
  // biome-ignore lint/suspicious/noExplicitAny: check row
  const checkRows = (snap.checks as any[]) ?? [];
  // Campaigns where Meta delivers nothing: every ad and ad set under them is
  // paused, archived or held by a paused campaign. The board card can still
  // say Live; Meta is the truth about delivery. [Aziz, 2026-09-14]
  const offOnMeta = new Set<string>();
  const onMetaTree = new Set<string>();
  {
    const byCampaign = new Map<string, Campaign[]>();
    for (const t of (snap?.metaTree ?? []) as Campaign[]) {
      if (t.kind !== "ad" && t.kind !== "adset") continue;
      const list = byCampaign.get(t.campaignName) ?? [];
      list.push(t);
      byCampaign.set(t.campaignName, list);
    }
    for (const [name, nodes] of byCampaign) {
      onMetaTree.add(name);
      if (!nodes.some(t => (t.effectiveStatus ?? t.status) === "ACTIVE"))
        offOnMeta.add(name);
    }
  }
  // Off on the board and nothing running on Meta: it belongs on the Off on the
  // board screen. Off on the board but Meta still runs it: it is spending, so
  // it stays in Ads management with a warning. Without a Meta read, spend on
  // the last day or the day before counts as running. [Aziz, 2026-09-14]
  const yesterday = new Date(Date.now() + 3 * 3600_000 - 86_400_000)
    .toISOString()
    .slice(0, 10);
  const runningOnMeta = (c: Campaign) =>
    onMetaTree.has(c.campaignName)
      ? !offOnMeta.has(c.campaignName)
      : Number(c.spendToday ?? 0) > 0 &&
        String(c.dataThrough ?? "") >= yesterday;
  const isParked = (c: Campaign) => isOffOnBoard(c) && !runningOnMeta(c);
  const sodChecks = checkRows.filter(c => (c.phase ?? "sod") === "sod");
  const midChecks = checkRows.filter(c => c.phase === "mid");
  const checksDone = sodChecks.filter(c => c.done).length;

  /**
   * Launch cadence: first 72 hours is twice a day, then every 3–7 days.
   * "Due" means nothing has been changed or reviewed for a week.
   */
  const watchList = (snap.campaigns as Campaign[])
    .filter(c => !c.internal)
    .map(c => {
      const live = c.daysLive ?? 99;
      const sinceChange = c.lastChangeAt
        ? Math.floor((Date.now() - c.lastChangeAt) / 86400000)
        : undefined;
      if (live <= 3)
        return {
          c,
          hot: true,
          tag: `Day ${Math.max(live, 0) + 1} of 3`,
          why: "Just launched: check it this morning and again before you log off.",
        };
      if (sinceChange !== undefined && sinceChange < LEARNING_DAYS)
        return {
          c,
          hot: false,
          tag: "In learning",
          why: `Changed ${sinceChange === 0 ? "today" : `${sinceChange}d ago`}; read it again on day ${LEARNING_DAYS}.`,
        };
      if ((sinceChange ?? live) >= 7)
        return {
          c,
          hot: true,
          tag: "Review due",
          why: `Nothing touched for ${sinceChange ?? live} days, past the 7 day check.`,
        };
      return null;
    })
    .filter((w): w is NonNullable<typeof w> => w !== null)
    .sort((a, b) => Number(b.hot) - Number(a.hot));

  const act = async (
    c: Campaign,
    action: string,
    kind: string,
    extra: Record<string, unknown> = {},
  ) => {
    // If the label names something I can do in Meta, do it before logging, and
    // stop if Meta refuses — logging a change that never happened is worse than
    // not offering the button at all.
    let did: string | undefined;
    if (isExecutable(action)) {
      const target = action.startsWith("Raise to")
        ? Number(action.replace(/[^0-9.]/g, ""))
        : undefined;
      let r: { ok: boolean; did?: string; error?: string };
      try {
        r = await run({
          action,
          campaignName: c.campaignName,
          campaignMetaId: c.metaCampaignId,
          targetBudget: Number.isFinite(target) ? target : undefined,
          clientTag: c.clientTag,
        });
      } catch (e) {
        // A dropped connection mid-call: Meta may or may not have applied it.
        toast.error(
          `Could not confirm "${action}" with Meta (${e instanceof Error ? e.message : String(e)}). Check ${c.campaignName} in Ads Manager before retrying.`,
        );
        return;
      }
      if (!r.ok) {
        toast.error(r.error ?? "Meta refused that.");
        return;
      }
      did = r.did;
    }
    await decide({
      subject: c.campaignName,
      action,
      kind,
      evidence: c.reason,
      metricAtDecision: c.cpl ?? undefined,
      ...extra,
    });
    setOpen(null);
    if (did) {
      toast.success(did, { duration: 8000 });
      return;
    }
    toast.success(
      kind === "rerouted"
        ? `Sent to ${extra.reroutedTo}`
        : kind === "left"
          ? "Left, with a reason logged"
          : "Logged. ClickUp task queued.",
    );
  };

  /** One button: tomorrow's list, written from what today actually left open. */
  const buildTomorrow = () => {
    const cs = (snap.campaigns ?? []) as Campaign[];
    const lines: string[] = [];
    const seen = new Set<string>();
    for (const c of cs) {
      const who = c.clientName ?? c.campaignName;
      if (seen.has(who)) continue;
      seen.add(who);
      const f = c.findings?.[0];
      if (c.lastChangeAt) {
        const ready = c.lastChangeAt + 3 * 86400000;
        if (ready > Date.now() && ready < Date.now() + 2 * 86400000)
          lines.push(
            `${who} — changed recently, decide on ${new Date(ready).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} once it has 3 days of data`,
          );
        continue;
      }
      if (
        !decidedBySubject.get(c.campaignName) &&
        f?.severity !== "optimization" &&
        f
      )
        lines.push(`${who} — ${f.constraint}: ${f.fixes[0]}`);
    }
    // biome-ignore lint/suspicious/noExplicitAny: inbox row
    for (const i of ((snap.inbox ?? []) as any[]).filter(i => i.overdue))
      lines.push(`Overdue on ClickUp: ${i.title}`);
    if (!lines.length)
      lines.push("Nothing outstanding — check delivery and spend pacing.");
    setDump(lines.join("\n"));
    toast.success(
      "Written from today's board. Edit it, then turn it into tasks.",
    );
  };

  const submitPlan = async () => {
    const items = dump
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean)
      .map(text => ({
        text,
        listName: "Marketing / ADs",
        dueDate: "tomorrow",
      }));
    if (!items.length) return;
    await addPlanItems({ items });
    setDump("");
    toast.success(
      `${items.length} task${items.length > 1 ? "s" : ""} queued for tomorrow`,
    );
  };

  /** The filter's own rule; "Undecided today" reads today's decisions. */
  const passes = (label: string, c: Campaign) =>
    label === "Undecided today"
      ? !decidedBySubject.has(c.campaignName)
      : (FILTERS.find(f => f.label === label) ?? FILTERS[0]).test(c);

  /** One flag per row, the most urgent; the rest wait in the opened panel. */
  const flagFor = (
    c: Campaign,
  ): { label: string; tone: Tone; title?: string } | null => {
    if (c.accountIssue)
      return {
        label: /unsettled/i.test(c.accountIssue)
          ? "Card declined"
          : "Account blocked",
        tone: "bad",
        title: c.accountIssue,
      };
    if (adsTab === "running" && isOffOnBoard(c))
      return {
        label: `Board says ${c.boardAdStatus}, still on Meta`,
        tone: "bad",
        title:
          "The board has this campaign off, but Meta is still running it and spending. Pause it on Meta, or set the Ad Status back to Live.",
      };
    if (adsTab === "off")
      return c.dataThrough
        ? { label: `Last spend ${dayMonth(c.dataThrough)}`, tone: "neutral" }
        : null;
    if (offOnMeta.has(c.campaignName))
      return {
        label: "Nothing delivering on Meta",
        tone: "warn",
        title:
          "The board says this campaign is on, but nothing is delivering on Meta. If it is off, set the Ad Status.",
      };
    if (c.staleTaskName)
      return {
        label: "Card name out of date",
        tone: "warn",
        title: `The board card still says "${c.staleTaskName}".`,
      };
    return null;
  };

  const now = new Date();
  const lastSync = snap.lastSyncAt ? new Date(snap.lastSyncAt) : null;
  const synced = lastSync ? (
    <>
      synced{" "}
      {lastSync.toDateString() === now.toDateString()
        ? ""
        : `${lastSync.toLocaleDateString("en-GB", { weekday: "short" })} `}
      <span className="font-mono">
        {lastSync.toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
    </>
  ) : (
    "not yet synced"
  );

  // She can flag anything wrong on the screen without leaving it. It lives in
  // the header, quiet, so nothing floats over the tab bar or Ask Hermes.
  const reportProblem = (
    <Popover open={chatOpen} onOpenChange={setChatOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground print:hidden"
        >
          <MessageSquareWarning aria-hidden />
          Report a problem
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(22rem,calc(100vw-2rem))] rounded-xl p-0"
      >
        <div className="border-b px-4 py-3">
          <div className="text-sm font-semibold">Report a problem</div>
          <div className="text-xs text-muted-foreground">
            A question, or something here looks wrong
          </div>
        </div>
        <div className="max-h-56 space-y-3 overflow-y-auto px-4 py-3">
          {/* biome-ignore lint/suspicious/noExplicitAny: feedback row */}
          {((snap.feedback ?? []) as any[]).length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Tell me if a number looks off, a client is missing, or you want
              something on this screen changed. It reaches me directly and I
              reply in Slack.
            </p>
          ) : (
            // biome-ignore lint/suspicious/noExplicitAny: feedback row
            ((snap.feedback ?? []) as any[]).map(f => (
              <div key={f._id} className="text-xs">
                <div className="rounded-lg bg-muted px-3 py-2">{f.text}</div>
                <div className="mt-1 text-muted-foreground">
                  {f.page} ·{" "}
                  {new Date(f.at).toLocaleTimeString("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {f.delivered ? " · sent" : " · sending"}
                </div>
                {f.reply && (
                  <div className="mt-1 rounded-lg bg-accent px-3 py-2 text-accent-foreground">
                    {f.reply}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        <div className="border-t p-3">
          <textarea
            value={chatText}
            onChange={e => setChatText(e.target.value)}
            rows={2}
            placeholder="e.g. Liwan's spend looks too low, can you check?"
            className="w-full resize-none rounded-lg border bg-background p-2 text-sm"
          />
          <Button
            size="sm"
            className="mt-2 w-full"
            disabled={!chatText.trim()}
            onClick={async () => {
              await sendFeedback({
                message: chatText.trim(),
                page: TITLES[view],
              });
              setChatText("");
              toast.success("Sent");
            }}
          >
            Send
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );

  const tiles = (
    <div className="@container">
      <div className="grid grid-cols-2 gap-4 @3xl:grid-cols-5">
        {[
          {
            l: "Client spend, 7 days",
            v: moneyOr(t.clientSpend),
            d: `${snap.campaigns.length} campaigns delivering`,
          },
          {
            l: "Client leads, 7 days",
            v: String(t.clientLeads),
          },
          {
            l: "Blended CPL",
            v: moneyOr(t.blendedCpl, 2),
            d:
              t.blendedCpl == null
                ? "no client leads yet"
                : t.blendedCpl <= CPL_GATE
                  ? `under the $${CPL_GATE} gate`
                  : `over the $${CPL_GATE} gate`,
            ok: t.blendedCpl != null && t.blendedCpl <= CPL_GATE,
            bad: t.blendedCpl != null && t.blendedCpl > CPL_GATE,
          },
          {
            l: "Under the $30/day floor",
            v: String(t.underFloor),
            d: "campaigns",
            bad: t.underFloor > 0,
          },
          {
            l: "Not on the board",
            v: String(t.offBoard),
            d: "campaigns with spend",
            bad: t.offBoard > 0,
          },
        ].map((k, i) => (
          <div
            key={k.l}
            className={`min-w-0 rounded-2xl border bg-card p-4 ${i === 0 ? "col-span-2 @3xl:col-span-1" : ""}`}
          >
            <div className="text-xs text-muted-foreground">{k.l}</div>
            <div className="mt-1 whitespace-nowrap text-2xl font-semibold tracking-tight tabular-nums">
              {k.v}
            </div>
            {k.d ? (
              <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                {k.bad || k.ok ? (
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: k.bad
                        ? "var(--destructive)"
                        : "var(--success)",
                    }}
                  />
                ) : null}
                {k.d}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );

  const changeLog = (
    <section className={CARD}>
      <h2 className="text-[15px] font-semibold">Change log</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Every decision you take here is posted as a comment on that client's
        campaign task in ClickUp, with the numbers behind it, so the CSM walks
        into a check-in call with the full history.
      </p>
      {snap.decisions.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Nothing logged today yet.
        </p>
      ) : (
        <ul className="mt-4 divide-y">
          {snap.decisions.map(
            (d: {
              _id: string;
              subject: string;
              action: string;
              reason?: string;
              loggedAt?: number;
              logError?: string;
              clickupTaskUrl?: string;
            }) => (
              <li key={d._id} className="py-3 text-sm first:pt-0 last:pb-0">
                <div>
                  <span className="font-medium">{d.subject}</span>: {d.action}
                  {d.reason ? (
                    <span className="text-muted-foreground"> · {d.reason}</span>
                  ) : null}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  {d.logError ? (
                    <span className="txt-bad">
                      Not logged to ClickUp: {d.logError}
                    </span>
                  ) : d.loggedAt ? (
                    <a
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                      href={d.clickupTaskUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      ClickUp task
                      <ArrowUpRight className="size-3.5" aria-hidden />
                    </a>
                  ) : (
                    <span className="text-muted-foreground">
                      Logging to ClickUp…
                    </span>
                  )}
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground hover:underline"
                    onClick={() =>
                      void removeDecision({
                        id: d._id as Id<"decisions">,
                      })
                    }
                  >
                    Remove from today
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );

  const sprint = (
    <section className={CARD}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold">Morning sprint</h2>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {checksDone} of {sodChecks.length}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Clear communication first, in this order, then get into the accounts.
      </p>
      {sodChecks.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No checklist for today yet. It arrives with the morning sync.
        </p>
      ) : (
        <ol className="mt-4 divide-y">
          {sodChecks.map((c, idx) => (
            <li
              key={c._id}
              className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
            >
              <button
                type="button"
                onClick={() => toggleCheck({ id: c._id })}
                aria-pressed={Boolean(c.done)}
                aria-label={`${c.done ? "Untick" : "Tick"}: ${c.label}`}
                className={`no-touch relative mt-0.5 grid size-5 flex-none place-items-center rounded-full border text-xs font-semibold tabular-nums after:absolute after:-inset-2.5 after:content-[''] ${c.done ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40 text-muted-foreground"}`}
              >
                {c.done ? <Check className="size-3" aria-hidden /> : idx + 1}
              </button>
              <div className="min-w-0 flex-1">
                <div
                  className={`text-sm font-medium leading-snug ${c.done ? "text-muted-foreground line-through" : ""}`}
                >
                  {c.label}
                </div>
                {c.detail && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {c.detail}
                  </div>
                )}
                {c.href && (
                  <Link
                    to={c.href}
                    className="mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
                  >
                    Open it
                    <ChevronRight className="size-3.5" aria-hidden />
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );

  const watch = (
    <section className={CARD}>
      <h2 className="text-[15px] font-semibold">Watch list</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        A new campaign is read twice a day for its first 72 hours, then every 3
        to 7 days, sooner if you changed something.
      </p>
      {watchList.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No campaign is inside its launch window and nothing is overdue a
          review. Work the accounts below instead.
        </p>
      ) : (
        <ul className="mt-4 divide-y">
          {watchList.map(w => (
            <li
              key={w.c.campaignName}
              className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {w.c.clientName ?? w.c.campaignName}
                </div>
                <div className="text-xs text-muted-foreground">{w.why}</div>
              </div>
              <StatusChip tone={w.hot ? "warn" : "neutral"}>{w.tag}</StatusChip>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const startHere = (snap.campaigns as Campaign[])
    .filter(c => !c.internal && c.spend7d >= 50)
    .slice(0, 3);
  const accounts = (
    <section className={CARD}>
      <h2 className="text-[15px] font-semibold">Then, the accounts</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Inbox clear? The rest is account work: one block, one client at a time.
        Start with these.
      </p>
      {startHere.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No client campaign spent $50 or more in the last 7 days.
        </p>
      ) : (
        <ol className="mt-4 divide-y">
          {startHere.map((c, i) => (
            <li
              key={c.campaignName}
              className="flex gap-3 py-3 first:pt-0 last:pb-0"
            >
              <span className="font-mono text-sm font-semibold tabular-nums text-primary">
                {i + 1}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {c.clientName ?? c.campaignName}
                </div>
                <div className="text-xs text-muted-foreground">{c.reason}</div>
                {c.findings?.[0] && (
                  <div className="mt-1 text-sm">
                    <span className="font-medium">
                      {c.findings[0].constraint}:
                    </span>{" "}
                    {c.findings[0].fixes[0]}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      <Button asChild size="sm" className="mt-4">
        <Link to="/ads">Open Ads management</Link>
      </Button>
    </section>
  );

  const inbox = (snap.inbox ?? []) as {
    _id: string;
    url?: string;
    title: string;
    body?: string;
    kind?: string;
    author?: string;
    reason?: string;
    listName?: string;
    overdue?: boolean;
    taskId?: string;
  }[];
  const clickUp = (
    <section className={CARD}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold">Your ClickUp</h2>
        <span className="text-xs tabular-nums text-muted-foreground">
          {inbox.length} open
        </span>
      </div>
      {inbox.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Nothing assigned to you and no comments tagging you.
        </p>
      ) : (
        <ul className="mt-3 divide-y">
          {inbox.slice(0, 12).map(i => (
            <li key={i._id}>
              <a
                href={i.url}
                target="_blank"
                rel="noreferrer"
                className="-mx-2 block rounded-lg px-2 py-2.5 text-sm hover:bg-muted/40"
              >
                <span className="font-medium">{i.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {i.kind === "mention" ? `${i.author} tagged you` : i.reason}
                  {i.overdue ? " · overdue" : ""}
                </span>
                {i.body && (
                  <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                    {i.body}
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const tasksCard = (
    <section className={CARD}>
      <h2 className="text-[15px] font-semibold">Your ClickUp tasks</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Open work on the Ads Management and Marketing / ADs boards. Ticking it
        here is not enough: open the task and move it, so the rest of the team
        sees it.
      </p>
      {inbox.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Nothing open.</p>
      ) : (
        <ul className="mt-4 divide-y">
          {inbox.map(i => (
            <li key={i._id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
                <a
                  href={i.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 hover:underline"
                >
                  <span className="font-medium">{i.title}</span>
                  {i.body && (
                    <span className="text-muted-foreground"> · {i.body}</span>
                  )}
                </a>
                <span className="basis-full text-xs text-muted-foreground sm:basis-auto">
                  {i.kind === "mention" ? `${i.author} tagged you` : i.listName}
                  {i.overdue ? " · overdue" : ""}
                </span>
              </div>
              {ask === i._id ? (
                <div className="mt-2 space-y-2 rounded-xl bg-muted/40 p-3">
                  <AnimatedSelect
                    className="h-8 w-full rounded-lg border bg-background px-2 text-sm"
                    value={askWho}
                    onChange={e => setAskWho(e.target.value)}
                  >
                    <option value="">Who needs to answer?</option>
                    {/* biome-ignore lint/suspicious/noExplicitAny: member row */}
                    {((snap.members ?? []) as any[]).map(m => (
                      <option key={m.userId} value={String(m.userId)}>
                        {m.username}
                      </option>
                    ))}
                  </AnimatedSelect>
                  <Input
                    value={askText}
                    placeholder="What is missing? e.g. which landing page should this point to?"
                    className="h-8 text-sm"
                    onChange={e => setAskText(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={!askText.trim() || !i.taskId}
                      onClick={async () => {
                        const who = (
                          (snap.members ?? []) as {
                            userId: number;
                            username: string;
                          }[]
                        ).find(m => String(m.userId) === askWho);
                        await askForDetail({
                          taskId: i.taskId as string,
                          question: askText.trim(),
                          assignee: who?.userId,
                          assigneeName: who?.username,
                        });
                        setAsk(null);
                        setAskText("");
                        setAskWho("");
                        toast.success(
                          who
                            ? `Asked ${who.username} on the task`
                            : "Asked on the task",
                        );
                      }}
                    >
                      Ask on the task
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setAsk(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="mt-1 text-xs text-primary hover:underline"
                  onClick={() => setAsk(i._id)}
                >
                  Something missing? Ask someone on this task
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const planned = (
    <section className={CARD}>
      <h2 className="text-[15px] font-semibold">What you planned</h2>
      {(snap.plan ?? []).length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Nothing planned yet. Write tomorrow's list on the End of day screen.
        </p>
      ) : (
        <ul className="mt-4 divide-y">
          {/* biome-ignore lint/suspicious/noExplicitAny: plan row */}
          {(snap.plan as any[]).map(p => (
            <li key={p._id} className="py-2.5 text-sm first:pt-0 last:pb-0">
              {p.text}
              {p.clickupTaskUrl && (
                <a
                  className="ml-2 inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
                  href={p.clickupTaskUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  on ClickUp
                  <ArrowUpRight className="size-3.5" aria-hidden />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const touch = (
    <section className={CARD}>
      <h2 className="text-[15px] font-semibold">Proactive touchpoints</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        One or two per client per week, and always after a change. Copy the
        message, send it on WhatsApp, then log it; the CSM sees it on the
        client's task.
      </p>
      {touchpoints.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Nothing owed right now. Take a decision in Ads management and the
          message for that client shows up here.
        </p>
      ) : (
        <ul className="mt-4 divide-y">
          {touchpoints.map(tp => (
            <li
              key={tp.campaign.campaignName}
              className="py-4 first:pt-0 last:pb-0"
            >
              <div className="text-sm font-semibold">
                {tp.campaign.clientName ?? tp.campaign.campaignName}
              </div>
              <div className="text-xs text-muted-foreground">{tp.why}</div>
              <Textarea
                dir={tp.lang === "ar" ? "rtl" : "ltr"}
                className="mt-2 min-h-[130px] text-sm leading-relaxed"
                value={drafts[tp.key] ?? tp.message}
                onChange={e =>
                  setDrafts(d => ({ ...d, [tp.key]: e.target.value }))
                }
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    navigator.clipboard.writeText(drafts[tp.key] ?? tp.message)
                  }
                >
                  Copy
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    act(
                      tp.campaign,
                      `Client updated — ${tp.short}`,
                      "touch",
                      {},
                    )
                  }
                >
                  I sent it, log it
                </Button>
                <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                  Writes in
                  {(["ar", "en"] as const).map(lang => (
                    <button
                      key={lang}
                      type="button"
                      aria-pressed={tp.lang === lang}
                      onClick={() => {
                        setDrafts(d => {
                          const rest = { ...d };
                          delete rest[tp.key];
                          return rest;
                        });
                        void setClientLanguage({
                          clientName: tp.client,
                          language: lang,
                        });
                      }}
                      className={pill(tp.lang === lang)}
                    >
                      {lang === "ar" ? "العربية" : "English"}
                    </button>
                  ))}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const eod = (
    <section className={CARD}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">Your EOD report</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Already written from today's decisions.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => navigator.clipboard.writeText(eodReport)}
        >
          Copy for Slack
        </Button>
      </div>
      <pre className="mt-4 whitespace-pre-wrap rounded-xl bg-muted/40 p-4 font-sans text-sm leading-relaxed">
        {eodReport}
      </pre>
      <div className="mt-6 space-y-6">
        <div>
          <div className={KICKER}>Health</div>
          <div className="mt-2 grid grid-cols-3 gap-3">
            {[
              ["focus", "Focus"],
              ["energy", "Energy"],
              ["biology", "Food, sleep, water"],
            ].map(([k, label]) => (
              <label key={k} className="text-xs">
                <span className="text-muted-foreground">{label}</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={eodForm[k]}
                  onChange={e => setEod(k, e.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border bg-background px-2 text-sm"
                />
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className={KICKER}>Tasks</div>
          <ul className="mt-2 divide-y">
            {[
              ["dashboard", "Fulfillment dashboard updated"],
              ["onBudget", "All accounts within daily budget"],
              ["flagged", "Off-KPI accounts flagged to the CSM"],
              ["videoRequests", "Video requests / briefs submitted"],
              ["creativesUploaded", "Approved creatives uploaded"],
              ["launchedPaused", "Creatives launched or paused today"],
            ].map(([k, label]) => (
              <li
                key={k}
                className="flex items-center justify-between gap-3 py-2"
              >
                <span className="text-sm">{label}</span>
                <div className="flex flex-none gap-1">
                  {["Yes", "No"].map(opt => (
                    <button
                      key={opt}
                      type="button"
                      aria-pressed={eodForm[k] === opt}
                      onClick={() => setEod(k, opt)}
                      className={pill(eodForm[k] === opt)}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className={KICKER}>Today, filled in for you</div>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            {[
              ["Spend today", `$${eodNumbers.spend}`],
              ["Leads today", String(eodNumbers.leads)],
              ["CPL today", `$${eodNumbers.cpl}`],
              ["Accounts", String(eodNumbers.accounts)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-sm">
            Any client over ${CPL_GATE} a lead:{" "}
            <span className="font-semibold">{eodNumbers.overGate}</span>
            {eodNumbers.overNames.length > 0 && (
              <span className="text-muted-foreground">
                {" "}
                ({eodNumbers.overNames.join(", ")})
              </span>
            )}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {eodNumbers.through
              ? `Today's figures are for ${eodNumbers.through}, the last day Meta has reported. The report above reads the last 7 days.`
              : "The report above reads the last 7 days."}
          </p>
        </div>

        <div className="space-y-2">
          <Textarea
            className="min-h-[70px] text-sm"
            placeholder="Account summary: what you actually did today."
            value={eodForm.accountSummary}
            onChange={e => setEod("accountSummary", e.target.value)}
          />
          <Textarea
            className="min-h-[50px] text-sm"
            placeholder="Clients out of KPI and what you're doing about it."
            value={eodForm.outOfKpi}
            onChange={e => setEod("outOfKpi", e.target.value)}
          />
          <Textarea
            className="min-h-[50px] text-sm"
            placeholder="One thing that would make us 1% better, to add or to remove."
            value={onePercent}
            onChange={e => setOnePercent(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            disabled={eodSending || Boolean(eodRow?.submittedAt)}
            onClick={async () => {
              if (!eodForm.accountSummary.trim()) {
                toast.error("Add your account summary first.");
                return;
              }
              setEodSending(true);
              try {
                await saveEod({
                  body: eodReport,
                  energy: eodForm.energy,
                  answers: {
                    ...eodForm,
                    one_percent_better: onePercent,
                  },
                  computed: {
                    spend: eodNumbers.spend,
                    leads: eodNumbers.leads,
                    cpl: eodNumbers.cpl,
                    accounts: eodNumbers.accounts,
                    overGate: eodNumbers.overGate,
                  },
                  submit: true,
                });
                // "Sent" is only true once submittedAt lands; the
                // button below reads that from the snapshot.
                toast.success(
                  "Saved. Posting to #media-eods and the EOD Reports sheet now.",
                );
              } catch (e) {
                toast.error(
                  `Could not save the EOD (${e instanceof Error ? e.message : String(e)}). Nothing was posted.`,
                );
              } finally {
                setEodSending(false);
              }
            }}
          >
            {eodRow?.submittedAt ? (
              <>
                <Check aria-hidden />
                Submitted at{" "}
                {new Date(eodRow.submittedAt).toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </>
            ) : eodSending ? (
              "Saving…"
            ) : (
              "Submit my EOD"
            )}
          </Button>
          {eodRow && !eodRow.submittedAt && !eodSending && (
            <span className="text-xs txt-warn">
              Saved, still posting to #media-eods
              {eodRow.error ? ` (${eodRow.error})` : ""}.{" "}
              {/* Retry only once a post has actually failed. In the
                  seconds the first post is still running the row is
                  saved but not yet submitted, and a click here then
                  would race it. */}
              {eodRow.error && (
                <button
                  type="button"
                  className="underline"
                  onClick={() =>
                    void resubmitEod({}).then(() =>
                      toast.success("Posting it again."),
                    )
                  }
                >
                  Retry
                </button>
              )}
            </span>
          )}
        </div>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        This replaces the form. Submitting posts it to #media-eods and appends
        the row to the EOD Reports sheet, exactly as before.
      </p>
    </section>
  );

  const tomorrow = (
    <section className={CARD}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">Plan tomorrow today</h2>
        <span className="text-xs text-muted-foreground">
          This is also your EOD
        </span>
      </div>
      <Button
        size="sm"
        variant="secondary"
        className="mt-4 w-full"
        onClick={buildTomorrow}
      >
        Write it for me from today's board
      </Button>
      <Textarea
        value={dump}
        onChange={e => setDump(e.target.value)}
        rows={6}
        placeholder="One line per thing. Arabic or English."
        className="mt-2 text-sm"
        dir="auto"
      />
      <Button size="sm" className="mt-2 w-full" onClick={submitPlan}>
        Turn into tasks for tomorrow
      </Button>
      {snap.plan.length > 0 && (
        <ul className="mt-4 divide-y">
          {snap.plan.map(
            (p: { _id: string; text: string; listName?: string }) => (
              <li
                key={p._id}
                className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 py-2 text-sm"
              >
                <span className="min-w-0">{p.text}</span>
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  {p.listName} · tomorrow
                </span>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );

  const sweep = midChecks.length > 0 && (
    <section className={CARD}>
      <h2 className="text-[15px] font-semibold">
        Middle of the day: the sweep
      </h2>
      <div className="mt-4 grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {midChecks.map(c => (
          <button
            key={c._id}
            type="button"
            onClick={() => toggleCheck({ id: c._id })}
            aria-pressed={Boolean(c.done)}
            className="flex items-start gap-2.5 rounded-lg py-1.5 text-left"
          >
            <span
              className={`mt-0.5 grid size-4 flex-none place-items-center rounded border ${c.done ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}
            >
              {c.done ? <Check className="size-3" aria-hidden /> : null}
            </span>
            <span
              className={`text-sm leading-snug ${c.done ? "text-muted-foreground line-through" : ""}`}
            >
              {c.label}
              {c.detail ? (
                <span className="font-medium">: {c.detail}</span>
              ) : null}
            </span>
          </button>
        ))}
      </div>
    </section>
  );

  const running = (snap.campaigns as Campaign[]).filter(c => !isParked(c));
  const board = (
    <section className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Which campaigns"
        >
          {(
            [
              ["running", "Running", running.length],
              [
                "off",
                "Off the board",
                (snap.campaigns as Campaign[]).filter(isParked).length,
              ],
            ] as const
          ).map(([key, label, n]) => (
            <button
              key={key}
              type="button"
              onClick={() => adsTransition.change(() => setAdsTab(key))}
              aria-pressed={adsTab === key}
              className={pill(adsTab === key)}
            >
              {label}
              <span className="ml-1.5 tabular-nums opacity-70">{n}</span>
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          USD, currency-corrected
        </span>
      </div>
      {/* The window every campaign opens on. Each campaign can still be
          switched on its own once it is open. [aziz, 2026-09-07] */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl bg-muted/40 px-3 py-2">
        <RangePicker
          value={globalRange}
          onChange={r => {
            setGlobalRange(r);
            setRanges({});
          }}
        />
        <span className="text-xs text-muted-foreground">
          The table always shows the 7-day read the calls are made on; the range
          applies inside each campaign.
        </span>
      </div>
      {adsTab === "off" ? (
        <p className="mt-4 text-sm text-muted-foreground">
          The Ads Management board has these as {OFF_STATUSES.join(", ")}, and
          nothing is running on Meta. Set the Ad Status to bring one back to
          Running. A campaign the board has off but Meta still runs stays in
          Running with a red warning.
        </p>
      ) : (
        // Filters, so she can work one problem at a time instead of the
        // whole list. A filter with nothing in it hides, unless it is on.
        <div className="mt-4 -mx-1 flex flex-nowrap gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden">
          {FILTERS.map(f => {
            const n = running.filter(c => passes(f.label, c)).length;
            if (n === 0 && f.label !== filter && f.label !== "Everything")
              return null;
            return (
              <button
                key={f.label}
                type="button"
                onClick={() => adsTransition.change(() => setFilter(f.label))}
                aria-pressed={filter === f.label}
                className={pill(f.label === filter)}
              >
                {f.label}
                <span className="ml-1.5 tabular-nums opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
      )}
      {/* The container lets an opened campaign's panel be exactly as wide as
          what is visible, so on a phone it does not scroll sideways with the
          table. */}
      <div className="@container mt-4 overflow-x-auto" ref={adsTransition.ref}>
        <table className="campaign-board w-full text-[14px]">
          <thead>
            <tr className="border-b font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              <th className="py-2 pr-2 text-left font-medium">Campaign</th>
              <th className="px-2 text-left font-medium">Spend</th>
              <th className="px-2 text-left font-medium">Leads</th>
              <th className="px-2 text-left font-medium">CPL</th>
              <th className="px-2 text-left font-medium">Bookings</th>
              <th className="px-2 text-left font-medium">Cost / booking</th>
              <th className="px-2 text-left font-medium">Budget / spend</th>
              <th className="px-2 text-left font-medium">Call</th>
            </tr>
          </thead>
          <tbody>
            {(snap.campaigns as Campaign[])
              .filter(c => {
                // Parked campaigns have their own screen; nothing else
                // shows there. [Aziz, 2026-09-14]
                if (adsTab === "off") return isParked(c);
                if (isParked(c)) return false;
                return passes(filter, c);
              })
              // Grouped by client.
              .sort(
                (a, b) =>
                  clientOf(a).localeCompare(clientOf(b)) ||
                  String(a.campaignName).localeCompare(String(b.campaignName)),
              )
              .map((c: Campaign, i: number, list: Campaign[]) => {
                const prev = i > 0 ? list[i - 1] : undefined;
                const newClient = !prev || clientOf(prev) !== clientOf(c);
                const isOpen = open === c.campaignName;
                const links = findClientLinks(
                  (snap.clientLinks ?? []) as Campaign[],
                  clientOf(c),
                );
                const updates = updatesFor(
                  snap.clientUpdates as ClientUpdate[],
                  links,
                );
                const decided = decidedBySubject.get(c.campaignName);
                const flag = flagFor(c);
                const acts = actionsFor(c);
                // Only a real finding earns the eye-catching button.
                const needsDecision = (c.findings ?? []).some(
                  // biome-ignore lint/suspicious/noExplicitAny: finding rows
                  (f: any) => f.severity !== "optimization",
                );
                const ads = snap.ads.filter(
                  (a: Campaign) => a.campaignName === c.campaignName,
                );
                const tree = (snap.metaTree ?? []).filter(
                  (t: Campaign) => t.campaignName === c.campaignName,
                );
                // The name, the button and the row itself all open the
                // same panel.
                const toggle = () => {
                  setMode("ads");
                  if (!isOpen) setCampaignPanelTab("recommendations");
                  setOpen(isOpen && mode === "ads" ? null : c.campaignName);
                };
                // The insights table keys ads by name; the Meta tree keys
                // them by id. Bridge the two so a row can be toggled.
                const adNode = (adName: string) =>
                  tree.find(
                    (t: Campaign) => t.kind === "ad" && t.name === adName,
                  );
                const adMetaId = (adName: string) => adNode(adName)?.metaId;
                const adIsActive = (adName: string) =>
                  (adNode(adName)?.effectiveStatus ??
                    adNode(adName)?.status) === "ACTIVE";
                // The picture for one row of the ads table. The range
                // table knows the row's ad ids, so the tree node is
                // matched by id first and by name only as a fallback.
                // Stored preview links are never passed: the preview
                // is fetched when she opens it.
                const adPicture = (adName: string, adIds?: string[]) => {
                  const byId = (adIds ?? [])
                    .map((id: string) =>
                      tree.find(
                        (t: Campaign) => t.kind === "ad" && t.metaId === id,
                      ),
                    )
                    .filter(Boolean);
                  const node: Campaign =
                    byId.find((t: Campaign) => t.stillUrl || t.stillTinyUrl) ??
                    byId[0] ??
                    adNode(adName);
                  const metaAdId: string | undefined =
                    node?.metaId ?? adIds?.[0];
                  const row: Campaign = ads.find(
                    (a: Campaign) => a.adName === adName,
                  );
                  // The ads row is keyed by name; trust its picture
                  // first only when it is the same ad.
                  const same =
                    row &&
                    (!row.metaAdId || !metaAdId || row.metaAdId === metaAdId);
                  const first = same ? row : node;
                  const second = same ? node : row;
                  return {
                    metaAdId: metaAdId ?? row?.metaAdId,
                    accountId: node?.accountId as string | undefined,
                    stillUrl: (first?.stillUrl ?? second?.stillUrl) as
                      | string
                      | undefined,
                    stillTinyUrl: (first?.stillTinyUrl ??
                      second?.stillTinyUrl) as string | undefined,
                    thumbUrl: ((same ? row?.thumbnailUrl : undefined) ??
                      node?.thumbUrl ??
                      row?.thumbnailUrl) as string | undefined,
                  };
                };
                const facts = [
                  c.internal ? "Mahara's own account" : null,
                  c.daysLive !== undefined ? `Live ${c.daysLive} days` : null,
                  c.currency && c.currency !== "USD"
                    ? `${c.currency} account, converted to USD`
                    : null,
                ].filter(Boolean);
                return (
                  <Fragment key={c._id}>
                    {newClient && (
                      <tr>
                        <td colSpan={8} className="campaign-client-header">
                          <ClientHeader
                            name={clientOf(c)}
                            links={links}
                            updates={updates}
                            onOpen={
                              c.internal
                                ? undefined
                                : () =>
                                    setAccountView(
                                      c.clientName ?? c.accountName,
                                    )
                            }
                          />
                        </td>
                      </tr>
                    )}
                    <tr
                      key={c._id}
                      className={`campaign-summary cursor-pointer border-b align-top transition-colors hover:bg-muted/30 ${isOpen ? "bg-muted/40" : ""} ${adsTab === "off" && !isOpen ? "opacity-80" : ""}`}
                      onClick={e => {
                        // The controls inside the row keep their own clicks.
                        if (
                          (e.target as HTMLElement).closest(
                            "button, a, input, select, textarea",
                          )
                        )
                          return;
                        toggle();
                      }}
                    >
                      <td className="py-2.5 pr-2">
                        <button
                          type="button"
                          className="text-left font-bold hover:underline"
                          aria-expanded={isOpen}
                          onClick={toggle}
                        >
                          {c.campaignName}
                        </button>
                        {flag || c.serviceMode === "DWY" ? (
                          <div>
                            {flag && (
                              <StatusChip tone={flag.tone} title={flag.title}>
                                {flag.label}
                              </StatusChip>
                            )}
                            {c.serviceMode === "DWY" && (
                              <span
                                className="rounded-full border px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground"
                                title="Done with you: we do not book for them, so this account is judged on cost per lead only."
                              >
                                DWY
                              </span>
                            )}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-2 tabular-nums font-semibold">
                        {moneyOr(c.spend7d)}
                      </td>
                      <td className="px-2 tabular-nums font-semibold">
                        {c.leads7d}
                      </td>
                      <td
                        className={`px-2 tabular-nums font-semibold ${c.cpl === undefined ? "" : c.cpl > CPL_GATE ? "txt-bad" : "txt-good"}`}
                      >
                        {moneyOr(c.cpl, 2)}
                      </td>
                      <td className="px-2 tabular-nums font-semibold">
                        {c.bookings7d === undefined ? (
                          <span className="font-normal text-muted-foreground">
                            n/a
                          </span>
                        ) : (
                          <>
                            {c.bookings7d}
                            {c.bookingRate !== undefined && (
                              <span className="ml-1 text-xs font-normal text-muted-foreground">
                                {Math.round(c.bookingRate)}%
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td
                        className={`px-2 tabular-nums font-semibold ${
                          c.costPerBooking === undefined
                            ? ""
                            : c.costPerBooking > 80
                              ? "txt-bad"
                              : "txt-good"
                        }`}
                      >
                        {moneyOr(c.costPerBooking, 0)}
                      </td>
                      <td className="px-2 tabular-nums">
                        {/* What is set on Meta, where it lives, and what it actually spends. */}
                        <div className="flex flex-wrap items-center gap-1.5 font-semibold">
                          {c.budgetDaily !== undefined
                            ? `${money(c.budgetDaily)}/day`
                            : c.budgetLifetime !== undefined
                              ? `${money(c.budgetLifetime)} lifetime`
                              : "Not set"}
                          {c.budgetLevel && (
                            <span
                              className="rounded-full border px-1.5 py-px font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
                              title={
                                c.budgetLevel === "campaign"
                                  ? "CBO: the budget is set on the campaign and Meta splits it across the ad sets"
                                  : "ABO: each ad set has its own budget; this is their total"
                              }
                            >
                              {c.budgetLevel === "campaign" ? "CBO" : "ABO"}
                            </span>
                          )}
                        </div>
                        <div
                          className={`text-xs ${c.dayRate < 30 ? "txt-bad" : "text-muted-foreground"}`}
                        >
                          {money(c.dayRate)}/day avg
                          {c.dataThrough
                            ? ` · ${moneyOr(c.spendToday, 2)} on ${dayMonth(c.dataThrough)}`
                            : ""}
                        </div>
                      </td>
                      <td className="px-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusChip
                            tone={VERDICT_TONE[c.verdict] ?? "neutral"}
                          >
                            {sentence(c.verdict)}
                          </StatusChip>
                          {decided ? (
                            <span className="inline-flex items-start gap-1 text-xs text-muted-foreground">
                              <Check
                                className="mt-px size-3.5 shrink-0 text-[color:var(--success)]"
                                aria-hidden
                              />
                              <span>
                                {decided.action}
                                {decided.reroutedTo
                                  ? `, sent to ${deptLabel(decided.reroutedTo)}`
                                  : ""}
                              </span>
                            </span>
                          ) : (
                            // One button, not four. The decisions live
                            // inside the panel where the evidence is.
                            <Button
                              size="sm"
                              variant={needsDecision ? "teal" : "outline"}
                              className="h-7 whitespace-nowrap px-2.5 text-xs"
                              onClick={() => {
                                setMode("ads");
                                if (!isOpen)
                                  setCampaignPanelTab("recommendations");
                                setOpen(isOpen ? null : c.campaignName);
                              }}
                            >
                              {isOpen ? "Close" : "Recommendations"}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr
                        key={`${c._id}-panel`}
                        className="border-b bg-muted/20"
                      >
                        {/* Spans every header column. The panel inside is
                            pinned to the visible width, so on a phone the
                            chat and the forms fit the screen while the
                            table beside them scrolls. */}
                        <td colSpan={8} className="p-0">
                          <div className="sticky left-0 w-[100cqw] p-3 sm:p-4">
                            <div className="mb-4 grid gap-3 rounded-xl bg-muted/40 p-3 text-sm sm:p-4">
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                                <AdStatusPicker
                                  campaignName={c.campaignName}
                                  status={c.boardAdStatus}
                                  hasCard={Boolean(c.taskId)}
                                />
                                {facts.length > 0 && (
                                  <span className="text-xs text-muted-foreground">
                                    {facts.join(" · ")}
                                  </span>
                                )}
                                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:ml-auto">
                                  {adsManagerUrl(c) && (
                                    <a
                                      className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                                      href={adsManagerUrl(c)}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      Open in Ads Manager
                                      <ArrowUpRight
                                        className="size-3.5"
                                        aria-hidden
                                      />
                                    </a>
                                  )}
                                  {c.taskUrl && (
                                    <a
                                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
                                      href={c.taskUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      ClickUp task
                                      <ArrowUpRight
                                        className="size-3.5"
                                        aria-hidden
                                      />
                                    </a>
                                  )}
                                </span>
                              </div>
                              {c.accountIssue && (
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
                                  <span className="flex min-w-0 items-start gap-2">
                                    <span
                                      aria-hidden
                                      className="mt-1 size-1.5 shrink-0 rounded-full"
                                      style={{
                                        backgroundColor: TONE_DOT.bad,
                                      }}
                                    />
                                    {c.accountIssue}
                                  </span>
                                  {/unsettled/i.test(c.accountIssue) && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs"
                                      title="Files a 'card declined' request on the Client Success board so the CSM chases the payment. Meta refuses every edit until it is paid."
                                      onClick={() => {
                                        window.open(
                                          "https://forms.clickup.com/90182518398/f/2kzmr1ky-1218/EGZ60WWQVFFLDWOE89",
                                          "_blank",
                                          "noopener",
                                        );
                                        decide({
                                          subject: c.campaignName,
                                          action:
                                            "Client card declined, chase the payment",
                                          kind: "rerouted",
                                          evidence: `${c.accountIssue} Ad account: ${c.accountName}.`,
                                          reroutedTo: "client_success",
                                        });
                                      }}
                                    >
                                      Card declined form
                                    </Button>
                                  )}
                                </div>
                              )}
                              {adsTab === "running" && isOffOnBoard(c) && (
                                <p className="flex items-start gap-2 text-xs">
                                  <span
                                    aria-hidden
                                    className="mt-1 size-1.5 shrink-0 rounded-full"
                                    style={{ backgroundColor: TONE_DOT.bad }}
                                  />
                                  The board has this campaign as{" "}
                                  {c.boardAdStatus}, but Meta is still running
                                  it and spending. Pause it on Meta, or set the
                                  Ad Status back to Live.
                                </p>
                              )}
                              {!isOffOnBoard(c) &&
                                offOnMeta.has(c.campaignName) && (
                                  <p className="flex items-start gap-2 text-xs">
                                    <span
                                      aria-hidden
                                      className="mt-1 size-1.5 shrink-0 rounded-full"
                                      style={{
                                        backgroundColor: TONE_DOT.warn,
                                      }}
                                    />
                                    The board says this campaign is on, but
                                    nothing is delivering on Meta. If it is off,
                                    set the Ad Status.
                                  </p>
                                )}
                              {c.staleTaskName && (
                                <p className="text-xs">
                                  The board card still says “{c.staleTaskName}
                                  ”.{" "}
                                  <RenameCardButton
                                    campaignName={c.campaignName}
                                  />
                                </p>
                              )}
                              <CityPicker
                                campaignName={c.campaignName}
                                cities={c.advertisingCities}
                                hasCard={Boolean(c.taskId)}
                              />
                            </div>
                            <ClientRules
                              name={clientOf(c)}
                              links={links}
                              updates={updates}
                            />
                            <div
                              className="mb-4 flex gap-1 overflow-x-auto border-b [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                              role="group"
                              aria-label="Campaign details"
                            >
                              <button
                                type="button"
                                aria-pressed={
                                  campaignPanelTab === "recommendations"
                                }
                                onClick={() => {
                                  setMode("ads");
                                  setCampaignPanelTab("recommendations");
                                }}
                                className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-2.5 py-2 text-sm font-medium sm:px-3 ${campaignPanelTab === "recommendations" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                              >
                                Recommendations
                              </button>
                              <button
                                type="button"
                                aria-pressed={campaignPanelTab === "changes"}
                                onClick={() => {
                                  setMode("ads");
                                  setCampaignPanelTab("changes");
                                }}
                                className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-2.5 py-2 text-sm font-medium sm:px-3 ${campaignPanelTab === "changes" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                              >
                                Changes and results
                              </button>
                            </div>
                            {campaignPanelTab === "changes" && (
                              <CampaignChangesResults
                                campaignName={c.campaignName}
                                taskUrl={c.taskUrl}
                                leadsOnly={c.serviceMode === "DWY"}
                                ads={tree
                                  .filter(
                                    (t: Campaign) =>
                                      t.kind === "ad" && t.metaId,
                                  )
                                  .map((t: Campaign) => ({
                                    metaId: String(t.metaId),
                                    name: String(t.name),
                                    status: String(
                                      t.effectiveStatus ?? t.status,
                                    ),
                                  }))}
                              />
                            )}
                            {mode === "ads" &&
                              campaignPanelTab === "recommendations" && (
                                <div>
                                  {/* The decisions live here, next to the
                                      evidence for them, instead of crowding
                                      every row of the table. */}
                                  <div className="mb-4 flex flex-wrap items-center gap-2 border-b pb-4">
                                    <span className="basis-full text-xs text-muted-foreground">
                                      <span className="font-semibold text-foreground">
                                        What do you want to do?
                                      </span>{" "}
                                      {isExecutable(acts[0])
                                        ? "The first one changes Meta straight away."
                                        : "These are logged, not applied."}
                                    </span>
                                    <Button
                                      size="sm"
                                      className="h-7 whitespace-nowrap px-2.5 text-xs"
                                      onClick={() =>
                                        act(c, acts[0], "approved")
                                      }
                                    >
                                      {acts[0]}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 whitespace-nowrap px-2.5 text-xs"
                                      onClick={() =>
                                        act(c, acts[1], "alternative")
                                      }
                                    >
                                      {acts[1]}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 px-2.5 text-xs text-muted-foreground"
                                      onClick={() => setMode("leave")}
                                    >
                                      Leave it
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 px-2.5 text-xs text-muted-foreground"
                                      onClick={() => setMode("reroute")}
                                    >
                                      Send to another team
                                    </Button>
                                    <StatusToggle
                                      metaId={c.metaCampaignId}
                                      level="campaign"
                                      name={c.campaignName}
                                      clientTag={c.clientTag}
                                      campaignName={c.campaignName}
                                      // Campaign rows carry no status; an
                                      // ad delivering under it means on.
                                      active={tree.some(
                                        (t: Campaign) =>
                                          t.kind === "ad" &&
                                          (t.effectiveStatus ?? t.status) ===
                                            "ACTIVE",
                                      )}
                                    />
                                  </div>
                                  <EditPanel campaign={c} tree={tree} />
                                  <CampaignChat
                                    campaignId={c.campaignName}
                                    campaignName={c.campaignName}
                                    client={c.clientTag ?? undefined}
                                  />
                                  <p className="mb-1 mt-4 text-xs text-muted-foreground">
                                    The call below is the 7-day read: {c.reason}
                                  </p>
                                  <CampaignRange
                                    campaignName={c.campaignName}
                                    range={rangeFor(c.campaignName)}
                                    onRangeChange={r =>
                                      setRange(c.campaignName, r)
                                    }
                                    leadsOnly={c.serviceMode === "DWY"}
                                    extraAds={[
                                      ...new Set<string>(
                                        tree
                                          .filter(
                                            (t: Campaign) => t.kind === "ad",
                                          )
                                          .map((t: Campaign) => String(t.name)),
                                      ),
                                    ]}
                                    renderAdCell={(
                                      adName: string,
                                      rangeRow?: { adIds?: string[] },
                                    ) => {
                                      const p = adPicture(
                                        adName,
                                        rangeRow?.adIds,
                                      );
                                      return (
                                        <div className="flex items-center gap-2">
                                          <CreativePreview
                                            name={adName}
                                            metaAdId={p.metaAdId}
                                            accountId={
                                              p.accountId ??
                                              c.metaAccountId ??
                                              undefined
                                            }
                                            stillUrl={p.stillUrl}
                                            stillTinyUrl={p.stillTinyUrl}
                                            thumbUrl={p.thumbUrl}
                                          />
                                          <span>{adName}</span>
                                        </div>
                                      );
                                    }}
                                    renderAdCall={(
                                      adName: string,
                                      rangeRow?: { adIds?: string[] },
                                    ) => {
                                      const row = ads.find(
                                        (a: Campaign) => a.adName === adName,
                                      );
                                      const sameName = tree.filter(
                                        (t: Campaign) =>
                                          t.kind === "ad" && t.name === adName,
                                      );
                                      const requestAdId =
                                        rangeRow?.adIds?.length === 1
                                          ? rangeRow.adIds[0]
                                          : sameName.length === 1
                                            ? sameName[0].metaId
                                            : undefined;
                                      return (
                                        <div className="flex items-center gap-1.5">
                                          {row && (
                                            <StatusChip
                                              tone={
                                                VERDICT_TONE[row.verdict] ??
                                                "neutral"
                                              }
                                            >
                                              {sentence(row.verdict)}
                                            </StatusChip>
                                          )}
                                          <StatusToggle
                                            compact
                                            metaId={adMetaId(adName)}
                                            level="ad"
                                            name={adName}
                                            clientTag={c.clientTag}
                                            campaignName={c.campaignName}
                                            active={adIsActive(adName)}
                                          />
                                          <RequestCreativeButton
                                            campaignName={c.campaignName}
                                            adId={requestAdId}
                                            adName={adName}
                                            compact
                                          />
                                        </div>
                                      );
                                    }}
                                  />
                                  {(c.findings ?? []).length > 0 && (
                                    <div className="mb-4 rounded-xl bg-muted/40 p-4">
                                      <div className={`mb-3 ${KICKER}`}>
                                        {needsDecision
                                          ? "What needs a decision"
                                          : "Optional optimizations"}
                                      </div>
                                      <div className="space-y-3">
                                        {(c.findings ?? []).map(
                                          // biome-ignore lint/suspicious/noExplicitAny: finding rows
                                          (f: any, i: number) => (
                                            <div key={f.constraint}>
                                              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                                                {f.constraint}
                                                {f.severity ===
                                                "optimization" ? (
                                                  <StatusChip tone="neutral">
                                                    Optimization
                                                  </StatusChip>
                                                ) : (
                                                  i === 0 && (
                                                    <StatusChip tone="bad">
                                                      Fix this first
                                                    </StatusChip>
                                                  )
                                                )}
                                              </div>
                                              <div className="text-sm text-muted-foreground">
                                                {f.evidence}
                                              </div>
                                              <ul className="mt-1 list-disc pl-5 text-sm">
                                                {f.fixes.map((fx: string) => (
                                                  <li key={fx}>{fx}</li>
                                                ))}
                                              </ul>
                                            </div>
                                          ),
                                        )}
                                      </div>
                                      <p className="mt-3 text-xs text-muted-foreground">
                                        {needsDecision
                                          ? "Patch one leak at a time: take the top one today, re-check tomorrow."
                                          : "Nothing needs touching. Cheap leads that book; leave it running, these are optional."}{" "}
                                        The playbook behind these calls:{" "}
                                        <a
                                          className="inline-flex items-center gap-0.5 text-primary hover:underline"
                                          href="https://docs.google.com/document/d/1cioKqspTOI6zK76ob0lOTzfNLDMe5WS6NJ_hgTwb-p4/edit"
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          Diagnosing and fixing acquisition
                                          constraints
                                          <ArrowUpRight
                                            className="size-3.5"
                                            aria-hidden
                                          />
                                        </a>
                                      </p>
                                    </div>
                                  )}
                                  <LostLeads
                                    lost={c.lost}
                                    adNameById={Object.fromEntries(
                                      tree
                                        .filter(
                                          (t: Campaign) =>
                                            t.kind === "ad" && t.metaId,
                                        )
                                        .map((t: Campaign) => [
                                          t.metaId,
                                          t.name,
                                        ]),
                                    )}
                                  />
                                  <BuildPanel
                                    clientTag={c.clientTag ?? c.accountName}
                                    clientName={c.clientName ?? c.accountName}
                                    accountId={c.metaAccountId}
                                    serviceType={c.serviceType}
                                    language={
                                      /[؀-ۿ]/.test(
                                        c.clientName ?? c.accountName,
                                      )
                                        ? "ar"
                                        : "en"
                                    }
                                  />
                                  <LiveInMeta c={c} tree={tree} />
                                </div>
                              )}
                            {mode === "reroute" && (
                              <div className="max-w-2xl space-y-3">
                                <div className="text-sm font-semibold">
                                  Send to another team: {c.campaignName}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  This is not for me: pick what needs to happen
                                  and it lands on that team's ClickUp board as a
                                  request.
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  <RequestCreativeButton
                                    campaignName={c.campaignName}
                                    ads={tree
                                      .filter(
                                        (t: Campaign) =>
                                          t.kind === "ad" && t.metaId,
                                      )
                                      .map((t: Campaign) => ({
                                        metaId: String(t.metaId),
                                        name: String(t.name),
                                      }))}
                                  />
                                  {REQUESTS.map(r => (
                                    <button
                                      key={r.label}
                                      type="button"
                                      aria-pressed={r.label === dept}
                                      onClick={() => setDept(r.label)}
                                      className={choice(r.label === dept)}
                                    >
                                      {r.label}
                                    </button>
                                  ))}
                                </div>
                                <div className="rounded-xl bg-muted/40 p-3 text-sm">
                                  {c.reason}
                                </div>
                                <Textarea
                                  className="min-h-[70px] text-sm"
                                  placeholder="Anything the other team needs to know. It goes into Additional Notes on the ticket."
                                  value={note}
                                  onChange={e => setNote(e.target.value)}
                                />
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      const r =
                                        REQUESTS.find(x => x.label === dept) ??
                                        REQUESTS[0];
                                      act(c, r.label, "rerouted", {
                                        reroutedTo: r.dept,
                                        reason: note || undefined,
                                      });
                                      setNote("");
                                    }}
                                  >
                                    Send to{" "}
                                    {
                                      (
                                        REQUESTS.find(x => x.label === dept) ??
                                        REQUESTS[0]
                                      ).deptLabel
                                    }
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setOpen(null)}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            )}
                            {mode === "leave" && (
                              <div className="max-w-2xl space-y-3">
                                <div className="text-sm font-semibold">
                                  Leave it: {c.campaignName}
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {REASONS.map(r => (
                                    <button
                                      key={r}
                                      type="button"
                                      aria-pressed={r === reason}
                                      onClick={() => setReason(r)}
                                      className={choice(r === reason)}
                                    >
                                      {r}
                                    </button>
                                  ))}
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {CLOCKS.map(r => (
                                    <button
                                      key={r}
                                      type="button"
                                      aria-pressed={r === clock}
                                      onClick={() => setClock(r)}
                                      className={choice(r === clock)}
                                    >
                                      {r}
                                    </button>
                                  ))}
                                </div>
                                <p className="text-xs leading-relaxed text-muted-foreground">
                                  "Client hasn't approved the budget" creates a
                                  CSM touchpoint task. "Disagree with the call"
                                  is logged separately, and a rule disagreed
                                  with three times gets changed, not re-shown.
                                </p>
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    onClick={() =>
                                      act(c, "Left", "left", {
                                        reason,
                                        snooze: clock,
                                      })
                                    }
                                  >
                                    Leave it
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setOpen(null)}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
          </tbody>
        </table>
      </div>
      {adsTab === "running" && (
        <OffBoardCampaigns
          rows={(snap.offBoardCampaigns ?? []) as Campaign[]}
        />
      )}
      {adsTab === "off" && (
        <BoardView
          cards={(snap.boardCards ?? []) as Campaign[]}
          campaigns={(snap.campaigns ?? []) as Campaign[]}
        />
      )}
    </section>
  );

  return (
    <div
      className={`mx-auto w-full space-y-6 ${view === "eod" ? "max-w-3xl" : view === "ads" ? "max-w-[1440px]" : "max-w-6xl"}`}
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">
            {TITLES[view]}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {now.toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}{" "}
            · {synced}
          </p>
        </div>
        {reportProblem}
      </header>

      {/* Only when the data is stale or the last refresh had problems. */}
      <ViktorStatus />

      {/* Clients who wrote on WhatsApp, with the reply already drafted.
          Above the numbers: an unanswered client costs more than a
          metric that moved two points. */}
      <WhatsAppDesk desk="ads" />

      {view === "sod" && (
        <>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
            <div className="min-w-0 space-y-6">
              {sprint}
              {watch}
              {accounts}
            </div>
            <div className="min-w-0 space-y-6">
              <TodayMeetings />
              {clickUp}
            </div>
          </div>
          {tiles}
          <PortfolioTrends />
        </>
      )}

      {view === "ads" && (
        <>
          {tiles}
          {!accountView && <TrackingIssues />}
          {accountView && (
            <AccountView
              client={accountView}
              campaigns={(snap.campaigns as Campaign[]).filter(
                c => (c.clientName ?? c.accountName) === accountView,
              )}
              tree={snap.metaTree ?? []}
              onClose={() => setAccountView(null)}
              onOpenCampaign={name => {
                setAccountView(null);
                setMode("ads");
                setOpen(name);
              }}
            />
          )}
          {!accountView && sweep}
          {!accountView && board}
        </>
      )}

      {view === "tasks" && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
          <div className="min-w-0 space-y-6">
            <Onboardings />
            {tasksCard}
          </div>
          <div className="min-w-0 space-y-6">
            <TodayMeetings />
            {planned}
            {changeLog}
          </div>
        </div>
      )}

      {view === "touch" && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
          <div className="min-w-0">{touch}</div>
          <div className="min-w-0">{changeLog}</div>
        </div>
      )}

      {view === "eod" && (
        <>
          {eod}
          {tomorrow}
          {changeLog}
        </>
      )}
    </div>
  );
}
