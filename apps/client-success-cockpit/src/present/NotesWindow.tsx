import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Copy,
  MessageCircleQuestion,
} from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { KICKOFF } from "@/forms/kickoff";
import { cn } from "@/lib/utils";
import { focusOf } from "./AdsStage";
import { makeAddFiles } from "./adsActions";
import {
  BlueprintDoHere,
  BlueprintNotes,
  BlueprintWhere,
  BlueprintWrapUp,
  fillLine,
  fillPlaces,
} from "./BlueprintNotes";
import { CallGuideLine, PracticeNote } from "./CallGuide";
import type { DeckMessage } from "./channel";
import { DECK_NAME, t } from "./content";
import { groupLinks, Segmented, SlideControls } from "./controls";
import {
  fillNotes,
  type SlideCtx,
  type SlideDef,
  titleFor,
} from "./deckContext";
import type { CallKind } from "./deckData";
import { TARGET_MINUTES } from "./decks";
import { KickoffNotes } from "./KickoffSlide";
import { type BookOpts, KICKOFF_SLIDE, type KickoffView } from "./kickoffStop";
import {
  CopyButton,
  goalAsk,
  goalAskParts,
  LaunchControls,
  partText,
  replyText,
} from "./launchControls";
import { serviceNames } from "./services";
import type { DeckKind } from "./sources";
import { useCallFacts } from "./useCallFacts";
import type { DeckIO, DeckModel, SaveState } from "./useDeckModel";
import { useDriveImports } from "./useDriveImports";
import {
  firstFilled,
  NotesVideos,
  type PlayerAt,
  type ZoomTip,
} from "./VideoNotes";

/**
 * The CSM's own window (DESIGN 12.2): opened with N, never shared. It
 * follows the deck over the hub and moves it (Next and Back here move the
 * deck), and holds what must never touch the canvas: the talk track, the
 * temp checks, the facts only the CSM sees, the slide's controls, the
 * booking buttons and the links to paste in the group.
 */

type DeckState = Extract<DeckMessage, { type: "state" }>;

export function saveLine(s: SaveState): {
  text: string;
  tone: "muted" | "good" | "bad";
} {
  if (s.kind === "saving") return { text: "Saving…", tone: "muted" };
  if (s.kind === "saved")
    return {
      text: s.changed ? "Saved" : "Saved, nothing changed",
      tone: "good",
    };
  if (s.kind === "error") return { text: s.message, tone: "bad" };
  return { text: "Changes save as you make them.", tone: "muted" };
}

