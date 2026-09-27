import { FileText, Sparkles } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { api } from "../lib/api";
import { useSetting } from "../lib/data";
import { ago, duration, when } from "../lib/format";
import { toast } from "../lib/toast";
import type {
  Me,
  Proposal,
  ProposalStatus,
  Recording,
  WorkRequest,
} from "../lib/types";
import {
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
  const label =
    p.status === "needs_input" && p.fill_count
      ? `${s.label} (${p.fill_count})`
      : s.label;
  return <StatusChip tone={s.tone} label={label} />;
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
        "Drafting the proposal. It takes about ten minutes; you can leave this page.",
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
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-[color:var(--secondary)]"
              >
                <FileText className="muted size-4 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {p.lang === "ar" ? "Arabic" : "English"} proposal
                  </p>
                  <p className="muted text-xs">
                    {p.created_by.split("@")[0]} · {ago(p.created_at)}
                    {p.error && p.status === "failed" ? ` · ${p.error}` : ""}
                  </p>
                </div>
                <ProposalChip p={p} />
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
        <p className="callout-good rounded-[var(--radius-md)] border px-3 py-2 text-sm">
          A proposal is being drafted (
          {open.status === "running" ? "writing now" : "waiting for the writer"}
          , asked {ago(open.requested_at)}). It takes about ten minutes.
        </p>
      ) : (
        <form onSubmit={draft} className="@container space-y-3">
          <div className="grid grid-cols-1 gap-3 @[26rem]:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="muted block text-xs">Language</span>
              <select
                value={lang}
                onChange={e => setLang(e.target.value as "ar" | "en")}
                className={field}
              >
                <option value="ar">Arabic</option>
                <option value="en">English</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="muted block text-xs">How the client pays</span>
              <select
                value={payment}
                onChange={e => setPayment(e.target.value)}
                className={field}
              >
                {payments.map(p => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="muted block text-xs">Guarantee</span>
              <select
                value={guarantee ? "yes" : "no"}
                onChange={e => setGuarantee(e.target.value === "yes")}
                className={field}
              >
                <option value="no">No guarantee</option>
                <option value="yes">
                  {offer.data?.guarantee?.label ?? "Include the guarantee"}
                </option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="muted block text-xs">Call to draft from</span>
              <select
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
              </select>
            </label>
          </div>
          {!videos.length ? (
            <p className="muted text-xs">
              No video recording of the demo is linked to this lead yet. The
              writer looks in Fathom again for the newest demo shared with the
              team, and says so if there is none; it never drafts from a phone
              call.
            </p>
          ) : null}
          <button type="submit" disabled={busy} className={buttonPrimary}>
            <Sparkles className="size-3.5" aria-hidden />
            {busy ? "Asking…" : "Draft proposal"}
          </button>
        </form>
      )}
    </div>
  );
}
