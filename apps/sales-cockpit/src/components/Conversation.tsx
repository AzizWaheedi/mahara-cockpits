import { Mail, MessageCircle, RefreshCw, Send } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "../lib/api";
import { useSnippets, useTemplates } from "../lib/data";
import { ago, clock, day } from "../lib/format";
import { toast } from "../lib/toast";
import {
  callWords,
  fillSnippet,
  firstWord,
  leadLanguage,
  type Moment,
  snippetLine,
} from "../lib/whatsapp";
import { buttonPrimary, field } from "./kit";
import { SnippetPicker, TemplateComposer } from "./WhatsAppKit";

/**
 * Talking to a lead from the cockpit: their whole HighLevel conversation
 * (WhatsApp, email, SMS, calls, one thread), and a box to answer on the
 * official WhatsApp line or by email. Aziz, 2026-09-24: "in the dialer, they
 * should be able to talk to the lead, and in the lead section as well".
 *
 * WhatsApp takes a free message only within 24 hours of the lead's own last
 * message; outside it the box becomes an approved template with one line
 * written for this lead (sent through its HighLevel workflow), and email
 * stays one click away. The team's ready-made messages fill the box in the
 * lead's language. Every send carries an id made for it, so a retry after a
 * dropped connection returns the first send instead of sending twice.
 */

export type Channel = "whatsapp" | "sms" | "email";

export interface ThreadMessage {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound" | null;
  channel: Channel | "call" | "other";
  type: string | null;
  status: string | null;
  at: string | null;
  body: string | null;
  subject: string | null;
  attachments: string[];
  error: string | null;
  source: string | null;
}

interface ChannelState {
  on: boolean;
  dnd: boolean;
  reachable: boolean;
  window?: {
    open: boolean;
    closes_at: string | null;
    last_inbound_at: string | null;
  };
}

interface SendRow {
  id: string;
  channel: Channel;
  state: string;
  sent_by: string;
  source: string;
  ghl_message_id: string | null;
  error: string | null;
  created_at: string;
}

export interface ConvoData {
  contact: {
    name: string | null;
    email: string | null;
    phone: string | null;
    tags: string[];
    dnd: boolean | null;
    assigned_to: string | null;
  };
  channels: Record<Channel, ChannelState>;
  thread: ThreadMessage[];
  cursors: Record<string, string>;
  sends: SendRow[];
  read_at: string;
}

/** The conversation, read again every 30 seconds while the tab is open. */
export function useConversation(contactId: string) {
  const [data, setData] = useState<ConvoData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [older, setOlder] = useState<ThreadMessage[]>([]);
  const [cursors, setCursors] = useState<Record<string, string>>({});
  const [loadingOlder, setLoadingOlder] = useState(false);

  const load = useCallback(async () => {
    if (!contactId) return;
    try {
      const out = await api<ConvoData>("convo.read", {
        contact_id: contactId,
      });
      setData(out);
      setError(null);
      setCursors(c => (Object.keys(c).length ? c : out.cursors));
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }, [contactId]);

  useEffect(() => {
    setData(null);
    setOlder([]);
    setCursors({});
    void load();
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    return () => window.clearInterval(t);
  }, [load]);

  const loadOlder = useCallback(async () => {
    if (!Object.keys(cursors).length) return;
    setLoadingOlder(true);
    try {
      const out = await api<ConvoData>("convo.read", {
        contact_id: contactId,
        older: true,
        cursors,
      });
      setOlder(o => [...o, ...out.thread]);
      setCursors(out.cursors);
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setLoadingOlder(false);
    }
  }, [contactId, cursors]);

  const thread = useMemo(() => {
    const seen = new Set<string>();
    const all: ThreadMessage[] = [];
    for (const m of [...(data?.thread ?? []), ...older]) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      all.push(m);
    }
    const t = (m: ThreadMessage) => (m.at ? Date.parse(m.at) : 0);
    return all.sort((a, b) => t(a) - t(b));
  }, [data, older]);

  return {
    data,
    error,
    thread,
    reload: load,
    loadOlder,
    loadingOlder,
    canLoadOlder: Object.keys(cursors).length > 0,
  };
}

const CHANNEL_WORD: Record<ThreadMessage["channel"], string> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "Email",
  call: "Call",
  other: "Activity",
};

const STATUS_WORD: Record<string, string> = {
  delivered: "Delivered",
  read: "Read",
  opened: "Opened",
  failed: "Did not send",
  undelivered: "Not delivered",
  pending: "Sending",
  sent: "Sent",
  scheduled: "Scheduled",
};

