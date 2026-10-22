import { Check, FolderOpen, X } from "lucide-react";
import {
  type CSSProperties,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import maharaLogo from "@/assets/mahara-logo-dark.png";
import { useCreatives } from "./AdsStage";
import osPhoneAr from "./assets/portal/portal-phone-ar.webp";
import osPhoneEn from "./assets/portal/portal-phone-en.webp";
import { bookedSlot, CONFIRMATION, plain } from "./callScript";
import {
  digits,
  EXAMPLE,
  type L,
  type Lang,
  O,
  O_NOTES,
  O_TITLES,
  SERVICES,
  SHARED,
  t,
  tf,
} from "./content";
import { appLanguage, type Creative, creativeOf, phoneFor } from "./creative";
import { clock, dayMonth, dayShort, toDate, weekdayDate } from "./dates";
import type { SlideCtx, SlideDef } from "./deckContext";
import type { AccessRow, AccessStatus, DeckData, Goal } from "./deckData";
import { shownGoals } from "./deckData";
import {
  exampleCreative,
  feedUrl,
  parseChoice,
  SCENES,
  STRIP_LIT,
  scenesNamed,
  storyUrl,
  stripTiles,
  type Theme,
  warmExamples,
} from "./examples";
import { useHug } from "./hug";
import { KickoffSlide } from "./KickoffSlide";
import { KICKOFF_SLIDE } from "./kickoffStop";
import { Confirmation, Tagged } from "./mockups/Cards";
import { ClientMark, type Identity } from "./mockups/Identity";
import { IgFeed, Phone, PhoneFigure, ReelStory } from "./mockups/Phones";
import { WhatsAppGroup } from "./mockups/WhatsAppGroup";
import { Route, type RouteStop, routeMs } from "./Road";
import { StageSwap } from "./StageSwap";
import { type ServiceKey, serviceOfText } from "./services";
import { TodayList } from "./TodayList";
import { posterFor } from "./VideoPoster";
import { filledOn, lengthText } from "./videos";

/**
 * The onboarding deck: eight slides, about 30 minutes of a 45 to 60 minute
 * call with the setup done live while slide 6 is up and the kickoff form
 * filled and sent on slide 8 (docs/csm-decks/CONTENT.md, DESIGN.md 9, 22.2
 * and 23). Each slide has its own structure (a cover with the call's
 * checklist, a quotation set as type, a hub, a matrix beside a product
 * column, a route, a board, two columns under a strip of example ads, the
 * kickoff form in its frame), and the call's checklist is the one drawing
 * that persists: the agenda on the cover, ticked at the foot of slides 4
 * and 6 from data, closed on O7's last stop, and at the foot of the
 * kickoff slide, whose Submit ticks the Blueprint call. Every word is in
 * content.ts; this file only places them.
 */

export const who = (d: DeckData): Identity => ({
  name: d.name,
  initials: d.initials,
  logo: d.logo,
});

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const strings = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
    : [];

/** A canvas control gives up focus after a click, so the next Space moves the deck. */
const letGo = (e: { currentTarget: HTMLElement }) => e.currentTarget.blur();

// ------------------------------------------------------------ O1 welcome

/**
 * The launch cover's name size, stepped by its length so the stack fits
 * under the letterhead for every client: display, then h1 past about 20
 * characters, then the client's-words size (data-long) past about 30.
 * Arabic glyphs set wider at these sizes, so the Arabic deck steps earlier.
 */
export function nameSize(name: string, lang: SlideCtx["lang"]) {
  const [mid, long] = lang === "ar" ? [14, 20] : [20, 30];
  const n = name.trim().length;
  return {
    className: n > mid ? "dk-h1" : "dk-display",
    long: n > long ? "" : undefined,
  };
}

/**
 * O1's name at 96, stepping to 80 then 64 for a longer name, at most two
 * lines in the start half's 784 px (DESIGN 22.2.1).
 */
export function welcomeSize(name: string, lang: Lang): "96" | "80" | "64" {
  const [mid, long] = lang === "ar" ? [14, 22] : [20, 30];
  const n = name.trim().length;
  return n > long ? "64" : n > mid ? "80" : "96";
}

/**
 * A creative of the client's own, never a starter template (that is what
 * goes live, not their work): where one exists the onboarding deck's phones
 * show it, untagged, and no example stands beside it (DESIGN 22.4.3).
 */
function ownCreative(model: ReturnType<typeof useCreatives>): Creative | null {
  return (
    [...model.tray, ...model.meta].find(
      c => !c.starter && (c.url || c.poster),
    ) ?? null
  );
}

/**
 * O1's picture (DESIGN 22.11, the fixer's round, which overturns 22.4.6 for
 * this cover): the example ad for their service, full-bleed in a Reels
 * phone, tagged "Example ad", so the first screen shows what we make, not
 * their logo alone. The story render, so O4's feed phone shows a different
 * picture. Their own creative, when they have one, untagged; the app's
 * chrome in the deck's language for an example.
 */
function WelcomePhone({ ctx }: { ctx: SlideCtx }) {
  const { d, lang } = ctx;
  const model = useCreatives(ctx);
  const own = ownCreative(model);
  const theme = d.example.theme;
  useEffect(() => {
    if (!own) warmExamples([storyUrl(theme)]);
  }, [own, theme]);
  const reel = own ? phoneFor(own) === "reels" : true;
  const creative =
    own ??
    exampleCreative(theme, "story", { primary: null, headline: null }, lang);
  const props = {
    creative,
    who: who(d),
    pageName: d.pageName,
    app: own ? appLanguage([...model.tray, ...model.meta], lang) : lang,
    deck: lang,
  };
  return (
    <div className="dkc-welcome-phone">
      {/* 760 tall, its tag under its foot (score round 2): over it, the
          tag stacked under the presenter's name and role as one block. */}
      <PhoneFigure
        height={760}
        mark="instagram"
        label={t(reel ? SHARED.frame.reels : SHARED.frame.feed, lang)}
        tag={own ? null : t(EXAMPLE.tag, lang)}
        tagBelow
        foot={false}
      >
        {reel ? <ReelStory {...props} /> : <IgFeed {...props} />}
      </PhoneFigure>
    </div>
  );
}

function Welcome({ ctx }: { ctx: SlideCtx }) {
  const { d, lang } = ctx;
  // The name hugs its longest line (final score round 1, with the column
  // at 920): a Latin name in the Arabic deck stands at the start edge, its
  // lines left-aligned inside, not 400 px off it on the column's far side.
  const nameRef = useRef<HTMLSpanElement>(null);
  useHug(nameRef, `${lang}:${d.name}:${welcomeSize(d.name, lang)}`);
  const date = dayMonth(d.onboardingDay, lang, d.timeZone);
  // The deck opens here: slide 6's guide posters are fetched and decoded
  // now, so none pops in after that slide has built (22.3.2, score round 4).
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per deck
  useEffect(() => {
    warmExamples(
      filledOn(d, "this-week")
        .map(v => posterFor(v.row)?.src)
        .filter((x): x is string => Boolean(x)),
    );
  }, []);
  return (
    <>
      {/* The presenter ends where the phone and its tag do, 120 px in from
          the content's end (score round 2 of the five services: the phone
          shared no edge with the name above it). */}
      <header className="dkc-letterhead" data-inset="">
        <img src={maharaLogo} alt="Mahara Media" draggable={false} />
        <p className="dk-dateline">{tf(O.welcome.dateline, lang, { date })}</p>
        {/* With no first name on the seat, the role is the presenter's
            one line, set as the name is, never a lone caption. */}
        <div className="dkc-presenter">
          {d.csmFirst ? (
            <>
              <b dir="auto">{d.csmFirst}</b>
              <span className="dk-label">{t(SHARED.csmRole, lang)}</span>
            </>
          ) : (
            <b>{t(SHARED.csmTeam, lang)}</b>
          )}
        </div>
      </header>
      {/* The start half: their mark, their name and what the call will
          finish, as three rings (the cover's own drawing), one block centred
          on the phone. The end half: an example ad for their service. */}
      <div className="dkc-welcome">
        <div className="dkc-welcome-side">
          <ClientMark who={who(d)} size={96} />
          <h1
            className="dkc-welcome-title"
            data-size={welcomeSize(d.name, lang)}
          >
            <span className="dkc-hello">{t(O.welcome.hello, lang)}</span>
            <span ref={nameRef} dir="auto" className="dkc-welcome-name">
              {d.name}
            </span>
          </h1>
          <TodayList d={d} lang={lang} variant="cover" />
        </div>
        <WelcomePhone ctx={ctx} />
      </div>
    </>
  );
}

// -------------------------------------------------------------- O2 goals

/**
 * How O2 reads for this client (DESIGN 22.2.2): the 90-day goal from their
 * form leads alone on stop 1, and their other answers arrive as one row on
 * stop 2. With no goal from the form, stop 1 is the question and its input;
 * with no answers at all, that is the slide.
 */
export function goalsView(d: DeckData) {
  const shown = shownGoals(d);
  const by = new Map<Goal["key"], Goal>(shown.map(g => [g.key, g]));
  const goal = by.get("goal90");
  const lead = goal && goal.from !== "prep" ? goal : null;
  const rest = (["goal12_24", "challenges", "why"] as const)
    .map(k => by.get(k))
    .filter((g): g is Goal => Boolean(g));
  return { lead, rest, stops: rest.length ? 2 : 1 };
}

/**
 * The direction of a client's words, from their first strong letter (an
 * Arabic goal in the English deck is right to left): the goal's size, its
 * hang and the edge it grows from follow it, never the deck's (score
 * round 4).
 */
export function wordsDir(text: string): "rtl" | "ltr" {
  const m = /[A-Za-z\u00c0-\u024f\u0600-\u06ff]/.exec(text);
  return m && /[\u0600-\u06ff]/.test(m[0]) ? "rtl" : "ltr";
}

/** The goal's size by its length: 80, then 64, then 56 (at most three lines). */
const goalSize = (text: string) =>
  text.length > 150 ? "56" : text.length > 90 ? "64" : "80";

/**
 * The goal's words, each its own box, so the goal sets in line by line on
 * arrival (DESIGN 22.14): once laid out, each word learns its line (`--ln`),
 * and a line rises after the one above it. Under still and reduced motion
 * every line is set at once.
 */
function useLines(ref: RefObject<HTMLElement | null>, key: string) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: key is the text being set
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let live = true;
    const mark = () => {
      if (!live) return;
      const words = [...el.querySelectorAll<HTMLElement>(".dkc-goal-w")];
      let line = -1;
      let top = Number.NEGATIVE_INFINITY;
      for (const w of words) {
        if (w.offsetTop > top + 4) {
          line += 1;
          top = w.offsetTop;
        }
        w.style.setProperty("--ln", String(line));
      }
    };
    mark();
    document.fonts?.ready.then(mark);
    return () => {
      live = false;
    };
  }, [key]);
}

