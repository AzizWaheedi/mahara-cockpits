import "./callGuide.css";
import { Check, NotebookPen } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  type CallFacts,
  callFinished,
  countCall,
  GROUP_NAME,
  type GuideGroup,
  type GuideView,
  guideFor,
  guideView,
  HELP_KEY,
  helpOn,
  readHelp,
  setHelp,
} from "./callSteps";
import type { DeckKind } from "./sources";

/**
 * The call guide (docs/call-guide/DESIGN.md), on the presenter's own
 * screens only: a band under prep's toolbar, and one line in the notes
 * window's header. With help on, the step that is now shows how, and its
 * control on this screen wears the beacon (callGuide.css).
 */

const GROUPS: GuideGroup[] = ["before", "call", "after"];

/** Help on or off, kept in step across this person's open windows. */
function useHelp(deck: DeckKind): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => helpOn(deck));
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === HELP_KEY) setOn(helpOn(deck, readHelp()));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [deck]);
  return [
    on,
    next => {
      setHelp(next);
      setOn(next);
    },
  ];
}

/** The lit control: one at a time, only while help is on. */
function useBeacon(target: string | undefined, on: boolean) {
  useEffect(() => {
    const root = document.documentElement;
    if (on && target) root.dataset.guideNow = target;
    else delete root.dataset.guideNow;
    return () => {
      delete root.dataset.guideNow;
    };
  }, [target, on]);
}

/** A real call that finished while this window watched counts once. */
function useCount(
  deck: DeckKind,
  taskId: string,
  finished: boolean,
  facts: CallFacts,
  counts: boolean,
) {
  const was = useRef(finished);
  useEffect(() => {
    if (finished && !was.current && counts && facts.deckOpen)
      countCall(deck, taskId);
    was.current = finished;
  }, [deck, taskId, finished, counts, facts.deckOpen]);
}

export interface CallGuideProps {
  deck: DeckKind;
  taskId: string;
  facts: CallFacts;
  /** Inside the creative director cockpit's page. */
  hosted: boolean;
  /** A rehearsal or a practice run: never counted as a call. */
  practice: boolean;
  /** Opens the notes window, where this screen has no other way to. */
  openNotes?: () => void;
}

function useGuide(p: CallGuideProps) {
  const steps = useMemo(
    () => guideFor(p.deck, { hosted: p.hosted }),
    [p.deck, p.hosted],
  );
  const view = guideView(steps, p.facts);
  const [help, setHelpOn] = useHelp(p.deck);
  useBeacon(view.now?.target, help);
  useCount(
    p.deck,
    p.taskId,
    callFinished(steps, p.facts),
    p.facts,
    !p.practice,
  );
  return { view, help, setHelpOn };
}

function HelpToggle({
  help,
  set,
}: {
  help: boolean;
  set: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => set(!help)}
      className="no-touch relative shrink-0 text-xs text-muted-foreground underline-offset-4 after:absolute after:-inset-2 hover:text-foreground hover:underline"
    >
      {help ? "Hide help" : "Show help"}
    </button>
  );
}

const counter = (v: GuideView) =>
  v.now ? `Step ${v.now.n} of ${v.total}` : `All ${v.total} steps done`;

/** The step that is now, in one line, with its how when help is on. */
function NowLine({ v, help }: { v: GuideView; help: boolean }) {
  if (!v.now)
    return (
      <div className="flex items-center gap-2 text-sm">
        <Check aria-hidden className="size-4 shrink-0 txt-good" />
        Every step of this call is done.
      </div>
    );
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span aria-hidden className="guide-lamp mt-1.5 shrink-0" />
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{v.now.title}</div>
        {help ? (
          <div className="text-xs text-pretty text-muted-foreground">
            {v.now.how}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Prep's band: the whole call in three groups, or one line with help off. */
export function CallGuideBand(p: CallGuideProps) {
  const { view: v, help, setHelpOn } = useGuide(p);
  return (
    <section
      aria-label="How this call runs"
      className="border-b px-4 py-3"
      data-guide-band=""
    >
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold">How this call runs</h2>
        <span
          className="font-mono text-[11px] tabular-nums text-muted-foreground"
          role="status"
        >
          {counter(v)}
        </span>
        <span className="ms-auto">
          <HelpToggle help={help} set={setHelpOn} />
        </span>
      </div>
      {help ? (
        <div className="mt-3 grid gap-x-8 gap-y-4 sm:grid-cols-3">
          {GROUPS.map(g => {
            const rows = v.steps.filter(s => s.group === g);
            if (!rows.length) return null;
            return (
              <div key={g} className="min-w-0">
                <h3 className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                  {GROUP_NAME[g]}
                </h3>
                <ol className="mt-2 space-y-2">
                  {rows.map(s => (
                    <li
                      key={s.id}
                      data-step={s.id}
                      data-state={s.state}
                      aria-current={s.state === "now" ? "step" : undefined}
                      className="flex min-w-0 items-start gap-2"
                    >
                      <span className="mt-0.5 flex w-4 shrink-0 justify-center">
                        {s.state === "done" ? (
                          <Check aria-hidden className="size-4 txt-good" />
                        ) : s.state === "now" ? (
                          <span aria-hidden className="guide-lamp mt-1" />
                        ) : (
                          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                            {s.n}
                          </span>
                        )}
                      </span>
                      <div className="min-w-0">
                        <div
                          className={cn(
                            "text-[13px] leading-5",
                            s.state === "now"
                              ? "font-medium text-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {s.title}
                          <span className="sr-only">
                            {s.state === "done"
                              ? ", done"
                              : s.state === "now"
                                ? ", now"
                                : ""}
                          </span>
                        </div>
                        {s.state === "now" ? (
                          <>
                            <div className="mt-0.5 text-xs text-pretty text-muted-foreground">
                              {s.how}
                            </div>
                            {s.target === "notes" && p.openNotes ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="mt-2"
                                data-guide="notes"
                                onClick={p.openNotes}
                              >
                                <NotebookPen aria-hidden />
                                Open the notes window
                              </Button>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-2">
          <NowLine v={v} help={false} />
        </div>
      )}
    </section>
  );
}

/** The notes window's line: where the call is, under the slide's title. */
export function CallGuideLine(p: CallGuideProps) {
  const { view: v, help, setHelpOn } = useGuide(p);
  return (
    <div
      className="mt-2 flex items-start justify-between gap-3 border-t pt-2"
      data-guide-line=""
    >
      <div className="min-w-0">
        <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {counter(v)}
        </div>
        <NowLine v={v} help={help} />
      </div>
      <HelpToggle help={help} set={setHelpOn} />
    </div>
  );
}
