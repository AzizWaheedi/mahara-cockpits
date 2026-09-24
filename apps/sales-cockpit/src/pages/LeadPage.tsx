import { ArrowLeft, Copy, ExternalLink, Phone, ScrollText } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link, useParams } from "react-router";
import { AdOrigin } from "../components/AdOrigin";
import {
  EmptyState,
  Failed,
  SectionCard,
  StatusChip,
  type Tone,
} from "../components/kit";
import { LeadTimeline, type LiveMessage } from "../components/LeadTimeline";
import { CrmLine, MarkControls } from "../components/MarkControls";
import { NotesPanel } from "../components/NotesPanel";
import { ProposalPanel } from "../components/ProposalPanel";
import { api } from "../lib/api";
import { useLead, useLeadActivity, useTeam } from "../lib/data";
import {
  ago,
  callType,
  classLabel,
  day,
  isArabic,
  plainStage,
  statusLabel,
  when,
} from "../lib/format";
import { toast } from "../lib/toast";
import type { CalendarRow, Lead, Me } from "../lib/types";

const GHL_LOCATION = "7NI8yyJtwsh2OOWA5Icr";

interface Live {
  contact: { tags: string[]; dnd: boolean | null; assigned_to: string | null };
  contact_error: string | null;
  conversations: {
    id: string;
    type: string | null;
    unread: number;
    inbound_whatsapp_at: string | null;
  }[];
  conversations_error: string | null;
  messages: LiveMessage[];
  messages_error: string | null;
  read_at: string;
}

const CLASS_TONE: Record<string, Tone> = {
  qualified: "good",
  unqualified: "neutral",
  unprepared: "warning",
};

