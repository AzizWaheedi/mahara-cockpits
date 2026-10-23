import { CalendarPlus, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Conflicts, OpenDoc, PartsBar, QuestionField } from "./BlueprintFields";
import * as B from "./blueprintBrief";
import { type BpPart, partAnswers, QUESTIONS } from "./blueprintForm";
import { kickoffFacts } from "./blueprintPrefill";
import type { DeckData } from "./deckData";
import { openNamed } from "./PresentButton";
import type { BpModel } from "./useBlueprint";

/**
 * The notes window's Brand Blueprint section (docs/brand-blueprint/SPEC.md
 * 5.1): the parts and their runs, this slide's questions (the private ones
 * typed only here, the client's own mirrored from the slide), the
 * suggestions to accept, what media gets, and the presses where they
 * belong (Send to media on slide 5, Close the call on slide 14). Nothing
 * here is ever on the shared canvas.
 */

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

export function BlueprintNotes({
  bp,
  d,
  slideId,
  reload,
}: {
  bp: BpModel | null | undefined;
  d: DeckData;
  slideId: string;
  /** Read the deck again (the booking, after the launch call is booked). */
  reload: () => Promise<void>;
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
  const press: BpPart[] =
    slideId === "first-ads" ? [1] : slideId === "next" ? [2] : [];
  const qs = questionsFor(slideId);
  return (
    <div className="space-y-4">
      {bp.readOnly ? (
        <div className="rounded-lg border px-3 py-2 text-xs text-muted-foreground">
          Only the creative director sends the parts. You can read every answer
          here.
        </div>
      ) : null}
      <Conflicts bp={bp} />

      <section className="space-y-2 border-t pt-3">
        <h3 className="text-xs font-medium text-muted-foreground">The parts</h3>
        <PartsBar bp={bp} timeZone={d.timeZone} press={press} />
      </section>

      {bp.prefill.notes.length ? (
        <ul className="space-y-1 text-xs txt-warn">
          {bp.prefill.notes.map(n => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}

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

      {slideId === "next" ? (
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
    </div>
  );
}
