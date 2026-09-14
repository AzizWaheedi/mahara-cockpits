import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { AccountView } from "@/components/AccountView";
import { BuildPanel } from "@/components/BuildPanel";
import { CampaignRange } from "@/components/CampaignRange";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ViktorStatus } from "@/components/ViktorStatus";
import { CPB_GATE, CPL_GATE, LEARNING_DAYS } from "@/lib/kpi";
import { defaultRange, type Range } from "@/lib/range";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { CampaignChat } from "../components/CampaignChat";

/** What one role can actually ask another for. Picking the request picks the board. */
const REQUESTS: { label: string; dept: string; deptLabel: string }[] = [
  { label: "New ads needed", dept: "creative", deptLabel: "Creative director" },
  {
    label: "New scripts needed",
    dept: "creative",
    deptLabel: "Creative director",
  },
  {
    label: "Replacement creative — fatigue",
    dept: "creative",
    deptLabel: "Creative director",
  },
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
    label: "Lead quality — client needs a conversation",
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
    label: "Cost per booking over $80",
    test: c => (c.costPerBooking ?? 0) > 80,
  },
  { label: "No bookings", test: c => c.bookings7d === 0 && c.spend7d > 20 },
  { label: "Not touched in 4+ days", test: c => (c.daysSinceTouch ?? 99) >= 4 },
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

const VERDICT_STYLES: Record<string, string> = {
  scale: "tone-good ring-1 ring-inset ring-current/20",
  hold: "tone-warn ring-1 ring-inset ring-current/20",
  kill: "tone-bad ring-1 ring-inset ring-current/20",
  fatiguing: "tone-warn ring-1 ring-inset ring-current/20",
  "off board": "tone-bad ring-1 ring-inset ring-current/20",
  "no delivery": "tone-neutral ring-1 ring-inset ring-current/20",
};

// biome-ignore lint/suspicious/noExplicitAny: snapshot payload is untyped by design
type Campaign = any;

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
    return ["Add to Ads Managment board", "Confirm it should be running"];
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

/** The client's name row: their links, and their do's and don'ts one click away. */
function ClientHeader({ name, links }: { name: string; links?: Campaign }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {name}
      <ClientLinks
        links={links}
        dosOpen={open}
        onDos={() => setOpen(o => !o)}
      />
      {open && (
        <div className="mt-2 max-w-4xl rounded-md border bg-card p-3 font-normal text-foreground">
          <DosDontsList text={links?.dosDonts} />
        </div>
      )}
    </>
  );
}

