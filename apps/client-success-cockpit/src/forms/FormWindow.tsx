import { ArrowUpRight, RefreshCw, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useParams } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { BookCallButton } from "@/components/ClientCheckIn";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  type BookProps,
  type CreateWidget,
  type FormIO,
  FormPanel,
  type FormPhase,
  Seal,
} from "./FormPanel";
import type { FormConfig, FormContext } from "./formConfig";
import { formConfig } from "./kickoff";
import { formUrl } from "./OpenFormButton";
import { formLink } from "./prefill";
import { formReads, useLiveForm, type WindowState } from "./useLiveForm";

export { blockedFor, type WindowState } from "./useLiveForm";

/**
 * /clients/:key/forms/:form, in a window of its own (KICKOFF.md 1 and 6):
 * outside AppLayout, so no sidebar, Ask Hermes or Cmd+K can take focus on a
 * call, and shareable on its own. The window reads the client through the
 * seat's own client (cockpit_csm_client_gate decides), shows the "Sends to"
 * seal before anything else, and holds the Just me / Sharing switch. The
 * form and its side panel are FormPanel's.
 */

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
  const me = useMemo(
    () => ({ email: auth.email, firstName: firstName(auth.name) }),
    [auth.email, auth.name],
  );
  // The window reads the card's Slack notices for the trail's last stop.
  const notices = Boolean(cfg.after.notice);
  const reads = useMemo(
    () => formReads(client, taskId, cfg.key, { notices }),
    [client, taskId, cfg.key, notices],
  );
  const live = useLiveForm({ cfg, taskId, reads, me });

  return (
    <FormWindowView
      cfg={cfg}
      taskId={taskId}
      state={live.state}
      io={live.io}
      rehearse={rehearse}
      refreshing={live.refreshing}
      onRetry={live.retry}
      onRefresh={() => void live.refresh()}
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
  /** This window's own address in full; the harness passes a stand-in. */
  windowLink?: string;
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
  windowLink,
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
  const self =
    windowLink ??
    (typeof window !== "undefined"
      ? `${window.location.origin}${formUrl(taskId, cfg.key)}`
      : undefined);

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
            windowLink={self}
          />
        )}
      </main>
    </div>
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
