import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  MoonStar,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import { toast } from "sonner";
import { ClientCheckIn } from "@/components/ClientCheckIn";
import {
  Chip,
  Dot,
  ExtLink,
  Fold,
  Kicker,
  PageHeader,
  Pill,
  PillRow,
  StatTile,
  type Tone,
} from "@/components/kit";
import { KitSummary, OnboardingKit } from "@/components/OnboardingKit";
import { PortalTasksButton } from "@/components/PortalTasks";
import { ReportIssue } from "@/components/ReportIssue";
import { SyncStrip } from "@/components/SyncStrip";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Textarea } from "@/components/ui/textarea";
import { opportunitiesFor, rankOpportunities } from "@/lib/csmHotList";
import { LINK_GROUPS } from "@/lib/csmLinks";
import {
  CHURN_TARGET,
  type Counts,
  computePay,
  EARNERS,
  FOUR_RS,
  PENALTIES,
} from "@/lib/csmMoney";
import { spineFor } from "@/lib/csmOnboardingSpine";
import {
  blanksIn,
  cadence,
  draftsFor,
  guessLang,
  humanise,
  isChurned,
  type Lang,
  LINKS,
  nextCall,
  nextPocState,
  serviceModel,
} from "@/lib/csmTemplates";
import {
  displayLabel,
  plainText,
  plural,
  sentence,
  shortDay,
} from "@/lib/format";
import { publishOpenClient } from "@/lib/openClient";
import { fold, matchScore } from "@/lib/search";
import { cn } from "@/lib/utils";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { MonthRow } from "../../convex/churnCore";
import type { KitsPage, OnboardingRow } from "../../convex/onboardingCore";
import { BacklogPage } from "./BacklogPage";
import {
  AddTask,
  ClientLinks,
  ClientPerformancePage,
  ClientProfile,
  LINK_LABELS,
} from "./ClientPerformancePage";
import { MeetingsPage } from "./MeetingsPage";

/** Tickets the CSM raises. Picking the request picks the board — she never picks a team. */
const TICKETS: { label: string; dept: string; deptLabel: string }[] = [
  {
    label: "Switch this campaign to a landing page",
    dept: "tech",
    deptLabel: "Tech",
  },
  {
    label: "Add qualification questions to the lead form",
    dept: "tech",
    deptLabel: "Tech",
  },
  { label: "Tracking / page is broken", dept: "tech", deptLabel: "Tech" },
  { label: "GHL or automation change needed", dept: "tech", deptLabel: "Tech" },
  { label: "New ads needed", dept: "creative", deptLabel: "Creative" },
  { label: "New scripts needed", dept: "creative", deptLabel: "Creative" },
  {
    label: "Thank-you video to lift show rate",
    dept: "creative",
    deptLabel: "Creative",
  },
  {
    label: "Lead quality is poor, review targeting",
    dept: "media_buyer",
    deptLabel: "Media buyer",
  },
  {
    label: "Budget change requested by the client",
    dept: "media_buyer",
    deptLabel: "Media buyer",
  },
  // Lifecycle requests. They all land on Operations/Tech, which is where the
  // Request Type field with the pause / relaunch / offboarding options actually lives.
  { label: "Pause this client", dept: "tech", deptLabel: "Tech" },
  { label: "Relaunch this client", dept: "tech", deptLabel: "Tech" },
  { label: "Offboard this client", dept: "tech", deptLabel: "Tech" },
  {
    label: "Leads are not being called",
    dept: "call_center",
    deptLabel: "Call centre",
  },
  {
    label: "Show-rate SOP needed for this account",
    dept: "call_center",
    deptLabel: "Call centre",
  },
];

/**
 * The ClickUp board's Client Status options, spelled exactly as ClickUp has
 * them (the write matches the name), in journey order. Brand Blueprint
 * Booked and Cancelled onboarding were missing (the simplification audit,
 * 2026-10-06); "Sales team to contact" is the sales team's, not the CSM's.
 */
const STAGES = [
  "Needs Contacting",
  "Onboarding Booked",
  "Brand Blueprint Booked♠️",
  "LAUNCH BOOKED",
  "Ready For Launch🚀",
  "Active",
  "Paused",
  "DELAY OUT OF OUR CONTROL",
  "GHOSTED",
  "CANCELLED ONBOARDING",
  "Stopped",
];
const HAPPINESS = [
  "Very Happy (testimonial)",
  "Happy",
  "Neutral",
  "At Risk",
  "Paused",
  "Churned",
];
const REASONS = [
  "Client is travelling / unavailable",
  "Waiting on the client to send something",
  "Waiting on another team",
  "Already handled outside the app",
  "Disagree with the call",
];
const CLOCKS = ["Tomorrow", "In 3 days", "Next week"];

/**
 * How much a client needs her today, as the dot before the name. The colour
 * sits on the dot only, so the row reads the same in both themes.
 */
const LEVEL_TONE: Record<string, Tone> = {
  red: "bad",
  amber: "warn",
  blue: "neutral",
  green: "good",
};
const LEVEL_LABEL: Record<string, string> = {
  red: "Urgent today",
  amber: "Needs attention",
  blue: "Routine",
  green: "Handled",
};

/** The client's level dot, with its meaning for screen readers and a hover. */
function LevelDot({ level }: { level?: string }) {
  return (
    <Dot
      tone={LEVEL_TONE[level ?? ""] ?? "neutral"}
      label={LEVEL_LABEL[level ?? ""] ?? "Routine"}
    />
  );
}

