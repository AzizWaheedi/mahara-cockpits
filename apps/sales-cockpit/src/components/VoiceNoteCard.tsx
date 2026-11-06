import { Check, Copy, MessageCircle, Mic } from "lucide-react";
import { Fragment, useMemo, useRef, useState } from "react";
import { api, uncertain } from "../lib/api";
import { useNow } from "../lib/data";
import type { VoiceNote } from "../lib/dialer";
import { clock, isArabic } from "../lib/format";
import { clockCountry, leadClock } from "../lib/leadClock";
import { toast } from "../lib/toast";
import {
  type FactKey,
  lengthWords,
  notKnownLine,
  toldUs,
  VOICE_MAX_S,
  type VoiceLang,
  voiceScript,
} from "../lib/voiceNote";
import { waBlocked, waDigits } from "../lib/zoomLink";
import { button, buttonPrimary, Segmented } from "./kit";

/**
 * The voice note after a call nobody answered (Aziz, 2026-11-05: "a
 * personalized voice note from the setter's phone ... a guide with context
 * on what they filled in on their form. That would be huge."). A cue card,
 * not a form:
 * - one breath per line, numbered because they are said in order;
 * - the form's facts underlined in teal, so the rep sees what is personal
 *   and says it in their own words instead of reading;
 * - a 30-second ruler with the 20 to 30 second band marked.
 *
 * Open WhatsApp opens the lead's chat in the rep's own WhatsApp (wa.me) and
 * sends nothing. I sent the voice note records it (sales-api dial.touch,
 * audited), and the queue moves on.
 */

const FACT_TITLE: Record<FactKey, string> = {
  first_name: "Their name, from the form",
  company: "Their company, from the form",
  country: "Where they are, from the form",
  challenge: "Their challenge, from the form",
  call: "Their booked call, on their clock",
};

const STEP_LINE: Record<VoiceNote["step"], string> = {
  new: "Nobody picked up. Record this on WhatsApp in your own words.",
  booked:
    "They booked a call but did not pick up now. Record this on WhatsApp in your own words.",
  confirm:
    "The confirmation call rang out. Record this on WhatsApp in your own words.",
};