function windowWords(c: ChannelState | undefined): string {
  const w = c?.window;
  if (!w?.last_inbound_at)
    return "They have never written on WhatsApp, so only an approved template goes: write the line it carries.";
  if (w.open)
    return `WhatsApp is open until ${day(w.closes_at)} ${clock(w.closes_at)} (they wrote ${ago(w.last_inbound_at)}).`;
  return `They last wrote ${ago(w.last_inbound_at)}, so WhatsApp's free window is closed and only an approved template goes: write the line it carries.`;
}

function draftKey(contactId: string, channel: Channel) {
  return `sales-draft:${contactId}:${channel}`;
}

interface Draft {
  contactId: string;
  channel: Channel;
  body: string;
  subject: string;
  /** The send's request id, kept until it goes, so a retry never doubles it. */
  id: string;
  /** A sales asset put in the box, logged with the send while its link is still in it. */
  assetId?: string | null;
  assetUrl?: string | null;
}

function readDraft(contactId: string, channel: Channel): Draft {
  try {
    const raw = sessionStorage.getItem(draftKey(contactId, channel));
    if (raw) {
      const d = JSON.parse(raw) as Partial<Draft>;
      return {
        contactId,
        channel,
        body: String(d.body ?? ""),
        subject: String(d.subject ?? ""),
        id: String(d.id ?? crypto.randomUUID()),
      };
    }
  } catch {
    // no storage; start clean
  }
  return { contactId, channel, body: "", subject: "", id: crypto.randomUUID() };
}