/** A card with a title row, for the list screens. */
function SectionCard({
  title,
  count,
  sub,
  action,
  children,
  flush,
}: {
  title: ReactNode;
  count?: number;
  sub?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  /** The body is a divided list that runs edge to edge under a divider. */
  flush?: boolean;
}) {
  return (
    <section className="rounded-2xl border bg-card">
      <div
        className={cn(
          "flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 pt-4 sm:px-6 sm:pt-6",
          flush ? "border-b pb-4" : "",
        )}
      >
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">
            {title}
            {count !== undefined ? (
              <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">
                {count}
              </span>
            ) : null}
          </h2>
          {sub ? (
            <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className={flush ? "divide-y" : "px-4 pt-4 pb-4 sm:px-6 sm:pb-6"}>
        {children}
      </div>
    </section>
  );
}

// biome-ignore lint/suspicious/noExplicitAny: snapshot payload is untyped by design
type Client = any;

function ShortList({
  title,
  items,
  render,
  limit = 5,
  empty,
}: {
  title: string;
  items: unknown[];
  render: (item: never) => React.ReactNode;
  limit?: number;
  empty: string;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, limit);
  return (
    <div className="space-y-3">
      <h2 className="text-[15px] font-semibold">
        {title}
        <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">
          {items.length}
        </span>
      </h2>
      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <>
          {shown.map(i => render(i as never))}
          {items.length > limit && (
            <Button variant="ghost" size="sm" onClick={() => setAll(v => !v)}>
              {all ? "Show fewer" : `Show the other ${items.length - limit}`}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Book the next CALL, written into ClickUp's `Next POC` field.
 *
 * The company rule: next point of contact means the next call, and we always want to know when it
 * is. So this carries the right booking link for their stage (onboarding call or client
 * check-in call), the invite text to send with it, and the date field that puts it on the
 * board. Messages are not booked here, they are tracked automatically off the cadence.
 */
function NextPocControl({
  c,
  today,
  lang,
  onLog,
  emphasise,
}: {
  c: Client;
  today: string;
  lang: Lang;
  onLog: (
    c: Client,
    action: string,
    kind: string,
    extra?: Record<string, unknown>,
  ) => void;
  emphasise?: boolean;
}) {
  const st = nextPocState(c, today);
  const call = nextCall(c, lang);
  const [date, setDate] = useState(
    st.date && !st.past ? st.date : st.suggested,
  );
  const bad = st.missing || st.past;
  return (
    <div
      className={cn(
        "space-y-3 rounded-xl bg-muted/40 p-4 text-sm",
        emphasise && bad && "ring-1 ring-destructive/50",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={bad ? "bad" : "good"}>{st.label}</Chip>
        <span className="text-xs text-muted-foreground">{call.label}</span>
      </div>
      <p className="text-xs">
        {call.doNow}
        {call.framework ? (
          <>
            {" "}
            <ExtLink href={call.framework}>Open the framework</ExtLink>
          </>
        ) : null}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {call.url ? (
          <Button size="sm" variant="outline" asChild>
            <a href={call.url} target="_blank" rel="noreferrer">
              {call.label} booking link
              <ArrowUpRight aria-hidden />
            </a>
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">
            {call.label}, no link needed
          </span>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            navigator.clipboard.writeText(call.message);
            toast.success("Invite copied, send it on WhatsApp");
          }}
        >
          Copy the invite with the link
        </Button>
        <DateInput
          value={date}
          onChange={e => setDate(e.target.value)}
          aria-label="Date of the next call"
          className="rounded-lg border bg-background px-2 py-1 text-xs text-foreground"
        />
        <Button
          size="sm"
          variant={bad ? "default" : "outline"}
          onClick={() =>
            onLog(c, `Next call booked for ${date}`, "booked", {
              value: date,
              note: `Booked via ${call.label.toLowerCase()}${
                call.url ? ` (${call.url})` : ""
              }.`,
            })
          }
        >
          They booked, save it to ClickUp
        </Button>
      </div>
    </div>
  );
}

/**
 * A date field with its button, for the places that book a call in one click.
 * A date input can only produce a real day, so free text never reaches the
 * Next POC field in ClickUp.
 */
function BookDate({
  c,
  today,
  label,
  onBook,
}: {
  c: Client;
  today: string;
  label: string;
  onBook: (date: string) => void;
}) {
  const st = nextPocState(c, today);
  const [date, setDate] = useState(
    st.date && !st.past ? st.date : st.suggested,
  );
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <DateInput
        value={date}
        onChange={e => setDate(e.target.value)}
        aria-label="Date of the next call"
        className="rounded-lg border bg-background px-2 py-1 text-xs text-foreground"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={!date}
        onClick={() => onBook(date)}
      >
        {label}
      </Button>
    </span>
  );
}

/**
 * The message picker: every SOP template that applies to this client right now, English or
 * Arabic, editable, with the two clocks and the next point of contact underneath. Shared by
 * the touchpoints view and the client management rows so the templates are never more than
 * one click away, wherever she is standing.
 */
function TemplatePicker({
  c,
  lang,
  onLang,
  onLog,
  today,
}: {
  c: Client;
  lang: Lang;
  onLang: (lang: Lang) => void;
  onLog: (
    c: Client,
    action: string,
    kind: string,
    extra?: Record<string, unknown>,
  ) => void;
  today: string;
}) {
  const drafts = draftsFor(c, lang);
  const [angle, setAngle] = useState(drafts[0].id);
  const [edits, setEdits] = useState<Record<string, string>>({});
  // Set after she logs a message, so the next point of contact control is the thing she
  // cannot walk past.
  const [justSent, setJustSent] = useState(false);
  const chosen = drafts.find(d => d.id === angle) ?? drafts[0];
  const editKey = `${lang}:${chosen.id}`;
  const text = edits[editKey] ?? chosen.message;
  const nc = nextCall(c, lang);
  // A message still holding a blank ("[report link]", DATE) never reaches a client.
  const blanks = blanksIn(text);
  const missingLink = blanks.length > 0;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {drafts.length > 1 ? (
          <PillRow className="min-w-0 flex-1 basis-full sm:basis-0">
            {drafts.map(d => (
              <Pill
                key={d.id}
                active={d.id === chosen.id}
                onClick={() => setAngle(d.id)}
              >
                {d.title}
              </Pill>
            ))}
          </PillRow>
        ) : (
          <span className="text-sm font-medium">{chosen.title}</span>
        )}
        <div className="flex items-center gap-1">
          {(["en", "ar"] as const).map(l => (
            <Pill
              key={l}
              active={lang === l}
              onClick={() => {
                setEdits({});
                onLang(l);
              }}
            >
              {l === "ar" ? "العربية" : "English"}
            </Pill>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        From the client communication SOP. {chosen.why} Messages are tracked off
        the cadence, you only book the calls.
      </p>
      <Textarea
        rows={8}
        value={text}
        onChange={e => setEdits(x => ({ ...x, [editKey]: e.target.value }))}
        dir={lang === "ar" ? "rtl" : "ltr"}
      />
      {missingLink ? (
        <p className="callout-warn rounded-xl border px-3 py-2 text-xs">
          Fill in {blanks.join(", ")} before this goes to the client.
          {blanks.some(b => b.includes("report") || b.includes("التقرير"))
            ? " Write the report on the Results tab, then paste its link."
            : ""}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={missingLink}
          onClick={() => {
            navigator.clipboard.writeText(text);
            toast.success("Copied, paste it into the client's WhatsApp group");
          }}
        >
          Copy the message
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={missingLink}
          onClick={() => {
            onLog(c, `Messaged the client, ${chosen.short}`, "touchpoint", {
              note: text,
            });
            setJustSent(true);
          }}
        >
          Sent it, log the touchpoint
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            navigator.clipboard.writeText(nc.message);
            toast.success(`Copied the ${nc.label.toLowerCase()} invite`);
          }}
        >
          Copy the {nc.label.toLowerCase()} invite
        </Button>
        {c.reportDue && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onLog(c, "Monthly report sent to the client", "report", {})
            }
          >
            Monthly report sent, log it
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        {nc.url ? (
          <ExtLink href={nc.url}>{nc.label} booking link</ExtLink>
        ) : (
          <span className="text-muted-foreground">
            {nc.label}, no link needed
          </span>
        )}
        {c.sheetLink && (
          <ExtLink href={c.sheetLink}>Their performance sheet</ExtLink>
        )}
        {c.noteMissing && (
          <a
            className="inline-flex items-center gap-1.5 font-medium txt-bad underline-offset-4 hover:underline"
            href={LINKS.callSummaryForm}
            target="_blank"
            rel="noreferrer"
          >
            1-1 notes missing for the last call
            <ArrowUpRight aria-hidden className="size-3.5" />
          </a>
        )}
      </div>
      {justSent && (
        <p className="text-xs font-medium text-primary">
          Logged. Now set the next point of contact, we always want to know when
          the next call is.
        </p>
      )}
      <NextPocControl
        c={c}
        today={today}
        lang={lang}
        onLog={onLog}
        emphasise={justSent}
      />
    </div>
  );
}

/**
 * One hot-list opportunity — the same columns as the old sheet, plus the ask and the
 * objection answer. Her edits to the columns persist; the pitch is regenerated live.
 */

/** Every checklist item carries the reason it exists — click it and you see why. */
function ChecklistItem({
  title,
  why,
  action,
  meta,
}: {
  title: string;
  why: string;
  action?: React.ReactNode;
  /** A status chip beside the title. */
  meta?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left text-sm sm:px-6"
        onClick={() => setOpen(!open)}
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0">{title}</span>
          {meta}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
            open ? "rotate-180" : "",
          )}
        />
      </button>
      {open && (
        <div className="space-y-2 px-4 pb-4 text-xs text-muted-foreground sm:px-6">
          <div>{why}</div>
          {action}
        </div>
      )}
    </div>
  );
}

/** A long list, first `limit` rows, the rest behind one button. */
function Capped({ items, limit = 10 }: { items: ReactNode[]; limit?: number }) {
  const [all, setAll] = useState(false);
  return (
    <>
      {all ? items : items.slice(0, limit)}
      {items.length > limit ? (
        <div className="px-2 py-2 sm:px-4">
          <Button variant="ghost" size="sm" onClick={() => setAll(v => !v)}>
            {all ? "Show fewer" : `Show the other ${items.length - limit}`}
          </Button>
        </div>
      ) : null}
    </>
  );
}

/**
 * The places this page draws. Today, Clients and one client's page are their
 * own addresses; the hot list and the CSM's pay are tabs of Money.
 */
type Section =
  | "today"
  | "clients"
  | "client"
  | "hot"
  | "links"
  | "money"
  | "eod";

/**
 * The hot list, as a sheet.
 *
 * The instruction: keep it simple and let the CSM own it. So this is the same ten
 * columns as his Hot List sheet, fully editable, and nothing writes itself into it. What I
 * see in the data appears underneath as a suggestion with an "add it" button, because a
 * recommendation the CSM chose to accept gets worked, and a row that appeared by itself
 * gets ignored.
 *
 * Last follow-up and next follow-up are the accountability columns: they are his promise
 * to himself, in his own handwriting.
 */
// biome-ignore lint/suspicious/noExplicitAny: stored row shape mirrors the table
type Any = any;

function HotSheet({
  suggestions,
  saved,
  onSave,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: opportunity + row shapes live in the libs
  suggestions: any[];
  // biome-ignore lint/suspicious/noExplicitAny: mirrors the hotList table
  saved: any[];
  // biome-ignore lint/suspicious/noExplicitAny: Convex mutation reference
  onSave: (args: any) => Promise<unknown>;
}) {
  /**
   * The dropdown lists, exactly as they are on his Hot List sheet (he sent screenshots of
   * the sheet's own validation, so these are copies, not my guesses), with the same
   * colours: RED HOT is red, Hot pink, Warm amber, Closed green, Nurturing amber.
   */
  const OPTIONS: Record<string, string[]> = {
    leadType: ["RED HOT", "Hot", "Warm", "On Hold"],
    status: ["Closed", "Nurturing", "On Hold"],
    type: [
      "Upsell - SMM",
      "Upsell - Service",
      "Upsell - SEO + GEO",
      "Upsell - Closer Placement",
      "Upsell - UGC Package",
      "Upsell - Website",
      "Upsell - BE Program",
      "Referral",
      "Review",
    ],
  };
  /** The sheet's colours, carried by a dot beside the dropdown. */
  const TONE: Record<string, Tone> = {
    "RED HOT": "bad",
    Hot: "bad",
    Warm: "warn",
    "On Hold": "neutral",
    Closed: "good",
    Nurturing: "warn",
  };
  const DATE_FIELDS = new Set(["lastFu", "nextFu"]);
  const COLS = [
    ["clientName", "Name", "w-40"],
    ["leadType", "Lead type", "w-36"],
    ["status", "Status", "w-36"],
    ["type", "Type", "w-44"],
    ["contactUrl", "Contact URL", "w-40"],
    ["lastObjection", "Last objection", "w-40"],
    ["amount", "Amount", "w-24"],
    ["lastFu", "Last follow-up", "w-36"],
    ["nextFu", "Next follow-up", "w-36"],
    ["notes", "Notes", "w-64"],
  ] as const;
  const rows = saved.filter(r => !r.hidden);
  const takenKeys = new Set(saved.map(r => r.key));
  // Win-backs are 24 of the 25 things I can see, and a wall of them is the opposite of a
  // hot list. Best few first, the rest behind a click.
  const [showAll, setShowAll] = useState(false);
  const allOpen = suggestions.filter(o => !takenKeys.has(o.key));
  const open = showAll ? allOpen : allOpen.slice(0, 6);
  const patch = (row: Any, field: string, value: string) =>
    onSave({
      key: row.key,
      clientName: row.clientName,
      type: row.type,
      leadType: row.leadType,
      status: row.status,
      lastObjection: row.lastObjection,
      contactUrl: row.contactUrl,
      amount: row.amount,
      lastFu: row.lastFu,
      nextFu: row.nextFu,
      notes: row.notes,
      manual: row.manual,
      [field]: value,
    });
  return (
    <div className="space-y-6">
      <SectionCard
        title="Your list"
        count={rows.length}
        sub="Your list, your handwriting. Track the last follow-up and the next one so nothing sits. Rows are only ever suggested below, never added for you."
        action={
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              onSave({
                key: `manual:${Date.now()}`,
                clientName: "",
                type: "",
                manual: true,
              })
            }
          >
            Add a row
          </Button>
        }
        flush
      >
        {/* relative: the dropdowns' hidden native selects stay inside the
            scroller instead of widening the page on a phone. */}
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="border-b">
                {COLS.map(([, label]) => (
                  <th
                    key={label}
                    className="px-2 py-2 text-left font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-muted-foreground first:pl-4 sm:first:pl-6"
                  >
                    {label}
                  </th>
                ))}
                <th className="w-12" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={COLS.length + 1}
                    className="px-4 py-4 text-muted-foreground sm:px-6"
                  >
                    Nothing on your list yet. Add a row, or take one of the
                    suggestions below.
                  </td>
                </tr>
              ) : (
                rows.map(r => (
                  <tr key={r.key}>
                    {COLS.map(([field, , width]) => (
                      <td
                        key={field}
                        className={`px-1 py-1.5 first:pl-3 sm:first:pl-5 ${width}`}
                      >
                        {OPTIONS[field] ? (
                          <div className="flex items-center gap-1.5">
                            {TONE[r[field] ?? ""] ? (
                              <Dot tone={TONE[r[field]]} />
                            ) : null}
                            <AnimatedSelect
                              value={r[field] ?? ""}
                              onChange={e =>
                                void patch(r, field, e.target.value)
                              }
                              className="w-full"
                            >
                              <option value="">-</option>
                              {OPTIONS[field].map(o => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </AnimatedSelect>
                          </div>
                        ) : (
                          <input
                            type={DATE_FIELDS.has(field) ? "date" : "text"}
                            defaultValue={r[field] ?? ""}
                            onBlur={e => {
                              if (e.target.value !== (r[field] ?? ""))
                                void patch(r, field, e.target.value);
                            }}
                            className={`h-8 w-full rounded-lg border border-transparent bg-transparent px-2 hover:border-input focus:border-input focus:bg-background ${
                              field === "nextFu" &&
                              r.nextFu &&
                              r.nextFu < new Date().toISOString().slice(0, 10)
                                ? "tone-bad"
                                : ""
                            }`}
                          />
                        )}
                      </td>
                    ))}
                    <td className="px-1 pr-3">
                      <button
                        type="button"
                        title="Remove from my list"
                        aria-label="Remove from my list"
                        className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive"
                        onClick={() =>
                          onSave({
                            key: r.key,
                            clientName: r.clientName,
                            type: r.type,
                            hidden: true,
                          }).then(() => toast.success("Removed from your list"))
                        }
                      >
                        <X aria-hidden className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        title="Suggested for your list"
        count={open.length}
        sub="From live data: who has earned the ask and what to ask for. Yours to take or ignore."
        flush
      >
        {open.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground sm:px-6">
            Nothing new to suggest today.
          </p>
        ) : (
          open.map(o => (
            <div
              key={o.key}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 text-sm sm:px-6"
            >
              <div className="min-w-0">
                <span className="font-medium">{o.client?.name}</span>{" "}
                <span className="text-muted-foreground">
                  {o.type} · {humanise(o.why ?? "")}
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onSave({
                    key: o.key,
                    clientName: o.client?.name ?? "",
                    type: o.type ?? "",
                    leadType: "Warm",
                    notes: humanise(o.why ?? ""),
                    contactUrl: o.client?.taskUrl,
                  }).then(() => toast.success("Added to your list"))
                }
              >
                Add to my list
              </Button>
            </div>
          ))
        )}
        {allOpen.length > open.length || showAll ? (
          <div className="px-2 py-2 sm:px-4">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll
                ? "Show fewer"
                : `Show the other ${allOpen.length - open.length}`}
            </Button>
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}

/** A Convex error as the sentence the backend wrote. */
/**
 * The media buyer's changes since the last logged call, or the last two weeks
 * when no call is logged: the newest eight. The card carries 90 days of them
 * (the Client performance page shows any period).
 */
function sinceLastCall(c: Client): Client[] {
  const since = c.lastCall
    ? String(c.lastCall).slice(0, 10)
    : new Date(Date.now() + 3 * 3_600_000 - 14 * 86_400_000)
        .toISOString()
        .slice(0, 10);
  return ((c.changes ?? []) as Client[])
    .filter(ch => String(ch.day) >= since)
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    .slice(0, 8);
}

function kitErrorText(e: unknown): string {
  const data = (e as { data?: { message?: string } })?.data;
  if (data?.message) return data.message;
  return (
    String((e as Error)?.message ?? e)
      .replace(/^[\s\S]*?Uncaught (?:ConvexError|Error): /, "")
      .split("\n")[0]
      .trim() ||
    "The onboarding links could not be read. Try again in a minute."
  );
}

/** The client page's tabs, in the order a CSM reaches for them. */
const CLIENT_TABS = [
  { key: "overview", label: "Overview" },
  { key: "results", label: "Results" },
  { key: "onboarding", label: "Onboarding & files" },
  { key: "money", label: "Money" },
] as const;
type ClientTab = (typeof CLIENT_TABS)[number]["key"];

/**
 * What you do to a client, one panel each. Booking is not here: it is the
 * one "Book a call" button at the top of the page, with the booking link as
 * its second option.
 */
const ACTIONS = [
  { key: "message", label: "Message" },
  { key: "log", label: "Log a call" },
  { key: "update", label: "Update the board" },
  { key: "task", label: "Add a task" },
  { key: "leave", label: "Leave it" },
] as const;
type Panel = (typeof ACTIONS)[number]["key"] | "link";
const PANELS: string[] = [...ACTIONS.map(a => a.key), "link"];

/** The Clients page's views; who needs you today is on Today. */
const VIEWS = [
  { key: "all", label: "All" },
  { key: "onboarding", label: "Onboarding" },
  { key: "live", label: "Live" },
  { key: "results", label: "Results" },
] as const;
type View = (typeof VIEWS)[number]["key"];

/**
 * One client in a list: the dot, the name, where they are, the next step,
 * and the clocks. The whole row opens the client's page.
 */
function ClientRow({
  c,
  today,
  handled,
  kit,
}: {
  c: Client;
  today: string;
  handled: boolean;
  kit?: OnboardingRow | null;
}) {
  const poc = nextPocState(c, today);
  const sm = serviceModel(c.service);
  return (
    <Link
      to={`/clients/${c.taskId}`}
      className={cn(
        "group flex items-start justify-between gap-3 rounded-2xl border bg-card px-4 py-3 transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:px-6 sm:py-4",
        handled ? "opacity-60" : "",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <LevelDot level={c.level} />
          <span className="font-semibold" dir="auto">
            {c.name}
          </span>
          <Chip dot={false}>{displayLabel(c.stage)}</Chip>
          <Chip tone={poc.missing || poc.past ? "bad" : "good"}>
            {poc.label}
          </Chip>
          {sm.code ? null : (
            <Chip tone="warn" title={sm.kpi}>
              {sm.label}
            </Chip>
          )}
          {handled && (
            <span className="inline-flex items-center gap-1 text-xs font-medium txt-good">
              <Check aria-hidden className="size-3.5" />
              Handled today
            </span>
          )}
        </div>
        <div className="mt-1 text-sm" dir="auto">
          {plainText(c.todo)}
        </div>
        {c.bucket === "onboarding" && kit ? <KitSummary kit={kit} /> : null}
        <div className="mt-1 text-xs text-muted-foreground">
          {c.lastPoc
            ? `Last contact ${shortDay(c.lastPoc)}`
            : "Never contacted"}
          {c.lastCall
            ? ` · last call ${shortDay(c.lastCall)}`
            : " · no call logged"}
          {c.liveDays !== undefined ? ` · live ${c.liveDays}d` : ""}
          {c.happiness ? ` · ${displayLabel(c.happiness)}` : ""}
          {sm.code ? ` · ${sm.code}` : ""}
          {c.csmAssigned ? ` · ${c.csmAssigned}` : ""}
        </div>
      </div>
      <ChevronRight
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
      />
    </Link>
  );
}

export function CsmPage({
  section,
  embedded = false,
  clientKey,
}: {
  section: Section;
  /** Inside Money: the page's title becomes a section heading. */
  embedded?: boolean;
  /** The client page's client: a ClickUp id, or a name from a results link. */
  clientKey?: string;
}) {
  const snap = useQuery(api.csm.snapshot, {});
  const toggleCheck = useMutation(api.csm.toggleCheck);
  const act = useMutation(api.csm.act);
  const addPlanItems = useMutation(api.csm.addPlanItems);
  const submitEod = useMutation(api.csm.submitEod);
  const setClientLanguage = useMutation(api.csm.setClientLanguage);
  const saveHotRow = useMutation(api.csm.saveHotRow);
  const clearLooseEnds = useMutation(api.csm.clearLooseEnds);
  const saveMoneyGoals = useMutation(api.csm.saveMoneyGoals);
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();

  /** Her saved choice wins; the client's own name is only the fallback guess. */
  const langOf = (c: Client): Lang => {
    const saved = (snap?.prefs ?? []).find(
      (p: { clientName: string }) => p.clientName === c.name,
    )?.language;
    return saved === "ar" || saved === "en" ? saved : guessLang(c.name);
  };

  /**
   * The client page's client: by ClickUp id, or by name when a link from the
   * results list carried the name. undefined while the list loads, null when
   * the client is not on this CSM's list.
   */
  const clientRow: Client | null | undefined = useMemo(() => {
    if (section !== "client" || !clientKey) return null;
    if (!snap) return undefined;
    const list: Client[] = snap.clients ?? [];
    return (
      list.find(c => String(c.taskId) === clientKey) ??
      list.find(c => fold(String(c.name)) === fold(clientKey)) ??
      null
    );
  }, [section, clientKey, snap]);
  // One address per client: a name in the address becomes the ClickUp id.
  useEffect(() => {
    if (clientRow && clientKey !== String(clientRow.taskId))
      navigate(
        { pathname: `/clients/${clientRow.taskId}`, search: location.search },
        { replace: true },
      );
  }, [clientRow, clientKey, location.search, navigate]);
  // The Hermes chat answers about the client on screen.
  const openName = clientRow ? String(clientRow.name) : null;
  useEffect(() => {
    publishOpenClient(openName);
    return () => publishOpenClient(null);
  }, [openName]);
  /** The client's profile: their links in the header (the tabs read it too). */
  const profile = useQuery(
    api.csm.clientProfile,
    clientRow ? { clientName: String(clientRow.name) } : "skip",
  );

  // The client page's tab, period and open panel live in the address, so a
  // refresh, the Back button or a shared link lands on the same view.
  const tabParam = params.get("tab");
  const clientTab: ClientTab = CLIENT_TABS.some(t => t.key === tabParam)
    ? (tabParam as ClientTab)
    : "overview";
  const period = params.get("period") ?? "month";
  const actParam = params.get("act");
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    // A tab or a period is a new view: the search box's action is done.
    if (key !== "act") next.delete("act");
    setParams(next, { replace: true });
  };
  const [panel, setPanel] = useState<Panel | null>(null);
  // The search box's "Message", "Log a call"… arrive with that panel open.
  useEffect(() => {
    if (actParam && PANELS.includes(actParam)) setPanel(actParam as Panel);
  }, [actParam]);
  const togglePanel = (p: Panel) => setPanel(v => (v === p ? null : p));

  const viewParam = params.get("view");
  const view: View = VIEWS.some(v => v.key === viewParam)
    ? (viewParam as View)
    : "all";
  const [find, setFind] = useState("");

  const [ticket, setTicket] = useState(TICKETS[0].label);
  const [ticketNote, setTicketNote] = useState("");
  const [reason, setReason] = useState(REASONS[0]);
  const [clock, setClock] = useState(CLOCKS[1]);
  const [note, setNote] = useState("");
  const [dump, setDump] = useState("");
  // 1 to 10, because the EOD sheet has always been scored out of 10.
  const [energy, setEnergy] = useState("7");
  const [stress, setStress] = useState("4");
  // The rest of the Account Manager EOD Typeform, so this replaces it column for column.
  const [callSummary, setCallSummary] = useState("");
  const [expectations, setExpectations] = useState("");
  const [touchpoints, setTouchpoints] = useState("Y");
  const [fathom, setFathom] = useState("Y");
  const [newSignups, setNewSignups] = useState("N");
  const [upsells, setUpsells] = useState("N");
  const [reviews, setReviews] = useState("N");
  const [referrals, setReferrals] = useState("N");
  const [lost, setLost] = useState("");
  const [onePercent, setOnePercent] = useState("");
  const [rollup, setRollup] = useState("");
  // The churn ledger. One line per client, typed once, at the end of the day.
  const [offboarded, setOffboarded] = useState("");
  const [extended, setExtended] = useState("");
  const [pausedToday, setPausedToday] = useState("");
  // Income plan. Local overrides win over the saved row until he saves again.
  const [targetEdit, setTargetEdit] = useState<string | null>(null);
  const [clientsEdit, setClientsEdit] = useState<string | null>(null);
  const [countEdits, setCountEdits] = useState<Counts>({});

  const done = useMemo(
    () =>
      new Set(
        (snap?.decisions ?? []).map((d: { subject: string }) => d.subject),
      ),
    [snap],
  );

  // The onboarding clients' links and forms (cockpit_client_onboarding):
  // every onboarding client on Today and Clients, for the forms' line on
  // their row, or the one client on their page. Read on arrival and every
  // three minutes; Refresh reads one card now.
  const loadKits = useAction(api.onboarding.kits);
  const refreshKits = useAction(api.onboarding.refresh);
  const [kitPage, setKitPage] = useState<KitsPage | null>(null);
  const [kitLoadedFor, setKitLoadedFor] = useState("");
  const [kitError, setKitError] = useState<string | null>(null);
  const [kitRefreshing, setKitRefreshing] = useState<string | null>(null);
  const kitKey = useMemo(() => {
    if (section === "client") return clientRow ? String(clientRow.taskId) : "";
    const list: Client[] = snap?.clients ?? [];
    return list
      .filter(c => c.bucket === "onboarding")
      .map(c => String(c.taskId))
      .sort()
      .join(",");
  }, [snap, section, clientRow]);
  const kitsWanted =
    section === "today" || section === "clients" || section === "client";
  useEffect(() => {
    if (!kitsWanted || !kitKey) return;
    let live = true;
    const load = () =>
      loadKits({ taskIds: kitKey.split(",") })
        .then(p => {
          if (!live) return;
          setKitPage(p as KitsPage);
          setKitLoadedFor(kitKey);
          setKitError(null);
        })
        .catch(e => live && setKitError(kitErrorText(e)));
    void load();
    const timer = setInterval(load, 180_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [kitsWanted, kitKey, loadKits]);
  const kitOf = (c: Client) => {
    const id = String(c.taskId);
    if (!kitLoadedFor.split(",").includes(id)) return undefined;
    return kitPage?.rows.find(r => r.clickup_task_id === id) ?? null;
  };
  const refreshKit = async (taskId: string) => {
    setKitRefreshing(taskId);
    try {
      const ids = kitKey ? kitKey.split(",") : [];
      if (!ids.includes(taskId)) ids.push(taskId);
      const p = (await refreshKits({ taskId, taskIds: ids })) as KitsPage;
      setKitPage(p);
      setKitLoadedFor(ids.sort().join(","));
      setKitError(null);
      if (p.problem) toast.error(p.problem);
      else toast.success("Read again from ClickUp and Typeform");
    } catch (e) {
      setKitError(kitErrorText(e));
      toast.error(kitErrorText(e));
    } finally {
      setKitRefreshing(null);
    }
  };

  const wrap = embedded ? "space-y-6" : "mx-auto w-full max-w-6xl space-y-6";
  if (snap === undefined) {
    return (
      <div className={cn(wrap, "text-sm text-muted-foreground")}>
        {section === "client" ? "Loading the client…" : "Loading your clients…"}
      </div>
    );
  }

  // biome-ignore lint/suspicious/noExplicitAny: decision rows
  const ds: any[] = snap.decisions ?? [];
  // A call is a call logged ("Held a call"), not a booking that mentions one.
  const callsToday = ds.filter(d => /^held a call/i.test(d.action)).length;
  const clientsHandled = new Set(ds.map(d => d.subject)).size;
  const signupsToday = ds.filter(d =>
    /signup|welcome|onboarding/i.test(d.action),
  ).length;
  const hotToday = ds.filter(d =>
    /upsell|referral|review/i.test(d.action),
  ).length;
  const ticketsToday = ds.filter(d => d.kind === "rerouted").length;
  const clients: Client[] = snap.clients;
  // Who needs you = the combined priority list across both motions.
  const needsAction = (c: Client) => c.rank < 40 && c.level !== "green";
  const todayList = clients.filter(needsAction);
  const managementList = clients.filter(c => c.bucket === "management");
  const onboardingList = clients.filter(c => c.bucket === "onboarding");
  /**
   * Opportunities, not clients: one client can owe a review and an upsell. Deliberately
   * NOT a useMemo — this sits after the loading early-return, and a hook below an early
   * return changes the hook count between renders (React error #310).
   */
  const hotRows = rankOpportunities(
    clients
      // Churned clients are never an upsell, a review or a referral. Keep them out.
      .filter((c: Client) => !c.hotBlocked && !isChurned(c))
      .flatMap((c: Client) => opportunitiesFor(c)),
  );
  const looseList = clients.filter(c => c.loose.length > 0);
  const ticketRows = ds.filter(d => d.kind === "rerouted");
  // A commitment counts as outstanding until the CSM turns it into a task or says done.
  const handledText = new Set(ds.map(d => d.action));
  const commitmentRows = clients.flatMap((c: Client) =>
    (c.commitments ?? [])
      .filter(
        (item: { text: string }) =>
          !handledText.has(`Commitment handled: ${item.text}`),
      )
      .map((item: { text: string; source: string }) => ({ client: c, item })),
  );
  /**
   * The day's numbers, counted from the list on the page: the board-wide
   * totals counted every client, which is wrong once there are two CSMs, and
   * the hot list follows the Hot list tab's own rule.
   */
  const t = {
    dueToday: todayList.length,
    newSignups: clients.filter(c => c.newSignup).length,
    pastDue: clients.filter(c => (c.paymentDue ?? -99) >= 1).length,
    onboarding: onboardingList.length,
    managed: managementList.length,
    hot: hotRows.length,
    loose: looseList.reduce((n, c) => n + c.loose.length, 0),
  };

  const run = async (
    c: Client,
    action: string,
    kind: string,
    extra: Record<string, unknown> = {},
  ) => {
    try {
      // The ClickUp id survives the sync replacing every row; the document id may not.
      await act({
        clientId: c._id as Id<"clients">,
        taskId: c.taskId,
        action,
        kind,
        ...extra,
      });
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
      return;
    }
    setNote("");
    setTicketNote("");
    // The message panel stays open: it asks for the next call once logged.
    if (panel !== "message" && panel !== "update") setPanel(null);
    toast.success(
      kind === "ticket"
        ? "Ticket created on the right board"
        : kind === "left"
          ? "Left, with a reason logged"
          : "Logged to ClickUp",
    );
  };

  const submitPlan = async () => {
    const items = dump
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean)
      .map(text => ({ text }));
    if (!items.length) return;
    await addPlanItems({ items });
    setDump("");
    toast.success(
      `${items.length} task${items.length > 1 ? "s" : ""} created for tomorrow`,
    );
  };

  const row = (c: Client) => (
    <ClientRow
      key={c.taskId}
      c={c}
      today={snap.day}
      handled={done.has(c.name)}
      kit={kitOf(c)}
    />
  );

  /** One call's commitments: make them tasks, or close them as done. */
  const commitmentsBlock = (rows: typeof commitmentRows, withClient: boolean) =>
    [
      ...new Map(
        rows.map(r => [`${r.client.taskId}|${r.item.source}`, r]),
      ).values(),
    ].map(({ client, item }) => {
      const call = item.source;
      const items = rows
        .filter(
          r => r.client.taskId === client.taskId && r.item.source === call,
        )
        .map(r => r.item);
      const when = call.replace("1-1 call notes, ", "");
      return (
        <ChecklistItem
          key={`${client.taskId}-${call}`}
          title={
            withClient
              ? `${client.name}, your call on ${shortDay(when)}`
              : `Your call on ${shortDay(when)}`
          }
          why={`${plural(items.length, "thing")} you said you would do. Anything another team has to do goes to them with "Add a task" on the client's page.`}
          action={
            <div className="space-y-3">
              <ul className="ml-4 list-disc space-y-1 text-sm text-foreground">
                {items.map(i => (
                  <li key={i.text} dir="auto">
                    {i.text}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={() =>
                    addPlanItems({
                      items: items.map(i => ({
                        text: i.text,
                        clientName: client.name,
                      })),
                    }).then(() =>
                      toast.success(
                        `${items.length} task${items.length === 1 ? "" : "s"} created on Client Success`,
                      ),
                    )
                  }
                >
                  Create {items.length === 1 ? "the task" : "the tasks"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    // Closing a commitment is not contact with the client:
                    // "commitment" leaves Last POC and the silence clock alone
                    // (it used to log a touchpoint; the simplification audit,
                    // 2026-10-06). The ClickUp card still gets the note.
                    for (const i of items)
                      await run(
                        client,
                        `Commitment handled: ${i.text}`,
                        "commitment",
                        { note: i.source },
                      );
                  }}
                >
                  All done already
                </Button>
                <Link
                  to={`/clients/${client.taskId}?act=task`}
                  className="text-xs text-primary underline-offset-4 hover:underline"
                >
                  Ask a team
                </Link>
              </div>
            </div>
          }
        />
      );
    });

  /** The client's page: everything about one client, in one place. */
  const clientPage = (c: Client) => {
    const poc = nextPocState(c, snap.day);
    const sm = serviceModel(c.service);
    const cad = cadence(c);
    const spineDay = spineFor(c).dayIndex;
    const handled = done.has(c.name);
    // The next client on Today's list, so the list can be worked from here.
    const at = todayList.findIndex(x => x.taskId === c.taskId);
    const nextUp = todayList.find(
      (x, i) => i > at && x.taskId !== c.taskId && !done.has(x.name),
    );
    const links: Record<string, string> = {
      ...(c.sheetLink ? { sheet: String(c.sheetLink) } : {}),
      ...(c.taskUrl ? { clickup: String(c.taskUrl) } : {}),
      ...((profile?.links ?? {}) as Record<string, string>),
    };
    const mine = commitmentRows.filter(r => r.client.taskId === c.taskId);
    const changes = sinceLastCall(c);
    const nc = nextCall(c, langOf(c));
    const reportUrl: string | undefined = (
      (profile?.reports ?? []) as { builtAt?: number; docUrl?: string }[]
    ).find(r => r.builtAt && r.docUrl)?.docUrl;
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <Link
            to="/clients"
            className="inline-flex items-center gap-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            <ArrowLeft aria-hidden className="size-4" />
            All clients
          </Link>
          {nextUp ? (
            <Link
              to={`/clients/${nextUp.taskId}`}
              className="inline-flex min-w-0 items-center gap-1 text-primary underline-offset-4 hover:underline"
            >
              <span className="truncate">
                Next who needs you: {nextUp.name}
              </span>
              <ChevronRight aria-hidden className="size-4 shrink-0" />
            </Link>
          ) : null}
        </div>

        <header className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <LevelDot level={c.level} />
              <h1
                className="text-2xl font-semibold tracking-tight sm:text-[28px] sm:leading-9"
                dir="auto"
              >
                {c.name}
              </h1>
              <Chip dot={false}>{displayLabel(c.stage)}</Chip>
              <Chip tone={poc.missing || poc.past ? "bad" : "good"}>
                {poc.label}
              </Chip>
              {sm.code ? (
                <Chip dot={false} title={sm.kpi}>
                  {sm.code}
                </Chip>
              ) : (
                <Chip tone="warn" title={sm.kpi}>
                  {sm.label}
                </Chip>
              )}
              {handled ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium txt-good">
                  <Check aria-hidden className="size-3.5" />
                  Handled today
                </span>
              ) : null}
            </div>
            <ReportIssue page={`client: ${c.name}`} />
          </div>
          <p className="text-[15px] leading-6" dir="auto">
            {plainText(c.todo)}
          </p>
          <p className="text-xs text-muted-foreground">
            {cad.stage}, messages {cad.label}
            {spineDay != null ? ` · onboarding day ${spineDay} of 14` : ""}
            {c.liveDays !== undefined ? ` · live ${c.liveDays} days` : ""}
            {c.happiness ? ` · ${displayLabel(c.happiness)}` : ""}
            {c.csmAssigned ? ` · ${c.csmAssigned}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            <span className={cad.messageOverdue ? "font-semibold txt-bad" : ""}>
              Last message{" "}
              {c.lastPoc
                ? `${shortDay(c.lastPoc)} (${c.silentDays}d ago)`
                : "never"}
              {cad.daysLate > 0 ? `, ${cad.daysLate}d late` : ""}
            </span>
            {" · "}
            <span className={cad.callOverdue ? "font-semibold txt-bad" : ""}>
              last call {c.lastCall ? shortDay(c.lastCall) : "never"} (
              {cad.callLabel}){cad.callOverdue ? ", due" : ""}
            </span>
            {" · 1-1 notes "}
            {c.lastNoteOn ? shortDay(c.lastNoteOn) : "none"}
            {sm.dwy ? "" : " · report "}
            {!sm.dwy && (
              <span className={c.reportDue ? "font-semibold txt-bad" : ""}>
                {c.reportTracked === false
                  ? "not tracked yet"
                  : c.lastReport
                    ? `${shortDay(c.lastReport)} (${c.reportDays}d ago)`
                    : "never sent"}
              </span>
            )}
          </p>
          {/* One links row, one name per link, the same names as Results. */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-sm">
            {LINK_LABELS.filter(l => links[l.key]).map(l => (
              <ExtLink key={l.key} href={links[l.key]}>
                {l.label}
              </ExtLink>
            ))}
          </div>
        </header>

        <ClientCheckIn
          taskId={String(c.taskId)}
          clientName={String(c.name)}
          nextCallAt={c.nextCallAt}
          stage={c.stage}
          autoOpen={actParam === "book"}
          extra={
            <Button
              variant="outline"
              aria-expanded={panel === "link"}
              onClick={() => togglePanel("link")}
            >
              Or send the booking link
            </Button>
          }
        />

        <section aria-label="Actions" className="space-y-3">
          {/* Things you do, so they look like buttons; each opens its panel. */}
          <div className="flex flex-wrap gap-2">
            {ACTIONS.map(a => (
              <Button
                key={a.key}
                size="sm"
                variant={panel === a.key ? "secondary" : "outline"}
                aria-expanded={panel === a.key}
                onClick={() => togglePanel(a.key)}
              >
                {a.label}
              </Button>
            ))}
          </div>

          {panel === "message" && (
            <div className="rounded-2xl border bg-card p-4 sm:p-6">
              <TemplatePicker
                // The monthly report message links the report itself, the
                // newest Google Doc written for them, never the tracking sheet.
                c={{ ...c, reportUrl }}
                today={snap.day}
                lang={langOf(c)}
                onLang={l =>
                  void setClientLanguage({ clientName: c.name, language: l })
                }
                onLog={run}
              />
            </div>
          )}

          {panel === "log" && (
            <div className="space-y-3 rounded-2xl border bg-card p-4 sm:p-6">
              <Textarea
                placeholder="Call summary or what you said to them (optional, goes on the ClickUp card)"
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={3}
                dir="auto"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => run(c, "Held a call", "call", { note })}
                >
                  Log the call and summary
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    run(c, "Messaged the client", "touchpoint", { note })
                  }
                >
                  Log a message
                </Button>
                <BookDate
                  c={c}
                  today={snap.day}
                  label="Book the next touchpoint"
                  onBook={d =>
                    run(c, `Booked the next touchpoint for ${d}`, "booked", {
                      value: d,
                    })
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground">
                The call summary form is still the record of the call:{" "}
                <ExtLink href={LINKS.callSummaryForm}>
                  1-1 call summary form
                </ExtLink>
                .
              </p>
            </div>
          )}

          {panel === "link" && (
            <div className="space-y-3 rounded-2xl border bg-card p-4 text-sm sm:p-6">
              <h2 className="text-[15px] font-semibold">
                Send the booking link
              </h2>
              <p className="text-xs text-muted-foreground">
                Next in the journey: <strong>{nc.label}</strong>. {nc.doNow}
              </p>
              <p className="text-xs text-muted-foreground">
                "Book a call" above books it straight into HighLevel at a free
                time. This is the other way: send them the link and they pick.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {nc.url ? (
                  <>
                    <Button size="sm" variant="outline" asChild>
                      <a href={nc.url} target="_blank" rel="noreferrer">
                        Open the booking link
                        <ArrowUpRight aria-hidden />
                      </a>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(nc.url);
                        toast.success("Booking link copied");
                      }}
                    >
                      Copy the link
                    </Button>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {nc.label}, no link needed.
                  </span>
                )}
                {nc.framework ? (
                  <ExtLink href={nc.framework} className="text-xs">
                    Call framework
                  </ExtLink>
                ) : null}
              </div>
              <Textarea
                rows={4}
                defaultValue={nc.message}
                id={`msg-${c.taskId}`}
                dir="auto"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const el = document.getElementById(
                      `msg-${c.taskId}`,
                    ) as HTMLTextAreaElement | null;
                    navigator.clipboard.writeText(el?.value ?? nc.message);
                    toast.success("Message copied, send it from WhatsApp");
                  }}
                >
                  Copy the message
                </Button>
                <BookDate
                  c={c}
                  today={snap.day}
                  label="They booked, log the date"
                  onBook={d =>
                    run(c, `Booked ${nc.label} for ${d}`, "booked", {
                      value: d,
                      note: nc.url
                        ? `Sent the booking link (${nc.url}).`
                        : `${nc.label} booked.`,
                    })
                  }
                />
                {nc.url ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      run(
                        c,
                        `Sent the ${nc.label} booking link`,
                        "touchpoint",
                        { note: `Booking link sent: ${nc.url}` },
                      )
                    }
                  >
                    Sent it, not booked yet
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                The cockpit drafts, you send. Nothing goes to the client from
                here.
              </p>
            </div>
          )}

          {panel === "update" && (
            <div className="space-y-4 rounded-2xl border bg-card p-4 text-sm sm:p-6">
              <div>
                <div className="text-xs text-muted-foreground">
                  Client status, as on the ClickUp board
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {STAGES.map(s => (
                    <Pill
                      key={s}
                      active={s === c.stage}
                      onClick={() =>
                        run(c, `Moved to ${s}`, "stage", { value: s })
                      }
                    >
                      {displayLabel(s)}
                    </Pill>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  Service model, what we owe them
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {(["DFY", "DWY"] as const).map(v => (
                    <Pill
                      key={v}
                      active={sm.code === v}
                      onClick={() =>
                        run(c, `Service model set to ${v}`, "service", {
                          value: v,
                        })
                      }
                    >
                      {v}
                    </Pill>
                  ))}
                  <span className="ml-1 text-xs text-muted-foreground">
                    {sm.kpi}
                  </span>
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  Client happiness
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {HAPPINESS.map(h => (
                    <Pill
                      key={h}
                      active={h === c.happiness}
                      onClick={() =>
                        run(c, `Happiness set to ${h}`, "happiness", {
                          value: h,
                        })
                      }
                    >
                      {displayLabel(h)}
                    </Pill>
                  ))}
                </div>
              </div>
            </div>
          )}

          {panel === "task" && (
            <div className="space-y-6 rounded-2xl border bg-card p-4 text-sm sm:p-6">
              <div className="space-y-3">
                <h2 className="text-[15px] font-semibold">Ask a team</h2>
                <AnimatedSelect
                  className="w-full"
                  value={ticket}
                  onChange={e => setTicket(e.target.value)}
                >
                  {TICKETS.map(r => (
                    <option key={r.label} value={r.label}>
                      {r.label} ({r.deptLabel})
                    </option>
                  ))}
                </AnimatedSelect>
                <Textarea
                  placeholder="What exactly is needed?"
                  value={ticketNote}
                  onChange={e => setTicketNote(e.target.value)}
                  rows={2}
                  dir="auto"
                />
                <Button
                  size="sm"
                  onClick={() => {
                    const hit = TICKETS.find(r => r.label === ticket);
                    if (!hit) return;
                    run(c, hit.label, "ticket", {
                      department: hit.dept,
                      note: ticketNote,
                    });
                  }}
                >
                  Create the ticket for{" "}
                  {TICKETS.find(r => r.label === ticket)?.deptLabel}
                </Button>
              </div>
              <div className="space-y-3 border-t pt-5">
                <h2 className="text-[15px] font-semibold">
                  Anything else, for you or a team
                </h2>
                <AddTask
                  taskId={String(c.taskId)}
                  clientName={String(c.name)}
                  inline
                />
              </div>
              <div className="space-y-2 border-t pt-5">
                <h2 className="text-[15px] font-semibold">
                  Something for the client to do
                </h2>
                <p className="text-xs text-muted-foreground">
                  It shows in their Mahara OS portal with a due reminder.
                </p>
                <PortalTasksButton
                  taskId={String(c.taskId)}
                  clientName={String(c.name)}
                />
              </div>
            </div>
          )}

          {panel === "leave" && (
            <div className="space-y-3 rounded-2xl border bg-card p-4 text-sm sm:p-6">
              <AnimatedSelect
                className="w-full"
                value={reason}
                onChange={e => setReason(e.target.value)}
              >
                {REASONS.map(r => (
                  <option key={r}>{r}</option>
                ))}
              </AnimatedSelect>
              <div className="flex flex-wrap gap-1">
                {CLOCKS.map(k => (
                  <Pill
                    key={k}
                    active={k === clock}
                    onClick={() => setClock(k)}
                  >
                    {k}
                  </Pill>
                ))}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  run(c, "Left as is", "left", { reason, snooze: clock })
                }
              >
                Leave it, show me {clock.toLowerCase()}
              </Button>
            </div>
          )}
        </section>

        <nav
          aria-label="About this client"
          className="flex gap-1 overflow-x-auto border-b"
        >
          {CLIENT_TABS.map(tb => (
            <button
              key={tb.key}
              type="button"
              aria-current={clientTab === tb.key ? "page" : undefined}
              onClick={() => setParam("tab", tb.key)}
              className={cn(
                "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                clientTab === tb.key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tb.label}
            </button>
          ))}
        </nav>

        {clientTab === "overview" && (
          <ClientProfile
            name={String(c.name)}
            part="overview"
            embedded
            period={period}
            onPeriod={k => setParam("period", k)}
            afterPrep={
              <>
                <SectionCard
                  title="What the media buyer changed since your last call"
                  count={changes.length}
                  sub={
                    <>
                      Since{" "}
                      {c.lastCall
                        ? `your call on ${shortDay(c.lastCall)}`
                        : "two weeks ago, no call is logged"}
                      .{" "}
                      <button
                        type="button"
                        className="text-primary underline-offset-4 hover:underline"
                        onClick={() => setParam("tab", "results")}
                      >
                        Any period on Results
                      </button>
                    </>
                  }
                  flush
                >
                  {changes.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-muted-foreground sm:px-6">
                      No campaign changes since then.
                    </p>
                  ) : (
                    changes.map(
                      (
                        ch: { action: string; day: string; evidence: string },
                        i: number,
                      ) => (
                        <div
                          key={`${ch.day}-${i}`}
                          className="px-4 py-3 text-sm sm:px-6"
                        >
                          <span className="font-medium">
                            {shortDay(ch.day)}
                          </span>
                          , {ch.action}
                          {ch.evidence ? (
                            <span className="text-muted-foreground">
                              . {ch.evidence}
                            </span>
                          ) : null}
                        </div>
                      ),
                    )
                  )}
                </SectionCard>
                {mine.length ? (
                  <SectionCard
                    title="What you said you would do"
                    count={mine.length}
                    sub="From your 1-1 call notes. Make each one a task, or close it."
                    flush
                  >
                    {commitmentsBlock(mine, false)}
                  </SectionCard>
                ) : null}
                {c.loose.length ? (
                  <SectionCard title="Loose ends" count={c.loose.length} flush>
                    {c.loose.map((l: string) => (
                      <div key={l} className="px-4 py-3 text-sm sm:px-6">
                        {plainText(l)}
                      </div>
                    ))}
                  </SectionCard>
                ) : null}
              </>
            }
          />
        )}

        {clientTab === "results" && (
          <ClientProfile
            name={String(c.name)}
            part="results"
            embedded
            period={period}
            onPeriod={k => setParam("period", k)}
          />
        )}

        {clientTab === "onboarding" && (
          <div className="space-y-6">
            <OnboardingKit
              client={c}
              kit={kitOf(c)}
              page={kitPage}
              error={kitError}
              refreshing={kitRefreshing === String(c.taskId)}
              onRefresh={() => void refreshKit(String(c.taskId))}
            />
            <section className="space-y-3">
              <h2 className="text-[15px] font-semibold">Their links</h2>
              <ClientLinks links={links} />
            </section>
          </div>
        )}

        {clientTab === "money" && (
          <div className="space-y-6">
            <SectionCard title="Billing">
              <div className="space-y-3 text-sm">
                <p>
                  {(c.paymentDue ?? -99) >= 1 ? (
                    <span className="font-medium txt-bad">
                      Invoice {c.paymentDue} day
                      {c.paymentDue === 1 ? "" : "s"} past due.
                    </span>
                  ) : c.paymentDate ? (
                    <>Next payment {shortDay(c.paymentDate)}.</>
                  ) : (
                    <span className="text-muted-foreground">
                      No payment date on their card.
                    </span>
                  )}
                  {c.pauseRequired ? (
                    <span className="txt-bad">
                      {" "}
                      The billing SOP says pause: 3 or more days late with no
                      extension logged.
                    </span>
                  ) : null}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/money?tab=billing">Open billing</Link>
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <Link to={`/money?tab=projections&client=${c.taskId}`}>
                      Plan the renewal
                    </Link>
                  </Button>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Hot list"
              sub="One upsell, referral or review conversation per client a month."
            >
              {isChurned(c) ? (
                <p className="text-sm text-muted-foreground">
                  A client who has left is never an upsell, a review or a
                  referral.
                </p>
              ) : c.hotBlocked ? (
                <p className="text-sm text-muted-foreground">
                  This month's conversation is logged. The next one opens on the
                  1st.
                </p>
              ) : c.hot.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing on the hot list for them yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {c.hot.map((h: { kind: string; why: string }) => (
                    <div
                      key={h.kind}
                      className="flex flex-wrap items-center justify-between gap-2 text-sm"
                    >
                      <span className="min-w-0">
                        <strong>{h.kind}</strong>, {h.why}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          run(c, `${h.kind} conversation had`, "upsell", {
                            note: h.why,
                          })
                        }
                      >
                        Log the conversation
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <Link
                to="/money?tab=hot"
                className="mt-3 inline-block text-xs text-primary underline-offset-4 hover:underline"
              >
                Open the hot list
              </Link>
            </SectionCard>

            <SectionCard
              title="Changing their plan"
              sub="Pause, extend, reactivate or end. One form per change, after a call."
              flush
            >
              {(
                LINK_GROUPS.find(g => /changing a client/i.test(g.title))
                  ?.rows ?? []
              ).map(r => (
                <div
                  key={r.url + r.label}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-3 sm:px-6"
                >
                  <ExtLink href={r.url} className="text-sm font-medium">
                    {r.label}
                  </ExtLink>
                  {r.note ? (
                    <span className="text-xs text-muted-foreground">
                      {r.note}
                    </span>
                  ) : null}
                </div>
              ))}
              <div className="px-4 py-3 sm:px-6">
                <Link
                  to="/money?tab=churn"
                  className="text-sm text-primary underline-offset-4 hover:underline"
                >
                  They left: log the departure on Churn
                </Link>
              </div>
            </SectionCard>
          </div>
        )}
      </div>
    );
  };

  const TITLE: Record<Section, string> = {
    today: "Today",
    clients: "Clients",
    client: "Client",
    hot: "Hot list",
    links: "Key links",
    money: "My money",
    eod: "End of day",
  };
  const todayLine = (
    <>
      {new Date().toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })}{" "}
      ·{" "}
      {snap.lastSyncAt
        ? `synced ${new Date(snap.lastSyncAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
        : "not yet synced"}
      {section === "today" ? " · clients on WhatsApp, team on Slack" : ""}
    </>
  );
  const findList = (list: Client[]) =>
    find.trim() ? list.filter(c => matchScore(String(c.name), find) > 0) : list;
  const viewList =
    view === "onboarding"
      ? onboardingList
      : view === "live"
        ? managementList
        : clients;

  return (
    <div className={wrap}>
      {section === "client" ? null : (
        <PageHeader
          as={embedded ? "h2" : "h1"}
          title={TITLE[section]}
          sub={
            section === "clients"
              ? "Every client you look after. Open one for everything about them."
              : todayLine
          }
          actions={
            <>
              {section === "today" ? (
                <Button size="sm" variant="outline" asChild>
                  <Link to="/eod">
                    <MoonStar aria-hidden />
                    End of day
                  </Link>
                </Button>
              ) : null}
              {embedded ? null : <ReportIssue page={section} />}
            </>
          }
        />
      )}

      {section === "today" && <SyncStrip only="feed" />}

      {section === "today" && (
        <p className="text-[15px] leading-6">
          {t.dueToday === 0
            ? "Nothing is waiting on you. Use the time on the hot list."
            : `${t.dueToday} ${t.dueToday === 1 ? "client needs" : "clients need"} a message or a call today. Start with the first one below.`}
          {t.pastDue > 0
            ? ` ${t.pastDue} ${t.pastDue === 1 ? "invoice is" : "invoices are"} past due.`
            : ""}
        </p>
      )}

      {section === "today" && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            <StatTile
              label="Need you today"
              value={t.dueToday}
              // Work waiting is something to watch, not something gone wrong.
              tone={t.dueToday ? "txt-warn" : "txt-good"}
            />
            <StatTile
              label="New signups"
              value={t.newSignups}
              tone={t.newSignups ? "txt-good" : undefined}
            />
            <StatTile
              label="Invoices past due"
              value={t.pastDue}
              tone={t.pastDue ? "txt-bad" : undefined}
            />
          </div>
          <details className="text-sm">
            <summary className="text-muted-foreground">
              The rest of the numbers
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
              <StatTile label="In onboarding" value={t.onboarding} />
              <StatTile label="Managed clients" value={t.managed} />
              <StatTile
                label="Hot list"
                value={t.hot}
                tone={t.hot ? "txt-good" : undefined}
              />
              <StatTile label="Loose ends" value={t.loose} />
            </div>
          </details>
        </div>
      )}

      {section === "today" && <TodaysCalls snap={snap} />}

      {section === "today" && (
        <section id="who-needs-you" className="space-y-8">
          <ShortList
            title="Onboarding, get them live"
            items={onboardingList.filter(needsAction)}
            render={row}
            empty="Every onboarding client has been dealt with today."
          />
          <ShortList
            title="Management, keep them alive"
            items={managementList.filter(needsAction)}
            render={row}
            empty="Every managed client has been dealt with today."
          />
        </section>
      )}

      {section === "today" && (
        <div className="space-y-6">
          <SectionCard
            title="Commitments from calls"
            count={commitmentRows.length}
            sub="Pulled from the 1-1 call notes form. Each one becomes a real task, or you close it."
            flush
          >
            {commitmentRows.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground sm:px-6">
                Nothing outstanding from the last round of calls.
              </p>
            ) : (
              // One row per CALL, not per line. A call is one conversation: here is what
              // was said, and here are the tasks that come out of it.
              commitmentsBlock(commitmentRows, true)
            )}
          </SectionCard>

          <SectionCard
            title="Tickets raised today"
            count={ticketRows.length}
            sub="Verified against ClickUp: a ticket only counts once it exists on the other team's board."
            flush
          >
            {ticketRows.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground sm:px-6">
                No tickets raised today.
              </p>
            ) : (
              ticketRows.map(
                (d: {
                  _id: string;
                  subject: string;
                  action: string;
                  reroutedTo?: string;
                  clickupTaskUrl?: string;
                  logError?: string;
                }) => (
                  <ChecklistItem
                    key={d._id}
                    title={`${d.subject}, ${d.action}`}
                    meta={
                      <>
                        <span className="text-xs text-muted-foreground">
                          to {d.reroutedTo ?? "an unknown team"}
                        </span>
                        <Chip
                          tone={
                            d.clickupTaskUrl
                              ? "good"
                              : d.logError
                                ? "bad"
                                : "neutral"
                          }
                        >
                          {d.clickupTaskUrl
                            ? "Landed"
                            : d.logError
                              ? "Failed"
                              : "Sending"}
                        </Chip>
                      </>
                    }
                    why={
                      d.clickupTaskUrl
                        ? `Created on the ${d.reroutedTo} board.`
                        : d.logError
                          ? `ClickUp rejected it: ${d.logError}. Raise it again.`
                          : "Still being created, refresh in a moment."
                    }
                    action={
                      d.clickupTaskUrl ? (
                        <ExtLink href={d.clickupTaskUrl}>
                          Open it in ClickUp
                        </ExtLink>
                      ) : undefined
                    }
                  />
                ),
              )
            )}
          </SectionCard>

          <SectionCard
            title="Loose ends"
            count={t.loose}
            sub="What the board says nobody closed. Anything about money stays; the rest can be written off in one go, and who cleared it is recorded."
            action={
              looseList.length ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    clearLooseEnds({}).then(r =>
                      toast.success(
                        `Cleared ${r.cleared}, kept ${r.kept} money ones`,
                      ),
                    )
                  }
                >
                  Clear these (money stays)
                </Button>
              ) : undefined
            }
            flush
          >
            {looseList.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground sm:px-6">
                Nothing loose. This is what a clean board looks like.
              </p>
            ) : (
              <Capped
                items={looseList.flatMap((c: Client) =>
                  c.loose.map((l: string, i: number) => (
                    <ChecklistItem
                      key={`${c.taskId}-loose-${i}`}
                      title={`${c.name}, ${plainText(l)}`}
                      why={`${displayLabel(c.stage)}. ${plainText(c.todo)}. Clear it before 18:00 or it shows in your EOD.`}
                      action={
                        <div className="flex flex-wrap gap-x-4 gap-y-2">
                          <Link
                            to={`/clients/${c.taskId}`}
                            className="text-primary underline-offset-4 hover:underline"
                          >
                            Open the client
                          </Link>
                          {c.taskUrl ? (
                            <ExtLink href={c.taskUrl}>ClickUp card</ExtLink>
                          ) : null}
                        </div>
                      }
                    />
                  )),
                )}
              />
            )}
          </SectionCard>

          <SectionCard
            title="Client Success board"
            count={snap.tasks.length}
            sub="Due, overdue or undated, in ClickUp."
            flush
          >
            {snap.tasks.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground sm:px-6">
                Nothing due on the board.
              </p>
            ) : (
              <Capped
                limit={20}
                items={snap.tasks.map(
                  (task: {
                    taskId: string;
                    name: string;
                    taskUrl?: string;
                    status: string;
                    dueDate?: string;
                    overdueDays?: number;
                  }) => (
                    <div
                      key={task.taskId}
                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 text-sm sm:px-6"
                    >
                      <div className="min-w-0">
                        <div className="font-medium" dir="auto">
                          {task.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {displayLabel(task.status)}
                          {task.dueDate
                            ? ` · due ${shortDay(task.dueDate)}`
                            : " · no due date"}
                          {task.overdueDays && task.overdueDays > 0 ? (
                            <span className="txt-bad">
                              {` · ${task.overdueDays}d overdue`}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      {task.taskUrl && (
                        <ExtLink href={task.taskUrl} className="text-xs">
                          Open
                        </ExtLink>
                      )}
                    </div>
                  ),
                )}
              />
            )}
          </SectionCard>
        </div>
      )}

      {section === "today" && (
        <section className="rounded-2xl border bg-card">
          <h2 className="px-4 pt-4 pb-3 text-[15px] font-semibold sm:px-6 sm:pt-6">
            Day plan
          </h2>
          <div className="divide-y border-t">
            {(
              [
                [
                  "sprint_am",
                  "1 · Morning sprint",
                  "10:00–10:30 · every client group, cleared and closed",
                ],
                [
                  "work_am",
                  "2 · Then the work",
                  "Signups, calls, notes, billing, before the day fills up",
                ],
                [
                  "sprint_midday",
                  "3 · Midday sprint",
                  "~14:00 · replies to clients, answers to the team",
                ],
                [
                  "work_pm",
                  "4 · Then the work",
                  "Commitments, reports, hot list",
                ],
                [
                  "sprint_pm",
                  "5 · Evening sprint",
                  "17:30–18:00 · close every loop, then file your end of day",
                ],
              ] as const
            ).map(([block, title, hint]) => {
              const rows = (
                snap.checks as {
                  _id: string;
                  label: string;
                  detail?: string;
                  done: boolean;
                  block?: string;
                }[]
              ).filter(c => (c.block ?? "work_am") === block);
              if (rows.length === 0) return null;
              const doneCount = rows.filter(c => c.done).length;
              const allDone = doneCount === rows.length;
              return (
                <details key={block} open={!allDone} className="group">
                  <summary className="no-marker flex cursor-pointer flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 sm:px-6">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 text-sm font-semibold",
                        allDone ? "text-muted-foreground" : "",
                      )}
                    >
                      <ChevronRight
                        aria-hidden
                        className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
                      />
                      {allDone ? (
                        <Check
                          aria-hidden
                          className="size-3.5 text-[color:var(--success)]"
                        />
                      ) : null}
                      {title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {doneCount}/{rows.length} done · {hint}
                    </span>
                  </summary>
                  <div className="pb-2">
                    {rows.map(c => (
                      <button
                        key={c._id}
                        type="button"
                        aria-pressed={c.done}
                        className="flex w-full items-start gap-3 px-4 py-2 text-left text-sm hover:bg-muted/40 sm:px-6"
                        onClick={() =>
                          toggleCheck({ id: c._id as Id<"checks"> })
                        }
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
                            c.done
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input",
                          )}
                        >
                          {c.done ? <Check className="size-3" /> : null}
                        </span>
                        <span
                          className={
                            c.done ? "text-muted-foreground line-through" : ""
                          }
                        >
                          {sentence(
                            plainText(
                              c.label.replace(
                                /^(Morning|Midday|Evening) sprint\s*[-—:]\s*/i,
                                "",
                              ),
                            ),
                          )}
                          {c.detail && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {plainText(c.detail)}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      )}

      {section === "today" && (
        <Fold
          title="Calendar and data fixes"
          hint="Google Calendar for the week, and clients missing a sheet, a CRM account or a call"
        >
          <div className="space-y-8">
            <MeetingsPage embedded part="calendar" />
            <BacklogPage embedded />
          </div>
        </Fold>
      )}

      {section === "today" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed px-4 py-4 sm:px-6">
          <p className="text-sm text-muted-foreground">
            At 17:30, close the loose ends, then file your end of day. It writes
            itself from what you did today.
          </p>
          <Button size="sm" asChild>
            <Link to="/eod">File my end of day</Link>
          </Button>
        </div>
      )}

      {section === "clients" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <PillRow>
              {VIEWS.map(v => (
                <Pill
                  key={v.key}
                  active={view === v.key}
                  onClick={() =>
                    setParam("view", v.key === "all" ? null : v.key)
                  }
                >
                  {v.label}
                  {v.key === "all"
                    ? ` (${clients.length})`
                    : v.key === "onboarding"
                      ? ` (${onboardingList.length})`
                      : v.key === "live"
                        ? ` (${managementList.length})`
                        : ""}
                </Pill>
              ))}
            </PillRow>
            {view === "results" ? null : (
              <input
                value={find}
                onChange={e => setFind(e.target.value)}
                placeholder="Find a client…"
                aria-label="Find a client"
                dir="auto"
                className="h-9 w-full rounded-lg border bg-background px-3 text-sm sm:w-64"
              />
            )}
          </div>
          {view === "results" ? (
            <ClientPerformancePage
              embedded
              onOpen={(name, per) =>
                navigate(
                  `/clients/${encodeURIComponent(name)}?tab=results&period=${encodeURIComponent(per)}`,
                )
              }
            />
          ) : findList(viewList).length === 0 ? (
            <p className="rounded-2xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
              {find.trim()
                ? `No client here matches "${find.trim()}". Press Ctrl K to search links, pages and every client.`
                : "No clients in this view."}
            </p>
          ) : (
            <div className="space-y-3">{findList(viewList).map(row)}</div>
          )}
        </div>
      )}

      {section === "client" &&
        (clientRow ? (
          clientPage(clientRow)
        ) : (
          <div className="space-y-3">
            <Link
              to="/clients"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              <ArrowLeft aria-hidden className="size-4" />
              All clients
            </Link>
            <p className="rounded-2xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
              This client is not on your list. Their ClickUp card may have been
              renamed or moved. Find them in Clients, or press Ctrl K and type
              their name.
            </p>
          </div>
        ))}

      {section === "hot" && (
        <HotSheet
          suggestions={hotRows}
          saved={(snap.hotRows ?? []) as Any[]}
          onSave={saveHotRow}
        />
      )}

      {section === "links" && (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Everything you need to open in a day, from the Client Journey SOP,
            the exit process and #csm-general. Every link is in the search box
            too (Ctrl K). If a link is missing, say so with Report an issue and
            it gets added.
          </p>
          <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
            {LINK_GROUPS.map(g => (
              <SectionCard key={g.title} title={g.title} sub={g.blurb} flush>
                {g.rows.map(r => (
                  <div
                    key={r.url + r.label}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 sm:px-6"
                  >
                    <div className="min-w-0 flex-1">
                      <ExtLink href={r.url} className="text-sm font-medium">
                        {r.label}
                      </ExtLink>
                      {r.note && (
                        <div className="text-xs text-muted-foreground">
                          {r.note}
                        </div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard.writeText(r.url);
                        toast.success("Link copied");
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                ))}
              </SectionCard>
            ))}
          </div>
        </div>
      )}

      {section === "money" && (
        <MoneySection
          snap={snap}
          targetEdit={targetEdit}
          setTargetEdit={setTargetEdit}
          clientsEdit={clientsEdit}
          setClientsEdit={setClientsEdit}
          countEdits={countEdits}
          setCountEdits={setCountEdits}
          onSave={saveMoneyGoals}
        />
      )}

      {section === "eod" && (
        <SectionCard
          title="Plan tomorrow"
          sub="This report writes itself from what you actually did today. Add anything you want on tomorrow's board, one per line."
        >
          <div className="@container space-y-4">
            <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
              <StatTile
                plain
                label="Clients handled today"
                value={clientsHandled}
              />
              <StatTile plain label="Calls logged" value={callsToday} />
              <StatTile plain label="Tickets raised" value={ticketsToday} />
              <StatTile
                plain
                label="Left with a reason"
                value={
                  snap.decisions.filter(
                    (d: { kind: string }) => d.kind === "left",
                  ).length
                }
              />
            </div>
            <Textarea
              rows={3}
              value={dump}
              onChange={e => setDump(e.target.value)}
              placeholder="Arabic or English. One line per thing."
              dir="auto"
            />
            <Button size="sm" variant="secondary" onClick={submitPlan}>
              Create tomorrow's tasks
            </Button>
          </div>
        </SectionCard>
      )}

      {/* This replaces the Account Manager EOD Typeform, same questions, but the
          countable ones are already answered from today's activity. */}
      {section === "eod" && (
        <SectionCard
          title={
            <span className="inline-flex flex-wrap items-center gap-2">
              Your EOD
              {snap.eod ? <Chip tone="good">Submitted</Chip> : null}
            </span>
          }
        >
          <div className="space-y-4">
            <div className="grid gap-3 text-xs sm:grid-cols-2">
              <div className="rounded-xl bg-muted/40 p-3">
                Calls logged: <strong>{callsToday}</strong> · New signups
                contacted: <strong>{signupsToday}</strong>
              </div>
              <div className="rounded-xl bg-muted/40 p-3">
                Upsell, referral or review conversations:{" "}
                <strong>{hotToday}</strong> · Tickets raised:{" "}
                <strong>{ticketsToday}</strong>
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: The custom control renders a button inside this label. */}
              <label className="flex items-center gap-2 text-xs">
                Energy
                <AnimatedSelect
                  className="text-xs"
                  value={energy}
                  onChange={e => setEnergy(e.target.value)}
                >
                  {SCORES.map(x => (
                    <option key={x}>{x}</option>
                  ))}
                </AnimatedSelect>
              </label>
              {/* biome-ignore lint/a11y/noLabelWithoutControl: The custom control renders a button inside this label. */}
              <label className="flex items-center gap-2 text-xs">
                Stress
                <AnimatedSelect
                  className="text-xs"
                  value={stress}
                  onChange={e => setStress(e.target.value)}
                >
                  {SCORES.map(x => (
                    <option key={x}>{x}</option>
                  ))}
                </AnimatedSelect>
              </label>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium">Call summary</div>
              <Textarea
                rows={4}
                value={callSummary}
                onChange={e => setCallSummary(e.target.value)}
                placeholder="One line per call or client. This is the part leadership reads."
                dir="auto"
              />
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium">
                Daily expectations done
              </div>
              <Textarea
                rows={2}
                value={expectations}
                onChange={e => setExpectations(e.target.value)}
                placeholder="What you said you would finish today, and whether it is finished"
                dir="auto"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <YesNo
                label="Touchpoints for DEFCON 3 clients"
                value={touchpoints}
                onChange={setTouchpoints}
              />
              <YesNo
                label="Fathom summaries sent"
                value={fathom}
                onChange={setFathom}
              />
              <YesNo
                label="New signups or pre-onboarding"
                value={newSignups}
                onChange={setNewSignups}
              />
              <YesNo label="Upsells" value={upsells} onChange={setUpsells} />
              <YesNo
                label="Google reviews"
                value={reviews}
                onChange={setReviews}
              />
              <YesNo
                label="Referrals"
                value={referrals}
                onChange={setReferrals}
              />
            </div>
            <Textarea
              rows={2}
              value={lost}
              onChange={e => setLost(e.target.value)}
              placeholder="Clients lost or at risk today (blank = none)"
              dir="auto"
            />
            {/* These three feed the churn number directly, one client per line. */}
            <div className="space-y-3 rounded-xl bg-muted/40 p-4">
              <div>
                <div className="text-xs font-semibold">Churn ledger</div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Your churn % is built from these three. Leave them blank and
                  nothing is counted. A pause that runs past 14 days becomes
                  churn on its own.
                </p>
              </div>
              <Textarea
                rows={2}
                value={offboarded}
                onChange={e => setOffboarded(e.target.value)}
                placeholder="Fully offboarded today, one client per line (blank = none)"
                dir="auto"
              />
              <Textarea
                rows={2}
                value={extended}
                onChange={e => setExtended(e.target.value)}
                placeholder="Extensions given today, one client per line"
                dir="auto"
              />
              <Textarea
                rows={2}
                value={pausedToday}
                onChange={e => setPausedToday(e.target.value)}
                placeholder="Clients paused today, one client per line"
                dir="auto"
              />
            </div>
            <Textarea
              rows={2}
              value={onePercent}
              onChange={e => setOnePercent(e.target.value)}
              placeholder="One 1% improvement for you or the company"
              dir="auto"
            />
            <Textarea
              rows={2}
              value={rollup}
              onChange={e => setRollup(e.target.value)}
              placeholder="Daily roll up, fires, anything leadership should know"
              dir="auto"
            />
            <Button
              onClick={async () => {
                await submitEod({
                  energy,
                  stress,
                  answers: {
                    callSummary,
                    expectations,
                    touchpoints,
                    fathom,
                    newSignups,
                    upsells,
                    reviews,
                    referrals,
                    lost,
                    onePercent,
                    rollup,
                    offboarded,
                    extended,
                    paused: pausedToday,
                  },
                  computed: {
                    handled: clientsHandled,
                    calls: callsToday,
                    signups: signupsToday,
                    hot: hotToday,
                    tickets: ticketsToday,
                    left: snap.decisions.filter(
                      (d: { kind: string }) => d.kind === "left",
                    ).length,
                  },
                });
                toast.success(
                  "EOD filed. It posts to the EOD channel and the sheet on its own.",
                );
              }}
            >
              File my EOD
            </Button>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

/**
 * His own money screen. Churn is never computed here: it is the churn tracker's
 * figure (Money, Churn; mahara-context's rule: clients lost before day 90 over
 * the clients active at the start). The tracker manages against the rolling
 * three months and reads the retention band from it, so this does too, with
 * the month beside it (the simplification audit, 2026-10-06: it used to call
 * one month "the one number you are held to" and quote the retired sheet).
 * Until the month has a start, the daily roster's count stands in, and says so.
 */
function MoneySection({
  snap,
  targetEdit,
  setTargetEdit,
  clientsEdit,
  setClientsEdit,
  countEdits,
  setCountEdits,
  onSave,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: snapshot
  snap: any;
  targetEdit: string | null;
  setTargetEdit: (v: string) => void;
  clientsEdit: string | null;
  setClientsEdit: (v: string) => void;
  countEdits: Counts;
  setCountEdits: (v: Counts) => void;
  // biome-ignore lint/suspicious/noExplicitAny: convex mutation
  onSave: any;
}) {
  const saved = snap.money ?? null;
  const measured = snap.churn ?? null;
  // The churn tracker is the one figure; the roster stands in until the month has a start.
  const thisMonth = useAction(api.churn.thisMonth);
  const [tracker, setTracker] = useState<MonthRow | null | undefined>(
    undefined,
  );
  useEffect(() => {
    let live = true;
    thisMonth({})
      .then(r => live && setTracker((r as MonthRow | null) ?? null))
      .catch(() => live && setTracker(null));
    return () => {
      live = false;
    };
  }, [thisMonth]);
  const fromTracker =
    tracker?.activeAtStart &&
    (tracker.rolling3Pct !== null || tracker.churnPct !== null)
      ? tracker
      : null;
  const rolling = fromTracker?.rolling3Pct ?? null;
  const churn: number | null =
    rolling ?? fromTracker?.churnPct ?? measured?.pct ?? null;

  const target = Number(targetEdit ?? saved?.target ?? 0);
  const clients = Number(
    clientsEdit ?? saved?.clients ?? (snap.clients ?? []).length,
  );
  const counts: Counts = { ...(saved?.counts ?? {}), ...countEdits };
  const pay = computePay(clients, churn, counts);
  const gap = target - pay.total;

  const field =
    "h-9 w-24 rounded-lg border bg-background px-2 text-right text-sm tabular-nums";
  /** A signed dollar amount: "-$50", never "$-50". */
  const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n)}`;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-6 sm:pt-6">
          <h2 className="text-[15px] font-semibold">
            {rolling !== null
              ? "Churn, the last three months"
              : "Churn this month"}
          </h2>
          {churn === null ? null : churn <= CHURN_TARGET ? (
            <Chip tone="good">Under target</Chip>
          ) : (
            <Chip tone="bad">Over target</Chip>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4 px-4 pt-4 pb-4 sm:px-6 sm:pb-6">
          <div>
            <div
              className={cn(
                "whitespace-nowrap text-3xl font-semibold tracking-tight tabular-nums",
                churn === null
                  ? ""
                  : churn <= CHURN_TARGET
                    ? "txt-good"
                    : "txt-bad",
              )}
            >
              {churn === null ? "Measuring" : `${churn.toFixed(1)}%`}
            </div>
            <div className="text-xs text-muted-foreground">
              Target: under {CHURN_TARGET}%
            </div>
          </div>
          {fromTracker ? (
            <div className="min-w-0 text-sm">
              <div>
                {rolling !== null && fromTracker.churnPct !== null
                  ? `This month ${fromTracker.churnPct.toFixed(1)}%: `
                  : "This month: "}
                <span className="font-semibold">{fromTracker.churned}</span>{" "}
                churned of{" "}
                <span className="font-semibold">
                  {fromTracker.activeAtStart}
                </span>{" "}
                active at the start
                {fromTracker.completed
                  ? `, ${fromTracker.completed} finished the term`
                  : ""}
              </div>
              <div className="text-xs text-muted-foreground">
                From the{" "}
                <Link
                  to="/money?tab=churn"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  churn tracker
                </Link>
                {measured
                  ? ` · the daily roster saw ${measured.lost} leave`
                  : ""}
              </div>
            </div>
          ) : measured ? (
            <div className="min-w-0 text-sm">
              <div>
                <span className="font-semibold">{measured.lost}</span> lost out
                of <span className="font-semibold">{measured.baseline}</span>{" "}
                paying clients
              </div>
              <div className="text-xs text-muted-foreground">
                Counted from the roster of {shortDay(measured.baselineDay)} to{" "}
                {shortDay(measured.latestDay)} ·{" "}
                {plural(measured.daysTracked, "day")} recorded
                {measured.partial
                  ? " · partial month, tracking started mid-month"
                  : ""}
                {measured.extensions
                  ? ` · ${plural(measured.extensions, "extension")} given`
                  : ""}
                {measured.pausedThisMonth
                  ? ` · ${measured.pausedThisMonth} paused`
                  : ""}
              </div>
            </div>
          ) : (
            <div className="min-w-0 max-w-md text-sm text-muted-foreground">
              The roster starts recording today. From the 1st of next month this
              is exact, and every loss below is named and dated.
            </div>
          )}
          <div className="text-sm">
            <div>
              Retention bonus at this rate:{" "}
              <span className="font-semibold tabular-nums">
                {usd(pay.retention)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              Band: {pay.band}
            </div>
          </div>
        </div>
        {measured && measured.lostClients.length > 0 && (
          <div className="border-t px-4 py-4 sm:px-6">
            <Kicker className="mb-2">Lost this month</Kicker>
            <div className="space-y-1">
              {measured.lostClients.map(
                (l: { name: string; reason: string; day?: string }) => (
                  <div key={l.name} className="text-sm">
                    {l.name}
                    <span className="text-xs text-muted-foreground">
                      , {l.reason}
                      {l.day ? ` · ${shortDay(l.day)}` : ""}
                    </span>
                  </div>
                ),
              )}
            </div>
          </div>
        )}
        <details className="border-t px-4 py-3 text-xs text-muted-foreground sm:px-6">
          <summary>How this is counted</summary>
          <p className="mt-2">
            From the churn tracker: clients lost before day 90, over the clients
            active at the start of each month, across the last three months,
            because at 17 clients one departure is 5.9% of a single month. The
            retention bonus band reads the same figure. A client who finishes
            the term and does not renew is not churn. Until the month has its
            start count on the churn tracker, the daily roster's count stands
            in: paying clients at the start of the month, minus the ones now
            stopped, cancelled, paused past 14 days or off the board.
          </p>
        </details>
      </section>

      <SectionCard title="Your target this month">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
          <label className="flex items-center gap-2">
            Target ($)
            <input
              className={field}
              value={targetEdit ?? String(saved?.target ?? "")}
              onChange={e => setTargetEdit(e.target.value)}
              inputMode="numeric"
            />
          </label>
          <label className="flex items-center gap-2">
            Clients you manage
            <input
              className={field}
              value={clientsEdit ?? String(saved?.clients ?? clients)}
              onChange={e => setClientsEdit(e.target.value)}
              inputMode="numeric"
            />
          </label>
          <div>
            Base pay:{" "}
            <span className="font-semibold tabular-nums">${pay.base}</span>
            <span className="ml-1.5 text-xs text-muted-foreground">
              $1,200 up to 20 clients, then $50 each
            </span>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="The four Rs, where the rest of the money is"
        sub={FOUR_RS.map(x => `${x.r}: ${x.meaning}`).join(" · ")}
        flush
      >
        {EARNERS.map(e => {
          const n = counts[e.id] ?? 0;
          return (
            <div
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 text-sm sm:px-6"
            >
              <div className="min-w-0 flex-1 basis-56">
                <div className="flex flex-wrap items-center gap-2">
                  <Kicker className="rounded-md bg-muted px-1.5 py-0.5">
                    {e.r}
                  </Kicker>
                  <span>{e.label}</span>
                </div>
                {e.note && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {e.note}
                  </div>
                )}
                {e.form && (
                  <ExtLink href={e.form} className="mt-0.5 text-xs">
                    Log it in the form
                  </ExtLink>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {usd(e.rate)} {e.unit}
                </span>
                <input
                  className={field}
                  value={String(n)}
                  inputMode="numeric"
                  aria-label={`${e.label}, how many`}
                  onChange={ev =>
                    setCountEdits({
                      ...countEdits,
                      [e.id]: Number(ev.target.value) || 0,
                    })
                  }
                />
                <span className="w-16 text-right font-semibold tabular-nums">
                  {usd(n * e.rate)}
                </span>
              </div>
            </div>
          );
        })}
      </SectionCard>

      <SectionCard title="What costs you money" flush>
        {PENALTIES.map(e => {
          const n = counts[e.id] ?? 0;
          return (
            <div
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 text-sm sm:px-6"
            >
              <div className="min-w-0 flex-1 basis-56">{e.label}</div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {usd(e.rate)} {e.unit}
                </span>
                <input
                  className={field}
                  value={String(n)}
                  inputMode="numeric"
                  aria-label={`${e.label}, how many`}
                  onChange={ev =>
                    setCountEdits({
                      ...countEdits,
                      [e.id]: Number(ev.target.value) || 0,
                    })
                  }
                />
                <span
                  className={cn(
                    "w-16 text-right font-semibold tabular-nums",
                    n * e.rate ? "txt-bad" : "",
                  )}
                >
                  {usd(n * e.rate)}
                </span>
              </div>
            </div>
          );
        })}
        <div className="px-4 py-3 text-xs text-muted-foreground sm:px-6">
          Penalties stop at $500 a month. Upsells that cancel within 60 days
          reverse the commission.
        </div>
      </SectionCard>

      <section className="rounded-2xl border bg-card">
        <div className="@container px-4 pt-4 sm:px-6 sm:pt-6">
          <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-5">
            {[
              ["Base", pay.base],
              ["Retention", pay.retention],
              ["Commission", pay.commission],
              ["Penalties", pay.penalties],
            ].map(([k, val]) => (
              <StatTile key={k} plain label={k} value={usd(Number(val))} />
            ))}
            <StatTile
              label="On track this month"
              value={usd(pay.total)}
              className="col-span-2 rounded-xl border-primary/40 bg-primary/10 @2xl:col-span-1"
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t px-4 py-4 text-sm sm:px-6">
          <div className="min-w-0 flex-1 basis-64">
            {target > 0 ? (
              gap > 0 ? (
                <>
                  <span className="font-semibold txt-bad">${gap} short</span> of
                  your ${target} target, that is {Math.ceil(gap / 250)}{" "}
                  referrals, or {Math.ceil(gap / 350)} UGC packs, or{" "}
                  {Math.ceil(gap / 150)} video testimonials.
                </>
              ) : (
                <span className="font-semibold txt-good">
                  Target hit, ${-gap} over.
                </span>
              )
            ) : (
              "Set a target above to see exactly what closes the gap."
            )}
          </div>
          <Button
            onClick={async () => {
              await onSave({
                month: snap.month,
                target: Number(targetEdit ?? saved?.target ?? 0) || undefined,
                clients: clients || undefined,
                counts,
              });
              toast.success("Saved, this is your month");
            }}
          >
            Save my plan
          </Button>
        </div>
      </section>
    </div>
  );
}

export const TodayPage = () => <CsmPage section="today" />;
export const ClientsPage = () => <CsmPage section="clients" />;
/** One client's page. Keyed by client, so moving to the next one starts clean. */
export function ClientPage() {
  const { key } = useParams();
  return <CsmPage key={key} section="client" clientKey={key} />;
}
export const HotListPage = ({ embedded }: { embedded?: boolean } = {}) => (
  <CsmPage section="hot" embedded={embedded} />
);
export const KeyLinksPage = () => <CsmPage section="links" />;
export const MyMoneyPage = ({ embedded }: { embedded?: boolean } = {}) => (
  <CsmPage section="money" embedded={embedded} />
);
/** The EOD sheet is scored out of 10, so the app must offer the same range. */
const SCORES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];

/** A Y / N / NA answer, the three values his EOD sheet already contains. */
function YesNo({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: The custom control renders a button inside this label. */}
      <label className="flex items-center justify-between gap-2 rounded-xl bg-muted/40 py-1.5 pr-1.5 pl-3 text-xs">
        <span>{label}</span>
        <AnimatedSelect
          className="text-xs"
          value={value}
          onChange={e => onChange(e.target.value)}
        >
          {["Y", "N", "NA"].map(x => (
            <option key={x}>{x}</option>
          ))}
        </AnimatedSelect>
      </label>
    </>
  );
}

export const EndOfDayPage = () => <CsmPage section="eod" />;

type Appt = {
  _id: string;
  apptId: string;
  calendar: string;
  title: string;
  kind: string;
  startTime: string;
  day: string;
  status: string;
  contactName?: string;
  clientName?: string;
  joinUrl?: string;
};

const CALL_LABEL: Record<string, string> = {
  welcome: "Welcome call",
  onboarding: "Onboarding call",
  blueprint: "Brand blueprint",
  launch: "Launch call",
  checkin: "Check in call",
  other: "Call",
};

function apptTime(iso: string): string {
  // GHL already returns Kuwait time, so the clock in the string is the clock on the wall.
  const hhmm = iso.slice(11, 16);
  return hhmm || iso;
}

/**
 * What the CSM actually has booked today, read from the client GHL account. Nobody has to
 * type their own schedule into a form, and a call that exists here is proof of a booked
 * touchpoint.
 */
function TodaysCalls({
  snap,
}: {
  snap: { day: string; appointments?: Appt[] };
}) {
  const all = snap.appointments ?? [];
  const today = snap.day;
  const todays = all.filter(a => a.day === today && a.status !== "cancelled");
  const next = all
    .filter(a => a.day > today && a.status !== "cancelled")
    .slice(0, 3);
  return (
    <section className="rounded-2xl border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-semibold">Your calls today</h2>
        <span className="text-xs text-muted-foreground">
          Live from the client booking calendars
        </span>
      </div>
      {todays.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Nothing booked today. If a client is due a call, open them and press
          Book a call.
        </p>
      ) : (
        <ul className="mt-4 divide-y">
          {todays.map(a => (
            <li key={a._id} className="py-3 text-sm first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {apptTime(a.startTime)}
                </span>
                <span className="font-medium">
                  {CALL_LABEL[a.kind] ?? "Call"}
                </span>
                <span className="min-w-0 text-muted-foreground">
                  {a.clientName ?? a.contactName ?? a.title}
                </span>
                {a.joinUrl ? (
                  <ExtLink href={a.joinUrl} className="ml-auto text-xs">
                    Join
                  </ExtLink>
                ) : null}
              </div>
              {!a.clientName ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Booked as {a.title}. Not matched to a client record yet.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {next.length > 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Coming up:{" "}
          {next
            .map(
              a =>
                `${shortDay(a.day)} ${apptTime(a.startTime)} ${
                  a.clientName ?? a.contactName ?? a.title
                }`,
            )
            .join(" · ")}
        </p>
      ) : null}
    </section>
  );
}
