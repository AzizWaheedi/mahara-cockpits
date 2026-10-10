import { Check, Copy, ExternalLink, MessageCircle, Video } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { isClient } from "../lib/clients";
import { useQuery, useSetting } from "../lib/data";
import { supabase } from "../lib/supabase";
import type { Lead, Me } from "../lib/types";
import {
  clockTime,
  firstName,
  type Lang,
  REUSE_MS,
  repName,
  waBlocked,
  waDigits,
  waLink,
  zoomMessage,
} from "../lib/zoomLink";
import { button, buttonPrimary, Segmented } from "./kit";
import { Dialog, DialogClose, DialogContent } from "./ui/dialog";

/**
 * "Zoom link" (2026-10-10, the CEO: "is there any reason we can't create the
 * Zoom call straight away?"). One press makes the meeting in about two
 * seconds (sales-api zoom.link) and opens a card with the link, the message
 * in the lead's language, and the rep's own WhatsApp one tap away. Nothing
 * goes to the lead by itself.
 *
 * It sits in the dialer's action row, in the step after a missed call, and
 * in the lead page's and the guided call's headers. It draws nothing while
 * the zoom_links switch is off (as the room menu does), and nothing for an
 * active client.
 *
 * Design: the cockpit's own kit (Geist, teal primary). The one signature is
 * the message drawn as the lead will read it, in a bubble set in its own
 * language and direction; the one motion is the teal pulse while the
 * meeting is made, the timer chip's.
 */

/** 44 px on touch, over the touch rule in index.css (outside the layers). */
const TOUCH = "pointer-coarse:min-h-11!";

export interface ZoomLinkView {
  id: string;
  join_url: string;
  kind: "intro" | "demo";
  host: "own" | "shared";
  host_name: string;
  made_at: string;
}

export interface ZoomLinkAnswer {
  link: ZoomLinkView;
  reused: boolean;
  warning: string | null;
  rep: { name: string; name_ar: string | null };
}

/** This seat's newest link of this kind for the lead (seat read), to label the button. */
function useLatestLink(
  contactId: string,
  seat: string | undefined,
  kind: "intro" | "demo",
  on: boolean,
) {
  return useQuery<{ made_at: string } | null>(
    () =>
      on && seat
        ? supabase
            .from("cockpit_sales_zoom_links")
            .select("made_at")
            .eq("contact_id", contactId)
            .eq("seat_email", seat)
            .eq("call_kind", kind)
            .is("deleted_at", null)
            .order("made_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    [contactId, seat, kind, on],
  );
}

export type Phase =
  | { at: "making" }
  | { at: "ready"; answer: ZoomLinkAnswer }
  | { at: "failed"; error: string };

export function ZoomLinkButton({
  lead,
  me,
  kind,
  label = "Zoom link",
  className = button,
  lang: leadLang,
}: {
  lead: Lead;
  me: Me;
  kind: "intro" | "demo";
  label?: string;
  className?: string;
  /** The lead's language from their own messages; Arabic when not known. */
  lang?: Lang;
}) {
  const setting = useSetting<{ enabled?: unknown }>("zoom_links");
  const on = setting.data?.enabled === true;
  const latest = useLatestLink(lead.contact_id, me.email, kind, on);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ at: "making" });
  const inFlight = useRef(false);

  const make = useCallback(
    async (fresh: boolean) => {
      // A second press while the first is on its way does nothing: one
      // press, one meeting.
      if (inFlight.current) return;
      inFlight.current = true;
      setPhase({ at: "making" });
      try {
        const answer = await api<ZoomLinkAnswer>("zoom.link", {
          contact_id: lead.contact_id,
          kind,
          ...(fresh ? { fresh: true } : {}),
        });
        if (!answer?.link?.join_url)
          throw new Error(
            "The server's answer had no link in it. Try again in a minute.",
          );
        setPhase({ at: "ready", answer });
        latest.reload();
      } catch (e) {
        setPhase({ at: "failed", error: String((e as Error)?.message ?? e) });
      } finally {
        inFlight.current = false;
      }
    },
    [lead.contact_id, kind, latest.reload],
  );

  if (!on || isClient(lead)) return null;

  const madeAt = latest.data?.made_at;
  const fresh =
    madeAt && Date.now() - Date.parse(madeAt) < REUSE_MS
      ? clockTime(madeAt)
      : "";

  return (
    <>
      <button
        type="button"
        className={`${className} ${TOUCH}`}
        onClick={() => {
          setOpen(true);
          void make(false);
        }}
        title="Make a Zoom meeting now and send its link from your own WhatsApp."
      >
        <Video className="size-3.5" aria-hidden />
        {label}
        {fresh ? (
          <span className="font-mono text-xs tabular-nums opacity-70">
            · {fresh}
          </span>
        ) : null}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="relative max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogClose onClick={() => setOpen(false)} />
          <ZoomLinkCard
            lead={lead}
            phase={phase}
            initialLang={leadLang ?? "ar"}
            onFresh={() => void make(true)}
            onRetry={() => void make(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Copy, then "Copied" for two seconds. */
function useCopied() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef(0);
  const copy = async (what: string, text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(null), 2000);
      return true;
    } catch {
      setCopied(`${what}:failed`);
      return false;
    }
  };
  return { copied, copy };
}

