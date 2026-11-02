/* Hallmark · component: Send a form sheet, Forms out card, form bands · genre: modern-minimal · theme: the cockpit's own (Geist, --mahara-teal)
 * states: default · hover · focus-visible · active · disabled (with its reason) · loading · error · success
 * Hallmark · pre-emit critique: P4 H4 E4 S5 R5 V4
 */

import { Copy, ExternalLink, LoaderCircle } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { DeliveryLine } from "@/components/DeliveryLine";
import { Chip, Dot, LINK_INK, SectionCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { consentLine, type PauseConsent } from "@/forms/staff/formSheetCore";
import type { ApproveResult, FormsIO } from "@/lib/clientForms";
import {
  type AnswerRead,
  APPROVED,
  type Channel,
  clientTextProblem,
  defaultChannels,
  deliveryLine,
  FORMS_OUT_EMPTY,
  type FormChoice,
  fillTemplate,
  formInline,
  formWords,
  type InviteRow,
  type InviteView,
  inviteStateWords,
  isExpired,
  isNetworkError,
  kuwaitDayWords,
  type Lang,
  linkLine,
  NOTE_HINT,
  needsApproval,
  networkSentence,
  PHONE_ALERT,
  portalOpen,
  portalPreviewUrl,
  presenceLine,
  SENT_AGAIN_REASON,
  sendLabel,
  sendToast,
  sentByWords,
  type TodayRow,
  todayLine,
  todayRowText,
  WAITS_FOR_APPROVAL,
  WHATSAPP_HINT,
  WITHDRAW_PROMPT,
  whatsappProblem,
} from "@/lib/clientFormsCore";
import {
  type LowScore,
  lowScoreDetails,
  lowScoreLine,
  lowScoreRowText,
} from "@/lib/clientVoice";
import { cn } from "@/lib/utils";

/**
 * Client forms on the client page and on Today (docs/forms/WAVE34-CONTRACT.md
 * 5.1 to 5.3, 4.10): Send a form (the right sheet on a desk, the bottom sheet
 * on a phone), Forms out with each invite's delivery line and its actions,
 * and Today's form bands. Every call goes through a FormsIO (the live one is
 * clientForms.ts formsIO), so the tests and the harness pass stand-ins and
 * nothing here reaches the portal, WhatsApp or Slack by itself.
 *
 * Rules the screens keep: one request id per open Send panel, reused on a
 * retry; Sent only when the portal is a channel; a WhatsApp link goes only
 * after a person approves the exact text; a copied link is shown once, held
 * in memory while its dialog is open and dropped on close (never stored).
 */

function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, ch => {
    const n = Number(ch);
    return (n ^ ((Math.random() * 16) >> (n / 4))).toString(16);
  });
}

/** True on a desktop-wide window: the sheet comes from the right, else from the bottom. */
function useWide(): boolean {
  const query = "(min-width: 768px)";
  const read = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : true;
  const [wide, setWide] = useState(read);
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    )
      return;
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    on();
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);
  return wide;
}

const said = (e: unknown) =>
  String((e as Error)?.message ?? e ?? "").trim() ||
  "The server refused this with no reason. Try again in a minute.";

// --- The view ---------------------------------------------------------------------------

export type ViewRead = {
  view: InviteView | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  put: (v: InviteView) => void;
};

