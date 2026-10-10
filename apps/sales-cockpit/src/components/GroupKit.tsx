import { Check, Copy, Download, MessageCircle, Users } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { isClient } from "../lib/clients";
import { useQuery, useTeam } from "../lib/data";
import { supabase } from "../lib/supabase";
import type { Lead, Me } from "../lib/types";
import {
  callWhen,
  cleanInvite,
  clockTime,
  firstName,
  greetName,
  groupInvite,
  groupName,
  groupWelcome,
  type Lang,
  vcard,
  waBlocked,
  waDigits,
  waLink,
} from "../lib/zoomLink";
import { button, buttonPrimary, field, SectionCard, Segmented } from "./kit";

/**
 * The WhatsApp group for a booked demo (2026-10-10). The setter makes it
 * from her own phone (the CEO, 2026-10-02); the cockpit gives her the name,
 * the invite and the welcome in the lead's language, opens her own WhatsApp
 * on the lead with the invite filled in, and keeps a record (group.made: a
 * row, an audit row and a HighLevel note without the link). It never posts.
 *
 * The four steps are numbered because they are an order: the invite link
 * exists only once the group does. The fewest taps: with the invite link,
 * the lead never has to be saved as a contact (WhatsApp adds only saved
 * contacts); "Save Sara's contact" is there for adding them by hand.
 */

const TOUCH = "pointer-coarse:min-h-11!";
const INVITE_HINT =
  "Paste the group's invite link: it starts with https://chat.whatsapp.com/";

export interface GroupRow {
  id: string;
  contact_id: string;
  appointment_id: string | null;
  name: string | null;
  invite_link: string | null;
  made_by: string;
  made_at: string;
  updated_at: string;
  crm_note: string | null;
}

export interface DemoForGroup {
  appointment_id: string;
  start_at: string | null;
  assigned_user_name: string | null;
  /** HighLevel's user id of the closer, when the caller has it (matches the team's Arabic name). */
  assigned_user_id?: string | null;
}

type TeamRow = {
  email: string;
  name: string | null;
  ghl_user_id: string | null;
  /** 20261010s adds it to cockpit_sales_team. */
  name_ar?: string | null;
};

function useGroup(contactId: string, on: boolean) {
  return useQuery<GroupRow | null>(
    () =>
      on
        ? supabase
            .from("cockpit_sales_groups")
            .select("*")
            .eq("contact_id", contactId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    [contactId, on],
  );
}

/** A demo Zoom link made for this lead in the last day (the tidy removes older ones). */
function useDemoZoom(contactId: string, on: boolean) {
  return useQuery<{ join_url: string } | null>(
    () =>
      on
        ? supabase
            .from("cockpit_sales_zoom_links")
            .select("join_url")
            .eq("contact_id", contactId)
            .eq("call_kind", "demo")
            .is("deleted_at", null)
            .gte("made_at", new Date(Date.now() - 24 * 3_600_000).toISOString())
            .order("made_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    [contactId, on],
  );
}

function useCopied() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef(0);
  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied(`${what}:failed`);
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), 2000);
  };
  return { copied, copy };
}

