import { RefreshCw } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { Dot, Kicker } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FOCUS, NOTES_FONT } from "./CheckinFields";
import type { DraftView, EffectView } from "./checkinClient";
import type { CallAnswer } from "./checkinForm";
import { stillWriting } from "./useCheckin";

/**
 * The recap step (docs/forms/STAGE2-CONTRACT.md 8.5; in 2a a preview only):
 * the recap is drafted after the notes are sent, from the They owe that was
 * sent, so the step polls for it and shows what the cockpit would send to
 * the client's WhatsApp group. Approving a client message is a different
 * decision from writing internal notes, so it is a step of its own. Make
 * still sends the recaps until the switch-over: nothing is sent from here.
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
}) {
  const errorId = useId();
  // Draft again worked: its button goes with the failed recap, so focus
  // moves to the step (whose status line says the recap is being drafted)
  // instead of falling to the page.
  const stepRef = useRef<HTMLElement>(null);
  const failed = call?.kind === "fathom" && recap?.state === "failed";
  const wasFailed = useRef(failed);
  useEffect(() => {
    const before = wasFailed.current;
    wasFailed.current = failed;
    if (!before || failed) return;
    const a = document.activeElement;
    if (!a || a === document.body || !a.isConnected) stepRef.current?.focus();
  }, [failed]);
  // The step's one live region (8.1, 8.5): mounted for the whole step, so
  // the recap's outcome is said when it arrives (the waiting line used to
  // be the region and went with it). Where the outcome is one sentence, the
  // region is that visible line; beside the preview or the failed row it is
  // a short sr-only line, and the row's own words are hidden from screen
  // readers, so nothing is read twice.
  let status: string;
  let statusShown = true;
  let body: React.ReactNode = null;
  const wait = recap?.state === "skipped" ? stillWriting(recap.reason) : null;
  if (call?.kind !== "fathom")
    status =
      effect?.state === "skipped" && effect.reason
        ? effect.reason
        : "No recap: no recording for this call.";
  else if (
    !recap ||
    recap.state === "drafting" ||
    (recap.state === "skipped" && recap.reason === AFTER_SEND)
  )
    status = DRAFTING;
  else if (recap.state === "off")
    status = "AI drafts are off: no Anthropic key.";
  else if (recap.state === "failed") {
    status = recap.reason?.trim() || "The recap draft failed.";
    statusShown = false;
    body = (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p aria-hidden className="flex min-w-0 flex-1 basis-64 gap-2 text-sm">
          <span className="flex h-5 shrink-0 items-center">
            <Dot tone="warn" />
          </span>
          <span className="min-w-0">{status}</span>
        </p>
        {onDraftAgain ? (
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
  } else if (wait)
    // Fathom has not finished the summary or the transcript yet: the step
    // keeps asking, so this is a wait in the server's words, not a verdict.
    status = wait;
  else if (recap.state === "skipped")
    // The model's own skip reads as 8.5's line; any other reason (not a
    // client call, not in the cockpit) is the server's sentence.
    status = recap.reason?.trim() || NOTHING_TO_SEND;
  else {
    const text = recapText(recap);
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
  return (
    <section
      ref={stepRef}
      tabIndex={-1}
      className="space-y-3 rounded-md outline-none"
      aria-label="The recap for the client"
    >
      <Kicker as="h2">The recap</Kicker>
      <p className="text-sm text-muted-foreground">
        Make still sends 1-1 recaps until the switch-over, so this one is not
        sent from here.
      </p>
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
