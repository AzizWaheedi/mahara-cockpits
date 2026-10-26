import type { WidgetOptions } from "@typeform/embed";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import type {
  Already,
  FormConfig,
  FormContext,
  FormNews,
  FormSend,
  RailPart,
  SendInput,
} from "./formConfig";
import { sendNotice, type Trail, trailFor } from "./formStatus";
import { formLink, hiddenSha256, type Prefill, sameHidden } from "./prefill";

/**
 * The form panel's state and its one embed, without a layout (KICKOFF.md
 * 2): the guard, the hidden object frozen at open, the widget, the one note
 * per response, the checks after a send and the trail. FormPanel draws it
 * as the kickoff window's two columns; the onboarding deck's last slide
 * draws the same state on its canvas and in the notes window. Nothing here
 * names a form: every form-specific word is the config's.
 */

export type Widget = { unmount: () => void };
export type CreateWidget = (formId: string, options: WidgetOptions) => Widget;

/** Typeform's SDK and its stylesheet, loaded only when a form opens. */
export async function loadTypeform(): Promise<CreateWidget> {
  const [sdk] = await Promise.all([
    import("@typeform/embed"),
    import("@typeform/embed/build/css/widget.css"),
  ]);
  return sdk.createWidget;
}

export interface FormIO {
  /** Notes one response (cockpit_csm_form_sent). Safe to repeat. */
  record(input: SendInput): Promise<FormSend>;
  /** Re-reads the card (the one-card refresh), the call store and the sends. */
  check(): Promise<void>;
  /** Re-reads the call store only (the recording). */
  recheck(): Promise<void>;
  /**
   * Re-reads this card's Slack notices only, while the trail's Slack stop
   * waits. Absent where the screen does not read the notices.
   */
  notices?(): Promise<void>;
  /** Tells the cockpit's own tab. */
  announce?(news: FormNews): void;
}

export type FormPhase = "held" | "open" | "started" | "sent";

/** A response this panel sent: its submit's clock, and how its note went. */
export interface SentState {
  responseId: string;
  at: string;
  send: FormSend | null;
  error: string | null;
  busy: boolean;
}

/** The server's clock now, from its clock at the last read. */
export const serverNow = (ctx: Pick<FormContext, "now" | "readAt">) =>
  Date.parse(ctx.now) + Math.max(0, Date.now() - ctx.readAt);

/** The Slack stop's re-read: every minute, for 25 minutes after the send. */
const NOTICE_EVERY_MS = 60_000;
const NOTICE_WATCH_MS = 25 * 60_000;

export const message = (e: unknown) =>
  String((e as Error)?.message ?? e ?? "").trim() || "No reason was given.";

export interface FormPanelInput {
  config: FormConfig;
  ctx: FormContext;
  io: FormIO;
  clientName: string;
  rehearse?: boolean;
  /** Typeform's SDK; the harness and the tests pass a stand-in. */
  embed?: () => Promise<CreateWidget>;
  onPhase?: (phase: FormPhase) => void;
  /** A press that took the form's submit (the sent response's clock). */
  onSent?: (at: string) => void;
}

export interface FormPanelModel {
  /** A response already on record, decided once when the panel opened. */
  already: Already | null;
  /** The form waits behind the guard. */
  held: boolean;
  /** "Open a second … anyway". */
  release: () => void;
  prefill: Prefill;
  /** The record changed under the open form: Reload uses it. */
  changed: boolean;
  phase: FormPhase;
  ready: boolean;
  /** Not loaded after 20 s, or the SDK failed. */
  slow: boolean;
  started: boolean;
  /** A rehearsal reached Typeform's sandbox submit. */
  rehearsed: boolean;
  sent: SentState | null;
  checking: boolean;
  checkedAt: string | null;
  checkError: string | null;
  /** The ending's button was pressed: the booking opens on its own. */
  autoBook: boolean;
  bookConsumed: () => void;
  /** The element the widget mounts in. */
  box: RefObject<HTMLDivElement | null>;
  runCheck: () => Promise<void>;
  /** Notes the sent response again, after a failed note. */
  retry: () => void;
  /** Builds the hidden object again and mounts a fresh form. */
  reload: (confirmed?: boolean) => void;
  /** The same form and values, in Typeform. */
  fallback: string;
  parts: RailPart[];
  trail: Trail | null;
}