/** The goal's words as boxes, the spaces between them kept as text. */
const goalWords = (text: string) =>
  text
    .split(/(\s+)/)
    .filter(Boolean)
    .map((w, i) =>
      /^\s+$/.test(w) ? (
        w
      ) : (
        <span key={`${String(i)}-${w}`} className="dkc-goal-w">
          {w}
        </span>
      ),
    );

/**
 * Under the goal, its 90 days drawn (DESIGN 22.14): from today to the end
 * of the 90 days, the line drawing across the slide on arrival. On the
 * second stop it is the rule the other answers sit under.
 */
function GoalTrack({ label, d, lang }: { label: L; d: DeckData; lang: Lang }) {
  // The two ends' dates (score round 4): this call's day and the 90th day
  // after it, quiet under the labels, so the line is concrete. They show
  // while the goal is the hero, and leave when the answers arrive under it.
  const from = dayMonth(d.onboardingDay, lang, d.timeZone);
  const to = dayMonth(plusDays(d.onboardingDay, 90), lang, d.timeZone);
  return (
    <div className="dkc-goal-track" aria-hidden>
      <i className="dkc-goal-track-line" />
      <i className="dkc-goal-track-from" />
      <i className="dkc-goal-track-to" />
      <span className="dkc-goal-track-today">
        {t(O.goals.today, lang)}
        {from ? <small className="dkc-goal-track-date">{from}</small> : null}
      </span>
      <span className="dkc-goal-track-end">
        {t(label, lang)}
        {to ? <small className="dkc-goal-track-date">{to}</small> : null}
      </span>
    </div>
  );
}