export function Conversation({
  contactId,
  convo,
  compact = false,
  rep,
  callAt,
  prefill,
}: {
  contactId: string;
  convo: ReturnType<typeof useConversation>;
  compact?: boolean;
  /** The rep writing, for {rep} in a ready-made message. */
  rep?: string | null;
  /** The lead's booked call, for {day} and {time}. */
  callAt?: string | null;
  /**
   * Words to put in the box from outside: a ready-made message for a moment
   * (the dialer after a missed call), or a sales asset's message.
   */
  prefill?: {
    moment?: Moment;
    text?: string;
    asset?: { id: string; url: string | null } | null;
    nonce: number;
  } | null;
}) {
  const { data, error, thread } = convo;
  const templates = useTemplates();
  const snippets = useSnippets();
  const language = leadLanguage(
    thread.filter(m => m.direction === "inbound").map(m => m.body),
  );
  const call = callAt ? callWords(callAt, language) : null;
  const values = {
    name: firstWord(data?.contact.name) || null,
    rep: firstWord(rep) || null,
    day: call?.day ?? null,
    time: call?.time ?? null,
  };
  const listRef = useRef<HTMLDivElement>(null);
  const channels = data?.channels;
  const usable = (c: Channel) => {
    const s = channels?.[c];
    if (!s) return { ok: false, why: "Reading the conversation…" };
    if (!s.on)
      return {
        ok: false,
        why: `Sending by ${CHANNEL_WORD[c]} is switched off in the cockpit.`,
      };
    if (s.dnd)
      return {
        ok: false,
        why: `This lead asked not to be contacted by ${CHANNEL_WORD[c]}.`,
      };
    if (!s.reachable)
      return {
        ok: false,
        why:
          c === "email"
            ? "This lead has no email address in HighLevel."
            : "This lead has no phone number in HighLevel.",
      };
    if (c === "whatsapp" && !s.window?.open)
      return { ok: false, why: windowWords(s) };
    return { ok: true, why: c === "whatsapp" ? windowWords(s) : "" };
  };
  const waReach = channels?.whatsapp;
  const templatesLive = (templates.data ?? []).some(
    t => t.active && t.workflow_id,
  );
  // WhatsApp first: free inside the window, a template outside it.
  const waTemplate = Boolean(
    waReach?.on && !waReach.dnd && waReach.reachable && templatesLive,
  );
  const preferred: Channel =
    usable("whatsapp").ok || waTemplate ? "whatsapp" : "email";
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const picked = useRef(false);
  useEffect(() => {
    if (!picked.current && data) setChannel(preferred);
  }, [data, preferred]);

  const [draft, setDraft] = useState<Draft>(() =>
    readDraft(contactId, channel),
  );
  // Words waiting for a channel switch to land in that channel's box.
  const pending = useRef<{
    text: string;
    asset: { id: string; url: string | null } | null;
  } | null>(null);
  useEffect(() => {
    const d = readDraft(contactId, channel);
    const p = pending.current;
    pending.current = null;
    setDraft(
      p
        ? {
            ...d,
            body: d.body.trim() ? `${d.body}\n\n${p.text}` : p.text,
            assetId: p.asset?.id ?? null,
            assetUrl: p.asset?.url ?? null,
          }
        : d,
    );
  }, [contactId, channel]);
  // Saved under the lead and channel it was written for, so switching
  // channel never files one channel's words under the other.
  useEffect(() => {
    try {
      sessionStorage.setItem(
        draftKey(draft.contactId, draft.channel),
        JSON.stringify(draft),
      );
    } catch {
      // the draft just will not survive a reload
    }
  }, [draft]);

  const count = thread.length;
  // Show the newest message by scrolling the list itself, never the page
  // around it (scrollIntoView moved the whole dialer down to the thread).
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the thread grows
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  const [busy, setBusy] = useState(false);
  const can = usable(channel);
  const wa = channels?.whatsapp;
  // WhatsApp is on and they can be reached, but only a template goes now.
  const templateMode =
    channel === "whatsapp" &&
    Boolean(wa?.on && !wa.dnd && wa.reachable && !wa.window?.open);

  // Words asked for from outside: a ready-made message for a moment (the
  // dialer after a missed call goes to WhatsApp) or a sales asset's message
  // (to the channel in use). Into the box, or as the template's line when
  // WhatsApp's window is closed.
  const [linePrefill, setLinePrefill] = useState<{
    text: string;
    nonce: number;
    asset?: { id: string; url: string | null } | null;
  } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per request
  useEffect(() => {
    if (!prefill || !data) return;
    let full = prefill.text ?? null;
    let line = full;
    if (!full && prefill.moment) {
      if (!snippets.data) return;
      const s =
        snippets.data.find(
          x => x.moment === prefill.moment && x.language === language,
        ) ?? snippets.data.find(x => x.moment === prefill.moment);
      if (!s) return;
      full = fillSnippet(s.body, values);
      line = fillSnippet(snippetLine(s.body), values);
    }
    if (!full) return;
    const asset = prefill.asset ?? null;
    const target: Channel = prefill.moment ? "whatsapp" : channel;
    const closed = Boolean(
      target === "whatsapp" &&
        wa?.on &&
        !wa.dnd &&
        wa.reachable &&
        !wa.window?.open,
    );
    if (target !== channel) picked.current = true;
    if (closed) {
      setLinePrefill({ text: line ?? full, nonce: prefill.nonce, asset });
      if (target !== channel) setChannel(target);
      return;
    }
    if (target !== channel) {
      pending.current = { text: full, asset };
      setChannel(target);
      return;
    }
    const words = full;
    setDraft(d => ({
      ...d,
      body: d.body.trim() ? `${d.body}\n\n${words}` : words,
      assetId: asset?.id ?? d.assetId ?? null,
      assetUrl: asset?.url ?? d.assetUrl ?? null,
    }));
  }, [prefill?.nonce, Boolean(data), Boolean(snippets.data)]);
  const byId = useMemo(
    () => new Map((data?.sends ?? []).map(s => [s.ghl_message_id, s] as const)),
    [data?.sends],
  );

  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (busy || !can.ok || !draft.body.trim()) return;
    setBusy(true);
    try {
      const out = await api<{ message: SendRow; repeated?: boolean }>(
        "convo.send",
        {
          contact_id: contactId,
          channel,
          body: draft.body,
          subject: channel === "email" ? draft.subject : undefined,
          request_id: draft.id,
          asset_id:
            draft.assetId &&
            (!draft.assetUrl || draft.body.includes(draft.assetUrl))
              ? draft.assetId
              : undefined,
        },
      );
      if (out.message.state === "failed")
        toast.error(
          `${CHANNEL_WORD[channel]} did not deliver it: ${out.message.error ?? "no reason given"}.`,
        );
      else
        toast.success(
          out.repeated
            ? "That message was already sent."
            : `Sent by ${CHANNEL_WORD[channel]}.`,
        );
      setDraft({
        contactId,
        channel,
        body: "",
        subject: "",
        id: crypto.randomUUID(),
      });
      void convo.reload();
    } catch (err) {
      toast.error(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="muted text-xs">
          {error
            ? "The conversation could not be read."
            : data
              ? `Read from HighLevel ${ago(data.read_at)}`
              : "Reading the conversation…"}
        </p>
        <button
          type="button"
          onClick={() => void convo.reload()}
          className="muted inline-flex items-center gap-1 text-xs hover:underline"
        >
          <RefreshCw className="size-3" aria-hidden /> Read again
        </button>
      </div>
      {error ? (
        <p className="callout-bad rounded-[var(--radius-md)] border px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}

      <div
        ref={listRef}
        className={`space-y-2 overflow-y-auto pe-1 ${compact ? "max-h-72" : "max-h-[28rem]"}`}
      >
        {convo.canLoadOlder ? (
          <button
            type="button"
            onClick={() => void convo.loadOlder()}
            disabled={convo.loadingOlder}
            className="muted mx-auto block text-xs underline-offset-4 hover:underline"
          >
            {convo.loadingOlder ? "Reading…" : "Earlier messages"}
          </button>
        ) : null}
        {data && !thread.length ? (
          <p className="muted py-6 text-center text-sm">
            Nothing has been said to this lead yet.
          </p>
        ) : null}
        {thread.map(m => (
          <Bubble key={m.id} m={m} sentBy={byId.get(m.id)?.sent_by ?? null} />
        ))}
      </div>

      <form onSubmit={send} className="space-y-2 border-t hairline pt-3">
        <div className="flex flex-wrap items-center gap-2">
          {(["whatsapp", "email"] as const).map(c => {
            const u = usable(c);
            const Icon = c === "whatsapp" ? MessageCircle : Mail;
            return (
              <button
                key={c}
                type="button"
                aria-pressed={channel === c}
                onClick={() => {
                  picked.current = true;
                  setChannel(c);
                }}
                title={u.ok ? undefined : u.why}
                className={`inline-flex h-7 items-center gap-1 rounded-full border hairline px-2.5 text-xs ${channel === c ? "bg-[color:var(--secondary)] font-medium" : "muted"} ${u.ok || (c === "whatsapp" && waTemplate) ? "" : "opacity-60"}`}
              >
                <Icon className="size-3.5" aria-hidden /> {CHANNEL_WORD[c]}
              </button>
            );
          })}
        </div>
        {can.why ? (
          <p className={`text-xs ${can.ok ? "muted" : ""}`}>{can.why}</p>
        ) : null}
        {templateMode ? (
          <TemplateComposer
            contactId={contactId}
            firstName={values.name ?? ""}
            language={language}
            templates={templates.data ?? []}
            values={values}
            prefill={linePrefill}
            onSent={() => void convo.reload()}
          />
        ) : (
          <>
            {channel === "email" ? (
              <input
                value={draft.subject}
                onChange={e =>
                  setDraft(d => ({ ...d, subject: e.target.value }))
                }
                placeholder="Subject"
                className={field}
                dir="auto"
                disabled={!can.ok}
              />
            ) : null}
            <textarea
              value={draft.body}
              onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
              onKeyDown={onKey}
              rows={compact ? 3 : 4}
              placeholder={
                can.ok
                  ? channel === "whatsapp"
                    ? "Write to them on WhatsApp"
                    : "Write the email"
                  : "Pick a channel that is open"
              }
              className={`${field} h-auto py-2 leading-relaxed`}
              dir="auto"
              disabled={!can.ok}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {can.ok ? (
                  <SnippetPicker
                    language={language}
                    values={values}
                    onPick={text => setDraft(d => ({ ...d, body: text }))}
                  />
                ) : null}
                <p className="muted text-[11px]">
                  Goes out from the official line through HighLevel. Ctrl or ⌘
                  and Enter sends.
                </p>
              </div>
              <button
                type="submit"
                disabled={busy || !can.ok || !draft.body.trim()}
                className={buttonPrimary}
              >
                <Send className="size-3.5" aria-hidden />
                {busy ? "Sending…" : `Send by ${CHANNEL_WORD[channel]}`}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

function Bubble({ m, sentBy }: { m: ThreadMessage; sentBy: string | null }) {
  if (m.channel === "call" || m.channel === "other" || !m.body)
    return (
      <p className="muted text-center text-[11px]">
        {CHANNEL_WORD[m.channel]}
        {m.direction === "inbound"
          ? " from them"
          : m.direction === "outbound"
            ? " from us"
            : ""}
        {m.at ? ` · ${day(m.at)} ${clock(m.at)}` : ""}
        {m.status ? ` · ${STATUS_WORD[m.status] ?? m.status}` : ""}
      </p>
    );
  const ours = m.direction === "outbound";
  const failed = m.status === "failed" || m.status === "undelivered";
  return (
    <div className={`flex ${ours ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-[var(--radius-md)] px-3 py-2 text-sm ${failed ? "callout-bad border" : ""}`}
        style={
          failed
            ? undefined
            : {
                background: ours
                  ? "color-mix(in oklch, var(--primary) 16%, var(--card))"
                  : "var(--secondary)",
              }
        }
      >
        {m.subject ? (
          <p className="mb-1 font-medium" dir="auto">
            {m.subject}
          </p>
        ) : null}
        <p className="whitespace-pre-wrap break-words" dir="auto">
          {m.body}
        </p>
        {m.attachments.map(a => (
          <a
            key={a}
            href={a}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1 block text-xs underline underline-offset-2"
          >
            Open the attachment
          </a>
        ))}
        <p className="muted mt-1 text-[11px]">
          {CHANNEL_WORD[m.channel]}
          {m.at ? ` · ${day(m.at)} ${clock(m.at)}` : ""}
          {ours && m.status ? ` · ${STATUS_WORD[m.status] ?? m.status}` : ""}
          {sentBy ? ` · ${sentBy.split("@")[0]}` : ""}
        </p>
        {failed && m.error ? (
          <p className="mt-1 text-[11px]">Why: {m.error}</p>
        ) : null}
      </div>
    </div>
  );
}
