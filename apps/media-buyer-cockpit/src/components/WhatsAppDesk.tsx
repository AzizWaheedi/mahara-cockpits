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
        <Mic className="h-3 w-3" />
        voice note
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
    <li className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <span className="text-[13px] font-medium">
          {t.contact_name || t.phone || "Unknown"}
        </span>
        {t.is_group ? (
          <span
            title="A WhatsApp group, with the client's own people in it"
            className="inline-flex items-center gap-1 rounded-full border px-1.5 text-[11px] text-muted-foreground"
          >
            <Users className="h-3 w-3" />
            group
          </span>
        ) : null}
        <span className="text-[11px] text-muted-foreground">
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
          className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          <Archive className="h-3 w-3" />
          Archive
        </button>
      </div>

      <div className="space-y-1 px-3 py-2">
        {t.messages.map(m => (
          <p
            key={`${m.at}-${m.direction}`}
            className={`text-[12px] leading-snug ${
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
        <p className="flex items-center gap-1.5 border-t px-3 py-2 text-[12px] text-muted-foreground">
          <CheckCheck className="h-3.5 w-3.5 text-success" />
          Sent by {t.draft.sent_by}
        </p>
      ) : noDraft ? (
        <p className="border-t px-3 py-2 text-[12px] text-muted-foreground">
          {t.draft?.why ?? "No reply drafted for this one."}
        </p>
      ) : (
        <div className="border-t p-3">
          {t.draft?.why ? (
            <p className="mb-1.5 text-[11px] text-muted-foreground">
              {t.draft.why}
            </p>
          ) : null}
          <div className="mb-1.5 inline-flex rounded-md border p-0.5">
            {(["ar", "en"] as const).map(l => (
              <button
                key={l}
                type="button"
                onClick={() => switchTo(l)}
                disabled={!t.draft?.[l]}
                className={`rounded px-2 py-0.5 text-[11px] font-medium disabled:opacity-40 ${
                  lang === l
                    ? "bg-foreground text-background"
                    : "text-muted-foreground"
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
            className="w-full rounded-md border bg-background p-2 text-[13px] leading-relaxed"
          />
          <div className="mt-1.5 flex items-center gap-2">
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
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Send
            </button>
            {edited ? (
              <span className="text-[11px] text-muted-foreground">edited</span>
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

  if (!CONNECTED[desk])
    return (
      <section>
        <div className="mb-2 flex flex-wrap items-baseline gap-2">
          <h2 className="text-[15px] font-semibold tracking-tight">WhatsApp</h2>
          <span className="text-[12px] text-muted-foreground">
            not connected yet
          </span>
        </div>
        <p className="rounded-lg border border-dashed p-4 text-[12px] text-muted-foreground">
          This desk has no WhatsApp of its own. Connect one in GoHighLevel and
          the conversations waiting on a reply appear here, with the reply
          already drafted. Another desk's messages are never shown here.
        </p>
      </section>
    );

  if (error)
    return (
      <p className="rounded-lg border border-dashed p-4 text-[12px] text-muted-foreground">
        {error}
      </p>
    );
  if (threads === null)
    return (
      <p className="flex items-center gap-2 p-4 text-[12px] text-muted-foreground">
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        Reading WhatsApp
      </p>
    );

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h2 className="text-[15px] font-semibold tracking-tight">WhatsApp</h2>
        <span className="text-[12px] text-muted-foreground">
          {threads.length
            ? `${threads.length} waiting on a reply`
            : "nobody is waiting"}
        </span>
      </div>
      {threads.length ? (
        <ul className="space-y-2">
          {threads.map(t => (
            <Thread key={t.id} t={t} desk={desk} onDone={() => void load()} />
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-[12px] text-muted-foreground">
          Every conversation has been answered. New ones appear here within
          fifteen minutes of a client writing.
        </p>
      )}
    </section>
  );
}
