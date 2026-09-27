import { useEffect, useMemo, useRef, useState } from "react";

import { MessageCircle } from "lucide-react";

import { useLocation } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { type ChatMessage, type CockpitApp, type CockpitRole, clearAskAiThread, getAskAiThread, jobsToChatMessages, submitAskAiJob } from "@/lib/askAiClient";

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
 * An assistant message that types itself out when it first arrives.
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
  useEffect(() => {
    if (!animate) return;
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduced) {
      setN(text.length);
      onDone();
      return;
    }
    let i = 0;
    let timer: number;
    const step = () => {
      i = Math.min(text.length, i + 2 + Math.floor(Math.random() * 3));
      setN(i);
      if (i < text.length) timer = window.setTimeout(step, 18);
      else onDone();
    };
    timer = window.setTimeout(step, 120);
    return () => window.clearTimeout(timer);
  }, [animate, text, onDone]);
  return (
    <p className="whitespace-pre-wrap">
      {text.slice(0, n)}
      {n < text.length ? <span className="hermes-caret">▍</span> : null}
    </p>
  );
}

/** Server history is authoritative; pending jobs are reloaded across refresh. */
export function HermesChat() {
  const app: CockpitApp = "client-success";
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [storedThread, setThread] = useState<ChatMessage[]>([]);
  const [threadOwner, setThreadOwner] = useState("");
  const [threadError, setThreadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const location = useLocation();
  const auth = useCockpitAuth();
  const { client } = auth;
  const requiredRole = ({ "media-buyer": "media_buyer", "client-success": "csm", "creative": "creative" } as const)[app];
  const activeRole: CockpitRole = auth.isCeo ? "ceo" : auth.roles.includes("admin") ? "admin" : requiredRole;
  const isAllowed = auth.ready && auth.isAuthenticated &&
    (auth.isCeo || auth.roles.includes("admin") || auth.roles.includes(requiredRole));
  const scopeKey = JSON.stringify([auth.session?.user.id, auth.email, [...auth.roles].sort(), [...auth.clients].sort(), auth.isCeo, isAllowed]);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const sending = useRef(false);
  const thread = threadOwner === scopeKey ? storedThread : [];
  const clientName = useMemo(() => {
    const match = /\/(clients|performance|client)\/([^/?#]+)/.exec(location.pathname);
    if (!match) return undefined;
    try { return decodeURIComponent(match[2]); } catch { return undefined; }
  }, [location.pathname]);

  useEffect(() => {
    setThread([]);
    setThreadOwner(scopeKey);
    setThreadError(null);
    setText("");
  }, [scopeKey]);

  useEffect(() => {
    if (!client || !isAllowed) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      setIsLoading(true);
      const { thread: jobs, error } = await getAskAiThread(client, app, 50);
      if (cancelled || currentScope.current !== scopeKey) return;
      setIsLoading(false);
      if (error) {
        setThread([]);
        setThreadError("Could not load the conversation. " + error.message);
      } else {
        setThread(jobsToChatMessages(jobs));
        setThreadOwner(scopeKey);
        setThreadError(null);
      }
      if (open || error || jobs.some(j => j.status === "queued" || j.status === "claimed")) {
        timer = setTimeout(load, error ? 5000 : 1500);
      }
    };
    void load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [client, app, isAllowed, scopeKey, open, refresh]);

  const send = async ({text: prompt, targetClient, page}: {text: string; targetClient?: string; page?: string}) => {
    if (!client || !isAllowed || sending.current) return;
    sending.current = true;
    const requestScope = scopeKey;
    const key = crypto.randomUUID();
    const { jobId, error } = await submitAskAiJob(client, {
      app, role: activeRole, prompt, clientName: targetClient, kind: "chat",
      context: {page}, idempotencyKey: key,
    });
    sending.current = false;
    if (currentScope.current !== requestScope) return;
    if (error || !jobId) {
      setText(prompt);
      setThreadError(error?.message ?? "The request was not accepted. Try again.");
      return;
    }
    setThreadError(null);
    setRefresh(n => n + 1);
  };

  const clear = async () => {
    if (!client || !isAllowed) return;
    const requestScope = scopeKey;
    const { success, error } = await clearAskAiThread(client, app);
    if (currentScope.current !== requestScope) return;
    if (error || !success) {
      setThreadError(error?.message ?? "Could not clear the conversation. Try again.");
      return;
    }
    setThread([]);
    setRefresh(n => n + 1);
  };

  const endRef = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string> | null>(null);
  const [, bump] = useState(0);
  if (seen.current === null && thread.length > 0) {
    seen.current = new Set(thread.map(m => m._id));
  }

  const lastUser = [...thread].reverse().find(m => m.role === "user");
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

  const count = thread.length;
  useEffect(() => {
    if (open) {
      endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    }
  }, [open, count, live?.status]);

  // Fail-closed authorization check
  if (!isAllowed || threadOwner !== scopeKey) return null;

  const submit = async () => {
    const t = text.trim();
    if (!t || sending.current) return;
    setText("");
    await send({ text: t, targetClient: clientName, page: location.pathname });
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
          className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-40 flex h-[min(70vh,640px)] w-[min(92vw,420px)] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl dark:shadow-none lg:right-6 lg:bottom-20"
          aria-label="Hermes chat"
        >
          <header className="flex items-center justify-between gap-2 border-b py-1 pr-1 pl-3">
            <div className="min-w-0 truncate text-sm">
              <span className="font-semibold">Hermes</span>
              <span className="text-muted-foreground">
                {clientName ? ` · about ${clientName}` : ` · ${app}`}
              </span>
            </div>
            {/* Outside <main>, so these carry their own 40px on touch. */}
            <div className="flex shrink-0 items-center">
              <button
                type="button"
                className="inline-flex h-8 items-center rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:h-10"
                onClick={() => void clear()}
                title="Start a new conversation"
              >
                New chat
              </button>
              <button
                type="button"
                className="inline-flex h-8 items-center rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:h-10"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm">
            {threadError ? (
              <div className="rounded border border-red-500/50 bg-red-500/10 p-2 text-xs text-red-600 dark:text-red-400">
                {threadError}
              </div>
            ) : null}
            {count === 0 && !isLoading ? (
              <p className="text-muted-foreground">
                Ask anything about this cockpit's clients, numbers or what to do
                next. Hermes sees what this screen sees and answers here,
                usually within a minute or two.
              </p>
            ) : null}
            {thread.map(m =>
              m.role === "user" ? (
                <div key={m._id} className="flex justify-end">
                  <div
                    className={`max-w-[85%] rounded-2xl rounded-br-sm px-3 py-2 ${
                      m.status === "failed"
                        ? "border border-red-500/50 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200"
                        : "bg-primary text-primary-foreground"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{m.text}</p>
                    <p
                      className={`mt-1 text-[11px] ${
                        m.status === "failed"
                          ? "font-medium text-red-600 dark:text-red-400"
                          : "text-primary-foreground/70"
                      }`}
                    >
                      {m.status === "failed"
                        ? `Failed: ${m.error ?? "No response"}`
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
                    <p className="mt-1 text-xs text-muted-foreground">
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
              className="flex-1 resize-none rounded-lg border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="submit"
              disabled={!text.trim()}
              className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50 pointer-coarse:min-h-10"
            >
              Send
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}
