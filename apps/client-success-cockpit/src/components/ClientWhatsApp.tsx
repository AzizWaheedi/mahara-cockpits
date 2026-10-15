import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Link2,
  LoaderCircle,
  Mic,
  RefreshCw,
  Send,
  Unlink,
  Users,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Chip, Dot, Kicker } from "@/components/kit";
import { readClientContact } from "@/lib/checkInClient";
import {
  clientWaiting,
  kuwaitWhen,
  teamSpeaker,
  waMentions,
} from "@/lib/clientBrief";
import {
  type ClientWhatsAppDay,
  type ClientWhatsAppMessage,
  type ClientWhatsAppThread,
  type LinkCandidates,
  type LinkCard,
  linkThread,
  readLinkCandidates,
} from "@/lib/clientWhatsApp";
import { sendReply } from "@/lib/comms";
import { cn } from "@/lib/utils";

/**
 * The client's WhatsApp on their page: today's messages on the CSM's number
 * (read from the inbox mirror Hala keeps every fifteen minutes), a reply box
 * that sends through GoHighLevel, and the link that ties a chat to the client.
 * Not a chat client: the day's conversation, the reply, and nothing else.
 */

const clock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kuwait",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** A message that starts in Arabic reads right to left, dot and all. */
const RTL = /^[\s\p{P}\d]*[\u0600-\u06FF]/u;

function when(at: number, dayStart: number) {
  return at >= dayStart ? clock.format(at) : kuwaitWhen(at);
}

