import { CalendarPlus, Check, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Conflicts,
  FieldEditor,
  OpenDoc,
  PartsBar,
  PressButton,
  partState,
  QuestionField,
  said,
} from "./BlueprintFields";
import * as B from "./blueprintBrief";
import {
  type BpKey,
  type BpPart,
  FIELDS,
  has,
  labelOf,
  partAnswers,
  QUESTIONS,
  type Question,
  questionOf,
  required,
  shown,
} from "./blueprintForm";
import { kickoffFacts } from "./blueprintPrefill";
import type { DeckData } from "./deckData";
import { openNamed } from "./PresentButton";
import type { BpModel } from "./useBlueprint";

/**
 * The notes window's Brand Blueprint section (docs/brand-blueprint/SPEC.md
 * 5.1), one place per answer (plan of 26 Oct 2026): the client's answers
 * are tapped on the slide and read here as text; part 1 is set in prep and
 * reads here as one line; three taps stay in the notes ("Do on this
 * slide"); the optional notes and Close the call wait for the wrap-up after
 * the call. Prep keeps every editor. Nothing here is ever on the shared
 * canvas.
 */

/** The only boxes left in the notes during the call, by slide. */
export const CALL_TAPS: Partial<Record<string, BpKey[]>> = {
  "one-service": ["capacity"],
  content: ["shot_list"],
  "read-back": ["readback_yes"],
};
/** Part 1's own settings, confirmed in prep; one line on the call. */
const PART1_PREP: BpKey[] = [
  "pack_url",
  "daily_budget",
  "destination",
  "identity",
];
/** The optional notes, after the call. */
export const WRAP_KEYS: BpKey[] = [
  "margin",
  "content_rating",
  "events",
  "csm_signals",
  "anything_else",
];

/** The GHL booking page for the launch call (SPEC 5.3, slide 14). */
export const LAUNCH_BOOKING =
  "https://api.leadconnectorhq.com/widget/booking/5E1EVxLJbGiDM3iYl2kL";

/** The questions answered on or beside a slide, private ones first. */
export function questionsFor(slideId: string) {
  const here = QUESTIONS.filter(q =>
    q.where.some(
      w =>
        ("notes" in w && w.notes === slideId) ||
        ("slide" in w && w.slide === slideId),
    ),
  );
  return [...here.filter(q => !q.client), ...here.filter(q => q.client)];
}

/** The brief the launch task gets, built as the server will build it. */
export function briefPreview(
  bp: BpModel,
  d: DeckData,
  presenter: string | null,
) {
  const k = kickoffFacts({ kickoff: d.kickoff.entry });
  const p1 = bp.parts["1"];
  const payload: B.BlueprintPayload = {
    v: 1,
    part: 1,
    press: (p1?.presses ?? 0) + 1,
    card: { id: d.taskId, name: d.nameEn },
    answers: partAnswers(1, bp.answers),
    previous: p1?.sent ?? null,
    launchTaskId: bp.launchTaskId,
    sentAt: bp.now().toISOString(),
    sentBy: presenter,
    links: {
      driveFolder: bp.docs.driveUrl,
      brandDna: bp.docs.brandDnaUrl,
      offerSheet: bp.docs.offerUrl,
      research: bp.docs.research,
    },
    kickoff: k,
  };
  return p1
    ? B.launchUpdate(payload)
    : B.launchBrief(payload, {
        assigned: Boolean(bp.bundle?.settings.assignee),
      });
}

