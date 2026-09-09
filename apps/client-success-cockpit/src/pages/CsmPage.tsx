import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  cadence,
  draftsFor,
  guessLang,
  type Lang,
  LINKS,
  nextCall,
  isChurned,
  nextPocState,
  serviceModel,
  humanise,
} from "@/lib/csmTemplates";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

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

const STAGES = [
  "Active",
  "Needs Contacting",
  "Onboarding Booked",
  "LAUNCH BOOKED",
  "Ready For Launch🚀",
  "DELAY OUT OF OUR CONTROL",
  "GHOSTED",
  "Paused",
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

const LEVEL: Record<string, string> = {
  red: "border-l-4 border-rose-500 bg-rose-50/40",
  amber: "border-l-4 border-amber-500 bg-amber-50/40",
  blue: "border-l-4 border-sky-500 bg-sky-50/30",
  green: "border-l-4 border-emerald-500",
};

const CHIP: Record<string, string> = {
  red: "bg-rose-100 text-rose-700",
  amber: "bg-amber-100 text-amber-700",
  blue: "bg-sky-100 text-sky-700",
  green: "bg-emerald-100 text-emerald-700",
};

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
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title} ({items.length})
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <>
          {shown.map(i => render(i as never))}
          {items.length > limit && (
            <button
              type="button"
              onClick={() => setAll(v => !v)}
              className="text-sm text-muted-foreground underline"
            >
              {all
                ? "Show fewer"
                : `Show the other ${items.length - limit}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

/**
 * Bottom-right escape hatch: if the screen is wrong, say so where you noticed it.
 * It files an owned task rather than becoming a message someone forgets.
 */
/**
 * The floating AI button, on every screen.
 *
 * Two things behind one button: ask anything (answered from the Client Communication SOP
 * and this client's real numbers), or tell me the screen itself is wrong. It is not
 * labelled as a bug reporter — the CSM should reach for it because it helps, and fixing
 * the app is just one of the things it can do.
 *
 * Answers are not instant: the app cannot call a model itself, so the question is queued
 * and answered on the next sync. The panel says so rather than faking a live chat.
 */
export function AiHelper({
  page,
  clientName,
}: {
  page: string;
  clientName?: string;
}) {
  const report = useMutation(api.csm.reportIssue);
  const ask = useMutation(api.csm.askViktor);
  const asks = useQuery(api.csm.myAsks, {});
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"ask" | "fix">("ask");
  const [text, setText] = useState("");
  const recent = (
    Array.isArray(asks)
      ? (asks as { _id: string; question: string; answer?: string }[])
      : []
  ).slice(0, 3);
  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(24rem,calc(100vw-2rem))]">
      {open ? (
        <div className="space-y-2 rounded-lg border bg-card p-3 shadow-lg">
          <div className="flex items-center gap-2">
            {(
              [
                ["ask", "Ask me anything"],
                ["fix", "This screen is wrong"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setMode(k)}
                className={`rounded px-2 py-1 text-xs ${mode === k ? "bg-foreground text-background" : "bg-muted"}`}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className="ml-auto text-xs text-muted-foreground"
              onClick={() => setOpen(false)}
            >
              close
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            {mode === "ask"
              ? "I have the Client Communication SOP, every message template and the client's numbers. Answers land here within about 15 minutes."
              : "Wrong client, wrong instruction, missing field, say it here and I fix the app itself."}
          </p>
          <Textarea
            rows={3}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={
              mode === "ask"
                ? "e.g. how do I ask for a review without sounding needy?"
                : "What is wrong, and what should it say instead?"
            }
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={async () => {
                if (!text.trim()) return;
                if (mode === "ask") {
                  await ask({ question: text.trim(), clientName });
                  toast.success("Asked, the answer appears in here shortly");
                } else {
                  await report({ page, text: text.trim() });
                  toast.success("Sent, a fix task was created");
                  setOpen(false);
                }
                setText("");
              }}
            >
              {mode === "ask" ? "Ask" : "Send it"}
            </Button>
          </div>
          {mode === "ask" && recent.length ? (
            <div className="max-h-64 space-y-2 overflow-y-auto border-t pt-2">
              {recent.map(a => (
                <div key={a._id} className="text-xs">
                  <div className="font-medium">{a.question}</div>
                  <div className="mt-0.5 whitespace-pre-wrap text-muted-foreground">
                    {a.answer ?? "Thinking about it, check back shortly."}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <Button
          size="sm"
          className="shadow-lg"
          onClick={() => setOpen(true)}
        >
          Ask AI
        </Button>
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
  const [date, setDate] = useState(st.date && !st.past ? st.date : st.suggested);
  const bad = st.missing || st.past;
  return (
    <div
      className={`space-y-2 rounded border px-3 py-2 text-xs ${
        bad
          ? "border-rose-300 bg-rose-50 text-rose-800"
          : "border-emerald-200 bg-emerald-50 text-emerald-800"
      } ${emphasise && bad ? "ring-1 ring-rose-300" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Next call:</span>
        <span>{st.label}</span>
        <span className="text-muted-foreground">
          ({call.label.toLowerCase()})
        </span>
      </div>
      <p className="text-[11px] font-medium">
        {call.doNow}
        {call.framework ? (
          <>
            {" "}
            <a
              className="underline"
              href={call.framework}
              target="_blank"
              rel="noreferrer"
            >
              Open the framework
            </a>
          </>
        ) : null}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {call.url ? (
          <a
            className="rounded bg-foreground px-2 py-1 text-background"
            href={call.url}
            target="_blank"
            rel="noreferrer"
          >
            {call.label} booking link
          </a>
        ) : (
          <span className="rounded border border-current px-2 py-1 font-medium">
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
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="rounded border bg-background px-1.5 py-0.5 text-foreground"
        />
        <Button
          size="sm"
          variant={bad ? "default" : "outline"}
          onClick={() =>
            onLog(c, `Next call booked for ${date}`, "booked", {
              value: date,
              note: `Booked via ${call.label.toLowerCase()} (${call.url}).`,
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
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {drafts.map(d => (
          <button
            key={d.id}
            type="button"
            onClick={() => setAngle(d.id)}
            className={`rounded border px-2 py-0.5 text-[11px] font-medium ${
              d.id === chosen.id
                ? "border-teal-400 bg-teal-50 text-teal-800"
                : "bg-background text-muted-foreground"
            }`}
          >
            {d.title}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
          writes in:
          {(["en", "ar"] as const).map(l => (
            <button
              key={l}
              type="button"
              onClick={() => {
                setEdits({});
                onLang(l);
              }}
              className={`rounded border px-1.5 py-0.5 font-semibold uppercase ${
                lang === l
                  ? "border-teal-400 bg-teal-50 text-teal-800"
                  : "bg-background"
              }`}
            >
              {l}
            </button>
          ))}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        From the client communication SOP. {chosen.why} Messages are tracked for
        you off the cadence, you only book the calls.
      </p>
      <Textarea
        rows={8}
        value={text}
        onChange={e => setEdits(x => ({ ...x, [editKey]: e.target.value }))}
        dir={lang === "ar" ? "rtl" : "ltr"}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
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
        <a
          className="rounded bg-muted px-2 py-1 text-xs"
          href={nc.url}
          target="_blank"
          rel="noreferrer"
        >
          {nc.label} booking link
        </a>
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
        {c.sheetLink && (
          <a
            className="rounded bg-muted px-2 py-1 text-xs"
            href={c.sheetLink}
            target="_blank"
            rel="noreferrer"
          >
            Their report sheet
          </a>
        )}
        {c.noteMissing && (
          <a
            className="rounded bg-rose-100 px-2 py-1 text-xs text-rose-700"
            href={LINKS.callSummaryForm}
            target="_blank"
            rel="noreferrer"
          >
            1-1 notes missing for the last call
          </a>
        )}
      </div>
      {justSent && (
        <p className="text-[11px] font-medium text-rose-700">
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
 * One client on the touchpoints view, with the cadence they are on, both clocks, and the
 * SOP messages behind one click. Messages run on `lastPoc`, calls on `lastCall`.
 */
function TouchpointRow({
  c,
  lang,
  onLang,
  onLog,
  defaultOpen,
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
  defaultOpen?: boolean;
  today: string;
}) {
  const count = draftsFor(c, lang).length;
  // The top row opens itself, otherwise the ready-to-send drafts are invisible
  // behind a collapsed row and nobody knows they exist.
  const [open, setOpen] = useState(defaultOpen ?? false);
  const cad = cadence(c);
  const poc = nextPocState(c, today);
  const spineDay = spineFor(c).dayIndex;
  return (
    <div className={`rounded-lg border ${LEVEL[c.level] ?? ""}`}>
      <button
        type="button"
        className="flex w-full flex-wrap items-start justify-between gap-2 px-4 py-3 text-left"
        onClick={() => setOpen(!open)}
      >
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{c.name}</span>
            <span
              className={`rounded px-1.5 py-0.5 text-[11px] ${CHIP[c.level]}`}
            >
              {c.stage}
            </span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
              {cad.stage} · {cad.label}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-[11px] ${
                serviceModel(c.service).code
                  ? "bg-slate-100 text-slate-600"
                  : "bg-amber-100 text-amber-800"
              }`}
              title={serviceModel(c.service).kpi}
            >
              {serviceModel(c.service).label}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                poc.missing || poc.past
                  ? "bg-rose-100 text-rose-700"
                  : "bg-emerald-50 text-emerald-800"
              }`}
            >
              {poc.label}
            </span>
            {spineDay != null && (
              <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[11px] font-medium text-teal-800">
                Day {spineDay} of the 14 day spine
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            <span
              className={
                cad.messageOverdue ? "font-semibold text-rose-600" : ""
              }
            >
              message:{" "}
              {c.lastPoc ? `${c.lastPoc} (${c.silentDays}d ago)` : "never"}
              {cad.daysLate > 0 ? ` · ${cad.daysLate}d late` : ""}
            </span>
            {" · "}
            <span
              className={cad.callOverdue ? "font-semibold text-rose-600" : ""}
            >
              call: {c.lastCall ?? "never"} ({cad.callLabel})
              {cad.callOverdue ? " · due" : ""}
            </span>
            {" · 1-1 notes "}
            {c.lastNoteOn ?? "none"}
            {serviceModel(c.service).dwy ? "" : " · report: "}
            {!serviceModel(c.service).dwy && (
              <span
                className={c.reportDue ? "font-semibold text-rose-600" : ""}
              >
                {c.reportTracked === false
                  ? "not tracked yet"
                  : c.lastReport
                    ? `${c.lastReport} (${c.reportDays}d ago)`
                    : "never sent"}
              </span>
            )}
          </div>
        </div>
        <span className="shrink-0 rounded border border-teal-400 bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-800">
          {open ? "close" : `Open the message${count > 1 ? ` (${count})` : ""}`}
        </span>
      </button>
      {open && (
        <div className="border-t px-4 py-3">
          <TemplatePicker
            c={c}
            lang={lang}
            onLang={onLang}
            onLog={onLog}
            today={today}
          />
        </div>
      )}
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
}: {
  title: string;
  why: string;
  action?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm"
        onClick={() => setOpen(!open)}
      >
        <span>{title}</span>
        <span className="text-xs text-muted-foreground">
          {open ? "hide" : "why?"}
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t px-3 py-2 text-xs text-muted-foreground">
          <div>{why}</div>
          {action}
        </div>
      )}
    </div>
  );
}

type Section =
  | "start"
  | "clients"
  | "tasks"
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
  const PILL: Record<string, string> = {
    "RED HOT": "bg-red-700 text-white",
    Hot: "bg-red-100 text-red-700",
    Warm: "bg-orange-200 text-orange-900",
    "On Hold": "bg-slate-200 text-slate-700",
    Closed: "bg-green-200 text-green-900",
    Nurturing: "bg-orange-200 text-orange-900",
  };
  const DATE_FIELDS = new Set(["lastFu", "nextFu"]);
  const COLS = [
    ["clientName", "Name", "w-40"],
    ["leadType", "Lead type", "w-24"],
    ["status", "Status", "w-24"],
    ["type", "Type", "w-44"],
    ["contactUrl", "Contact URL", "w-40"],
    ["lastObjection", "Last objection", "w-40"],
    ["amount", "Amount", "w-24"],
    ["lastFu", "Last FU", "w-20"],
    ["nextFu", "Next FU", "w-20"],
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
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Your list, your handwriting. Track the last follow-up and the next one so
        nothing sits. I do not add rows for you, I only suggest them underneath.
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              {COLS.map(([, label]) => (
                <th
                  key={label}
                  className="px-2 py-1.5 text-left text-[11px] uppercase tracking-wide text-muted-foreground"
                >
                  {label}
                </th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={COLS.length + 1}
                  className="px-2 py-3 text-muted-foreground"
                >
                  Nothing on your list yet. Add a row, or take one of the
                  suggestions below.
                </td>
              </tr>
            ) : (
              rows.map(r => (
                <tr key={r.key}>
                  {COLS.map(([field, , width]) => (
                    <td key={field} className={`px-1 py-1 ${width}`}>
                      {OPTIONS[field] ? (
                        <select
                          value={r[field] ?? ""}
                          onChange={e => void patch(r, field, e.target.value)}
                          className={`w-full rounded px-1.5 py-0.5 text-xs font-medium ${PILL[r[field] ?? ""] ?? "bg-muted text-foreground"}`}
                        >
                          <option value="">-</option>
                          {OPTIONS[field].map(o => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={DATE_FIELDS.has(field) ? "date" : "text"}
                          defaultValue={r[field] ?? ""}
                          onBlur={e => {
                            if (e.target.value !== (r[field] ?? ""))
                              void patch(r, field, e.target.value);
                          }}
                          className={`w-full rounded border-transparent bg-transparent px-1 py-0.5 hover:border-input focus:border-input focus:bg-background ${
                            field === "nextFu" &&
                            r.nextFu &&
                            r.nextFu < new Date().toISOString().slice(0, 10)
                              ? "bg-rose-100 text-rose-700"
                              : ""
                          }`}
                        />
                      )}
                    </td>
                  ))}
                  <td className="px-1">
                    <button
                      type="button"
                      title="Remove from my list"
                      className="text-xs text-muted-foreground hover:text-rose-600"
                      onClick={() =>
                        onSave({
                          key: r.key,
                          clientName: r.clientName,
                          type: r.type,
                          hidden: true,
                        }).then(() => toast.success("Removed from your list"))
                      }
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
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

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          What I would put on it ({open.length})
        </div>
        <p className="text-xs text-muted-foreground/80">
          From live data: who has earned the ask and what to ask for. Yours to
          take or ignore.
        </p>
        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing new to suggest today.
          </p>
        ) : (
          open.map(o => (
            <div
              key={o.key}
              className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-sm"
            >
              <div>
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
                Add it
              </Button>
            </div>
          ))
        )}
        {allOpen.length > open.length || showAll ? (
          <Button size="sm" variant="ghost" onClick={() => setShowAll(!showAll)}>
            {showAll
              ? "Show fewer"
              : `Show the other ${allOpen.length - open.length}`}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function CsmPage({ section }: { section: Section }) {
  const snap = useQuery(api.csm.snapshot, {});
  const toggleCheck = useMutation(api.csm.toggleCheck);
  const act = useMutation(api.csm.act);
  const addPlanItems = useMutation(api.csm.addPlanItems);
  const submitEod = useMutation(api.csm.submitEod);
  const setClientLanguage = useMutation(api.csm.setClientLanguage);
  const saveHotRow = useMutation(api.csm.saveHotRow);
  const clearLooseEnds = useMutation(api.csm.clearLooseEnds);
  const saveMoneyGoals = useMutation(api.csm.saveMoneyGoals);

  /** Her saved choice wins; the client's own name is only the fallback guess. */
  const langOf = (c: Client): Lang => {
    const saved = (snap?.prefs ?? []).find(
      (p: { clientName: string }) => p.clientName === c.name,
    )?.language;
    return saved === "ar" || saved === "en" ? saved : guessLang(c.name);
  };

  const [open, setOpen] = useState<string | null>(null);
  const [panel, setPanel] = useState<
    "message" | "actions" | "book" | "ticket" | "leave" | "update"
  >("message");
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
  const [tabState, setTab] = useState<
    | "today"
    | "touchpoints"
    | "management"
    | "onboarding"
    | "hot"
    | "loose"
    | "tasks"
    | "links"
    | "money"
  >("today");
  const TABS: Record<Section, string[]> = {
    start: [],
    clients: ["today", "touchpoints", "management", "onboarding"],
    tasks: ["tasks", "loose"],
    hot: ["hot"], // its own screen in the sidebar, so the tab bar stays hidden
    links: ["links"],
    money: ["money"],
    eod: [],
  };
  // Start of day and End of day have no tabs, and must not fall back to the client lists:
  // those live on the Clients screen. Falling back to "today" made both screens twice as
  // long as they needed to be.
  const tab = TABS[section].includes(tabState)
    ? tabState
    : (TABS[section][0] ?? "none");

  const done = useMemo(
    () =>
      new Set(
        (snap?.decisions ?? []).map((d: { subject: string }) => d.subject),
      ),
    [snap],
  );

  if (snap === undefined) {
    return (
      <div className="p-10 text-sm text-muted-foreground">
        Loading today's clients…
      </div>
    );
  }

  const t = snap.totals;
  // biome-ignore lint/suspicious/noExplicitAny: decision rows
  const ds: any[] = snap.decisions ?? [];
  const callsToday = ds.filter(d => /call/i.test(d.action)).length;
  const signupsToday = ds.filter(d =>
    /signup|welcome|onboarding/i.test(d.action),
  ).length;
  const hotToday = ds.filter(d =>
    /upsell|referral|review/i.test(d.action),
  ).length;
  const ticketsToday = ds.filter(d => d.kind === "rerouted").length;
  const clients: Client[] = snap.clients;
  // Today = the combined priority list across both motions; the other two tabs are the
  // split, so he can work one motion at a time.
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

  const run = async (
    c: Client,
    action: string,
    kind: string,
    extra: Record<string, unknown> = {},
  ) => {
    await act({ clientId: c._id as Id<"clients">, action, kind, ...extra });
    setOpen(null);
    setNote("");
    setTicketNote("");
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

  const row = (c: Client) => {
    const isOpen = open === c.name;
    const handled = done.has(c.name);
    return (
      <div
        key={c.taskId}
        className={`rounded-lg border ${LEVEL[c.level] ?? ""} ${handled ? "opacity-55" : ""}`}
      >
        <button
          type="button"
          className="flex w-full flex-wrap items-start justify-between gap-2 px-4 py-3 text-left"
          onClick={() => {
            setOpen(isOpen ? null : c.name);
            setPanel("message");
          }}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{c.name}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] ${CHIP[c.level]}`}
              >
                {c.stage}
              </span>
              {c.happiness && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                  {c.happiness}
                </span>
              )}
              {(() => {
                const sm = serviceModel(c.service);
                return (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                      sm.code
                        ? "bg-slate-100 text-slate-600"
                        : "bg-amber-100 text-amber-800"
                    }`}
                    title={sm.kpi}
                  >
                    {sm.label}
                  </span>
                );
              })()}
              {(() => {
                const poc = nextPocState(c, snap.day);
                return (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                      poc.missing || poc.past
                        ? "bg-rose-100 text-rose-700"
                        : "bg-emerald-50 text-emerald-800"
                    }`}
                  >
                    {poc.label}
                  </span>
                );
              })()}
              {handled && (
                <span className="text-[11px] text-emerald-700">
                  ✓ handled today
                </span>
              )}
            </div>
            <div className="mt-1 text-sm">{c.todo}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {c.lastPoc ? `last contact ${c.lastPoc}` : "never contacted"}
              {c.lastCall ? ` · last call ${c.lastCall}` : " · no call logged"}
              {c.liveDays !== undefined ? ` · live ${c.liveDays}d` : ""}
              {c.csmAssigned ? ` · ${c.csmAssigned}` : ""}
            </div>
          </div>
          <span className="text-xs text-muted-foreground">
            {isOpen ? "close" : "open"}
          </span>
        </button>

        {isOpen && (
          <div className="space-y-3 border-t px-4 py-3">
            <div className="flex flex-wrap gap-2 text-xs">
              {(
                [
                  "message",
                  "actions",
                  "book",
                  "update",
                  "ticket",
                  "leave",
                ] as const
              ).map(
                p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPanel(p)}
                    className={`rounded px-2 py-1 ${panel === p ? "bg-foreground text-background" : "bg-muted"}`}
                  >
                    {p === "message"
                      ? "Message (SOP template)"
                      : p === "actions"
                        ? "Do it"
                      : p === "book"
                        ? "Book the next call"
                        : p === "update"
                          ? "Update the board"
                          : p === "ticket"
                            ? "Raise a ticket"
                            : "Leave it"}
                  </button>
                ),
              )}
            </div>

            {panel === "message" && (
              <TemplatePicker
                c={c}
                today={snap.day}
                lang={langOf(c)}
                onLang={l =>
                  void setClientLanguage({ clientName: c.name, language: l })
                }
                onLog={run}
              />
            )}

            {panel === "actions" && (
              <div className="space-y-2">
                <Textarea
                  placeholder="Call summary or what you said to them (optional, goes on the ClickUp task)"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  rows={2}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      run(c, "Messaged the client", "touchpoint", { note })
                    }
                  >
                    Logged a message
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => run(c, "Held a call", "call", { note })}
                  >
                    Logged a call + summary
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const d = prompt("Next touchpoint date (YYYY-MM-DD)");
                      if (d)
                        run(
                          c,
                          `Booked the next touchpoint for ${d}`,
                          "booked",
                          { value: d },
                        );
                    }}
                  >
                    Book the next touchpoint
                  </Button>
                  {c.sheetLink && (
                    <a
                      className="text-xs underline"
                      href={c.sheetLink}
                      target="_blank"
                      rel="noreferrer"
                    >
                      report sheet
                    </a>
                  )}
                  {c.taskUrl && (
                    <a
                      className="text-xs underline"
                      href={c.taskUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      ClickUp
                    </a>
                  )}
                </div>
                {c.hot.length > 0 && !c.hotBlocked && (
                  <div className="rounded border border-emerald-300 bg-emerald-50/60 p-2">
                    <div className="text-xs font-semibold text-emerald-800">
                      Hot list
                    </div>
                    {c.hot.map((h: { kind: string; why: string }) => (
                      <div
                        key={h.kind}
                        className="mt-1 flex items-center justify-between gap-2 text-xs"
                      >
                        <span>
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
                          Had it
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                {c.changes.length > 0 && (
                  <div className="rounded border bg-muted/40 p-2">
                    <div className="text-xs font-semibold">
                      Campaign changes since your last call
                    </div>
                    {c.changes.map(
                      (
                        ch: { action: string; day: string; evidence: string },
                        i: number,
                      ) => (
                        <div
                          key={`${ch.day}-${i}`}
                          className="mt-1 text-xs text-muted-foreground"
                        >
                          <span className="text-foreground">{ch.day}</span>, {" "}
                          {ch.action}. {ch.evidence}
                        </div>
                      ),
                    )}
                  </div>
                )}
                {c.loose.length > 0 && (
                  <div className="text-xs text-rose-700">
                    Loose ends: {c.loose.join(" · ")}
                  </div>
                )}
              </div>
            )}

            {panel === "book" && (
              <div className="space-y-2 text-sm">
                {(() => {
                  const nc = nextCall(c, langOf(c));
                  return (
                    <>
                      <div className="text-xs text-muted-foreground">
                        Next in the journey: <strong>{nc.label}</strong>
                      </div>
                      <div className="text-xs">{nc.doNow}</div>
                      <div className="flex flex-wrap gap-2">
                        {nc.url ? (
                          <>
                            <a
                              className="rounded bg-foreground px-2 py-1 text-xs text-background"
                              href={nc.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open the booking link
                            </a>
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
                        ) : null}
                        {nc.framework ? (
                          <a
                            className="text-xs underline"
                            href={nc.framework}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Call framework
                          </a>
                        ) : null}
                        <a
                          className="text-xs underline"
                          href={LINKS.callSummaryForm}
                          target="_blank"
                          rel="noreferrer"
                        >
                          1-1 call summary form
                        </a>
                      </div>
                      <Textarea
                        rows={4}
                        defaultValue={nc.message}
                        id={`msg-${c.taskId}`}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            const el = document.getElementById(
                              `msg-${c.taskId}`,
                            ) as HTMLTextAreaElement | null;
                            navigator.clipboard.writeText(
                              el?.value ?? nc.message,
                            );
                            toast.success(
                              "Message copied, send it from WhatsApp",
                            );
                          }}
                        >
                          Copy the message
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            const d = prompt(
                              "Booked for which date? (YYYY-MM-DD)",
                            );
                            if (d)
                              run(c, `Booked ${nc.label} for ${d}`, "booked", {
                                value: d,
                                note: `Sent the booking link (${nc.url}).`,
                              });
                          }}
                        >
                          They booked, log the date
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            run(
                              c,
                              `Sent the ${nc.label} booking link`,
                              "touchpoint",
                              {
                                note: `Booking link sent: ${nc.url}`,
                              },
                            )
                          }
                        >
                          Sent it, not booked yet
                        </Button>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Viktor drafts, you send. Nothing goes to the client from
                        here.
                      </p>
                    </>
                  );
                })()}
              </div>
            )}

            {panel === "update" && (
              <div className="space-y-2 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">
                    Client status
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {STAGES.map(s => (
                      <button
                        key={s}
                        type="button"
                        className={`rounded px-2 py-1 text-xs ${s === c.stage ? "bg-foreground text-background" : "bg-muted"}`}
                        onClick={() =>
                          run(c, `Moved to ${s}`, "stage", { value: s })
                        }
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    Service model, what we owe them
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {(["DFY", "DWY"] as const).map(v => (
                      <button
                        key={v}
                        type="button"
                        className={`rounded px-2 py-1 text-xs ${
                          serviceModel(c.service).code === v
                            ? "bg-foreground text-background"
                            : "bg-muted"
                        }`}
                        onClick={() =>
                          run(c, `Service model set to ${v}`, "service", {
                            value: v,
                          })
                        }
                      >
                        {v}
                      </button>
                    ))}
                    <span className="text-[11px] text-muted-foreground">
                      {serviceModel(c.service).kpi}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    Client happiness
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {HAPPINESS.map(h => (
                      <button
                        key={h}
                        type="button"
                        className={`rounded px-2 py-1 text-xs ${h === c.happiness ? "bg-foreground text-background" : "bg-muted"}`}
                        onClick={() =>
                          run(c, `Happiness set to ${h}`, "happiness", {
                            value: h,
                          })
                        }
                      >
                        {h}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {panel === "ticket" && (
              <div className="space-y-2">
                <select
                  className="w-full rounded border bg-background px-2 py-1 text-sm"
                  value={ticket}
                  onChange={e => setTicket(e.target.value)}
                >
                  {TICKETS.map(r => (
                    <option key={r.label} value={r.label}>
                      {r.label} → {r.deptLabel}
                    </option>
                  ))}
                </select>
                <Textarea
                  placeholder="What exactly is needed?"
                  value={ticketNote}
                  onChange={e => setTicketNote(e.target.value)}
                  rows={2}
                />
                <Button
                  size="sm"
                  onClick={() => {
                    const hit = TICKETS.find(r => r.label === ticket)!;
                    run(c, hit.label, "ticket", {
                      department: hit.dept,
                      note: ticketNote,
                    });
                  }}
                >
                  Create it on{" "}
                  {TICKETS.find(r => r.label === ticket)?.deptLabel}
                </Button>
              </div>
            )}

            {panel === "leave" && (
              <div className="space-y-2">
                <select
                  className="w-full rounded border bg-background px-2 py-1 text-sm"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                >
                  {REASONS.map(r => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
                <div className="flex gap-1">
                  {CLOCKS.map(k => (
                    <button
                      key={k}
                      type="button"
                      className={`rounded px-2 py-1 text-xs ${k === clock ? "bg-foreground text-background" : "bg-muted"}`}
                      onClick={() => setClock(k)}
                    >
                      {k}
                    </button>
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
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <AiHelper page={tab} />
      <header className="border-b pb-4">
        <h1 className="text-2xl font-bold tracking-tight">
          {section === "start"
            ? "Start of day"
            : section === "clients"
              ? "Client management & touchpoints"
              : section === "tasks"
                ? "Task list"
                : section === "hot"
                  ? "Hot list"
                  : section === "links"
                    ? "Key links"
                    : section === "money"
                      ? "My money"
                      : "End of day"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {new Date().toLocaleDateString("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}{" "}
          ·{" "}
          {snap.lastSyncAt
            ? `synced ${new Date(snap.lastSyncAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
            : "not yet synced"}{" "}
          · clients on WhatsApp, team on Slack
        </p>
        {section === "start" && (
          <p className="mt-3 text-base">
            {t.dueToday === 0
              ? "Nothing is waiting on you. Use the time on the hot list."
              : `${t.dueToday} ${t.dueToday === 1 ? "client needs" : "clients need"} a message or a call today.`}
            {t.pastDue > 0
              ? ` ${t.pastDue} ${t.pastDue === 1 ? "invoice is" : "invoices are"} past due.`
              : ""}{" "}
            {t.dueToday > 0 && (
              <a
                href="/clients"
                className="font-medium underline underline-offset-4"
              >
                Open the client list
              </a>
            )}
          </p>
        )}
      </header>

      {section === "start" && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-3">
            <Stat
              label="Need you today"
              value={t.dueToday}
              tone={t.dueToday ? "text-rose-600" : "text-emerald-600"}
            />
            <Stat
              label="New signups"
              value={t.newSignups}
              tone={t.newSignups ? "text-rose-600" : ""}
            />
            <Stat
              label="Invoices past due"
              value={t.pastDue}
              tone={t.pastDue ? "text-rose-600" : ""}
            />
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              The rest of the numbers
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="In onboarding" value={t.onboarding} />
              <Stat label="Managed clients" value={t.managed ?? 0} />
              <Stat label="Hot list" value={t.hot} tone="text-emerald-600" />
              <Stat label="Loose ends" value={t.loose} />
            </div>
          </details>
        </div>
      )}

      {section === "start" && <TodaysCalls snap={snap} />}

      {section === "start" && (
        <div className="space-y-3">
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
            const isSprint = block.startsWith("sprint");
            const doneCount = rows.filter(c => c.done).length;
            const allDone = doneCount === rows.length;
            return (
              <details
                key={block}
                open={!allDone}
                className={`rounded-lg border ${isSprint ? "border-teal-300 bg-teal-50/40" : ""} ${allDone ? "opacity-70" : ""}`}
              >
                <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2 px-4 py-2">
                  <span className="text-sm font-semibold">
                    {allDone ? "✓ " : ""}
                    {title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {doneCount}/{rows.length} done · {hint}
                  </span>
                </summary>
                <div className="divide-y border-t">
                  {rows.map(c => (
                    <button
                      key={c._id}
                      type="button"
                      className="flex w-full items-start gap-3 px-4 py-2 text-left text-sm"
                      onClick={() => toggleCheck({ id: c._id as Id<"checks"> })}
                    >
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${c.done ? "bg-emerald-600 text-white" : ""}`}
                      >
                        {c.done ? "✓" : ""}
                      </span>
                      <span className={c.done ? "line-through opacity-60" : ""}>
                        {c.label.replace(
                          /^(Morning|Midday|Evening) sprint\s*[-—:]\s*/i,
                          "",
                        )}
                        {c.detail && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {c.detail}
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
      )}

      {TABS[section].length > 1 && (
        <div className="flex flex-wrap gap-2 text-sm">
          {(
            [
              ["today", `Today (${todayList.length})`],
              [
                "management",
                `Client management (${managementList.filter(needsAction).length}/${managementList.length})`,
              ],
              [
                "onboarding",
                `Client onboarding (${onboardingList.filter(needsAction).length}/${onboardingList.length})`,
              ],
              ["hot", `Hot list (${hotRows.length})`],
              ["loose", `Loose ends (${looseList.length})`],
              ["tasks", `ClickUp tasks (${snap.tasks.length})`],
            ] as const
          )
            .filter(([k]) => TABS[section].includes(k))
            .map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={`rounded px-3 py-1 ${tab === k ? "bg-foreground text-background" : "bg-muted"}`}
              >
                {label}
              </button>
            ))}
        </div>
      )}

      {tab === "today" && (
        <div className="space-y-5">
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
        </div>
      )}
      {tab === "touchpoints" && (
        <div className="space-y-4">
          {[
            {
              key: "nopoc",
              title: "No next call booked",
              hint: "Every client needs a booked next call. Send the booking link here and save the date, it writes to the Next POC field in ClickUp. Messages are tracked automatically, they do not need booking.",
              rows: clients.filter(c => {
                const poc = nextPocState(c, snap.day);
                return poc.missing || poc.past;
              }),
            },
            {
              key: "launch",
              title: "Launch week, message every day",
              hint: "Day 1–7 after launch, plus the day-7 review call.",
              rows: clients.filter(
                c => c.bucket === "management" && (c.liveDays ?? 99) <= 7,
              ),
            },
            {
              key: "pipeline",
              title:
                "In onboarding, message every working day until they move",
              hint: "Nothing else moves them forward.",
              rows: onboardingList.filter(needsAction),
            },
            {
              key: "call",
              title: "Check-in call due",
              hint: "Weekly through their first month live, every 2 weeks after that. A message does not clear this, it needs a call.",
              rows: clients.filter(
                c => c.bucket === "management" && cadence(c).callOverdue,
              ),
            },
            {
              key: "silent",
              title: "Going quiet, 7 days or more with no contact",
              hint: "Comms level slips to Meh at 14 days, Danger at 30.",
              rows: clients.filter(
                c =>
                  c.bucket === "management" &&
                  (c.silentDays === undefined || c.silentDays >= 7),
              ),
            },
            {
              key: "booked",
              title: "Booked ahead, nothing due",
              hint: "Suppressed until the booked date, unless an invoice goes past due.",
              rows: clients.filter(c => c.nextPoc && c.nextPoc > snap.day),
            },
          ].map(group => (
            <div key={group.key} className="space-y-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.title} ({group.rows.length})
                </div>
                <div className="text-xs text-muted-foreground/80">
                  {group.hint}
                </div>
              </div>
              {group.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing here today.
                </p>
              ) : (
                group.rows.map((c, i) => (
                  <TouchpointRow
                    key={c.taskId}
                    today={snap.day}
                    defaultOpen={i === 0}
                    c={c}
                    lang={langOf(c)}
                    onLang={l =>
                      void setClientLanguage({
                        clientName: c.name,
                        language: l,
                      })
                    }
                    onLog={run}
                  />
                ))
              )}
            </div>
          ))}
        </div>
      )}
      {tab === "management" && (
        <div className="space-y-2">{managementList.map(row)}</div>
      )}
      {tab === "onboarding" && (
        <div className="space-y-2">{onboardingList.map(row)}</div>
      )}
      {tab === "hot" && (
        <HotSheet
          suggestions={hotRows}
          saved={(snap.hotRows ?? []) as Any[]}
          onSave={saveHotRow}
        />
      )}
      {tab === "loose" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
            <p className="text-xs text-muted-foreground">
              Loose ends are what the board says nobody closed. Anything about
              money stays, everything else can be written off in one go, and I
              record who cleared it.
            </p>
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
          </div>
          {looseList.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing loose. This is what a clean board looks like.
            </p>
          ) : (
            looseList.map(row)
          )}
        </div>
      )}
      {tab === "tasks" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Commitments from calls ({commitmentRows.length})
            </div>
            <p className="text-xs text-muted-foreground/80">
              Pulled from the 1-1 Call Notes form. Each one becomes a real task,
              or you say why not.
            </p>
            {commitmentRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing outstanding from the last round of calls.
              </p>
            ) : (
              // One card per CALL, not per line. A call is one conversation: here is what
              // you said, here are the tasks I think come out of it, and here is the
              // ticketing form for the ones another team has to do.
              [
                ...new Map(
                  commitmentRows.map(r => [
                    `${r.client.taskId}|${r.item.source}`,
                    r,
                  ]),
                ).values(),
              ].map(({ client, item }) => {
                const call = item.source;
                const items = commitmentRows
                  .filter(r => r.client.taskId === client.taskId && r.item.source === call)
                  .map(r => r.item);
                const when = call.replace("1-1 call notes, ", "");
                return (
                  <ChecklistItem
                    key={`${client.taskId}-${call}`}
                    title={`${client.name}, your call on ${when}`}
                    why={`${items.length} thing${items.length === 1 ? "" : "s"} you said you would do. Anything another team has to do goes on the ticketing form.`}
                    action={
                      <div className="space-y-2">
                        <ul className="ml-4 list-disc space-y-1 text-sm">
                          {items.map(i => (
                            <li key={i.text}>{i.text}</li>
                          ))}
                        </ul>
                        <div className="flex flex-wrap gap-2">
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
                          <a
                            className="rounded bg-muted px-2 py-1 text-xs"
                            href={LINKS.ticketingForm}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Ticketing form ↗
                          </a>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              for (const i of items)
                                await run(
                                  client,
                                  `Commitment handled: ${i.text}`,
                                  "touchpoint",
                                  { note: i.source },
                                );
                            }}
                          >
                            All done already
                          </Button>
                        </div>
                      </div>
                    }
                  />
                );
              })
            )}
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Tickets raised today ({ticketRows.length})
            </div>
            <p className="text-xs text-muted-foreground/80">
              Verified against ClickUp: a ticket only counts once it exists on
              the other team's board.
            </p>
            {ticketRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
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
                    title={`${d.subject}, ${d.action} → ${d.reroutedTo ?? "?"} ${d.clickupTaskUrl ? "✓ landed" : d.logError ? "✗ failed" : "… sending"}`}
                    why={
                      d.clickupTaskUrl
                        ? `Created on the ${d.reroutedTo} board. Open it: ${d.clickupTaskUrl}`
                        : d.logError
                          ? `ClickUp rejected it: ${d.logError}. Raise it again.`
                          : "Still being created, refresh in a moment."
                    }
                  />
                ),
              )
            )}
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Loose ends ({t.loose})
            </div>
            {looseList.flatMap((c: Client) =>
              c.loose.map((l: string, i: number) => (
                <ChecklistItem
                  key={`${c.taskId}-loose-${i}`}
                  title={`${c.name}, ${l}`}
                  why={`${c.stage}. ${c.todo}. Clear it before 18:00 or it shows in your EOD.`}
                  action={
                    c.taskUrl ? (
                      <a
                        className="underline"
                        href={c.taskUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open the client task
                      </a>
                    ) : undefined
                  }
                />
              )),
            )}
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Client Success board, due, overdue or undated (
              {snap.tasks.length})
            </div>
            {snap.tasks.map(
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
                  className="flex items-center justify-between gap-3 rounded border px-3 py-2 text-sm"
                >
                  <div>
                    <div className="font-medium">{task.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {task.status}
                      {task.dueDate
                        ? ` · due ${task.dueDate}`
                        : " · no due date"}
                      {task.overdueDays && task.overdueDays > 0
                        ? ` · ${task.overdueDays}d overdue`
                        : ""}
                    </div>
                  </div>
                  {task.taskUrl && (
                    <a
                      className="text-xs underline"
                      href={task.taskUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      open
                    </a>
                  )}
                </div>
              ),
            )}
          </div>
        </div>
      )}

      {tab === "links" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Everything you need to open in a day. Pulled from the Client Journey
            SOP, the exit process and #csm-general, if a link is missing, use
            the report button and I will add it.
          </p>
          {LINK_GROUPS.map(g => (
            <section key={g.title} className="rounded-lg border">
              <div className="border-b px-4 py-2">
                <div className="text-sm font-semibold">{g.title}</div>
                <div className="text-xs text-muted-foreground">{g.blurb}</div>
              </div>
              <div className="divide-y">
                {g.rows.map(r => (
                  <div
                    key={r.url + r.label}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
                  >
                    <div>
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-medium text-teal-700 underline"
                      >
                        {r.label}
                      </a>
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
              </div>
            </section>
          ))}
        </div>
      )}

      {tab === "money" && (
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
        <section className="rounded-lg border">
          <div className="border-b px-4 py-2 text-sm font-semibold">
            End of day, plan tomorrow today
          </div>
          <div className="space-y-3 px-4 py-3">
            <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded bg-muted/50 p-2">
                <div className="text-xs text-muted-foreground">
                  Clients handled today
                </div>
                <div className="text-lg font-semibold">
                  {snap.decisions.length}
                </div>
              </div>
              <div className="rounded bg-muted/50 p-2">
                <div className="text-xs text-muted-foreground">
                  Calls logged
                </div>
                <div className="text-lg font-semibold">
                  {
                    snap.decisions.filter(
                      (d: { kind: string; action: string }) =>
                        /call/i.test(d.action),
                    ).length
                  }
                </div>
              </div>
              <div className="rounded bg-muted/50 p-2">
                <div className="text-xs text-muted-foreground">
                  Tickets raised
                </div>
                <div className="text-lg font-semibold">
                  {
                    snap.decisions.filter(
                      (d: { kind: string }) => d.kind === "rerouted",
                    ).length
                  }
                </div>
              </div>
              <div className="rounded bg-muted/50 p-2">
                <div className="text-xs text-muted-foreground">
                  Left with a reason
                </div>
                <div className="text-lg font-semibold">
                  {
                    snap.decisions.filter(
                      (d: { kind: string }) => d.kind === "left",
                    ).length
                  }
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              This is your end-of-day report, it writes itself from what you
              actually did. Add anything you want on tomorrow's board, one per
              line.
            </p>
            <Textarea
              rows={3}
              value={dump}
              onChange={e => setDump(e.target.value)}
              placeholder="Arabic or English. One line per thing."
            />
            <Button size="sm" onClick={submitPlan}>
              Create tomorrow's tasks
            </Button>

            {/* This replaces the Account Manager EOD Typeform, same questions, but the
              countable ones are already answered from today's activity. */}
            <div className="space-y-2 border-t pt-3">
              <div className="text-sm font-semibold">
                Your EOD {snap.eod ? "· submitted ✓" : ""}
              </div>
              <div className="grid gap-2 text-xs sm:grid-cols-2">
                <div className="rounded bg-muted/50 p-2">
                  Call summaries logged: <strong>{callsToday}</strong> · new
                  signups contacted: <strong>{signupsToday}</strong>
                </div>
                <div className="rounded bg-muted/50 p-2">
                  Upsell / referral / review conversations:{" "}
                  <strong>{hotToday}</strong> · tickets raised:{" "}
                  <strong>{ticketsToday}</strong>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="flex items-center gap-2 text-xs">
                  Energy
                  <select
                    className="rounded border bg-background px-2 py-1 text-xs"
                    value={energy}
                    onChange={e => setEnergy(e.target.value)}
                  >
                    {SCORES.map(x => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-xs">
                  Stress
                  <select
                    className="rounded border bg-background px-2 py-1 text-xs"
                    value={stress}
                    onChange={e => setStress(e.target.value)}
                  >
                    {SCORES.map(x => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium">Call summary</div>
                <Textarea
                  rows={4}
                  value={callSummary}
                  onChange={e => setCallSummary(e.target.value)}
                  placeholder="One line per call or client. This is the part leadership reads."
                />
              </div>
              <div>
                <div className="mb-1 text-xs font-medium">
                  Daily expectations done
                </div>
                <Textarea
                  rows={2}
                  value={expectations}
                  onChange={e => setExpectations(e.target.value)}
                  placeholder="What you said you would finish today, and whether it is finished"
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <YesNo
                  label="Defcon 3 touchpoints"
                  value={touchpoints}
                  onChange={setTouchpoints}
                />
                <YesNo
                  label="Fathom summaries sent"
                  value={fathom}
                  onChange={setFathom}
                />
                <YesNo
                  label="New signups / pre-onboarding"
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
              />
              {/* These three feed the churn number directly, one client per line. */}
              <div className="rounded border border-dashed p-2">
                <div className="mb-1 text-xs font-semibold">
                  Churn ledger, this is what your churn % is built from
                </div>
                <div className="space-y-2">
                  <Textarea
                    rows={2}
                    value={offboarded}
                    onChange={e => setOffboarded(e.target.value)}
                    placeholder="Fully offboarded today, one client per line (blank = none)"
                  />
                  <Textarea
                    rows={2}
                    value={extended}
                    onChange={e => setExtended(e.target.value)}
                    placeholder="Extensions given today, one client per line"
                  />
                  <Textarea
                    rows={2}
                    value={pausedToday}
                    onChange={e => setPausedToday(e.target.value)}
                    placeholder="Clients paused today, one client per line"
                  />
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Leave blank and nothing is counted. A pause that runs past 14
                  days becomes churn on its own.
                </div>
              </div>
              <Textarea
                rows={2}
                value={onePercent}
                onChange={e => setOnePercent(e.target.value)}
                placeholder="One 1% improvement for you or the company"
              />
              <Textarea
                rows={2}
                value={rollup}
                onChange={e => setRollup(e.target.value)}
                placeholder="Daily roll up, fires, anything leadership should know"
              />
              <Button
                size="sm"
                variant="secondary"
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
                      handled: snap.decisions.length,
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
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * His own money screen. Churn is never computed here — it is read from the company's Churn
 * Tracker sheet and shown with its month and source, so nobody argues about the number.
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
  const kpis: {
    key: string;
    label: string;
    value?: string;
    numeric?: number;
    month?: string;
    source: string;
    note?: string;
  }[] = snap.kpis ?? [];
  const churnKpi = kpis.find(k => k.key === "churn");
  const churnMissing = kpis.find(k => k.key === "churn_missing");
  // My own measurement wins. The sheet is kept as a cross-check underneath.
  const measured = snap.churn ?? null;
  const churn: number | null = measured?.pct ?? null;

  const target = Number(targetEdit ?? saved?.target ?? 0);
  const clients = Number(
    clientsEdit ?? saved?.clients ?? snap.totals.clients ?? 0,
  );
  const counts: Counts = { ...(saved?.counts ?? {}), ...countEdits };
  const pay = computePay(clients, churn, counts);
  const gap = target - pay.total;

  const field =
    "w-24 rounded border bg-background px-2 py-1 text-right text-sm";

  return (
    <div className="space-y-4">
      <section
        className={`rounded-lg border ${
          churn === null
            ? ""
            : churn <= CHURN_TARGET
              ? "border-teal-400 bg-teal-50/60"
              : "border-rose-400 bg-rose-50/60"
        }`}
      >
        <div className="border-b px-4 py-2 text-sm font-semibold">
          Churn, the one number you are held to
        </div>
        <div className="flex flex-wrap items-end gap-8 px-4 py-3">
          <div>
            <div className="text-3xl font-bold">
              {churn === null ? "measuring" : `${churn.toFixed(1)}%`}
            </div>
            <div className="text-xs text-muted-foreground">
              target: under {CHURN_TARGET}%
            </div>
          </div>
          {measured ? (
            <div className="text-sm">
              <div>
                <span className="font-semibold">{measured.lost}</span> lost out
                of <span className="font-semibold">{measured.baseline}</span>{" "}
                paying clients
              </div>
              <div className="text-xs text-muted-foreground">
                counted from the roster of {measured.baselineDay} to{" "}
                {measured.latestDay} · {measured.daysTracked} day(s) recorded
                {measured.partial
                  ? " · partial month, tracking started mid-month"
                  : ""}
                {measured.extensions
                  ? ` · ${measured.extensions} extension(s) given`
                  : ""}
                {measured.pausedThisMonth
                  ? ` · ${measured.pausedThisMonth} paused`
                  : ""}
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              The roster starts recording today. From the 1st of next month this
              is exact, and every loss below is named and dated.
            </div>
          )}
          <div className="text-sm">
            <div>
              Retention bonus at this rate:{" "}
              <span className="font-semibold">
                {pay.retention < 0 ? "-" : ""}${Math.abs(pay.retention)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              band: {pay.band}
            </div>
          </div>
        </div>
        {measured && measured.lostClients.length > 0 && (
          <div className="border-t px-4 py-2">
            <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
              Who we lost this month
            </div>
            <div className="space-y-1">
              {measured.lostClients.map(
                (l: { name: string; reason: string; day?: string }) => (
                  <div key={l.name} className="text-sm">
                    {l.name}{" "}
                    <span className="text-xs text-muted-foreground">
, {l.reason}
                      {l.day ? ` · ${l.day}` : ""}
                    </span>
                  </div>
                ),
              )}
            </div>
          </div>
        )}
        <div className="border-t px-4 py-2 text-xs text-muted-foreground">
          Measured from our own daily client roster: paying clients at the start
          of the month, minus the ones now stopped, cancelled, paused or off the
          board. Nobody has to fill anything in for this to stay correct.
          {churnKpi?.value
            ? ` Your churn tracker sheet says ${churnKpi.value} for the same month.`
            : churnMissing
              ? " Your churn tracker sheet has no usable number for this month."
              : ""}
        </div>
      </section>

      <section className="rounded-lg border">
        <div className="border-b px-4 py-2 text-sm font-semibold">
          What I want to earn this month
        </div>
        <div className="flex flex-wrap items-center gap-4 px-4 py-3 text-sm">
          <label className="flex items-center gap-2">
            My target ($)
            <input
              className={field}
              value={targetEdit ?? String(saved?.target ?? "")}
              onChange={e => setTargetEdit(e.target.value)}
              inputMode="numeric"
            />
          </label>
          <label className="flex items-center gap-2">
            Clients I manage
            <input
              className={field}
              value={clientsEdit ?? String(saved?.clients ?? clients)}
              onChange={e => setClientsEdit(e.target.value)}
              inputMode="numeric"
            />
          </label>
          <div>
            Base pay: <span className="font-semibold">${pay.base}</span>
            <span className="ml-1 text-xs text-muted-foreground">
              $1,200 up to 20 clients, then $50 each
            </span>
          </div>
        </div>
      </section>

      <section className="rounded-lg border">
        <div className="border-b px-4 py-2">
          <div className="text-sm font-semibold">
            The four Rs, where the rest of the money is
          </div>
          <div className="text-xs text-muted-foreground">
            {FOUR_RS.map(x => `${x.r}: ${x.meaning}`).join(" · ")}
          </div>
        </div>
        <div className="divide-y">
          {EARNERS.map(e => {
            const n = counts[e.id] ?? 0;
            return (
              <div
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm"
              >
                <div>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                    {e.r}
                  </span>{" "}
                  {e.label}
                  {e.note && (
                    <div className="text-xs text-muted-foreground">
                      {e.note}
                    </div>
                  )}
                  {e.form && (
                    <a
                      href={e.form}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-teal-700 underline"
                    >
                      Log it in the form →
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    ${e.rate} {e.unit}
                  </span>
                  <input
                    className={field}
                    value={String(n)}
                    inputMode="numeric"
                    onChange={ev =>
                      setCountEdits({
                        ...countEdits,
                        [e.id]: Number(ev.target.value) || 0,
                      })
                    }
                  />
                  <span className="w-16 text-right font-semibold">
                    ${n * e.rate}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-lg border">
        <div className="border-b px-4 py-2 text-sm font-semibold">
          What costs you money
        </div>
        <div className="divide-y">
          {PENALTIES.map(e => {
            const n = counts[e.id] ?? 0;
            return (
              <div
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm"
              >
                <div>{e.label}</div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    ${e.rate} {e.unit}
                  </span>
                  <input
                    className={field}
                    value={String(n)}
                    inputMode="numeric"
                    onChange={ev =>
                      setCountEdits({
                        ...countEdits,
                        [e.id]: Number(ev.target.value) || 0,
                      })
                    }
                  />
                  <span className="w-16 text-right font-semibold text-rose-600">
                    ${n * e.rate}
                  </span>
                </div>
              </div>
            );
          })}
          <div className="px-4 py-2 text-xs text-muted-foreground">
            Penalties stop at $500 a month. Upsells that cancel within 60 days
            reverse the commission.
          </div>
        </div>
      </section>

      <section className="rounded-lg border">
        <div className="grid gap-3 px-4 py-3 text-sm sm:grid-cols-5">
          {[
            ["Base", `$${pay.base}`],
            ["Retention", `$${pay.retention}`],
            ["Commission", `$${pay.commission}`],
            ["Penalties", `$${pay.penalties}`],
          ].map(([k, val]) => (
            <div key={k} className="rounded bg-muted/50 p-2">
              <div className="text-xs text-muted-foreground">{k}</div>
              <div className="text-lg font-semibold">{val}</div>
            </div>
          ))}
          <div className="rounded bg-foreground p-2 text-background">
            <div className="text-xs opacity-80">On track this month</div>
            <div className="text-lg font-semibold">${pay.total}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm">
          <div>
            {target > 0 ? (
              gap > 0 ? (
                <>
                  <span className="font-semibold text-rose-600">
                    ${gap} short
                  </span>{" "}
                  of your ${target} target, that is {Math.ceil(gap / 250)}{" "}
                  referrals, or {Math.ceil(gap / 350)} UGC packs, or{" "}
                  {Math.ceil(gap / 150)} video testimonials.
                </>
              ) : (
                <span className="font-semibold text-teal-700">
                  Target hit, ${-gap} over.
                </span>
              )
            ) : (
              "Set a target above and I will tell you exactly what closes the gap."
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

export const StartOfDayPage = () => <CsmPage section="start" />;
export const ClientsPage = () => <CsmPage section="clients" />;
export const TaskListPage = () => <CsmPage section="tasks" />;
export const HotListPage = () => <CsmPage section="hot" />;
export const KeyLinksPage = () => <CsmPage section="links" />;
export const MyMoneyPage = () => <CsmPage section="money" />;
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
    <label className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs">
      <span>{label}</span>
      <select
        className="rounded border bg-background px-2 py-1 text-xs"
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        {["Y", "N", "NA"].map(x => (
          <option key={x}>{x}</option>
        ))}
      </select>
    </label>
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
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Your calls today</h2>
        <span className="text-xs text-muted-foreground">
          Live from the client booking calendars
        </span>
      </div>
      {todays.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Nothing booked today. If a client is due a call, book it from the touchpoints
          screen.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {todays.map(a => (
            <li key={a._id} className="rounded border px-3 py-2 text-sm">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-semibold">{apptTime(a.startTime)}</span>
                <span>{CALL_LABEL[a.kind] ?? "Call"}</span>
                <span className="text-muted-foreground">
                  {a.clientName ?? a.contactName ?? a.title}
                </span>
                {a.joinUrl ? (
                  <a
                    className="text-blue-700 underline"
                    href={a.joinUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Join
                  </a>
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
        <p className="mt-3 text-xs text-muted-foreground">
          Coming up:{" "}
          {next
            .map(
              a =>
                `${a.day.slice(5)} ${apptTime(a.startTime)} ${
                  a.clientName ?? a.contactName ?? a.title
                }`,
            )
            .join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