/** Tells sales-api how the link went out; the screen never waits on it. */
function markShared(
  id: string,
  how: "whatsapp" | "copy_message" | "copy_link",
) {
  api("zoom.link.shared", { id, how }).catch(() => undefined);
}

export function ZoomLinkCard({
  lead,
  phase,
  initialLang,
  onFresh,
  onRetry,
}: {
  lead: Pick<Lead, "name" | "phone" | "dnd">;
  phase: Phase;
  initialLang: Lang;
  onFresh: () => void;
  onRetry: () => void;
}) {
  const [lang, setLang] = useState<Lang>(initialLang);
  // The lead's language is known once their messages are read: follow it.
  useEffect(() => setLang(initialLang), [initialLang]);
  const { copied, copy } = useCopied();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const first = firstName(lead.name);
  const them = first || "them";
  const answer = phase.at === "ready" ? phase.answer : null;
  const link = answer?.link ?? null;
  const message = link
    ? zoomMessage(lang, {
        first,
        rep: repName(lang, answer?.rep ?? { name: null }),
        link: link.join_url,
      })
    : "";
  const blocked = waBlocked(lead);
  const digits = waDigits(lead.phone);

  const start = async () => {
    if (!link || starting) return;
    setStarting(true);
    setStartError(null);
    // Opened inside the press, so the browser lets it open; filled once
    // Zoom gives a fresh start link.
    const w = window.open("", "_blank");
    try {
      const out = await api<{ start_url: string }>("zoom.start", {
        id: link.id,
      });
      if (w) {
        w.opener = null;
        w.location.href = out.start_url;
      } else window.location.assign(out.start_url);
    } catch (e) {
      w?.close();
      setStartError(String((e as Error)?.message ?? e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1 pe-10">
        <h2 className="text-base font-semibold tracking-tight">
          Zoom link for <bdi>{first || "this lead"}</bdi>
        </h2>
        <p className="muted text-sm">
          Nothing goes to <bdi>{them}</bdi> until you send it.
        </p>
      </div>

      {phase.at === "failed" ? (
        <div className="space-y-2">
          <p
            role="alert"
            className="callout-bad rounded-[var(--radius-md)] border px-3 py-2 text-sm"
          >
            {phase.error}
          </p>
          <button
            type="button"
            className={`${button} ${TOUCH}`}
            onClick={onRetry}
          >
            Try again
          </button>
        </div>
      ) : null}

      {/* The link, or the meeting being made. */}
      {phase.at === "making" ? (
        <div
          className="flex h-11 items-center gap-2.5 rounded-[14px] border border-teal-500/30 bg-teal-500/10 px-3.5 font-mono text-sm text-teal-200"
          role="status"
          aria-live="polite"
        >
          <span className="relative flex size-2.5" aria-hidden>
            <span className="absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75 motion-safe:animate-ping" />
            <span className="relative inline-flex size-2.5 rounded-full bg-teal-500 shadow-[0_0_8px_#00cfc8]" />
          </span>
          Making the meeting…
        </div>
      ) : link ? (
        <div className="flex items-center gap-2">
          <a
            href={link.join_url}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 flex-1 truncate rounded-[14px] border border-white/10 bg-[color:var(--background)] px-3.5 py-2.5 font-mono text-[13px] tabular-nums hover:border-white/20"
            dir="ltr"
            title={link.join_url}
          >
            {link.join_url}
          </a>
          <button
            type="button"
            className={`${button} ${TOUCH} shrink-0`}
            onClick={async () => {
              if (await copy("link", link.join_url))
                markShared(link.id, "copy_link");
            }}
          >
            {copied === "link" ? (
              <Check className="size-3.5" aria-hidden />
            ) : (
              <Copy className="size-3.5" aria-hidden />
            )}
            {copied === "link" ? "Copied" : "Copy the link"}
          </button>
        </div>
      ) : null}

      {link ? (
        <>
          {/* The message, as the lead will read it. */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="muted text-xs">The message</p>
              <Segmented
                label="The message's language"
                value={lang}
                options={[
                  ["ar", "عربي"],
                  ["en", "English"],
                ]}
                onChange={v => setLang(v as Lang)}
              />
            </div>
            <div
              className={
                lang === "ar" ? "flex justify-start" : "flex justify-end"
              }
              dir={lang === "ar" ? "rtl" : "ltr"}
            >
              <p
                dir={lang === "ar" ? "rtl" : "ltr"}
                lang={lang}
                className={`max-w-[34rem] whitespace-pre-wrap break-words rounded-2xl rounded-tr-md border border-teal-500/25 bg-[color:color-mix(in_oklch,var(--primary)_10%,var(--card))] px-3.5 py-2.5 text-[15px] leading-relaxed ${
                  lang === "ar" ? "ar" : ""
                }`}
              >
                {message}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {blocked ? null : (
                <a
                  href={digits ? waLink(digits, message) : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${buttonPrimary} ${TOUCH}`}
                  onClick={() => markShared(link.id, "whatsapp")}
                >
                  <MessageCircle className="size-3.5" aria-hidden />
                  Send on WhatsApp
                </a>
              )}
              <button
                type="button"
                className={`${blocked ? buttonPrimary : button} ${TOUCH}`}
                onClick={async () => {
                  if (await copy("message", message))
                    markShared(link.id, "copy_message");
                }}
              >
                {copied === "message" ? (
                  <Check className="size-3.5" aria-hidden />
                ) : (
                  <Copy className="size-3.5" aria-hidden />
                )}
                {copied === "message" ? "Copied" : "Copy the message"}
              </button>
            </div>
            {blocked ? <p className="muted text-xs">{blocked}</p> : null}
            {copied?.endsWith(":failed") ? (
              <p className="muted text-xs">
                The browser would not copy. Select the text instead.
              </p>
            ) : null}
          </div>

          {/* Who hosts it, and how the rep gets in. */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t hairline pt-3">
            <p className="min-w-0 flex-[1_1_16rem] text-sm">
              {link.host === "shared" ? (
                <>
                  Shared Zoom: you and <bdi>{them}</bdi> join with this link.
                  Nobody needs to start it.
                </>
              ) : (
                <>You host it. They wait until you start.</>
              )}
            </p>
            {link.host === "shared" ? (
              <a
                href={link.join_url}
                target="_blank"
                rel="noopener noreferrer"
                className={`${button} ${TOUCH}`}
              >
                <ExternalLink className="size-3.5" aria-hidden />
                Join the call
              </a>
            ) : (
              <button
                type="button"
                className={`${button} ${TOUCH}`}
                disabled={starting}
                onClick={() => void start()}
              >
                <ExternalLink className="size-3.5" aria-hidden />
                {starting ? "Starting…" : "Start the meeting"}
              </button>
            )}
          </div>
          {startError ? (
            <p
              role="alert"
              className="callout-bad rounded-[var(--radius-md)] border px-3 py-2 text-sm"
            >
              {startError}
            </p>
          ) : null}
          {answer?.warning ? (
            <p className="callout-warn rounded-[var(--radius-md)] border px-3 py-2 text-sm">
              {answer.warning}
            </p>
          ) : null}

          <div className="muted flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span>
              Made at{" "}
              <span className="font-mono tabular-nums">
                {clockTime(link.made_at)}
              </span>
              . Pressing again gives this same link for 12 hours.
            </span>
            <button
              type="button"
              className="underline-offset-2 hover:text-[color:var(--foreground)] hover:underline"
              onClick={onFresh}
            >
              Make a new link
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
