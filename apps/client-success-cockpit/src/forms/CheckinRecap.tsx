import { ChevronRight, RefreshCw } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Dot, Kicker, LINK_INK } from "@/components/kit";
import { Button } from "@/components/ui/button";
import {
  MESSAGES_FAILED,
  type MessagesIO,
  messagesHref,
} from "@/lib/clientMessages";
import { cn } from "@/lib/utils";
import { FOCUS, NOTES_FONT } from "./CheckinFields";
import type { DraftView, EffectView } from "./checkinClient";
import type { CallAnswer } from "./checkinForm";
import {
  messageKey,
  type PollClock,
  RecapApproval,
  stateLine,
  useRecapMessage,
} from "./RecapApproval";
import { stillWriting } from "./useCheckin";

/**
 * The recap step (docs/forms/STAGE2-CONTRACT.md 8.5; in 2a a preview only):
 * the recap is drafted after the notes are sent, from the They owe that was
 * sent, so the step polls for it and shows what the cockpit would send to
 * the client's WhatsApp group. Approving a client message is a different
 * decision from writing internal notes, so it is a step of its own. Make
 * still sends the recaps until the switch-over: nothing is sent from here.
 *
 * In a live response (docs/forms/STAGE2B-CONTRACT.md 4.15 item 1, 5.1) the
 * step says the recap is approved here or on the client's Messages card,
 * and once the recap effect's owner is the cockpit and its message row
 * exists, the step is the shared RecapApproval for that row (Z46: the
 * registry and the row decide, not a flag of the window's own).
 */

/** Make [23]'s check-in block, appended by the cockpit after every recap (6.5). */
export const BOOKING_BLOCK = [
  "إذا ما حجزت مكالمة المتابعة لين الحين، تقدر تحجزها من هنا:",
  "https://api.leadconnectorhq.com/widget/booking/SHjlq0UjeR11maltYNyh",
  "عادة نخلي أسبوع تقريبًا بين مكالمات المتابعة، عشان يكون فيه تقدم واضح نستعرضه معك.",
].join("\n");

const AFTER_SEND = "The recap is drafted after you send the notes.";
/** The step's waiting line, also its live region's first words. */
export const DRAFTING = "Drafting the recap from the notes you sent…";
/** What the step's live region says when the preview arrives (8.5). */
export const RECAP_READY_LINE = "The recap is ready.";
/** 8.5's line for a recap the model found nothing worth sending for. */
export const NOTHING_TO_SEND = "Nothing worth sending from this call.";
/** The step's header until the switch-over, and in every shadow run. */
export const MAKE_SENDS =
  "Make still sends 1-1 recaps until the switch-over, so this one is not sent from here.";
/** The step's header in a live response (4.15 item 1). */
export const LIVE_HEADER =
  "Approve the recap here or on the client's Messages card. The client gets it only after someone approves it.";
/** Between the recap draft turning ready and its message row appearing. */
export const GETTING_READY = "Getting the recap ready to approve…";
/** The row still has not come when the step stops asking, after 15 minutes. */
export const NOT_READY_YET =
  "The recap has not reached this window after 15 minutes. Look on the client's Messages card; if it is not there, tell the tech lead.";
/**
 * The dispatch's sentence for a ready recap it cannot make a message from
 * (STAGE2B-CONTRACT.md 3.5): the step says it as soon as it reads the
 * draft, and offers Draft again.
 */
export const RECAP_UNUSABLE =
  "The recap draft is empty or over 4,096 characters. Draft it again.";
/**
 * After 24 hours from the send the dispatch no longer makes a failed
 * recap's message from a new draft (Z28), so the step stops offering Draft
 * again and says what is left.
 */
export const RECAP_TOO_LATE =
  "The send was over 24 hours ago, so the cockpit no longer makes this recap. Send it by hand in the group if it is still needed.";
const REQUEUE_MS = 24 * 60 * 60_000;

/**
 * 3.5: the dispatch makes the message from the draft's stored text only
 * while it is 1 to 4,096 characters (Postgres counts characters, as the
 * spread here does); it never cuts it.
 */
export function fitsMessage(d: DraftView): boolean {
  const t = d.output?.text;
  return typeof t === "string" && t !== "" && [...t].length <= 4096;
}