/** Inside an open campaign: the client's do's and don'ts, when the card has any. */
function ClientRules({ name, links }: { name: string; links?: Campaign }) {
  if (!parseDosDonts(links?.dosDonts).length) return null;
  return (
    <div className="mb-3 rounded-md border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-800 dark:bg-amber-950/30">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-amber-900 dark:text-amber-200">
        {name}: do's & don'ts from the client card
      </p>
      <DosDontsList text={links?.dosDonts} />
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
  onDos,
}: {
  links?: Campaign;
  dosOpen?: boolean;
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
      <span className="ml-2 text-[11px] font-normal text-muted-foreground">
        not on the ClickUp client list
      </span>
    );
  return (
    <span className="ml-2 inline-flex flex-wrap gap-2 text-[11px] font-normal">
      {item(links.driveLink, "Drive")}
      {item(links.brandDnaDoc, "Brand DNA")}
      {item(links.offerCheatSheet, "Offer")}
      {onDos &&
        (parseDosDonts(links.dosDonts).length ? (
          <button
            type="button"
            onClick={onDos}
            className="font-semibold text-primary underline"
          >
            {dosOpen ? "Hide do's & don'ts" : "Do's & don'ts"}
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
    <select
      className="ml-1 rounded border bg-background px-1 py-0.5 text-[11px] font-semibold"
      value={status ?? ""}
      disabled={busy}
      title="Ad Status on the ClickUp board, the source of truth for on or off"
      onChange={async e => {
        const next = e.target.value;
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
    >
      {!status && <option value="">no status</option>}
      {list.map(o => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
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
      {busy ? "Renaming..." : "Rename the card now"}
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
    <div className="mt-5 rounded-lg border p-3">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-[12px] font-bold uppercase tracking-widest text-muted-foreground">
          The Ads Management board ({cards.length} cards)
        </span>
        <span className="text-[12px] text-muted-foreground">
          {open ? "Hide" : "Show old and paused campaigns"}
        </span>
      </button>
      {open && (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
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
                className={`rounded px-2 py-1 ${tab === k ? "bg-foreground text-background" : "bg-muted"}`}
              >
                {label} · {count(k)}
              </button>
            ))}
            <input
              className="ml-auto w-48 rounded border bg-background px-2 py-1"
              placeholder="Find a campaign or client"
              value={q}
              onChange={e => setQ(e.target.value)}
            />
          </div>
          <ul className="mt-2 divide-y text-[13px]">
            {shown.slice(0, 200).map(c => (
              <li
                key={c.taskId}
                className="flex flex-wrap items-center gap-2 py-1.5"
              >
                <span className="font-semibold">{c.name}</span>
                {c.tag && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                    {c.tag}
                  </span>
                )}
                {spending.has(c.taskId) && (
                  <span className="text-[11px] text-emerald-600">
                    spending now
                  </span>
                )}
                <span className="ml-auto text-[11px] text-muted-foreground">
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
                {c.url && (
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[12px] text-primary underline"
                  >
                    ClickUp
                  </a>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">
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
    <div className="mt-5 rounded-lg border border-dashed p-3">
      <div className="text-[12px] font-bold uppercase tracking-widest text-muted-foreground">
        Spending but not on the ClickUp board ({rows.length})
      </div>
      <p className="mb-2 text-[12px] text-muted-foreground">
        These campaigns spend on an ad account with no card on the Ads
        Management board, so no other screen tracks them. Add the card here, the
        same card the new-campaign form makes, and it joins the list on the next
        sync.
      </p>
      <ul className="divide-y text-[13px]">
        {rows.map(r => {
          const name = client[r.campaignName] ?? r.clientName ?? "";
          return (
            <li
              key={r.campaignName}
              className="flex flex-wrap items-center gap-2 py-2"
            >
              <span className="font-semibold">{r.campaignName}</span>
              <span className="text-muted-foreground">
                {r.accountName} · ${Number(r.spend7d).toFixed(0)} in 7 days ·{" "}
                {r.leads7d} leads
              </span>
              <input
                className="ml-auto w-44 rounded border bg-background px-2 py-1 text-[12px]"
                placeholder="Client name (the card's tag)"
                value={name}
                onChange={e =>
                  setClient({ ...client, [r.campaignName]: e.target.value })
                }
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[12px]"
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
                {busy === r.campaignName ? "Adding..." : "Add to ClickUp"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[12px] text-muted-foreground"
                disabled={busy === r.campaignName}
                onClick={async () => {
                  setBusy(r.campaignName);
                  try {
                    const res = await dismiss({ campaignName: r.campaignName });
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

const TITLES: Record<View, { title: string; sub: string }> = {
  sod: {
    title: "Start of day",
    sub: "Clear communication first, then get into the accounts",
  },
  ads: {
    title: "Ads management",
    sub: "Every campaign, ranked by what needs a decision",
  },
  tasks: {
    title: "Task list",
    sub: "Everything on your ClickUp boards and everything you planned",
  },
  touch: {
    title: "Client touchpoints",
    sub: "One or two proactive messages per client, drafted from what changed",
  },
  eod: {
    title: "End of day",
    sub: "Your EOD report, already written from today's decisions",
  },
};

function Cockpit({ view }: { view: View }) {
  const snap = useQuery(api.cockpit.snapshot, {});
  const toggleCheck = useMutation(api.cockpit.toggleCheck);
  const decide = useMutation(api.cockpit.decide);
  const run = useAction(api.execute.runAction);
  const addPlanItems = useMutation(api.cockpit.addPlanItems);
  const logManualChange = useMutation(api.cockpit.logManualChange);
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
  const [dept, setDept] = useState(REQUESTS[0].label);
  const [reason, setReason] = useState(REASONS[0]);
  const [clock, setClock] = useState(CLOCKS[1]);
  const [dump, setDump] = useState("");
  const [changeText, setChangeText] = useState<Record<string, string>>({});
  const [ask, setAsk] = useState<string | null>(null);
  const [askText, setAskText] = useState("");
  const [askWho, setAskWho] = useState<string>("");
  const [filter, setFilter] = useState(FILTERS[0].label);
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
          why: "Good week — send the win before they have to ask",
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
    const m = new Map<string, string>();
    for (const d of snap?.decisions ?? [])
      m.set(
        d.subject,
        `${d.action}${d.reroutedTo ? ` → ${d.reroutedTo}` : ""}`,
      );
    return m;
  }, [snap]);

  if (snap === undefined) {
    return (
      <div className="p-10 text-sm text-muted-foreground">
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
  {
    const byCampaign = new Map<string, Campaign[]>();
    for (const t of (snap?.metaTree ?? []) as Campaign[]) {
      if (t.kind !== "ad" && t.kind !== "adset") continue;
      const list = byCampaign.get(t.campaignName) ?? [];
      list.push(t);
      byCampaign.set(t.campaignName, list);
    }
    for (const [name, nodes] of byCampaign)
      if (!nodes.some(t => (t.effectiveStatus ?? t.status) === "ACTIVE"))
        offOnMeta.add(name);
  }
  const sodChecks = checkRows.filter(c => (c.phase ?? "sod") === "sod");
  const midChecks = checkRows.filter(c => c.phase === "mid");
  const checksDone = sodChecks.filter(c => c.done).length;
  // WhatsApp is not wired up yet — say so on the screen rather than showing an
  // empty box she might read as "no client messages".
  const waConnected = false;

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
          why: "Just launched — check it this morning and again before you log off.",
        };
      if (sinceChange !== undefined && sinceChange < LEARNING_DAYS)
        return {
          c,
          hot: false,
          tag: "In learning",
          why: `Changed ${sinceChange === 0 ? "today" : `${sinceChange}d ago`} — read it again on day ${LEARNING_DAYS}.`,
        };
      if ((sinceChange ?? live) >= 7)
        return {
          c,
          hot: true,
          tag: "Review due",
          why: `Nothing touched for ${sinceChange ?? live} days — it is past the 7 day check.`,
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
          : "Logged — ClickUp task queued",
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
      "Written from today's board — edit it, then turn it into tasks",
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

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {TITLES[view].title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {new Date().toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}{" "}
            · {TITLES[view].sub} ·{" "}
            {snap.lastSyncAt
              ? `synced ${new Date(snap.lastSyncAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
              : "not yet synced"}
          </p>
        </div>
        <span className="rounded-full bg-[var(--chart-1)] px-3 py-1.5 text-[12px] font-bold tracking-wide text-background">
          LIVE · CLICKUP + TRACKER
        </span>
      </header>

      <ViktorStatus />

      {snap.lastSyncAt && Date.now() - snap.lastSyncAt > 20 * 3600 * 1000 && (
        <div className="rounded-lg border callout-warn p-3 text-[13px]">
          <span className="font-semibold">
            These numbers are from{" "}
            {new Date(snap.lastSyncAt).toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "short",
            })}
            , not today.
          </span>{" "}
          The refresh has not run since. Don't change budgets off this screen
          until it's green again — use the chat box in the corner.
        </div>
      )}

      {snap.syncProblems?.length > 0 && (
        <div className="mb-3 rounded-lg border callout-bad p-3 text-[13px]">
          <span className="font-semibold">
            Part of this screen is not showing everything it should.
          </span>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {snap.syncProblems.map((p: string) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="mt-1 text-muted-foreground">
            The last refresh flagged this itself. Aziz is alerted — don't assume
            a blank section means there is no work.
          </p>
        </div>
      )}

      {(view === "ads" || view === "sod") && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            {
              l: "Client spend 7d",
              v: money(t.clientSpend),
              d: `${snap.campaigns.length} campaigns delivering`,
            },
            {
              l: "Client leads 7d",
              v: String(t.clientLeads),
              d: "Leads (total)",
            },
            {
              l: "Blended CPL",
              v: money(t.blendedCpl, 2),
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
          ].map(k => (
            <div key={k.l} className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {k.l}
              </div>
              <div className="mt-1 text-2xl font-extrabold tabular-nums">
                {k.v}
              </div>
              <div
                className={`mt-0.5 text-[12px] font-semibold ${k.bad ? "txt-bad" : k.ok ? "txt-good" : "text-muted-foreground"}`}
              >
                {k.d}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === "sod" && (
        <div className="mb-5">
          <PortfolioTrends />
        </div>
      )}

      <div
        className={
          view === "ads"
            ? "grid gap-5"
            : "grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]"
        }
      >
        {view === "ads" && !accountView && <TrackingIssues />}

        {view === "ads" && accountView && (
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
        {view === "ads" && !accountView && midChecks.length > 0 && (
          <section className="rounded-xl border bg-card p-4 shadow-sm">
            <h2 className="mb-2 text-[12px] font-bold uppercase tracking-widest text-teal-600">
              Middle of the day · the sweep
            </h2>
            <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {midChecks.map(c => (
                <button
                  key={c._id}
                  type="button"
                  onClick={() => toggleCheck({ id: c._id })}
                  className="flex items-start gap-2 py-1 text-left"
                >
                  <span
                    className={`mt-0.5 grid h-4 w-4 flex-none place-items-center rounded border text-[11px] ${c.done ? "border-[var(--chart-1)] bg-[var(--chart-1)] text-background" : "border-muted-foreground/30"}`}
                  >
                    {c.done ? "✓" : ""}
                  </span>
                  <span
                    className={`text-[13px] leading-snug ${c.done ? "text-muted-foreground line-through" : ""}`}
                  >
                    {c.label}
                    {c.detail ? (
                      <span className="font-semibold"> — {c.detail}</span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {view === "ads" && !accountView && (
          <section className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[12px] font-bold uppercase tracking-widest text-teal-600">
                Campaigns · ranked by what needs a decision
              </h2>
              <span className="text-[12px] text-muted-foreground">
                USD, currency-corrected
              </span>
            </div>
            {/* The window every campaign opens on. Each campaign can still be
                switched on its own once it is open. [aziz, 2026-09-07] */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5">
              <RangePicker
                value={globalRange}
                onChange={r => {
                  setGlobalRange(r);
                  setRanges({});
                }}
              />
              <span className="text-[12px] text-muted-foreground">
                The table below always shows the 7-day read the calls are made
                on; the range applies inside each campaign.
              </span>
            </div>
            {/* Filters, so she can work one problem at a time instead of the whole list. */}
            <div className="mb-3 flex flex-wrap gap-1.5">
              {FILTERS.map(f => {
                const n = (snap.campaigns as Campaign[]).filter(c =>
                  f.test(c),
                ).length;
                return (
                  <button
                    key={f.label}
                    type="button"
                    onClick={() => setFilter(f.label)}
                    className={`rounded-md border px-2.5 py-1 text-[12px] font-semibold ${f.label === filter ? "border-teal-400 bg-teal-50 text-teal-800" : "bg-background"}`}
                  >
                    {f.label} · {n}
                  </button>
                );
              })}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-2 text-left font-bold">Campaign</th>
                    <th className="px-2 text-left font-bold">Spend</th>
                    <th className="px-2 text-left font-bold">Leads</th>
                    <th className="px-2 text-left font-bold">CPL</th>
                    <th className="px-2 text-left font-bold">Bookings</th>
                    <th className="px-2 text-left font-bold">Cost / booking</th>
                    <th className="px-2 text-left font-bold">Budget / spend</th>
                    <th className="px-2 text-left font-bold w-[38%]">Call</th>
                  </tr>
                </thead>
                <tbody>
                  {(snap.campaigns as Campaign[])
                    .filter(c => {
                      // Off on the board (ClickUp Ad Status): listed last under
                      // "Everything", left out of the problem filters.
                      if (filter !== "Everything" && isOffOnBoard(c))
                        return false;
                      if (filter === "Undecided today")
                        return !decidedBySubject.has(c.campaignName);
                      return (
                        FILTERS.find(f => f.label === filter) ?? FILTERS[0]
                      ).test(c);
                    })
                    // Active first, then off; within each, grouped by client.
                    .sort(
                      (a, b) =>
                        Number(isOffOnBoard(a)) - Number(isOffOnBoard(b)) ||
                        clientOf(a).localeCompare(clientOf(b)) ||
                        String(a.campaignName).localeCompare(
                          String(b.campaignName),
                        ),
                    )
                    .map((c: Campaign, i: number, list: Campaign[]) => {
                      const prev = i > 0 ? list[i - 1] : undefined;
                      const newSection =
                        !prev || isOffOnBoard(prev) !== isOffOnBoard(c);
                      const newClient =
                        newSection || clientOf(prev) !== clientOf(c);
                      const isOpen = open === c.campaignName;
                      const decided = decidedBySubject.get(c.campaignName);
                      const acts = actionsFor(c);
                      // Only a real finding earns the eye-catching button.
                      const needsDecision = (c.findings ?? []).some(
                        (f: any) => f.severity !== "optimization",
                      );
                      const ads = snap.ads.filter(
                        (a: Campaign) => a.campaignName === c.campaignName,
                      );
                      const changes = (snap.adChanges ?? [])
                        .filter(
                          (t: Campaign) => t.campaignName === c.campaignName,
                        )
                        .sort((a: Campaign, b: Campaign) => b.at - a.at)
                        .slice(0, 8);
                      const mine = ((snap.manualChanges ?? []) as Campaign[])
                        .filter(
                          (m: Campaign) => m.campaignName === c.campaignName,
                        )
                        .sort((a: Campaign, b: Campaign) => b.at - a.at)
                        .slice(0, 5);
                      const tree = (snap.metaTree ?? []).filter(
                        (t: Campaign) => t.campaignName === c.campaignName,
                      );
                      // The insights table keys ads by name; the Meta tree keys
                      // them by id. Bridge the two so a row can be toggled.
                      const adNode = (adName: string) =>
                        tree.find(
                          (t: Campaign) => t.kind === "ad" && t.name === adName,
                        );
                      const adMetaId = (adName: string) =>
                        adNode(adName)?.metaId;
                      const adIsActive = (adName: string) =>
                        (adNode(adName)?.effectiveStatus ??
                          adNode(adName)?.status) === "ACTIVE";
                      return (
                        <>
                          {newSection && isOffOnBoard(c) && (
                            <tr>
                              <td
                                colSpan={8}
                                className="pt-5 pb-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground"
                              >
                                Off on the board (Ad Status:{" "}
                                {OFF_STATUSES.join(", ")})
                              </td>
                            </tr>
                          )}
                          {newClient && (
                            <tr>
                              <td
                                colSpan={8}
                                className="pt-3 pb-1 text-[12px] font-bold text-teal-700 dark:text-teal-300"
                              >
                                <ClientHeader
                                  name={clientOf(c)}
                                  links={findClientLinks(
                                    (snap.clientLinks ?? []) as Campaign[],
                                    clientOf(c),
                                  )}
                                />
                              </td>
                            </tr>
                          )}
                          <tr
                            key={c._id}
                            className={`border-b align-top ${isOpen ? "bg-muted/40" : ""} ${isOffOnBoard(c) && !isOpen ? "opacity-60" : ""}`}
                          >
                            <td className="py-2.5 pr-2">
                              <button
                                type="button"
                                className="text-left font-bold hover:underline"
                                onClick={() => {
                                  setMode("ads");
                                  setOpen(
                                    isOpen && mode === "ads"
                                      ? null
                                      : c.campaignName,
                                  );
                                }}
                              >
                                {c.campaignName}
                              </button>
                              <div className="text-[12px] text-muted-foreground">
                                {c.internal ? (
                                  "Mahara's own account"
                                ) : (
                                  <button
                                    type="button"
                                    className="font-semibold hover:underline"
                                    onClick={() =>
                                      setAccountView(
                                        c.clientName ?? c.accountName,
                                      )
                                    }
                                  >
                                    {c.clientName ?? c.accountName}
                                  </button>
                                )}
                                <AdStatusPicker
                                  campaignName={c.campaignName}
                                  status={c.boardAdStatus}
                                  hasCard={Boolean(c.taskId)}
                                />
                                {!isOffOnBoard(c) &&
                                  offOnMeta.has(c.campaignName) && (
                                    <span
                                      className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold uppercase text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                                      title="The board says this campaign is on, but nothing is delivering on Meta. If it is off, set the Ad Status."
                                    >
                                      nothing delivering on Meta
                                    </span>
                                  )}
                                {c.accountIssue && (
                                  <span
                                    className="ml-1 rounded bg-red-50 px-1 py-0.5 text-[9px] font-bold uppercase text-red-700 dark:bg-red-950 dark:text-red-300"
                                    title={c.accountIssue}
                                  >
                                    {/unsettled/i.test(c.accountIssue)
                                      ? "card declined"
                                      : "account blocked"}
                                  </span>
                                )}
                                {c.accountIssue &&
                                  /unsettled/i.test(c.accountIssue) && (
                                    <button
                                      type="button"
                                      className="ml-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold hover:bg-muted"
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
                                    </button>
                                  )}
                                {c.serviceMode === "DWY" && (
                                  <span
                                    className="ml-1 rounded bg-muted px-1 py-0.5 text-[9px] font-bold uppercase text-muted-foreground"
                                    title="Done With You — we do not book for them, so this account is judged on cost per lead only."
                                  >
                                    DWY
                                  </span>
                                )}
                                {c.currency && c.currency !== "USD"
                                  ? ` · ${c.currency} account, converted`
                                  : ""}
                                {c.daysLive !== undefined
                                  ? ` · live ${c.daysLive}d`
                                  : ""}
                              </div>
                              <div className="mt-0.5 flex flex-wrap gap-2 text-[12px]">
                                {adsManagerUrl(c) && (
                                  <a
                                    className="font-semibold text-primary underline"
                                    href={adsManagerUrl(c)}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Open in Ads Manager ↗
                                  </a>
                                )}
                                {c.taskUrl && (
                                  <a
                                    className="text-muted-foreground underline"
                                    href={c.taskUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    ClickUp task ↗
                                  </a>
                                )}
                              </div>
                              {c.staleTaskName && (
                                <div className="mt-1 text-[12px] txt-warn">
                                  Board card still says “{c.staleTaskName}”.{" "}
                                  <RenameCardButton
                                    campaignName={c.campaignName}
                                  />
                                </div>
                              )}
                              {decided && (
                                <div className="mt-1 text-[12px] font-bold txt-good">
                                  ✓ {decided}
                                </div>
                              )}
                            </td>
                            <td className="px-2 tabular-nums font-semibold">
                              {money(c.spend7d)}
                            </td>
                            <td className="px-2 tabular-nums font-semibold">
                              {c.leads7d}
                            </td>
                            <td
                              className={`px-2 tabular-nums font-semibold ${c.cpl === undefined ? "" : c.cpl > CPL_GATE ? "txt-bad" : "txt-good"}`}
                            >
                              {money(c.cpl, 2)}
                            </td>
                            <td className="px-2 tabular-nums font-semibold">
                              {c.bookings7d === undefined ? (
                                <span className="text-muted-foreground">—</span>
                              ) : (
                                <>
                                  {c.bookings7d}
                                  {c.bookingRate !== undefined && (
                                    <span className="ml-1 text-[12px] font-normal text-muted-foreground">
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
                              {money(c.costPerBooking, 0)}
                            </td>
                            <td className="px-2 tabular-nums">
                              {/* What is set on Meta, where it lives, and what it actually spends. */}
                              <div className="font-semibold">
                                {c.budgetDaily !== undefined
                                  ? `${money(c.budgetDaily)}/day`
                                  : c.budgetLifetime !== undefined
                                    ? `${money(c.budgetLifetime)} lifetime`
                                    : "—"}
                                {c.budgetLevel && (
                                  <span
                                    className="ml-1 rounded bg-muted px-1 py-0.5 text-[9px] font-bold uppercase text-muted-foreground"
                                    title={
                                      c.budgetLevel === "campaign"
                                        ? "CBO: the budget is set on the campaign and Meta splits it across the ad sets"
                                        : "ABO: each ad set has its own budget; this is their total"
                                    }
                                  >
                                    {c.budgetLevel === "campaign"
                                      ? "CBO"
                                      : "ABO"}
                                  </span>
                                )}
                              </div>
                              <div
                                className={`text-[12px] ${c.dayRate < 30 ? "txt-bad" : "text-muted-foreground"}`}
                              >
                                {money(c.dayRate)}/day avg
                                {c.dataThrough
                                  ? ` · ${money(c.spendToday, 2)} on ${String(c.dataThrough).slice(8, 10)}/${String(c.dataThrough).slice(5, 7)}`
                                  : ""}
                              </div>
                            </td>
                            <td className="px-2">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span
                                  className={`rounded px-2 py-0.5 text-[11px] font-bold uppercase ring-1 ring-inset ${VERDICT_STYLES[c.verdict] ?? ""}`}
                                >
                                  {c.verdict}
                                </span>
                                {!decided && (
                                  // One button, not four. The decisions live
                                  // inside the panel where the evidence is.
                                  <Button
                                    size="sm"
                                    variant={
                                      needsDecision ? "default" : "outline"
                                    }
                                    className="h-7 whitespace-nowrap px-2.5 text-[12px]"
                                    onClick={() => {
                                      setMode("ads");
                                      setOpen(isOpen ? null : c.campaignName);
                                    }}
                                  >
                                    {isOpen ? "Close" : "Recommendations"}
                                    {!isOpen && needsDecision ? " ●" : ""}
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
                              {/* Spans every header column; six left the
                                  panel squeezed into 60% of the row. */}
                              <td colSpan={8} className="p-3">
                                <ClientRules
                                  name={clientOf(c)}
                                  links={findClientLinks(
                                    (snap.clientLinks ?? []) as Campaign[],
                                    clientOf(c),
                                  )}
                                />
                                {mode === "ads" && (
                                  <div>
                                    {/* The decisions live here, next to the
                                        evidence for them, instead of crowding
                                        every row of the table. */}
                                    <div className="mb-3 flex flex-wrap items-center gap-1.5 border-b pb-3">
                                      <span className="mr-1 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
                                        What do you want to do
                                      </span>
                                      <span className="mr-1 text-[11px] text-muted-foreground">
                                        {isExecutable(acts[0])
                                          ? "· the first one changes Meta straight away"
                                          : "· these are logged, not applied"}
                                      </span>
                                      <Button
                                        size="sm"
                                        className="h-7 whitespace-nowrap px-2 text-[12px]"
                                        onClick={() =>
                                          act(c, acts[0], "approved")
                                        }
                                      >
                                        {acts[0]}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 whitespace-nowrap px-2 text-[12px]"
                                        onClick={() =>
                                          act(c, acts[1], "alternative")
                                        }
                                      >
                                        {acts[1]}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 px-2 text-[12px] text-muted-foreground"
                                        onClick={() => setMode("leave")}
                                      >
                                        Leave it
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 px-2 text-[12px] text-muted-foreground"
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
                                    <div className="mb-1 mt-3 text-[12px] text-muted-foreground">
                                      The call below is the 7-day read ·{" "}
                                      {c.reason}
                                    </div>
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
                                            .map((t: Campaign) =>
                                              String(t.name),
                                            ),
                                        ),
                                      ]}
                                      renderAdCell={(adName: string) => {
                                        const row = ads.find(
                                          (a: Campaign) => a.adName === adName,
                                        );
                                        return (
                                          <div className="flex items-center gap-2">
                                            <CreativePreview
                                              name={adName}
                                              thumbUrl={row?.thumbnailUrl}
                                              previewSrc={row?.previewSrc}
                                              metaAdId={
                                                row?.metaAdId ??
                                                adMetaId(adName)
                                              }
                                            />
                                            <span>{adName}</span>
                                          </div>
                                        );
                                      }}
                                      renderAdCall={(adName: string) => {
                                        const row = ads.find(
                                          (a: Campaign) => a.adName === adName,
                                        );
                                        return (
                                          <div className="flex items-center gap-1.5">
                                            {row && (
                                              <span
                                                className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ring-1 ring-inset ${VERDICT_STYLES[row.verdict] ?? ""}`}
                                              >
                                                {row.verdict}
                                              </span>
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
                                          </div>
                                        );
                                      }}
                                    />
                                    {(c.findings ?? []).length > 0 && (
                                      <div className="mb-4 rounded-md border border-border bg-background p-3">
                                        <div className="mb-2 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
                                          {(c.findings ?? []).some(
                                            // biome-ignore lint/suspicious/noExplicitAny: finding rows
                                            (f: any) =>
                                              f.severity !== "optimization",
                                          )
                                            ? "What needs a decision here"
                                            : "Nothing needs touching · optional optimizations"}
                                        </div>
                                        <div className="space-y-2.5">
                                          {(c.findings ?? []).map(
                                            // biome-ignore lint/suspicious/noExplicitAny: finding rows
                                            (f: any, i: number) => (
                                              <div key={f.constraint}>
                                                <div className="text-[13px] font-semibold">
                                                  {i === 0 &&
                                                  f.severity !== "optimization"
                                                    ? "→ "
                                                    : ""}
                                                  {f.constraint}
                                                  {f.severity ===
                                                  "optimization" ? (
                                                    <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-[11px] font-bold uppercase text-muted-foreground">
                                                      Optimization
                                                    </span>
                                                  ) : (
                                                    i === 0 && (
                                                      <span className="ml-2 rounded bg-foreground px-1.5 py-0.5 text-[11px] font-bold uppercase text-background">
                                                        Fix this first
                                                      </span>
                                                    )
                                                  )}
                                                </div>
                                                <div className="text-[13px] text-muted-foreground">
                                                  {f.evidence}
                                                </div>
                                                <ul className="mt-0.5 list-disc pl-4 text-[13px]">
                                                  {f.fixes.map((fx: string) => (
                                                    <li key={fx}>{fx}</li>
                                                  ))}
                                                </ul>
                                              </div>
                                            ),
                                          )}
                                        </div>
                                        <div className="mt-2 text-[12px] text-muted-foreground">
                                          <a
                                            className="underline"
                                            href="https://docs.google.com/document/d/1cioKqspTOI6zK76ob0lOTzfNLDMe5WS6NJ_hgTwb-p4/edit"
                                            target="_blank"
                                            rel="noreferrer"
                                          >
                                            Diagnosing &amp; Fixing Acquisition
                                            Constraints
                                          </a>{" "}
                                          — the full playbook behind these
                                          calls.
                                        </div>
                                        <div className="mt-1 text-[12px] text-muted-foreground">
                                          {(c.findings ?? []).some(
                                            // biome-ignore lint/suspicious/noExplicitAny: finding rows
                                            (f: any) =>
                                              f.severity !== "optimization",
                                          )
                                            ? "Patch one leak at a time — take the top one today, re-check tomorrow."
                                            : "Cheap leads that book. Leave it running; these are optional."}
                                        </div>
                                      </div>
                                    )}
                                    {changes.length > 0 && (
                                      <div className="mt-4">
                                        <div className="mb-1 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
                                          Changed in this account · last 7 days
                                        </div>
                                        <div className="space-y-0.5">
                                          {changes.map((ch: Campaign) => (
                                            <div
                                              key={`${ch._id}`}
                                              className="text-[12px]"
                                            >
                                              <span className="text-muted-foreground">
                                                {new Date(
                                                  ch.at,
                                                ).toLocaleDateString("en-GB", {
                                                  day: "numeric",
                                                  month: "short",
                                                })}
                                              </span>{" "}
                                              <span className="font-semibold">
                                                {ch.actor ?? "someone"}
                                              </span>{" "}
                                              {ch.eventType}
                                              {ch.objectName
                                                ? ` — ${ch.objectName}`
                                                : ""}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    <div className="mt-4 rounded-md border border-dashed border-border p-3">
                                      <div className="mb-1 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
                                        What did you change?
                                      </div>
                                      <p className="mb-2 text-[12px] text-muted-foreground">
                                        Anything you did by hand that Meta will
                                        not show — a new audience, a budget you
                                        set on your phone, a client request.
                                        Goes on the ClickUp task and starts the
                                        3 day clock.
                                      </p>
                                      {(mine ?? []).length > 0 && (
                                        <div className="mb-2 space-y-1">
                                          {mine.map(
                                            // biome-ignore lint/suspicious/noExplicitAny: manual change row
                                            (m: any) => (
                                              <div
                                                key={m._id}
                                                className="text-[12px]"
                                              >
                                                <span className="text-muted-foreground">
                                                  {new Date(
                                                    m.at,
                                                  ).toLocaleDateString(
                                                    "en-GB",
                                                    {
                                                      day: "numeric",
                                                      month: "short",
                                                    },
                                                  )}
                                                </span>{" "}
                                                <span className="font-semibold">
                                                  {m.by}
                                                </span>{" "}
                                                {m.what}
                                              </div>
                                            ),
                                          )}
                                        </div>
                                      )}
                                      <div className="flex gap-2">
                                        <Input
                                          value={
                                            changeText[c.campaignName] ?? ""
                                          }
                                          placeholder="Raised budget to $40 and swapped the hook"
                                          className="h-8 text-[13px]"
                                          onChange={e =>
                                            setChangeText(prev => ({
                                              ...prev,
                                              [c.campaignName]: e.target.value,
                                            }))
                                          }
                                        />
                                        <Button
                                          size="sm"
                                          variant="secondary"
                                          disabled={
                                            !(
                                              changeText[c.campaignName] ?? ""
                                            ).trim()
                                          }
                                          onClick={async () => {
                                            await logManualChange({
                                              campaignName: c.campaignName,
                                              what: (
                                                changeText[c.campaignName] ?? ""
                                              ).trim(),
                                            });
                                            setChangeText(prev => ({
                                              ...prev,
                                              [c.campaignName]: "",
                                            }));
                                            toast.success(
                                              "Logged — on the ClickUp task, and this account is now left alone for 3 days",
                                            );
                                          }}
                                        >
                                          Log it
                                        </Button>
                                      </div>
                                    </div>
                                    <LostLeads
                                      lost={c.lost}
                                      adNameById={Object.fromEntries(
                                        tree
                                          .filter(
                                            (t: any) =>
                                              t.level === "ad" && t.metaId,
                                          )
                                          .map((t: any) => [t.metaId, t.name]),
                                      )}
                                    />
                                    <BuildPanel
                                      clientTag={c.clientTag ?? c.accountName}
                                      clientName={c.clientName ?? c.accountName}
                                      accountId={c.metaAccountId}
                                      serviceType={c.serviceType}
                                      language={
                                        /[\u0600-\u06FF]/.test(
                                          c.clientName ?? c.accountName,
                                        )
                                          ? "ar"
                                          : "en"
                                      }
                                    />
                                    {tree.length > 0 ? (
                                      <div className="mt-4 space-y-3">
                                        <div className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
                                          Live in Meta · ad sets and creative
                                        </div>
                                        {tree
                                          .filter(
                                            (t: Campaign) => t.kind === "adset",
                                          )
                                          .map((set: Campaign) => (
                                            <div
                                              key={set._id}
                                              className="rounded-lg border bg-background p-2"
                                            >
                                              <div className="flex items-center gap-2">
                                                <span className="text-[13px] font-semibold">
                                                  {set.name}
                                                </span>
                                                <span
                                                  className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ring-1 ring-inset ${set.effectiveStatus === "ACTIVE" ? "bg-emerald-50 txt-good ring-emerald-200" : "bg-muted text-muted-foreground ring-border"}`}
                                                >
                                                  {set.effectiveStatus ??
                                                    set.status}
                                                </span>
                                                {set.dailyBudget !==
                                                  undefined && (
                                                  <span className="text-[12px] text-muted-foreground">
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
                                                  active={
                                                    (set.effectiveStatus ??
                                                      set.status) === "ACTIVE"
                                                  }
                                                />
                                              </div>
                                              <div className="mt-2 flex flex-wrap gap-3">
                                                {tree
                                                  .filter(
                                                    (t: Campaign) =>
                                                      t.kind === "ad" &&
                                                      t.adsetId === set.metaId,
                                                  )
                                                  .map((ad: Campaign) => (
                                                    <div
                                                      key={ad._id}
                                                      className="w-[340px]"
                                                    >
                                                      <div className="mb-1 flex items-center gap-1.5 text-[12px]">
                                                        <StatusToggle
                                                          compact
                                                          metaId={ad.metaId}
                                                          level="ad"
                                                          name={ad.name}
                                                          clientTag={
                                                            c.clientTag
                                                          }
                                                          campaignName={
                                                            c.campaignName
                                                          }
                                                          active={
                                                            (ad.effectiveStatus ??
                                                              ad.status) ===
                                                            "ACTIVE"
                                                          }
                                                        />
                                                        <span className="font-semibold">
                                                          {ad.name}
                                                        </span>
                                                        <span className="text-muted-foreground">
                                                          {ad.effectiveStatus ??
                                                            ad.status}
                                                        </span>
                                                      </div>
                                                      {ad.previewSrc ? (
                                                        <iframe
                                                          title={ad.name}
                                                          src={ad.previewSrc}
                                                          className="h-[560px] w-full rounded-md border bg-card"
                                                        />
                                                      ) : ad.thumbUrl ? (
                                                        <a
                                                          href={`https://business.facebook.com/adsmanager/manage/ads?selected_ad_ids=${ad.metaId}`}
                                                          target="_blank"
                                                          rel="noreferrer"
                                                          className="block"
                                                        >
                                                          <img
                                                            src={ad.thumbUrl}
                                                            alt={ad.name}
                                                            className="w-full rounded-md border bg-card object-cover"
                                                          />
                                                          <span className="mt-1 block text-[11px] text-muted-foreground">
                                                            Still image — open
                                                            in Ads Manager to
                                                            play
                                                          </span>
                                                        </a>
                                                      ) : (
                                                        <a
                                                          href={`https://business.facebook.com/adsmanager/manage/ads?selected_ad_ids=${ad.metaId}`}
                                                          target="_blank"
                                                          rel="noreferrer"
                                                          className="block rounded-md border p-3 text-[12px] text-muted-foreground underline-offset-2 hover:underline"
                                                        >
                                                          Meta won't render this
                                                          one — open it in Ads
                                                          Manager
                                                        </a>
                                                      )}
                                                    </div>
                                                  ))}
                                              </div>
                                            </div>
                                          ))}
                                      </div>
                                    ) : (
                                      <div className="mt-3 text-[12px] text-muted-foreground">
                                        Ad sets and creative can't be shown for
                                        this account yet — it isn't shared with
                                        our Meta partner ID.
                                      </div>
                                    )}
                                  </div>
                                )}
                                {mode === "reroute" && (
                                  <div className="max-w-2xl space-y-3">
                                    <div className="text-[14px] font-bold">
                                      Modify — {c.campaignName}
                                    </div>
                                    <div className="text-[12px] text-muted-foreground">
                                      This is not for me — pick what needs to
                                      happen and it lands on that team's ClickUp
                                      board as a request.
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                      {REQUESTS.map(r => (
                                        <button
                                          key={r.label}
                                          type="button"
                                          onClick={() => setDept(r.label)}
                                          className={`rounded-md border px-2.5 py-1 text-[12px] font-semibold ${r.label === dept ? "border-teal-400 bg-teal-50 text-teal-800" : "bg-background"}`}
                                        >
                                          {r.label}
                                        </button>
                                      ))}
                                    </div>
                                    <div className="rounded-md border bg-background p-2 text-[13px]">
                                      {c.reason}
                                    </div>
                                    <Textarea
                                      className="min-h-[70px] text-[13px]"
                                      placeholder="Anything the other team needs to know — goes into Additional Notes on the ticket."
                                      value={note}
                                      onChange={e => setNote(e.target.value)}
                                    />
                                    <div className="flex gap-2">
                                      <Button
                                        size="sm"
                                        onClick={() => {
                                          const r =
                                            REQUESTS.find(
                                              x => x.label === dept,
                                            ) ?? REQUESTS[0];
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
                                            REQUESTS.find(
                                              x => x.label === dept,
                                            ) ?? REQUESTS[0]
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
                                    <div className="text-[14px] font-bold">
                                      Leave it — {c.campaignName}
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                      {REASONS.map(r => (
                                        <button
                                          key={r}
                                          type="button"
                                          onClick={() => setReason(r)}
                                          className={`rounded-md border px-2.5 py-1 text-[12px] font-semibold ${r === reason ? "border-teal-400 bg-teal-50 text-teal-800" : "bg-background"}`}
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
                                          onClick={() => setClock(r)}
                                          className={`rounded-md border px-2.5 py-1 text-[12px] font-semibold ${r === clock ? "border-teal-400 bg-teal-50 text-teal-800" : "bg-background"}`}
                                        >
                                          {r}
                                        </button>
                                      ))}
                                    </div>
                                    <p className="text-[12px] leading-relaxed text-muted-foreground">
                                      "Client hasn't approved the budget"
                                      creates a CSM touchpoint task. "Disagree
                                      with the call" is logged separately — a
                                      rule disagreed with three times gets
                                      changed, not re-shown.
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
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <OffBoardCampaigns
              rows={(snap.offBoardCampaigns ?? []) as Campaign[]}
            />
            <BoardView
              cards={(snap.boardCards ?? []) as Campaign[]}
              campaigns={(snap.campaigns ?? []) as Campaign[]}
            />
          </section>
        )}

        {view === "sod" && (
          <section className="rounded-xl border bg-card p-4 shadow-sm">
            <h2 className="mb-1 text-[12px] font-bold uppercase tracking-widest text-teal-600">
              Watch list · launch cadence
            </h2>
            <p className="mb-3 text-[13px] text-muted-foreground">
              A new campaign gets watched twice a day for its first 72 hours.
              After that, every 3 to 7 days — sooner if you changed something.
            </p>
            {watchList.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                No campaign is inside its launch window and nothing is overdue a
                review. Work the ranked list instead.
              </p>
            ) : (
              watchList.map(w => (
                <div
                  key={w.c.campaignName}
                  className="flex items-baseline justify-between gap-3 border-b py-2 text-[13px] last:border-0"
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold">
                      {w.c.clientName ?? w.c.campaignName}
                    </div>
                    <div className="text-muted-foreground">{w.why}</div>
                  </div>
                  <span
                    className={`flex-none rounded px-2 py-0.5 text-[11px] font-bold uppercase ring-1 ring-inset ${w.hot ? "tone-warn ring-current/25" : "tone-neutral ring-current/25"}`}
                  >
                    {w.tag}
                  </span>
                </div>
              ))
            )}
          </section>
        )}

        {view === "sod" && (
          <section className="rounded-xl border bg-card p-4 shadow-sm">
            <h2 className="mb-2 text-[12px] font-bold uppercase tracking-widest text-teal-600">
              Then, in the accounts — start here
            </h2>
            <ol className="space-y-2 text-[14px]">
              {(snap.campaigns as Campaign[])
                .filter(c => !c.internal && c.spend7d >= 50)
                .slice(0, 3)
                .map((c, i) => (
                  <li
                    key={c.campaignName}
                    className="flex gap-2 border-b pb-2 last:border-0"
                  >
                    <span className="font-extrabold text-teal-600">
                      {i + 1}
                    </span>
                    <div>
                      <div className="font-semibold">
                        {c.clientName ?? c.campaignName}
                      </div>
                      <div className="text-[13px] text-muted-foreground">
                        {c.reason}
                      </div>
                      {c.findings?.[0] && (
                        <div className="mt-0.5 text-[13px]">
                          <span className="font-semibold">
                            {c.findings[0].constraint}:
                          </span>{" "}
                          {c.findings[0].fixes[0]}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
            </ol>
            <Link
              to="/ads"
              className="mt-3 inline-block rounded-md bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-foreground"
            >
              Open Ads management
            </Link>
          </section>
        )}

        {view === "sod" && (
          <section className="rounded-xl border bg-card p-4 shadow-sm">
            <h2 className="mb-2 text-[12px] font-bold uppercase tracking-widest text-teal-600">
              Your ClickUp — {(snap.inbox ?? []).length} open
            </h2>
            {(snap.inbox ?? []).length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                Nothing assigned to you and no comments tagging you.
              </p>
            ) : (
              // biome-ignore lint/suspicious/noExplicitAny: inbox row
              (snap.inbox as any[]).slice(0, 12).map(i => (
                <a
                  key={i._id}
                  href={i.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block border-b py-1.5 text-[13px] last:border-0 hover:bg-muted/40"
                >
                  <span className="font-semibold">{i.title}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    ·{" "}
                    {i.kind === "mention" ? `${i.author} tagged you` : i.reason}
                    {i.overdue ? " · overdue" : ""}
                  </span>
                  {i.body && (
                    <div className="text-muted-foreground">{i.body}</div>
                  )}
                </a>
              ))
            )}
          </section>
        )}

        {(view === "tasks" || view === "sod") && <TodayMeetings />}

        {view === "tasks" && <Onboardings />}

        {view === "tasks" && (
          <section className="rounded-xl border bg-card p-4 shadow-sm">
            <h2 className="mb-1 text-[12px] font-bold uppercase tracking-widest text-teal-600">
              Your ClickUp tasks
            </h2>
            <p className="mb-3 text-[13px] text-muted-foreground">
              Open work on the Ads Managment and Marketing / ADs boards. Ticking
              it here is not enough — open the task and move it, so the rest of
              the team sees it.
            </p>
            {(snap.inbox ?? []).length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Nothing open.</p>
            ) : (
              // biome-ignore lint/suspicious/noExplicitAny: inbox row
              (snap.inbox as any[]).map(i => (
                <div key={i._id} className="border-b py-2 last:border-0">
                  <div className="flex items-baseline justify-between gap-3 text-[13px]">
                    <a
                      href={i.url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      <span className="font-semibold">{i.title}</span>
                      {i.body && (
                        <span className="text-muted-foreground">
                          {" "}
                          · {i.body}
                        </span>
                      )}
                    </a>
                    <span className="flex-none text-[12px] text-muted-foreground">
                      {i.kind === "mention"
                        ? `${i.author} tagged you`
                        : i.listName}
                      {i.overdue ? " · overdue" : ""}
                    </span>
                  </div>
                  {ask === i._id ? (
                    <div className="mt-2 space-y-2 rounded-md border bg-background p-2">
                      <select
                        className="h-8 w-full rounded-md border bg-background px-2 text-[13px]"
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
                      </select>
                      <Input
                        value={askText}
                        placeholder="What is missing? e.g. which landing page should this point to?"
                        className="h-8 text-[13px]"
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
                              taskId: i.taskId,
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
                      className="mt-1 text-[12px] text-primary underline"
                      onClick={() => setAsk(i._id)}
                    >
                      Something missing? Ask someone on this task
                    </button>
                  )}
                </div>
              ))
            )}
          </section>
        )}

        {view === "tasks" && (
          <section className="rounded-xl border bg-card p-4 shadow-sm">
            <h2 className="mb-1 text-[12px] font-bold uppercase tracking-widest text-teal-600">
              What you planned
            </h2>
            {(snap.plan ?? []).length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                Nothing planned yet. Write tomorrow's list on the End of day
                screen.
              </p>
            ) : (
              // biome-ignore lint/suspicious/noExplicitAny: plan row
              (snap.plan as any[]).map(p => (
                <div
                  key={p._id}
                  className="border-b py-1.5 text-[13px] last:border-0"
                >
                  {p.text}
                  {p.clickupTaskUrl && (
                    <a
                      className="ml-2 text-primary underline"
                      href={p.clickupTaskUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      on ClickUp
                    </a>
                  )}
                </div>
              ))
            )}
          </section>
        )}

        {view === "touch" && (
          <section className="rounded-xl border bg-card p-4 shadow-sm">
            <h2 className="mb-1 text-[12px] font-bold uppercase tracking-widest text-teal-600">
              Proactive touchpoints
            </h2>
            <p className="mb-3 text-[13px] text-muted-foreground">
              One or two per client per week, and always after a change. Copy
              the message, send it on WhatsApp, then log it — the CSM sees it on
              the client's task.
            </p>
            {touchpoints.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                Nothing owed right now. Take a decision in Ads management and
                the message for that client shows up here.
              </p>
            ) : (
              touchpoints.map(tp => (
                <div
                  key={tp.campaign.campaignName}
                  className="border-b py-3 last:border-0"
                >
                  <div className="text-[14px] font-bold">
                    {tp.campaign.clientName ?? tp.campaign.campaignName}
                  </div>
                  <div className="text-[12px] text-muted-foreground">
                    {tp.why}
                  </div>
                  <Textarea
                    dir={tp.lang === "ar" ? "rtl" : "ltr"}
                    className="mt-1.5 min-h-[130px] text-[13px] leading-relaxed"
                    value={drafts[tp.key] ?? tp.message}
                    onChange={e =>
                      setDrafts(d => ({ ...d, [tp.key]: e.target.value }))
                    }
                  />
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        navigator.clipboard.writeText(
                          drafts[tp.key] ?? tp.message,
                        )
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
                      I sent it — log it
                    </Button>
                    <span className="ml-auto flex items-center gap-1 text-[12px] text-muted-foreground">
                      writes in:
                      {(["ar", "en"] as const).map(lang => (
                        <button
                          key={lang}
                          type="button"
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
                          className={`rounded border px-1.5 py-0.5 font-semibold ${tp.lang === lang ? "border-teal-400 bg-teal-50 text-teal-800" : "bg-background"}`}
                        >
                          {lang === "ar" ? "العربية" : "English"}
                        </button>
                      ))}
                    </span>
                  </div>
                </div>
              ))
            )}
          </section>
        )}

        {view !== "ads" && (
          <div className="space-y-5">
            {view === "sod" && (
              <section className="rounded-xl border bg-card p-4 shadow-sm">
                <div className="mb-1 flex items-baseline justify-between">
                  <h2 className="text-[12px] font-bold uppercase tracking-widest text-teal-600">
                    Morning sprint · in this order
                  </h2>
                  <span className="text-[12px] text-muted-foreground">
                    {checksDone} of {sodChecks.length}
                  </span>
                </div>
                <p className="mb-3 text-[13px] text-muted-foreground">
                  Clear communication first so nobody is waiting on you. The
                  accounts come after — that is your best work and it needs a
                  clean head.
                </p>
                {sodChecks.map((c, idx) => (
                  <div
                    key={c._id}
                    className="flex items-start gap-2.5 border-b py-2.5 last:border-0"
                  >
                    <button
                      type="button"
                      onClick={() => toggleCheck({ id: c._id })}
                      className={`mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full border text-[12px] font-bold ${c.done ? "border-[var(--chart-1)] bg-[var(--chart-1)] text-background" : "border-muted-foreground/30 text-muted-foreground"}`}
                    >
                      {c.done ? "✓" : idx + 1}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-[13px] font-semibold leading-snug ${c.done ? "text-muted-foreground line-through" : ""}`}
                      >
                        {c.label}
                      </div>
                      {c.detail && (
                        <div className="text-[12px] text-muted-foreground">
                          {c.detail}
                        </div>
                      )}
                      {c.href && (
                        <Link
                          to={c.href}
                          className="text-[12px] font-semibold text-primary underline"
                        >
                          Open it
                        </Link>
                      )}
                      {c.key === "whatsapp_am" && !waConnected && (
                        <div className="text-[12px] txt-warn">
                          Not connected yet — I cannot read the client groups,
                          so this one is on you until the WhatsApp token is
                          back.
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <div className="mt-3 rounded-lg border border-teal-200 bg-teal-50/60 p-3">
                  <div className="text-[12px] font-bold uppercase tracking-widest text-teal-700">
                    Then — middle of the day
                  </div>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    Inbox clear? Everything below is account work. Do it in one
                    block, one client at a time.
                  </p>
                  <Link
                    to="/ads"
                    className="mt-2 inline-block rounded-md bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-foreground"
                  >
                    Open Ads management
                  </Link>
                </div>
              </section>
            )}

            {view === "eod" && (
              <section className="rounded-xl border bg-card p-4 shadow-sm">
                <div className="mb-2 flex items-baseline justify-between">
                  <h2 className="text-[12px] font-bold uppercase tracking-widest text-teal-600">
                    Your EOD report — already written
                  </h2>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigator.clipboard.writeText(eodReport)}
                  >
                    Copy for Slack
                  </Button>
                </div>
                <pre className="whitespace-pre-wrap rounded-md border bg-background p-3 text-[13px] leading-relaxed">
                  {eodReport}
                </pre>
                <div className="mt-4 space-y-4">
                  <div>
                    <div className="text-[12px] font-bold uppercase tracking-widest text-muted-foreground">
                      Health
                    </div>
                    <div className="mt-1.5 grid grid-cols-3 gap-2">
                      {[
                        ["focus", "Focus"],
                        ["energy", "Energy"],
                        ["biology", "Food, sleep, water"],
                      ].map(([k, label]) => (
                        <label key={k} className="text-[12px]">
                          <span className="text-muted-foreground">{label}</span>
                          <input
                            type="number"
                            min={1}
                            max={10}
                            value={eodForm[k]}
                            onChange={e => setEod(k, e.target.value)}
                            className="mt-0.5 w-full rounded-md border bg-background px-2 py-1.5 text-[14px]"
                          />
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-[12px] font-bold uppercase tracking-widest text-muted-foreground">
                      Tasks
                    </div>
                    <div className="mt-1.5 space-y-1.5">
                      {[
                        ["dashboard", "Fulfillment dashboard updated"],
                        ["onBudget", "All accounts within daily budget"],
                        ["flagged", "Off-KPI accounts flagged to the CSM"],
                        ["videoRequests", "Video requests / briefs submitted"],
                        ["creativesUploaded", "Approved creatives uploaded"],
                        [
                          "launchedPaused",
                          "Creatives launched or paused today",
                        ],
                      ].map(([k, label]) => (
                        <div
                          key={k}
                          className="flex items-center justify-between gap-3 border-b pb-1.5 last:border-0"
                        >
                          <span className="text-[13px]">{label}</span>
                          <div className="flex flex-none gap-1">
                            {["Yes", "No"].map(opt => (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => setEod(k, opt)}
                                className={`rounded-md border px-2.5 py-1 text-[12px] font-semibold ${eodForm[k] === opt ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                              >
                                {opt}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-[12px] font-bold uppercase tracking-widest text-muted-foreground">
                      Today's numbers — already filled in
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-3">
                      <div>
                        Spend{" "}
                        <span className="font-semibold">
                          ${eodNumbers.spend}
                        </span>
                      </div>
                      <div>
                        Leads{" "}
                        <span className="font-semibold">
                          {eodNumbers.leads}
                        </span>
                      </div>
                      <div>
                        Avg CPL{" "}
                        <span className="font-semibold">${eodNumbers.cpl}</span>
                      </div>
                      <div>
                        Accounts{" "}
                        <span className="font-semibold">
                          {eodNumbers.accounts}
                        </span>
                      </div>
                      <div className="col-span-2">
                        Any client over ${CPL_GATE}{" "}
                        <span className="font-semibold">
                          {eodNumbers.overGate}
                        </span>
                        {eodNumbers.overNames.length > 0 && (
                          <span className="text-muted-foreground">
                            {" "}
                            — {eodNumbers.overNames.join(", ")}
                          </span>
                        )}
                      </div>
                    </div>
                    {eodNumbers.through && (
                      <div className="mt-1 text-[12px] text-muted-foreground">
                        Figures are for {eodNumbers.through} — the last day Meta
                        has reported.
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Textarea
                      className="min-h-[70px] text-[13px]"
                      placeholder="Account summary — what you actually did today."
                      value={eodForm.accountSummary}
                      onChange={e => setEod("accountSummary", e.target.value)}
                    />
                    <Textarea
                      className="min-h-[50px] text-[13px]"
                      placeholder="Clients out of KPI and what you're doing about it."
                      value={eodForm.outOfKpi}
                      onChange={e => setEod("outOfKpi", e.target.value)}
                    />
                    <Textarea
                      className="min-h-[50px] text-[13px]"
                      placeholder="One thing that would make us 1% better — to add or to remove."
                      value={onePercent}
                      onChange={e => setOnePercent(e.target.value)}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
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
                      {eodRow?.submittedAt
                        ? `Submitted ✓ ${new Date(eodRow.submittedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
                        : eodSending
                          ? "Saving…"
                          : "Submit my EOD"}
                    </Button>
                    {eodRow && !eodRow.submittedAt && !eodSending && (
                      <span className="text-[12px] text-amber-800">
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
                <p className="mt-2 text-[12px] text-muted-foreground">
                  This replaces the form. Submitting posts it to #media-eods and
                  appends the row to the EOD Reports sheet, exactly as before.
                </p>
              </section>
            )}

            {view === "eod" && (
              <section className="rounded-xl border bg-card p-4 shadow-sm">
                <div className="mb-2 flex items-baseline justify-between">
                  <h2 className="text-[12px] font-bold uppercase tracking-widest text-teal-600">
                    Plan tomorrow today
                  </h2>
                  <span className="text-[12px] text-muted-foreground">
                    this is also your EOD
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mb-2 w-full"
                  onClick={buildTomorrow}
                >
                  Write it for me from today's board
                </Button>
                <Textarea
                  value={dump}
                  onChange={e => setDump(e.target.value)}
                  rows={6}
                  placeholder="One line per thing. Arabic or English."
                  className="text-[13px]"
                />
                <Button size="sm" className="mt-2 w-full" onClick={submitPlan}>
                  Turn into tasks for tomorrow
                </Button>
                <div className="mt-3 space-y-1.5">
                  {snap.plan.map(
                    (p: { _id: string; text: string; listName?: string }) => (
                      <div
                        key={p._id}
                        className="flex justify-between gap-3 border-b pb-1.5 text-[13px] last:border-0"
                      >
                        <span>{p.text}</span>
                        <span className="whitespace-nowrap text-[12px] text-muted-foreground">
                          {p.listName} · tomorrow
                        </span>
                      </div>
                    ),
                  )}
                </div>
              </section>
            )}

            {view !== "sod" && (
              <section className="rounded-xl border bg-card p-4 shadow-sm">
                <h2 className="mb-2 text-[12px] font-bold uppercase tracking-widest text-teal-600">
                  Change log · written to ClickUp
                </h2>
                {snap.decisions.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">
                    Nothing yet. Every decision you take here is posted as a
                    comment on that client's campaign task in ClickUp, with the
                    numbers behind it — so the CSM walks into a check-in call
                    with the full history.
                  </p>
                ) : (
                  snap.decisions.map(
                    (d: {
                      _id: string;
                      subject: string;
                      action: string;
                      reason?: string;
                      loggedAt?: number;
                      logError?: string;
                      clickupTaskUrl?: string;
                    }) => (
                      <div
                        key={d._id}
                        className="border-b py-1.5 text-[13px] last:border-0"
                      >
                        <span className="font-semibold">{d.subject}</span> —{" "}
                        {d.action}
                        {d.reason ? (
                          <span className="text-muted-foreground">
                            {" "}
                            · {d.reason}
                          </span>
                        ) : null}
                        <div className="mt-0.5 text-[12px]">
                          {d.logError ? (
                            <span className="text-destructive">
                              Not logged to ClickUp — {d.logError}
                            </span>
                          ) : d.loggedAt ? (
                            <a
                              className="text-primary underline"
                              href={d.clickupTaskUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Logged on the ClickUp task — the CSM can see it
                            </a>
                          ) : (
                            <span className="text-muted-foreground">
                              Logging to ClickUp…
                            </span>
                          )}
                          <button
                            type="button"
                            className="ml-2 text-muted-foreground underline"
                            onClick={() =>
                              void removeDecision({
                                id: d._id as Id<"decisions">,
                              })
                            }
                          >
                            remove from today
                          </button>
                        </div>
                      </div>
                    ),
                  )
                )}
              </section>
            )}
          </div>
        )}
      </div>

      {/* Report an issue — she can flag anything wrong on the screen without leaving it. */}
      {/* Bottom left, clear of the Hermes chat at bottom right. */}
      <div className="fixed bottom-5 left-4 z-30 print:hidden md:left-[calc(var(--sidebar-width,16rem)+1rem)]">
        {chatOpen ? (
          <div className="w-[330px] rounded-xl border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <div>
                <div className="text-[13px] font-bold">Report an issue</div>
                <div className="text-[11px] text-muted-foreground">
                  A question, or something here looks wrong
                </div>
              </div>
              <button
                type="button"
                className="text-[16px] leading-none text-muted-foreground"
                onClick={() => setChatOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="max-h-56 space-y-2 overflow-y-auto px-3 py-2">
              {/* biome-ignore lint/suspicious/noExplicitAny: feedback row */}
              {((snap.feedback ?? []) as any[]).length === 0 ? (
                <p className="text-[12px] text-muted-foreground">
                  Tell me if a number looks off, a client is missing, or you
                  want something on this screen changed. It reaches me directly
                  and I reply in Slack.
                </p>
              ) : (
                // biome-ignore lint/suspicious/noExplicitAny: feedback row
                ((snap.feedback ?? []) as any[]).map(f => (
                  <div key={f._id} className="text-[12px]">
                    <div className="rounded-lg bg-muted px-2.5 py-1.5">
                      {f.text}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {f.page} ·{" "}
                      {new Date(f.at).toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {f.delivered ? " · sent" : " · sending"}
                    </div>
                    {f.reply && (
                      <div className="mt-1 rounded-lg bg-accent px-2.5 py-1.5 text-accent-foreground">
                        {f.reply}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
            <div className="border-t p-2">
              <textarea
                value={chatText}
                onChange={e => setChatText(e.target.value)}
                rows={2}
                placeholder="e.g. Liwan's spend looks too low, can you check?"
                className="w-full resize-none rounded-md border bg-background p-2 text-[13px]"
              />
              <Button
                size="sm"
                className="mt-1 w-full"
                disabled={!chatText.trim()}
                onClick={async () => {
                  await sendFeedback({
                    message: chatText.trim(),
                    page: TITLES[view].title,
                  });
                  setChatText("");
                  toast.success("Sent");
                }}
              >
                Send
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            className="rounded-full bg-primary px-4 py-3 text-[13px] font-semibold text-primary-foreground shadow-xl"
          >
            Report an issue
          </button>
        )}
      </div>
    </div>
  );
}
