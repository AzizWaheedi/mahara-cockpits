import { ArrowLeft, Inbox, Search, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ChannelGlyph } from "../components/ChannelGlyph";
import {
  type Channel,
  Conversation,
  useConversation,
} from "../components/Conversation";
import { Avatar, EmptyState, Failed, field } from "../components/kit";
import { api } from "../lib/api";
import {
  type InboxFilter,
  readInboxAfter,
  useCopiedThread,
  useInbox,
  useInboxCounts,
  useNow,
} from "../lib/data";
import { clock, day } from "../lib/format";
import {
  accountLabel,
  CHANNEL_LABEL,
  FILTER_CHANNELS,
  hourShare,
  type InboxChannel,
  type InboxCounts,
  type InboxPerson,
  type InboxRow,
  type InboxState,
  previewLine,
  STATE_LABEL,
  syncWords,
  waitTone,
  waitWords,
} from "../lib/messages";
import { supabase } from "../lib/supabase";
import { toast } from "../lib/toast";
import type { Me } from "../lib/types";

/**
 * Messages (Aziz, 2026-10-29): every conversation on the sales sub-account
 * in one place, like HighLevel's own, filtered by whose inbox it is, by
 * channel (WhatsApp, email, Instagram, Facebook; SMS only when a real one
 * exists) and by the inbox on our side, with the lead's thread and the reply
 * box beside it. The clock on each waiting row runs against the team's
 * one-hour reply standard.
 */

const SENDABLE: Channel[] = ["whatsapp", "email", "instagram", "facebook"];
const asSendable = (c: InboxChannel | null): Channel | null =>
  c && (SENDABLE as string[]).includes(c) ? (c as Channel) : null;

interface Saved {
  person: InboxPerson;
  state: InboxState;
  channel: InboxChannel | null;
  account: string | null;
}

/** Answered or read here since the lead's last message (the copy may not know yet). */
function after(m: Map<string, string>, r: InboxRow) {
  const at = m.get(r.conversation_id);
  if (at === undefined) return false;
  const lead = r.last_in_at ? Date.parse(r.last_in_at) : 0;
  return lead <= (at ? Date.parse(at) : 0);
}

function savedKey(me: Me) {
  return `sales_messages_filters:${me.email ?? "me"}`;
}

function readSaved(me: Me): Saved {
  const fallback: Saved = {
    person: !me.manager && me.ghl_user_id ? me.ghl_user_id : "everyone",
    state: "reply",
    channel: null,
    account: null,
  };
  try {
    const raw = localStorage.getItem(savedKey(me));
    if (!raw) return fallback;
    const v = JSON.parse(raw) as Partial<Saved>;
    return {
      person: typeof v.person === "string" ? v.person : fallback.person,
      state: (["reply", "unread", "all", "auto"] as const).includes(
        v.state as InboxState,
      )
        ? (v.state as InboxState)
        : "reply",
      channel:
        typeof v.channel === "string" ? (v.channel as InboxChannel) : null,
      account: typeof v.account === "string" ? v.account : null,
    };
  } catch {
    return fallback;
  }
}

