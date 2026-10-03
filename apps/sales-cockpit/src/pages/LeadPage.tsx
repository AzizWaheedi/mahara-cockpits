import {
  ArrowLeft,
  ArrowUpRight,
  ClipboardList,
  Copy,
  Phone,
  ScrollText,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { AdOrigin } from "../components/AdOrigin";
import { ProofToSend } from "../components/AssetPicker";
import { CallNotesList, useCallNotes } from "../components/CallNotes";
import {
  ClientFormSheet,
  ClientFormStatus,
} from "../components/ClientFormSheet";
import {
  ContractPanel,
  canContract,
  useContracts,
} from "../components/ContractPanel";
import { Conversation, useConversation } from "../components/Conversation";
import { HotControl } from "../components/HotList";
import {
  button,
  buttonPrimary,
  EmptyState,
  Failed,
  Parts,
  pageWide,
  Reading,
  SectionCard,
  StatusChip,
  type Tone,
} from "../components/kit";
import { Answers } from "../components/LeadAnswers";
import { LeadRecordings } from "../components/LeadRecordings";
import { LeadTimeline, type LiveMessage } from "../components/LeadTimeline";
import { CrmLine, MarkControls } from "../components/MarkControls";
import { NotesPanel } from "../components/NotesPanel";
import { ProposalPanel } from "../components/ProposalPanel";
import { AskReference } from "../components/References";
import { ResearchPanel } from "../components/ResearchPanel";
import { RoomPanel } from "../components/RoomPanel";
import {
  LiveAskForm,
  useLeadRoom,
  useRoomsSetup,
  VideoCallMenu,
  VideoPicker,
} from "../components/VideoLink";
import { assetStage, objectionsFrom } from "../lib/assets";
import {
  type ClientFormSent,
  type ClientFormSetting,
  hiddenFields,
} from "../lib/clientForm";
import { CLIENT_NOTE, isClient } from "../lib/clients";
import {
  useClientForms,
  useLead,
  useLeadActivity,
  useSetting,
  useTeam,
} from "../lib/data";
import {
  ago,
  callType,
  classLabel,
  isArabic,
  plainStage,
  statusLabel,
  when,
} from "../lib/format";
import { ghlContactUrl } from "../lib/highlevel";
import { toast } from "../lib/toast";
import type { CalendarRow, Deal, Lead, Me } from "../lib/types";
import {
  linkPlanLine,
  type MenuKey,
  providerChoice,
  videoLinkGate,
} from "../lib/videoLink";
import { leadLanguage } from "../lib/whatsapp";

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
  // One read of HighLevel feeds the conversation, the timeline's messages,
  // the owner and the do-not-disturb flag.
  const convo = useConversation(contactId);
  const callNotes = useCallNotes(contactId);
  const pipeline = useSetting<{ roles?: Record<string, string> }>("pipeline");
  // The New Client Form: its questions, this lead's contracts and the forms
  // already sent, for the sheet and its card.
  const formSetting = useSetting<ClientFormSetting>("client_form");
  const leadContracts = useContracts(contactId);
  const clientForms = useClientForms(contactId);
  const [formOpen, setFormOpen] = useState(false);
  // The "Video call" menu (C42): the room for this lead, the picker, or a
  // live option's note, under the header.
  const roomsSetup = useRoomsSetup();
  const video = useLeadRoom(contactId);
  const [videoOpen, setVideoOpen] = useState<MenuKey | null>(null);
  const [videoSaid, setVideoSaid] = useState<string | null>(null);
  // A sales asset's message from "Proof to send", or a contract's link.
  const [convoPrefill, setConvoPrefill] = useState<{
    text: string;
    asset?: { id: string; url: string | null } | null;
    nonce: number;
  } | null>(null);
  const convoRef = useRef<HTMLDivElement>(null);
  const live = convo.data;
  const timelineMessages: LiveMessage[] = useMemo(
    () =>
      convo.thread.map(m => ({
        id: m.id,
        direction: m.direction,
        type: m.type,
        status: m.status,
        at: m.at,
        body: m.body,
        has_attachments: m.attachments.length > 0,
        source: m.source,
      })),
    [convo.thread],
  );

  // While a proposal is being written, look again every 15 seconds.
  const drafting = (activity.data?.proposals ?? []).some(
    p => p.status === "drafting",
  );
  useEffect(() => {
    if (!drafting) return;
    const t = window.setInterval(() => activity.reload(), 15_000);
    return () => window.clearInterval(t);
  }, [drafting, activity.reload]);

  // Who owns the lead, in words. A lead with an owner is never "no owner"
  // because the team list is still on its way, failed, or lacks that user.
  const owner = useMemo(() => {
    const id = live?.contact.assigned_to ?? lead.data?.assigned_to;
    if (!id) return "no owner";
    if (team.error) return "owner's name could not be read";
    if (!team.data) return null;
    const name = team.data.find(t => t.ghl_user_id === id)?.name;
    return name ? `owner ${name}` : "owner has no seat in the cockpit";
  }, [team.data, team.error, live, lead.data]);

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
  // The lead's calls, notes, recordings and proposals have not come back yet.
  const reading = !a && !activity.error;
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
  const people = formPeople(l, appointments, me);
  const owed = appointments.filter(r => r.needs_mark);
  const gate = videoLinkGate({
    setting: roomsSetup.rooms,
    contactId: l.contact_id,
    seatEmail: me.email,
    purpose: "manual",
    client: isClient(l),
    dnd: Boolean(live?.contact.dnd || l.dnd),
    bookedDemo: nextAppt?.call_type === "demo",
  });
  const choice = roomsSetup.rooms
    ? providerChoice({
        setting: roomsSetup.rooms,
        role: me.role === "closer" ? "closer" : "setter",
        me: video.presence,
        kind: "intro",
      })
    : null;
  const linkShown = gate.show && choice !== null && !video.open;

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
          {isClient(l) ? (
            <StatusChip
              size="md"
              tone="good"
              label="Active client"
              title={CLIENT_NOTE}
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
          <Parts
            items={[
              l.company,
              l.country,
              l.lead_created_at
                ? `came in ${ago(l.lead_created_at)}`
                : "not known when it came in",
              owner,
              nextAppt
                ? `${callType(nextAppt.call_type)} booked ${when(nextAppt.start_at)}`
                : null,
            ]}
          />
        </p>
        {isClient(l) ? (
          <p className="muted text-sm">{CLIENT_NOTE}</p>
        ) : (
          <HotControl
            me={me}
            contactId={l.contact_id}
            name={l.name}
            phone8={l.phone8}
          />
        )}
        <div className="flex flex-wrap gap-2">
          {/* No sales call script for an active client. */}
          {isClient(l) ? null : (
            <Link
              to={`/call/${l.contact_id}?script=${callScript(me, appointments)}`}
              className={buttonPrimary}
            >
              <ScrollText className="size-3.5" aria-hidden />
              {callScript(me, appointments) === "demo"
                ? "Open the demo script"
                : "Open the intro script"}
            </Link>
          )}
          {l.phone ? (
            <CopyChip icon={Phone} text={l.phone} label="Copy the number" />
          ) : null}
          {l.email ? <CopyChip text={l.email} label="Copy the email" /> : null}
          <VideoCallMenu
            linkShown={linkShown}
            liveOn={roomsSetup.liveOn && !isClient(l)}
            onPick={key => {
              setVideoSaid(null);
              setVideoOpen(key);
            }}
          />
          {canContract(me) ? (
            <button
              type="button"
              className={button}
              onClick={() => setFormOpen(true)}
              title="The New Client Form, with this lead, the closer and the setter already set, and the answers the cockpit knows beside it."
            >
              <ClipboardList className="size-3.5" aria-hidden />
              New client form
            </button>
          ) : null}
          <a
            href={ghlContactUrl(l.contact_id)}
            target="_blank"
            rel="noopener noreferrer"
            className={button}
          >
            Open in HighLevel <ArrowUpRight className="size-3.5" aria-hidden />
          </a>
        </div>
      </header>

      {/* A room still running always shows; a closed one gives way to the
          menu's next choice. */}
      {video.room && (video.open || videoOpen === null) ? (
        <RoomPanel
          room={video.room}
          request={video.request}
          onRoomChange={r => video.setRoom(r)}
        />
      ) : videoOpen === "link" && linkShown && choice ? (
        <VideoPicker
          contactId={l.contact_id}
          purpose="manual"
          callKind="intro"
          trigger="manual"
          choice={choice}
          planLine={
            roomsSetup.rooms
              ? linkPlanLine({
                  setting: roomsSetup.rooms,
                  whatsapp: live?.channels.whatsapp,
                  email: live?.channels.email,
                  guardOpen: roomsSetup.guard,
                  templateLive: roomsSetup.templateLive,
                })
              : null
          }
          onRoom={(room, ask) => {
            video.setRoom(room, ask);
            setVideoOpen(null);
          }}
          onCancel={() => setVideoOpen(null)}
        />
      ) : (videoOpen === "demo_now" || videoOpen === "intro_now") &&
        roomsSetup.liveOn ? (
        <LiveAskForm
          contactId={l.contact_id}
          kind={videoOpen}
          onDone={line => {
            setVideoOpen(null);
            setVideoSaid(line);
          }}
          onCancel={() => setVideoOpen(null)}
        />
      ) : videoSaid ? (
        <p
          role="status"
          className="callout-good rounded-[var(--radius-md)] border px-3 py-2 text-sm"
        >
          {videoSaid}
        </p>
      ) : null}

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
                    <span className="muted">
                      {" · "}
                      <bdi>{r.assigned_user_name}</bdi>
                    </span>
                  ) : null}
                </p>
                <MarkControls row={r} onDone={() => activity.reload()} />
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12 xl:gap-6">
        <div className="min-w-0 space-y-4 xl:col-span-4 xl:space-y-6">
          <SectionCard title="What they told us">
            <Answers lead={l} />
          </SectionCard>
          <SectionCard title="Where they came from">
            <AdOrigin lead={l} />
          </SectionCard>
          <SectionCard title="Calls on the calendar" flush>
            <Appointments
              rows={a ? appointments : null}
              error={activity.error}
              reload={activity.reload}
            />
          </SectionCard>
        </div>

        <div className="min-w-0 space-y-4 xl:col-span-5 xl:space-y-6">
          <div ref={convoRef}>
            <SectionCard title="Conversation">
              <Conversation
                contactId={l.contact_id}
                convo={convo}
                rep={me.name}
                callAt={nextAppt?.start_at ?? null}
                country={l.country}
                prefill={convoPrefill}
              />
            </SectionCard>
          </div>
          <SectionCard title="Everything so far">
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
                messages={timelineMessages}
                loading={reading}
                // The conversation card says when a later read fails; the
                // history says so only when it has none of the messages.
                messagesLoading={!convo.data && !convo.error}
                messagesError={convo.data ? null : convo.error}
                messagesRetry={() => void convo.reload()}
              />
            )}
          </SectionCard>
          <SectionCard title="Recorded calls">
            <LeadRecordings
              contactId={l.contact_id}
              recordings={a?.recordings ?? []}
              loading={reading}
              error={activity.error}
              retry={activity.reload}
            />
          </SectionCard>
        </div>

        <div className="min-w-0 space-y-4 xl:col-span-3 xl:space-y-6">
          <SectionCard title="Proof to send">
            <ProofToSend
              contactId={l.contact_id}
              language={leadLanguage(
                convo.thread
                  .filter(m => m.direction === "inbound")
                  .map(m => m.body),
              )}
              stage={assetStage(
                pipeline.data?.roles?.[String(l.stage_id ?? "")] ?? null,
              )}
              objections={objectionsFrom(
                (callNotes.data ?? []).flatMap(n =>
                  (n.notes.objections ?? []).map(o => o.objection),
                ),
              )}
              onUse={(text, a) => {
                setConvoPrefill({
                  text,
                  asset: { id: a.id, url: a.url },
                  nonce: Date.now(),
                });
                convoRef.current?.scrollIntoView({
                  block: "start",
                  behavior: "smooth",
                });
              }}
            />
            <div className="mt-3">
              <AskReference contactId={l.contact_id} />
            </div>
          </SectionCard>
          <SectionCard title="What the calls told us">
            {callNotes.error ? (
              <Failed
                what="The call notes"
                error={callNotes.error}
                retry={callNotes.reload}
              />
            ) : (
              <CallNotesList
                notes={callNotes.data ?? []}
                loading={!callNotes.data}
              />
            )}
          </SectionCard>
          <SectionCard title="Research">
            <ResearchPanel contactId={l.contact_id} me={me} />
          </SectionCard>
          <SectionCard title="Notes">
            <NotesPanel
              me={me}
              contactId={l.contact_id}
              notes={a?.notes ?? []}
              onChange={activity.reload}
              loading={reading}
              error={activity.error}
              retry={activity.reload}
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
              loading={reading}
              error={activity.error}
              retry={activity.reload}
            />
          </SectionCard>
          <SectionCard title="Contract">
            <ContractPanel
              me={me}
              contactId={l.contact_id}
              company={l.company}
              hasEmail={Boolean(l.email?.trim())}
              language={leadLanguage(
                convo.thread
                  .filter(m => m.direction === "inbound")
                  .map(m => m.body),
              )}
              onShare={text => {
                setConvoPrefill({ text, nonce: Date.now() });
                convoRef.current?.scrollIntoView({
                  block: "start",
                  behavior: "smooth",
                });
              }}
            />
          </SectionCard>
          <SectionCard title="New client form">
            <ClientFormStatus
              sent={clientForms.data}
              deals={a?.deals ?? []}
              signedAt={
                (leadContracts.data ?? []).find(c => c.status === "completed")
                  ?.signed_at ?? null
              }
              canFill={canContract(me)}
              onFill={() => setFormOpen(true)}
            />
          </SectionCard>
        </div>
      </div>
      {canContract(me) ? (
        <ClientFormSheet
          open={formOpen}
          onClose={() => setFormOpen(false)}
          setting={formSetting.data}
          ctx={{
            lead: l,
            closer: people.closer,
            contracts: leadContracts.data ?? [],
            recordings: a?.recordings ?? [],
          }}
          hidden={hiddenFields(l, people.closer, people.setter)}
          already={alreadySent(clientForms.data, a?.deals ?? [])}
          onSent={() => {
            clientForms.reload();
            activity.reload();
          }}
        />
      ) : null}
      <p className="muted text-xs">
        Copied from the CRM {ago(l.mirrored_at)}. Calls, bookings and deals come
        from B2B, which reads HighLevel every 15 minutes; messages are read from
        HighLevel when this page opens.
      </p>
    </Page>
  );
}

