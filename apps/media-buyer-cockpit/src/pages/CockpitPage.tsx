import {
  ArrowUpRight,
  Check,
  ChevronRight,
  MessageSquareWarning,
  MoonStar,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { AccountView } from "@/components/AccountView";
import { AdBillingWatch } from "@/components/AdBillingWatch";
import { BuildPanel } from "@/components/BuildPanel";
import { CampaignRange } from "@/components/CampaignRange";
import { CityPicker } from "@/components/CityPicker";
import { ClientLogo } from "@/components/ClientLogo";
import { ClientsNotListed } from "@/components/ClientsNotListed";
import {
  type ClientUpdate,
  ClientUpdateList,
  relevantUpdates,
} from "@/components/ClientUpdates";
import { CockpitSelect } from "@/components/CockpitSelect";
import { CreativePreview } from "@/components/CreativePreview";
import { money as moneyShown } from "@/components/ceo/format";
import { DosDontsList, parseDosDonts } from "@/components/DosDonts";
import { EditPanel } from "@/components/EditPanel";
import { FunnelLine } from "@/components/funnel/FunnelSheet";
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
import { VerdictPlaybook } from "@/components/VerdictPlaybook";
import { ViktorStatus } from "@/components/ViktorStatus";
import { WhatsAppDesk } from "@/components/WhatsAppDesk";
import { useContentTransition } from "@/hooks/use-content-transition";
import { accountIssueFlag, PAYMENT_FILTER } from "@/lib/adBillingStrip";
import {
  ADS_FILTERS,
  adsFilterPasses,
  boardNumbers,
  type RowNumbers,
} from "@/lib/adsFilters";
import { feedbackTaskIdForClient } from "@/lib/appointmentFeedback";
import { api, useAction } from "@/lib/board";
import { adAccountsParam, parseAdAccounts } from "@/lib/clientRange";
import {
  howItIsGoing,
  joinList,
  whatWeDid,
  whatWeDidAll,
} from "@/lib/clientUpdate";
import { type Id, useQueries, useQueryState } from "@/lib/cockpitApi";
import {
  COST_DOT,
  type CostTone,
  costText,
  cpbDisplay,
  cplTone,
} from "@/lib/costTone";
import { HEALTH, healthScore, missingHealth } from "@/lib/eodForm";
import {
  bookingsLine,
  campaignsOverCplGate,
  clientFigures,
  outOfKpiLines as clientOutOfKpiLines,
  decisionEvidence,
  eodTotals,
  figureFor,
  findClientLinks,
  overCplGate,
  overCplGateLabel,
  overCplGateName,
  sourceLine,
} from "@/lib/eodRollup";
import { CPL_BAD, CPL_GATE, LEARNING_DAYS } from "@/lib/kpi";
import { type MediaCoverage, pairedDay } from "@/lib/mediaStatsClient";
import { type EodOutbox, eodDeliveryNote } from "@/lib/personalEod";
import {
  defaultRange,
  kuwaitDay as kuwaitToday,
  type Range,
  rangeFromParam,
  rangeToParam,
  savedRange,
  saveRange,
} from "@/lib/range";
import { useMediaBuyerSnapshot } from "@/lib/useMediaBuyerSnapshot";
import { CampaignChangesResults } from "../components/CampaignChangesResults";
import { CampaignChat } from "../components/CampaignChat";
import { LeadSyncBadge, LeadSyncStrip } from "../components/LeadSync";
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
/** A new day's EOD form: health scores to fill in, the tasks at their usual Yes. */
const EOD_BLANK: Record<string, string> = {
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
};

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

/** Meta ad ids per ad name, from the tree: several ads can share a name. */
function idsByName(tree: Campaign[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of tree) {
    if (t.kind !== "ad" || !t.metaId) continue;
    const name = String(t.name);
    out[name] = [...(out[name] ?? []), String(t.metaId)];
  }
  return out;
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
  // Cheap leads that do not book: the first look is the booking side, not
  // the switch.
  if (c.verdict === "kill" && (c.cpl ?? Number.POSITIVE_INFINITY) <= CPL_GATE)
    return ["Cut the worst ad", "Check speed to lead with the CSM"];
  if (c.verdict === "kill") return ["Turn it off", "Cut the worst ad"];
  if (c.verdict === "fatiguing")
    return ["Queue replacement creative", "Cut the worst ad"];
  // Only a campaign the grid calls Scale earns a one-click raise: cheap leads
  // with no bookings do not.
  if (c.dayRate < 30 && c.verdict === "scale") {
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

/**
 * The media buyer's three screens here (the simplification audit, approved
 * 2026-10-06): Today (it took in the Task list and Touchpoints, which
 * redirect to their part of it), Ads, and End of day.
 */
type View = "sod" | "ads" | "eod";

/** Ad Status values that take a campaign out of the active list (the board is the truth). */
const OFF_STATUSES = ["Paused", "Dead Campaign", "Lost Client"];
const isOffOnBoard = (c: Campaign) =>
  OFF_STATUSES.some(
    s => s.toLowerCase() === String(c?.boardAdStatus ?? "").toLowerCase(),
  );
const clientOf = (c: Campaign | undefined) =>
  String(c?.clientName ?? c?.accountName ?? "Unassigned");

const logoKey = (c: Campaign) =>
  String(c.clientTag || c.clientName || c.accountName || c.tag || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

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
  logoSrc,
  links,
  updates,
  onOpen,
  rulesBelow = false,
}: {
  name: string;
  logoSrc?: string;
  links?: Campaign;
  updates: ClientUpdate[];
  /** Shows this one client in full, in place of the table. */
  onOpen?: () => void;
  /**
   * One of this client's campaigns is open below, carrying the same do's and
   * don'ts and card comment, so the header does not show them a second time.
   */
  rulesBelow?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasRules = parseDosDonts(links?.dosDonts).length > 0;
  return (
    <>
      <span className="inline-flex max-w-full items-center gap-2 align-middle">
        <ClientLogo name={name} src={logoSrc} />
        {onOpen ? (
          <button
            type="button"
            className="campaign-client-name min-w-0 break-words text-left hover:underline"
            onClick={onOpen}
            title={`Show ${name} in full`}
          >
            {name}
          </button>
        ) : (
          <span className="campaign-client-name min-w-0 break-words">
            {name}
          </span>
        )}
        <LeadSyncBadge client={name} />
      </span>
      <ClientLinks
        links={links}
        dosOpen={open}
        hasUpdates={updates.length > 0}
        onDos={rulesBelow ? undefined : () => setOpen(o => !o)}
      />
      {open && !rulesBelow && (
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
    const request: Promise<string[]> =
      statusOptionsCache ?? Promise.resolve(loadOptions({}));
    statusOptionsCache = request;
    request.then(setOptions).catch(() => {
      statusOptionsCache = null;
      setOptions([]);
    });
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
  clientLogos,
}: {
  cards: Campaign[];
  campaigns: Campaign[];
  clientLogos: Record<string, string>;
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
                <span className="min-w-0 break-words font-medium">
                  {c.name}
                </span>
                <span className="inline-flex min-w-0 max-w-full items-center gap-2">
                  <ClientLogo
                    name={String(
                      c.clientTag ||
                        c.clientName ||
                        c.accountName ||
                        c.tag ||
                        "Unassigned",
                    )}
                    src={clientLogos[logoKey(c)]}
                  />
                  {c.tag && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {c.tag}
                    </span>
                  )}
                </span>
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

export function TodayPage() {
  return <Cockpit view="sod" />;
}
export function AdsPage() {
  return <Cockpit view="ads" />;
}
export function EndOfDayPage() {
  return <Cockpit view="eod" />;
}

/** The morning checklist's links into what used to be pages, now parts of Today. */
const HERE: Record<string, string> = {
  "/tasks": "/dashboard#tasks",
  "/touchpoints": "/dashboard#touchpoints",
};

const TITLES: Record<View, string> = {
  sod: "Today",
  ads: "Ads",
  eod: "End of day",
};

function Cockpit({ view }: { view: View }) {
  const adsTransition = useContentTransition();
  const navigate = useNavigate();
  const auth = useCockpitAuth();
  const sb = useMediaBuyerSnapshot(auth.client, auth.clients);
  const snap = sb.snap;
  const toggleCheck = sb.toggleCheck;
  const decide = sb.decide;
  const loadClientLogos = useAction(api.clientLogos.list);
  const [clientLogos, setClientLogos] = useState<Record<string, string>>({});
  const [clientLogosError, setClientLogosError] = useState(false);
  const hasSnapshot = Boolean(snap);
  useEffect(() => {
    setClientLogos({});
    if (!hasSnapshot || view !== "ads") return;
    let cancelled = false;
    setClientLogosError(false);
    void loadClientLogos({}).then(
      (logos: { clientKey: string; url: string }[]) => {
        if (!cancelled)
          setClientLogos(
            Object.fromEntries(
              logos.map((logo: { clientKey: string; url: string }) => [
                logo.clientKey,
                logo.url,
              ]),
            ),
          );
      },
      () => {
        if (!cancelled) setClientLogosError(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [hasSnapshot, view, loadClientLogos, auth.session?.user.id]);
  const run = useAction(api.execute.runAction);
  const addPlanItems = sb.addPlanItems as any;
  const askForDetail = useAction(api.cockpit.askForDetail);
  const setClientLanguage = useAction(api.cockpit.setClientLanguage);
  const removeDecision = sb.removeDecision as any;
  const saveEod = sb.saveEod as any;
  const sendFeedback = sb.sendFeedback as any;
  /** Today's EOD row, if one was saved: the submitted state lives here, not in the tab. */
  const eodRow = (snap?.eod ?? null) as {
    submittedAt?: number;
    error?: string;
    answers?: Record<string, unknown>;
    delivery?: EodOutbox | null;
  } | null;
  /** Where the submitted EOD is on its way to Slack, from its outbox row. */
  const eodDelivery = eodDeliveryNote(eodRow);
  // While it waits for the worker (every 5 minutes), read its state again each
  // minute for up to 20 minutes, so "Posted to Slack at" appears on its own.
  const eodWaiting =
    Boolean(eodRow?.submittedAt) &&
    !eodRow?.delivery?.slackPosted &&
    (eodRow?.delivery?.status === "queued" ||
      eodRow?.delivery?.status === "processing");
  const refreshEod = sb.refreshEod;
  useEffect(() => {
    if (!eodWaiting) return;
    let left = 20;
    const timer = setInterval(() => {
      if (left-- <= 0) clearInterval(timer);
      else void refreshEod().catch(() => undefined);
    }, 60_000);
    return () => clearInterval(timer);
  }, [eodWaiting, refreshEod]);

  const [open, setOpen] = useState<string | null>(null);
  /**
   * When set, the ads tab shows one client in full instead of the table. It
   * lives in the address (?account=), so the page can be opened, reloaded,
   * shared and left with the browser's back button like any other.
   */
  const [params, setParams] = useSearchParams();
  const accountView = view === "ads" ? params.get("account") : null;
  // The ad accounts a client's page was opened with (?adAccounts=): a client
  // with no campaign listed is read by them on every range (R8, 2026-10-22).
  const accountIdsParam = params.get("adAccounts");
  const accountIds = useMemo(
    () => parseAdAccounts(accountIdsParam),
    [accountIdsParam],
  );
  const setAccountView = (name: string | null, accounts: string[] = []) =>
    setParams(prev => {
      const next = new URLSearchParams(prev);
      if (name) next.set("account", name);
      else next.delete("account");
      const ids = name ? adAccountsParam(accounts) : "";
      if (ids) next.set("adAccounts", ids);
      else next.delete("adAccounts");
      next.delete("campaign");
      return next;
    });
  // The window each campaign is being read over. One default for the screen,
  // overridable per campaign — she often wants "today" on one client while
  // the rest stay on the 7-day read. [aziz, 2026-09-07] The board and a
  // client's page share it, it lives in the address (?range=3d), and the
  // last preset is kept on this device, so a 3-day pick no longer snaps back
  // to 7 days (Nada, 2026-10-01; the simplification audit, 2026-10-06).
  const rangeParam = params.get("range");
  const globalRange = useMemo(
    () => rangeFromParam(rangeParam) ?? savedRange() ?? defaultRange(),
    [rangeParam],
  );
  const setGlobalRange = (r: Range) => {
    saveRange(r);
    setParams(
      prev => {
        const next = new URLSearchParams(prev);
        next.set("range", rangeToParam(r));
        return next;
      },
      { replace: true },
    );
  };
  const [ranges, setRanges] = useState<Record<string, Range>>({});
  const rangeFor = (name: string) => ranges[name] ?? globalRange;
  const setRange = (name: string, r: Range) =>
    setRanges(prev => ({ ...prev, [name]: r }));
  // The board follows the picked range. On the 7-day default it keeps the
  // snapshot's read; otherwise one range read per campaign. useQueries keys on
  // the object's identity, so the object is rebuilt only when the campaigns or
  // the range change (see AccountView, React error #301).
  // Only while the board is on screen: a client's page and the other
  // screens read nothing for it (the Convex usage rule).
  const boardKey =
    globalRange.key === "7d" || view !== "ads" || accountView
      ? ""
      : JSON.stringify([
          ((snap?.campaigns ?? []) as Campaign[])
            .map(c => String(c.campaignName))
            .sort(),
          globalRange.start,
          globalRange.end,
        ]);
  const boardQueries = useMemo(() => {
    if (!boardKey) return {};
    const [names, start, end] = JSON.parse(boardKey) as [
      string[],
      string,
      string,
    ];
    return Object.fromEntries(
      names.map(campaignName => [
        campaignName,
        { query: api.stats.range, args: { campaignName, start, end } },
      ]),
    );
  }, [boardKey]);
  const boardReads = useQueries(boardQueries) as Record<
    string,
    Campaign | Error | undefined
  >;
  // The paired day, the last day every account's spend is in: every range
  // read counts spend, leads and bookings only through it
  // (mediaStatsClient.ts), and the note under the range picker names it.
  // The same shared read, so the two always agree.
  const coverage = useQueryState<MediaCoverage>(
    api.stats.coverage,
    view === "ads" ? {} : "skip",
  );
  const [mode, setMode] = useState<"ads" | "reroute" | "leave">("ads");
  const [campaignPanelTab, setCampaignPanelTab] = useState<
    "recommendations" | "changes"
  >("recommendations");
  // A client's page opens on "What to do", whatever tab the last one had.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new client is the trigger
  useEffect(() => {
    setCampaignPanelTab("recommendations");
  }, [accountView]);
  const [dept, setDept] = useState(REQUESTS[0].label);
  const [reason, setReason] = useState(REASONS[0]);
  const [clock, setClock] = useState(CLOCKS[1]);
  const [dump, setDump] = useState("");
  const [ask, setAsk] = useState<string | null>(null);
  const [askText, setAskText] = useState("");
  const [askWho, setAskWho] = useState<string>("");
  // The Payments strip on Today opens the board as /ads?filter=payment. The
  // address is read once and cleared, so a reload does not pin the filter.
  const [filter, setFilter] = useState(() =>
    params.get("filter") === "payment" ? PAYMENT_FILTER : ADS_FILTERS[0].label,
  );
  useEffect(() => {
    if (!params.has("filter")) return;
    setParams(
      prev => {
        const next = new URLSearchParams(prev);
        next.delete("filter");
        return next;
      },
      { replace: true },
    );
  }, [params, setParams]);
  // Ads management has two tabs: what is running, and what the board has off
  // with nothing running on Meta. [Aziz, 2026-09-14]
  const [adsTab, setAdsTab] = useState<"running" | "off">("running");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [onePercent, setOnePercent] = useState("");
  const [eodSending, setEodSending] = useState(false);
  /** After a refused submit, the empty health scores are outlined. */
  const [eodTried, setEodTried] = useState(false);
  /** A client's page reads the board's range, and opens a campaign the
   *  search box named (?campaign=). */
  const accountRange = globalRange;
  const setAccountRange = setGlobalRange;
  const accountCampaign = params.get("campaign");
  const setAccountCampaign = (name: string | null) =>
    setParams(prev => {
      const next = new URLSearchParams(prev);
      if (name) next.set("campaign", name);
      else next.delete("campaign");
      return next;
    });
  // The old Task list and Touchpoints addresses land on their part of Today.
  const location = useLocation();
  const ready = snap !== undefined;
  useEffect(() => {
    if (view !== "sod" || !location.hash || !ready) return;
    // A jump, not a glide: a glide never runs in a background tab.
    document
      .getElementById(location.hash.slice(1))
      ?.scrollIntoView({ block: "start" });
  }, [view, location.hash, ready]);
  /** The EOD form's own human answers. Numbers are filled in for her. */
  const [eodForm, setEodForm] = useState<Record<string, string>>(EOD_BLANK);
  const setEod = (k: string, val: string) =>
    setEodForm(f => ({ ...f, [k]: val }));
  // Switching tabs remounts this component and a reload clears it, but
  // today's row may already be saved: show what was filed rather than an
  // empty form under a "Submitted" button.
  const eodSeeded = useRef(false);
  // A new report day (the page stayed open past 04:00 after a submit) starts
  // from a blank form, not from yesterday's answers.
  const eodFormDay = useRef<string | undefined>(undefined);
  useEffect(() => {
    const day = snap?.eodDay as string | undefined;
    if (!day) return;
    if (eodFormDay.current && eodFormDay.current !== day) {
      eodSeeded.current = false;
      setEodForm(EOD_BLANK);
      setOnePercent("");
      setEodTried(false);
    }
    eodFormDay.current = day;
  }, [snap?.eodDay]);
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
  /**
   * What each client should hear from us today, one message per client.
   *
   * Aziz, 2026-09-27: most clients do not know what a lead is and never see
   * one; they see appointments in their calendar. So the message never quotes
   * leads or cost per lead: it says what we did today in their words, how the
   * campaign is doing in plain words, and counts appointments only for
   * clients we book for (lib/clientUpdate.ts). Her own line above the message
   * keeps the numbers.
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
    /** Her saved choice wins; the client's own name is only the fallback guess. */
    // biome-ignore lint/suspicious/noExplicitAny: pref row
    const prefLang = new Map<string, string>(
      ((snap?.prefs ?? []) as any[]).map(p => [p.clientName, p.language]),
    );
    const isArabic = (t: string) =>
      prefLang.get(t) ? prefLang.get(t) === "ar" : /[؀-ۿ]/.test(t);
    // Today's changes, oldest first: the decisions she took and the change
    // log, which also holds what a decision did on Meta.
    const since = Date.parse(`${snap?.day ?? kuwaitToday()}T00:00:00+03:00`);
    const today = [
      ...((snap?.decisions ?? []) as Campaign[])
        .filter(d => d.kind !== "touch")
        .map(d => ({
          campaign: String(d.subject),
          label: String(d.action),
          at: Number(d.loggedAt ?? d._creationTime ?? 0),
        })),
      ...((snap?.manualChanges ?? []) as Campaign[])
        .filter(m => Number(m.at) >= since)
        .map(m => ({
          campaign: String(m.campaignName),
          label: String(m.what),
          at: Number(m.at),
        })),
    ].sort((a, b) => a.at - b.at);
    // Told today already: "I sent it, log it" takes the client off the list.
    const told = new Set(
      ((snap?.decisions ?? []) as Campaign[])
        .filter(d => d.kind === "touch")
        .map(d => String(d.subject)),
    );
    const byClient = new Map<string, Campaign[]>();
    for (const c of (snap?.campaigns ?? []) as Campaign[]) {
      if (c.internal) continue;
      const client = c.clientName ?? c.campaignName;
      byClient.set(client, [...(byClient.get(client) ?? []), c]);
    }
    // Each client's own 7 days (eodRollup.ts): the media sync's figure,
    // stopped campaigns included, else its listed campaigns summed.
    const figures = clientFigures(
      (snap?.campaigns ?? []) as Campaign[],
      (snap?.clientLinks ?? []) as Campaign[],
    );
    const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
    for (const [client, list] of byClient) {
      if (list.some(c => told.has(c.campaignName))) continue;
      // The biggest spender speaks for the client's week.
      const c = [...list].sort(
        (a, b) => Number(b.spend7d ?? 0) - Number(a.spend7d ?? 0),
      )[0];
      const lang: "ar" | "en" = isArabic(client) ? "ar" : "en";
      const ar = lang === "ar";
      const names = new Set(list.map(x => x.campaignName));
      const labels = today
        .filter(t => names.has(t.campaign) || t.campaign === client)
        .map(t => t.label);
      const done = whatWeDidAll(labels, lang);
      const weBook = list.some(x => x.serviceMode !== "DWY");
      // The client's own 7 days: its bookings added up across its
      // campaigns, never the largest one (bookings7d is per campaign).
      const fig = figureFor(figures, client);
      const bookings = fig?.bookings ?? undefined;
      const going = howItIsGoing(
        { verdict: c.verdict, bookings, weBook },
        lang,
      );
      const leads7 = fig?.leads ?? Number(c.leads7d ?? 0);
      const spend7 = fig?.spend ?? Number(c.spend7d ?? 0);
      const numbers = `7 days: ${leads7} leads at ${leads7 > 0 ? moneyShown(spend7 / leads7) : "n/a"}${weBook ? `, ${bookings ?? "n/a"} booked` : ""}`;
      const base = { campaign: c, key: c.campaignName, client, lang };
      if (done.length > 0) {
        const kept = labels.filter(l => whatWeDid(l, "en") !== null);
        out.push({
          ...base,
          why: `Changed today: ${[...new Set(kept)].join(", ")} · ${numbers}`,
          short: "told them today's changes",
          message: ar
            ? `صباح الخير 👋 تحديث سريع على حملتكم: اليوم ${joinList(done, lang)}.\n\n` +
              `${going}.\n\n` +
              "بنعطيها يومين ثلاثة ونقولكم شلون ماشية."
            : `Morning 👋 a quick update on your campaign: today we ${joinList(done, lang)}.\n\n` +
              `${cap(going)}.\n\n` +
              "We'll give it two or three days and let you know how it's going.",
        });
      } else if (c.verdict === "scale" && c.leads7d >= 5) {
        out.push({
          ...base,
          why: `Good week: send the win before they have to ask · ${numbers}`,
          short: "shared the week's result",
          message: ar
            ? `أسبوع زين على حملتكم 👌 ${going}.\n\n` +
              "بنخليها على نفس الخط، ونجرب فكرة يديدة على جنب عشان نطلع منها أكثر."
            : `Good week on your campaign 👌 ${cap(going)}.\n\n` +
              "We're keeping it running as it is and testing one new idea on the side to make it even better.",
        });
      } else if (c.verdict === "fatiguing" || c.verdict === "kill") {
        const creative = c.findings?.[0]?.constraint === "Creative";
        out.push({
          ...base,
          why: `Tell them before the number gets worse, not after · ${numbers}`,
          short: "flagged performance and the fix",
          message: ar
            ? `حبينا نقولكم قبل لا تلاحظون 🙏 ${going}.\n\n` +
              `احنا شغالين عليها: ${creative ? "قاعدين نسوي إعلانات يديدة" : "قاعدين نعدّل الاستهداف والميزانية"}.\n\n` +
              "نرجع لكم خلال كم يوم ونقولكم شلون صارت."
            : `Wanted to tell you before you notice it 🙏 ${cap(going)}.\n\n` +
              `We're already on it: ${creative ? "new ads are being made" : "we're adjusting who sees the ads and the budget"}.\n\n` +
              "We'll come back to you in a few days with how it's going.",
        });
      }
    }
    return out.slice(0, 8);
  }, [snap]);

  /** The four blocks the SOP asks for, filled in from what actually happened today. */
  /**
   * The EOD form's own fields, filled in from what actually happened. She types the
   * two human answers; every number is already known.
   */
  /**
   * The numbers the EOD form asks for. The form says "today", so spend,
   * leads and cost per lead are today's, not the 7-day window the rest of
   * the cockpit runs on. "Any client over the gate" is judged on each
   * campaign's 7-day cost per lead (one day is too few leads), and says so.
   * No leads today reads "no leads", never $0.
   */
  const eodNumbers = useMemo(() => {
    const cs = ((snap?.campaigns ?? []) as Campaign[]).filter(c => !c.internal);
    const spend = cs.reduce((t, c) => t + (c.spendToday ?? 0), 0);
    const leads = cs.reduce((t, c) => t + (c.leadsToday ?? 0), 0);
    // Over the $15 gate, or no lead on 2 x the gate or more (decision 4).
    const over = campaignsOverCplGate(cs);
    return {
      spend: Math.round(spend),
      leads,
      cpl: leads > 0 ? (spend / leads).toFixed(0) : "no leads",
      accounts: cs.length,
      overGate: over.length ? "Yes (7-day CPL)" : "No (7-day CPL)",
      overNames: over.map(overCplGateName),
      through: cs
        .map(c => c.dataThrough)
        .filter(Boolean)
        .sort()
        .pop(),
    };
  }, [snap]);

  /**
   * Each client's own 7 days, once (eodRollup.ts, 2026-10-22): the media
   * sync's figure on the client card, stopped campaigns included, or the
   * client's listed campaigns summed when it has none.
   */
  const figures = useMemo(
    () =>
      clientFigures(
        (snap?.campaigns ?? []) as Campaign[],
        (snap?.clientLinks ?? []) as Campaign[],
      ),
    [snap],
  );

  /**
   * The clients out of KPI, one "• client - metric → next action" line each,
   * on the client's own figure with its worst campaign named: the preview's
   * list, and what "Start from the cockpit's list" puts in her answer so
   * she edits it instead of copying from the preview.
   */
  const outOfKpiLines = useMemo(() => clientOutOfKpiLines(figures), [figures]);

  const eodReport = useMemo(() => {
    if (snap?.eod?.submittedAt && typeof snap.eod.body === "string")
      return snap.eod.body;
    const cs = ((snap?.campaigns ?? []) as Campaign[]).filter(c => !c.internal);
    const ds = (snap?.decisions ?? []) as {
      subject: string;
      action: string;
      kind: string;
      reason?: string;
    }[];
    // One figure per client, summed: never a campaign's count read twice.
    const totals = eodTotals(figures);
    const spend = totals.spend;
    const leads = totals.leads;
    const overGate = overCplGate(figures);
    const lines: string[] = [
      `EOD - ${snap?.eodDay ? new Date(snap.eodDay + "T12:00:00+03:00").toLocaleDateString("en-GB", { timeZone: "Asia/Kuwait", weekday: "long", day: "numeric", month: "long" }) : "Date unavailable"}`,
      "",
      `Active client accounts managed: ${cs.length}`,
      `Total ad spend (7d): ${money(spend)}`,
      `Total leads (7d): ${leads}`,
      `Average CPL (7d): ${leads > 0 ? money(spend / leads, 2) : "no leads"}`,
      bookingsLine(totals),
      `${overCplGateLabel()}: ${overGate.length ? `Yes: ${overGate.join(", ")}` : "No"}`,
      sourceLine(totals),
      "",
      "ACCOUNT BY ACCOUNT - WHAT I CHANGED AND WHY",
      ...(ds.length
        ? ds.map(
            d =>
              `• ${d.subject} - ${d.action}${d.reason ? ` (${d.reason})` : ""}`,
          )
        : ["• No changes logged today"]),
      "",
      "CLIENTS OUT OF KPI - METRIC AND NEXT ACTION",
      ...(outOfKpiLines.length ? outOfKpiLines : ["• None"]),
    ];
    return lines.join("\n");
  }, [snap, figures, outOfKpiLines]);

  const decidedBySubject = useMemo(() => {
    const m = new Map<string, { action: string; reroutedTo?: string }>();
    for (const d of snap?.decisions ?? [])
      m.set(d.subject, { action: d.action, reroutedTo: d.reroutedTo });
    return m;
  }, [snap]);

  if (sb.error) {
    return (
      <p role="alert" className="p-6 text-sm">
        Could not load your cockpit: {sb.error.message}. Reload to try again.
      </p>
    );
  }

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
      // The campaign first: a reason quoted on the client's card (the CSM
      // brief) otherwise reads as the client's own figure (R16, 2026-10-22).
      // Its name is cleaned and shortened so the reason's figures fit the
      // brief's cut; the full name is the subject.
      evidence: decisionEvidence(String(c.campaignName), c.reason),
      metricAtDecision: c.cpl ?? undefined,
      ...extra,
    });
    setOpen(null);
    // On the account page the panel stays open: back to its first view.
    setMode("ads");
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
        dueDate: kuwaitToday(-1),
      }));
    if (!items.length) return;
    await addPlanItems({ items });
    setDump("");
    toast.success(
      `${items.length} task${items.length > 1 ? "s" : ""} queued for tomorrow`,
    );
  };

  /** The row's numbers for the picked range; undefined until they are read. */
  const rangedBoard = globalRange.key !== "7d";
  const rowNumbers = (c: Campaign): RowNumbers | undefined => {
    const n = boardNumbers(c, rangedBoard, boardReads[String(c.campaignName)]);
    return n.state === "ok" ? n : undefined;
  };
  /** The filter's own rule; "Undecided today" reads today's decisions. */
  const passes = (label: string, c: Campaign) =>
    label === "Undecided today"
      ? !decidedBySubject.has(c.campaignName)
      : adsFilterPasses(label, c, rowNumbers(c));

  /** One flag per row, the most urgent; the rest wait in the opened panel. */
  const flagFor = (
    c: Campaign,
  ): { label: string; tone: Tone; title?: string } | null => {
    // A grace period or a review still runs on Meta: a warning, not red.
    const issue = accountIssueFlag(c.accountIssue);
    if (issue)
      return {
        label: issue.label,
        tone: issue.tone === "critical" ? "bad" : "warn",
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
  // Kuwait time, like every other time in the cockpit: the browser's own
  // zone made the header disagree with the refresh line under it.
  const kuwaitDate = (d: Date) =>
    d.toLocaleDateString("en-CA", { timeZone: "Asia/Kuwait" });
  const synced = lastSync ? (
    <>
      synced{" "}
      {kuwaitDate(lastSync) === kuwaitDate(now)
        ? ""
        : `${lastSync.toLocaleDateString("en-GB", { weekday: "short", timeZone: "Asia/Kuwait" })} `}
      <span className="font-mono">
        {lastSync.toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Kuwait",
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
        {(
          [
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
              // Muhammed's grid (kpi.ts): good to $15, a warning to $22.50,
              // bad above it.
              l: "Blended CPL",
              v: moneyOr(t.blendedCpl, 2),
              d:
                t.blendedCpl == null
                  ? "no client leads yet"
                  : t.blendedCpl <= CPL_GATE
                    ? `within the $${CPL_GATE} gate`
                    : t.blendedCpl <= CPL_BAD
                      ? `over the $${CPL_GATE} gate`
                      : `over $${CPL_BAD.toFixed(2)}, well over the gate`,
              tone: cplTone(t.blendedCpl),
            },
            {
              l: "Under the $30/day floor",
              v: String(t.underFloor),
              d: "campaigns",
              tone: t.underFloor > 0 ? "bad" : undefined,
            },
            {
              l: "Not on the board",
              v: String(t.offBoard),
              d: "campaigns with spend",
              tone: t.offBoard > 0 ? "bad" : undefined,
            },
          ] as { l: string; v: string; d?: string; tone?: CostTone }[]
        ).map((k, i) => (
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
                {k.tone ? (
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: COST_DOT[k.tone] }}
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
      {/* ClickUp posting is the writeback switch CLICKUP_WRITEBACK_APPLY
          (supabase/functions/clickup-writeback/run.ts). On 13 October it was
          off and media buyer decisions sat in dry run; say so until it is on. */}
      <p className="mt-1 text-sm text-muted-foreground">
        Each decision you take here is saved in the cockpit with the numbers
        behind it. Posting decisions to ClickUp is off for now, so the campaign
        task does not get a comment.
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
                  <span className="text-muted-foreground">
                    Saved in the cockpit
                  </span>
                  {d.clickupTaskUrl ? (
                    <a
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
                      href={d.clickupTaskUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      ClickUp task
                      <ArrowUpRight className="size-3.5" aria-hidden />
                    </a>
                  ) : null}
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
                onClick={() => toggleCheck({ id: c._id, done: !c.done })}
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
                    // The Task list and Touchpoints are parts of Today now.
                    to={HERE[c.href] ?? c.href}
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
                    act(tp.campaign, `Client updated: ${tp.short}`, "touch", {})
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
            Your day from today's decisions. Submit below and your answers go to
            #media-eods and the EOD sheet for you.
          </p>
        </div>
      </div>
      <pre className="mt-4 whitespace-pre-wrap rounded-xl bg-muted/40 p-4 font-sans text-sm leading-relaxed">
        {eodReport}
      </pre>
      <fieldset
        disabled={eodSending || Boolean(eodRow?.submittedAt)}
        className="mt-6 space-y-6"
      >
        <div>
          <div className={KICKER}>Health, 1 to 10</div>
          <div className="mt-2 grid grid-cols-3 gap-3">
            {HEALTH.map(([k, label]) => (
              <label key={k} className="text-xs">
                <span className="text-muted-foreground">{label}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  required
                  min={1}
                  max={10}
                  step={1}
                  value={eodForm[k]}
                  aria-invalid={
                    eodTried && !healthScore(eodForm[k]) ? true : undefined
                  }
                  onChange={e => setEod(k, e.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border bg-background px-2 text-sm aria-[invalid=true]:border-destructive"
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
              [
                "CPL today",
                eodNumbers.leads > 0 ? `$${eodNumbers.cpl}` : "no leads",
              ],
              ["Accounts", String(eodNumbers.accounts)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-sm">
            {overCplGateLabel()}:{" "}
            <span className="font-semibold">
              {eodNumbers.overNames.length > 0 ? "Yes" : "No"}
            </span>
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
            placeholder="Clients out of KPI and what you're doing about it, one client per line."
            value={eodForm.outOfKpi}
            onChange={e => setEod("outOfKpi", e.target.value)}
          />
          {outOfKpiLines.length > 0 && !eodForm.outOfKpi.trim() && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEod("outOfKpi", outOfKpiLines.join("\n"))}
            >
              Start from the cockpit's list ({outOfKpiLines.length})
            </Button>
          )}
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
              setEodTried(true);
              const missing = missingHealth(eodForm);
              if (missing) {
                toast.error(`Add your ${missing} (1 to 10) first.`);
                return;
              }
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
                // button below reads that from the snapshot, and the
                // line under it says when Slack took it.
                toast.success(
                  "Your EOD is submitted. It posts to #media-eods within 5 minutes.",
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
          {eodRow && !eodRow.submittedAt && (
            <span className="text-xs text-muted-foreground">
              Draft saved. Submit when it is ready.
            </span>
          )}
        </div>
      </fieldset>
      {eodDelivery ? (
        <p
          role="status"
          className="mt-4 flex items-start gap-2 text-sm text-foreground"
        >
          <span
            aria-hidden
            className="mt-1.5 size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: TONE_DOT[eodDelivery.tone] }}
          />
          <span>{eodDelivery.text}</span>
        </p>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          Submit before 04:00 Kuwait time: after that the form opens the next
          day.
        </p>
      )}
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
            onClick={() => toggleCheck({ id: c._id, done: !c.done })}
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

  /**
   * One campaign in full: its status and links, the client's rules, the
   * calls and the edits, and its ad sets and ads over a range with their
   * pictures and controls. The table's open row and the account page show
   * this same panel, so nothing can be done in one and not the other.
   * [Aziz, 2026-09-27]
   */
  const campaignPanel = (
    c: Campaign,
    where: {
      range: Range;
      onRangeChange: (r: Range) => void;
      /** Cancel in the reroute and leave forms. */
      onDone: () => void;
      /** On the account page: its own ad wall and lost leads replace these. */
      inAccount?: boolean;
    },
  ) => {
    const links = findClientLinks(
      (snap.clientLinks ?? []) as Campaign[],
      clientOf(c),
    );
    const updates = updatesFor(snap.clientUpdates as ClientUpdate[], links);
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
    // The insights table keys ads by name; the Meta tree keys
    // them by id. Bridge the two so a row can be toggled.
    const adNode = (adName: string) =>
      tree.find((t: Campaign) => t.kind === "ad" && t.name === adName);
    const adMetaId = (adName: string) => adNode(adName)?.metaId;
    const adIsActive = (adName: string) =>
      (adNode(adName)?.effectiveStatus ?? adNode(adName)?.status) === "ACTIVE";
    // The picture for one row of the ads table. The range
    // table knows the row's ad ids, so the tree node is
    // matched by id first and by name only as a fallback.
    // Stored preview links are never passed: the preview
    // is fetched when she opens it.
    const adPicture = (adName: string, adIds?: string[]) => {
      const byId = (adIds ?? [])
        .map((id: string) =>
          tree.find((t: Campaign) => t.kind === "ad" && t.metaId === id),
        )
        .filter(Boolean);
      const node: Campaign =
        byId.find((t: Campaign) => t.stillUrl || t.stillTinyUrl) ??
        byId[0] ??
        adNode(adName);
      const metaAdId: string | undefined = node?.metaId ?? adIds?.[0];
      const row: Campaign = ads.find((a: Campaign) => a.adName === adName);
      // The ads row is keyed by name; trust its picture
      // first only when it is the same ad.
      const same =
        row && (!row.metaAdId || !metaAdId || row.metaAdId === metaAdId);
      const first = same ? row : node;
      const second = same ? node : row;
      return {
        metaAdId: metaAdId ?? row?.metaAdId,
        accountId: node?.accountId as string | undefined,
        stillUrl: (first?.stillUrl ?? second?.stillUrl) as string | undefined,
        stillTinyUrl: (first?.stillTinyUrl ?? second?.stillTinyUrl) as
          | string
          | undefined,
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
      <>
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
                  <ArrowUpRight className="size-3.5" aria-hidden />
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
                  <ArrowUpRight className="size-3.5" aria-hidden />
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
                    // A grace period or a review is a warning, as on the
                    // row chip above it; unpaid, disabled or closed is red.
                    backgroundColor:
                      TONE_DOT[
                        accountIssueFlag(c.accountIssue)?.tone === "warning"
                          ? "warn"
                          : "bad"
                      ],
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
                      action: "Client card declined, chase the payment",
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
              The board has this campaign as {c.boardAdStatus}, but Meta is
              still running it and spending. Pause it on Meta, or set the Ad
              Status back to Live.
            </p>
          )}
          {!isOffOnBoard(c) && offOnMeta.has(c.campaignName) && (
            <p className="flex items-start gap-2 text-xs">
              <span
                aria-hidden
                className="mt-1 size-1.5 shrink-0 rounded-full"
                style={{
                  backgroundColor: TONE_DOT.warn,
                }}
              />
              The board says this campaign is on, but nothing is delivering on
              Meta. If it is off, set the Ad Status.
            </p>
          )}
          {c.staleTaskName && (
            <p className="text-xs">
              The board card still says “{c.staleTaskName}
              ”. <RenameCardButton campaignName={c.campaignName} />
            </p>
          )}
          <CityPicker
            campaignName={c.campaignName}
            cities={c.advertisingCities}
            hasCard={Boolean(c.taskId)}
          />
        </div>
        <FunnelLine campaignName={c.campaignName} range={where.range} />
        <ClientRules name={clientOf(c)} links={links} updates={updates} />
        <div
          className="mb-4 flex gap-1 overflow-x-auto border-b [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="group"
          aria-label="Campaign details"
        >
          <button
            type="button"
            aria-pressed={campaignPanelTab === "recommendations"}
            onClick={() => {
              setMode("ads");
              setCampaignPanelTab("recommendations");
            }}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-2.5 py-2 text-sm font-medium sm:px-3 ${campaignPanelTab === "recommendations" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            What to do
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
              .filter((t: Campaign) => t.kind === "ad" && t.metaId)
              .map((t: Campaign) => ({
                metaId: String(t.metaId),
                name: String(t.name),
                status: String(t.effectiveStatus ?? t.status),
              }))}
          />
        )}
        {mode === "ads" && campaignPanelTab === "recommendations" && (
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
                onClick={() => act(c, acts[0], "approved")}
              >
                {acts[0]}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 whitespace-nowrap px-2.5 text-xs"
                onClick={() => act(c, acts[1], "alternative")}
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
                    (t.effectiveStatus ?? t.status) === "ACTIVE",
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
              range={where.range}
              onRangeChange={where.onRangeChange}
              leadsOnly={c.serviceMode === "DWY"}
              extraAds={[
                ...new Set<string>(
                  tree
                    .filter((t: Campaign) => t.kind === "ad")
                    .map((t: Campaign) => String(t.name)),
                ),
              ]}
              adIdsByName={idsByName(tree)}
              renderAdCell={(
                adName: string,
                rangeRow?: { adIds?: string[] },
              ) => {
                const p = adPicture(adName, rangeRow?.adIds);
                return (
                  <div className="flex items-center gap-2">
                    <CreativePreview
                      name={adName}
                      metaAdId={p.metaAdId}
                      accountId={p.accountId ?? c.metaAccountId ?? undefined}
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
                const row = ads.find((a: Campaign) => a.adName === adName);
                const sameName = tree.filter(
                  (t: Campaign) => t.kind === "ad" && t.name === adName,
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
                      <StatusChip tone={VERDICT_TONE[row.verdict] ?? "neutral"}>
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
                          {f.severity === "optimization" ? (
                            <StatusChip tone="neutral">Optimization</StatusChip>
                          ) : (
                            i === 0 && (
                              <StatusChip tone="bad">Fix this first</StatusChip>
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
                    Diagnosing and fixing acquisition constraints
                    <ArrowUpRight className="size-3.5" aria-hidden />
                  </a>
                </p>
              </div>
            )}
            {!where.inAccount && (
              <LostLeads
                lost={c.lost}
                adNameById={Object.fromEntries(
                  tree
                    .filter((t: Campaign) => t.kind === "ad" && t.metaId)
                    .map((t: Campaign) => [t.metaId, t.name]),
                )}
              />
            )}
            {/* The client's calls live on its page (CallCentreSection); the
                board reads nothing for them, it only links there. */}
            {!where.inAccount && !c.internal && c.serviceMode !== "DWY" && (
              <p className="text-xs">
                <Link
                  to={{
                    pathname: "/ads",
                    search: `?${new URLSearchParams({
                      ...Object.fromEntries(
                        [...params].filter(([k]) => k !== "campaign"),
                      ),
                      account: clientOf(c),
                    })}`,
                    hash: "#calls",
                  }}
                  className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground hover:underline"
                >
                  Calls for this client
                  <ChevronRight className="size-3.5" aria-hidden />
                </Link>
              </p>
            )}
            <BuildPanel
              key={`${c.clientTag ?? c.accountName}:${c.metaAccountId}`}
              clientTag={c.clientTag ?? c.accountName}
              clientName={c.clientName ?? c.accountName}
              accountId={c.metaAccountId}
              serviceType={c.serviceType}
              language={
                /[؀-ۿ]/.test(c.clientName ?? c.accountName) ? "ar" : "en"
              }
            />
            {!where.inAccount && <LiveInMeta c={c} tree={tree} />}
          </div>
        )}
        {mode === "reroute" && (
          <div className="max-w-2xl space-y-3">
            <div className="text-sm font-semibold">
              Send to another team: {c.campaignName}
            </div>
            <p className="text-xs text-muted-foreground">
              This is not for me: pick what needs to happen and it lands on that
              team's ClickUp board as a request.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <RequestCreativeButton
                campaignName={c.campaignName}
                ads={tree
                  .filter((t: Campaign) => t.kind === "ad" && t.metaId)
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
            <div className="rounded-xl bg-muted/40 p-3 text-sm">{c.reason}</div>
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
                  const r = REQUESTS.find(x => x.label === dept) ?? REQUESTS[0];
                  act(c, r.label, "rerouted", {
                    reroutedTo: r.dept,
                    reason: note || undefined,
                  });
                  setNote("");
                }}
              >
                Send to{" "}
                {
                  (REQUESTS.find(x => x.label === dept) ?? REQUESTS[0])
                    .deptLabel
                }
              </Button>
              <Button size="sm" variant="outline" onClick={where.onDone}>
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
              "Client hasn't approved the budget" creates a CSM touchpoint task.
              "Disagree with the call" is logged separately, and a rule
              disagreed with three times gets changed, not re-shown.
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
              <Button size="sm" variant="outline" onClick={where.onDone}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </>
    );
  };

  const running = (snap.campaigns as Campaign[]).filter(c => !isParked(c));
  // The last day every account's numbers are in: it runs to yesterday, so
  // "Today" reads nothing until tomorrow, and a range ending today counts
  // its spend, leads and bookings only to this day (2026-10-21). Overnight,
  // before the tracker sheet fills, it is the day before yesterday
  // (pairedDay, 2026-10-22). The coverage read is the day the range reads
  // stop at; until it is in, the running campaigns' own last day stands in.
  const mediaThrough =
    pairedDay(coverage.data) ??
    running.reduce<string | undefined>(
      (last, c) =>
        c.dataThrough && (!last || String(c.dataThrough) > last)
          ? String(c.dataThrough)
          : last,
      undefined,
    );
  // Rows whose picked range is still being read.
  const rangeReading = running.filter(
    c =>
      boardNumbers(c, rangedBoard, boardReads[String(c.campaignName)]).state ===
      "loading",
  ).length;
  // A filter on the range's numbers waits for them instead of showing an
  // empty table that reads as "nothing over $60".
  const filterReading =
    adsTab === "running" &&
    rangeReading > 0 &&
    Boolean(ADS_FILTERS.find(f => f.label === filter)?.ranged);
  /**
   * The Payments strip's count chips: the board's own rows with a payment
   * problem, instead of a second list above them. On Today they open Ads.
   */
  const showPaymentProblems = () => {
    if (view !== "ads") {
      navigate("/ads?filter=payment");
      return;
    }
    adsTransition.change(() => {
      setAdsTab("running");
      setFilter(PAYMENT_FILTER);
    });
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document
      .getElementById("ads-board")
      ?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  };
  const board = (
    <section id="ads-board" className={`${CARD} scroll-mt-6`}>
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
      {clientLogosError && (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          Client logos could not load. Refresh the page to try again.
        </p>
      )}
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
          {globalRange.key === "7d"
            ? "Spend, leads and bookings below, and the filters on them, are for the last 7 days, the read the calls are made on."
            : `Spend, leads and bookings below, and the filters on them, are for ${globalRange.label.toLowerCase()}. The Call column and the day average always use the last 7 days.`}
          {mediaThrough && globalRange.start > mediaThrough
            ? ` Meta's numbers run to ${dayMonth(mediaThrough)}, so spend and leads for this range are not in yet. Its bookings are counted; their cost waits for the numbers.`
            : mediaThrough && globalRange.end > mediaThrough
              ? ` Spend, leads and bookings are counted to ${dayMonth(mediaThrough)}, the last day every account's numbers are in, so they cover the same days.`
              : ""}
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
        // A filter on the range's numbers counts "…" until every row's range
        // is read, so a count is never made of half the rows.
        <div className="mt-4 -mx-1 flex flex-nowrap gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden">
          {ADS_FILTERS.map(f => {
            const reading = Boolean(f.ranged) && rangeReading > 0;
            const n = running.filter(c => passes(f.label, c)).length;
            if (
              n === 0 &&
              !reading &&
              f.label !== filter &&
              f.label !== "Everything"
            )
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
                <span className="ml-1.5 tabular-nums opacity-70">
                  {reading ? "…" : n}
                </span>
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
            {filterReading && (
              <tr>
                <td
                  colSpan={8}
                  className="py-6 text-center text-sm text-muted-foreground"
                >
                  Reading {globalRange.label.toLowerCase()} for every campaign…
                </td>
              </tr>
            )}
            {(snap.campaigns as Campaign[])
              .filter(c => {
                // Parked campaigns have their own screen; nothing else
                // shows there. [Aziz, 2026-09-14]
                if (adsTab === "off") return isParked(c);
                if (isParked(c)) return false;
                if (filterReading) return false;
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
                const nums = boardNumbers(
                  c,
                  globalRange.key !== "7d",
                  boardReads[String(c.campaignName)],
                );
                const cell = (value: React.ReactNode) =>
                  nums.state === "loading" ? (
                    <span className="font-normal text-muted-foreground">…</span>
                  ) : nums.state === "error" ? (
                    <span
                      className="font-normal text-muted-foreground"
                      title="This range could not be read. Pick it again, or open the campaign."
                    >
                      n/a
                    </span>
                  ) : (
                    value
                  );
                const ok = nums.state === "ok" ? nums : undefined;
                // No booking on more than $60 reads "None on $233" in the
                // grid's colour, not a grey n/a (2026-10-21).
                const cpb = cpbDisplay(ok?.spend, ok?.bookings, {
                  cost: ok?.costPerBooking,
                  spendNotIn: ok?.spendNotIn,
                });
                // Only a real finding earns the eye-catching button.
                const needsDecision = (c.findings ?? []).some(
                  (f: Campaign) => f.severity !== "optimization",
                );
                // The name, the button and the row itself all open the
                // same panel.
                const toggle = () => {
                  setMode("ads");
                  if (!isOpen) setCampaignPanelTab("recommendations");
                  setOpen(isOpen && mode === "ads" ? null : c.campaignName);
                };
                return (
                  <Fragment key={c._id}>
                    {newClient && (
                      <tr>
                        <td colSpan={8} className="campaign-client-header">
                          <ClientHeader
                            name={clientOf(c)}
                            logoSrc={clientLogos[logoKey(c)]}
                            links={links}
                            updates={updates}
                            rulesBelow={
                              Boolean(open) &&
                              mode === "ads" &&
                              clientOf(
                                (snap.campaigns as Campaign[]).find(
                                  x => x.campaignName === open,
                                ),
                              ) === clientOf(c)
                            }
                            onOpen={
                              c.internal
                                ? undefined
                                : () => {
                                    setAccountView(
                                      c.clientName ?? c.accountName,
                                    );
                                  }
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
                        {cell(moneyOr(ok?.spend))}
                      </td>
                      <td className="px-2 tabular-nums font-semibold">
                        {cell(ok?.leads ?? "n/a")}
                      </td>
                      <td
                        className={`px-2 tabular-nums font-semibold ${costText(cplTone(ok?.cpl))}`}
                      >
                        {cell(moneyOr(ok?.cpl, 2))}
                      </td>
                      <td className="px-2 tabular-nums font-semibold">
                        {cell(
                          ok?.bookings === undefined ? (
                            <span className="font-normal text-muted-foreground">
                              n/a
                            </span>
                          ) : (
                            <>
                              {ok.bookings}
                              {ok.bookingRate !== undefined && (
                                <span className="ml-1 text-xs font-normal text-muted-foreground">
                                  {Math.round(ok.bookingRate)}%
                                </span>
                              )}
                            </>
                          ),
                        )}
                      </td>
                      <td
                        className={`whitespace-nowrap px-2 tabular-nums font-semibold ${costText(cpb.tone)}`}
                        title={ok ? cpb.why : undefined}
                      >
                        {cell(
                          cpb.text === "n/a" || cpb.text === "None yet" ? (
                            <span className="font-normal text-muted-foreground">
                              {cpb.text}
                            </span>
                          ) : (
                            cpb.text
                          ),
                        )}
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
                          {rangedBoard ? " over 7 days" : ""}
                          {c.dataThrough
                            ? ` · ${moneyOr(c.spendToday, 2)} on ${dayMonth(c.dataThrough)}`
                            : ""}
                        </div>
                      </td>
                      <td className="px-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusChip
                            tone={VERDICT_TONE[c.verdict] ?? "neutral"}
                            title={c.reason}
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
                              {isOpen ? "Close" : "What to do"}
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
                            {campaignPanel(c, {
                              range: rangeFor(c.campaignName),
                              onRangeChange: r => setRange(c.campaignName, r),
                              onDone: () => setOpen(null),
                            })}
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
        <ClientsNotListed
          range={globalRange}
          campaigns={running}
          onOpen={(name, accounts) => setAccountView(name, accounts)}
        />
      )}
      {adsTab === "running" && (
        <OffBoardCampaigns
          rows={(snap.offBoardCampaigns ?? []) as Campaign[]}
        />
      )}
      {adsTab === "off" && (
        <BoardView
          cards={(snap.boardCards ?? []) as Campaign[]}
          campaigns={(snap.campaigns ?? []) as Campaign[]}
          clientLogos={clientLogos}
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
        <div className="flex flex-wrap items-center gap-2">
          {view === "sod" ? (
            <Button size="sm" variant="outline" asChild>
              <Link to="/eod">
                <MoonStar aria-hidden />
                End of day
              </Link>
            </Button>
          ) : null}
          {view === "ads" ? <VerdictPlaybook /> : null}
          {reportProblem}
        </div>
      </header>

      {/* Only when the data is stale or the last refresh had problems. */}
      <ViktorStatus />
      {/* Not on one client's page (Muhammed, 2026-10-13): there it listed
          every other client's billing problem above the one you opened.
          One quiet row, folded, and nothing when all is well (Aziz,
          2026-10-13: "so we can focus on the ads"). */}
      {(view === "sod" || (view === "ads" && !accountView)) && (
        <AdBillingWatch
          campaigns={(snap.campaigns as Campaign[]).map(c => ({
            metaAccountId: c.metaAccountId,
            dataThrough: c.dataThrough,
            internal: c.internal,
            accountIssue: c.accountIssue,
            // On the Off tab, so the Payment problem filter never shows it.
            parked: isParked(c),
          }))}
          onShowOnBoard={showPaymentProblems}
        />
      )}

      {/* Clients who wrote on WhatsApp, with the reply already drafted.
          Above the numbers: an unanswered client costs more than a
          metric that moved two points. Once, on Today: it used to sit on
          every page, saying it is not connected for this desk. */}
      {view === "sod" ? <WhatsAppDesk desk="ads" /> : null}

      {/* Today took in the Task list and Touchpoints (the simplification
          audit, approved 2026-10-06): the day in the morning sprint's own
          order, with the ClickUp list, the meetings and the change log
          once each. */}
      {view === "sod" && (
        <>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
            <div className="min-w-0 space-y-6">
              {sprint}
              <div id="tasks" className="scroll-mt-6 space-y-6">
                <Onboardings />
                {tasksCard}
              </div>
              <div id="touchpoints" className="scroll-mt-6">
                {touch}
              </div>
              {watch}
              {accounts}
            </div>
            <div className="min-w-0 space-y-6">
              <TodayMeetings />
              {planned}
              {changeLog}
            </div>
          </div>
          {tiles}
          <PortfolioTrends />
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed px-4 py-4 sm:px-6">
            <p className="text-sm text-muted-foreground">
              Before you log off, file your end of day. The numbers and the
              change log are already in it.
            </p>
            <Button size="sm" asChild>
              <Link to="/eod">File my end of day</Link>
            </Button>
          </div>
        </>
      )}

      {view === "ads" && (
        <>
          {!accountView && tiles}
          {!accountView && <LeadSyncStrip />}
          {!accountView && <TrackingIssues />}
          {accountView && (
            <AccountView
              client={accountView}
              clientTaskId={feedbackTaskIdForClient(
                (snap.clientLinks ?? []) as Campaign[],
                accountView,
              )}
              accountIds={accountIds}
              campaigns={(snap.campaigns as Campaign[]).filter(
                c => clientOf(c) === accountView,
              )}
              tree={((snap.metaTree ?? []) as Campaign[]).filter(t =>
                (snap.campaigns as Campaign[]).some(
                  c =>
                    clientOf(c) === accountView &&
                    c.campaignName === t.campaignName,
                ),
              )}
              verdicts={snap.ads as Campaign[]}
              range={accountRange}
              onRangeChange={setAccountRange}
              selected={accountCampaign}
              onSelect={name => {
                setMode("ads");
                setCampaignPanelTab("recommendations");
                setAccountCampaign(name);
              }}
              renderPanel={c =>
                campaignPanel(c, {
                  range: accountRange,
                  onRangeChange: setAccountRange,
                  onDone: () => setMode("ads"),
                  inAccount: true,
                })
              }
              onClose={() => setAccountView(null)}
            />
          )}
          {!accountView && sweep}
          {!accountView && board}
        </>
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
