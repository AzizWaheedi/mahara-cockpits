import {
  CalendarPlus,
  FileText,
  Handshake,
  type LucideIcon,
  MessageCircle,
  Phone,
} from "lucide-react";
import { useMemo, useState } from "react";
import { callType, duration, money, statusLabel, when } from "../lib/format";
import type { CalendarRow, Deal, Dial, Proposal } from "../lib/types";
import { FilterChip } from "./kit";

/** A message as the server trims it from HighLevel's conversation. */
export interface LiveMessage {
  id: string | null;
  direction: "inbound" | "outbound" | null;
  type: string | null;
  status: string | null;
  at: string | null;
  body: string | null;
  has_attachments: boolean;
  source: string | null;
}

type Kind = "call" | "message" | "appointment" | "deal" | "proposal";

interface Item {
  key: string;
  at: string;
  kind: Kind;
  icon: LucideIcon;
  title: string;
  meta?: string;
  body?: string | null;
  bodyAr?: string | null;
  tone?: "in" | "out";
}

const CHANNEL: [RegExp, string][] = [
  [/WHATSAPP/, "WhatsApp"],
  [/EMAIL/, "Email"],
  [/SMS/, "SMS"],
  [/CALL/, "Call"],
  [/FACEBOOK/, "Facebook"],
  [/INSTAGRAM/, "Instagram"],
  [/CUSTOM/, "Other channel"],
];

function channel(t: string | null): string {
  const s = String(t ?? "").toUpperCase();
  return CHANNEL.find(([re]) => re.test(s))?.[1] ?? "Message";
}

const STATE_WORDS: Record<string, string> = {
  completed: "answered",
  no_answer: "no answer",
  abandoned: "hung up before answer",
  busy: "busy",
  blocked: "blocked",
  failed: "failed",
  serviced: "answered",
};

/**
 * Everything that happened with the lead, newest first, in one list: calls
 * from Maqsam (with Maqsam's own summary), messages from HighLevel,
 * bookings, the signed deal and proposals. Notes have their own panel.
 */
export function LeadTimeline({
  appointments,
  dials,
  deals,
  proposals,
  messages,
}: {
  appointments: CalendarRow[];
  dials: Dial[];
  deals: Deal[];
  proposals: Proposal[];
  messages: LiveMessage[];
}) {
  const [only, setOnly] = useState<"all" | Kind>("all");
  const items = useMemo(() => {
    const out: Item[] = [];
    for (const d of dials) {
      if (!d.occurred_at) continue;
      const answered = d.state === "completed" || d.state === "serviced";
      out.push({
        key: `d${d.call_id}`,
        at: d.occurred_at,
        kind: "call",
        icon: Phone,
        tone: d.direction === "inbound" ? "in" : "out",
        title: `${d.direction === "inbound" ? "Call from the lead" : "Call"}${
          d.agent_name ? ` · ${d.agent_name}` : ""
        }`,
        meta: `${STATE_WORDS[String(d.state)] ?? d.state ?? ""}${
          answered && d.duration_s ? ` · ${duration(d.duration_s)}` : ""
        }${d.sentiment ? ` · ${d.sentiment}` : ""}`,
        body: d.summary_en,
        bodyAr: d.summary_ar,
      });
    }
    for (const m of messages) {
      if (!m.at || /ACTIVITY/i.test(String(m.type))) continue;
      out.push({
        key: `m${m.id}`,
        at: m.at,
        kind: "message",
        icon: MessageCircle,
        tone: m.direction === "inbound" ? "in" : "out",
        title: `${channel(m.type)} ${m.direction === "inbound" ? "from the lead" : "to the lead"}`,
        meta: [m.status, m.has_attachments ? "with an attachment" : null]
          .filter(Boolean)
          .join(" · "),
        body: m.body,
      });
    }
    for (const a of appointments) {
      if (a.booked_at)
        out.push({
          key: `b${a.appointment_id}`,
          at: a.booked_at,
          kind: "appointment",
          icon: CalendarPlus,
          title: `${callType(a.call_type)} booked for ${when(a.start_at)}`,
          meta: a.assigned_user_name
            ? `with ${a.assigned_user_name}`
            : undefined,
        });
      if (a.start_at && Date.parse(a.start_at) <= Date.now())
        out.push({
          key: `a${a.appointment_id}`,
          at: a.start_at,
          kind: "appointment",
          icon: CalendarPlus,
          title: `${callType(a.call_type)}: ${a.needs_mark ? "not marked yet" : statusLabel(a.status)}`,
          meta: a.marked_by
            ? `marked by ${a.marked_by.split("@")[0]}`
            : undefined,
        });
    }
    for (const d of deals) {
      if (!d.submitted_at) continue;
      out.push({
        key: `s${d.response_id}`,
        at: d.submitted_at,
        kind: "deal",
        icon: Handshake,
        title: d.voided ? "Signed, then voided" : "Signed",
        meta: `${money(d.contracted_revenue)} contract · ${money(d.cash_collected)} collected${
          d.closer ? ` · closed by ${d.closer}` : ""
        }`,
      });
    }
    for (const p of proposals) {
      out.push({
        key: `p${p.id}`,
        at: p.sent_at ?? p.created_at,
        kind: "proposal",
        icon: FileText,
        title: p.sent_at ? "Proposal sent" : "Proposal drafted",
        meta: `${p.lang === "ar" ? "Arabic" : "English"} · ${p.created_by.split("@")[0]}`,
      });
    }
    return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }, [appointments, dials, deals, proposals, messages]);

  const shown = only === "all" ? items : items.filter(i => i.kind === only);
  const filters: ["all" | Kind, string][] = [
    ["all", "All"],
    ["call", "Calls"],
    ["message", "Messages"],
    ["appointment", "Bookings"],
    ["deal", "Deals"],
  ];

  return (
    <div>
      <div
        className="no-scrollbar mb-4 flex flex-nowrap gap-2 overflow-x-auto"
        role="group"
        aria-label="Show"
      >
        {filters.map(([k, label]) => (
          <FilterChip key={k} on={only === k} onClick={() => setOnly(k)}>
            {label}
          </FilterChip>
        ))}
      </div>
      {shown.length ? (
        <ol className="relative space-y-3 border-l hairline pl-5">
          {shown.map(i => (
            <TimelineRow key={i.key} i={i} />
          ))}
        </ol>
      ) : (
        <p className="muted text-sm">Nothing here yet.</p>
      )}
    </div>
  );
}

function TimelineRow({ i }: { i: Item }) {
  const [ar, setAr] = useState(false);
  const Icon = i.icon;
  const body = ar && i.bodyAr ? i.bodyAr : (i.body ?? i.bodyAr);
  return (
    <li className="relative">
      <span
        aria-hidden
        className="absolute top-0.5 -left-[1.95rem] flex size-5 items-center justify-center rounded-full border hairline bg-[color:var(--card)]"
      >
        <Icon className="size-3" />
      </span>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <p className="text-sm font-medium">{i.title}</p>
        <p className="muted text-xs tabular-nums">{when(i.at)}</p>
      </div>
      {i.meta ? <p className="muted text-xs">{i.meta}</p> : null}
      {body ? (
        <p className="mt-1 line-clamp-6 whitespace-pre-wrap text-sm" dir="auto">
          {body}
        </p>
      ) : null}
      {i.body && i.bodyAr ? (
        <button
          type="button"
          onClick={() => setAr(v => !v)}
          className="muted mt-0.5 text-xs underline"
        >
          {ar ? "Show in English" : "Show in Arabic"}
        </button>
      ) : null}
    </li>
  );
}
