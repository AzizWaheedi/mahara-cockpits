import { useAction } from "convex/react";
import {
  Archive,
  CheckCheck,
  LoaderCircle,
  Mic,
  Send,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";

/**
 * The WhatsApp desk.
 *
 * Hala scans GoHighLevel every fifteen minutes and leaves a reply drafted
 * in both languages wherever the client spoke last. This shows the thread
 * that earned the draft, lets the reply be edited, and sends it.
 *
 * Deliberately not a chat client. Nobody needs another WhatsApp: they
 * need the handful of conversations waiting on an answer, with the answer
 * already written and the last few messages visible so the draft can be
 * judged without opening the phone.
 */

type Message = {
  direction: string;
  body: string | null;
  kind: string;
  speaker: string | null;
  at: string;
};

type Draft = {
  ar: string | null;
  en: string | null;
  why: string | null;
  sent_at: string | null;
  sent_by: string | null;
} | null;

type Thread = {
  id: string;
  contact_name: string | null;
  client_name?: string;
  phone: string | null;
  is_group: boolean;
  desk: string;
  last_inbound_at: string | null;
  draft: Draft;
  messages: Message[];
};

function ago(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** What the bridge sent, when it was not words. */
function Body({ m }: { m: Message }) {
  const text = (m.body ?? "").trim();
  if (m.kind === "audio" && !text)
    return (
      <span className="inline-flex items-center gap-1 italic text-muted-foreground">
        <Mic className="size-3.5" />
        Voice note
      </span>
    );
  if (!text)
    return <span className="italic text-muted-foreground">{m.kind}</span>;
  return <span dir="auto">{text}</span>;
}

function Thread({
  t,
  desk,
  onDone,
}: {
  t: Thread;
  desk: Desk;
  onDone: () => void;
}) {
  const send = useAction(api.wa.send);
  const archive = useAction(api.wa.archive);

  const hasAr = Boolean(t.draft?.ar);
  const [lang, setLang] = useState<"ar" | "en">(hasAr ? "ar" : "en");
  const [text, setText] = useState((hasAr ? t.draft?.ar : t.draft?.en) ?? "");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [receipt, setReceipt] = useState("");
  const [edited, setEdited] = useState(false);

  // Switching language replaces an untouched draft but never an edit
  // somebody has made: losing typed words to a toggle is unforgivable.
  function switchTo(next: "ar" | "en") {
    setLang(next);
    if (!edited) setText((next === "ar" ? t.draft?.ar : t.draft?.en) ?? "");
  }

  const noDraft = !t.draft?.ar && !t.draft?.en;

  return (
    <li className="rounded-2xl border bg-card">
      <details>
        <summary className="cursor-pointer px-4 py-4 sm:px-6">
          <span className="font-semibold">
            {t.client_name || t.contact_name}
          </span>
          <span className="ml-2 text-xs text-muted-foreground">
            {ago(t.last_inbound_at)} · Open conversation
          </span>
        </summary>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-y px-4 py-2 sm:px-6">
          <span className="text-sm font-medium" dir="auto">
            {t.contact_name || t.phone || "Unknown"}
          </span>
          {t.is_group ? (
            <span
              title="A WhatsApp group, with the client's own people in it"
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
            >
              <Users className="size-3" />
              Group
            </span>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {ago(t.last_inbound_at)}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await archive({ threadId: t.id, desk });
                toast.success("Archived.");
                onDone();
              } catch (e) {
                toast.error(
                  e instanceof Error ? e.message : "That did not work.",
                );
              } finally {
                setBusy(false);
              }
            }}
            className="-mr-2 ml-auto inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <Archive className="size-3.5" />
            Archive
          </button>
        </div>

        <div className="space-y-1.5 px-4 py-3 sm:px-6">
          {t.messages.map(m => (
            <p
              key={`${m.at}-${m.direction}`}
              className={`text-sm leading-snug ${
                m.direction === "inbound" ? "" : "text-muted-foreground"
              }`}
            >
              <span className="mr-1.5 font-medium">
                {m.speaker ?? (m.direction === "inbound" ? "Them" : "Us")}
              </span>
              <Body m={m} />
            </p>
          ))}
        </div>

        {t.draft?.sent_at ? (
          <p className="flex items-center gap-1.5 border-t px-4 py-3 text-xs text-muted-foreground sm:px-6">
            <CheckCheck className="size-3.5 text-success" />
            Sent by {t.draft.sent_by}
          </p>
        ) : noDraft ? (
          <p className="border-t px-4 py-3 text-xs text-muted-foreground sm:px-6">
            {t.draft?.why ?? "No reply drafted for this one."}
          </p>
        ) : (
          <div className="border-t px-4 py-3 sm:px-6 sm:py-4">
            {t.draft?.why ? (
              <p className="mb-2 text-xs text-muted-foreground">
                {t.draft.why}
              </p>
            ) : null}
            <div className="mb-2 inline-flex gap-1">
              {(["ar", "en"] as const).map(l => (
                <button
                  key={l}
                  type="button"
                  onClick={() => switchTo(l)}
                  disabled={!t.draft?.[l]}
                  aria-pressed={lang === l}
                  className={`inline-flex h-8 items-center rounded-full px-3 text-xs font-medium disabled:opacity-40 ${
                    lang === l
                      ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {l === "ar" ? "العربية" : "English"}
                </button>
              ))}
            </div>
            <textarea
              aria-label={`Reply to ${t.client_name || t.contact_name}`}
              value={text}
              dir="auto"
              rows={3}
              onChange={e => {
                setText(e.target.value);
                setEdited(true);
              }}
              className="w-full rounded-lg border bg-background p-2 text-sm leading-relaxed"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                disabled={busy || Boolean(receipt) || !text.trim()}
                onClick={async () => {
                  if (lock.current) return;
                  lock.current = true;
                  setBusy(true);
                  try {
                    const result = await send({
                      threadId: t.id,
                      desk,
                      body: text,
                      lang,
                    });
                    const message = result.sent
                      ? "The provider confirms this message was sent."
                      : result.status === "failed"
                        ? "The provider could not deliver this message. Check it in the CRM."
                        : "The send is recorded. Check the CRM for delivery before sending again.";
                    setReceipt(message);
                    if (result.sent) toast.success(message);
                    else toast.message(message);
                  } catch (e) {
                    toast.error(
                      e instanceof Error ? e.message : "That did not send.",
                    );
                  } finally {
                    lock.current = false;
                    setBusy(false);
                  }
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {busy ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Send className="size-3.5" />
                )}
                {busy ? "Sending…" : receipt ? "Send recorded" : "Send reply"}
              </button>
              {edited ? (
                <span className="text-xs text-muted-foreground">Edited</span>
              ) : null}
            </div>
          </div>
        )}
        {receipt && (
          <p
            role="status"
            className="border-t px-4 py-3 text-sm text-muted-foreground"
          >
            {receipt}
          </p>
        )}
      </details>
    </li>
  );
}

type Desk = "csm" | "ads" | "creative";

/**
 * Whose WhatsApp each desk is looking at.
 *
 * Only the CSM's is connected. The other two desks must not fall back to
 * it -- it is a real person's own inbox -- so they say plainly that
 * theirs is not connected rather than showing an empty list that reads
 * like everything is answered.
 */
const CONNECTED: Record<Desk, boolean> = {
  csm: true,
  ads: false,
  creative: false,
};

export function WhatsAppDesk({ desk }: { desk: Desk }) {
  const inbox = useAction(api.wa.inbox);
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const generation = useRef(0);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setRefreshing(true);
    try {
      const out = (await inbox({ desk })) as { threads: Thread[] };
      if (current !== generation.current) return;
      setThreads(out.threads ?? []);
      setError(null);
    } catch (e) {
      if (current === generation.current)
        setError(
          (e as { data?: { message?: string } })?.data?.message ||
            (e instanceof Error ? e.message : "The inbox did not load."),
        );
    } finally {
      if (current === generation.current) setRefreshing(false);
    }
  }, [inbox, desk]);

  useEffect(() => {
    if (CONNECTED[desk]) void load();
    return () => {
      generation.current++;
    };
  }, [load, desk]);

  // Not connected: one quiet line, the why folded under it, so a desk
  // without its own WhatsApp does not spend a card saying so every day.
  if (!CONNECTED[desk])
    return (
      <details className="text-sm text-muted-foreground">
        <summary>WhatsApp is not connected for this desk</summary>
        <p className="mt-2 max-w-prose text-xs">
          This desk has no WhatsApp of its own. Connect one in GoHighLevel and
          the conversations waiting on a reply appear here, with the reply
          already drafted. Another desk's messages are never shown here.
        </p>
      </details>
    );

  if (error)
    return (
      <div role="alert" className="rounded-2xl border bg-card p-5 text-sm">
        <p>{error}</p>
        <button
          type="button"
          disabled={refreshing}
          className="mt-3 rounded-xl border px-4 py-2"
          onClick={() => void load()}
        >
          Try again
        </button>
      </div>
    );
  if (threads === null)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" />
        Reading WhatsApp
      </p>
    );

  return (
    <section>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-[15px] font-semibold tracking-tight">
          Client messages
        </h2>
        <span className="text-xs text-muted-foreground">
          {threads.length
            ? `${threads.length} waiting on a reply`
            : "No linked client conversations need a reply in this snapshot. Unlinked contacts are excluded."}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          type="search"
          aria-label="Find a client conversation"
          placeholder="Find a client conversation"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="h-11 min-w-0 flex-1 rounded-xl border bg-card px-3 text-sm"
        />
        <button
          type="button"
          disabled={refreshing}
          className="rounded-xl border px-4 py-2 text-sm disabled:opacity-50"
          onClick={() => void load()}
        >
          {refreshing ? "Refreshing…" : "Refresh inbox"}
        </button>
      </div>
      {threads.length ? (
        <ul className="mt-3 space-y-3">
          {threads
            .filter(t =>
              `${t.client_name} ${t.contact_name}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .map(t => (
              <Thread
                key={`${t.id}:${t.last_inbound_at}`}
                t={t}
                desk={desk}
                onDone={() => void load()}
              />
            ))}
        </ul>
      ) : null}
    </section>
  );
}
