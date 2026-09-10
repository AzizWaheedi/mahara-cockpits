import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { api } from "../../convex/_generated/api";

// biome-ignore lint/suspicious/noExplicitAny: chat rows
type Any = any;

const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} d`;
};

/**
 * A conversation with Hermes, the same agent that writes ad copy and client
 * reports. Every message goes out with what this screen knows (the client
 * on the page, the numbers behind it), Hermes answers into the same thread.
 * Aziz, 2026-09-10: "make the AI thing a chat like the one we're in".
 */
export function HermesChat() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const location = useLocation();
  const thread = useQuery(api.hermes.thread, {}) as Any[] | undefined;
  const send = useMutation(api.hermes.send);
  const clear = useMutation(api.hermes.clear);
  const endRef = useRef<HTMLDivElement>(null);
  const waiting = (thread ?? []).some(
    m => m.role === "user" && m.status !== "answered" && m.status !== "failed",
  );

  // The client on the current page, if the URL names one.
  const clientName = (() => {
    const m = /\/(clients|performance|client)\/([^/?#]+)/.exec(
      location.pathname,
    );
    return m ? decodeURIComponent(m[2]) : undefined;
  })();

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: "end" });
  }, [open, thread?.length]);

  const submit = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    await send({ text: t, clientName, page: location.pathname });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border bg-background px-4 py-2 text-[13px] font-semibold shadow-lg hover:bg-muted"
        aria-label="Ask Hermes"
      >
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
        Ask Hermes
        {waiting ? (
          <span className="text-muted-foreground">· thinking</span>
        ) : null}
      </button>
      {open ? (
        <section
          className="fixed bottom-20 right-5 z-40 flex h-[min(70vh,640px)] w-[min(92vw,420px)] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl"
          aria-label="Hermes chat"
        >
          <header className="flex items-center justify-between border-b px-3 py-2">
            <div className="text-[13px]">
              <span className="font-semibold">Hermes</span>
              <span className="text-muted-foreground">
                {clientName ? ` · about ${clientName}` : " · this cockpit"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="text-[12px] text-muted-foreground hover:underline"
                onClick={() => clear({})}
                title="Start a new conversation"
              >
                New chat
              </button>
              <button
                type="button"
                className="text-[12px] text-muted-foreground hover:underline"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 text-[13px]">
            {(thread ?? []).length === 0 ? (
              <p className="text-muted-foreground">
                Ask anything about this cockpit's clients, numbers or what to do
                next. Hermes sees what this screen sees and answers here,
                usually within a minute or two.
              </p>
            ) : null}
            {(thread ?? []).map(m => (
              <div
                key={m._id}
                className={
                  m.role === "user" ? "flex justify-end" : "flex justify-start"
                }
              >
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-primary-foreground"
                      : "max-w-[90%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2"
                  }
                >
                  <p className="whitespace-pre-wrap">{m.text}</p>
                  <p
                    className={`mt-1 text-[11px] ${m.role === "user" ? "text-primary-foreground/70" : "text-muted-foreground"}`}
                  >
                    {m.role === "user"
                      ? m.status === "failed"
                        ? `failed: ${m.error ?? "no answer"}`
                        : m.status === "answered"
                          ? ago(m.at)
                          : m.status === "sent"
                            ? "Hermes is reading it…"
                            : "sending…"
                      : `Hermes · ${ago(m.at)}`}
                  </p>
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
          <form
            className="flex items-end gap-2 border-t p-2"
            onSubmit={e => {
              e.preventDefault();
              void submit();
            }}
          >
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              rows={2}
              placeholder={
                clientName ? `Ask about ${clientName}…` : "Ask Hermes…"
              }
              className="flex-1 resize-none rounded-md border bg-background px-2 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="submit"
              disabled={!text.trim()}
              className="rounded-md bg-primary px-3 py-2 text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}
