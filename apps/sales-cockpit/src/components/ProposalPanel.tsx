import { FileText, Sparkles } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { api } from "../lib/api";
import { useNow, useProposal, useRequest, useSetting } from "../lib/data";
import { ago, duration, when } from "../lib/format";
import { draftWait, failedLine, waitLabel } from "../lib/proposals";
import { toast } from "../lib/toast";
import type {
  Me,
  Proposal,
  ProposalStatus,
  Recording,
  WorkRequest,
} from "../lib/types";
import { DeskStatus } from "./DeskStatus";
import {
  AnimatedSelect,
  buttonPrimary,
  Failed,
  field,
  partsText,
  Reading,
  StatusChip,
  type Tone,
} from "./kit";

/**
 * The AI sales proposal, drafted from the demo call by our own worker (the
 * engine that used to run under Muhammed's account). The closer chooses the
 * language, whether a guarantee is offered and how the client pays (Aziz,
 * 2026-09-24: the offer "should be flexible and depends if we're giving a
 * guarantee or not or payment plans"); the draft takes about ten minutes.
 */

interface OfferSetting {
  payments?: { key: string; label: string }[];
  guarantee?: { label?: string };
}

const DEFAULT_PAYMENTS = [
  { key: "pif", label: "Paid in full" },
  { key: "plan", label: "Payment plan" },
];

export const PROPOSAL_STATUS: Record<
  ProposalStatus,
  { tone: Tone; label: string }
> = {
  drafting: { tone: "neutral", label: "Drafting" },
  needs_input: { tone: "warning", label: "Needs figures" },
  ready: { tone: "good", label: "Ready to send" },
  sent: { tone: "good", label: "Sent" },
  failed: { tone: "critical", label: "Failed" },
  archived: { tone: "neutral", label: "Archived" },
};

export function ProposalChip({ p }: { p: Proposal }) {
  const s = PROPOSAL_STATUS[p.status] ?? {
    tone: "neutral" as Tone,
    label: p.status,
  };
  // A draft the writer holds says so, rather than "Drafting" for hours.
  const waiting = waitLabel(p);
  if (waiting)
    return <StatusChip tone="warning" label={waiting} title={p.error ?? ""} />;
  const label =
    p.status === "needs_input" && p.fill_count
      ? `${s.label} (${p.fill_count})`
      : s.label;
  return <StatusChip tone={s.tone} label={label} />;
}

/**
 * Where a draft is, the same on the lead's card and on the proposal's page:
 * about ten minutes while all is well; the writer's own sentence when it
 * waits (no model answering, a try that failed); "Taking longer than usual"
 * after 20 minutes, with the try count; and Stop drafting while the request
 * has not started (sales-api request.set). A first draft that is stopped is
 * archived; a retry or a rebuild goes back to the version it had.
 */
