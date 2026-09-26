import { useAction } from "convex/react";
import {
  Archive,
  CheckCheck,
  LoaderCircle,
  Mic,
  Send,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2 sm:px-6">
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
            <p className="mb-2 text-xs text-muted-foreground">{t.draft.why}</p>
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
              disabled={busy || !text.trim()}
              onClick={async () => {
                setBusy(true);
                try {
                  await send({ threadId: t.id, desk, body: text, lang });
                  toast.success("Sent.");
                  onDone();
                } catch (e) {
                  toast.error(
                    e instanceof Error ? e.message : "That did not send.",
                  );
                } finally {
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
              Send
            </button>
            {edited ? (
              <span className="text-xs text-muted-foreground">Edited</span>
            ) : null}
          </div>
        </div>
      )}
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

  const load = useCallback(async () => {
    try {
      const out = (await inbox({ desk })) as { threads: Thread[] };
      setThreads(out.threads ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The desk did not load.");
    }
  }, [inbox, desk]);

  useEffect(() => {
    if (CONNECTED[desk]) void load();
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
      <p className="text-sm text-muted-foreground">
        WhatsApp did not load: {error}
      </p>
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
        <h2 className="text-[15px] font-semibold tracking-tight">WhatsApp</h2>
        <span className="text-xs text-muted-foreground">
          {threads.length
            ? `${threads.length} waiting on a reply`
            : "Every conversation is answered. New ones appear here within fifteen minutes of a client writing."}
        </span>
      </div>
      {threads.length ? (
        <ul className="mt-3 space-y-3">
          {threads.map(t => (
            <Thread key={t.id} t={t} desk={desk} onDone={() => void load()} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