function waited(at: number | null) {
  if (!at) return "";
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

function Body({ m }: { m: ClientWhatsAppMessage }) {
  const text = waMentions(m.body ?? "").trim();
  if (m.kind === "audio" && !text)
    return (
      <span className="inline-flex items-center gap-1 italic text-muted-foreground">
        <Mic aria-hidden className="size-3.5" />
        Voice note, open it on the phone
      </span>
    );
  if (!text)
    return <span className="italic text-muted-foreground">A {m.kind}</span>;
  return (
    <bdi dir="auto" className="whitespace-pre-line">
      {text}
    </bdi>
  );
}

function Messages({
  list,
  t,
  dayStart,
  team,
}: {
  list: ClientWhatsAppMessage[];
  t: ClientWhatsAppThread;
  dayStart: number;
  team: string[];
}) {
  return (
    <ul className="max-w-3xl space-y-2">
      {list.map(m => {
        // A team member writing in the group from their own phone is us.
        const ours = m.direction === "outbound" || teamSpeaker(m.speaker, team);
        return (
          <li
            key={m.id}
            dir={RTL.test(m.body ?? "") ? "rtl" : undefined}
            className="flex gap-2.5 text-sm leading-6"
          >
            <span className="mt-[9px]">
              <Dot tone={ours ? "neutral" : "accent"} />
            </span>
            <div className="min-w-0 flex-1">
              <span className={ours ? "text-muted-foreground" : undefined}>
                <Body m={m} />
              </span>
              <span className="mt-0.5 block font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">
                {ours ? (m.speaker ?? "Us") : (m.speaker ?? t.name)} ·{" "}
                {when(m.at, dayStart)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Why the reply box cannot send, in words; null when it can. */
function blocked(t: ClientWhatsAppThread, day: ClientWhatsAppDay) {
  if (t.archived) return "This chat is archived. Reply from the phone.";
  if (["intent", "accepted", "reconcile"].includes(t.replyState ?? ""))
    return "A reply is already on its way. It shows here after the next sync.";
  if (day.stale)
    return "Sending waits for a fresh sync, so a reply never crosses a message we have not seen.";
  if (!t.sendSupported || !t.contextKey)
    return "This chat cannot send from the cockpit. Reply from the phone.";
  return null;
}

function Reply({
  client,
  t,
  day,
  onSent,
}: {
  client: SupabaseClient;
  t: ClientWhatsAppThread;
  day: ClientWhatsAppDay;
  onSent: () => void;
}) {
  const unsent = t.draft && !t.draft.sentAt ? t.draft : null;
  const hasAr = Boolean(unsent?.ar);
  const [lang, setLang] = useState<"ar" | "en">(hasAr ? "ar" : "en");
  const [text, setText] = useState((hasAr ? unsent?.ar : unsent?.en) ?? "");
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const why = blocked(t, day);
  const both = Boolean(unsent?.ar && unsent?.en);
  return (
    <div className="space-y-2">
      {unsent?.why ? (
        <p className="text-xs text-muted-foreground">Drafted: {unsent.why}</p>
      ) : null}
      {both ? (
        <div className="inline-flex gap-1">
          {(["ar", "en"] as const).map(l => (
            <button
              key={l}
              type="button"
              aria-pressed={lang === l}
              onClick={() => {
                setLang(l);
                if (!edited)
                  setText((l === "ar" ? unsent?.ar : unsent?.en) ?? "");
              }}
              className={cn(
                "inline-flex h-8 items-center rounded-full px-3 text-xs font-medium",
                lang === l
                  ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {l === "ar" ? "العربية" : "English"}
            </button>
          ))}
        </div>
      ) : null}
      <textarea
        value={text}
        dir="auto"
        rows={3}
        disabled={Boolean(why) || busy}
        aria-label={`Reply to ${t.name}`}
        placeholder={why ? undefined : "Write the reply"}
        onChange={e => {
          setText(e.target.value);
          setEdited(true);
          setError(null);
        }}
        className="w-full rounded-lg border bg-background p-2 text-sm leading-relaxed disabled:opacity-60"
      />
      {why ? <p className="text-xs text-muted-foreground">{why}</p> : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={Boolean(why) || busy || !text.trim()}
        onClick={async () => {
          if (!t.contextKey) return;
          setBusy(true);
          setError(null);
          try {
            const receipt = await sendReply(client, {
              chatId: t.threadId,
              text: text.trim(),
              contextKey: t.contextKey,
            });
            toast.success(
              receipt.deliveryConfirmed
                ? `Sent to ${t.name}. Delivered.`
                : `Sent to ${t.name}. WhatsApp has not confirmed delivery yet.`,
            );
            setText("");
            setEdited(false);
            onSent();
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "The reply did not send.",
            );
          } finally {
            setBusy(false);
          }
        }}
        className="inline-flex h-9 max-w-full items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      >
        {busy ? (
          <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
        ) : (
          <Send aria-hidden className="size-3.5" />
        )}
        <span className="truncate">
          {busy ? "Sending…" : `Send to ${t.name}`}
        </span>
      </button>
    </div>
  );
}

function Chat({
  client,
  t,
  day,
  taskId,
  onChanged,
  team,
}: {
  client: SupabaseClient;
  t: ClientWhatsAppThread;
  day: ClientWhatsAppDay;
  taskId: string;
  onChanged: () => void;
  team: string[];
}) {
  const [earlier, setEarlier] = useState(false);
  const waiting = t.awaitingUs ? clientWaiting(t.messages, team) : undefined;
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [busy, setBusy] = useState(false);
  const unlinkId = useRef<string | null>(null);
  const today = t.messages.filter(m => m.today);
  const before = t.messages.filter(m => !m.today);
  return (
    <article className="space-y-3 border-t pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium" dir="auto">
          {t.name}
        </span>
        {t.isGroup ? (
          <Chip dot={false} title="A WhatsApp group with the client's people">
            <span className="inline-flex items-center gap-1">
              <Users aria-hidden className="size-3" />
              Group
            </span>
          </Chip>
        ) : null}
        {waiting ? (
          <Chip tone="warn">Waiting on us {waited(waiting.at)}</Chip>
        ) : null}
        <span className="text-xs text-muted-foreground">
          Today: {t.today.inbound} from them, {t.today.outbound} from us
        </span>
      </div>

      {today.length ? (
        <div className="max-h-96 overflow-y-auto pr-1">
          <Messages list={today} t={t} dayStart={day.dayStart} team={team} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t.lastAt
            ? `Nothing yet today. Last message ${kuwaitWhen(t.lastAt)}.`
            : "No messages in this chat yet."}
        </p>
      )}
      {before.length ? (
        <div>
          <button
            type="button"
            aria-expanded={earlier}
            onClick={() => setEarlier(v => !v)}
            className="text-xs text-primary underline-offset-4 hover:underline"
          >
            {earlier
              ? "Hide earlier messages"
              : `Earlier messages (${before.length})`}
          </button>
          {earlier ? (
            <div className="mt-2 max-h-80 overflow-y-auto pr-1">
              <Messages
                list={before}
                t={t}
                dayStart={day.dayStart}
                team={team}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <Reply
        key={`${t.threadId}-${t.draft?.ar ?? ""}-${t.draft?.en ?? ""}`}
        client={client}
        t={t}
        day={day}
        onSent={onChanged}
      />

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {confirmUnlink ? (
          <>
            <span>Unlink this chat from the client?</span>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                unlinkId.current ??= crypto.randomUUID();
                try {
                  await linkThread(client, {
                    threadId: t.threadId,
                    taskId,
                    requestId: unlinkId.current,
                    unlink: true,
                  });
                  unlinkId.current = null;
                  toast.success(`Unlinked ${t.name}.`);
                  onChanged();
                } catch (e) {
                  toast.error(
                    e instanceof Error
                      ? e.message
                      : "The chat was not unlinked.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
              className="font-medium text-foreground underline-offset-4 hover:underline disabled:opacity-50"
            >
              {busy ? "Unlinking…" : "Unlink"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmUnlink(false)}
              className="underline-offset-4 hover:underline"
            >
              Keep it
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmUnlink(true)}
            className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline"
          >
            <Unlink aria-hidden className="size-3" />
            Not their chat? Unlink it
          </button>
        )}
      </div>
    </article>
  );
}

/** Words that say nothing about which client a chat belongs to. */
const NOT_A_NAME = new Set([
  "mahara",
  "media",
  "company",
  "co",
  "llc",
  "wll",
  "est",
  "the",
  "and",
  "of",
  "for",
  "group",
  "شركة",
  "مؤسسة",
]);

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(w => w.length >= 3 && !NOT_A_NAME.has(w));

/**
 * How surely a chat is named after the client: client groups are named
 * "Mahara | <client>". 2 when every distinctive word of the client's name is
 * in it, 1 when only the first one (4 letters or more) is, as with a long
 * legal name, 0 otherwise.
 */
export function namedAfter(chat: string, client: string): 0 | 1 | 2 {
  const want = words(client);
  if (!want.length) return 0;
  const have = new Set(words(chat));
  if (want.every(w => have.has(w))) return 2;
  return want[0].length >= 4 && have.has(want[0]) ? 1 : 0;
}

function CandidateRow({
  c,
  onLink,
  busy,
  named = 0,
}: {
  c: LinkCard;
  onLink: () => void;
  busy: boolean;
  named?: 0 | 1 | 2;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="min-w-0 text-sm" dir="auto">
        {c.name}
        {c.phoneLast4 ? (
          <span className="text-muted-foreground"> · ends {c.phoneLast4}</span>
        ) : null}
      </span>
      <span className="text-xs text-muted-foreground">
        {c.match === "contact"
          ? "Their GoHighLevel contact"
          : c.match === "phone"
            ? "Same phone number"
            : named
              ? named === 2
                ? "Named after them"
                : "Has their name in it"
              : c.lastAt
                ? `Active ${kuwaitWhen(c.lastAt)}`
                : null}
        {c.linkedElsewhere ? ", linked to another client" : ""}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={onLink}
        className="ml-auto inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
      >
        <Link2 aria-hidden className="size-3.5" />
        Link
      </button>
    </li>
  );
}

function LinkChat({
  client,
  taskId,
  clientName,
  onLinked,
}: {
  client: SupabaseClient;
  taskId: string;
  clientName: string;
  onLinked: () => void;
}) {
  const [found, setFound] = useState<LinkCandidates | null>(null);
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [allGroups, setAllGroups] = useState(false);
  const ids = useRef(new Map<string, string>());

  async function look() {
    setLooking(true);
    setError(null);
    try {
      // GoHighLevel's contact for the client, so their own chat is suggested.
      const contact = await readClientContact(client, { taskId }).catch(
        () => null,
      );
      setFound(
        await readLinkCandidates(client, taskId, {
          id: contact?.id,
          phone: contact?.phone,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "The chats could not be read.");
    } finally {
      setLooking(false);
    }
  }

  async function link(c: LinkCard) {
    let id = ids.current.get(c.threadId);
    if (!id) {
      id = crypto.randomUUID();
      ids.current.set(c.threadId, id);
    }
    setBusy(c.threadId);
    try {
      await linkThread(client, { threadId: c.threadId, taskId, requestId: id });
      ids.current.delete(c.threadId);
      toast.success(`Linked ${c.name} to ${clientName}.`);
      onLinked();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The chat was not linked.");
    } finally {
      setBusy(null);
    }
  }

  if (!found)
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          No chat is linked to {clientName} yet, so their messages cannot show
          here or in the brief.
        </p>
        <button
          type="button"
          onClick={() => void look()}
          disabled={looking}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          {looking ? (
            <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
          ) : (
            <Link2 aria-hidden className="size-3.5" />
          )}
          Find their chat
        </button>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    );

  // A group named after the client goes first; the rest are by last activity.
  const sorted = [...found.groups].sort(
    (a, b) => namedAfter(b.name, clientName) - namedAfter(a.name, clientName),
  );
  const groups = allGroups ? sorted : sorted.slice(0, 6);
  return (
    <div className="space-y-4">
      {found.note ? (
        <p className="text-sm text-muted-foreground">{found.note}</p>
      ) : null}
      {found.fullScope ? (
        <>
          <div className="space-y-2">
            <Kicker>Their own chat</Kicker>
            {found.matches.length ? (
              <ul className="space-y-2">
                {found.matches.map(c => (
                  <CandidateRow
                    key={c.threadId}
                    c={c}
                    busy={busy !== null}
                    onLink={() => void link(c)}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No 1-to-1 chat matches their GoHighLevel contact or phone.
              </p>
            )}
          </div>
          {found.groups.length ? (
            <div className="space-y-2">
              <Kicker>Or their group</Kicker>
              <p className="text-xs text-muted-foreground">
                Groups active in the last 30 days that no client has yet. Pick
                only the one with their people in it.
              </p>
              <ul className="space-y-2">
                {groups.map(c => (
                  <CandidateRow
                    key={c.threadId}
                    c={c}
                    named={namedAfter(c.name, clientName)}
                    busy={busy !== null}
                    onLink={() => void link(c)}
                  />
                ))}
              </ul>
              {found.groups.length > 6 ? (
                <button
                  type="button"
                  onClick={() => setAllGroups(v => !v)}
                  className="text-xs text-primary underline-offset-4 hover:underline"
                >
                  {allGroups
                    ? "Show fewer"
                    : `Show all ${found.groups.length} groups`}
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function ClientWhatsApp({
  client,
  taskId,
  clientName,
  data,
  error,
  loading,
  reload,
  team = [],
}: {
  client: SupabaseClient | null;
  taskId: string;
  clientName: string;
  data: ClientWhatsAppDay | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  /** The team's names: their messages in a group are ours, not the client's. */
  team?: string[];
}) {
  const [adding, setAdding] = useState(false);
  // Not set up for client success: one quiet line, the why folded under it.
  if (data && !data.configured)
    return (
      <details className="rounded-2xl border bg-card px-4 py-3 text-sm text-muted-foreground sm:px-6">
        <summary className="cursor-pointer">WhatsApp is not connected</summary>
        <p className="mt-2 max-w-prose text-xs">
          {data.note ??
            "Connect the CSM's number in GoHighLevel and the client's messages show here."}
        </p>
      </details>
    );

  const live = data?.threads.filter(t => !t.archived) ?? [];
  const archived = data?.threads.filter(t => t.archived) ?? [];
  const waiting = live.filter(
    t => t.awaitingUs && clientWaiting(t.messages, team),
  ).length;

  return (
    <section
      aria-label={`WhatsApp with ${clientName}`}
      className="space-y-4 rounded-2xl border bg-card p-4 sm:p-6"
    >
      <header className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-[15px] font-semibold">WhatsApp</h2>
          {waiting ? (
            <Chip tone="warn">
              {waiting === 1 ? "1 chat" : `${waiting} chats`} waiting on us
            </Chip>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {data?.stale
              ? data.note
              : data?.syncedAt
                ? `Synced ${clock.format(data.syncedAt)}`
                : null}
          </span>
        </div>
        <button
          type="button"
          onClick={reload}
          disabled={loading}
          aria-label="Read WhatsApp again"
          className="-mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw
            aria-hidden
            className={cn("size-3.5", loading && "animate-spin")}
          />
        </button>
      </header>

      {error ? (
        <p className="text-sm text-muted-foreground">
          WhatsApp could not be read: {error}. Read it again with the button
          above.
        </p>
      ) : !data ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
          Reading today's messages
        </p>
      ) : !client ? null : live.length ? (
        <div className="space-y-4">
          {live.map(t => (
            <Chat
              key={t.threadId}
              client={client}
              t={t}
              day={data}
              taskId={taskId}
              onChanged={reload}
              team={team}
            />
          ))}
          {adding ? (
            <div className="border-t pt-4">
              <LinkChat
                client={client}
                taskId={taskId}
                clientName={clientName}
                onLinked={() => {
                  setAdding(false);
                  reload();
                }}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
            >
              <Link2 aria-hidden className="size-3" />
              Link another chat, such as their group
            </button>
          )}
        </div>
      ) : (
        <LinkChat
          client={client}
          taskId={taskId}
          clientName={clientName}
          onLinked={reload}
        />
      )}
      {archived.length ? (
        <p className="text-xs text-muted-foreground">
          {archived.length === 1
            ? `1 archived chat is linked too (${archived[0].name}).`
            : `${archived.length} archived chats are linked too.`}
        </p>
      ) : null}
    </section>
  );
}