export function useFormPanel({
  config,
  ctx,
  io,
  clientName,
  rehearse = false,
  embed = loadTypeform,
  onPhase,
  onSent,
}: FormPanelInput): FormPanelModel {
  // The guard is decided once, when the window opens: after this window's
  // own send, the record will show a kickoff, and that is not a reason to
  // hold the form again.
  const [already] = useState<Already | null>(() => config.already(ctx));
  const [released, setReleased] = useState(false);
  const held = Boolean(already) && !released;

  const [prefill, setPrefill] = useState<Prefill>(() => config.hidden(ctx));
  const [mount, setMount] = useState(0);
  const prefillRef = useRef(prefill);
  prefillRef.current = prefill;
  const current = useMemo(() => config.hidden(ctx), [config, ctx]);

  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);
  const [started, setStarted] = useState(false);
  const [rehearsed, setRehearsed] = useState(false);
  const [sent, setSent] = useState<SentState | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [autoBook, setAutoBook] = useState(false);
  const [, setTick] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const noted = useRef(new Set<string>());

  const changed = !sent && !held && !sameHidden(current.values, prefill.values);
  const phase: FormPhase = held
    ? "held"
    : sent
      ? "sent"
      : started
        ? "started"
        : "open";
  const phaseRef = useRef(onPhase);
  phaseRef.current = onPhase;
  useEffect(() => {
    phaseRef.current?.(phase);
  }, [phase]);
  const sentRef = useRef(onSent);
  sentRef.current = onSent;

  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const runCheck = useCallback(async () => {
    setChecking(true);
    try {
      await io.check();
      setCheckedAt(new Date(serverNow(ctxRef.current)).toISOString());
      setCheckError(null);
      io.announce?.({
        type: "checked",
        taskId: ctxRef.current.taskId,
        form: config.key,
      });
    } catch (e) {
      setCheckError(message(e));
    } finally {
      setChecking(false);
    }
  }, [io, config.key]);

  const note = useCallback(
    async (responseId: string, at: string) => {
      setSent({ responseId, at, send: null, error: null, busy: true });
      try {
        const p = prefillRef.current;
        const send = await io.record({
          taskId: ctxRef.current.taskId,
          formKey: config.key,
          responseId,
          hiddenKeys: Object.keys(p.values),
          hiddenSha256: await hiddenSha256(p.values),
          carriedId: p.values[config.idField] ?? "",
        });
        // The trail keeps the submit's own clock: a retry is noted later,
        // and Make's change to the card comes seconds after the submit.
        setSent({ responseId, at, send, error: null, busy: false });
        // The cockpit tab read the sends when "sent" arrived, before this
        // note landed: it reads them again now, so its header and Onboarding
        // panel show the send without waiting for the first check.
        io.announce?.({
          type: "noted",
          taskId: ctxRef.current.taskId,
          form: config.key,
        });
      } catch (e) {
        setSent({ responseId, at, send: null, error: message(e), busy: false });
      }
    },
    [io, config.key, config.idField],
  );

  const handlers = useRef({
    started: () => {},
    submit: (_responseId: string) => {},
    ending: () => {},
  });
  handlers.current = {
    started: () => setStarted(true),
    submit: responseId => {
      setStarted(false);
      // A rehearsal is Typeform's sandbox: nothing to note, nothing ran.
      if (rehearse || responseId === "__sandbox" || !responseId) {
        setRehearsed(true);
        return;
      }
      // Typeform says it once; a repeat never notes or schedules twice.
      if (noted.current.has(responseId)) return;
      noted.current.add(responseId);
      const at = new Date(serverNow(ctxRef.current)).toISOString();
      void note(responseId, at);
      sentRef.current?.(at);
      io.announce?.({
        type: "sent",
        taskId: ctxRef.current.taskId,
        form: config.key,
        clientName,
        say: `${config.title} sent for ${clientName}. ${config.after.say.replace(/^[^.]*\.\s*/, "")}`,
      });
      for (const t of timers.current) window.clearTimeout(t);
      timers.current = config.after.checksAtSec.map(sec =>
        window.setTimeout(() => void runCheck(), sec * 1000),
      );
    },
    ending: () => {
      // In Typeform's sandbox nothing was sent, so nothing is booked from it.
      if (rehearse) {
        toast("Rehearsal: the booking stays closed.");
        return;
      }
      if (config.ending) setAutoBook(true);
    },
  };

  useEffect(
    () => () => {
      for (const t of timers.current) window.clearTimeout(t);
    },
    [],
  );

  // A half-filled form asks before the window closes.
  useEffect(() => {
    if (!started) return;
    const ask = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [started]);

  // The trail's clock moves on its own after a send.
  useEffect(() => {
    if (!sent) return;
    const t = window.setInterval(() => setTick(n => n + 1), 15_000);
    return () => window.clearInterval(t);
  }, [sent]);

  // The widget: mounted when the form is let open, and again only on Reload.
  const titleRef = useRef(`${config.title} form for ${clientName}`);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the widget mounts once per Reload; reads and callbacks go through refs
  useEffect(() => {
    if (held || !box.current) return;
    let live = true;
    let w: Widget | null = null;
    setReady(false);
    setSlow(false);
    const slowTimer = window.setTimeout(() => live && setSlow(true), 20_000);
    embed()
      .then(create => {
        if (!live || !box.current) return;
        const options: WidgetOptions = {
          container: box.current,
          hidden: prefillRef.current.values,
          inlineOnMobile: true,
          medium: "mahara-client-success",
          // The ending's redirect would otherwise take the whole window away.
          redirectTarget: "_blank",
          iframeProps: { title: titleRef.current },
          onReady: () => {
            if (live) setReady(true);
          },
          onStarted: () => handlers.current.started(),
          onSubmit: e => handlers.current.submit(e.responseId),
        };
        if (rehearse) options.enableSandbox = true;
        if (config.ending)
          options.onEndingButtonClick = () => handlers.current.ending();
        w = create(config.formId, options);
      })
      .catch(() => {
        if (live) setSlow(true);
      });
    return () => {
      live = false;
      window.clearTimeout(slowTimer);
      w?.unmount();
    };
  }, [held, mount, config.formId, rehearse]);

  const reload = (confirmed = false) => {
    if (
      started &&
      !confirmed &&
      !window.confirm("Reload the form? What was typed is lost.")
    )
      return;
    setPrefill(config.hidden(ctxRef.current));
    setStarted(false);
    setMount(m => m + 1);
  };

  const fallback = formLink(config.formId, prefill.values);
  const parts = useMemo(
    () => config.rail(ctx, prefill),
    [config, ctx, prefill],
  );

  const slackRead = sent ? sendNotice(config, ctx, sent.responseId) : undefined;
  const trail = sent
    ? trailFor(
        config,
        ctx,
        { responseId: sent.responseId, sentAt: sent.at, noted: !sent.error },
        serverNow(ctx),
        slackRead,
      )
    : null;

  // "Kickoff complete" posts only once the sender has read Make's Kickoff
  // Handoff comment and the mirror shows the card done, so the card stops
  // can no longer be behind: when it posts and this window's copy of the
  // card still waits (the timed checks ended at 5 minutes), read the card
  // once, so the trail never says "Make is late" beside a complete notice.
  const completeId =
    slackRead?.notice?.state === "posted" &&
    slackRead.notice.variant === "complete"
      ? slackRead.notice.id
      : null;
  const cardBehind = Boolean(
    trail?.stops.some(s => (s.key === "card" || s.key === "link") && !s.done),
  );
  const caughtUp = useRef<string | null>(null);
  useEffect(() => {
    if (!completeId || !cardBehind || caughtUp.current === completeId) return;
    caughtUp.current = completeId;
    void runCheck();
  }, [completeId, cardBehind, runCheck]);

  // While the Slack stop waits, or its last read failed, and this window is
  // in view, the notices are read again every minute, for the 25 minutes a
  // kickoff notice can take (Make's update, or 20 minutes, then the sender's
  // next minute). One failed read never ends the watch.
  const slackWaits = Boolean(
    trail?.stops.some(s => s.key === "slack" && !s.done && !s.problem),
  );
  const readNotices = io.notices;
  const sentAt = sent?.at ?? null;
  useEffect(() => {
    if (!slackWaits || !readNotices || !sentAt) return;
    const until = Date.parse(sentAt) + NOTICE_WATCH_MS;
    const t = window.setInterval(() => {
      if (serverNow(ctxRef.current) > until) {
        window.clearInterval(t);
        return;
      }
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      )
        return;
      void readNotices().catch(() => {});
    }, NOTICE_EVERY_MS);
    return () => window.clearInterval(t);
  }, [slackWaits, readNotices, sentAt]);

  return {
    already,
    held,
    release: () => setReleased(true),
    prefill,
    changed,
    phase,
    ready,
    slow,
    started,
    rehearsed,
    sent,
    checking,
    checkedAt,
    checkError,
    autoBook,
    bookConsumed: () => setAutoBook(false),
    box,
    runCheck,
    retry: () => {
      if (sent) void note(sent.responseId, sent.at);
    },
    reload,
    fallback,
    parts,
    trail,
  };
}