/** The pack the slide shows: the record's link, else Settings' for the service. */
const packUrl = (bp: BpModel): string | null => {
  const v = bp.answers.pack_url ?? bp.prefill.values.pack_url?.value;
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

const asked = (keys: BpKey[]) =>
  keys.map(k => questionOf(k)).filter((q): q is Question => Boolean(q));

/** A tap: a tick is its own label; anything else keeps its question line. */
function Tap({ bp, q }: { bp: BpModel; q: Question }) {
  if (!q.key || !shown(q, bp.answers)) return null;
  return (FIELDS[q.key] as { type: string }).type === "ticks" ? (
    <FieldEditor bp={bp} k={q.key} />
  ) : (
    <QuestionField bp={bp} q={q} />
  );
}

/** Part 1 as set in prep: one line, Change for the call's late edits. */
function Part1Line({ bp, change }: { bp: BpModel; change: boolean }) {
  const [open, setOpen] = useState(false);
  const qs = asked(PART1_PREP).filter(q => shown(q, bp.answers));
  const missing = qs.filter(
    q => q.key && required(q, bp.answers) && !has(bp.answers, q.key),
  );
  const service = has(bp.answers, "service")
    ? said("service", bp.answers.service)
    : null;
  const words = qs
    .filter(q => q.key && has(bp.answers, q.key))
    .map(q =>
      q.key === "pack_url"
        ? `${service ? `${service} ` : ""}pack`
        : said(q.key as BpKey, bp.answers[q.key as BpKey]),
    );
  const editing = open ? qs : change ? missing : [];
  return (
    <div className="space-y-2 rounded-xl bg-muted/40 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Part 1, set in prep
        </span>
        {change && !bp.readOnly ? (
          <button
            type="button"
            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
            onClick={() => setOpen(o => !o)}
          >
            {open ? "Done" : "Change"}
          </button>
        ) : null}
      </div>
      {words.length ? (
        <div className="text-sm" dir="auto">
          {words.join(" · ")}
        </div>
      ) : null}
      {missing.length && !open ? (
        <div className="text-xs txt-warn">
          Not set in prep:{" "}
          {missing.map(q => labelOf(q.key as BpKey)).join(", ")}.
          {change ? " Add it here." : " It is asked on slide 5."}
        </div>
      ) : null}
      {editing.length ? (
        <div className="space-y-3 border-t pt-3">
          {editing.map(q => (
            <QuestionField key={q.n} bp={bp} q={q} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The client's answers on this slide, read here; they are tapped on the slide. */
function SlideAnswers({ bp, slideId }: { bp: BpModel; slideId: string }) {
  const qs = QUESTIONS.filter(
    q =>
      q.key &&
      q.client &&
      q.where.some(w => "slide" in w && w.slide === slideId) &&
      shown(q, bp.answers),
  );
  if (!qs.length) return null;
  return (
    <section className="space-y-2 border-t pt-3">
      <h3 className="text-xs font-medium text-muted-foreground">
        On the slide · tap them there, with the client
      </h3>
      <dl className="divide-y divide-border/60 rounded-xl bg-muted/40">
        {qs.map(q => {
          const k = q.key as BpKey;
          const got = has(bp.answers, k);
          const need = required(q, bp.answers);
          return (
            <div key={q.n} className="flex items-start gap-3 px-3 py-2">
              <dt className="w-[42%] shrink-0 text-xs text-muted-foreground">
                {q.label}
              </dt>
              <dd
                className={cn(
                  "flex min-w-0 flex-1 items-start gap-1.5 text-xs",
                  !got && (need ? "txt-warn" : "text-muted-foreground"),
                )}
                dir="auto"
              >
                {got ? (
                  <Check
                    aria-hidden
                    className="mt-0.5 size-3.5 shrink-0 txt-good"
                  />
                ) : null}
                <span className="line-clamp-3">
                  {got ? said(k, bp.answers[k]) : need ? "Needed" : "Not yet"}
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

/** One prep answer, read on the call ("Brand DNA status: small gaps"). */
function FromPrep({ bp, k }: { bp: BpModel; k: BpKey }) {
  const got = has(bp.answers, k);
  return (
    <div className="rounded-xl bg-muted/40 px-3 py-2 text-xs">
      <div className="text-muted-foreground">{labelOf(k)}, from prep</div>
      <div
        className={cn("mt-0.5 text-sm", !got && "text-xs txt-warn")}
        dir="auto"
      >
        {got ? said(k, bp.answers[k]) : "Not set in prep."}
      </div>
    </div>
  );
}

/**
 * The one card that asks for a hand on this slide: a tap, Send to media,
 * or the launch booking. Above the talk track, with the teal glow.
 */
export function BlueprintDoHere({
  bp,
  d,
  slideId,
  reload,
  onWrap,
}: {
  bp: BpModel | null | undefined;
  d: DeckData;
  slideId: string;
  reload: () => Promise<void>;
  onWrap: () => void;
}) {
  if (!bp || bp.readOnly) return null;
  const taps = asked(CALL_TAPS[slideId] ?? []);
  const part1 = slideId === "first-ads";
  const last = slideId === "next";
  if (!taps.length && !part1 && !last) return null;
  const s1 = partState(bp, 1, d.timeZone);
  return (
    <section
      aria-label="Do on this slide"
      className="glow-teal space-y-3 rounded-2xl border border-primary/40 bg-card p-4"
    >
      <div className="font-mono text-[11px] uppercase tracking-wider text-primary">
        Do on this slide
      </div>
      {taps.map(q => (
        <Tap key={q.n} bp={bp} q={q} />
      ))}
      {part1 ? (
        <>
          <Part1Line bp={bp} change />
          <div className="flex items-center justify-between gap-3">
            <div
              className={cn(
                "text-xs",
                s1.tone === "good"
                  ? "txt-good"
                  : s1.tone === "warn" || s1.tone === "bad"
                    ? "txt-warn"
                    : "text-muted-foreground",
              )}
              role="status"
            >
              {s1.text}
            </div>
            <PressButton bp={bp} part={1} />
          </div>
        </>
      ) : null}
      {last ? (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                openNamed(LAUNCH_BOOKING, `mahara-book-launch-${d.taskId}`)
              }
            >
              <CalendarPlus aria-hidden />
              Book the launch call
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void reload()}>
              <RefreshCw aria-hidden />
              Check the booking
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            {d.next.launch
              ? `Booked: ${new Date(d.next.launch).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: d.timeZone })}.`
              : "Share the booking page's window and book it with them."}
          </div>
          <div className="flex items-center justify-between gap-3 border-t pt-3">
            <span className="text-xs text-muted-foreground">
              Then hang up. The wrap-up opens when the deck window closes.
            </span>
            <Button size="sm" variant="outline" onClick={onWrap}>
              Wrap up now
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}

/** After the call: the optional notes, then Close the call (part 2). */
export function BlueprintWrapUp({
  bp,
  d,
  onBack,
}: {
  bp: BpModel | null | undefined;
  d: DeckData;
  /** Back to the slides, while the deck window is still open. */
  onBack?: () => void;
}) {
  if (!bp) return null;
  const s2 = partState(bp, 2, d.timeZone);
  return (
    <section className="space-y-4 rounded-2xl border bg-card p-4">
      <div className="space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-semibold">Wrap up the call</h2>
          {onBack ? (
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              onClick={onBack}
            >
              Back to the slides
            </button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Five notes for the team, all optional. Then Close the call sends part
          2.
        </p>
      </div>
      {asked(WRAP_KEYS).map(q => (
        <QuestionField key={q.n} bp={bp} q={q} />
      ))}
      <div className="flex items-center justify-between gap-3 border-t pt-3">
        <div
          className={cn(
            "text-xs",
            s2.tone === "good"
              ? "txt-good"
              : s2.tone === "muted"
                ? "text-muted-foreground"
                : "txt-warn",
          )}
          role="status"
        >
          {s2.text}
          {d.next.launch ? null : (
            <span className="block txt-warn">
              The launch call is not booked yet.
            </span>
          )}
        </div>
        <PressButton bp={bp} part={2} />
      </div>
    </section>
  );
}

export function BlueprintNotes({
  bp,
  d,
  slideId,
  reload,
  inPrep = false,
}: {
  bp: BpModel | null | undefined;
  d: DeckData;
  slideId: string;
  /** Read the deck again (the booking, after the launch call is booked). */
  reload: () => Promise<void>;
  /** Prep's slide list: every editor and press, as before the call. */
  inPrep?: boolean;
}) {
  const brief = useMemo(
    () =>
      bp && slideId === "first-ads" ? briefPreview(bp, d, d.csmFirst) : null,
    [bp, d, slideId],
  );
  if (!bp)
    return (
      <div className="text-xs text-muted-foreground">
        The Brand Blueprint is not read yet.
      </div>
    );
  const press: BpPart[] = !inPrep
    ? []
    : slideId === "first-ads"
      ? [1]
      : slideId === "next"
        ? [2]
        : [];
  const qs = inPrep ? questionsFor(slideId) : [];
  return (
    <div className="space-y-4">
      {bp.readOnly ? (
        <div className="rounded-lg border px-3 py-2 text-xs text-muted-foreground">
          Only the creative director sends the parts. You can read every answer
          here.
        </div>
      ) : null}
      <Conflicts bp={bp} />

      {bp.prefill.notes.length ? (
        <ul className="space-y-1 text-xs txt-warn">
          {bp.prefill.notes.map(n => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}

      {!inPrep && slideId === "so-far" ? (
        <Part1Line bp={bp} change={false} />
      ) : null}
      {!inPrep && slideId === "brand" ? (
        <FromPrep bp={bp} k="dna_status" />
      ) : null}
      {!inPrep && slideId === "offer" ? <FromPrep bp={bp} k="offer" /> : null}
      {!inPrep ? <SlideAnswers bp={bp} slideId={slideId} /> : null}

      {qs.length ? (
        <section className="space-y-3 border-t pt-3">
          <h3 className="text-xs font-medium text-muted-foreground">
            On this slide
          </h3>
          {qs.map(q => (
            <QuestionField key={q.n} bp={bp} q={q} />
          ))}
        </section>
      ) : null}

      {slideId === "offer" ? (
        <section className="space-y-2 border-t pt-3">
          <h3 className="text-xs font-medium text-muted-foreground">
            The offer sheet
          </h3>
          <OpenDoc url={bp.docs.offerUrl} name={`mahara-offer-${d.taskId}`}>
            Share the offer sheet
          </OpenDoc>
          {bp.prefill.firstStep ? (
            <div className="text-xs text-muted-foreground" dir="auto">
              A first step they already offer: {bp.prefill.firstStep}
            </div>
          ) : null}
        </section>
      ) : null}

      {slideId === "competitors" ? (
        <OpenDoc url={bp.docs.research} name={`mahara-research-${d.taskId}`}>
          Market research (offer a name only if they stall)
        </OpenDoc>
      ) : null}
      {slideId === "brand" ? (
        <OpenDoc url={bp.docs.brandDnaUrl} name={`mahara-dna-${d.taskId}`}>
          Open their Brand DNA doc
        </OpenDoc>
      ) : null}
      {slideId === "content" ? (
        <div className="space-y-1.5">
          <OpenDoc url={bp.docs.driveUrl} name={`mahara-drive-${d.taskId}`}>
            Open their Drive folder
          </OpenDoc>
          {bp.prefill.contentLinks.map(l => (
            <a
              key={l}
              href={l}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-xs text-primary hover:underline"
            >
              {l}
            </a>
          ))}
        </div>
      ) : null}

      {slideId === "first-ads" ? (
        <section className="space-y-2 border-t pt-3">
          <h3 className="text-xs font-medium text-muted-foreground">
            The starter pack
          </h3>
          {packUrl(bp) ? (
            <>
              <OpenDoc url={packUrl(bp)} name={`mahara-pack-${d.taskId}`}>
                Open the pack
              </OpenDoc>
              <div className="text-xs text-muted-foreground">
                Opens the real pack in its own window to share. The slide shows
                three example ads for their service in phones, tagged Example
                ad; the folder itself is never framed on the slide.
              </div>
            </>
          ) : (
            <div className="text-xs txt-warn">
              No starter pack link yet: paste its Drive folder in part 1, under
              Which pack.
            </div>
          )}
        </section>
      ) : null}

      {slideId === "first-ads" && brief ? (
        <details className="rounded-lg border px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium">
            What media gets ({brief.split("\n").length} lines)
          </summary>
          <pre className="mt-2 whitespace-pre-wrap text-xs">{brief}</pre>
        </details>
      ) : null}

      {inPrep && slideId === "next" ? (
        <section className="space-y-2 border-t pt-3">
          <h3 className="text-xs font-medium text-muted-foreground">
            The launch call
          </h3>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                openNamed(LAUNCH_BOOKING, `mahara-book-launch-${d.taskId}`)
              }
            >
              <CalendarPlus aria-hidden />
              Open the launch booking page
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void reload()}>
              <RefreshCw aria-hidden />
              Check the booking
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            {d.next.launch
              ? `Booked: ${new Date(d.next.launch).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: d.timeZone })}.`
              : "Not booked yet. Share the booking page's window, book it with them, then check the booking."}
          </div>
        </section>
      ) : null}

      <section className="space-y-2 border-t pt-3">
        <h3 className="text-xs font-medium text-muted-foreground">The parts</h3>
        <PartsBar bp={bp} timeZone={d.timeZone} press={press} />
      </section>
    </div>
  );
}
