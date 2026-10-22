import { ArrowUpRight, RefreshCw, X } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Navigate, useLocation, useParams } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { BookCallButton } from "@/components/ClientCheckIn";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { readClientTimeline } from "@/lib/csmCalls";
import {
  readOnboardingKits,
  refreshOnboardingKits,
} from "@/lib/onboardingClient";
import { cn } from "@/lib/utils";
import { readDeckSources } from "@/present/sources";
import {
  type BookProps,
  type CreateWidget,
  type FormIO,
  FormPanel,
  type FormPhase,
} from "./FormPanel";
import { readFormSends, recordFormSend } from "./formClient";
import { type FormConfig, type FormContext, formConfig } from "./formConfig";
import { announceForm } from "./OpenFormButton";
import { formLink } from "./prefill";

/**
 * /clients/:key/forms/:form, in a window of its own (KICKOFF.md 1 and 6):
 * outside AppLayout, so no sidebar, Ask Hermes or Cmd+K can take focus on a
 * call, and shareable on its own. The window reads the client through the
 * seat's own client (cockpit_csm_client_gate decides), shows the "Sends to"
 * seal before anything else, and holds the Just me / Sharing switch. The
 * form and its side panel are FormPanel's.
 */

export type WindowState =
  | { kind: "loading" }
  | {
      kind: "blocked";
      text: string;
      retry: boolean;
      plain: string | null;
      /** Nothing here will change it: offer to close the window. */
      close?: boolean;
    }
  | { kind: "unread" }
  | { kind: "ready"; ctx: FormContext };

const message = (e: unknown) => String((e as Error)?.message ?? e ?? "").trim();

/** Why the window stays closed, in plain words (KICKOFF.md 2.5). */
export function blockedFor(
  error: unknown,
  cfg: Pick<FormConfig, "title" | "formId" | "idField">,
  taskId: string,
): Extract<WindowState, { kind: "blocked" }> {
  const m = message(error);
  const name = cfg.title.toLowerCase();
  if (
    /not on your access list|access is required|access required|42501/i.test(m)
  )
    return {
      kind: "blocked",
      text: `This client is not on your list, so the ${name} cannot open here. Ask your lead to add this client, then try again.`,
      retry: false,
      plain: null,
      close: true,
    };
  if (/roster is incomplete|missing or ambiguous/i.test(m))
    return {
      kind: "blocked",
      text: "The client list is refreshing. Try again in a minute.",
      retry: true,
      plain: null,
    };
  if (/identity changed/i.test(m))
    return {
      kind: "blocked",
      text: `The card's name and the client list disagree, so the ${name} stays closed. Refresh the client list, then try again.`,
      retry: true,
      plain: null,
    };
  return {
    kind: "blocked",
    text: `The client's record could not be read, so the ${name} stays closed: a form without the right card ID reaches no client.`,
    retry: true,
    plain: formLink(cfg.formId, { [cfg.idField]: taskId }),
  };
}

const firstName = (name: string) => {
  const n = name.trim();
  return n && !n.includes("@") ? (n.split(/\s+/)[0] ?? null) : null;
};

const SHARING_KEY = "mahara-form-sharing";
function readSharing() {
  try {
    return window.localStorage.getItem(SHARING_KEY) === "1";
  } catch {
    return false;
  }
}
function saveSharing(on: boolean) {
  try {
    window.localStorage.setItem(SHARING_KEY, on ? "1" : "0");
  } catch {
    // the switch still works for this window
  }
}

export default function FormWindow() {
  const { key = "", form = "" } = useParams();
  const { search } = useLocation();
  const auth = useCockpitAuth();
  const cfg = formConfig(form);
  // Rehearsal is Typeform's sandbox, for admins and the CEO only.
  const rehearse =
    new URLSearchParams(search).get("rehearse") === "1" &&
    (auth.isAdmin || auth.isCeo);
  if (!cfg)
    return <Navigate to={`/clients/${encodeURIComponent(key)}`} replace />;
  return (
    <LiveFormWindow
      key={`${key}:${cfg.key}:${rehearse}`}
      cfg={cfg}
      taskId={key}
      rehearse={rehearse}
    />
  );
}