function CopyButton({
  what,
  text,
  label,
  copied,
  copy,
}: {
  what: string;
  text: string;
  label: string;
  copied: string | null;
  copy: (what: string, text: string) => Promise<void>;
}) {
  const done = copied === what;
  return (
    <button
      type="button"
      className={`${button} ${TOUCH} shrink-0`}
      onClick={() => void copy(what, text)}
    >
      {done ? (
        <Check className="size-3.5" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
      {done ? "Copied" : label}
    </button>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[1.75rem_1fr] gap-x-2.5 gap-y-1.5">
      <span
        aria-hidden
        className="mt-0.5 grid size-6 place-items-center rounded-full border border-teal-500/35 bg-teal-500/10 font-mono text-[11px] font-semibold text-teal-200"
      >
        {n}
      </span>
      <div className="min-w-0 space-y-1.5">
        <p className="text-sm font-medium">{title}</p>
        {children}
      </div>
    </li>
  );
}

export function GroupKit({
  lead,
  demo,
  compact = false,
  lang: leadLang,
}: {
  lead: Lead;
  me: Me;
  demo: DemoForGroup | null;
  compact?: boolean;
  /** The lead's language from their own messages; Arabic when not known. */
  lang?: Lang;
}) {
  const on = Boolean(demo) && !isClient(lead);
  const group = useGroup(lead.contact_id, on);
  const zoom = useDemoZoom(lead.contact_id, on);
  const team = useTeam();
  const [lang, setLang] = useState<Lang>(leadLang ?? "ar");
  // The lead's language is known once their messages are read: follow it.
  useEffect(() => setLang(leadLang ?? "ar"), [leadLang]);
  const [invite, setInvite] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const { copied, copy } = useCopied();

  const rows = (team.data ?? []) as TeamRow[];
  const closerRow = useMemo(
    () =>
      rows.find(
        r =>
          (demo?.assigned_user_id && r.ghl_user_id === demo.assigned_user_id) ||
          (demo?.assigned_user_name && r.name === demo.assigned_user_name),
      ) ?? null,
    [rows, demo?.assigned_user_id, demo?.assigned_user_name],
  );

  if (!on || !demo) return null;

  const first = greetName(lead);
  const them = first || "the lead";
  const closerEn = firstName(demo.assigned_user_name) || "our team";
  const closer =
    lang === "ar"
      ? closerRow?.name_ar?.trim() ||
        firstName(demo.assigned_user_name) ||
        "فريقنا"
      : closerEn;
  const when = demo.start_at
    ? callWhen(demo.start_at, lead.country, lang, lead.phone)
    : null;
  const name = groupName(lead);
  const saved = group.data ?? null;
  const cleaned = cleanInvite(invite);
  const welcome = groupWelcome(lang, {
    first,
    closer,
    when,
    zoom: zoom.data?.join_url ?? null,
  });
  const blocked = waBlocked(lead);
  const digits = waDigits(lead.phone);
  const madeBy =
    rows.find(r => r.email === saved?.made_by)?.name ?? saved?.made_by ?? "";

  const save = async (link: string | null) => {
    setSaving(true);
    setError(null);
    try {
      await api("group.made", {
        contact_id: lead.contact_id,
        appointment_id: demo.appointment_id,
        name,
        ...(link ? { invite_link: link } : {}),
      });
      setEditing(false);
      setInvite("");
      group.reload();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  /** Opens the rep's own WhatsApp on the lead with the invite; the save goes alongside. */
  const sendInvite = (link: string) => {
    if (!digits) return;
    window.open(
      waLink(digits, groupInvite(lang, { first, closer, when, invite: link })),
      "_blank",
      "noopener",
    );
    void save(link);
  };

  const saveContact = () => {
    if (!lead.phone) return;
    const blob = new Blob([vcard(lead.name ?? them, lead.phone)], {
      type: "text/vcard",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(first || "lead").replace(/[^\p{L}\p{N}_-]+/gu, "")}.vcf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const langSwitch = (
    <Segmented
      label="The messages' language"
      value={lang}
      options={[
        ["ar", "عربي"],
        ["en", "English"],
      ]}
      onChange={v => setLang(v as Lang)}
    />
  );

  const welcomeBubble = (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <p
        dir={lang === "ar" ? "rtl" : "ltr"}
        lang={lang}
        className={`min-w-0 flex-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-2xl rounded-tr-md border border-teal-500/25 bg-[color:color-mix(in_oklch,var(--primary)_10%,var(--card))] px-3.5 py-2.5 text-[15px] leading-relaxed ${lang === "ar" ? "ar" : ""}`}
      >
        {welcome}
      </p>
      <CopyButton
        what="welcome"
        text={welcome}
        label="Copy the welcome"
        copied={copied}
        copy={copy}
      />
    </div>
  );

  const body =
    saved && !editing ? (
      <div className="max-w-3xl space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <span className="inline-flex items-center gap-1.5">
            <Check className="size-4 text-[color:var(--success)]" aria-hidden />
            <span>
              Group made at{" "}
              <span className="font-mono tabular-nums">
                {clockTime(saved.made_at)}
              </span>{" "}
              by <bdi>{madeBy}</bdi>.
            </span>
          </span>
          {saved.invite_link ? (
            <>
              <a
                href={saved.invite_link}
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-2 hover:underline"
              >
                Open the group
              </a>
              {blocked ? null : (
                <button
                  type="button"
                  className="underline-offset-2 hover:underline"
                  onClick={() => sendInvite(String(saved.invite_link))}
                >
                  Send the invite again
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              className="underline-offset-2 hover:underline"
              onClick={() => setEditing(true)}
            >
              Add the invite link
            </button>
          )}
        </div>
        {String(saved.crm_note ?? "").startsWith("failed") ? (
          <p className="muted text-xs">
            HighLevel did not take the note that the group was made. Press Send
            the invite again or Add the invite link to try once more.
          </p>
        ) : null}
        <div className="space-y-1.5">
          <p className="muted text-xs">The welcome, to post in the group</p>
          {welcomeBubble}
        </div>
      </div>
    ) : (
      <div className="max-w-3xl space-y-4">
        <ol className="space-y-4">
          <Step n={1} title="Name it">
            <div className="flex items-center gap-2">
              <code
                className="min-w-0 flex-1 truncate rounded-[14px] border border-white/10 bg-[color:var(--background)] px-3.5 py-2 text-[13px]"
                dir="auto"
                title={name}
              >
                {name}
              </code>
              <CopyButton
                what="name"
                text={name}
                label="Copy"
                copied={copied}
                copy={copy}
              />
            </div>
            <p className="muted text-xs">
              In WhatsApp: New group, add <bdi>{closerEn}</bdi>, paste the name,
              Create.
            </p>
          </Step>
          <Step n={2} title="Get the invite link">
            <p className="muted text-xs">
              Then Group info, Invite via link, Copy link. Paste it here.
            </p>
            <input
              type="url"
              inputMode="url"
              className={`${field} font-mono text-[13px]`}
              dir="ltr"
              placeholder="https://chat.whatsapp.com/…"
              value={invite}
              onChange={e => {
                setInvite(e.target.value);
                setError(null);
              }}
              aria-label="The group's invite link"
              aria-invalid={cleaned === undefined}
            />
            {cleaned === undefined ? (
              <p className="text-xs text-[color:var(--warning)]">
                {INVITE_HINT}
              </p>
            ) : null}
          </Step>
          <Step n={3} title={`Send the invite to ${them}`}>
            <div className="flex flex-wrap gap-2">
              {blocked ? null : (
                <button
                  type="button"
                  className={`${buttonPrimary} ${TOUCH}`}
                  disabled={saving}
                  onClick={() => {
                    if (!cleaned) {
                      setError(INVITE_HINT);
                      return;
                    }
                    sendInvite(cleaned);
                  }}
                >
                  <MessageCircle className="size-3.5" aria-hidden />
                  <span>
                    Send the invite to <bdi>{them}</bdi>
                  </span>
                </button>
              )}
              <button
                type="button"
                className={`${button} ${TOUCH}`}
                onClick={() => {
                  if (!cleaned) {
                    setError(INVITE_HINT);
                    return;
                  }
                  void copy(
                    "invite",
                    groupInvite(lang, { first, closer, when, invite: cleaned }),
                  );
                }}
              >
                {copied === "invite" ? (
                  <Check className="size-3.5" aria-hidden />
                ) : (
                  <Copy className="size-3.5" aria-hidden />
                )}
                {copied === "invite" ? "Copied" : "Copy the invite"}
              </button>
            </div>
            {blocked ? <p className="muted text-xs">{blocked}</p> : null}
          </Step>
          <Step n={4} title="Post the welcome in the group">
            {welcomeBubble}
          </Step>
        </ol>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t hairline pt-3">
          <button
            type="button"
            className={`${button} ${TOUCH}`}
            disabled={saving}
            onClick={() => {
              if (cleaned === undefined) {
                setError(INVITE_HINT);
                return;
              }
              void save(cleaned ?? null);
            }}
          >
            {saving ? "Saving…" : "Group made"}
          </button>
          {lead.phone ? (
            <p className="muted text-xs">
              Adding <bdi>{them}</bdi> yourself?{" "}
              <button
                type="button"
                className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-[color:var(--foreground)]"
                onClick={saveContact}
              >
                <Download className="size-3" aria-hidden />
                <span>
                  Save <bdi>{them}</bdi>'s contact
                </span>
              </button>
            </p>
          ) : null}
        </div>
      </div>
    );

  const status = (
    <>
      {error ? (
        <p
          role="alert"
          className="callout-bad rounded-[var(--radius-md)] border px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}
      {group.error ? (
        <p className="muted text-xs">
          Whether a group was made could not be read. It tries again by itself.
        </p>
      ) : null}
      {copied?.endsWith(":failed") ? (
        <p className="muted text-xs">
          The browser would not copy. Select the text instead.
        </p>
      ) : null}
    </>
  );

  if (compact)
    return (
      <section className="space-y-3" aria-label="WhatsApp group">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="inline-flex items-center gap-2 text-sm font-semibold">
            <Users className="size-4 text-teal-300" aria-hidden />
            WhatsApp group
          </h3>
          {langSwitch}
        </div>
        {body}
        {status}
      </section>
    );
  return (
    <SectionCard title="WhatsApp group" side={langSwitch}>
      <div className="space-y-3">
        <p className="muted text-xs">
          Made from your own phone. The cockpit keeps the record and never posts
          in it.
        </p>
        {body}
        {status}
      </div>
    </SectionCard>
  );
}