export function VoiceNoteCard({
  facts,
  lead,
  contactId,
  appointmentId,
  rep,
  lang: firstLang,
  secondTryAt = null,
  primary = true,
  startOpen = true,
  onEngage,
  onSent,
}: {
  facts: VoiceNote;
  /** The lead as the cockpit has it: the number, do not disturb, the country's clock. */
  lead: {
    phone?: string | null;
    dnd?: boolean | null;
    country?: string | null;
  } | null;
  contactId: string;
  /** The call a confirmation note is about, recorded with it. */
  appointmentId: string | null;
  /** The rep's own name, when sales-api sent none. */
  rep: string | null;
  lang: VoiceLang;
  /** The burst's second try, two minutes after the first no-answer. */
  secondTryAt?: string | null;
  /** This card holds the pane's teal button. */
  primary?: boolean;
  /** Folded to one line at first (the second try comes before the note). */
  startOpen?: boolean;
  /** The rep is working on this note: the queue must not swap the lead out. */
  onEngage?: () => void;
  /** Recorded: the queue moves on. */
  onSent: () => void;
}) {
  const [lang, setLang] = useState<VoiceLang>(firstLang);
  const [open, setOpen] = useState(startOpen);
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [doubt, setDoubt] = useState<string | null>(null);
  // One id for every press of this note, so a retry is the same record.
  const requestId = useRef<string | null>(null);
  const zone = leadClock(clockCountry(lead?.country, lead?.phone));
  const script = useMemo(
    () => voiceScript(facts, lang, { now: Date.now(), clock: zone, rep }),
    [facts, lang, zone, rep],
  );
  const told = useMemo(() => toldUs(facts), [facts]);
  const gaps = notKnownLine(facts);
  const blocked = lead ? waBlocked(lead) : "Reading the lead's number…";
  const digits = lead ? waDigits(lead.phone) : null;
  const ar = lang === "ar";

  async function copy() {
    onEngage?.();
    try {
      await navigator.clipboard.writeText(script.text);
      toast.success("Script copied.");
    } catch {
      toast.error("The browser would not copy. Select the script instead.");
    }
  }

  async function sent() {
    if (busy) return;
    setBusy(true);
    setDoubt(null);
    requestId.current ??= crypto.randomUUID();
    try {
      const out = await api<{ repeated?: boolean }>("dial.touch", {
        contact_id: contactId,
        kind: "voice_note",
        step: facts.step,
        appointment_id: appointmentId,
        request_id: requestId.current,
      });
      toast.success(
        out.repeated
          ? "Voice note recorded already. Next lead is up."
          : "Voice note recorded. Next lead is up.",
      );
      onSent();
    } catch (e) {
      if (uncertain(e))
        setDoubt(
          "No clear answer came back, so it may be recorded already. Press again: it is kept only once.",
        );
      else toast.error(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[var(--radius-md)] border hairline px-3 py-2 text-sm">
        <Mic className="size-3.5 txt-now" aria-hidden />
        <span className="min-w-0 flex-1">Voice note not sent yet.</span>
        <button
          type="button"
          onClick={() => {
            onEngage?.();
            setOpen(true);
          }}
          className="text-xs font-medium underline underline-offset-2"
        >
          Show the script
        </button>
      </div>
    );

  return (
    <section
      aria-label="Voice note"
      className="space-y-3 rounded-[var(--radius-lg)] border p-3.5 sm:p-4"
      style={{
        borderColor: "color-mix(in oklch, var(--now) 38%, var(--border))",
        background: "color-mix(in oklch, var(--now) 5%, transparent)",
      }}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-[1_1_12rem]">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Mic className="size-4 txt-now" aria-hidden />
            Voice note from your phone
          </p>
          <p className="muted mt-0.5 text-xs">
            {STEP_LINE[facts.step]} The underlined parts are from their form.
          </p>
        </div>
        <Segmented
          label="Language of the note"
          value={lang}
          options={[
            [
              "ar",
              <span key="ar" className="ar">
                عربي
              </span>,
            ],
            ["en", "English"],
          ]}
          onChange={v => {
            onEngage?.();
            setLang(v === "en" ? "en" : "ar");
          }}
        />
      </header>

      {secondTryAt ? <SecondTry at={secondTryAt} /> : null}

      <ol
        dir={ar ? "rtl" : "ltr"}
        lang={ar ? "ar" : "en"}
        className={`space-y-1.5 ${ar ? "ar text-[16px] leading-[1.9]" : "text-[15px] leading-[1.65]"}`}
      >
        {script.lines.map((line, i) => (
          <li
            // A line's place is its identity: the script is rebuilt whole.
            key={i}
            className="grid grid-cols-[1.1rem_minmax(0,1fr)] gap-2"
          >
            <span
              aria-hidden
              className="muted pt-[0.3em] text-end font-mono text-[11px] leading-none"
            >
              {i + 1}
            </span>
            <span>
              {line.map((p, j) =>
                p.fact ? (
                  <span
                    key={j}
                    className="cue-fact"
                    title={FACT_TITLE[p.fact]}
                    dir="auto"
                  >
                    {p.text}
                  </span>
                ) : (
                  <Fragment key={j}>{p.text}</Fragment>
                ),
              )}
            </span>
          </li>
        ))}
      </ol>

      <Ruler seconds={script.seconds} />

      {told.length ? (
        <div className="space-y-1.5 border-t hairline pt-3">
          <p className="text-xs font-semibold">What they told us</p>
          <dl className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-x-3 gap-y-1">
            {told.map(l => (
              <Fragment key={l.key}>
                <dt className="muted pt-0.5 text-xs">{l.label}</dt>
                <dd
                  dir="auto"
                  className={`min-w-0 text-sm break-words ${isArabic(l.value) ? "ar" : ""}`}
                >
                  {l.value}
                </dd>
              </Fragment>
            ))}
          </dl>
        </div>
      ) : (
        <p className="muted border-t hairline pt-3 text-xs">
          Their form told us nothing to add, so the note keeps to who you are
          and how to call back.
        </p>
      )}
      {gaps ? <p className="muted text-xs">{gaps}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        {digits && !blocked ? (
          <a
            href={`https://wa.me/${digits}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              onEngage?.();
              setOpened(true);
            }}
            className={primary && !opened ? buttonPrimary : button}
            title="Opens their chat in your own WhatsApp. Nothing is sent from here."
          >
            <MessageCircle className="size-3.5" aria-hidden />
            Open WhatsApp
          </a>
        ) : null}
        <button type="button" onClick={copy} className={button}>
          <Copy className="size-3.5" aria-hidden />
          Copy script
        </button>
        <button
          type="button"
          onClick={() => void sent()}
          disabled={busy || Boolean(lead?.dnd)}
          className={
            primary && (opened || !digits || Boolean(blocked))
              ? buttonPrimary
              : button
          }
        >
          <Check className="size-3.5" aria-hidden />
          {busy ? "Recording…" : "I sent the voice note"}
        </button>
      </div>
      {blocked ? <p className="muted text-xs">{blocked}</p> : null}
      {doubt ? (
        <p
          role="status"
          className="callout-warn rounded-[var(--radius-md)] border px-3 py-2 text-xs"
        >
          {doubt}
        </p>
      ) : null}
    </section>
  );
}

/** Thirty ticks, one a second, filled to the script's length; the 20 to 30 band marked. */
function Ruler({ seconds }: { seconds: number }) {
  const long = seconds > VOICE_MAX_S;
  return (
    <div className="space-y-1">
      <div className="cue-ruler" data-long={long} aria-hidden>
        {Array.from({ length: VOICE_MAX_S }, (_, i) => (
          <span key={i} data-on={i < seconds} data-band={i >= 19} />
        ))}
      </div>
      <p className="muted flex flex-wrap justify-between gap-x-3 text-[11px]">
        <span className={long ? "txt-warn" : undefined}>
          {lengthWords(seconds)}
        </span>
        <span>Aim for 20 to 30 seconds</span>
      </p>
    </div>
  );
}

/** "Second try at 14:05, in 1:42", ticking; "Second try now" once it is due. */
function SecondTry({ at }: { at: string }) {
  const now = useNow(1000);
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return null;
  const left = Math.max(0, Math.ceil((t - now) / 1000));
  return (
    <p className="text-xs">
      {left > 0 ? (
        <>
          Second try at {clock(at)}, in{" "}
          <span className="font-mono font-semibold tabular-nums">
            {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
          </span>
          . Send the note now; the dialer brings them back for the call.
        </>
      ) : (
        <>
          <span className="font-semibold txt-now">Second try now.</span> Send
          the note, then call them from the queue.
        </>
      )}
    </p>
  );
}