export function DraftWaitNotice({
  me,
  proposal,
  request,
  onChange,
}: {
  me: Me;
  proposal: Pick<Proposal, "error" | "created_at">;
  request: WorkRequest | null;
  onChange: () => void;
}) {
  const now = useNow(30_000);
  const [busy, setBusy] = useState(false);
  const w = draftWait(proposal, request, now);
  const canStop =
    w.stoppable &&
    request !== null &&
    (me.manager || request.requested_by === me.email);

  async function stop() {
    if (!request) return;
    setBusy(true);
    try {
      const out = await api<{ proposal?: { status?: string } | null }>(
        "request.set",
        { id: request.id, to: "cancelled" },
      );
      toast.success(
        out.proposal?.status === "archived"
          ? "Drafting stopped and the proposal archived. Draft proposal on the lead's page starts a new one when you are ready."
          : "Drafting stopped. The last version is back.",
      );
      onChange();
    } catch (err) {
      toast.error(String((err as Error).message ?? err));
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`${w.tone === "warn" ? "callout-warn" : "callout-good"} space-y-1 rounded-[var(--radius-md)] border px-3 py-2 text-sm`}
      role="status"
    >
      <p className="font-medium">{w.head}.</p>
      <p>{w.body}</p>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-0.5">
        <p className="text-xs opacity-80">{w.meta}</p>
        {canStop ? (
          <button
            type="button"
            disabled={busy}
            onClick={stop}
            className="-my-1 py-1 text-xs underline underline-offset-2 disabled:opacity-50"
          >
            {busy ? "Stopping…" : "Stop drafting"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The lead's open draft, looked at again every 20 seconds while the lead's
 * page is open: the request (where it is, its tries) and the proposal (the
 * writer's sentence for the closer). The lead's own read is not polled, so
 * once the request finishes the page reads the lead's proposals again and
 * the finished draft shows without a reload.
 */
function DraftWatch({
  me,
  request,
  proposal,
  onChange,
}: {
  me: Me;
  request: WorkRequest;
  proposal: Proposal | undefined;
  onChange: () => void;
}) {
  const live = useRequest(request.id);
  const liveProposal = useProposal(String(request.params?.proposal_id ?? ""));
  const r = live.data ?? request;
  const finished = r.status !== "queued" && r.status !== "running";
  const told = useRef(false);
  useEffect(() => {
    if (!finished || told.current) return;
    told.current = true;
    onChange();
  }, [finished, onChange]);
  return (
    <DraftWaitNotice
      me={me}
      proposal={
        liveProposal.data ??
        proposal ?? { error: null, created_at: request.requested_at }
      }
      request={r}
      onChange={() => {
        live.reload();
        liveProposal.reload();
        onChange();
      }}
    />
  );
}

/**
 * A phone call from Maqsam, not a video call. The writer drafts from the
 * demo's video and refuses a phone call (hermes/sales-desk recordings.py).
 */
function isPhoneCall(r: Recording): boolean {
  return r.source === "maqsam" || r.recording_id.startsWith("maqsam:");
}

/**
 * The parent owns the read of the lead's proposals, requests and
 * recordings: until it is in, nothing here offers a draft or says a
 * recording is missing, and a failed read says so with Try again.
 */
export function ProposalPanel({
  me,
  contactId,
  appointmentId,
  proposals,
  recordings,
  requests,
  onChange,
  loading = false,
  error = null,
  retry,
}: {
  me: Me;
  contactId: string;
  appointmentId: string | null;
  proposals: Proposal[];
  recordings: Recording[];
  requests: WorkRequest[];
  onChange: () => void;
  /** The proposals, requests and recordings have not been read yet. */
  loading?: boolean;
  /** Why they could not be read. */
  error?: string | null;
  retry?: () => void;
}) {
  const formId = useId();
  const offer = useSetting<OfferSetting>("offer");
  const payments = offer.data?.payments?.length
    ? offer.data.payments
    : DEFAULT_PAYMENTS;
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const [guarantee, setGuarantee] = useState(false);
  const [payment, setPayment] = useState("pif");
  const [recording, setRecording] = useState("");
  const [busy, setBusy] = useState(false);

  const canDraft = me.manager || me.role === "closer" || me.role === "both";
  const open = requests.find(
    r =>
      r.kind === "proposal" &&
      (r.status === "queued" || r.status === "running"),
  );
  const openFor = open
    ? proposals.find(p => p.id === String(open.params?.proposal_id ?? ""))
    : undefined;
  const visible = proposals.filter(p => p.status !== "archived");
  const videos = recordings.filter(r => !isPhoneCall(r));

  async function draft(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("proposal.draft", {
        contact_id: contactId,
        appointment_id: appointmentId,
        recording_id: recording || null,
        lang,
        offer: { guarantee, payment },
      });
      toast.success(
        "Drafting the proposal. It usually takes about ten minutes; you can leave this page.",
      );
      onChange();
    } catch (err) {
      toast.error(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  }

  if (error)
    return <Failed what="This lead's proposals" error={error} retry={retry} />;
  if (loading) return <Reading what="the proposals" />;

  return (
    <div className="space-y-4">
      {visible.length ? (
        <ul className="divide-y hairline rounded-[var(--radius-md)] border hairline">
          {visible.map(p => (
            <li key={p.id}>
              <Link
                to={`/proposal/${p.id}`}
                className="block px-3 py-2.5 hover:bg-[color:var(--secondary)]"
              >
                {/* The chip drops under the words when the card is narrow,
                    rather than squeezing them a word to a line. */}
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <FileText className="muted size-4 shrink-0" aria-hidden />
                  <span className="min-w-[9rem] flex-1">
                    <span className="block text-sm font-medium">
                      {p.lang === "ar" ? "Arabic" : "English"} proposal
                    </span>
                    <span className="muted block text-xs">
                      {p.created_by.split("@")[0]} · asked {ago(p.created_at)}
                    </span>
                  </span>
                  <ProposalChip p={p} />
                </span>
                {/* Why it failed, on its own line: the writer's sentence
                    says what to do next. */}
                {p.status === "failed" ? (
                  <span className="callout-bad mt-2 block rounded-[var(--radius-md)] border px-2.5 py-1.5 text-xs">
                    {failedLine(p.error)}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {!canDraft ? (
        <p className="muted text-sm">
          The closer drafts the proposal after the demo. It will show here.
        </p>
      ) : open ? (
        <DraftWatch
          key={open.id}
          me={me}
          request={open}
          proposal={openFor}
          onChange={onChange}
        />
      ) : (
        <form onSubmit={draft} className="@container space-y-3">
          <div className="grid grid-cols-1 gap-3 @[26rem]:grid-cols-2">
            <label htmlFor={`${formId}-language`} className="space-y-1 text-sm">
              <span className="muted block text-xs">Language</span>
              <AnimatedSelect
                id={`${formId}-language`}
                value={lang}
                onChange={e => setLang(e.target.value as "ar" | "en")}
                className={field}
              >
                <option value="ar">Arabic</option>
                <option value="en">English</option>
              </AnimatedSelect>
            </label>
            <label htmlFor={`${formId}-payment`} className="space-y-1 text-sm">
              <span className="muted block text-xs">How the client pays</span>
              <AnimatedSelect
                id={`${formId}-payment`}
                value={payment}
                onChange={e => setPayment(e.target.value)}
                className={field}
              >
                {payments.map(p => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </AnimatedSelect>
            </label>
            <label
              htmlFor={`${formId}-guarantee`}
              className="space-y-1 text-sm"
            >
              <span className="muted block text-xs">Guarantee</span>
              <AnimatedSelect
                id={`${formId}-guarantee`}
                value={guarantee ? "yes" : "no"}
                onChange={e => setGuarantee(e.target.value === "yes")}
                className={field}
              >
                <option value="no">No guarantee</option>
                <option value="yes">
                  {offer.data?.guarantee?.label ?? "Include the guarantee"}
                </option>
              </AnimatedSelect>
            </label>
            <label
              htmlFor={`${formId}-recording`}
              className="space-y-1 text-sm"
            >
              <span className="muted block text-xs">Call to draft from</span>
              <AnimatedSelect
                id={`${formId}-recording`}
                value={recording}
                onChange={e => setRecording(e.target.value)}
                className={field}
              >
                <option value="">The newest recorded demo</option>
                {videos.map(r => (
                  <option key={r.recording_id} value={r.recording_id}>
                    {partsText([
                      when(r.started_at),
                      r.title ?? "Recording",
                      duration(r.duration_s),
                    ])}
                  </option>
                ))}
              </AnimatedSelect>
            </label>
          </div>
          {!videos.length ? (
            <p className="muted text-xs">
              No video recording of the demo is linked to this lead yet. Share
              the demo's recording with the team in Fathom first; the writer
              looks in Fathom again when you draft, and never drafts from a
              phone call.
            </p>
          ) : null}
          {/* Whether the writer is running, before anyone waits on it. */}
          <DeskStatus
            jobs={[
              {
                job: "requests",
                what: "The proposal writer",
                staleMin: 10,
                waiting:
                  "A draft asked for now waits and goes ahead by itself once that is fixed; if it is still waiting in an hour, tell the CEO.",
              },
            ]}
          />
          <button type="submit" disabled={busy} className={buttonPrimary}>
            <Sparkles className="size-3.5" aria-hidden />
            {busy ? "Asking…" : "Draft proposal"}
          </button>
        </form>
      )}
    </div>
  );
}