/**
 * Who the New Client Form names in its hidden fields (since 2026-09-24, at
 * Aziz's word): the demo's closer and the intro's setter, so a signed client
 * links back to the lead and both reps get the credit without guessing.
 */
function formPeople(
  l: Lead,
  appointments: CalendarRow[],
  me: Me,
): { closer: string; setter: string } {
  const demo = appointments.find(a => a.call_type === "demo");
  const intro = appointments.find(a => a.call_type === "intro");
  return {
    closer: demo?.assigned_user_name || me.name || "",
    setter: l.setter_name || intro?.assigned_user_name || "",
  };
}

/** A New Client Form already in for this lead: the cockpit's own note, or the deal B2B has. */
function alreadySent(
  sent: ClientFormSent[] | null,
  deals: Deal[],
): { at: string; by: string | null } | null {
  const mine = sent?.[0];
  if (mine) return { at: mine.sent_at, by: mine.sent_by_name };
  const deal = deals.find(d => !d.voided && d.submitted_at);
  return deal?.submitted_at ? { at: deal.submitted_at, by: deal.closer } : null;
}

/** Which script this lead's next call needs: the demo once one is booked or held. */
function callScript(me: Me, appointments: CalendarRow[]): "intro" | "demo" {
  if (me.role === "closer") return "demo";
  if (me.role === "setter") return "intro";
  return appointments.some(a => a.call_type === "demo") ? "demo" : "intro";
}

function Page({ children }: { children: ReactNode }) {
  return <main className={pageWide}>{children}</main>;
}

function Appointments({
  rows,
  error,
  reload,
}: {
  /** Null until the lead's calls have been read. */
  rows: CalendarRow[] | null;
  error: string | null;
  reload: () => void;
}) {
  if (error)
    return (
      <div className="p-4">
        <Failed what="This lead's calls" error={error} retry={reload} />
      </div>
    );
  if (!rows) return <Reading what="the calls" className="px-4 py-3 text-sm" />;
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
      className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-[var(--radius-md)] border hairline px-3 text-sm hover:bg-[color:var(--secondary)]"
      title={label}
      aria-label={`${label}: ${text}`}
    >
      <Copy className="muted size-3.5 shrink-0" aria-hidden />
      <span className="truncate tabular-nums" dir="ltr">
        {text}
      </span>
    </button>
  );
}