/** A reason without its closing "Draft again.", for a step that no longer offers it. */
const withoutAgain = (s: string) =>
  s.replace(/\s*Draft (it )?again\.\s*$/, "").trim();

/**
 * The recap's text as it would go: the stored text byte for byte (A7.4: the
 * message plus the booking block, what recap check 14 compares), else the
 * message with the block appended here.
 */
export function recapText(d: DraftView): string | null {
  const o = d.output ?? {};
  if (typeof o.text === "string" && o.text.trim()) return o.text;
  const msg = typeof o.message === "string" ? o.message.trim() : "";
  if (!msg) return null;
  return msg.includes(BOOKING_BLOCK) ? msg : `${msg}\n\n${BOOKING_BLOCK}`;
}

export function CheckinRecap({
  recap,
  call,
  effect,
  onDraftAgain,
  asking = false,
  error = null,
  refused = false,
  live = false,
  messages = null,
  taskId = "",
  responseId = null,
  sentAt = null,
  clock,
}: {
  recap: DraftView | null;
  /** The call the notes were sent for. */
  call: CallAnswer | null;
  /** The plan's recap effect, whose skip reason says why there is none. */
  effect: EffectView | null;
  /**
   * Asks for the recap again after it failed (checkin.draftAgain, kind
   * recap, 6.2): every recap refusal ends "Draft again.", so the step
   * offers it. Left out, the failed recap shows its reason only.
   */
  onDraftAgain?: () => void;
  /** Draft again is on its way: the button spins and does nothing more. */
  asking?: boolean;
  /** Draft again refused or not reached: the server's sentence. */
  error?: string | null;
  /**
   * The server refused Draft again (five drafts): the button stays where
   * focus is, said unavailable with the refusal as its description.
   */
  refused?: boolean;
  /** The sent response is live (`mode === 'live'`), not a shadow run. */
  live?: boolean;
  /** The message reads and the approval, for a live response's recap. */
  messages?: MessagesIO | null;
  taskId?: string;
  responseId?: string | null;
  /** When the notes were sent: a failed recap is made again only for 24 hours (Z28). */
  sentAt?: string | null;
  /** The window's clock, for the message reads and the 24 hours; the browser's when left out. */
  clock?: PollClock;
}) {
  const errorId = useId();
  // The cockpit sends this recap: the registry gives its effect to the
  // cockpit and the response is live. Then the step approves the message.
  const approving = live && effect?.owner === "cockpit";
  // A new recap draft (Draft again, or a late one) starts the message
  // reads again: the dispatch makes the row from it within the minute.
  const row = useRecapMessage(messages, taskId, responseId, approving, {
    clock,
    kick: recap ? `${recap.attempt}:${recap.state}:${recap.at}` : "",
  });
  // An action's sentence, kept only while the row still reads as the
  // action left it: once the step's poll moves it on (approved to sent,
  // read back), the region says the row's own line again.
  const [said, setSaid] = useState<{ text: string; key: string } | null>(null);
  const acted = useRef<string | null>(null);
  const stepRef = useRef<HTMLElement>(null);
  const now = (clock ?? Date).now();
  // The step's one live region (8.1, 8.5): mounted for the whole step, so
  // the recap's outcome is said when it arrives (the waiting line used to
  // be the region and went with it). Where the outcome is one sentence, the
  // region is that visible line; beside the preview or the failed row it is
  // a short sr-only line, and the row's own words are hidden from screen
  // readers, so nothing is read twice.
  let status: string;
  let statusShown = true;
  let body: ReactNode = null;
  // Draft again is on the screen: when it goes (a new draft is on its
  // way), focus moves to the step instead of falling to the page.
  let offered = false;
  // The live header tells her to approve. Once the row is decided, or no
  // recap is coming, it would say something no longer true, so it goes and
  // the state line speaks alone.
  let approvalAhead = true;
  const wait = recap?.state === "skipped" ? stillWriting(recap.reason) : null;
  const message = approving ? row.message : null;
  const sentMs = Date.parse(sentAt ?? "");
  // Z28: the dispatch makes a failed recap's message from a newer ready
  // draft for 24 hours after the send, and not after.
  const late =
    approving && Number.isFinite(sentMs) && now - sentMs >= REQUEUE_MS;
  const effectFailed = effect?.state === "failed";
  const effectReason = effect?.reason?.trim() || null;
  // The effect's sentence is about the draft the dispatch read. A draft
  // made after the failure (Draft again) is followed instead.
  const draftMs = Date.parse(recap?.at ?? "");
  const effectMs = Date.parse(effect?.at ?? "");
  const redrafted =
    effectFailed &&
    Number.isFinite(draftMs) &&
    Number.isFinite(effectMs) &&
    draftMs > effectMs;
  const effectSaid =
    approving &&
    !message &&
    !redrafted &&
    (effectFailed || effect?.state === "skipped") &&
    effectReason
      ? effectReason
      : null;
  const recapReady =
    recap?.state === "ready" && Boolean(recapText(recap) ?? null);
  // A ready recap the dispatch cannot use (3.5): said as soon as the step
  // reads it, while the effect waits (planned) or has failed, because no
  // message will come from it. Draft again makes one that can be used.
  const unusable =
    approving &&
    !message &&
    (effect?.state === "planned" || effectFailed) &&
    recap?.state === "ready" &&
    !fitsMessage(recap);
  const canAgain = Boolean(onDraftAgain) && call?.kind === "fathom" && !late;
  /** The reason with its dot, and Draft again beside it when it can help. */
  const againRow = (line: string, offer: boolean) => {
    offered = offer;
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p aria-hidden className="flex min-w-0 flex-1 basis-64 gap-2 text-sm">
          <span className="flex h-5 shrink-0 items-center">
            <Dot tone="warn" />
          </span>
          <span className="min-w-0">{line}</span>
        </p>
        {offer && onDraftAgain ? (
          <Button
            size="sm"
            variant="outline"
            // Still focusable while it asks, and after a refusal, so focus
            // stays on it; a refusal is its description.
            aria-disabled={asking || refused || undefined}
            aria-describedby={refused && error ? errorId : undefined}
            className={cn(FOCUS, "aria-disabled:opacity-50")}
            onClick={() => {
              if (!asking && !refused) onDraftAgain();
            }}
          >
            <RefreshCw
              aria-hidden
              className={cn(asking && "motion-safe:animate-spin")}
            />
            Draft again
          </Button>
        ) : null}
      </div>
    );
  };
  const messagesLink = (
    <a
      href={messagesHref(taskId)}
      target="_blank"
      rel="noreferrer"
      className={cn(
        LINK_INK,
        "inline-flex items-center gap-1 rounded-sm text-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-ink",
      )}
    >
      Open the Messages card
      <ChevronRight aria-hidden className="size-4" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
  if (message) {
    approvalAhead =
      message.state === "draft" ||
      message.state === "refused" ||
      message.state === "failed";
    // The step is the approval: its line is the row's own, said once here
    // (the step's one live region) whenever an action changes it.
    status =
      said && said.key === messageKey(message) ? said.text : stateLine(message);
    statusShown = false;
    body = (
      <RecapApproval
        message={message}
        io={messages as MessagesIO}
        onChange={next => {
          acted.current = messageKey(next);
          row.put(next);
        }}
        announce={text => {
          // Bound to the row as the action left it (its answer, or the row
          // as it stands when an action changed nothing, like warnings).
          setSaid({ text, key: acted.current ?? messageKey(message) });
          acted.current = null;
        }}
        lead={false}
        extra={messagesLink}
      />
    );
  } else if (late && (effectFailed || unusable)) {
    // Past the 24 hours nothing will make this recap's message: say why
    // there is none and what is left, with no Draft again to press.
    approvalAhead = false;
    const why = withoutAgain(
      (unusable ? RECAP_UNUSABLE : effectReason) ?? RECAP_UNUSABLE,
    );
    status = why ? `${why} ${RECAP_TOO_LATE}` : RECAP_TOO_LATE;
    statusShown = false;
    body = againRow(status, false);
  } else if (unusable) {
    status = RECAP_UNUSABLE;
    statusShown = false;
    body = againRow(status, canAgain);
  } else if (effectSaid && recap?.state !== "failed") {
    // The dispatch could not make the message (no draft in time, Make owns
    // it again): its own sentence. A failed effect whose draft can still
    // be made again offers Draft again; the dispatch picks the new draft
    // up (Z28). A failed draft keeps its own row below.
    const offer =
      effectFailed &&
      canAgain &&
      (!recap || recap.state === "drafting" || recap.state === "ready");
    status = effectSaid;
    approvalAhead = offer;
    if (offer) {
      statusShown = false;
      body = againRow(status, true);
    }
  } else if (approving && recapReady) {
    if (row.failed) status = MESSAGES_FAILED;
    else if (row.stopped) {
      status = NOT_READY_YET;
      body = messagesLink;
    } else status = GETTING_READY;
  } else if (call?.kind !== "fathom") {
    approvalAhead = false;
    status =
      effect?.state === "skipped" && effect.reason
        ? effect.reason
        : "No recap: no recording for this call.";
  } else if (
    !recap ||
    recap.state === "drafting" ||
    (recap.state === "skipped" && recap.reason === AFTER_SEND)
  )
    status = DRAFTING;
  else if (recap.state === "off") {
    approvalAhead = false;
    status = "AI drafts are off: no Anthropic key.";
  } else if (recap.state === "failed") {
    approvalAhead = !late;
    const reason = recap.reason?.trim() || "The recap draft failed.";
    // A live recap past the 24 hours: a new draft would make no message.
    status = late ? `${withoutAgain(reason)} ${RECAP_TOO_LATE}` : reason;
    statusShown = false;
    body = againRow(status, !late && Boolean(onDraftAgain));
  } else if (wait)
    // Fathom has not finished the summary or the transcript yet: the step
    // keeps asking, so this is a wait in the server's words, not a verdict.
    status = wait;
  else if (recap.state === "skipped") {
    // The model's own skip reads as 8.5's line; any other reason (not a
    // client call, not in the cockpit) is the server's sentence.
    approvalAhead = false;
    status = recap.reason?.trim() || NOTHING_TO_SEND;
  } else {
    const text = recapText(recap);
    approvalAhead = Boolean(text);
    status = text ? RECAP_READY_LINE : NOTHING_TO_SEND;
    statusShown = !text;
    body = text ? (
      <div className="space-y-2">
        <p className="text-sm">
          This is what the cockpit would send to the client's WhatsApp group.
        </p>
        <div
          dir="rtl"
          lang="ar"
          style={NOTES_FONT}
          className="whitespace-pre-wrap break-words rounded-xl bg-muted/40 p-4 text-[15px] leading-[1.7]"
        >
          <bdi dir="auto">{text}</bdi>
        </div>
        <p className="text-xs text-muted-foreground">
          Written by the cockpit in Kuwaiti Arabic.
        </p>
      </div>
    ) : null;
  }
  // Draft again worked: its button went with the reason it answered, so
  // focus moves to the step (whose status line says the recap is being
  // drafted) instead of falling to the page.
  const wasOffered = useRef(offered);
  useEffect(() => {
    const before = wasOffered.current;
    wasOffered.current = offered;
    if (!before || offered) return;
    const a = document.activeElement;
    if (!a || a === document.body || !a.isConnected) stepRef.current?.focus();
  }, [offered]);
  return (
    <section
      ref={stepRef}
      tabIndex={-1}
      className="space-y-3 rounded-md outline-none"
      aria-label="The recap for the client"
    >
      <Kicker as="h2">The recap</Kicker>
      {live && effect?.owner !== "make" ? (
        approvalAhead ? (
          <p className="text-sm text-muted-foreground">{LIVE_HEADER}</p>
        ) : null
      ) : (
        <p className="text-sm text-muted-foreground">{MAKE_SENDS}</p>
      )}
      <p
        role="status"
        aria-live="polite"
        className={statusShown ? "text-sm text-muted-foreground" : "sr-only"}
      >
        {status}
      </p>
      {body}
      {error ? (
        <p className="flex gap-2 text-xs" role="alert">
          <span className="flex h-4 shrink-0 items-center">
            <Dot tone="bad" />
          </span>
          <span id={errorId} className="min-w-0">
            {error}
          </span>
        </p>
      ) : null}
    </section>
  );
}
