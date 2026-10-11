import { Check, Copy, MessageCircle, Users } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { api } from "../lib/api";
import { useQuery, useSnippets, useTeam } from "../lib/data";
import {
  type CallKind,
  firstOf,
  type LeadLike,
  leadFirst,
} from "../lib/reschedule";
import { supabase } from "../lib/supabase";
import { TELL_LABELS, type TellMoment, tellMessage } from "../lib/tellThem";
import { toast } from "../lib/toast";
import type { Me } from "../lib/types";
import { type Lang, waBlocked, waDigits, waLink } from "../lib/zoomLink";
import { button, buttonPrimary, Segmented } from "./kit";

/**
 * Tell them (plan D24 to D29): the message for the moment, in the lead's
 * language and on their clock, with Copy and Send on WhatsApp, which opens
 * the rep's own WhatsApp on the lead's number with the words in. The
 * cockpit sends the lead nothing itself. Each press is noted (book.told:
 * who, how, which language) so a manager can see that the lead was told.
 */

export interface TellCall {
  appointment_id: string | null;
  kind: CallKind;
  start: string | null;
  host_name: string | null;
  host_user_id?: string | null;
  /** The call's own video link (HighLevel's demo address). */
  meet_url?: string | null;
}

type TeamRow = {
  email: string;
  name: string | null;
  ghl_user_id: string | null;
  name_ar?: string | null;
};

const TOUCH = "pointer-coarse:min-h-11";

/** The lead's WhatsApp group, when the setter made one (its invite opens it). */
function useGroupLink(contactId: string, on: boolean) {
  return useQuery<string | null>(async () => {
    if (!on) return { data: null, error: null };
    const { data, error } = await supabase
      .from("cockpit_sales_groups")
      .select("invite_link")
      .eq("contact_id", contactId)
      .maybeSingle();
    return {
      data:
        (data as { invite_link?: string | null } | null)?.invite_link ?? null,
      error,
    };
  }, [contactId, on]);
}

/** The newest instant Zoom link the cockpit made for this kind of call, still live. */
function useInstantLink(contactId: string, kind: CallKind, on: boolean) {
  return useQuery<string | null>(async () => {
    if (!on || kind === "follow_up") return { data: null, error: null };
    const { data, error } = await supabase
      .from("cockpit_sales_zoom_links")
      .select("join_url")
      .eq("contact_id", contactId)
      .eq("call_kind", kind)
      .is("deleted_at", null)
      .order("made_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return {
      data: (data as { join_url?: string | null } | null)?.join_url ?? null,
      error,
    };
  }, [contactId, kind, on]);
}