function LiveFormWindow({
  cfg,
  taskId,
  rehearse,
}: {
  cfg: FormConfig;
  taskId: string;
  rehearse: boolean;
}) {
  const auth = useCockpitAuth();
  const client = auth.client;
  const [state, setState] = useState<WindowState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const me = useMemo(
    () => ({ email: auth.email, firstName: firstName(auth.name) }),
    [auth.email, auth.name],
  );

  const update = useCallback((fn: (ctx: FormContext) => FormContext) => {
    setState(s => (s.kind === "ready" ? { kind: "ready", ctx: fn(s.ctx) } : s));
  }, []);

  const load = useCallback(async () => {
    if (!client) {
      setState(blockedFor(Error("Sign in to the cockpit first."), cfg, taskId));
      return;
    }
    const [kits, deck, timeline, sends] = await Promise.allSettled([
      readOnboardingKits(client, [taskId]),
      readDeckSources(client, taskId),
      readClientTimeline(client, taskId),
      readFormSends(client, taskId, cfg.key),
    ]);
    if (kits.status === "rejected") {
      setState(blockedFor(kits.reason, cfg, taskId));
      return;
    }
    const row = kits.value.rows.find(r => r.clickup_task_id === taskId);
    if (!row) {
      setState({ kind: "unread" });
      return;
    }
    setState({
      kind: "ready",
      ctx: {
        taskId,
        row,
        deck: deck.status === "fulfilled" ? deck.value : null,
        timeline: timeline.status === "fulfilled" ? timeline.value : null,
        sends: sends.status === "fulfilled" ? sends.value.sends : [],
        me,
        now: kits.value.now,
        readAt: Date.now(),
        failed: {
          deck: deck.status === "rejected" ? message(deck.reason) : undefined,
          timeline:
            timeline.status === "rejected"
              ? message(timeline.reason)
              : undefined,
          sends:
            sends.status === "rejected" ? message(sends.reason) : undefined,
        },
      },
    });
  }, [client, taskId, cfg, me]);

  useEffect(() => {
    void load();
  }, [load]);

  // The client's row, prep (slide 4's service pick) and the call store are
  // read again when the window gets focus: a pick made on the deck shows up
  // here, and onboarding answers that came in after the window opened are
  // said over the form (the form itself stays as it opened until Reload).
  const lastFocusRead = useRef(Date.now());
  useEffect(() => {
    const onFocus = () => {
      if (!client || Date.now() - lastFocusRead.current < 10_000) return;
      lastFocusRead.current = Date.now();
      void Promise.allSettled([
        readDeckSources(client, taskId),
        readClientTimeline(client, taskId),
        readOnboardingKits(client, [taskId]),
      ]).then(([deck, timeline, kits]) => {
        const row =
          kits.status === "fulfilled"
            ? kits.value.rows.find(r => r.clickup_task_id === taskId)
            : undefined;
        update(ctx => ({
          ...ctx,
          // A failed read, or no row, keeps the row the window has.
          ...(row && kits.status === "fulfilled"
            ? { row, now: kits.value.now, readAt: Date.now() }
            : {}),
          deck: deck.status === "fulfilled" ? deck.value : ctx.deck,
          timeline:
            timeline.status === "fulfilled" ? timeline.value : ctx.timeline,
          failed: {
            ...ctx.failed,
            deck: deck.status === "rejected" ? message(deck.reason) : undefined,
            timeline:
              timeline.status === "rejected"
                ? message(timeline.reason)
                : undefined,
          },
        }));
      });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [client, taskId, update]);

  const io = useMemo<FormIO>(
    () => ({
      record: async input => {
        const { send } = await recordFormSend(client, input);
        update(ctx => ({
          ...ctx,
          sends: [
            send,
            ...ctx.sends.filter(s => s.responseId !== send.responseId),
          ],
        }));
        return send;
      },
      check: async () => {
        if (!client) throw Error("Sign in to the cockpit first.");
        const page = await refreshOnboardingKits(client, taskId, [taskId]);
        const [timeline, sends] = await Promise.allSettled([
          readClientTimeline(client, taskId),
          readFormSends(client, taskId, cfg.key),
        ]);
        update(ctx => ({
          ...ctx,
          row: page.rows.find(r => r.clickup_task_id === taskId) ?? ctx.row,
          timeline:
            timeline.status === "fulfilled" ? timeline.value : ctx.timeline,
          sends: sends.status === "fulfilled" ? sends.value.sends : ctx.sends,
          now: page.now,
          readAt: Date.now(),
          failed: {
            ...ctx.failed,
            sends:
              sends.status === "rejected" ? message(sends.reason) : undefined,
          },
        }));
        if (page.problem) throw Error(page.problem);
      },
      recheck: async () => {
        if (!client) throw Error("Sign in to the cockpit first.");
        const timeline = await readClientTimeline(client, taskId);
        update(ctx => ({
          ...ctx,
          timeline,
          failed: { ...ctx.failed, timeline: undefined },
        }));
      },
      announce: announceForm,
    }),
    [client, taskId, cfg.key, update],
  );

  const refresh = async () => {
    if (!client) return;
    setRefreshing(true);
    try {
      await refreshOnboardingKits(client, taskId, [taskId]);
      await load();
    } catch (e) {
      setState(blockedFor(e, cfg, taskId));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <FormWindowView
      cfg={cfg}
      taskId={taskId}
      state={state}
      io={io}
      rehearse={rehearse}
      refreshing={refreshing}
      onRetry={() => {
        setState({ kind: "loading" });
        void load();
      }}
      onRefresh={() => void refresh()}
      book={(p, ctx) => (
        <BookCallButton
          taskId={taskId}
          clientName={ctx.row.client_name}
          stage={ctx.row.client_status ?? undefined}
          kind={p.kind}
          variant={p.variant}
          defaultOpen={p.autoOpen}
          onAutoOpenConsumed={p.onAutoOpenConsumed}
        >
          {p.label}
        </BookCallButton>
      )}
    />
  );
}

export interface FormWindowViewProps {
  cfg: FormConfig;
  taskId: string;
  state: WindowState;
  io: FormIO;
  rehearse?: boolean;
  refreshing?: boolean;
  onRetry: () => void;
  onRefresh: () => void;
  /** Typeform's SDK; the harness passes a stand-in. */
  embed?: () => Promise<CreateWidget>;
  book?: (p: BookProps, ctx: FormContext) => ReactNode;
  /** The harness starts in Sharing without touching this browser's choice. */
  initialSharing?: boolean;
}

/** The window as drawn: header, seal, switch, and the panel or a plain state. */
export function FormWindowView({
  cfg,
  taskId,
  state,
  io,
  rehearse = false,
  refreshing = false,
  onRetry,
  onRefresh,
  embed,
  book,
  initialSharing,
}: FormWindowViewProps) {
  const [sharing, setSharing] = useState(() => initialSharing ?? readSharing());
  const [phase, setPhase] = useState<FormPhase>("open");
  const titleRef = useRef<HTMLHeadingElement>(null);
  const ctx = state.kind === "ready" ? state.ctx : null;
  const clientName = ctx?.row.client_name ?? "";
  const stage = ctx?.row.client_status
    ?.replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim();

  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  useEffect(() => {
    document.title = clientName
      ? `${cfg.title} · ${clientName}`
      : `${cfg.title} · Client Success`;
  }, [cfg.title, clientName]);

  const flip = (on: boolean) => {
    setSharing(on);
    if (initialSharing === undefined) saveSharing(on);
  };
  const open = ctx ? formLink(cfg.formId, cfg.hidden(ctx).values) : null;

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2">
        <h1
          ref={titleRef}
          tabIndex={-1}
          className="text-lg font-semibold tracking-tight outline-none"
        >
          {cfg.title}
          {sharing && clientName ? (
            <span className="font-normal text-muted-foreground">
              {" "}
              · <bdi>{clientName}</bdi>
            </span>
          ) : null}
        </h1>
        {!sharing && ctx ? (
          <Seal
            clientName={clientName}
            taskId={ctx.row.clickup_task_id}
            glow={phase !== "sent"}
            rehearse={rehearse}
          />
        ) : !sharing ? (
          <span className="font-mono text-[13px] text-muted-foreground">
            {taskId}
          </span>
        ) : null}
        {!sharing && stage ? (
          <span className="hidden text-xs text-muted-foreground xl:inline">
            {stage}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {/* Only with a form to hide things from. */}
          {ctx ? (
            <div
              role="group"
              aria-label="Who sees this window"
              className="inline-flex rounded-full p-0.5 ring-1 ring-border"
            >
              {(
                [
                  [false, "Just me"],
                  [true, "Sharing"],
                ] as const
              ).map(([on, label]) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={sharing === on}
                  onClick={() => flip(on)}
                  className={cn(
                    "h-7 rounded-full px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    sharing === on
                      ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
          {/* Not while a second kickoff is held (that is the guard's click),
              and not once this one is sent: a fresh form for the same client
              would be a second kickoff without the guard. */}
          {!sharing &&
          !rehearse &&
          open &&
          phase !== "held" &&
          phase !== "sent" ? (
            <a
              href={open}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden items-center gap-1 text-xs text-primary-ink underline-offset-4 hover:underline sm:inline-flex"
              title="The same form, with the same client and answers, in Typeform"
            >
              Open in Typeform
              <ArrowUpRight aria-hidden className="size-3.5" />
            </a>
          ) : null}
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label="Close this window"
            onClick={() => window.close()}
          >
            <X aria-hidden />
          </Button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        {state.kind === "loading" ? (
          <Plain>Loading the form…</Plain>
        ) : state.kind === "blocked" ? (
          <Plain
            actions={
              <>
                {state.retry ? (
                  <Button size="sm" variant="outline" onClick={onRetry}>
                    Try again
                  </Button>
                ) : null}
                {state.close ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.close()}
                  >
                    Close this window
                  </Button>
                ) : null}
                {state.plain && !rehearse ? (
                  <a
                    href={state.plain}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-primary-ink underline-offset-4 hover:underline"
                  >
                    Open the plain {cfg.title.toLowerCase()} (card ID only)
                    <ArrowUpRight aria-hidden className="size-3.5" />
                  </a>
                ) : null}
              </>
            }
          >
            {state.text}
          </Plain>
        ) : state.kind === "unread" ? (
          <Plain
            actions={
              <Button size="sm" onClick={onRefresh} disabled={refreshing}>
                <RefreshCw
                  aria-hidden
                  className={cn(refreshing && "motion-safe:animate-spin")}
                />
                {refreshing ? "Refreshing" : "Refresh"}
              </Button>
            }
          >
            This card has not been read yet. Refresh reads ClickUp and Typeform
            now.
          </Plain>
        ) : (
          <FormPanel
            config={cfg}
            ctx={state.ctx}
            io={io}
            clientName={clientName}
            rehearse={rehearse}
            sharing={sharing}
            embed={embed}
            book={book ? p => book(p, state.ctx) : undefined}
            onPhase={setPhase}
          />
        )}
      </main>
    </div>
  );
}

function Seal({
  clientName,
  taskId,
  glow,
  rehearse,
}: {
  clientName: string;
  taskId: string;
  glow: boolean;
  rehearse: boolean;
}) {
  const why = rehearse
    ? "A rehearsal in Typeform's sandbox: nothing is saved, nothing reaches this card, and Make does not run."
    : "From the client record. Make writes everything from this form to this card.";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex min-w-0 max-w-full items-center gap-2 rounded-full px-3 py-1 text-sm ring-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            rehearse
              ? "bg-warning/10 ring-warning/60"
              : "bg-primary/10 ring-primary/40",
            glow && !rehearse && "glow-teal",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full",
              rehearse ? "bg-warning" : "bg-primary",
            )}
          />
          <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
            {rehearse ? "Rehearsal ·" : "Sends to"}
          </span>
          <bdi className="min-w-0 truncate font-medium">{clientName}</bdi>
          <span className="shrink-0 font-mono text-[13px] text-foreground/80">
            {taskId}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 text-sm">{why}</PopoverContent>
    </Popover>
  );
}

function Plain({
  children,
  actions,
}: {
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="m-auto w-full max-w-md space-y-4 p-8 text-center">
      <p className="text-balance text-[15px] leading-6" role="status">
        {children}
      </p>
      {actions ? (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
