import { useMutation, useQuery } from "convex/react";
import { MessageCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { useOpenClient } from "@/lib/openClient";
import { api } from "../../convex/_generated/api";

// biome-ignore lint/suspicious/noExplicitAny: chat rows
type Any = any;

const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};

/** Three dots that breathe, the universal "typing". Still under reduced motion. */
function Dots() {
  return (
    <span
      className="inline-flex items-center gap-1 align-middle"
      aria-hidden="true"
    >
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="hermes-dot inline-block h-1.5 w-1.5 rounded-full bg-current opacity-60"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </span>
  );
}

/**
 * An assistant message that types itself out when it first arrives. Hermes
 * returns his answer whole, so the typing is played here; anything already
 * on screen when the panel opened is shown in full.
 */
function Typed({
  text,
  animate,
  onDone,
}: {
  text: string;
  animate: boolean;
  onDone: () => void;
}) {
  const [n, setN] = useState(animate ? 0 : text.length);
  // The parent hands in a fresh callback on every keystroke; reading it
  // through a ref keeps the animation from restarting each time.
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    if (!animate) return;
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduced) {
      setN(text.length);
      doneRef.current();
      return;
    }
    let i = 0;
    const step = () => {
      // Two to four characters a tick reads like fast typing, not a crawl.
      i = Math.min(text.length, i + 2 + Math.floor(Math.random() * 3));
      setN(i);
      if (i < text.length) timer = window.setTimeout(step, 18);
      else doneRef.current();
    };
    let timer = window.setTimeout(step, 120);
    return () => window.clearTimeout(timer);
  }, [animate, text]);
  return (
    <p className="whitespace-pre-wrap">
      {text.slice(0, n)}
      {n < text.length ? <span className="hermes-caret">▍</span> : null}
    </p>
  );
}

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
  // The chat sits in the layout, outside RoleRoute. For a session without
  // the csm seat (revoked in the portal, or a pass minted for another
  // cockpit) hermes.thread throws, and convex/react rethrows that during
  // render, which would replace the whole app with "Reload" instead of the
  // "not yours" page. So the thread is only asked for once the seat is known.
  const me = useQuery(api.roles.me, {});
  const isCsm = Boolean(me?.roles?.includes("csm"));
  const thread = useQuery(api.hermes.thread, isCsm ? {} : "skip") as
    | Any[]
    | undefined;
  const send = useMutation(api.hermes.send);
  const clear = useMutation(api.hermes.clear);
  const endRef = useRef<HTMLDivElement>(null);
  // Ids seen before the current moment: those render in full, newer ones type.
  const seen = useRef<Set<string> | null>(null);
  const [, bump] = useState(0);
  if (seen.current === null && thread)
    seen.current = new Set(thread.map(m => m._id));

  const lastUser = [...(thread ?? [])].reverse().find(m => m.role === "user");
  const live =
    lastUser && lastUser.status !== "answered" && lastUser.status !== "failed"
      ? lastUser
      : null;
  const liveLabel =
    live?.status === "reading"
      ? "Hermes is typing"
      : live?.status === "sent"
        ? "Sent, waiting for Hermes to pick it up"
        : live
          ? "Sending"
          : null;

  // The client open on the current page. The pages publish it (a profile or
  // row opens from state, not the URL), so nothing here parses the address.
  const clientName = useOpenClient() ?? undefined;

  const count = thread?.length ?? 0;
  useEffect(() => {
    if (open)
      endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [open, count, live?.status]);

  // After every hook, so the hook order is the same on both branches.
  if (!isCsm) return null;

  const submit = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    await send({ text: t, clientName, page: location.pathname });
  };

  return (
    <>
      <style>{`
        @keyframes hermes-bounce { 0%, 80%, 100% { transform: translateY(0); opacity: .45 } 40% { transform: translateY(-3px); opacity: 1 } }
        .hermes-dot { animation: hermes-bounce 1.2s infinite ease-in-out }
        @keyframes hermes-blink { 50% { opacity: 0 } }
        .hermes-caret { animation: hermes-blink 1s steps(1) infinite; margin-left: 1px }
        @media (prefers-reduced-motion: reduce) { .hermes-dot, .hermes-caret { animation: none } }
      `}</style>
      {/* A round button on a phone so it covers as little of the page as
          possible; the label comes back from the small tablet size up. */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="glow-teal fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] z-40 flex h-11 items-center gap-2 rounded-full border bg-card/95 px-3.5 text-[13px] font-semibold text-foreground backdrop-blur hover:bg-muted sm:px-4 lg:right-6 lg:bottom-6"
        aria-label="Ask Hermes"
      >
        <MessageCircle className="size-4 sm:hidden" aria-hidden />
        <span
          className={`inline-block size-2 rounded-full bg-[color:var(--mahara-teal)] ${live ? "animate-pulse" : ""}`}
        />
        <span className="hidden sm:inline">Ask Hermes</span>
        {live && !open ? (
          <span className="hidden text-muted-foreground sm:inline">
            · {live.status === "reading" ? "typing" : "thinking"} <Dots />
          </span>
        ) : null}
      </button>
      {open ? (
        <section
          className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-40 flex h-[min(70vh,640px)] w-[min(92vw,420px)] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl lg:right-6 lg:bottom-20"
          aria-label="Hermes chat"
        >
          <header className="flex items-center justify-between border-b px-3 py-2">
            <div className="text-[13px]">
              <span className="font-semibold">Hermes</span>
              <span className="text-muted-foreground">
                {clientName ? ` · about ${clientName}` : " · this cockpit"}
              </span>
            </div>
            <div className="flex items-center gap-3">
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
            {count === 0 ? (
              <p className="text-muted-foreground">
                Ask anything about this cockpit's clients, numbers or what to do
                next. Hermes sees what this screen sees and answers here,
                usually within a minute or two.
              </p>
            ) : null}
            {(thread ?? []).map(m =>
              m.role === "user" ? (
                <div key={m._id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-primary-foreground">
                    <p className="whitespace-pre-wrap">{m.text}</p>
                    <p className="mt-1 text-[11px] text-primary-foreground/70">
                      {m.status === "failed"
                        ? `Failed: ${m.error ?? "no answer"}`
                        : ago(m.at)}
                    </p>
                  </div>
                </div>
              ) : (
                <div key={m._id} className="flex justify-start">
                  <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2">
                    <Typed
                      text={m.text}
                      animate={!seen.current?.has(m._id)}
                      onDone={() => {
                        if (!seen.current?.has(m._id)) {
                          seen.current?.add(m._id);
                          bump(x => x + 1);
                        }
                      }}
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Hermes · {ago(m.at)}
                    </p>
                  </div>
                </div>
              ),
            )}
            {liveLabel ? (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-muted-foreground">
                  {liveLabel} <Dots />
                </div>
              </div>
            ) : null}
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