export function TellThem({
  me,
  lead,
  call,
  moment: firstMoment,
  lang: leadLang,
  rescheduleId = null,
  link = null,
  label,
  extra,
}: {
  me: Me;
  lead: LeadLike;
  call: TellCall;
  moment: TellMoment;
  /** The lead's language from their own messages; Arabic when not known. */
  lang?: Lang;
  /** The reschedule this message is about, stamped as told. */
  rescheduleId?: string | null;
  /** The lead's own link to pick another time (plan D17), when it is real. */
  link?: string | null;
  label?: string;
  /** Buttons that sit in the same row (Reschedule again, Done). */
  extra?: ReactNode;
}) {
  const [lang, setLang] = useState<Lang>(leadLang ?? "ar");
  useEffect(() => setLang(leadLang ?? "ar"), [leadLang]);
  const [moment, setMoment] = useState<TellMoment>(firstMoment);
  useEffect(() => setMoment(firstMoment), [firstMoment]);
  const [opened, setOpened] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toldError, setToldError] = useState<string | null>(null);
  const dnd = Boolean(lead.dnd);
  const team = useTeam();
  const snippets = useSnippets();
  const group = useGroupLink(lead.contact_id, !dnd);
  const instant = useInstantLink(
    lead.contact_id,
    call.kind,
    !dnd && !call.meet_url,
  );

  const first = leadFirst(lead);
  const heading =
    label ??
    (moment === "rescheduled"
      ? `Tell ${first || "them"} it moved`
      : moment === "pick_time"
        ? `Send ${first || "them"} the link to pick a time`
        : `Tell ${first || "them"}`);

  if (dnd)
    return (
      <div className="space-y-3">
        <p className="muted text-sm">Do not disturb is on: no WhatsApp.</p>
        {extra ? <div className="flex flex-wrap gap-2">{extra}</div> : null}
      </div>
    );

  const rows = (team.data ?? []) as TeamRow[];
  const hostRow = rows.find(
    r =>
      (call.host_user_id && r.ghl_user_id === call.host_user_id) ||
      (call.host_name && r.name === call.host_name),
  );
  const meRow = rows.find(r => r.email === me.email);
  const zoom = call.meet_url ?? instant.data ?? null;
  const message = tellMessage({
    moment,
    lang,
    lead,
    kind: call.kind,
    start: call.start,
    host: { en: firstOf(call.host_name) || null, ar: hostRow?.name_ar ?? null },
    rep: { en: firstOf(me.name) || null, ar: meRow?.name_ar ?? null },
    zoom,
    link,
    snippets: snippets.data,
  }).text;
  const digits = waDigits(lead.phone);
  const blocked = waBlocked(lead);
  const linkMoment = moment === "pick_time";

  const told = (how: "whatsapp" | "copy") => {
    setToldError(null);
    api("book.told", {
      appointment_id: call.appointment_id,
      ...(rescheduleId ? { reschedule_id: rescheduleId } : {}),
      how: linkMoment ? `link_${how}` : how,
      lang,
      moment,
    }).catch(e =>
      setToldError(
        `The cockpit could not note that you told them: ${String((e as Error)?.message ?? e)}`,
      ),
    );
  };

  const send = () => {
    if (!digits) return;
    window.open(waLink(digits, message), "_blank", "noopener");
    setOpened(true);
    told("whatsapp");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      toast.success("Copied");
      told("copy");
    } catch {
      toast.error("The browser would not copy. Select the message instead.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex max-w-[38rem] flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium">{heading}</span>
        <Segmented
          label="The message's language"
          value={lang}
          options={[
            [
              "ar",
              <span key="ar" className="ar">
                العربية
              </span>,
            ],
            ["en", "English"],
          ]}
          onChange={v => setLang(v as Lang)}
        />
      </div>
      <p
        dir={lang === "ar" ? "rtl" : "ltr"}
        lang={lang}
        className={`max-w-[38rem] whitespace-pre-line rounded-[14px] border hairline bg-[color:color-mix(in_oklch,var(--primary)_7%,var(--background))] px-3.5 py-3 text-[15px] leading-[1.9] [overflow-wrap:anywhere] ${lang === "ar" ? "ar text-right" : ""}`}
      >
        {message}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {digits && !blocked ? (
          <button
            type="button"
            onClick={send}
            className={`${buttonPrimary} ${TOUCH} max-sm:flex-[1_1_100%]`}
          >
            <MessageCircle className="size-3.5" aria-hidden />
            Send on WhatsApp
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void copy()}
          className={`${button} ${TOUCH} max-sm:flex-auto max-sm:px-3 whitespace-nowrap`}
        >
          {copied ? (
            <Check className="size-3.5" aria-hidden />
          ) : (
            <Copy className="size-3.5" aria-hidden />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
        {group.data ? (
          <a
            href={group.data}
            target="_blank"
            rel="noopener noreferrer"
            className={`${button} ${TOUCH} max-sm:flex-auto max-sm:px-3 whitespace-nowrap`}
            title="Open the WhatsApp group, to paste the same message there"
          >
            <Users className="size-3.5" aria-hidden />
            Open the group
          </a>
        ) : null}
        {extra}
      </div>
      {blocked ? <p className="muted text-xs">{blocked}</p> : null}
      {opened ? (
        <p role="status" className="muted text-xs">
          Opened in your WhatsApp. Press send there.
        </p>
      ) : null}
      {link && !linkMoment ? (
        <button
          type="button"
          onClick={() => setMoment("pick_time")}
          className="muted text-xs underline underline-offset-2 hover:text-[color:var(--foreground)]"
        >
          Or send them the link to pick a time
        </button>
      ) : linkMoment && firstMoment !== "pick_time" ? (
        <button
          type="button"
          onClick={() => setMoment(firstMoment)}
          className="muted text-xs underline underline-offset-2 hover:text-[color:var(--foreground)]"
        >
          Back to the {TELL_LABELS[firstMoment].toLowerCase()} message
        </button>
      ) : null}
      {toldError ? <p className="muted text-xs">{toldError}</p> : null}
    </div>
  );
}