function GoalInput({ ctx }: { ctx: SlideCtx }) {
  const { lang, prep, save } = ctx;
  const goals = record(prep.goals);
  const [value, setValue] = useState(
    typeof goals.goal90 === "string" ? goals.goal90 : "",
  );
  // The answer's line, set as the 80 px goal: drawn under the CSM's
  // pointer or while typing, so the client never sees an empty field.
  return (
    <textarea
      className="dkc-goal-input"
      data-empty={value.trim() ? undefined : ""}
      rows={1}
      // Empty, it takes the deck's direction (an empty dir="auto" field
      // reads left to right, so the Arabic prompt sat on the left).
      dir={value.trim() ? "auto" : lang === "ar" ? "rtl" : "ltr"}
      value={value}
      placeholder={t(O.goals.input, lang)}
      aria-label={t(O.goals.inputLabel, lang)}
      onChange={e => {
        setValue(e.target.value);
        save({
          goals: { ...goals, goal90: e.target.value.trim() || null },
        });
      }}
      onKeyDown={e => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/**
 * A list of answers sized as one box to its widest line (the fixer's round):
 * every item spans that box and keeps its own start, so an English list in
 * the Arabic deck starts every line at one edge, and the box's other edge
 * sits on the label's. Hugging each item alone gave one list two ragged
 * edges.
 */
function Answers({ lines, span = false }: { lines: string[]; span?: boolean }) {
  const ref = useRef<HTMLUListElement>(null);
  // Spanning (one group in the other script, final score round 1): the row
  // runs the content's width from its own start, so it is not hugged.
  useHug(ref, lines.join("\n"), !span);
  // Each item a block in the deck's direction, the words isolated in a
  // <bdi> (score round 4, as O7's red lines): an English answer in the
  // Arabic deck sits under its Arabic label's edge, not the column's other.
  // Lines all in one script take its direction (score round 2 of the five
  // services, as O7's red lines): three Arabic challenges run across the
  // English deck's row right to left, the first on the right.
  const listDir = groupDir(lines);
  return (
    <ul ref={ref} data-hug="" dir={listDir}>
      {lines.map(l => (
        <li key={l} className="dkc-theirs">
          <bdi>{l}</bdi>
        </li>
      ))}
    </ul>
  );
}

/**
 * One answer, hugging its lines: a block at its label's edge whose lines
 * follow their own script (final score round 1: an English answer in the
 * Arabic deck was right-aligned beside a left-aligned English list).
 */
function AnswerText({ text, span = false }: { text: string; span?: boolean }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useHug(ref, text, !span);
  return (
    <p ref={ref} className="dkc-theirs" data-hug="" dir={wordsDir(text)}>
      <bdi>{text}</bdi>
    </p>
  );
}

/** A group's words' shared direction, or none when their scripts mix. */
function groupDir(lines: string[]): "rtl" | "ltr" | undefined {
  const dirs = lines.map(wordsDir);
  return dirs.length && dirs.every(x => x === dirs[0]) ? dirs[0] : undefined;
}

function GoalRow({
  goals,
  lang,
  hold = false,
}: {
  goals: Goal[];
  lang: Lang;
  hold?: boolean;
}) {
  const deckDir = lang === "ar" ? "rtl" : "ltr";
  return (
    <div
      className="dkc-goal-row"
      data-n={goals.length}
      data-hold={hold ? "" : undefined}
    >
      {goals.map(g => {
        // One group whose words all run the other way (final score round
        // 1: Arabic challenges in the English deck sat packed to the left,
        // their first item at x 1320 under a label at x 136): the row spans
        // the content and its label stands at the words' own start.
        const dir = groupDir(
          g.key === "challenges" ? g.lines : g.lines.slice(0, 1),
        );
        const cross =
          goals.length === 1 && dir !== undefined && dir !== deckDir;
        return (
          <div
            key={g.key}
            className="dkc-goal-col"
            data-cross={cross ? "" : undefined}
          >
            <span className="dk-label">{t(g.label, lang)}</span>
            {g.key === "challenges" ? (
              <Answers lines={g.lines} span={cross} />
            ) : (
              <AnswerText text={g.lines[0] ?? ""} span={cross} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Goals({ ctx }: { ctx: SlideCtx }) {
  const { d, lang, tour } = ctx;
  const { lead, rest } = goalsView(d);
  const leadRef = useRef<HTMLParagraphElement>(null);
  useHug(leadRef, lead?.lines[0] ?? "");
  useLines(leadRef, `${lang}:${lead?.lines[0] ?? ""}`);
  const row = tour >= 1 && rest.length ? rest : null;
  // One short group of answers (fixer round 2): the goal holds low with
  // them under it, one block on the stage's middle, instead of settling to
  // the top over 350 px of empty stage.
  const hold = Boolean(row && row.length === 1);
  const goalDir = wordsDir(lead?.lines[0] ?? "");
  // One stop when there is nothing to add: the footnote is there at once.
  const foot = rest.length ? tour >= 1 : true;
  if (!lead)
    // No 90-day goal on the form: the question is the slide's one heading
    // and the CSM types the answer under it, at the goal's size.
    return (
      <>
        <div
          className="dkc-goal-asking"
          // Alone on the slide, the question and its line are one block on
          // the slide's middle (the fixer's round). With answers to come on
          // stop 2 it stands --dk-lift lower on stop 1, as the hero goal
          // does, and settles up in one move when they arrive (score round
          // 1: at the top it left the lower half of the stage empty).
          data-alone={rest.length ? undefined : ""}
          data-lift={rest.length && !row ? "" : undefined}
        >
          <h2 className="dk-h1 dkc-goal-ask">{t(O.goals.empty, lang)}</h2>
          {/* "In 90 days" over the field only when no track says it under
              the field (score round 2 of the five services: the slide said
              90 days four times). */}
          {rest.length ? (
            <span className="dk-label dkc-goal-label">
              {t(O.goals.goal90, lang)}
            </span>
          ) : null}
          <GoalInput ctx={ctx} />
          {/* The empty state builds like the filled one (score round 4):
              the question rises, then its 90 days sweep under the field,
              the one line drawn there (the field's own rule shows only
              under the pointer or while typing). */}
          {rest.length ? null : (
            <GoalTrack label={O.goals.goal90} d={d} lang={lang} />
          )}
        </div>
        {row ? <GoalRow goals={row} lang={lang} /> : null}
      </>
    );
  return (
    <>
      <div className="dkc-goal-head">
        <h2 className="dk-h2">{t(O.goals.title, lang)}</h2>
        <span className="dk-tag">{t(O.goals.source, lang)}</span>
      </div>
      {/* Stop 1: the goal alone, their words set as type, line by line,
          over its 90 days drawn across the slide; the pair sits low on the
          stage (22.14: it left the lower half empty) and settles up when the
          other answers arrive under the line, which is their rule. */}
      <div
        className="dkc-goal-stage"
        data-lift={row ? undefined : rest.length ? "" : undefined}
        data-alone={rest.length ? undefined : ""}
        data-hold={hold ? "" : undefined}
      >
        {/* The goal's own direction, in either deck (score round 4): its
            type, the edge it hangs from and the edge it grows from, so an
            Arabic goal in the English deck sits on the end margin with its
            mark outside it, and nothing slides sideways as it settles. */}
        <div className="dkc-goal-block" dir={goalDir}>
          <p
            ref={leadRef}
            className="dkc-goal-text dkc-theirs"
            data-size={goalSize(lead.lines[0] ?? "")}
            dir={goalDir}
            data-hug=""
          >
            {goalWords(lead.lines[0] ?? "")}
          </p>
        </div>
        <GoalTrack label={lead.label} d={d} lang={lang} />
      </div>
      {row ? <GoalRow goals={row} lang={lang} hold={hold} /> : null}
      {foot ? (
        <p className="dk-small dkc-foot" data-rise={row ? "" : undefined}>
          {t(O.goals.foot, lang)}
        </p>
      ) : null}
    </>
  );
}

// --------------------------------------------------------------- O3 team

function Team({ ctx }: { ctx: SlideCtx }) {
  const { d, lang, tour } = ctx;
  // Done with you, the last line is the group's own alerts for their
  // callers: theirs, not one of ours.
  const rows = d.mode.dwy
    ? [...O.team.rows.slice(0, 4), { ...O.team.alertsDwy, theirs: true }]
    : [...O.team.rows];
  return (
    <>
      {/* No lead under the title (the fixer's round): it said "WhatsApp
          group" a third time; the CSM says it as the group fills. */}
      <h2 className="dk-h2">{t(O.team.title, lang)}</h2>
      <WhatsAppGroup
        who={who(d)}
        lang={lang}
        header={O.team.header}
        reply={O.team.reply}
        hours={d.uae ? O.team.hoursUae : O.team.hours}
        promise={tour >= 1}
        rows={rows}
      />
    </>
  );
}

// ------------------------------------------------------- O4 one service

/**
 * The row the matrix points at (DESIGN 22.14): the CSM's pointer, else the
 * row with the most ticks (their #1 wins a tie), else the client's likely
 * service from their answers (slide 4's choice, prep, the kickoff, then
 * their own words mapped to a main service). Keys, never sub-trades.
 */
export function leadService(
  d: DeckData,
  ticks: Record<string, Record<string, boolean>>,
  picked: string | null,
): { lead: ServiceKey | null; candidate: ServiceKey | null } {
  const keys = d.serviceRows.map(r => r.key);
  const one = serviceOfText(d.numberOne);
  const score = (k: ServiceKey) =>
    Object.values(ticks[k] ?? {}).filter(Boolean).length;
  let best: ServiceKey | null = null;
  let top = 0;
  for (const k of keys) {
    const n = score(k);
    if (n > top || (n === top && n > 0 && k === one)) {
      best = k;
      top = n;
    }
  }
  const lead = top > 0 ? best : null;
  const mine = keys.find(k => k === picked) ?? null;
  const likely =
    d.service.key && keys.includes(d.service.key) ? d.service.key : null;
  return { lead, candidate: mine ?? lead ?? likely };
}

/**
 * The matrix's row height (DESIGN 22.14): five rows take 92 px, six (with
 * "Other") 84, room for a name and the client's own words under it, and
 * the table ends above the foot's checklist in both languages. The band
 * moves by it.
 */
export const rowHeight = (rows: number) => (rows > 5 ? 84 : 92);

/** A row's name: the service in the deck's language; "Other" as said. */
const rowName = (key: ServiceKey, lang: Lang) => t(SERVICES[key].name, lang);

/**
 * The service a choice saves (DESIGN 22.14.1): "Launch with this" saves the
 * deck's English label (`SERVICES[key].name.en`, "Construction", not the
 * kickoff's "Construction only") and its Arabic twin, which `serviceOfText`
 * reads back as the same main service as the kickoff's choice; "Other" as
 * the client wrote it.
 */
export function chosenPatch(
  d: DeckData,
  key: ServiceKey,
  prep: Record<string, unknown>,
): Record<string, unknown> {
  const words = d.serviceRows.find(r => r.key === key)?.own[0] ?? null;
  const patch: Record<string, unknown> =
    key === "other"
      ? {
          service_focus: words,
          service_focus_ar: words && ARABIC_LETTER.test(words) ? words : null,
        }
      : {
          service_focus: SERVICES[key].name.en,
          service_focus_ar: SERVICES[key].name.ar,
        };
  // A picture chosen in prep for another service gives way to the choice.
  const pickedPic = parseChoice(prep.example_theme);
  if (
    pickedPic &&
    (key === "other" ||
      (pickedPic.service
        ? pickedPic.service !== key
        : !SCENES[key].includes(pickedPic.scene)))
  )
    patch.example_theme = null;
  return { ...patch, service_chosen_at: true };
}

/** The lead picture for a row on O4's phone: prep's pick for it, else its own lead. */
function sceneFor(d: DeckData, key: ServiceKey | null): Theme {
  if (!key || key === "other") return d.example.theme;
  if (d.example.from === "prep" && d.example.service === key)
    return d.example.theme;
  return SCENES[key][0];
}

function ProductPhone({
  ctx,
  service,
}: {
  ctx: SlideCtx;
  /** The row the phone shows: the chosen one, else the proposal. */
  service: ServiceKey | null;
}) {
  const { d, lang } = ctx;
  const model = useCreatives(ctx);
  const theme = sceneFor(d, service);
  // A custom creative of their own shows instead of the example, untagged
  // (never a starter template: that is what goes live, not their work).
  const own =
    [...model.tray, ...model.meta].find(
      c => !c.starter && phoneFor(c) !== "reels" && (c.url || c.poster),
    ) ?? null;
  const headline =
    service && service !== "other"
      ? t(SERVICES[service].name, lang)
      : d.exampleWords.headline;
  const creative: Creative =
    own ??
    exampleCreative(
      theme,
      "feed",
      { primary: d.exampleWords.primary, headline },
      lang,
    );
  useEffect(() => {
    if (!own) warmExamples([feedUrl(theme)]);
  }, [own, theme]);
  // An example's chrome follows the deck: the tray's Arabic starter
  // templates drew Arabic Instagram around an example in the English deck.
  const app = own ? appLanguage([...model.tray, ...model.meta], lang) : lang;
  return (
    <Tagged
      tag={own ? null : t(EXAMPLE.tag, lang)}
      className="dkc-product-phone"
    >
      <Phone height={640} label={t(SHARED.frame.feed, lang)}>
        {/* The picture changes only once a choice is confirmed, inside the
            screen, as a crossfade. */}
        <StageSwap
          at={creative.id}
          still={ctx.still}
          className="dkc-screen-swap"
        >
          <IgFeed
            creative={creative}
            who={who(d)}
            pageName={d.pageName}
            app={app}
            deck={lang}
          />
        </StageSwap>
      </Phone>
    </Tagged>
  );
}

/**
 * The words a row's quiet line has room for (about 36 characters): whole
 * items only, the rest counted, so no word of theirs is cut mid-way.
 */
export function ownLine(words: string[], room = 36) {
  const shown: string[] = [];
  let used = 0;
  for (const w of words) {
    const add = (shown.length ? 2 : 0) + w.length;
    if (shown.length && used + add > room) break;
    shown.push(w);
    used += add;
  }
  return { shown, more: words.length - shown.length };
}

/** A row's own words, quiet, each in its own direction (never our label again). */
function OwnWords({ words, lang }: { words: string[]; lang: Lang }) {
  if (!words.length) return null;
  const { shown, more } = ownLine(words, lang === "ar" ? 32 : 36);
  // Words all in one script run in its direction (final score round 1):
  // Arabic words in the English deck read right to left, the first on the
  // right with the comma after it, and a Latin line in the Arabic deck
  // reads left to right with its count after it, in Western digits
  // ("Villa fit-out +2", never "+٢" in front of a Latin line).
  const dirs = shown.map(wordsDir);
  const dir = dirs.every(x => x === dirs[0]) ? dirs[0] : undefined;
  // Arabic words on both sides take the Arabic comma, in either deck
  // (score round 4: "عظم وتشطيب, بناء فلل سكنية" in the English deck).
  const sep = (a: string, b: string) =>
    dir === "ltr"
      ? ", "
      : lang === "ar" || (ARABIC_LETTER.test(a) && ARABIC_LETTER.test(b))
        ? "، "
        : ", ";
  const count = digits(more, dir === "ltr" ? "en" : lang);
  return (
    <span className="dkc-service-own" dir={dir}>
      {shown.map((w, i) => (
        <span key={w}>
          {i ? sep(shown[i - 1], w) : null}
          <bdi>{w}</bdi>
        </span>
      ))}
      {/* The count isolated left to right, so it reads +2 at the line's
          end in either direction, never 2+ in front of it. */}
      {more ? (
        <>
          {" "}
          <bdi dir="ltr" className="dkc-service-more">
            {`+${count}`}
          </bdi>
        </>
      ) : null}
    </span>
  );
}

function OneService({ ctx }: { ctx: SlideCtx }) {
  const { d, lang, live, setLive, save, prep } = ctx;
  const { candidate } = leadService(d, live.ticks, live.candidate);
  const rows = d.serviceRows;
  // Chosen is a recorded fact ("Launch with this" stamps it); the likely
  // pick from their answers is the proposal, in ink-2, until they choose.
  const chosenKey = d.service.from === "chosen" ? d.service.key : null;
  const chosen = Boolean(
    d.today.service && candidate && candidate === chosenKey,
  );
  const flip = (service: ServiceKey, test: string) =>
    setLive(l => {
      const row = { ...(l.ticks[service] ?? {}) };
      row[test] = !row[test];
      return { ...l, ticks: { ...l.ticks, [service]: row } };
    });
  const at = rows.findIndex(r => r.key === candidate);
  const rowH = rowHeight(rows.length);
  const one = serviceOfText(d.numberOne);
  const other = rows.find(r => r.key === "other");
  // "Other" names itself in the client's words; with none, it cannot launch.
  const candidateName =
    candidate === "other"
      ? (other?.own[0] ?? null)
      : candidate
        ? rowName(candidate, lang)
        : null;
  const long = (candidateName ?? "").trim().length > 22;
  // The proposal's one rule hugs its longest line (score round 2 of the
  // five services): a wrapped inline block spans its column, so the rule
  // ran 160 px past "Interior / design".
  const nameRef = useRef<HTMLElement>(null);
  useHug(nameRef, `${lang}:${candidateName ?? ""}:${long}`);
  return (
    <>
      <h2 className="dk-h2">{t(O.one.title, lang)}</h2>
      <p className="dk-lead dkc-one-line">{t(O.one.line, lang)}</p>
      <div className="dkc-one">
        {/* The decision: the five main services (the kickoff's own choices)
            against the three tests, the client's own words quiet under the
            service they belong to. A tick is the lanes' passed mark; the
            row the decision points at sits on the band, which moves to it. */}
        <div
          className="dkc-matrix"
          role="table"
          aria-label={t(O.one.title, lang)}
          style={{ "--row-h": `${rowH}px` } as CSSProperties}
        >
          <div className="dkc-matrix-row dkc-matrix-head" role="row">
            <span role="columnheader" />
            {O.one.tests.map(x => (
              <span key={x.key} role="columnheader">
                {t(x.label, lang)}
              </span>
            ))}
          </div>
          <div className="dkc-matrix-body">
            <i
              className="dkc-matrix-band"
              aria-hidden
              data-on={at >= 0 ? "" : undefined}
              style={{ transform: `translateY(${Math.max(0, at) * rowH}px)` }}
            />
            {rows.map((r, i) => {
              const name = rowName(r.key, lang);
              return (
                <div
                  key={r.key}
                  className="dkc-matrix-row"
                  role="row"
                  data-lead={r.key === candidate ? "" : undefined}
                  data-own={r.own.length ? "" : undefined}
                  style={{ "--i": i } as CSSProperties}
                >
                  <span className="dkc-service" role="rowheader">
                    <button
                      type="button"
                      className="dkc-service-name dkc-press"
                      aria-pressed={r.key === candidate}
                      onClick={() => setLive(l => ({ ...l, candidate: r.key }))}
                      onPointerUp={letGo}
                    >
                      <span className="dkc-service-label">{name}</span>
                      <OwnWords words={r.own} lang={lang} />
                    </button>
                    {r.key === one && r.key !== candidate ? (
                      <span className="dkc-numberone">
                        {t(O.one.numberOne, lang)}
                      </span>
                    ) : null}
                  </span>
                  {O.one.tests.map(x => {
                    const on = Boolean(live.ticks[r.key]?.[x.key]);
                    return (
                      <span key={x.key} className="dkc-cell" role="cell">
                        <button
                          type="button"
                          className="dkc-tick dkc-press"
                          aria-pressed={on}
                          aria-label={`${name}: ${t(x.label, lang)}`}
                          onClick={() => flip(r.key, x.key)}
                          onPointerUp={letGo}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden>
                            <path pathLength={1} d="M6 12.5l4 4 8-9" />
                          </svg>
                        </button>
                      </span>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
        {/* The product column, on the ground (no card around the phone):
            what the choice becomes. */}
        <div className="dkc-product">
          <div className="dkc-product-text">
            <span className="dk-label">{t(O.one.first, lang)}</span>
            <p
              className="dkc-product-name"
              data-state={
                chosen ? "chosen" : candidateName ? "proposal" : "none"
              }
              data-long={long ? "" : undefined}
            >
              {candidateName ? (
                <bdi ref={nameRef}>{candidateName}</bdi>
              ) : (
                t(O.one.pending, lang)
              )}
            </p>
            <p className="dk-small dk-ink2">{t(O.one.small, lang)}</p>
            {chosen ? (
              <span className="dkc-chosen">
                <Check aria-hidden />
                {t(O.one.chosen, lang)}
              </span>
            ) : (
              <button
                type="button"
                className="dkc-launch dkc-press"
                disabled={!candidate || !candidateName}
                onClick={() => {
                  if (!candidate || !candidateName) return;
                  save(chosenPatch(d, candidate, prep), true);
                  setLive(l => ({ ...l, candidate }));
                }}
                onPointerUp={letGo}
              >
                {t(O.one.launch, lang)}
              </button>
            )}
          </div>
          <ProductPhone
            ctx={ctx}
            service={chosen ? candidate : (chosenKey ?? candidate)}
          />
        </div>
      </div>
      <div className="dkc-today-foot">
        <TodayList d={d} lang={lang} variant="foot" own={0} />
      </div>
    </>
  );
}

// --------------------------------------------------------------- O5 road

const DAY = 86_400_000;
const isoDay = (v: string) => v.slice(0, 10);
const plusDays = (iso: string, n: number) =>
  new Date(Date.parse(`${isoDay(iso)}T12:00:00Z`) + n * DAY)
    .toISOString()
    .slice(0, 10);

/**
 * The day the road's example confirmation is drawn for (score round 2): a
 * first appointment comes after go-live, so the example's date never falls
 * before the launch call. Go-live when known, else a week after the booked
 * launch call, else three weeks after this call; the slot is two working
 * days later, as the call's own booking is (`bookedSlot`).
 */
export function firstAppointmentDay(d: DeckData): string {
  if (d.goLive) return isoDay(d.goLive);
  if (d.next.launch) return plusDays(d.next.launch, 7);
  return plusDays(d.onboardingDay, 21);
}

/**
 * Where the road ends (score round 2): the WhatsApp message their customer
 * gets when a first appointment is booked (DESIGN 7.6), tagged "Example
 * wording", under the road's last two stops. The live template's lines in
 * their name; the date and time keep the template's Latin digits.
 */
function RoadConfirmation({ d, lang }: { d: DeckData; lang: Lang }) {
  const slot = bookedSlot(firstAppointmentDay(d));
  const company = lang === "ar" ? (d.nameAr ?? d.nameEn) : d.nameEn;
  const lines = [
    { text: plain(CONFIRMATION.opening[lang], lang, d.launch.call.slots) },
    {
      text: tf(CONFIRMATION.date, lang, {
        date: `\u2066${slot.templateDate}\u2069`,
      }),
    },
    {
      text: tf(CONFIRMATION.time, lang, {
        time: `\u2066${slot.templateTime}\u2069`,
      }),
    },
    { text: t(CONFIRMATION.closing, lang) },
  ];
  return <Confirmation who={who(d)} name={company} lines={lines} />;
}

function RoadSlide({ ctx }: { ctx: SlideCtx }) {
  const { d, lang, still } = ctx;
  const date = (v: string | null | undefined, full = false) =>
    v ? (
      <span className="dk-num">
        {full ? dayShort(v, lang, d.timeZone) : dayMonth(v, lang, d.timeZone)}
      </span>
    ) : null;
  const stops: RouteStop[] = O.road.stops.map((name, i) => {
    const stop: RouteStop = { name: t(name, lang) };
    // A step passed with no date on file is still said: done.
    if (i < d.roadNow)
      stop.when = date(d.roadDays[i]) ?? t(SHARED.status.done, lang);
    else if (i === d.roadNow && i === 2)
      stop.when = (
        <span className="dkc-road-today">{t(O.road.today, lang)}</span>
      );
    else if (i === 5) stop.when = t(O.road.afterGoLive, lang);
    else stop.when = date(d.roadDays[i], true);
    // The launch call: its date once booked, else how long it takes; what
    // happens on it under that.
    if (i === 4) {
      stop.when = stop.when ?? t(O.road.launchTime, lang);
      stop.line = t(O.road.launchLine, lang);
    }
    // The road's payoff hangs from its last stop (22.14).
    if (i === O.road.stops.length - 1) stop.drop = true;
    return stop;
  });
  return (
    <>
      <h2 className="dk-h2">{t(O.road.title, lang)}</h2>
      <div className="dkc-way-wrap">
        <Route stops={stops} now={d.roadNow} still={still} />
        {/* The road ends at its payoff (score round 2): under its last two
            stops, hung from the last by a dotted drop (22.14: it read as a
            card belonging to no step), the confirmation their customer
            gets, rising once the road has lit; the foot line on the start
            half, set as the slide's second statement beside it. */}
        <div className="dkc-road-end">
          <p className="dk-body dk-ink2 dkc-road-foot">
            {t(O.road.footer, lang)}
          </p>
          <Tagged
            tag={t(SHARED.tag.exampleWording, lang)}
            className="dkc-road-card"
            style={{
              animationDelay: `calc(${routeMs(d.roadNow)}ms * var(--dk-m))`,
            }}
          >
            <RoadConfirmation d={d} lang={lang} />
          </Tagged>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------- O6 this week

/** The next status a click gives: not checked yet, then done, then to do. */
export function nextStatus(s: AccessStatus): AccessStatus {
  return s === "done" ? "todo" : "done";
}

function StatusChip({
  status,
  lang,
  onFlip,
  label,
}: {
  status: AccessStatus;
  lang: SlideCtx["lang"];
  onFlip?: () => void;
  label: string;
}) {
  const words = t(SHARED.status[status], lang);
  if (!onFlip)
    return (
      <span className="dkc-status" data-status={status}>
        {words}
      </span>
    );
  return (
    <button
      type="button"
      className="dkc-status dkc-press"
      data-status={status}
      aria-label={`${label}: ${words}`}
      onClick={onFlip}
      onPointerUp={letGo}
    >
      {words}
    </button>
  );
}

/** The video guide a setup card offers, by row: only once it is recorded. */
const GUIDE: Partial<Record<AccessRow["key"], string>> = {
  meta: "meta-access",
  os: "whatsapp-calendar",
  crm: "whatsapp-calendar",
};

/** One step ring on a card: the lanes' marks, flipped by the CSM's click. */
function StepRing({
  done,
  label,
  status,
  onFlip,
  lang,
  k,
}: {
  done: boolean;
  label: string;
  status: AccessStatus;
  onFlip: () => void;
  lang: Lang;
  /** Its place in the board's order: what was done ticks in turn on arrival. */
  k: number;
}) {
  // What was done when the card opened ticks in order as the slide
  // arrives (22.14, "the checklist ticking"); a later tick draws at once.
  const atOpen = useRef(done);
  return (
    <button
      type="button"
      className="dkc-step dkc-press"
      data-status={status}
      data-arrive={done && atOpen.current ? "" : undefined}
      style={{ "--k": k } as CSSProperties}
      data-draw={done && !atOpen.current ? "" : undefined}
      aria-label={`${label}: ${t(SHARED.status[status], lang)}`}
      onClick={onFlip}
      onPointerUp={letGo}
    >
      <svg viewBox="0 0 28 28" aria-hidden>
        <circle className="dkc-step-ring" cx="14" cy="14" r="13" />
        <g className="dkc-step-done">
          <circle cx="14" cy="14" r="13" />
          <path pathLength={1} d="M8.5 14.5l3.5 3.5 7.5-8" />
        </g>
      </svg>
      <span>{label}</span>
    </button>
  );
}

function SetupCard({
  row,
  ctx,
  wide,
  from,
  i,
}: {
  row: AccessRow;
  ctx: SlideCtx;
  /** Two cards to a row: room for the video guide's poster (22.14). */
  wide: boolean;
  /** The board's count of steps before this card's first. */
  from: number;
  /** The card's place in the row, for its arrival. */
  i: number;
}) {
  const { d, lang, prep, save } = ctx;
  const [broken, setBroken] = useState(false);
  // A guide's poster shows once decoded (22.3.2), never painting in after
  // the card has built; the deck warmed it when it opened.
  const [decoded, setDecoded] = useState(false);
  const shown = (e: { currentTarget: HTMLImageElement }) => {
    const img = e.currentTarget;
    const ok = () => setDecoded(true);
    if (img.decode) img.decode().then(ok, ok);
    else ok();
  };
  const access = record(prep.access);
  const flip = (key: string, from: AccessStatus) =>
    save({ access: { ...access, [key]: nextStatus(from) } }, true);
  const name = t(row.name, lang);
  const done = row.status === "done";
  const atOpen = useRef(done);
  const slot = GUIDE[row.key];
  const guide = slot
    ? filledOn(d, "this-week").find(v => v.slot.key === slot)
    : undefined;
  const len = guide ? lengthText(guide.row.durationSeconds, lang) : null;
  // The guide's own picture, on a card with room for it (22.14: the slide
  // had no picture); the text control where it has none or it fails.
  const pic =
    wide && guide && ctx.playVideo && !broken ? posterFor(guide.row) : null;
  // No guide's picture on the Mahara OS card: the app itself, its first
  // screen on a phone rising from the card's foot (22.14), so the slide
  // keeps a picture before the guide is recorded.
  const osPhone = wide && !pic && row.key === "os";
  // With no length, the words alone: the separator goes with the slot.
  const guideWords = len
    ? tf(O.week.guide, lang, { len })
    : tf(O.week.guide, lang, { len: "" }).replace(/(?: ·|،)\s*$/, "");
  return (
    <article
      className="dkc-setup"
      data-status={row.status}
      data-draw={done && !atOpen.current ? "" : undefined}
      data-poster={pic || osPhone ? "" : undefined}
      // The status lands after the card's last tick has drawn (score round
      // 4: "Done" came before its rings).
      style={{ "--i": i, "--k-end": from + row.ticks.length } as CSSProperties}
    >
      <i className="dkc-setup-edge" aria-hidden />
      {osPhone ? (
        <figure className="dkc-setup-phone" aria-hidden>
          <figcaption className="dk-tag">{t(SHARED.tag.demo, lang)}</figcaption>
          <span className="dkc-setup-phone-body">
            <img
              src={lang === "ar" ? osPhoneAr : osPhoneEn}
              alt=""
              draggable={false}
            />
          </span>
        </figure>
      ) : null}
      {pic && guide ? (
        <button
          type="button"
          className="dkc-setup-poster dkc-press"
          aria-label={guideWords}
          onClick={() => ctx.playVideo?.(guide)}
          onPointerUp={letGo}
        >
          <span
            className="dkc-setup-pic"
            data-decoded={decoded ? "" : undefined}
          >
            <img
              ref={el => {
                if (el?.complete && el.naturalWidth > 0 && !decoded)
                  shown({ currentTarget: el });
              }}
              src={pic.src}
              alt=""
              draggable={false}
              referrerPolicy="no-referrer"
              onLoad={shown}
              onError={() => setBroken(true)}
            />
            <span className="dkc-setup-play" aria-hidden>
              <svg viewBox="0 0 16 16" aria-hidden>
                <path d="M4 2v12l10-6z" fill="currentColor" />
              </svg>
            </span>
          </span>
          <span className="dkc-setup-pic-words" aria-hidden>
            {guideWords}
          </span>
        </button>
      ) : null}
      {/* The video guide sits on the head's line, before the status (score
          round 2: on a row of its own it left a dead band at the card's
          foot, and beside three steps it had no room). */}
      <header className="dkc-setup-head">
        <h3 className="dkc-setup-name">{name}</h3>
        {guide && ctx.playVideo && !pic ? (
          // Three cards to a row (done with you): the play mark and the
          // length alone on the head's line (score round 2 of the five
          // services: an 80 x 45 picture there crowded the line and read as
          // a blank button).
          <button
            type="button"
            className="dkc-guide dkc-press"
            aria-label={guideWords}
            onClick={() => ctx.playVideo?.(guide)}
            onPointerUp={letGo}
          >
            <svg viewBox="0 0 16 16" aria-hidden>
              <path d="M3 1.5v13l11-6.5z" fill="currentColor" />
            </svg>
            {/* Three cards to a row: the play mark and the length only. */}
            {len ? (
              <span aria-hidden>
                <span className="dkc-guide-word">
                  {tf(O.week.guide, lang, { len: "" })}
                </span>
                {len}
              </span>
            ) : (
              <span aria-hidden>{guideWords}</span>
            )}
          </button>
        ) : null}
        <StatusChip status={row.status} lang={lang} label={name} />
      </header>
      <p className="dkc-setup-line">{t(row.line, lang)}</p>
      <div className="dkc-setup-steps">
        {row.ticks.map((k, j) => (
          <StepRing
            key={k.key}
            done={k.status === "done"}
            status={k.status}
            label={t(k.label, lang)}
            onFlip={() => flip(k.key, k.status)}
            lang={lang}
            k={from + j}
          />
        ))}
      </div>
    </article>
  );
}

function LaterRow({
  row,
  ctx,
  i,
}: {
  row: AccessRow;
  ctx: SlideCtx;
  i: number;
}) {
  const { d, lang, prep, save } = ctx;
  const access = record(prep.access);
  const flip = (key: string, from: AccessStatus) =>
    save({ access: { ...access, [key]: nextStatus(from) } }, true);
  const name = t(row.name, lang);
  const single = row.ticks.length === 1 ? row.ticks[0] : null;
  return (
    <li data-status={row.status} style={{ "--i": i } as CSSProperties}>
      <span className="dkc-later-name">{name}</span>
      <span className="dkc-later-what">
        {t(row.line, lang)}
        {row.key === "content" ? (
          <span className="dkc-later-more">
            {d.links.drive ? (
              <a
                href={d.links.drive}
                target="_blank"
                rel="noreferrer"
                onPointerUp={letGo}
              >
                <FolderOpen aria-hidden />
                {t(SHARED.driveLink, lang)}
              </a>
            ) : (
              t(SHARED.driveMissing, lang)
            )}
          </span>
        ) : null}
      </span>
      <StatusChip
        status={row.status}
        lang={lang}
        label={name}
        onFlip={single ? () => flip(single.key, single.status) : undefined}
      />
    </li>
  );
}

const NOW_KEYS = new Set<AccessRow["key"]>(["meta", "os", "crm", "phones"]);

function ThisWeek({ ctx }: { ctx: SlideCtx }) {
  const { d, lang } = ctx;
  // Two groups, two weights: the setup done live on this call as cards,
  // the homework as ruled rows. The old lead is said, not shown: "Now, on
  // this call" says it.
  const now = d.access.filter(r => NOW_KEYS.has(r.key));
  const later = d.access.filter(r => !NOW_KEYS.has(r.key));
  return (
    <>
      <h2 className="dk-h2">{t(O.week.title, lang)}</h2>
      <div className="dkc-week-board">
        <p className="dkc-week-group">{t(O.week.now, lang)}</p>
        <div className="dkc-setups" data-n={now.length}>
          {now.map((r, i) => (
            <SetupCard
              key={r.key}
              row={r}
              ctx={ctx}
              wide={now.length <= 2}
              from={now.slice(0, i).reduce((n, x) => n + x.ticks.length, 0)}
              i={i}
            />
          ))}
        </div>
        <p className="dkc-week-group">{t(O.week.later, lang)}</p>
        <ul className="dkc-later">
          {later.map((r, i) => (
            <LaterRow key={r.key} row={r} ctx={ctx} i={i} />
          ))}
        </ul>
      </div>
      <div className="dkc-today-foot">
        <TodayList d={d} lang={lang} variant="foot" own={1} />
      </div>
    </>
  );
}

// --------------------------------------------------------------- O7 next

const ARABIC_LETTER = /[؀-ۿ]/;

/**
 * The launch service as O7 says it inside a sentence (DESIGN 22.14): one
 * of the five main services in its sentence form ("templates for interior
 * design", لخدمة التصميم الداخلي), or "Other" in the client's own words.
 * Words only in Latin letters are left unnamed in the Arabic deck, as the
 * journey's queue card keeps a name in the other script off its rows: a
 * Latin name inside an Arabic line mixed two scripts (the fixer's round).
 * The launch deck reads the same service, so both calls name it the same.
 */
export function o7Service(d: DeckData): string | null {
  const s = d.serviceMid;
  if (!s) return null;
  if (d.lang === "ar") return ARABIC_LETTER.test(s) ? s : null;
  return s;
}

/** The first-ads sentence for the kickoff's templated-ads answer (CONTENT O7). */
export function firstAdsLine(d: DeckData) {
  const service = o7Service(d);
  const pack = d.starterPack && service;
  if (d.templated === "declined")
    return { line: O.next.declined, service: null };
  if (d.templated === "approved")
    return pack
      ? { line: O.next.approved, service }
      : { line: O.next.approvedNoPack, service: null };
  return pack
    ? { line: O.next.pending, service }
    : { line: O.next.pendingNoPack, service: null };
}

function RedLines({ ctx }: { ctx: SlideCtx }) {
  const { d, lang, prep, save } = ctx;
  const [value, setValue] = useState("");
  const key =
    lang === "ar" && strings(prep.red_lines_ar).length
      ? "red_lines_ar"
      : "red_lines";
  const lines = d.redLines;
  const add = () => {
    const v = value.trim();
    if (v) save({ [key]: [...lines, v] }, true);
    setValue("");
  };
  // Each line as the launch deck sets a red line: an amber mark (theirs,
  // and fixed), then their words in ink. No panel and no box around them.
  // Lines all in one script set the list's direction (fixer round 2): the
  // block sits at the column's start, as wide as its widest line, its
  // bullets on its own start, so English lines in the Arabic deck no longer
  // hug the column's far edge. A mixed list keeps each line's own.
  const dirs = lines.map(wordsDir);
  const listDir = dirs.every(x => x === dirs[0]) ? dirs[0] : undefined;
  const input = (
    <input
      className="dkc-redline-input"
      dir={value.trim() ? "auto" : lang === "ar" ? "rtl" : "ltr"}
      value={value}
      placeholder={t(O.next.input, lang)}
      aria-label={t(O.next.input, lang)}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => {
        if (e.key === "Enter") {
          e.preventDefault();
          add();
        }
      }}
      onBlur={add}
    />
  );
  // Nothing typed yet (fixer round 2: the sentence alone left 400 px dead
  // under it): three faint rows with their amber marks, dashed, to be
  // filled; the first is the input itself.
  if (!lines.length)
    return (
      <div className="dkc-redlines" data-empty="">
        <div className="dkc-redline-row">
          <i aria-hidden />
          {input}
        </div>
        {[1, 2].map(k => (
          <div key={k} className="dkc-redline-row" aria-hidden>
            <i />
            <span />
          </div>
        ))}
      </div>
    );
  // Fewer than three typed (final score round 1: one line ended the column
  // at y 540 beside a strip running to y 972): the rows left to fill stay
  // drawn under them, dashed, the first the input itself, so the list
  // keeps three rows whatever was typed.
  const blanks = Math.max(0, 3 - lines.length);
  return (
    <div className="dkc-redlines" data-blanks={blanks ? "" : undefined}>
      {lines.length ? (
        <ul dir={listDir}>
          {lines.map(l => (
            // Each line in its own direction (score round 4): an Arabic red
            // line in the English deck has its bullet at its own start. Set
            // from the words (dir="auto" on the item would skip the words'
            // own isolate and read left to right).
            <li key={l} dir={wordsDir(l)}>
              <i aria-hidden />
              <span dir="auto" className="dkc-theirs">
                {l}
              </span>
              <button
                type="button"
                className="dkc-press"
                aria-label={`Remove: ${l}`}
                onClick={() =>
                  save({ [key]: lines.filter(x => x !== l) }, true)
                }
                onPointerUp={letGo}
              >
                <X aria-hidden style={{ width: 20, height: 20 }} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {blanks ? (
        <>
          <div className="dkc-redline-row">
            <i aria-hidden />
            {input}
          </div>
          {Array.from({ length: blanks - 1 }, (_, k) => (
            <div key={k} className="dkc-redline-row" aria-hidden>
              <i />
              <span />
            </div>
          ))}
        </>
      ) : (
        input
      )}
    </div>
  );
}

function StarterAds({ ctx }: { ctx: SlideCtx }) {
  const { d, lang } = ctx;
  const creatives: Creative[] = d.starterAds.map(creativeOf);
  const app = appLanguage(creatives, lang);
  const feed =
    creatives.find(c => phoneFor(c) !== "reels") ?? creatives[0] ?? null;
  const reel = creatives.find(c => phoneFor(c) === "reels") ?? feed;
  const props = { who: who(d), pageName: d.pageName, app, deck: lang };
  // The title at the top, the tag said once beside it (not over each
  // phone), then what these are under the tag. No example ever stands in
  // for a starter: this stop shows what goes live (DESIGN 22.4.6).
  const service = d.starterPack ? o7Service(d) : null;
  return (
    <div className="dkc-starter">
      <div className="dkc-starter-side">
        <div className="dkc-title-tag">
          <h2 className="dk-h2">{t(O.next.starterTitle, lang)}</h2>
          {feed || reel ? (
            <span className="dk-tag">{t(SHARED.tag.starter, lang)}</span>
          ) : null}
        </div>
        <p className="dk-body dk-ink2 dkc-starter-line">
          {service
            ? tf(O.next.starterLine, lang, { service })
            : t(O.next.starterLineNoPack, lang)}
        </p>
      </div>
      {/* 800 tall with the words' measure at 640 (score round 2): a 370 px
          gap stood between the words and the phones. */}
      <div className="dkc-starter-phones">
        <PhoneFigure
          height={800}
          mark="instagram"
          label={t(SHARED.frame.feed, lang)}
          head={false}
        >
          <IgFeed creative={feed} {...props} />
        </PhoneFigure>
        <PhoneFigure
          height={800}
          mark="instagram"
          label={t(SHARED.frame.reels, lang)}
          head={false}
        >
          <ReelStory creative={reel} {...props} />
        </PhoneFigure>
      </div>
    </div>
  );
}

/**
 * The grid's two lit tiles (DESIGN 22.2.7, 22.15): many tested, a few kept.
 * Both are their own service's scenes, its lead on tile 0 and its first
 * alternate on tile 4 (`stripTiles`): a kitchen lit as a winner for an
 * interior client contradicted the CEO's correction.
 */
export { STRIP_LIT };

/**
 * The order the other four switch off on arrival (score round 2): scattered,
 * never a sweep along the grid.
 */
const STRIP_OFF = [3, 1, 5, 2];

/**
 * Six example tiles in one row, under "We test many ads, fast" (score round 2:
 * under "Your first ads" a client read them as their first ads, half
 * rejected). L3's field in miniature, tagged once: on arrival all six are
 * lit, then four switch off one after another, about 560 ms in all, and two
 * stay lit (under still=1 and reduced motion, that end at once). The row
 * spans the column at 4:5 (fixer round 2), about 127 x 159, and leaves the
 * slide when there is too little room for it to read as a picture.
 */
function TestStrip({ ctx }: { ctx: SlideCtx }) {
  const { d, lang } = ctx;
  // Their service's scenes first (its lead on tile 0, lit), then the rest.
  // Never a scene a starter template was cut from (DESIGN 22.18): stop 2
  // shows the starters as theirs.
  const tiles = useMemo(
    () =>
      stripTiles(d.example, 6, scenesNamed(d.starterAds.map(a => a.fileName))),
    [d.example, d.starterAds],
  );
  return (
    <div className="dkc-strip">
      <span className="dk-tag">{t(EXAMPLE.tags, lang)}</span>
      <ul aria-hidden>
        {tiles.map((src, i) => {
          const off = STRIP_OFF.indexOf(i);
          return (
            <li
              key={src}
              data-lit={STRIP_LIT.has(i) ? "" : undefined}
              style={off >= 0 ? ({ "--o": off } as CSSProperties) : undefined}
            >
              <img src={src} alt="" draggable={false} decoding="async" />
              <i />
              <b />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The service a starter pack was ticked for, in prep's words. */
const packName = (k: ServiceKey) =>
  k === "other" ? "their own service" : SERVICES[k].name.en;

/** O7's stops: what to expect, the starter ads (when there are), the Blueprint. */
export const nextStops = (d: DeckData) => (showsStarter(d) ? 3 : 2);

function Expect({ ctx }: { ctx: SlideCtx }) {
  const { d, lang } = ctx;
  const first = firstAdsLine(d);
  return (
    <div className="dkc-expect">
      <h2 className="dk-h2">{t(O.next.titleExpect, lang)}</h2>
      {/* Each picture beside its words (score round 2): the approval and
          the red lines are one idea, under the first ads; the strip of
          tested ads under "We test many ads, fast". */}
      <div className="dkc-next">
        <section>
          <h3 className="dk-h3">{t(O.next.adsName, lang)}</h3>
          <p className="dk-body">
            {tf(first.line, lang, { service: first.service ?? "" })}
          </p>
          <p className="dkc-next-small">{t(O.next.approval, lang)}</p>
          {/* The ask heads the list it fills, in ink. */}
          <div className="dkc-next-ask">
            <p>{t(O.next.testAsk, lang)}</p>
            <RedLines ctx={ctx} />
          </div>
        </section>
        <section className="dkc-next-test">
          <h3 className="dk-h3">{t(O.next.testName, lang)}</h3>
          <p className="dkc-next-job">{t(O.next.testLine, lang)}</p>
          <p className="dkc-next-small">{t(O.next.testVolume, lang)}</p>
          <TestStrip ctx={ctx} />
        </section>
      </div>
    </div>
  );
}

const HOUR = 3_600_000;

/**
 * The booked Blueprint call as their calendar shows it (the fixer's round),
 * in the journey calendar's style (L2 stop 5): the day, the hour lines, and
 * the call as a block 45 minutes long from its start. Built from
 * `next.blueprint` alone. Not booked: the same card at full size as an
 * empty day (score round 2: a small card over an empty half read
 * unfinished), the call's name on the day row, three hour lines with no
 * times, and one dashed 45-minute block holding an open ring and when it
 * gets booked, never a made-up time. Once the booking reads back, the day
 * and time take its place and the block's teal fades in.
 */
function BlueprintCard({ d, lang }: { d: DeckData; lang: Lang }) {
  // Opened after the Blueprint (the stage past it, CONTENT O5): the call
  // as it was held, or Done, never "We book it" beside a road that shows it
  // done (final score round 1).
  const held = !d.next.blueprint && d.roadNow > 3;
  // The kickoff is sent (the last slide's Submit, or on record): the
  // Blueprint is booked on our side and only its time is left, so the
  // block is ticked with the checklist and says so (2026-10-22).
  const picking = !held && Boolean(d.kickoff.sentAt);
  const when = d.next.blueprint ?? (held ? d.last.blueprint : undefined);
  const at = toDate(when);
  const timed = Boolean(at && clock(when, lang, d.timeZone));
  if (!at)
    return (
      <div className="dkc-cal dkc-cal-next" data-open="">
        <b className="dkc-cal-day">{t(O.next.cardName, lang)}</b>
        <div className="dkc-cal-grid">
          {[0, 1, 2].map(k => (
            <div key={k} className="dkc-cal-hour">
              <span className="dkc-cal-time" />
              <i />
              {k === 0 ? (
                <span
                  className="dkc-cal-block"
                  data-open=""
                  data-done={held || picking ? "" : undefined}
                >
                  <span className="dkc-cal-open">
                    <svg viewBox="0 0 28 28" aria-hidden>
                      <circle cx="14" cy="14" r="13" />
                      {held || picking ? (
                        <path d="M8.5 14.5l3.8 3.8 7.2-8" />
                      ) : null}
                    </svg>
                    {held
                      ? t(SHARED.status.done, lang)
                      : picking
                        ? t(O.next.cardPick, lang)
                        : t(O.next.cardOpen, lang)}
                  </span>
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    );
  // The hour the call starts in, then the next two; Gulf zones keep whole
  // hours, so the minutes past the hour are the same on every clock.
  const minutes = at.getUTCMinutes();
  const top = at.getTime() - minutes * 60_000;
  const rows = timed ? [0, 1, 2] : [];
  return (
    <div
      key={String(when)}
      className="dkc-cal dkc-cal-next"
      style={{ "--cal-min": minutes / 60 } as CSSProperties}
    >
      <b className="dkc-cal-day">
        {weekdayDate(at.getTime(), lang, d.timeZone)}
      </b>
      {timed ? (
        <div className="dkc-cal-grid">
          {rows.map(k => (
            <div key={k} className="dkc-cal-hour">
              <span className="dkc-cal-time">
                {clock(top + k * HOUR, lang, d.timeZone)}
              </span>
              <i />
              {k === 0 ? (
                <span className="dkc-cal-block" data-anchor="">
                  <b>{t(O.next.cardName, lang)}</b>
                  <span>{t(O.next.cardWith, lang)}</span>
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <span className="dkc-cal-block" data-flat="">
          <b>{t(O.next.cardName, lang)}</b>
          <span>{t(O.next.cardWith, lang)}</span>
        </span>
      )}
    </div>
  );
}

function Blueprint({ ctx }: { ctx: SlideCtx }) {
  const { d, lang } = ctx;
  // The call's name never breaks (final score round 1: "Next: your Brand /
  // Blueprint call"): the title breaks before it, if at all.
  const head = t(O.next.bandHead, lang);
  const name = t(O.next.cardName, lang);
  const title = head.includes(name)
    ? head.replace(name, name.replace(/ /g, "\u00a0"))
    : head;
  // The deck ends on the next call: what it is beside it as their calendar
  // will show it, then the call's checklist, closed.
  return (
    <div className="dkc-blueprint">
      <div className="dkc-blueprint-head">
        <div className="dkc-blueprint-words">
          <h2 className="dk-h1 dkc-blueprint-title">{title}</h2>
          <p className="dk-lead dkc-blueprint-line">
            {t(O.next.bandRest, lang)}
          </p>
        </div>
        <BlueprintCard d={d} lang={lang} />
      </div>
      <div className="dkc-blueprint-today">
        <TodayList d={d} lang={lang} variant="close" />
      </div>
    </div>
  );
}

function Next({ ctx }: { ctx: SlideCtx }) {
  const { d, tour, still } = ctx;
  const last = nextStops(d) - 1;
  const at = tour >= last ? "blueprint" : tour === 1 ? "starter" : "expect";
  // The stage swap carries the whole stop, words and pictures alike, out
  // and then in: the three stops are different layouts, never drawn over
  // each other.
  return (
    <StageSwap at={at} still={still} sequential className="dkc-next-stop">
      {at === "blueprint" ? (
        <Blueprint ctx={ctx} />
      ) : at === "starter" ? (
        <StarterAds ctx={ctx} />
      ) : (
        <Expect ctx={ctx} />
      )}
    </StageSwap>
  );
}

// ---------------------------------------------------------- the slides

const showsStarter = (d: DeckData) => d.starterPack && d.starterAds.length > 0;

const nextStopName = (i: number, ctx: SlideCtx): L | null => {
  const last = nextStops(ctx.d) - 1;
  if (i >= last) return O.next.bandHead;
  if (i === 1) return O.next.starterTitle;
  return O.next.titleExpect;
};

export function onboardingSlides(): SlideDef[] {
  return [
    {
      id: "welcome",
      title: O_TITLES.welcome,
      cover: true,
      notes: O_NOTES.welcome,
      render: ctx => <Welcome ctx={ctx} />,
      missing: d => [
        ...(d.logo
          ? []
          : ["No logo. Upload one, or the deck shows their first letter."]),
        ...(d.csmFirst
          ? []
          : [
              "Your first name is not on your seat, so the cover shows your role only.",
            ]),
      ],
    },
    {
      id: "goals",
      title: O_TITLES.goals,
      notes: O_NOTES.goals,
      stops: ctx => goalsView(ctx.d).stops,
      render: ctx => <Goals ctx={ctx} />,
      missing: d => {
        const out: string[] = [];
        if (!shownGoals(d).length)
          out.push(
            "No goals in their onboarding form yet. The slide asks the question, and you type their answer on the call.",
          );
        for (const g of d.goals)
          if (g.held)
            out.push(
              `"${g.label.en}" is held back: ${g.held === "count" ? "it counts enquiries or appointments" : "it mentions a guarantee or a refund"}. Edit it here to show it.`,
            );
        return out;
      },
    },
    {
      id: "team",
      title: O_TITLES.team,
      notes: O_NOTES.team,
      stops: () => 2,
      render: ctx => <Team ctx={ctx} />,
      missing: d =>
        d.mode.known
          ? []
          : [
              "Service model not set. The deck uses done for you. Change it if their team calls.",
            ],
    },
    {
      id: "one-service",
      title: O_TITLES["one-service"],
      notes: O_NOTES["one-service"],
      render: ctx => <OneService ctx={ctx} />,
      missing: d =>
        d.services.length
          ? []
          : [
              "No services in the onboarding form. Press Add a service and type them as the client says them.",
            ],
      todo: d =>
        d.today.service
          ? []
          : [
              "The client picks the launch service on the call: press Launch with this on slide 4, and the checklist ticks it.",
            ],
    },
    {
      id: "road",
      title: O_TITLES.road,
      notes: O_NOTES.road,
      render: ctx => <RoadSlide ctx={ctx} />,
    },
    {
      id: "this-week",
      title: O_TITLES["this-week"],
      notes: O_NOTES["this-week"],
      render: ctx => <ThisWeek ctx={ctx} />,
      missing: d =>
        d.kickoffFiled
          ? []
          : [
              "The kickoff form is not filed yet, so every row reads Not checked yet until you tick it.",
            ],
    },
    {
      id: "next",
      title: O_TITLES.next,
      notes: O_NOTES.next,
      stops: ctx => nextStops(ctx.d),
      stopName: nextStopName,
      render: ctx => <Next ctx={ctx} />,
      missing: d => [
        ...(d.starterPack
          ? []
          : d.starterPackFor
            ? [
                `The starter pack is ticked for ${packName(d.starterPackFor)}, not ${d.serviceFocus ?? "the service chosen on slide 4"}, so this slide doesn't name the service or show the pack. Tick it again on slide 4's controls if a pack fits.`,
              ]
            : [
                `Starter pack${d.serviceFocus ? ` for ${d.serviceFocus}` : ""}? Tick it only if a ready pack exists. Otherwise this slide doesn't name the service.`,
              ]),
        ...(d.lang === "ar" && d.serviceFocus && !o7Service(d)
          ? [
              `The Arabic deck leaves "${d.serviceFocus}" unnamed on this slide. Type their service in Arabic in prep (Launch service, Other) to name it.`,
            ]
          : []),
        ...(d.starterPack && !d.starterAds.length
          ? [
              "No starter ads in the tray, so the starter ads stop stays hidden.",
            ]
          : []),
        ...(d.next.blueprint
          ? []
          : [
              "Book the Brand Blueprint call from the notes window, once the kickoff on the next slide is sent.",
            ]),
      ],
    },
    {
      id: KICKOFF_SLIDE,
      title: O_TITLES.kickoff,
      notes: O_NOTES.kickoff,
      render: ctx => <KickoffSlide ctx={ctx} />,
      missing: d =>
        d.kickoff.from === "record" || d.kickoff.prefilled
          ? []
          : [
              "No onboarding answers on record, so the kickoff opens with their name and card only. Send them their onboarding link first if there is time.",
            ],
      todo: d =>
        d.kickoff.from === "record"
          ? [
              "The kickoff is on record, so this slide shows what was filled, never a fresh form.",
            ]
          : d.kickoff.from === "call"
            ? []
            : [
                "Fill the kickoff with them on this slide and press Submit in the form. The checklist ticks the Blueprint call once it is sent.",
              ],
    },
  ];
}