function clockOf(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A note's stop, from its lead: "Stop 3, the offer: …" or "(Stop 3) …". */
const stopOf = (line: string) => {
  const m = /^\(?Stop (\d+)\b/.exec(line);
  return m ? Number(m[1]) : null;
};

type AskParts = { before: string; goal: string; after: string } | null;

/** The first letter is Arabic (the goal's own direction, as dir=auto reads it). */
const ARABIC_FIRST = /^[^A-Za-z\u0600-\u06FF]*[\u0600-\u06FF]/;

/**
 * One talk-track line. The pushback question that names their goal sets
 * the goal on its own line, isolated, so an English goal never wraps
 * inside an Arabic sentence and the CSM reads it whole.
 */
function SayText({
  raw,
  slots,
  ask,
}: {
  raw: string;
  slots: Record<string, string>;
  ask: AskParts;
}) {
  if (!ask || !raw.includes("{goalAsk}"))
    return <>{fillNotes([raw], slots)[0]}</>;
  const [pre = "", post = ""] = raw.split("{goalAsk}");
  const lead = fillNotes([pre.replace(/["“]\s*$/, "")], slots)[0].trimEnd();
  const tail = fillNotes([post.replace(/^\s*["”]/, "")], slots)[0].trim();
  return (
    <>
      {lead ? `${lead} ` : null}
      {ask.before}
      {/* The goal's own direction for the whole quote, so an English goal
          in the Arabic list reads as an English paragraph, its lines on
          their own edge. */}
      <span
        dir={ARABIC_FIRST.test(ask.goal) ? "rtl" : "ltr"}
        className="my-1 block border-s-2 border-primary/40 ps-2"
      >
        <span dir="ltr" className="text-xs text-muted-foreground">
          Their goal, in their words:
        </span>
        <span className="block font-medium">
          <bdi dir="auto">{ask.goal}</bdi>
        </span>
      </span>
      {ask.after}
      {tail ? ` ${tail}` : null}
    </>
  );
}

/**
 * The talk track: on a slide whose lines are led by two or more stops, the
 * lines are grouped under their stops' names, the current stop open and
 * the others folded to their name (the fixer's round: eighteen bullets
 * could not be scanned mid-call), and the open stop scrolls into view on
 * each stop change. Lines with no stop follow the groups. On a slide with
 * one stop's lines or none, the other stops' lines step back (muted).
 */
function SayList({
  lines,
  slots,
  ask,
  stop,
  className,
  dir,
  names,
}: {
  lines: string[];
  slots: Record<string, string>;
  ask: AskParts;
  stop: number | null;
  className: string;
  dir?: "rtl";
  /** A stop's name, from 1, for its group's head. */
  names?: (n: number) => string | null;
}) {
  const first = stop === null ? -1 : lines.findIndex(l => stopOf(l) === stop);
  const ref = useRef<HTMLUListElement>(null);
  const groupsRef = useRef<HTMLDivElement>(null);
  const stops = [
    ...new Set(lines.map(stopOf).filter((x): x is number => x !== null)),
  ].sort((a, b) => a - b);
  const grouped = stop !== null && stops.length >= 2;
  // Stops the CSM opened by hand; the current stop is always open.
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  // biome-ignore lint/correctness/useExhaustiveDependencies: folds back on each stop change
  useEffect(() => {
    setOpened(new Set());
  }, [stop]);
  useEffect(() => {
    if (first < 0) return;
    const still = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const at = grouped
      ? groupsRef.current?.querySelector<HTMLElement>("[data-now]")
      : (ref.current?.children[first] as HTMLElement | undefined);
    at?.scrollIntoView?.({
      block: grouped ? "start" : "center",
      behavior: still ? "auto" : "smooth",
    });
  }, [first, grouped]);
  if (grouped) {
    const rest = lines.filter(l => stopOf(l) === null);
    return (
      <div ref={groupsRef} dir={dir} className="space-y-1.5">
        {stops.map(n => {
          const open = n === stop || opened.has(n);
          const name = names?.(n);
          return (
            // Clear of the sticky header when it scrolls into view.
            <div
              key={n}
              data-now={n === stop ? "" : undefined}
              className="scroll-mt-32"
            >
              <button
                type="button"
                dir="ltr"
                aria-expanded={open}
                onClick={() =>
                  setOpened(o => {
                    const next = new Set(o);
                    if (next.has(n)) next.delete(n);
                    else next.add(n);
                    return next;
                  })
                }
                disabled={n === stop}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-md py-0.5 text-left text-xs font-medium",
                  n === stop ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {open ? (
                  <ChevronDown aria-hidden className="size-3.5 shrink-0" />
                ) : (
                  <ChevronRight aria-hidden className="size-3.5 shrink-0" />
                )}
                <span>
                  Stop {n}
                  {name ? `: ${name}` : ""}
                </span>
              </button>
              {open ? (
                <ul className={cn(className, "mt-1")}>
                  {lines
                    .map((raw, i) => ({ raw, i }))
                    .filter(x => stopOf(x.raw) === n)
                    .map(({ raw, i }) => (
                      <li key={`${i}:${raw}`}>
                        <SayText raw={raw} slots={slots} ask={ask} />
                      </li>
                    ))}
                </ul>
              ) : null}
            </div>
          );
        })}
        {rest.length ? (
          <ul className={className}>
            {rest.map(raw => (
              <li key={raw}>
                <SayText raw={raw} slots={slots} ask={ask} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }
  return (
    <ul ref={ref} dir={dir} className={className}>
      {lines.map((raw, i) => {
        const s = stopOf(raw);
        return (
          <li
            key={`${i}:${raw}`}
            className={cn(
              s !== null &&
                stop !== null &&
                s !== stop &&
                "text-muted-foreground",
            )}
            data-now={s !== null && s === stop ? "" : undefined}
          >
            <SayText raw={raw} slots={slots} ask={ask} />
          </li>
        );
      })}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 border-t pt-3">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function NotesWindow({
  model,
  deck,
  slides,
  base,
  book,
  io,
  hosted = false,
  practice = false,
  made = false,
}: {
  model: DeckModel;
  deck: DeckKind;
  slides: SlideDef[];
  base: Omit<SlideCtx, "tour" | "setTour">;
  book?: (kind: CallKind, label: string, opts?: BookOpts) => ReactNode;
  io?: DeckIO;
  /** The Blueprint's notes for the creative director cockpit (EMBED.md 4.4). */
  hosted?: boolean;
  /** A rehearsal or a practice run: the call guide never counts it. */
  practice?: boolean;
  /** The practice client: made up, says so in the header. */
  made?: boolean;
}) {
  const { hub, data: d } = model;
  const facts = useCallFacts({ hub, d, slides, bp: base.bp, isNotes: true });
  /** The kickoff on the deck's last slide, as the deck window has it. */
  const [kickoff, setKickoff] = useState<KickoffView | null>(null);
  const [at, setAt] = useState<DeckState | null>(null);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  /** What the deck window's player is doing (DESIGN 21.4). */
  const [player, setPlayer] = useState<PlayerAt | null>(null);
  const playerRef = useRef(player);
  playerRef.current = player;
  /** The Zoom tip, once per call: tick on the first play, untick when it closes. */
  const [zoom, setZoom] = useState<ZoomTip>(null);
  /** The sticky foot's height, so the page's last row scrolls clear of it. */
  const [footH, setFootH] = useState(144);
  const footObserver = useRef<ResizeObserver | null>(null);
  const footRef = useCallback((el: HTMLElement | null) => {
    footObserver.current?.disconnect();
    footObserver.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setFootH(el.offsetHeight));
    ro.observe(el);
    footObserver.current = ro;
    setFootH(el.offsetHeight);
  }, []);
  const zoomDone = useRef(false);
  /** The deck window closed: the recap takes the talk track's place. */
  const [deckClosed, setDeckClosed] = useState(false);
  /** The Blueprint wrap-up, opened from slide 14 before the deck window closes. */
  const [wrapOpen, setWrapOpen] = useState(false);
  /** "If they push back": stays as the CSM left it, open once opened. */
  const [pushOpen, setPushOpen] = useState(false);
  const drive = useDriveImports({
    taskId: deck === "launch" ? (d?.taskId ?? null) : null,
    io,
    hub,
    onLanded: () => {
      void model.reload().then(() => hub.post({ type: "ads" }));
    },
  });
  const addFiles = useMemo(
    () =>
      io
        ? makeAddFiles(
            model,
            io,
            () => (at?.slideId === "ads" ? focusOf(at.tour) : null),
            r => {
              if (r.phase === "refused" && r.message)
                setMessages(m => [r.message as string, ...m].slice(0, 3));
            },
          )
        : undefined,
    [model, io, at],
  );

  useEffect(() => {
    const off = hub.on(m => {
      if (m.type === "state") {
        setAt(m);
        setDeckClosed(false);
      } else if (m.type === "roll-call") {
        hub.post({ type: "hello", from: "notes" });
      } else if (m.type === "kickoff") {
        setKickoff(m.view);
      } else if (m.type === "closed") {
        setDeckClosed(true);
        setPlayer(null);
      } else if (m.type === "video-state") {
        if (m.phase === "closed") {
          setPlayer(p => (p && p.slot === m.slot ? null : p));
          setZoom(z => (z === "tick" ? "untick" : z));
        } else {
          setPlayer({ slot: m.slot, phase: m.phase });
          // The first open video of the call gets the tip, even when this
          // window joined after it started loading.
          if (
            m.phase === "loading" ||
            (!zoomDone.current &&
              (m.phase === "ready" || m.phase === "playing"))
          ) {
            if (!zoomDone.current) {
              zoomDone.current = true;
              setZoom("tick");
            } else setZoom(z => (z === "untick" ? null : z));
          }
        }
      }
    });
    hub.post({ type: "hello", from: "notes" });
    return off;
  }, [hub]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  // The arrows here move the deck, unless a field has the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "SELECT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight" || e.key === "PageDown")
        hub.post({ type: "nav", to: "next" });
      else if (e.key === "ArrowLeft" || e.key === "PageUp")
        hub.post({ type: "nav", to: "prev" });
      else if (e.key === "v" || e.key === "V") {
        // V plays the slide's first recorded video on screen, or closes it.
        const open = playerRef.current;
        if (open) hub.post({ type: "video", slot: null });
        else {
          const id = vRef.current;
          if (id) hub.post({ type: "video", slot: id });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hub]);

  const index = at ? Math.min(at.index, slides.length - 1) : 0;
  const slide = slides[index];
  /** The slide's first recorded video, for V. */
  const vRef = useRef<string | null>(null);
  vRef.current = d && slide ? firstFilled(d, slide.id) : null;
  const tour = at?.tour ?? 0;
  const ctx: SlideCtx = { ...base, tour, setTour: () => {} };
  const stops = at?.stops ?? Math.max(1, slide?.stops?.(ctx) ?? 1);
  const links = useMemo(() => (d ? groupLinks(d) : null), [d]);
  if (!d || !slide)
    return (
      <div className="p-6 text-sm text-muted-foreground">Reading the deck…</div>
    );

  const elapsed = at ? now - at.startedAt : 0;
  const target = TARGET_MINUTES[deck] * 60_000;
  // The service as the notes say it inside a sentence, in each language.
  const said = serviceNames(d.service).mid;
  const slots = {
    service: said.en ?? "the launch service",
    csm: d.csmFirst ?? "",
    goalAsk: goalAsk(d, "en"),
  };
  // An Arabic line never says a Latin name or "الخدمة الخدمة": with no
  // Arabic name, a cue in brackets for the CSM to say the service
  // (CONTENT-AR O4: a Latin-only service is left out of the spoken line).
  const slotsAr = {
    ...slots,
    service: said.ar && /[؀-ۿ]/.test(said.ar) ? said.ar : "(اسم الخدمة)",
    goalAsk: goalAsk(d, "ar"),
  };
  const askEn = goalAskParts(d, "en");
  const askAr = goalAskParts(d, "ar");
  const notes = slide.notes;
  /** The stop the talk track follows, when the slide has stops. */
  const sayStop = stops > 1 ? tour + 1 : null;
  const stopName = slide.stopName?.(tour, ctx);
  const stopNames = (n: number) => slide.stopName?.(n - 1, ctx)?.en ?? null;
  const nextSlide = slides[index + 1];
  /** Where the next slide is filled, said before it is reached. */
  const nextWhere =
    deck === "blueprint" &&
    base.bp &&
    !base.bp.readOnly &&
    tour + 1 >= stops &&
    nextSlide
      ? fillLine(fillPlaces(base.bp, nextSlide.id))
      : null;
  const sl = saveLine(
    deck === "blueprint" ? (base.bp?.save ?? model.save) : model.save,
  );
  const presentedAt = d.presentedAt;

  return (
    <div
      className="flex min-h-screen flex-col bg-background text-foreground"
      style={{ "--notes-foot": `${footH}px` } as CSSProperties}
    >
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">
            Notes · {DECK_NAME[deck].en} · <bdi>{d.nameEn}</bdi>
          </span>
          <span
            className={cn(
              "tabular-nums",
              elapsed > target && "font-semibold txt-warn",
            )}
            title="Elapsed against the deck's target"
          >
            {at ? clockOf(elapsed) : "0:00"} / {TARGET_MINUTES[deck]}:00
          </span>
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-mono text-sm tabular-nums text-muted-foreground">
            {String(index + 1).padStart(2, "0")} / {slides.length}
          </span>
          <h1 className="min-w-0 truncate text-base font-semibold">
            {t(titleFor(slide, d), "en").replace("{name}", d.nameEn)}
          </h1>
        </div>
        <div className="text-xs text-muted-foreground">
          {stops > 1
            ? `Stop ${tour + 1} of ${stops}${stopName ? `: ${stopName.en}` : ""}`
            : "One stop"}
          {at
            ? ""
            : hosted
              ? " · press Present to follow it here"
              : " · open the deck window to follow it here"}
        </div>
        {deck === "blueprint" && !deckClosed && !wrapOpen ? (
          <BlueprintWhere bp={base.bp} slideId={slide.id} />
        ) : null}
        {made ? (
          <PracticeNote className="mt-1" />
        ) : deck === "blueprint" && base.bp?.rehearsal ? (
          <div className="mt-1 rounded-md bg-primary/15 px-2 py-1 text-xs font-medium">
            Rehearsal: nothing is saved or sent.
          </div>
        ) : null}
        {deck !== "blueprint" || (base.bp && !base.bp.readOnly) ? (
          <CallGuideLine
            deck={deck}
            taskId={d.taskId}
            facts={facts}
            hosted={hosted}
            practice={practice}
          />
        ) : null}
      </header>

      <main className="flex-1 space-y-4 px-4 py-4 text-sm leading-6">
        {deckClosed ? (
          // The deck window is gone: the recap, wherever the call ended
          // (DESIGN 21.4). Nothing of it reaches the shared window.
          <section className="space-y-3 rounded-lg border p-3">
            <div className="text-sm font-medium">The deck is closed.</div>
            {deck === "launch" ? (
              <div className="flex flex-wrap gap-2">
                <CopyButton text={partText(d)} label="Copy for the group" />
                <CopyButton text={replyText(d)} label="Copy reply" />
              </div>
            ) : links ? (
              <CopyButton text={links.text} label="Copy links for the group" />
            ) : null}
          </section>
        ) : null}
        {deck === "blueprint" ? (
          deckClosed || wrapOpen ? (
            <BlueprintWrapUp
              bp={base.bp}
              d={d}
              onBack={deckClosed ? undefined : () => setWrapOpen(false)}
            />
          ) : (
            <BlueprintDoHere
              bp={base.bp}
              d={d}
              slideId={slide.id}
              reload={model.reload}
              onWrap={() => setWrapOpen(true)}
            />
          )
        ) : null}
        <section className="space-y-2" hidden={deckClosed || wrapOpen}>
          <h3 className="text-xs font-medium text-muted-foreground">Say</h3>
          <SayList
            lines={notes.say}
            slots={slots}
            ask={askEn}
            stop={sayStop}
            names={stopNames}
            className="list-disc space-y-1.5 pl-4"
          />
          {d.mode.dwy && notes.dwy ? (
            <ul className="list-disc space-y-1.5 pl-4">
              {fillNotes(notes.dwy, slots).map(l => (
                <li key={l} className="txt-warn">
                  Done with you: {l}
                </li>
              ))}
            </ul>
          ) : null}
          {model.lang === "ar" && notes.sayAr.length ? (
            <h3 className="pt-1 text-xs font-medium text-muted-foreground">
              Said in Arabic
            </h3>
          ) : null}
          {model.lang === "ar" && notes.sayAr.length ? (
            <SayList
              lines={notes.sayAr}
              slots={slotsAr}
              ask={askAr}
              stop={sayStop}
              names={stopNames}
              dir="rtl"
              className="list-disc space-y-1.5 pr-4 text-[15px] leading-7"
            />
          ) : null}
          {notes.push?.length ? (
            // The pushback handle, said only if they push back: one
            // disclosure that stays as the CSM left it across stops.
            <details
              open={pushOpen}
              onToggle={e => setPushOpen(e.currentTarget.open)}
              className="rounded-lg border px-3 py-2"
            >
              <summary className="cursor-pointer text-xs font-medium">
                If they push back
              </summary>
              <div className="mt-2 space-y-2">
                <SayList
                  lines={notes.push}
                  slots={slots}
                  ask={askEn}
                  stop={null}
                  className="list-disc space-y-1.5 pl-4"
                />
                {model.lang === "ar" && notes.pushAr?.length ? (
                  <SayList
                    lines={notes.pushAr}
                    slots={slotsAr}
                    ask={askAr}
                    stop={null}
                    dir="rtl"
                    className="list-disc space-y-1.5 pr-4 text-[15px] leading-7"
                  />
                ) : null}
              </div>
            </details>
          ) : null}
          {notes.temp ? (
            <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2">
              <MessageCircleQuestion
                aria-hidden
                className="mt-0.5 size-4 shrink-0 txt-warn"
              />
              <div>
                <div className="text-xs font-medium txt-warn">Temp check</div>
                <div>{fillNotes([notes.temp.en], slots)[0]}</div>
                {model.lang === "ar" ? (
                  <div dir="rtl">{fillNotes([notes.temp.ar], slotsAr)[0]}</div>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>

        {slide.id === KICKOFF_SLIDE && !deckClosed ? (
          // The kickoff window's side panel, here and never on the canvas:
          // the seal, the call sheet in the form's order, then the trail.
          <Section title="Kickoff">
            <KickoffNotes
              view={kickoff}
              post={act => hub.post({ type: "kickoff-act", act })}
              book={
                book
                  ? o => (
                      // The call guide lights it while it is the step.
                      <span
                        data-guide="book-blueprint"
                        className="inline-flex rounded-md"
                      >
                        {book(
                          "blueprint",
                          KICKOFF.ending?.label ??
                            "Book the Brand Blueprint call",
                          o,
                        )}
                      </span>
                    )
                  : undefined
              }
            />
          </Section>
        ) : null}

        <NotesVideos
          d={d}
          slideId={slide.id}
          player={player}
          hub={hub}
          zoom={zoom}
        />

        <Section title="Only you see this">
          <ul className="space-y-1 text-muted-foreground">
            {model.error ? (
              <li className="txt-bad">
                The deck could not be read again just now: {model.error} The
                slides keep what they had.
              </li>
            ) : null}
            {[...model.loaded!.problems, ...d.notes].map(n => (
              <li key={n}>{n}</li>
            ))}
            {slide.missing?.(d).map(n => (
              <li key={n} className="txt-warn">
                {n}
              </li>
            ))}
            {slide.todo?.(d).map(n => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Section>

        {deck !== "blueprint" &&
        (slide.id === "team" ||
          slide.id === "welcome" ||
          slide.id === "cover" ||
          slide.id === "journey") ? (
          <Section title="This client's service model">
            <Segmented
              label="Service model"
              value={d.mode.dwy ? "DWY" : "DFY"}
              options={[
                { value: "DFY", label: "Done for you" },
                { value: "DWY", label: "Done with you" },
              ]}
              onChange={v =>
                model.setPrep("onboarding", { service_model: v }, true)
              }
            />
            <div className="text-xs text-muted-foreground">
              {d.mode.from === "prep"
                ? "Set here."
                : d.mode.known
                  ? `From the ${d.mode.from === "card" ? "ClickUp card" : "HighLevel account"}.`
                  : "Not set on the card. The deck uses done for you."}
            </div>
          </Section>
        ) : null}

        {deck === "blueprint" ? (
          deckClosed || wrapOpen ? null : (
            <BlueprintNotes
              bp={base.bp}
              d={d}
              slideId={slide.id}
              reload={model.reload}
            />
          )
        ) : deck === "launch" ? (
          <LaunchControls
            slideId={slide.id}
            d={d}
            model={model}
            tour={tour}
            book={book}
            addFiles={addFiles}
            updateAd={io?.updateAd}
            sendKey={key => hub.post({ type: "key", key })}
            messages={messages}
            now={now}
            still={base.still}
            drive={drive}
          />
        ) : (
          <SlideControls
            slideId={slide.id}
            d={d}
            deck={deck}
            prep={model.prep}
            setPrep={model.setPrep}
            book={book}
          />
        )}

        {slide.id === "this-week" && links ? (
          <Section title="Links for the group">
            <pre className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-2 text-xs">
              {links.text}
            </pre>
            {links.missing.map(m => (
              <div key={m} className="text-xs txt-warn">
                {m}
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(links.text).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                });
              }}
            >
              <Copy aria-hidden />
              {copied
                ? "Copied. Paste it in the group."
                : "Copy links for the group"}
            </Button>
          </Section>
        ) : null}

        {deck === "onboarding" && presentedAt ? (
          <div className="text-xs text-muted-foreground">
            Marked as presented, so the launch deck leaves out the hours card.
          </div>
        ) : null}
        {/* The sticky footer's measured height, so the last line (a video's
            Close and Copy row) scrolls clear of it (score round 3: a fixed
            112 px was shorter than the foot). */}
        <div
          aria-hidden
          className="shrink-0"
          style={{ height: "calc(var(--notes-foot, 9rem) + 16px)" }}
        />
      </main>

      <footer
        ref={footRef}
        className="sticky bottom-0 border-t bg-background/95 px-4 py-3 backdrop-blur"
      >
        <div
          className={cn(
            "mb-2 flex items-center justify-between gap-2 text-xs",
            sl.tone === "bad"
              ? "txt-bad"
              : sl.tone === "good"
                ? "txt-good"
                : "text-muted-foreground",
          )}
          role="status"
        >
          <span className="min-w-0">{sl.text}</span>
          {sl.tone === "bad" ? (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={() => void model.flush()}
            >
              Save again
            </Button>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            onClick={() => hub.post({ type: "nav", to: "prev" })}
          >
            <ArrowLeft aria-hidden />
            Back
          </Button>
          <span className="min-w-0 text-xs text-muted-foreground">
            <span className="block truncate">
              {tour + 1 < stops
                ? // The next stop by its name, where the slide names its stops.
                  `Next: ${stopNames(tour + 2)?.replace(/^Next:\s*/, "") ?? `stop ${tour + 2} of ${stops}`}`
                : nextSlide
                  ? `Next: ${t(titleFor(nextSlide, d), "en").replace("{name}", d.nameEn)}`
                  : "Last slide"}
            </span>
            {nextWhere ? (
              <span className="block truncate text-foreground/80">
                {nextWhere}
              </span>
            ) : null}
          </span>
          <Button onClick={() => hub.post({ type: "nav", to: "next" })}>
            Next
            <ArrowRight aria-hidden />
          </Button>
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">
          {hosted
            ? "Share only the Blueprint's tab on the call. The deck fills it; this window stays private."
            : "Share the deck window only, maximised rather than full screen, so you can reach this window."}
        </div>
      </footer>
    </div>
  );
}
