import {
  Anchor,
  Aperture,
  ArrowUp,
  Check,
  Clapperboard,
  Copy,
  Signal,
  Target,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { useLocation } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import {
  type ChatMessage,
  type CockpitApp,
  type CockpitRole,
  clearAskAiThread,
  getAskAiThread,
  jobsToChatMessages,
  rateAskAiJob,
  submitAskAiJob,
} from "@/lib/askAiClient";
import {
  ASSISTANTS,
  type HermesSpan,
  hermesSuggestions,
  nextPollDelay,
  parseHermesText,
  sameThread,
} from "@/lib/hermesText";

const ASSISTANT_ICONS = {
  "media-buyer": Signal,
  "client-success": Anchor,
  creative: Aperture,
  sales: Target,
  editor: Clapperboard,
} as const;

const APP: CockpitApp = "client-success";
const LAUNCHER_BOTTOM = "bottom-[calc(1rem+env(safe-area-inset-bottom,0px))]";
const PANEL_BOTTOM = "bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))]";

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

/** BoardUI's agent thinking: a diagonal wave of squares, a shimmer, seconds. */
function HermesThinking({ label, since }: { label: string; since: number }) {
  const [phase, setPhase] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const reduced = useRef(
    typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  reduced.current =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  useEffect(() => {
    if (reduced.current) return;
    const timer = window.setInterval(() => setPhase(p => (p + 1 / 8) % 1), 80);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - since) / 1000));
  const seed = [0.55, 0.3, 0.15, 0.85, 0.55, 0.3, 1, 0.85, 0.55];
  return (
    <>
      <div
        role="status"
        className="flex items-center gap-2.5 text-muted-foreground"
      >
        <span aria-hidden="true" className="grid grid-cols-3 gap-0.5">
          {Array.from({ length: 9 }, (_, n) => {
            const col = n % 3;
            const row = Math.floor(n / 3);
            const s = ((col + row) / 4) * (3 / 4);
            const behind = (phase - s + 1) % 1;
            const lit = Math.max(0, 1 - behind / 0.3) ** 1.5;
            const opacity = reduced.current ? seed[n] : 0.12 + 0.88 * lit;
            return (
              <span
                key={n}
                className="size-1 rounded-[1px] bg-current transition-opacity duration-[220ms]"
                style={{ opacity }}
              />
            );
          })}
        </span>
        <span className="hermes-shimmer text-sm">{label}</span>
        <span className="font-mono text-[11px] tabular-nums">{elapsed}s</span>
      </div>
      {elapsed > 45 ? (
        <p className="text-xs text-muted-foreground">
          Taking longer than usual. Keep working, the answer will land here.
        </p>
      ) : null}
    </>
  );
}

function inlineSpans(spans: HermesSpan[]) {
  return spans.map((s, i) =>
    s.bold ? (
      <strong key={i} className="font-semibold">
        {s.text}
      </strong>
    ) : (
      <span key={i}>{s.text}</span>
    ),
  );
}

/** The answer as blocks, never as raw HTML; a new answer rises in block by block. */
function HermesBlocks({ text, animate }: { text: string; animate: boolean }) {
  return (
    <div className="space-y-2">
      {parseHermesText(text).map((b, i) => {
        const anim = animate ? " hermes-rise" : "";
        const delay = animate ? { animationDelay: `${i * 60}ms` } : undefined;
        if ("items" in b) {
          const cls = `space-y-1 ps-5 text-sm leading-6 ${
            b.kind === "bullets" ? "list-disc" : "list-decimal"
          }${anim}`;
          const items = b.items.map((spans, j) => (
            <li key={j} dir="auto">
              {inlineSpans(spans)}
            </li>
          ));
          return b.kind === "bullets" ? (
            <ul key={i} dir="auto" className={cls} style={delay}>
              {items}
            </ul>
          ) : (
            <ol key={i} dir="auto" className={cls} style={delay}>
              {items}
            </ol>
          );
        }
        const cls = `${
          b.kind === "heading"
            ? "text-sm font-semibold"
            : "text-sm leading-6 break-words"
        }${anim}`;
        return (
          <p key={i} dir="auto" className={cls} style={delay}>
            {inlineSpans(b.spans)}
          </p>
        );
      })}
    </div>
  );
}

/** BoardUI's composer loader: an orbiting gradient on the input's own border. */
function HermesComposerGlow({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const gradient = `hermes-glow-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const stroke = `url(#${gradient})`;
  const geometry = {
    x: 1,
    y: 1,
    rx: 15,
    pathLength: 100,
    fill: "none",
    stroke,
    strokeDasharray: "33 67",
    className: "hermes-orbit",
    style: { width: "calc(100% - 2px)", height: "calc(100% - 2px)" },
  };
  return (
    <div className="relative rounded-2xl border bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-card">
      <svg
        className={`pointer-events-none absolute inset-0 size-full overflow-visible transition-opacity duration-[450ms] ${
          active ? "opacity-100" : "opacity-0"
        }`}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#00CFC8" />
            <stop offset="0.33" stopColor="#5EEAD4" />
            <stop offset="0.66" stopColor="#00CFC8" />
            <stop offset="1" stopColor="#00807B" />
          </linearGradient>
        </defs>
        <rect {...geometry} strokeWidth={2} strokeOpacity={0.9} />
        <rect
          {...geometry}
          strokeWidth={4}
          strokeOpacity={0.6}
          style={{ ...geometry.style, filter: "blur(3px)" }}
        />
        <rect
          {...geometry}
          strokeWidth={10}
          strokeOpacity={0.3}
          style={{ ...geometry.style, filter: "blur(10px)" }}
        />
      </svg>
      {children}
    </div>
  );
}

function HermesActions({
  m,
  name,
  rating,
  onRate,
}: {
  m: ChatMessage;
  name: string;
  rating: -1 | 0 | 1 | null;
  onRate: (next: -1 | 0 | 1) => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const button =
    "inline-flex size-7 items-center justify-center rounded-md hover:bg-muted hover:text-foreground pointer-coarse:size-10";
  return (
    <div className="flex items-center gap-0.5 text-muted-foreground opacity-100 transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover/message:opacity-100 pointer-fine:focus-within:opacity-100">
      <button
        type="button"
        className={button}
        aria-label={copied ? "Copied" : "Copy answer"}
        onClick={() => {
          void navigator.clipboard.writeText(m.text);
          setCopied(true);
        }}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
      <button
        type="button"
        className={`${button} ${rating === 1 ? "text-primary" : ""}`}
        aria-label="Helpful"
        aria-pressed={rating === 1}
        onClick={() => onRate(rating === 1 ? 0 : 1)}
      >
        <ThumbsUp className="size-4" />
      </button>
      <button
        type="button"
        className={`${button} ${rating === -1 ? "text-primary" : ""}`}
        aria-label="Not helpful"
        aria-pressed={rating === -1}
        onClick={() => onRate(rating === -1 ? 0 : -1)}
      >
        <ThumbsDown className="size-4" />
      </button>
      <span className="ms-1 font-mono text-[11px]">
        {name} · {ago(m.at)}
      </span>
    </div>
  );
}

/** Server history is authoritative; pending jobs are reloaded across refresh. */
export function HermesChat() {
  const app: CockpitApp = APP;
  const assistant = ASSISTANTS[APP];
  const AssistantIcon = ASSISTANT_ICONS[APP];
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [storedThread, setThread] = useState<ChatMessage[]>([]);
  const [threadOwner, setThreadOwner] = useState("");
  const [threadError, setThreadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [ratings, setRatings] = useState<Map<string, -1 | 0 | 1>>(new Map());
  const location = useLocation();
  const auth = useCockpitAuth();
  const { client } = auth;
  const requiredRole = (
    {
      "media-buyer": "media_buyer",
      "client-success": "csm",
      creative: "creative",
      sales: "sales",
      editor: "editor",
    } as const
  )[app];
  const activeRole: CockpitRole = auth.isCeo
    ? "ceo"
    : auth.roles.includes("admin")
      ? "admin"
      : requiredRole;
  const isAllowed =
    auth.ready &&
    auth.isAuthenticated &&
    (auth.isCeo ||
      auth.roles.includes("admin") ||
      auth.roles.includes(requiredRole));
  const scopeKey = JSON.stringify([
    auth.session?.user.id,
    auth.email,
    [...auth.roles].sort(),
    [...auth.clients].sort(),
    auth.isCeo,
    isAllowed,
  ]);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const loadedScope = useRef<string | null>(null);
  const sending = useRef(false);
  const thread = threadOwner === scopeKey ? storedThread : [];
  const clientName = useMemo(() => {
    const match = /\/(clients|performance|client)\/([^/?#]+)/.exec(
      location.pathname,
    );
    if (!match) return undefined;
    try {
      return decodeURIComponent(match[2]);
    } catch {
      return undefined;
    }
  }, [location.pathname]);

  useEffect(() => {
    setThread([]);
    setThreadOwner(scopeKey);
    setThreadError(null);
    loadedScope.current = null;
    setText("");
  }, [scopeKey]);

  useEffect(() => {
    if (!client || !isAllowed) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (loadedScope.current !== scopeKey) setIsLoading(true);
      const { thread: jobs, error } = await getAskAiThread(client, app, 50);
      if (cancelled || currentScope.current !== scopeKey) return;
      setIsLoading(false);
      loadedScope.current = scopeKey;
      if (error) {
        setThread([]);
        setThreadError("Could not load the conversation. " + error.message);
      } else {
        const next = jobsToChatMessages(jobs);
        setThread(prev => (sameThread(prev, next) ? prev : next));
        setThreadOwner(scopeKey);
        setThreadError(null);
      }
      const delay = nextPollDelay({
        busy: jobs.some(j => j.status === "queued" || j.status === "claimed"),
        error: Boolean(error),
        open,
      });
      if (delay !== null) timer = setTimeout(load, delay);
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, app, isAllowed, scopeKey, open, refresh]);

  const send = async ({
    text: prompt,
    targetClient,
    page,
  }: {
    text: string;
    targetClient?: string;
    page?: string;
  }) => {
    if (!client || !isAllowed || sending.current) return;
    sending.current = true;
    const requestScope = scopeKey;
    const key = crypto.randomUUID();
    const { jobId, error } = await submitAskAiJob(client, {
      app,
      role: activeRole,
      prompt,
      clientName: targetClient,
      kind: "chat",
      context: { page },
      idempotencyKey: key,
    });
    sending.current = false;
    if (currentScope.current !== requestScope) return;
    if (error || !jobId) {
      setText(prompt);
      setThreadError(
        error?.message ?? "The request was not accepted. Try again.",
      );
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
      setThreadError(
        error?.message ?? "Could not clear the conversation. Try again.",
      );
      return;
    }
    setThread([]);
    setRefresh(n => n + 1);
  };

  const rate = async (m: ChatMessage, next: -1 | 0 | 1) => {
    const jobId = m.jobId;
    if (!client || !jobId) return;
    setRatings(prev => new Map(prev).set(jobId, next));
    const { success } = await rateAskAiJob(client, jobId, next);
    if (success) return;
    setRatings(prev => {
      const nextRatings = new Map(prev);
      nextRatings.delete(jobId);
      return nextRatings;
    });
    setThreadError("Could not save your rating. Try again.");
  };

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const seen = useRef<Set<string> | null>(null);
  const [, bump] = useState(0);
  if (seen.current === null && thread.length > 0) {
    seen.current = new Set(thread.map(m => m._id));
  }

  useEffect(() => {
    const fresh = thread.filter(
      m => m.role === "assistant" && !seen.current?.has(m._id),
    );
    if (fresh.length === 0) return;
    const timer = window.setTimeout(() => {
      for (const m of fresh) seen.current?.add(m._id);
      bump(n => n + 1);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [thread]);

  const lastUser = [...thread].reverse().find(m => m.role === "user");
  const live =
    lastUser && lastUser.status !== "answered" && lastUser.status !== "failed"
      ? lastUser
      : null;
  const liveLabel =
    live?.status === "reading"
      ? clientName
        ? `Reading ${clientName}'s numbers`
        : "Reading the cockpit"
      : live?.status === "sent"
        ? `Waiting for ${assistant.name}`
        : "Sending";

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
    if (inputRef.current) inputRef.current.style.height = "auto";
    await send({ text: t, targetClient: clientName, page: location.pathname });
  };

  return (
    <>
      <style>{`
        @keyframes hermes-bounce { 0%, 80%, 100% { transform: translateY(0); opacity: .45 } 40% { transform: translateY(-3px); opacity: 1 } }
        .hermes-dot { animation: hermes-bounce 1.2s infinite ease-in-out }
        @keyframes hermes-rise { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
        .hermes-rise { animation: hermes-rise 320ms ease-out both }
        .hermes-shimmer { background: linear-gradient(90deg, color-mix(in oklab, var(--muted-foreground) 55%, transparent) 30%, var(--foreground) 50%, color-mix(in oklab, var(--muted-foreground) 55%, transparent) 70%); background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: hermes-shimmer 2s linear infinite }
        @keyframes hermes-shimmer { from { background-position: 100% 0 } to { background-position: -100% 0 } }
        @keyframes hermes-orbit { to { stroke-dashoffset: -100 } }
        .hermes-orbit { animation: hermes-orbit 4.5s linear infinite }
        @media (prefers-reduced-motion: reduce) {
          .hermes-rise, .hermes-orbit, .hermes-dot { animation: none }
          .hermes-shimmer { animation: none; color: inherit; background: none }
        }
      `}</style>
      {/* A round button on a phone so it covers as little of the page as
          possible; the label comes back from the small tablet size up. */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`glow-teal fixed right-4 ${LAUNCHER_BOTTOM} z-40 flex h-11 items-center gap-2 rounded-full border bg-card/95 px-3.5 text-[13px] font-semibold text-foreground backdrop-blur hover:bg-muted sm:px-4 lg:right-6 lg:bottom-6`}
        aria-label={`Ask ${assistant.name}`}
      >
        <AssistantIcon className="size-4 sm:hidden" aria-hidden />
        <span
          className={`inline-block size-2 rounded-full bg-[color:var(--mahara-teal)] ${live ? "animate-pulse" : ""}`}
        />
        <span className="hidden sm:inline">Ask {assistant.name}</span>
        {live && !open ? (
          <span className="hidden text-muted-foreground sm:inline">
            {" · thinking "}
            <Dots />
          </span>
        ) : null}
      </button>
      {open ? (
        <section
          className={`fixed right-4 ${PANEL_BOTTOM} z-40 flex h-[min(72vh,680px)] w-[min(92vw,440px)] flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl dark:shadow-none lg:right-6 lg:bottom-20`}
          aria-label={`${assistant.name} chat`}
        >
          <header className="flex items-center justify-between gap-2 border-b py-1.5 pr-1.5 pl-4">
            <div className="flex min-w-0 items-center">
              <AssistantIcon
                className="size-4 text-[color:var(--mahara-teal)]"
                aria-hidden
              />
              <span className="ml-1.5 text-sm font-semibold">
                {assistant.name}
              </span>
              {clientName ? (
                <span className="ml-2 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-primary" />
                  <span className="max-w-[160px] truncate" dir="auto">
                    {clientName}
                  </span>
                </span>
              ) : (
                <span className="ml-2 text-xs text-muted-foreground">
                  {assistant.role}
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
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
                className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-10"
                onClick={() => setOpen(false)}
                aria-label={`Close ${assistant.name}`}
              >
                <X className="size-4" />
              </button>
            </div>
          </header>
          <div className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
            {threadError ? (
              <div className="rounded border border-red-500/50 bg-red-500/10 p-2 text-xs text-red-600 dark:text-red-400">
                {threadError}
              </div>
            ) : null}
            {count === 0 && !isLoading ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {assistant.intro} Answers come here in under a minute.
                </p>
                <div className="flex flex-wrap gap-2">
                  {hermesSuggestions(APP, clientName).map(s => (
                    <button
                      key={s}
                      type="button"
                      dir="auto"
                      className="inline-flex min-h-8 items-center rounded-full border px-3 py-1 text-start text-xs text-foreground hover:bg-muted pointer-coarse:min-h-10"
                      onClick={() =>
                        void send({
                          text: s,
                          targetClient: clientName,
                          page: location.pathname,
                        })
                      }
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {thread.map(m =>
              m.role === "user" ? (
                <div
                  key={m._id}
                  className={`ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md px-3 py-2 text-sm ${
                    m.status === "failed"
                      ? "border border-red-500/50 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200"
                      : "bg-primary/15 text-foreground"
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words" dir="auto">
                    {m.text}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {m.status === "failed"
                      ? `Failed: ${m.error ?? "No response"}`
                      : ago(m.at)}
                  </p>
                </div>
              ) : (
                <div
                  key={m._id}
                  className="group/message flex flex-col gap-1.5"
                >
                  <HermesBlocks
                    text={m.text}
                    animate={!seen.current?.has(m._id)}
                  />
                  <HermesActions
                    m={m}
                    name={assistant.name}
                    rating={
                      (m.jobId ? ratings.get(m.jobId) : undefined) ??
                      m.feedback ??
                      null
                    }
                    onRate={next => void rate(m, next)}
                  />
                </div>
              ),
            )}
            {live ? <HermesThinking label={liveLabel} since={live.at} /> : null}
            <div ref={endRef} />
          </div>
          <div className="border-t-0 p-3">
            <HermesComposerGlow active={live !== null}>
              <form
                className="flex items-end gap-2 p-2"
                onSubmit={e => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <textarea
                  ref={inputRef}
                  value={text}
                  dir="auto"
                  onChange={e => {
                    setText(e.target.value);
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
                  }}
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void submit();
                    }
                  }}
                  rows={1}
                  placeholder={
                    clientName
                      ? `Ask about ${clientName}…`
                      : `Ask ${assistant.name}…`
                  }
                  className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
                />
                <button
                  type="submit"
                  disabled={!text.trim()}
                  aria-label="Send"
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40 pointer-coarse:size-10"
                >
                  <ArrowUp className="size-4" />
                </button>
              </form>
            </HermesComposerGlow>
          </div>
        </section>
      ) : null}
    </>
  );
}