/** One client's forms (cockpit_form_invite_view): read when the door is open, again after each act. */
export function useInviteView(
  io: FormsIO | null,
  taskId: string | null,
  on: boolean,
): ViewRead {
  const [view, setView] = useState<InviteView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick reads again
  useEffect(() => {
    if (!io || !taskId || !on) return;
    let live = true;
    setLoading(true);
    io.view(taskId)
      .then(v => {
        if (!live) return;
        setView(v);
        setError(null);
      })
      .catch(e => live && setError(said(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [io, taskId, on, tick]);
  const reload = useCallback(() => setTick(t => t + 1), []);
  const put = useCallback((v: InviteView) => setView(v), []);
  return { view, error, loading, reload, put };
}

// --- Send a form ---------------------------------------------------------------------------

export type SendPreset = {
  formKey?: string;
  origin?: "csm" | "churn";
};

function Choice({
  pressed,
  disabled,
  onClick,
  children,
  title,
  data,
}: {
  pressed: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
  data?: Record<string, string>;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-disabled={disabled || undefined}
      title={title}
      onClick={() => {
        if (!disabled) onClick();
      }}
      {...data}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background active:opacity-80",
        pressed
          ? "border-mahara-teal bg-mahara-teal/15 text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        disabled &&
          "cursor-not-allowed border-dashed opacity-60 hover:bg-transparent hover:text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

type Phase =
  | { kind: "editing" }
  | { kind: "sending" }
  | {
      kind: "sent";
      delivered: "portal" | "waiting_approval";
      messageId: string | null;
      approve: "idle" | "busy" | "done";
      warnings: string[];
      approveError: string | null;
    };

/**
 * Send a form (5.1). The panel reads the client's view once per open, picks
 * the default channels per form from it, and sends through
 * cockpit_form_invite_issue with one request id per open panel.
 */
export function SendFormSheet({
  io,
  open,
  taskId,
  clientName,
  preset,
  view: given,
  now,
  onClose,
  onSent,
}: {
  io: FormsIO | null;
  open: boolean;
  taskId: string;
  clientName: string;
  preset?: SendPreset;
  /** The clock the presence line counts days on; the tests and the harness pass their own. */
  now?: number;
  /** The client page's own read, when it has one (Forms out shares it). */
  view?: InviteView | null;
  onClose: () => void;
  onSent?: (view: InviteView | null) => void;
}) {
  const wide = useWide();
  return (
    <Sheet open={open} onOpenChange={o => (o ? null : onClose())}>
      <SheetContent
        side={wide ? "right" : "bottom"}
        data-send-form
        className={cn(
          "flex flex-col gap-0 overflow-y-auto p-0",
          wide
            ? "w-[min(560px,100vw)] max-w-none sm:max-w-none"
            : "max-h-[92dvh]",
        )}
      >
        {open ? (
          <SendFormBody
            io={io}
            taskId={taskId}
            clientName={clientName}
            preset={preset}
            given={given ?? null}
            clock={now}
            onClose={onClose}
            onSent={onSent}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function SendFormBody({
  io,
  taskId,
  clientName,
  preset,
  given,
  clock,
  onClose,
  onSent,
}: {
  io: FormsIO | null;
  taskId: string;
  clientName: string;
  preset?: SendPreset;
  given: InviteView | null;
  clock?: number;
  onClose: () => void;
  onSent?: (view: InviteView | null) => void;
}) {
  // One request id per open panel: a retry and a double press send the same one.
  const requestId = useRef(newRequestId());
  const read = useInviteView(io, taskId, !given);
  const view = given ?? read.view;
  const now = clock ?? Date.now();
  const sendable = useMemo(
    () => (view?.forms ?? []).filter(f => f.key !== "pause_consent"),
    [view],
  );
  const [formKey, setFormKey] = useState<string | null>(
    preset?.formKey ?? null,
  );
  const form: FormChoice | null =
    sendable.find(f => f.key === formKey) ??
    (formKey ? null : (sendable.find(f => f.sendable) ?? null));
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [push, setPush] = useState(false);
  const [note, setNote] = useState("");
  const [lang, setLang] = useState<Lang>("ar");
  const [body, setBody] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "editing" });

  // A new form picked: its own default channels and template, unless typed over.
  const formId = form?.key ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset per form
  useEffect(() => {
    setChannels(null);
    setBody(null);
    setError(null);
  }, [formId]);

  if (!view)
    return (
      <div className="space-y-2 p-6">
        <SheetTitle className="text-[15px]">Send a form</SheetTitle>
        <SheetDescription className="text-sm text-muted-foreground">
          {read.error ? (
            <span className="txt-bad" role="alert">
              The client's forms could not be read: {read.error}
            </span>
          ) : (
            "Reading the client's portal and forms…"
          )}
        </SheetDescription>
      </div>
    );

  const picked = channels ?? (form ? defaultChannels(view, form, now) : []);
  const portalOk = portalOpen(view);
  const wa = picked.includes("whatsapp");
  const template = form ? view.templates[form.key] : undefined;
  const text =
    body ?? (template ? fillTemplate(template[lang], view.clientName) : "");
  const noteProblem = note.trim() ? clientTextProblem(note) : null;
  const waProblem = wa ? whatsappProblem(text) : null;
  const label = form ? sendLabel(form.key, form.title) : "Send the form";

  const toggle = (c: Channel) => {
    const next = picked.includes(c)
      ? picked.filter(x => x !== c)
      : [...picked, c];
    setChannels(next);
    if (c === "portal" && !next.includes("portal")) setPush(false);
  };

  const send = async () => {
    if (!io || !form || phase.kind === "sending") return;
    if (!form.sendable) {
      setError(form.why ?? "This form cannot go to this client now.");
      return;
    }
    if (!picked.length) {
      setError("Pick Portal, WhatsApp link, or both.");
      return;
    }
    if (noteProblem) return setError(noteProblem);
    if (waProblem) return setError(waProblem);
    setError(null);
    setPhase({ kind: "sending" });
    try {
      const out = await io.issue({
        taskId,
        formKey: form.key,
        channels: picked,
        note: note.trim() || null,
        lang,
        push: push && picked.includes("portal"),
        context: {},
        requestId: requestId.current,
        origin: preset?.origin ?? "csm",
      });
      toast.success(sendToast(out.delivered));
      setPhase({
        kind: "sent",
        delivered: out.delivered,
        messageId: out.messageId,
        approve: "idle",
        warnings: [],
        approveError: null,
      });
      onSent?.(out.view);
    } catch (e) {
      setError(
        isNetworkError(e) ? networkSentence(form.key, form.title) : said(e),
      );
      setPhase({ kind: "editing" });
    }
  };

  const approve = async (acceptWarnings = false) => {
    if (!io || phase.kind !== "sent" || !phase.messageId) return;
    setPhase({ ...phase, approve: "busy", approveError: null });
    try {
      const out: ApproveResult = await io.approve({
        messageId: phase.messageId,
        body: text,
        acceptWarnings,
      });
      if (out.needsConfirm) {
        setPhase({ ...phase, approve: "idle", warnings: out.warnings });
        return;
      }
      toast.success(APPROVED);
      setPhase({ ...phase, approve: "done", warnings: [] });
    } catch (e) {
      setPhase({ ...phase, approve: "idle", approveError: said(e) });
    }
  };

  const disabledForms = sendable.filter(f => !f.sendable && f.why);

  return (
    <div className="flex min-h-full flex-col">
      <header className="space-y-1 border-b px-4 pt-4 pb-3 pr-12 sm:px-6 sm:pt-6">
        <SheetTitle className="text-[15px] font-semibold">
          Send a form
        </SheetTitle>
        <div className="flex flex-wrap items-center gap-2">
          <bdi className="text-sm font-medium">
            {view.clientName || clientName}
          </bdi>
          {view.cardStatus ? <Chip dot={false}>{view.cardStatus}</Chip> : null}
        </div>
        <SheetDescription
          className="text-xs text-muted-foreground"
          data-presence
        >
          {presenceLine(view, form, now)}
        </SheetDescription>
      </header>

      {phase.kind === "sent" ? (
        <section
          className="flex-1 space-y-4 px-4 py-4 sm:px-6"
          aria-live="polite"
        >
          <p className="text-[15px] font-medium">
            <span className="text-primary-ink">
              {phase.delivered === "portal" ? "Sent" : "Saved"}:
            </span>{" "}
            the {form ? formInline(form.key, form.title) : "form"} to{" "}
            <bdi>{view.clientName}</bdi>
            {phase.delivered === "portal" ? " in their portal." : "."}
          </p>
          {phase.messageId ? (
            <div className="space-y-3 rounded-xl border p-3">
              <p className="text-sm" data-approve-line>
                {phase.approve === "done" ? APPROVED : WAITS_FOR_APPROVAL}
              </p>
              <p
                className="whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-sm"
                dir={lang === "ar" ? "rtl" : "ltr"}
              >
                {text}
              </p>
              {phase.warnings.length ? (
                <ul className="space-y-1 text-xs txt-warn">
                  {phase.warnings.map(w => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
              {phase.approveError ? (
                <p className="text-xs txt-bad" role="alert">
                  {phase.approveError}
                </p>
              ) : null}
              {phase.approve !== "done" ? (
                <Button
                  size="sm"
                  disabled={phase.approve === "busy"}
                  onClick={() => void approve(phase.warnings.length > 0)}
                >
                  {phase.approve === "busy" ? (
                    <>
                      <LoaderCircle
                        aria-hidden
                        className="animate-spin motion-reduce:animate-none"
                      />
                      Approving…
                    </>
                  ) : phase.warnings.length ? (
                    "Approve anyway"
                  ) : (
                    "Approve and send"
                  )}
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : (
        <form
          className="flex-1 space-y-5 px-4 py-4 sm:px-6"
          noValidate
          onSubmit={e => {
            e.preventDefault();
            void send();
          }}
        >
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-muted-foreground">
              Form
            </legend>
            <div className="flex flex-wrap gap-2" role="group">
              {sendable.map(f => (
                <Choice
                  key={f.key}
                  pressed={form?.key === f.key}
                  disabled={!f.sendable}
                  title={f.why ?? undefined}
                  data={{ "data-form-chip": f.key }}
                  onClick={() => setFormKey(f.key)}
                >
                  {formWords(f.key, f.title)}
                </Choice>
              ))}
            </div>
            {disabledForms.length ? (
              <ul
                className="space-y-0.5 text-xs text-muted-foreground"
                data-why
              >
                {disabledForms.map(f => (
                  <li key={f.key}>
                    <span className="font-medium text-foreground/80">
                      {formWords(f.key, f.title)}:
                    </span>{" "}
                    {f.why}
                  </li>
                ))}
              </ul>
            ) : null}
            {!sendable.length ? (
              <p className="text-xs text-muted-foreground">
                No client form is open to send yet. They open with the portal
                forms, after the switch-on.
              </p>
            ) : null}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-muted-foreground">
              Goes by
            </legend>
            <div className="flex flex-wrap gap-2" role="group">
              <Choice
                pressed={picked.includes("portal")}
                disabled={!portalOk}
                title={
                  portalOk
                    ? undefined
                    : `${view.clientName} has no open Mahara OS workspace. Send the WhatsApp link.`
                }
                data={{ "data-channel": "portal" }}
                onClick={() => toggle("portal")}
              >
                Portal
              </Choice>
              <Choice
                pressed={wa}
                data={{ "data-channel": "whatsapp" }}
                onClick={() => toggle("whatsapp")}
              >
                WhatsApp link
              </Choice>
            </div>
            {picked.includes("portal") ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-[color:var(--primary-ink)]"
                  checked={push}
                  onChange={e => setPush(e.target.checked)}
                  data-push
                />
                {PHONE_ALERT}
              </label>
            ) : null}
          </fieldset>

          <div className="space-y-1.5">
            <label
              htmlFor="send-form-note"
              className="text-xs font-medium text-muted-foreground"
            >
              A line for the client (optional)
            </label>
            <Input
              id="send-form-note"
              value={note}
              maxLength={280}
              dir="auto"
              onChange={e => setNote(e.target.value)}
              aria-invalid={noteProblem ? true : undefined}
              aria-describedby="send-form-note-hint"
            />
            <p
              id="send-form-note-hint"
              className={cn(
                "text-xs",
                noteProblem ? "txt-bad" : "text-muted-foreground",
              )}
            >
              {noteProblem ?? NOTE_HINT}
            </p>
          </div>

          {wa ? (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="send-form-text"
                  className="text-xs font-medium text-muted-foreground"
                >
                  WhatsApp text
                </label>
                <div
                  className="flex gap-1"
                  role="group"
                  aria-label="Language of the WhatsApp text"
                >
                  {(["ar", "en"] as const).map(l => (
                    <Choice
                      key={l}
                      pressed={lang === l}
                      onClick={() => {
                        setLang(l);
                        setBody(null);
                      }}
                      data={{ "data-lang": l }}
                    >
                      {l === "ar" ? "Arabic" : "English"}
                    </Choice>
                  ))}
                </div>
              </div>
              <Textarea
                id="send-form-text"
                value={text}
                rows={4}
                dir={lang === "ar" ? "rtl" : "ltr"}
                lang={lang}
                className={cn(lang === "ar" && "font-sans")}
                onChange={e => setBody(e.target.value)}
                aria-invalid={waProblem ? true : undefined}
                aria-describedby="send-form-text-hint"
              />
              <p
                id="send-form-text-hint"
                className={cn(
                  "text-xs",
                  waProblem ? "txt-bad" : "text-muted-foreground",
                )}
              >
                {waProblem ?? WHATSAPP_HINT}
              </p>
            </div>
          ) : null}
          <button type="submit" hidden tabIndex={-1} aria-hidden />
        </form>
      )}

      <footer className="sticky bottom-0 flex flex-wrap items-center justify-end gap-3 border-t bg-card px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom,0px))] sm:px-6">
        {phase.kind === "sent" ? (
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <p
              className="min-w-0 flex-1 text-xs txt-bad"
              role="alert"
              aria-live="polite"
              data-send-error
            >
              {error ?? ""}
            </p>
            <Button
              size="sm"
              data-send
              disabled={phase.kind === "sending" || !form}
              onClick={() => void send()}
            >
              {phase.kind === "sending" ? (
                <>
                  <LoaderCircle
                    aria-hidden
                    className="animate-spin motion-reduce:animate-none"
                  />
                  Sending…
                </>
              ) : (
                label
              )}
            </Button>
          </>
        )}
      </footer>
    </div>
  );
}

// --- Forms out ---------------------------------------------------------------------------------

/** The copy-a-link dialog: the link once, in memory while open, gone on close. */
function LinkDialog({
  link,
  onClose,
}: {
  link: { url: string; expiresAt: string | null } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!link) setCopied(false);
  }, [link]);
  return (
    <Dialog open={link !== null} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent className="max-w-md">
        <DialogTitle className="text-[15px]">Copy a link</DialogTitle>
        <DialogDescription className="text-sm">
          {link ? linkLine(link.expiresAt) : ""}
        </DialogDescription>
        {link ? (
          <div className="space-y-3">
            <p
              className="break-all rounded-lg border bg-muted/40 p-3 font-mono text-xs"
              data-link-url
              dir="ltr"
            >
              {link.url}
            </p>
            <Button
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link.url);
                  setCopied(true);
                } catch {
                  toast.error(
                    "Not copied. Select the link above and copy it by hand.",
                  );
                }
              }}
            >
              <Copy aria-hidden />
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Read the answer (cockpit_form_answer_read): the fields as the client gave them, never an email. */
export function AnswerSheet({
  io,
  responseId,
  onClose,
}: {
  io: FormsIO | null;
  responseId: string | null;
  onClose: () => void;
}) {
  const wide = useWide();
  const [read, setRead] = useState<{
    answer: AnswerRead | null;
    error: string | null;
  }>({
    answer: null,
    error: null,
  });
  useEffect(() => {
    setRead({ answer: null, error: null });
    if (!io || !responseId) return;
    let live = true;
    io.answer(responseId)
      .then(a => live && setRead({ answer: a, error: null }))
      .catch(e => live && setRead({ answer: null, error: said(e) }));
    return () => {
      live = false;
    };
  }, [io, responseId]);
  const a = read.answer;
  return (
    <Sheet
      open={responseId !== null}
      onOpenChange={o => (o ? null : onClose())}
    >
      <SheetContent
        side={wide ? "right" : "bottom"}
        className={cn(
          "overflow-y-auto",
          wide
            ? "w-[min(560px,100vw)] max-w-none sm:max-w-none"
            : "max-h-[92dvh]",
        )}
        data-answer
      >
        <SheetTitle className="pr-8 text-[15px]">
          {a ? formWords(a.formKey, a.title) : "The answer"}
        </SheetTitle>
        <SheetDescription className="text-xs text-muted-foreground">
          {a
            ? [
                a.submittedAt
                  ? `Answered ${kuwaitDayWords(a.submittedAt)}`
                  : "Answered on a day not recorded",
                a.signer ? `by ${a.signer}` : null,
                a.source === "public"
                  ? "by link"
                  : a.source === "portal"
                    ? "in the portal"
                    : null,
              ]
                .filter(Boolean)
                .join(" ")
            : read.error
              ? ""
              : "Reading the answer…"}
        </SheetDescription>
        {read.error ? (
          <p className="mt-3 text-sm txt-bad" role="alert">
            The answer could not be read: {read.error}
          </p>
        ) : null}
        {a ? (
          <dl className="mt-4 divide-y rounded-xl border">
            {a.fields.map(f => (
              <div key={f.key} className="grid gap-1 px-4 py-3">
                <dt className="text-xs text-muted-foreground">{f.label}</dt>
                <dd
                  className={cn(
                    "text-sm",
                    typeof f.value === "number" && "font-mono",
                  )}
                  dir="auto"
                >
                  <bdi>{f.display}</bdi>
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** Withdraw's reason prompt, inline under the row. */
function WithdrawPrompt({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex w-full flex-wrap items-center gap-2"
      onSubmit={e => {
        e.preventDefault();
        if (reason.trim().length < 4) {
          setError("Say why in a few words, so the history reads back.");
          return;
        }
        onSubmit(reason.trim());
      }}
    >
      <label className="sr-only" htmlFor="withdraw-reason">
        {WITHDRAW_PROMPT}
      </label>
      <Input
        id="withdraw-reason"
        autoFocus
        placeholder={WITHDRAW_PROMPT}
        value={reason}
        maxLength={240}
        dir="auto"
        onChange={e => setReason(e.target.value)}
        className="h-8 min-w-0 flex-1 text-sm"
        aria-invalid={error ? true : undefined}
      />
      <Button
        size="sm"
        type="submit"
        variant="outline"
        disabled={busy}
        className="border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive"
      >
        {busy ? "Withdrawing…" : "Withdraw"}
      </Button>
      <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
        Cancel
      </Button>
      {error ? (
        <p className="basis-full text-xs txt-bad" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** One invite's row: the form, its state in words, the delivery line, its actions. */
function InviteLine({
  io,
  view,
  row,
  now,
  onChanged,
  onRead,
  onLink,
}: {
  io: FormsIO | null;
  view: InviteView;
  row: InviteRow;
  now: number;
  onChanged: (v: InviteView | null) => void;
  onRead: (responseId: string) => void;
  onLink: (link: { url: string; expiresAt: string | null }) => void;
}) {
  const [withdrawing, setWithdrawing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = row.state === "open" && !isExpired(row, now);
  // The pause consent and the exit survey reach the client only in the portal
  // or by the approved WhatsApp message: no copied link (the database refuses one).
  const copyable =
    !COPYLESS.has(row.formKey) &&
    view.forms.find(f => f.key === row.formKey)?.audience !== "admin";
  const act = async (key: string, run: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await run();
    } catch (e) {
      setError(said(e));
    } finally {
      setBusy(null);
    }
  };
  const words = inviteStateWords(row, now);
  return (
    <div
      className="space-y-2.5 px-4 py-3 sm:px-6"
      data-invite={row.id}
      data-state={row.state}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm">
          <span className="font-medium">
            {formWords(row.formKey, row.title)}
          </span>
          <span className="text-muted-foreground"> · {words}</span>
        </p>
        <span className="text-xs text-muted-foreground">
          from {sentByWords(row)}
          {row.channels.length
            ? ` · ${row.channels.map(c => (c === "whatsapp" ? "WhatsApp" : c === "copy" ? "link" : "portal")).join(" + ")}`
            : ""}
        </span>
      </div>
      <DeliveryLine line={deliveryLine(row, now)} />
      {withdrawing ? (
        <WithdrawPrompt
          busy={busy === "withdraw"}
          onCancel={() => setWithdrawing(false)}
          onSubmit={reason =>
            void act("withdraw", async () => {
              if (!io) return;
              const v = await io.withdraw(view.taskId, row.id, reason);
              toast.success("Withdrawn");
              setWithdrawing(false);
              onChanged(v);
            })
          }
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {open && needsApproval(row) && row.messageId ? (
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                void act("approve", async () => {
                  if (!io || !row.messageId) return;
                  const body = await io.messageBody(row.messageId);
                  const out = await io.approve({
                    messageId: row.messageId,
                    body,
                  });
                  if (out.needsConfirm) {
                    setError(
                      `${out.warnings.join(" ")} Open Send a form to check the text, then approve it there.`,
                    );
                    return;
                  }
                  toast.success(APPROVED);
                  onChanged(null);
                })
              }
            >
              {busy === "approve" ? "Approving…" : "Approve and send"}
            </Button>
          ) : null}
          {row.responseId ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRead(String(row.responseId))}
            >
              Read the answer
            </Button>
          ) : null}
          {open && row.formKey !== "pause_consent" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                void act("again", async () => {
                  if (!io) return;
                  await io.withdraw(view.taskId, row.id, SENT_AGAIN_REASON);
                  const out = await io.issue({
                    taskId: view.taskId,
                    formKey: row.formKey,
                    channels: row.channels.filter(c => c !== "copy").length
                      ? row.channels.filter(c => c !== "copy")
                      : ["whatsapp"],
                    note: null,
                    lang: "ar",
                    push: false,
                    context: {},
                    requestId: newRequestId(),
                    origin: row.origin === "churn" ? "churn" : "csm",
                  });
                  toast.success(sendToast(out.delivered));
                  onChanged(out.view);
                })
              }
            >
              {busy === "again" ? "Sending…" : "Send again"}
            </Button>
          ) : null}
          {open && copyable ? (
            <Button
              size="sm"
              variant="ghost"
              className={LINK_INK}
              disabled={busy !== null}
              onClick={() =>
                void act("link", async () => {
                  if (!io) return;
                  onLink(await io.link(view.taskId, row.id));
                })
              }
            >
              {busy === "link" ? "Making the link…" : "Copy a link"}
            </Button>
          ) : null}
          {open && view.workspace && row.channels.includes("portal") ? (
            <a
              href={portalPreviewUrl(view.workspace.locationId, row.formKey)}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm underline-offset-4 hover:underline",
                LINK_INK,
              )}
            >
              See what they see
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
          ) : null}
          {open ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:bg-destructive/5 hover:text-destructive"
              disabled={busy !== null}
              onClick={() => setWithdrawing(true)}
            >
              Withdraw
            </Button>
          ) : null}
        </div>
      )}
      {error ? (
        <p className="text-xs txt-bad" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Forms out (5.2): every invite of this client with its delivery line, newest first. */
export function FormsOut({
  io,
  read,
  onSend,
}: {
  io: FormsIO | null;
  read: ViewRead;
  onSend: () => void;
}) {
  const [answer, setAnswer] = useState<string | null>(null);
  const [link, setLink] = useState<{
    url: string;
    expiresAt: string | null;
  } | null>(null);
  const now = Date.now();
  const view = read.view;
  const rows = view
    ? [
        ...view.open,
        ...view.history.filter(h => !view.open.some(o => o.id === h.id)),
      ]
    : [];
  return (
    <section id="forms-out" className="scroll-mt-20" data-forms-out>
      <SectionCard
        title="Forms out"
        count={view ? view.open.length || undefined : undefined}
        action={
          <Button size="sm" variant="outline" onClick={onSend}>
            Send a form
          </Button>
        }
        flush
      >
        {read.error ? (
          <p className="flex gap-2 px-4 py-3 text-sm sm:px-6" role="note">
            <span className="flex h-5 shrink-0 items-center">
              <Dot tone="warn" />
            </span>
            <span className="min-w-0">
              The forms could not be read, so one may be missing here:{" "}
              {read.error}
            </span>
          </p>
        ) : null}
        {!view && !read.error ? (
          <p className="px-4 py-4 text-sm text-muted-foreground sm:px-6">
            Reading the forms…
          </p>
        ) : null}
        {view && rows.length === 0 ? (
          <p
            className="px-4 py-4 text-sm text-muted-foreground sm:px-6"
            data-empty
          >
            {FORMS_OUT_EMPTY}
          </p>
        ) : null}
        {view
          ? rows.map(r => (
              <InviteLine
                key={r.id}
                io={io}
                view={view}
                row={r}
                now={now}
                onChanged={v => (v ? read.put(v) : read.reload())}
                onRead={setAnswer}
                onLink={setLink}
              />
            ))
          : null}
      </SectionCard>
      <AnswerSheet
        io={io}
        responseId={answer}
        onClose={() => setAnswer(null)}
      />
      <LinkDialog link={link} onClose={() => setLink(null)} />
    </section>
  );
}

// --- Today's form bands (5.3) -----------------------------------------------------------------

export type Read<T> = { rows: T[] | null; error: string | null };

/** Today's reads: the seat's invites (doors.invites) and the low scores (doors.voice). */
export function useFormBands(
  io: FormsIO | null,
  readLow: (() => Promise<LowScore[]>) | null,
  on: boolean,
  version: number,
): { invites: Read<TodayRow>; low: Read<LowScore>; reload: () => void } {
  const [invites, setInvites] = useState<Read<TodayRow>>({
    rows: null,
    error: null,
  });
  const [low, setLow] = useState<Read<LowScore>>({ rows: null, error: null });
  const [tick, setTick] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: version and tick read again
  useEffect(() => {
    if (!on) return;
    let live = true;
    if (io)
      io.today()
        .then(rows => live && setInvites({ rows, error: null }))
        .catch(e => live && setInvites({ rows: null, error: said(e) }));
    if (readLow)
      readLow()
        .then(rows => live && setLow({ rows, error: null }))
        .catch(e => live && setLow({ rows: null, error: said(e) }));
    return () => {
      live = false;
    };
  }, [io, readLow, on, version, tick]);
  return { invites, low, reload: useCallback(() => setTick(t => t + 1), []) };
}

function Band({
  title,
  rows,
  children,
}: {
  title: string;
  rows: number;
  children: ReactNode;
}) {
  if (!rows) return null;
  return (
    <SectionCard title={title} count={rows} flush>
      {children}
    </SectionCard>
  );
}

function BandLine({
  line,
  full,
  name,
  actions,
  fact,
}: {
  line: string;
  /** The whole sentence with the band's words, for a screen reader moving row by row. */
  full: string;
  name: string;
  actions?: ReactNode;
  fact?: string;
}) {
  const at = name ? line.indexOf(name) : -1;
  return (
    <div
      className="space-y-2 px-4 py-3 sm:px-6"
      data-band-row
      role="group"
      aria-label={full}
    >
      <p className="text-sm">
        {at < 0 ? (
          line
        ) : (
          <>
            {line.slice(0, at)}
            <bdi className="font-medium">{name}</bdi>
            {line.slice(at + name.length)}
          </>
        )}
        {fact ? <span className="font-mono text-sm"> {fact}</span> : null}
      </p>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

/**
 * Today's form bands, hidden when empty: NPS sent, Not answered, WhatsApp
 * link to approve, Answered, Send the exit survey, Low score. A read that
 * failed is said under the bands, never shown as nothing to do.
 */
export function FormBands({
  io,
  bands,
  ticketTypes,
  onSend,
  onOpenClient,
  onTicket,
  onChanged,
}: {
  io: FormsIO | null;
  bands: ReturnType<typeof useFormBands>;
  ticketTypes: Set<string> | null;
  onSend: (taskId: string, name: string, preset: SendPreset) => void;
  onOpenClient: (taskId: string) => void;
  onTicket: (t: {
    type: string;
    taskId: string;
    name: string;
    details: string;
  }) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Set<string>>(new Set());
  const all = (bands.invites.rows ?? []).filter(
    r => !done.has(`${r.kind}:${r.inviteId ?? r.taskId}`),
  );
  const of = (k: TodayRow["kind"]) => all.filter(r => r.kind === k);
  const low = (bands.low.rows ?? []).filter(
    r => !done.has(`low:${r.responseId}`),
  );
  const key = (r: TodayRow) => `${r.kind}:${r.inviteId ?? r.taskId}`;
  const run = async (k: string, fn: () => Promise<void>) => {
    setBusy(k);
    setErrors(e => {
      const { [k]: _gone, ...rest } = e;
      return rest;
    });
    try {
      await fn();
      setDone(d => new Set(d).add(k));
      onChanged();
    } catch (e) {
      setErrors(x => ({ ...x, [k]: said(e) }));
    } finally {
      setBusy(null);
    }
  };
  const err = (k: string) =>
    errors[k] ? (
      <p className="basis-full text-xs txt-bad" role="alert">
        {errors[k]}
      </p>
    ) : null;
  return (
    <div className="space-y-4" data-form-bands>
      {[bands.invites.error, bands.low.error].filter(Boolean).map(e => (
        <p key={String(e)} className="text-xs txt-bad" role="alert">
          The client forms could not be read, so a row may be missing: {e}
        </p>
      ))}
      <Band title="Forms sent today" rows={of("sent_today").length}>
        {of("sent_today").map(r => (
          <BandLine
            key={key(r)}
            line={todayRowText(r)}
            full={todayLine(r)}
            name={r.clientName}
          />
        ))}
      </Band>
      <Band title="WhatsApp links to approve" rows={of("approve_link").length}>
        {of("approve_link").map(r => (
          <BandLine
            key={key(r)}
            line={todayRowText(r)}
            full={todayLine(r)}
            name={r.clientName}
            actions={
              <>
                <Button
                  size="sm"
                  disabled={!r.messageId || busy !== null}
                  onClick={() =>
                    void run(key(r), async () => {
                      if (!io || !r.messageId) return;
                      const body = await io.messageBody(r.messageId);
                      const out = await io.approve({
                        messageId: r.messageId,
                        body,
                      });
                      if (out.needsConfirm)
                        throw new Error(
                          `${out.warnings.join(" ")} Open the client, then approve it in Forms out.`,
                        );
                      toast.success(APPROVED);
                    })
                  }
                >
                  {busy === key(r) ? "Approving…" : "Approve and send"}
                </Button>
                {err(key(r))}
              </>
            }
          />
        ))}
      </Band>
      <Band title="Not answered" rows={of("not_answered").length}>
        {of("not_answered").map(r => (
          <BandLine
            key={key(r)}
            line={todayRowText(r)}
            full={todayLine(r)}
            name={r.clientName}
            actions={
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null || !r.inviteId}
                  onClick={() =>
                    void run(key(r), async () => {
                      if (!io || !r.inviteId) return;
                      await io.withdraw(
                        r.taskId,
                        r.inviteId,
                        SENT_AGAIN_REASON,
                      );
                      onSend(r.taskId, r.clientName, { formKey: r.formKey });
                    })
                  }
                >
                  Send again
                </Button>
                {err(key(r))}
              </>
            }
          />
        ))}
      </Band>
      <Band title="Answered" rows={of("answered").length}>
        {of("answered").map(r => (
          <BandLine
            key={key(r)}
            line={todayRowText(r)}
            full={todayLine(r)}
            name={r.clientName}
            actions={
              // The answer opens from the client's Forms out, beside its delivery line.
              <Button
                size="sm"
                variant="outline"
                onClick={() => onOpenClient(r.taskId)}
              >
                Read the answer
              </Button>
            }
          />
        ))}
      </Band>
      <Band title="Exit surveys to send" rows={of("exit_survey_due").length}>
        {of("exit_survey_due").map(r => (
          <BandLine
            key={key(r)}
            line={todayRowText(r)}
            full={todayLine(r)}
            name={r.clientName}
            actions={
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onSend(r.taskId, r.clientName, {
                    formKey: "exit_survey",
                    origin: "churn",
                  })
                }
              >
                Send exit survey
              </Button>
            }
          />
        ))}
      </Band>
      <Band title="Low scores" rows={low.length}>
        {low.map(r => (
          <BandLine
            key={r.responseId}
            line={lowScoreRowText(r)}
            full={lowScoreLine(r)}
            name={r.clientName}
            actions={
              <>
                {ticketTypes?.has("client_low_score") && !r.ticketOpen ? (
                  <Button
                    size="sm"
                    onClick={() =>
                      onTicket({
                        type: "client_low_score",
                        taskId: r.taskId,
                        name: r.clientName,
                        details: lowScoreDetails(r),
                      })
                    }
                  >
                    Open the low-score ticket
                  </Button>
                ) : null}
                {r.ticketOpen ? (
                  <span className="text-xs text-muted-foreground">
                    The low-score ticket is open.
                  </span>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onOpenClient(r.taskId)}
                >
                  Open the client
                </Button>
              </>
            }
          />
        ))}
      </Band>
    </div>
  );
}

// --- The pause sheet's consent row (4.3.6, 5.2) --------------------------------------------------

/**
 * The client's consent inside Pause this client, for a client request once
 * the pause consent form is live: the state line in 5.2's words, the start
 * day (today to 14 days on), and Send the pause consent, which issues the
 * invite with the sheet's restart, reason and call (origin `pause`). Drawn
 * with FormSheet's own classes, so it reads as one of the sheet's rows.
 */
export function PauseConsentRow({
  io,
  taskId,
  consent,
  answers,
  today,
  onSent,
}: {
  io: FormsIO | null;
  taskId: string;
  consent: PauseConsent | null;
  answers: Record<string, unknown>;
  /** The Kuwait day, "YYYY-MM-DD". */
  today: string;
  onSent: () => void;
}) {
  const requestId = useRef(newRequestId());
  const [start, setStart] = useState(today);
  const [busy, setBusy] = useState<"send" | "approve" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{
    messageId: string | null;
    approved: boolean;
  } | null>(null);
  const state = consent?.state ?? "none";
  const restart = typeof answers.restart === "string" ? answers.restart : "";
  const last = addDaysIso(today, 14);
  const send = async () => {
    if (!io || busy) return;
    if (!restart)
      return setError("Pick the restart date first, then send the consent.");
    if (start < today || start > last)
      return setError("The pause starts today or within 14 days.");
    if (restart <= start)
      return setError("Pick the restart day, after the start.");
    setBusy("send");
    setError(null);
    try {
      const view = await io.view(taskId);
      const form = view.forms.find(f => f.key === "pause_consent") ?? null;
      const out = await io.issue({
        taskId,
        formKey: "pause_consent",
        channels: defaultChannels(
          view,
          form ?? { audience: "admin", defaultChannels: [] },
          Date.now(),
        ),
        note: null,
        lang: "ar",
        push: true,
        context: {
          start,
          restart,
          reasonCat:
            typeof answers.reasonCat === "string" ? answers.reasonCat : null,
          callId: typeof answers.callId === "string" ? answers.callId : null,
        },
        requestId: requestId.current,
        origin: "pause",
      });
      toast.success(sendToast(out.delivered));
      setSent({ messageId: out.messageId, approved: false });
      requestId.current = newRequestId();
      onSent();
    } catch (e) {
      setError(
        isNetworkError(e)
          ? "Not sent. Check your connection and press Send the pause consent again."
          : said(e),
      );
    } finally {
      setBusy(null);
    }
  };
  const approve = async () => {
    if (!io || !sent?.messageId || busy) return;
    setBusy("approve");
    setError(null);
    try {
      const body = await io.messageBody(sent.messageId);
      const out = await io.approve({ messageId: sent.messageId, body });
      if (out.needsConfirm)
        throw new Error(
          `${out.warnings.join(" ")} Open the client's Forms out to check the text.`,
        );
      toast.success(APPROVED);
      setSent({ ...sent, approved: true });
    } catch (e) {
      setError(said(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="fs-field fs-consent" data-consent data-state={state}>
      <div className="fs-consent-head">
        <span>Client consent</span>
        {consent?.start || consent?.restart ? (
          <span className="fs-consent-dates">
            {kuwaitDayWords(consent.start) || "start not set"} →{" "}
            {kuwaitDayWords(consent.restart) || "restart not set"}
          </span>
        ) : null}
      </div>
      <p className="fs-consent-line" data-consent-line>
        {consentLine(consent)}
      </p>
      {state !== "signed" ? (
        <div className="fs-consent-row">
          <label className="fs-label" htmlFor="consent-start">
            Pause starts
            <input
              id="consent-start"
              type="date"
              className="fs-input"
              min={today}
              max={last}
              value={start}
              onChange={e => setStart(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="fs-btn"
            data-tone="primary"
            data-send-consent
            disabled={busy !== null}
            onClick={() => void send()}
          >
            {busy === "send"
              ? "Sending…"
              : state === "none"
                ? "Send the pause consent"
                : "Send a new consent"}
          </button>
        </div>
      ) : null}
      {sent?.messageId ? (
        <div className="fs-consent-row">
          <span className="fs-note">
            {sent.approved ? APPROVED : WAITS_FOR_APPROVAL}
          </span>
          {sent.approved ? null : (
            <button
              type="button"
              className="fs-btn fs-btn-quiet"
              disabled={busy !== null}
              onClick={() => void approve()}
            >
              {busy === "approve" ? "Approving…" : "Approve and send"}
            </button>
          )}
        </div>
      ) : null}
      {error ? (
        <p className="fs-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Forms with no Copy a link: admin-only or signed (cockpit_form_invite_link refuses them). */
const COPYLESS = new Set(["pause_consent", "exit_survey"]);

function addDaysIso(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