/** One lead: who they are, what they said, where they came from, everything since. */
export default function LeadPage({ me }: { me: Me }) {
  const { contactId = "" } = useParams();
  const lead = useLead(contactId);
  const activity = useLeadActivity(contactId, lead.data?.phone8 ?? null);
  const team = useTeam();
  const [live, setLive] = useState<Live | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);

  const loadLive = useCallback(async () => {
    setLiveError(null);
    try {
      const out = await api<{ live: Live }>("lead.live", {
        contact_id: contactId,
      });
      setLive(out.live);
    } catch (e) {
      setLiveError(String((e as Error).message ?? e));
    }
  }, [contactId]);

  useEffect(() => {
    setLive(null);
    void loadLive();
  }, [loadLive]);

  // While a proposal is being written, look again every 15 seconds.
  const drafting = (activity.data?.proposals ?? []).some(
    p => p.status === "drafting",
  );
  useEffect(() => {
    if (!drafting) return;
    const t = window.setInterval(() => activity.reload(), 15_000);
    return () => window.clearInterval(t);
  }, [drafting, activity.reload]);

  const ownerName = useMemo(() => {
    const id = live?.contact.assigned_to ?? lead.data?.assigned_to;
    if (!id) return null;
    return (team.data ?? []).find(t => t.ghl_user_id === id)?.name ?? null;
  }, [team.data, live, lead.data]);

  if (lead.error)
    return (
      <Page>
        <Failed what="This lead" error={lead.error} retry={lead.reload} />
      </Page>
    );
  if (lead.loading && !lead.data)
    return (
      <Page>
        <p className="muted text-sm">Loading the lead…</p>
      </Page>
    );
  if (!lead.data)
    return (
      <Page>
        <EmptyState
          title="This lead is not in the cockpit"
          text="It may have been deleted in HighLevel, or it arrived in the last few minutes and has not been copied yet. Try again shortly."
        />
      </Page>
    );

  const l = lead.data;
  const a = activity.data;
  const appointments = a?.appointments ?? [];
  const nextAppt = [...appointments]
    .filter(
      r =>
        r.start_at &&
        Date.parse(r.start_at) > Date.now() &&
        r.status !== "cancelled",
    )
    .sort(
      (x, y) => Date.parse(String(x.start_at)) - Date.parse(String(y.start_at)),
    )[0];
  const lastDemo = appointments.find(r => r.call_type === "demo");
  const owed = appointments.filter(r => r.needs_mark);
  const whatsappOpen = live?.conversations.some(
    c =>
      c.inbound_whatsapp_at &&
      Date.now() - Date.parse(c.inbound_whatsapp_at) < 24 * 3_600_000,
  );

  return (
    <Page>
      <Link
        to="/leads"
        className="muted inline-flex items-center gap-1 text-sm hover:underline"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> Leads
      </Link>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1
            className={`text-2xl font-semibold tracking-tight ${isArabic(l.name) ? "ar" : ""}`}
            dir="auto"
          >
            {l.name ?? "Unnamed lead"}
          </h1>
          <StatusChip
            size="md"
            tone={CLASS_TONE[String(l.lead_class)] ?? "neutral"}
            label={classLabel(l.lead_class)}
          />
          {l.stage_name ? (
            <StatusChip
              size="md"
              tone="neutral"
              label={plainStage(l.stage_name)}
            />
          ) : null}
          {live?.contact.dnd || l.dnd ? (
            <StatusChip
              size="md"
              tone="critical"
              label="Do not disturb is on"
              title="HighLevel will not send this lead messages."
            />
          ) : null}
        </div>
        <p className="muted text-sm">
          {[
            l.company,
            l.country,
            `came in ${ago(l.lead_created_at)}`,
            ownerName ? `owner ${ownerName}` : "no owner",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/call/${l.contact_id}?script=${callScript(me, appointments)}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] bg-[color:var(--primary)] px-3 text-[13px] font-semibold text-[color:var(--primary-foreground)] hover:opacity-90"
          >
            <ScrollText className="size-3.5" aria-hidden />
            {callScript(me, appointments) === "demo"
              ? "Open the demo script"
              : "Open the intro script"}
          </Link>
          {l.phone ? (
            <CopyChip icon={Phone} text={l.phone} label="Copy the number" />
          ) : null}
          {l.email ? <CopyChip text={l.email} label="Copy the email" /> : null}
          {me.manager || me.role === "closer" || me.role === "both" ? (
            <a
              href={newClientFormUrl(l, appointments, me)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border hairline px-2.5 text-[13px] hover:bg-[color:var(--secondary)]"
              title="Opens the New Client Form with this lead, the closer and the setter already filled in, so the signed client links back to this call."
            >
              New client form <ExternalLink className="size-3.5" aria-hidden />
            </a>
          ) : null}
          <a
            href={`https://app.gohighlevel.com/v2/location/${GHL_LOCATION}/contacts/detail/${l.contact_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border hairline px-2.5 text-[13px] hover:bg-[color:var(--secondary)]"
          >
            Open in HighLevel <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>
      </header>

      {owed.length ? (
        <SectionCard title="Mark this call">
          <ul className="space-y-3">
            {owed.map(r => (
              <li
                key={r.appointment_id}
                className="flex flex-col gap-2 sm:flex-row sm:items-center"
              >
                <p className="min-w-0 flex-1 text-sm">
                  {callType(r.call_type)} · {when(r.start_at)}
                  {r.assigned_user_name ? (
                    <span className="muted"> · {r.assigned_user_name}</span>
                  ) : null}
                </p>
                <MarkControls row={r} onDone={() => activity.reload()} />
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="min-w-0 space-y-5 xl:col-span-4">
          <SectionCard title="What they told us">
            <Answers lead={l} />
          </SectionCard>
          <SectionCard title="Where they came from">
            <AdOrigin lead={l} />
          </SectionCard>
          <SectionCard title="Calls on the calendar" flush>
            <Appointments rows={appointments} reload={activity.reload} />
          </SectionCard>
        </div>

        <div className="min-w-0 space-y-5 xl:col-span-5">
          <SectionCard
            title="Everything so far"
            side={
              live ? (
                <span className="muted text-xs">
                  messages read {ago(live.read_at)}
                </span>
              ) : null
            }
          >
            {liveError ? (
              <p className="callout-warn mb-3 rounded-[var(--radius-md)] border px-3 py-2 text-xs">
                The conversation could not be read from HighLevel: {liveError}{" "}
                <button type="button" onClick={loadLive} className="underline">
                  Try again
                </button>
              </p>
            ) : !live ? (
              <p className="muted mb-3 text-xs">
                Reading the conversation from HighLevel…
              </p>
            ) : live.messages_error || live.conversations_error ? (
              <p className="callout-warn mb-3 rounded-[var(--radius-md)] border px-3 py-2 text-xs">
                Part of the conversation could not be read:{" "}
                {live.messages_error ?? live.conversations_error}
              </p>
            ) : null}
            {live && !whatsappOpen ? (
              <p className="muted mb-3 text-xs">
                The lead has not written on WhatsApp in the last 24 hours, so
                WhatsApp will only take an approved template.
              </p>
            ) : null}
            {activity.error ? (
              <Failed
                what="This lead's history"
                error={activity.error}
                retry={activity.reload}
              />
            ) : (
              <LeadTimeline
                appointments={appointments}
                dials={a?.dials ?? []}
                deals={a?.deals ?? []}
                proposals={a?.proposals ?? []}
                messages={live?.messages ?? []}
              />
            )}
          </SectionCard>
        </div>

        <div className="min-w-0 space-y-5 xl:col-span-3">
          {nextAppt ? (
            <SectionCard title="Next call">
              <p className="text-sm font-medium">
                {callType(nextAppt.call_type)} · {when(nextAppt.start_at)}
              </p>
              <p className="muted text-xs">
                {nextAppt.assigned_user_name ?? "No rep assigned"} ·{" "}
                {statusLabel(nextAppt.status)}
              </p>
            </SectionCard>
          ) : null}
          <SectionCard title="Notes">
            <NotesPanel
              me={me}
              contactId={l.contact_id}
              notes={a?.notes ?? []}
              onChange={activity.reload}
            />
          </SectionCard>
          <SectionCard title="Proposal">
            <ProposalPanel
              me={me}
              contactId={l.contact_id}
              appointmentId={lastDemo?.appointment_id ?? null}
              proposals={a?.proposals ?? []}
              recordings={a?.recordings ?? []}
              requests={a?.requests ?? []}
              onChange={activity.reload}
            />
          </SectionCard>
        </div>
      </div>
      <p className="muted text-xs">
        Copied from the CRM {ago(l.mirrored_at)}. Calls, bookings and deals come
        from B2B, which reads HighLevel every 15 minutes; messages are read from
        HighLevel when this page opens.
      </p>
    </Page>
  );
}

/**
 * The New Client Form with its hidden fields filled (added 2026-09-24 at
 * Aziz's word): the contact, the closer and the setter, so a signed client
 * links back to the lead and both reps get the credit without guessing.
 */
function newClientFormUrl(
  l: Lead,
  appointments: CalendarRow[],
  me: Me,
): string {
  const demo = appointments.find(a => a.call_type === "demo");
  const intro = appointments.find(a => a.call_type === "intro");
  const closer = demo?.assigned_user_name || me.name || "";
  const setter = l.setter_name || intro?.assigned_user_name || "";
  const hash = new URLSearchParams({
    contact_id: l.contact_id,
    closer,
    setter,
  });
  return `https://maharamedia.typeform.com/to/BTzMwXiw#${hash.toString()}`;
}

/** Which script this lead's next call needs: the demo once one is booked or held. */
function callScript(me: Me, appointments: CalendarRow[]): "intro" | "demo" {
  if (me.role === "closer") return "demo";
  if (me.role === "setter") return "intro";
  return appointments.some(a => a.call_type === "demo") ? "demo" : "intro";
}

function Page({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 md:px-6">
      {children}
    </main>
  );
}

const ANSWERS: [keyof Lead, string][] = [
  ["revenue", "Yearly revenue"],
  ["revenue_goal", "Revenue goal"],
  ["readiness", "Ready to invest"],
  ["decision_maker", "Decision maker"],
  ["challenge", "Biggest challenge"],
  ["grade", "Appointment grade"],
  ["setter_name", "Setter"],
];

function Answers({ lead }: { lead: Lead }) {
  const rows = ANSWERS.map(([k, label]) => [label, lead[k]] as const).filter(
    ([, v]) => v !== null && v !== undefined && String(v).trim() !== "",
  );
  const services =
    lead.services && lead.services.trim() !== "Yes" ? lead.services : null;
  if (!rows.length && !services)
    return (
      <p className="muted text-sm">
        No form answers on this contact. They may have booked without the
        qualification form.
      </p>
    );
  return (
    <dl className="space-y-2.5">
      {rows.map(([label, v]) => (
        <div key={label}>
          <dt className="muted text-xs">{label}</dt>
          <dd
            className={`text-sm ${isArabic(String(v)) ? "ar" : ""}`}
            dir="auto"
          >
            {String(v)}
          </dd>
        </div>
      ))}
      {services ? (
        <div>
          <dt className="muted text-xs">What they do</dt>
          <dd className="text-sm" dir="auto">
            {services}
          </dd>
        </div>
      ) : null}
      {lead.lead_created_at ? (
        <p className="muted pt-1 text-xs">
          Answered when they came in, {day(lead.lead_created_at)}.
        </p>
      ) : null}
    </dl>
  );
}

function Appointments({
  rows,
  reload,
}: {
  rows: CalendarRow[];
  reload: () => void;
}) {
  if (!rows.length)
    return (
      <p className="muted px-4 py-3 text-sm">
        No calls booked. A setter books the intro from the dialer or HighLevel.
      </p>
    );
  return (
    <ul className="divide-y hairline">
      {rows.map(r => (
        <li key={r.appointment_id} className="space-y-1 px-4 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {callType(r.call_type)} · {when(r.start_at)}
            </p>
            {r.needs_mark ? (
              <StatusChip tone="warning" label="Not marked" />
            ) : (
              <StatusChip
                tone={
                  r.status === "showed"
                    ? "good"
                    : r.status === "noshow"
                      ? "critical"
                      : r.status === "invalid"
                        ? "serious"
                        : "neutral"
                }
                label={statusLabel(r.status)}
              />
            )}
          </div>
          <p className="muted text-xs">
            {r.assigned_user_name ?? "No rep assigned"}
          </p>
          <CrmLine row={r} onRetried={reload} />
        </li>
      ))}
    </ul>
  );
}

function CopyChip({
  text,
  label,
  icon: Icon,
}: {
  text: string;
  label: string;
  icon?: typeof Phone;
}) {
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast.success("Copied.");
        } catch {
          toast.error("The browser would not copy. Select the text instead.");
        }
      }}
      className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-[var(--radius-md)] border hairline px-2.5 text-[13px] hover:bg-[color:var(--secondary)]"
      title={label}
    >
      {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
      <span className="truncate tabular-nums" dir="ltr">
        {text}
      </span>
      <Copy className="muted size-3 shrink-0" aria-hidden />
    </button>
  );
}