export default function MessagesPage({ me }: { me: Me }) {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const now = useNow(30_000);
  const [saved, setSaved] = useState<Saved>(() => readSaved(me));
  const [q, setQ] = useState("");
  const [typed, setTyped] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setQ(typed), 300);
    return () => window.clearTimeout(t);
  }, [typed]);
  useEffect(() => {
    try {
      localStorage.setItem(savedKey(me), JSON.stringify(saved));
    } catch {
      // the choice just will not be remembered
    }
  }, [saved, me]);
  const set = (p: Partial<Saved>) => setSaved(s => ({ ...s, ...p }));

  const filter: InboxFilter = { ...saved, q };
  const list = useInbox(filter);
  const counts = useInboxCounts(saved.person, saved.channel, saved.account);

  // "Show more": pages after the first, kept until a filter changes.
  const [older, setOlder] = useState<InboxRow[]>([]);
  const [olderMore, setOlderMore] = useState<boolean | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const filterKey = JSON.stringify(filter);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new filter starts the list again
  useEffect(() => {
    setOlder([]);
    setOlderMore(null);
  }, [filterKey]);

  // Rows a rep just answered or opened, by the lead's last message at the
  // time: until the copy catches up, they read as answered or read; a newer
  // message from the lead brings them back at once.
  const [answered, setAnswered] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [seen, setSeen] = useState<Map<string, string>>(() => new Map());

  const rows = useMemo(() => {
    const out: InboxRow[] = [];
    const ids = new Set<string>();
    for (const r of [...(list.data?.rows ?? []), ...older]) {
      if (ids.has(r.conversation_id)) continue;
      ids.add(r.conversation_id);
      if (saved.state === "reply" && after(answered, r)) continue;
      out.push(after(seen, r) ? { ...r, unread: 0 } : r);
    }
    return out;
  }, [list.data, older, answered, seen, saved.state]);
  const more = olderMore ?? list.data?.more ?? false;

  const showMore = async () => {
    const last = rows.at(-1);
    if (!last) return;
    setLoadingMore(true);
    try {
      const page = await readInboxAfter(filter, last);
      setOlder(o => [...o, ...page.rows]);
      setOlderMore(page.more);
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setLoadingMore(false);
    }
  };

  const picked = useRef<InboxRow | null>(null);
  const selected =
    rows.find(r => r.conversation_id === conversationId) ??
    (picked.current?.conversation_id === conversationId
      ? picked.current
      : null);
  // On a phone the list and the thread take turns on one screen: the
  // thread opens at the top, and Back returns to the same place in the list.
  const rootRef = useRef<HTMLDivElement>(null);
  const listTop = useRef(0);
  const scroller = () => {
    let el = rootRef.current?.parentElement ?? null;
    while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY))
      el = el.parentElement;
    return el;
  };
  const open = (r: InboxRow) => {
    picked.current = r;
    const sc = scroller();
    listTop.current = sc?.scrollTop ?? 0;
    navigate(`/messages/${r.conversation_id}`);
    if (sc && window.matchMedia("(max-width: 1023px)").matches)
      sc.scrollTop = 0;
  };
  const back = () => {
    navigate("/messages");
    window.requestAnimationFrame(() => {
      const sc = scroller();
      if (sc) sc.scrollTop = listTop.current;
    });
  };

  return (
    <div
      ref={rootRef}
      className={`mx-auto flex w-full max-w-[1440px] flex-col lg:h-[calc(100dvh-2.5rem)] lg:px-6 lg:py-5 ${conversationId ? "max-lg:h-[calc(100dvh-9.5rem-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))]" : ""}`}
    >
      <div className="flex min-h-0 flex-1 overflow-hidden lg:rounded-[var(--radius-xl)] lg:border lg:hairline lg:bg-[color:var(--card)]">
        <section
          aria-label="Conversations"
          className={`min-h-0 w-full flex-col lg:flex lg:w-[25rem] lg:shrink-0 lg:border-e lg:hairline ${conversationId ? "hidden" : "flex"}`}
        >
          <ListHead
            me={me}
            saved={saved}
            set={set}
            counts={counts.data}
            countsError={counts.error}
            typed={typed}
            setTyped={setTyped}
            now={now}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {list.error && !list.data ? (
              <div className="p-4">
                <Failed
                  what="The messages"
                  error={list.error}
                  retry={list.reload}
                />
              </div>
            ) : !list.data ? (
              <ListSkeleton />
            ) : rows.length === 0 ? (
              <EmptyList
                state={saved.state}
                q={q}
                days={counts.data?.reply_days ?? 14}
                onAll={() => set({ state: "all" })}
              />
            ) : (
              <ul className="divide-y hairline">
                {rows.map(r => (
                  <li key={r.conversation_id}>
                    <RowItem
                      r={r}
                      now={now}
                      on={r.conversation_id === conversationId}
                      onOpen={() => open(r)}
                      waitingView={saved.state === "reply"}
                    />
                  </li>
                ))}
                {more ? (
                  <li className="p-3 text-center">
                    <button
                      type="button"
                      onClick={() => void showMore()}
                      disabled={loadingMore}
                      className="muted text-xs underline-offset-4 hover:underline"
                    >
                      {loadingMore ? "Reading…" : "Show more"}
                    </button>
                  </li>
                ) : null}
              </ul>
            )}
          </div>
        </section>

        <section
          aria-label="Conversation"
          className={`min-h-0 min-w-0 flex-1 flex-col ${conversationId ? "flex" : "hidden lg:flex"}`}
        >
          {conversationId ? (
            <Thread
              key={conversationId}
              conversationId={conversationId}
              row={selected}
              me={me}
              people={counts.data?.people ?? []}
              onBack={back}
              onSent={() => {
                const at = selected?.last_in_at ?? "";
                setAnswered(a => new Map(a).set(conversationId, at));
                window.setTimeout(() => {
                  list.reload();
                  counts.reload();
                }, 1500);
              }}
              onSeen={() => {
                const at = selected?.last_in_at ?? "";
                setSeen(m => new Map(m).set(conversationId, at));
                counts.reload();
              }}
              onAssigned={() => {
                list.reload();
                counts.reload();
              }}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState
                icon={Inbox}
                title="Pick a conversation"
                text="The lead's whole thread opens here, with the box to answer on WhatsApp, email, Instagram or Facebook."
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The list's head: whose inbox, what state, which channel, which inbox, search
// ---------------------------------------------------------------------------

function ListHead({
  me,
  saved,
  set,
  counts,
  countsError,
  typed,
  setTyped,
  now,
}: {
  me: Me;
  saved: Saved;
  set: (p: Partial<Saved>) => void;
  counts: InboxCounts | null;
  countsError: string | null;
  typed: string;
  setTyped: (v: string) => void;
  now: number;
}) {
  const sync = counts ? syncWords(counts.sync, now) : null;
  const mine = me.ghl_user_id ?? null;
  const people = (counts?.people ?? []).filter(p => p.ghl_user_id !== mine);
  const meRow = (counts?.people ?? []).find(p => p.ghl_user_id === mine);
  const stateCount = (s: InboxState) => counts?.states[s];
  const channelCount = (c: InboxChannel) => {
    const t = counts?.channels[c];
    return t ? (saved.state === "reply" ? t.reply : t.all) : 0;
  };
  const channels = FILTER_CHANNELS;
  const accounts = (counts?.accounts ?? []).filter(
    a => !saved.channel || a.key.startsWith(`${saved.channel}:`),
  );

  return (
    <div className="shrink-0 space-y-3 border-b hairline px-4 pb-3 pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">Messages</h1>
        {sync ? (
          <p
            className="muted flex min-w-0 items-center gap-1.5 truncate text-[11px]"
            title={sync.text}
          >
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full"
              style={{
                background:
                  sync.tone === "ok"
                    ? "var(--success)"
                    : sync.tone === "reading"
                      ? "var(--mahara-teal)"
                      : "var(--warning)",
              }}
            />
            <span className="truncate">
              {sync.tone === "ok"
                ? "Up to date"
                : sync.tone === "reading"
                  ? "Reading older threads"
                  : "Behind"}
            </span>
          </p>
        ) : null}
      </div>
      {sync && sync.tone !== "ok" ? (
        <p
          className={`rounded-[var(--radius-md)] px-3 py-2 text-xs leading-relaxed ${sync.tone === "behind" ? "callout-warn border" : "muted bg-[color:var(--muted)]"}`}
        >
          {sync.text}
        </p>
      ) : null}
      {countsError && !counts ? (
        <p className="callout-warn rounded-[var(--radius-md)] border px-3 py-2 text-xs">
          The numbers beside the filters could not be read: {countsError}
        </p>
      ) : null}

      <div
        role="radiogroup"
        aria-label="Whose inbox"
        className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]"
      >
        {mine ? (
          <PersonChip
            on={saved.person === mine}
            onClick={() => set({ person: mine })}
            label="Mine"
            n={meRow?.reply}
          />
        ) : null}
        <PersonChip
          on={saved.person === "unassigned"}
          onClick={() => set({ person: "unassigned" })}
          label="Unassigned"
          n={counts?.unassigned.reply}
        />
        <PersonChip
          on={saved.person === "everyone"}
          onClick={() => set({ person: "everyone" })}
          label="Everyone"
          n={counts?.everyone.reply}
        />
        {people.map(p => (
          <PersonChip
            key={p.ghl_user_id}
            on={saved.person === p.ghl_user_id}
            onClick={() => set({ person: p.ghl_user_id })}
            label={p.name.split(" ")[0]}
            n={p.reply}
          />
        ))}
      </div>

      <div
        role="tablist"
        aria-label="Which conversations"
        className="flex gap-4 border-b hairline text-sm"
      >
        {(["reply", "unread", "all"] as const).map(s => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={saved.state === s}
            onClick={() => set({ state: s })}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 pb-2 ${saved.state === s ? "border-[color:var(--mahara-teal)] font-medium" : "muted border-transparent hover:text-[color:var(--foreground)]"}`}
          >
            {STATE_LABEL[s]}
            {stateCount(s) !== undefined ? (
              <span className="font-mono text-[11px] opacity-70">
                {stateCount(s)}
              </span>
            ) : null}
          </button>
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={saved.state === "auto"}
          onClick={() =>
            set({ state: saved.state === "auto" ? "all" : "auto" })
          }
          title="Threads where only workflows have written and the lead never answered"
          className={`-mb-px ms-auto border-b-2 pb-2 text-xs ${saved.state === "auto" ? "border-[color:var(--mahara-teal)] font-medium" : "muted border-transparent hover:text-[color:var(--foreground)]"}`}
        >
          Automations only
        </button>
      </div>

      <div
        role="radiogroup"
        aria-label="Channel"
        className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]"
      >
        <ChannelChip
          on={!saved.channel}
          onClick={() => set({ channel: null, account: null })}
          label="All"
        />
        {channels.map(c => (
          <ChannelChip
            key={c}
            on={saved.channel === c}
            onClick={() =>
              set(
                saved.channel === c
                  ? { channel: null, account: null }
                  : { channel: c, account: null },
              )
            }
            label={CHANNEL_LABEL[c]}
            channel={c}
            n={channelCount(c)}
          />
        ))}
      </div>

      <div className="flex gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search names, numbers and messages</span>
          <Search
            className="muted pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2"
            aria-hidden
          />
          <input
            value={typed}
            onChange={e => setTyped(e.target.value)}
            placeholder="Search"
            className={`${field} h-8 ps-8 text-sm`}
            dir="auto"
            type="search"
          />
        </label>
        {accounts.length > 0 ? (
          <label className="shrink-0">
            <span className="sr-only">Inbox</span>
            <select
              value={saved.account ?? ""}
              onChange={e => {
                const key = e.target.value || null;
                set(
                  key
                    ? {
                        account: key,
                        channel: key.split(":")[0] as InboxChannel,
                      }
                    : { account: null },
                );
              }}
              className={`${field} h-8 max-w-[8.5rem] pe-7 text-xs sm:max-w-[11rem]`}
            >
              <option value="">All inboxes</option>
              {accounts.map(a => (
                <option key={a.key} value={a.key}>
                  {accountLabel(a.key)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {counts?.sms_pause && counts.sms_pause.workflows > 0 ? (
        <p className="muted text-[11px] leading-relaxed">
          SMS steps are off in {counts.sms_pause.workflows} workflow
          {counts.sms_pause.workflows === 1 ? "" : "s"} since{" "}
          {day(counts.sms_pause.since)} {clock(counts.sms_pause.since)}.{" "}
          {counts.sms_pause.copies_since
            ? `${counts.sms_pause.copies_since} SMS copies went out since; a workflow may still have one.`
            : "No SMS copy has gone out since."}
        </p>
      ) : null}
    </div>
  );
}

function PersonChip({
  on,
  onClick,
  label,
  n,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  n?: number;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-medium transition-colors ${on ? "bg-[color:var(--foreground)] text-[color:var(--background)]" : "muted bg-[color:var(--muted)] hover:text-[color:var(--foreground)]"}`}
    >
      {label}
      {n ? <span className="font-mono text-[11px] opacity-80">{n}</span> : null}
    </button>
  );
}

function ChannelChip({
  on,
  onClick,
  label,
  channel,
  n,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  channel?: InboxChannel;
  n?: number;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs transition-colors ${on ? "border-transparent bg-[color:color-mix(in_oklch,var(--primary)_15%,transparent)] font-medium ring-1 ring-inset ring-[color:color-mix(in_oklch,var(--primary)_45%,transparent)]" : "muted hairline hover:text-[color:var(--foreground)]"}`}
    >
      {channel ? <ChannelGlyph channel={channel} className="size-3.5" /> : null}
      {label}
      {n ? <span className="font-mono text-[11px] opacity-70">{n}</span> : null}
    </button>
  );
}

// ---------------------------------------------------------------------------
// One row: who, what they said, and how long they have waited
// ---------------------------------------------------------------------------

const TONE_COLOR = {
  fresh: "var(--mahara-teal)",
  due: "var(--warning)",
  late: "var(--destructive)",
  stale: "var(--muted-foreground)",
} as const;

function RowItem({
  r,
  now,
  on,
  onOpen,
  waitingView,
}: {
  r: InboxRow;
  now: number;
  on: boolean;
  onOpen: () => void;
  waitingView: boolean;
}) {
  const waiting = r.needs_reply && r.last_in_at;
  const tone = waitTone(r.last_in_at, now);
  const share = hourShare(r.last_in_at, now);
  const channel =
    (r.needs_reply ? r.last_in_channel : r.last_channel) ??
    r.channels[0] ??
    "whatsapp";
  const at = waitingView ? r.last_in_at : r.last_at;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={on ? "true" : undefined}
      className={`relative flex w-full gap-3 px-4 py-3 text-start transition-colors ${on ? "bg-[color:color-mix(in_oklch,var(--primary)_9%,transparent)]" : "hover:bg-[color:var(--muted)]"}`}
    >
      {/* The reply clock: fills over the hour the team has to answer. */}
      {waiting ? (
        <span
          aria-hidden
          className="absolute inset-y-3 start-1 w-[3px] overflow-hidden rounded-full bg-[color:var(--muted)]"
        >
          <span
            className="absolute inset-x-0 bottom-0 rounded-full"
            style={{
              height: `${Math.max(8, share * 100)}%`,
              background: TONE_COLOR[tone],
            }}
          />
        </span>
      ) : null}
      <span className="relative mt-0.5 shrink-0">
        <Avatar name={r.name} size={36} />
        <span className="absolute -bottom-1 -end-1 flex size-[18px] items-center justify-center rounded-full bg-[color:var(--card)] ring-1 ring-[color:var(--border)]">
          <ChannelGlyph channel={channel} className="size-[11px]" />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={`truncate text-sm ${r.unread ? "font-semibold" : "font-medium"}`}
            dir="auto"
          >
            {r.name ?? "Unknown"}
          </span>
          <span className="muted shrink-0 font-mono text-[11px]">
            {rowTime(at, now)}
          </span>
        </span>
        <span
          className={`mt-0.5 line-clamp-2 text-xs leading-snug ${r.unread ? "" : "muted"}`}
          dir="auto"
        >
          {previewLine(r) ||
            (r.read
              ? "No words: a picture, a file or a call."
              : "Reading this thread from HighLevel…")}
        </span>
        <span className="mt-1.5 flex items-center gap-2 text-[11px]">
          <span className="muted flex min-w-0 items-center gap-1 truncate">
            <UserRound className="size-3 shrink-0" aria-hidden />
            <span className="truncate">
              {r.owner ? r.owner.split(" ")[0] : "Unassigned"}
            </span>
            {r.stage ? (
              <span className="truncate">
                · {r.stage.replace(/[^\p{L}\p{N}\s()/-]/gu, "").trim()}
              </span>
            ) : null}
          </span>
          {r.client ? (
            <span className="shrink-0 rounded-full bg-[color:var(--muted)] px-1.5 py-px">
              Client
            </span>
          ) : null}
          <span className="ms-auto flex shrink-0 items-center gap-1.5">
            {r.unread ? (
              <span className="rounded-full bg-[color:var(--mahara-teal)] px-1.5 font-mono text-[10px] font-semibold text-[color:var(--deep-space)]">
                {r.unread}
              </span>
            ) : null}
            {waiting ? (
              <span
                className="font-mono font-medium"
                style={{
                  color: tone === "stale" ? undefined : TONE_COLOR[tone],
                }}
              >
                <span className="sr-only">Waiting </span>
                {waitWords(r.last_in_at, now)}
              </span>
            ) : null}
          </span>
        </span>
      </span>
    </button>
  );
}

function rowTime(iso: string | null, now: number): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (now - t < 20 * 3_600_000) return clock(iso);
  return day(iso);
}

function ListSkeleton() {
  return (
    <ul aria-label="Reading the messages" className="divide-y hairline">
      {[0, 1, 2, 3, 4, 5].map(i => (
        <li key={i} className="flex gap-3 px-4 py-3">
          <span className="size-9 shrink-0 animate-pulse rounded-full bg-[color:var(--muted)]" />
          <span className="flex-1 space-y-2 pt-1">
            <span className="block h-3 w-2/5 animate-pulse rounded bg-[color:var(--muted)]" />
            <span className="block h-3 w-4/5 animate-pulse rounded bg-[color:var(--muted)]" />
          </span>
        </li>
      ))}
    </ul>
  );
}

function EmptyList({
  state,
  q,
  days,
  onAll,
}: {
  state: InboxState;
  q: string;
  days: number;
  onAll: () => void;
}) {
  if (q.trim())
    return (
      <EmptyState
        compact
        title="Nothing matches"
        text="Try part of the name, the last digits of the number, or a word they wrote."
      />
    );
  if (state === "reply")
    return (
      <EmptyState
        compact
        title="Nobody is waiting on a reply"
        text={`Leads who wrote in the last ${days} days and have no answer yet show here, within a minute of writing.`}
        action={
          <button
            type="button"
            onClick={onAll}
            className="text-xs underline underline-offset-4"
          >
            See every conversation
          </button>
        }
      />
    );
  if (state === "unread")
    return (
      <EmptyState
        compact
        title="Nothing unread"
        text="Every conversation here has been opened."
      />
    );
  return (
    <EmptyState
      compact
      title="No conversations here"
      text="Pick another person or channel above."
    />
  );
}

// ---------------------------------------------------------------------------
// The open conversation
// ---------------------------------------------------------------------------

/** A conversation opened by its link (or no longer in the list): read on its own. */
function useOneRow(conversationId: string, row: InboxRow | null) {
  const [own, setOwn] = useState<InboxRow | null>(null);
  useEffect(() => {
    if (row) return;
    let alive = true;
    void (async () => {
      const { data } = await supabase
        .from("cockpit_sales_conversations")
        .select(
          "conversation_id,contact_id,contact_name,phone,email,assigned_to,channels,accounts,last_at,last_channel,last_in_at,last_in_channel,needs_reply,unread,copies",
        )
        .eq("conversation_id", conversationId)
        .maybeSingle();
      if (!alive || !data) return;
      const { data: lead } = await supabase
        .from("cockpit_sales_leads")
        .select("name,stage_name")
        .eq("contact_id", data.contact_id)
        .maybeSingle();
      if (!alive) return;
      setOwn({
        conversation_id: data.conversation_id,
        contact_id: data.contact_id,
        name:
          lead?.name ?? data.contact_name ?? data.phone ?? data.email ?? null,
        phone: data.phone ?? null,
        email: data.email ?? null,
        assigned_to: data.assigned_to ?? null,
        owner: null,
        stage: lead?.stage_name ?? null,
        client: false,
        channels: data.channels ?? [],
        accounts: data.accounts ?? [],
        last_at: data.last_at ?? null,
        last_channel: data.last_channel ?? null,
        last_direction: null,
        last_body: null,
        last_automated: null,
        last_in_at: data.last_in_at ?? null,
        last_in_channel: data.last_in_channel ?? null,
        last_in_body: null,
        last_reply_at: null,
        last_reply_by: null,
        needs_reply: data.needs_reply === true,
        unread: Number(data.unread ?? 0),
        copies: Number(data.copies ?? 0),
        read: true,
        sort_at: data.last_at ?? "",
      });
    })();
    return () => {
      alive = false;
    };
  }, [conversationId, row]);
  return row ?? own;
}

function Thread({
  conversationId,
  row: listed,
  me,
  people,
  onBack,
  onSent,
  onSeen,
  onAssigned,
}: {
  conversationId: string;
  row: InboxRow | null;
  me: Me;
  people: InboxCounts["people"];
  onBack: () => void;
  onSent: () => void;
  onSeen: () => void;
  onAssigned: () => void;
}) {
  const row = useOneRow(conversationId, listed);
  const contactId = row?.contact_id ?? "";
  const copied = useCopiedThread(contactId || null);
  const convo = useConversation(contactId, copied.data);

  // Opening a conversation reads it, as it does in HighLevel.
  const marked = useRef(false);
  useEffect(() => {
    if (!row || marked.current || !row.unread) return;
    marked.current = true;
    api("inbox.seen", { conversation_id: conversationId })
      .then(() => onSeen())
      .catch(() => {
        // the unread count stays; nothing else depends on it
      });
  }, [row, conversationId, onSeen]);

  if (!row)
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="muted text-sm">Opening the conversation…</p>
      </div>
    );

  return (
    <>
      <header className="flex shrink-0 items-center gap-3 border-b hairline px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to the messages"
          className="-ms-2 flex size-9 items-center justify-center rounded-full hover:bg-[color:var(--muted)] lg:hidden"
        >
          <ArrowLeft className="size-4" aria-hidden />
        </button>
        <Avatar name={row.name} size={36} />
        <div className="min-w-0 flex-1">
          <Link
            to={`/lead/${row.contact_id}`}
            className="inline-block max-w-full truncate align-top font-semibold underline-offset-4 hover:underline"
            dir="auto"
          >
            {row.name ?? "Unknown"}
          </Link>
          <p className="muted flex flex-wrap items-center gap-x-2 text-xs">
            {row.channels
              .filter(c => c !== "call")
              .map(c => (
                <span key={c} className="inline-flex items-center gap-1">
                  <ChannelGlyph channel={c} className="size-3" />
                  {CHANNEL_LABEL[c]}
                </span>
              ))}
            {row.phone ? (
              <span className="hidden font-mono sm:inline">{row.phone}</span>
            ) : null}
            {row.stage ? (
              <span className="hidden truncate sm:inline">{row.stage}</span>
            ) : null}
          </p>
        </div>
        <Owner row={row} me={me} people={people} onAssigned={onAssigned} />
      </header>
      <div className="min-h-0 flex-1 p-4">
        {contactId ? (
          <Conversation
            fill
            contactId={contactId}
            convo={convo}
            rep={me.name ?? null}
            prefer={asSendable(row.last_in_channel)}
            onSent={onSent}
          />
        ) : null}
      </div>
    </>
  );
}

/** Who the lead is with: take it, let it go, or (a manager) give it to someone. */
function Owner({
  row,
  me,
  people,
  onAssigned,
}: {
  row: InboxRow;
  me: Me;
  people: InboxCounts["people"];
  onAssigned: () => void;
}) {
  const [owner, setOwner] = useState<string | null>(row.assigned_to);
  const [busy, setBusy] = useState(false);
  useEffect(() => setOwner(row.assigned_to), [row.assigned_to]);
  const mine = me.ghl_user_id ?? null;
  const nameOf = (id: string | null) =>
    id
      ? (people.find(p => p.ghl_user_id === id)?.name ?? row.owner ?? "Someone")
      : "Unassigned";

  const move = async (to: string | null) => {
    setBusy(true);
    const before = owner;
    setOwner(to);
    try {
      await api("inbox.assign", { contact_id: row.contact_id, user_id: to });
      toast.success(
        to ? `Assigned to ${nameOf(to).split(" ")[0]}.` : "Unassigned.",
      );
      onAssigned();
    } catch (e) {
      setOwner(before);
      toast.error(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  if (me.manager)
    return (
      <label className="shrink-0">
        <span className="sr-only">Assigned to</span>
        <select
          value={owner ?? ""}
          disabled={busy}
          onChange={e => void move(e.target.value || null)}
          className={`${field} h-8 max-w-[7.5rem] pe-7 text-xs sm:max-w-[9.5rem]`}
        >
          <option value="">Unassigned</option>
          {people.map(p => (
            <option key={p.ghl_user_id} value={p.ghl_user_id}>
              {p.name}
            </option>
          ))}
          {owner && !people.some(p => p.ghl_user_id === owner) ? (
            <option value={owner}>{row.owner ?? "Someone else"}</option>
          ) : null}
        </select>
      </label>
    );
  if (!owner && mine)
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => void move(mine)}
        className="shrink-0 rounded-full bg-[color:var(--foreground)] px-3 py-1.5 text-xs font-medium text-[color:var(--background)] disabled:opacity-60"
      >
        Take it
      </button>
    );
  if (owner && owner === mine)
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => void move(null)}
        className="muted shrink-0 rounded-full border hairline px-3 py-1.5 text-xs hover:text-[color:var(--foreground)]"
        title="Put this lead back in the unassigned queue"
      >
        Yours · Let go
      </button>
    );
  return <span className="muted shrink-0 text-xs">{nameOf(owner)}</span>;
}
