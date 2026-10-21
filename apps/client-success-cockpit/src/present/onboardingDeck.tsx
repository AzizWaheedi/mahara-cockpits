import { Check, FolderOpen, Plus, X } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import maharaLogo from "@/assets/mahara-logo-dark.png";
import { useCreatives } from "./AdsStage";
import { bookedSlot, CONFIRMATION, plain } from "./callScript";
import {
  EXAMPLE,
  type L,
  type Lang,
  O,
  O_NOTES,
  O_TITLES,
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
  storyUrl,
  THEMES,
  themeOfText,
  tileUrl,
  warmExamples,
} from "./examples";
import { useHug } from "./hug";
import { Confirmation, Tagged } from "./mockups/Cards";
import { ClientMark, type Identity } from "./mockups/Identity";
import { IgFeed, Phone, PhoneFigure, ReelStory } from "./mockups/Phones";
import { WhatsAppGroup } from "./mockups/WhatsAppGroup";
import { Route, type RouteStop, routeMs } from "./Road";
import { StageSwap } from "./StageSwap";
import { TodayList } from "./TodayList";
import { filledOn, lengthText } from "./videos";

/**
 * The onboarding deck: seven slides, about 22 minutes of a 45 to 60 minute
 * call with the setup done live while slide 6 is up (docs/csm-decks/
 * CONTENT.md, DESIGN.md 9 and 22.2). Each slide has its own structure (a
 * cover with the call's checklist, a quotation set as type, a hub, a
 * matrix beside a product column, a route, a board, two columns under a
 * strip of example ads), and the call's checklist is the one drawing that
 * persists: the agenda on the cover, ticked at the foot of slides 4 and 6
 * from data, closed on the last stop. Every word is in content.ts; this
 * file only places them.
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
  const date = dayMonth(d.onboardingDay, lang, d.timeZone);
  return (
    <>
      <header className="dkc-letterhead">
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
            <span dir="auto" className="dkc-welcome-name">
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

/** The goal's size by its length: 80, then 64, then 56 (at most three lines). */
const goalSize = (text: string) =>
  text.length > 150 ? "56" : text.length > 90 ? "64" : "80";

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
      dir="auto"
      value={value}
      placeholder={t(O.goals.input, lang)}
      aria-label={t(O.goals.input, lang)}
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
function Answers({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLUListElement>(null);
  useHug(ref, lines.join("\n"));
  return (
    <ul ref={ref} data-hug="">
      {lines.map(l => (
        <li key={l} className="dkc-theirs" dir="auto">
          {l}
        </li>
      ))}
    </ul>
  );
}

/** One answer, hugging its lines so they keep their own start. */
function AnswerText({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useHug(ref, text);
  return (
    <p ref={ref} className="dkc-theirs" dir="auto" data-hug="">
      {text}
    </p>
  );
}

function GoalRow({ goals, lang }: { goals: Goal[]; lang: Lang }) {
  return (
    <div className="dkc-goal-row" data-n={goals.length}>
      {goals.map(g => (
        <div key={g.key} className="dkc-goal-col">
          <span className="dk-label">{t(g.label, lang)}</span>
          {g.key === "challenges" ? (
            <Answers lines={g.lines} />
          ) : (
            <AnswerText text={g.lines[0] ?? ""} />
          )}
        </div>
      ))}
    </div>
  );
}

function Goals({ ctx }: { ctx: SlideCtx }) {
  const { d, lang, tour } = ctx;
  const { lead, rest } = goalsView(d);
  const leadRef = useRef<HTMLParagraphElement>(null);
  useHug(leadRef, lead?.lines[0] ?? "");
  const row = tour >= 1 && rest.length ? rest : null;
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
          // the slide's middle (the fixer's round); with answers to come on
          // stop 2 it keeps the top, so nothing moves when they arrive.
          data-alone={rest.length ? undefined : ""}
        >
          <h2 className="dk-h1 dkc-goal-ask">{t(O.goals.empty, lang)}</h2>
          <span className="dk-label dkc-goal-label">
            {t(O.goals.goal90, lang)}
          </span>
          <GoalInput ctx={ctx} />
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
      {/* Stop 1: the goal alone, their words set as type. It never moves
          or shrinks when the rest arrives. */}
      <div className="dkc-goal-block">
        <span className="dk-label">{t(lead.label, lang)}</span>
        <p
          ref={leadRef}
          className="dkc-goal-text dkc-theirs"
          data-size={goalSize(lead.lines[0] ?? "")}
          // Their words in Latin letters keep the Latin type's line height
          // in the Arabic deck too (Arabic's taller one pushed stop 2's
          // row into the foot).
          data-latin={
            /[\u0600-\u06ff]/.test(lead.lines[0] ?? "") ? undefined : ""
          }
          dir="auto"
          data-hug=""
        >
          {lead.lines[0]}
        </p>
      </div>
      {row ? <GoalRow goals={row} lang={lang} /> : null}
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

const same = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

/** The service the matrix points at: the CSM's pick, else the most ticks. */
export function leadService(
  d: DeckData,
  ticks: Record<string, Record<string, boolean>>,
  picked: string | null,
) {
  const score = (s: string) =>
    Object.values(ticks[s] ?? {}).filter(Boolean).length;
  let best: string | null = null;
  let top = 0;
  for (const s of d.services) {
    const n = score(s);
    if (n > top || (n === top && n > 0 && same(s, d.numberOne))) {
      best = s;
      top = n;
    }
  }
  const lead = top > 0 ? best : null;
  const candidate =
    (picked && d.services.find(s => same(s, picked))) ||
    lead ||
    d.serviceChosen ||
    d.serviceFocus ||
    d.services[0] ||
    null;
  return { lead, candidate };
}

function AddService({
  ctx,
  open,
  setOpen,
  setFocus,
  focus,
}: {
  ctx: SlideCtx;
  open: boolean;
  setOpen: (v: boolean) => void;
  setFocus: (v: boolean) => void;
  /** Take the keyboard: only when the CSM opened it, never on arrival (a clicker's → would type). */
  focus: boolean;
}) {
  const { d, lang, prep, save } = ctx;
  const [value, setValue] = useState("");
  const key =
    lang === "ar" && strings(prep.services_ar).length
      ? "services_ar"
      : "services";
  const add = () => {
    const v = value.trim();
    if (v && !d.services.some(s => same(s, v)))
      save({ [key]: [...d.services, v] }, true);
    setValue("");
  };
  if (!open)
    return (
      <div className="dkc-add">
        <button
          type="button"
          className="dkc-add-btn dkc-press"
          onClick={() => {
            setFocus(true);
            setOpen(true);
          }}
          onPointerUp={letGo}
        >
          <Plus aria-hidden style={{ width: 22, height: 22 }} />
          {t(O.one.add, lang)}
        </button>
      </div>
    );
  return (
    <div className="dkc-add">
      <input
        className="dkc-add-input"
        // biome-ignore lint/a11y/noAutofocus: only after the CSM pressed Add a service
        autoFocus={focus}
        dir="auto"
        value={value}
        placeholder={t(O.one.addInput, lang)}
        aria-label={t(O.one.addInput, lang)}
        onChange={e => setValue(e.target.value)}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          } else if (e.key === "Escape") {
            e.stopPropagation();
            setValue("");
            setOpen(false);
          }
        }}
        onBlur={() => {
          add();
          if (d.services.length) setOpen(false);
        }}
      />
    </div>
  );
}

/**
 * The matrix's row height (DESIGN 22.2.4): the band moves by it. Three
 * services or fewer take 96 px rows and 36 px names (score round 2: two
 * 72 px rows ended the table at y 600 beside a full-height phone).
 */
export const rowHeight = (services: number) => (services <= 3 ? 96 : 72);

/**
 * The rows still to fill, drawn as ghosts (score round 2): with no service
 * the matrix read as an empty table. Three rows always show while fewer
 * than three services are typed; each typed one takes a ghost's place, and
 * "Add a service" sits in the first ghost's name slot.
 */
export const ghostRows = (services: number) => Math.max(0, 3 - services);

/**
 * The example a service maps to (DESIGN 22.4.2), else the client's own
 * theme: the phone shows the chosen service's picture once it is chosen.
 */
function themeFor(d: DeckData, service: string | null) {
  if (d.example.from === "prep") return d.example.theme;
  return themeOfText(service) ?? d.example.theme;
}

function ProductPhone({
  ctx,
  service,
}: {
  ctx: SlideCtx;
  /** The service the phone shows: the chosen one, else the proposal. */
  service: string | null;
}) {
  const { d, lang } = ctx;
  const model = useCreatives(ctx);
  const theme = themeFor(d, service);
  // A custom creative of their own shows instead of the example, untagged
  // (never a starter template: that is what goes live, not their work).
  const own =
    [...model.tray, ...model.meta].find(
      c => !c.starter && phoneFor(c) !== "reels" && (c.url || c.poster),
    ) ?? null;
  const creative: Creative =
    own ??
    exampleCreative(
      theme,
      "feed",
      { primary: d.exampleWords.primary, headline: service },
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

function OneService({ ctx }: { ctx: SlideCtx }) {
  const { d, lang, live, setLive, save } = ctx;
  // With no services yet the matrix's first row is its quiet "Add a
  // service" control, not an open input on the client's screen.
  const [adding, setAdding] = useState(false);
  const [grab, setGrab] = useState(false);
  const { lead, candidate } = leadService(d, live.ticks, live.candidate);
  // Chosen is a recorded fact ("Launch with this" stamps it); a service
  // typed in prep is the proposal, in ink-2, until the client chooses.
  const chosen = d.today.service && same(candidate, d.serviceChosen);
  const flip = (service: string, test: string) =>
    setLive(l => {
      const row = { ...(l.ticks[service] ?? {}) };
      row[test] = !row[test];
      return { ...l, ticks: { ...l.ticks, [service]: row } };
    });
  const leadRow = lead ?? live.candidate ?? (chosen ? candidate : null);
  const at = d.services.findIndex(s => same(s, leadRow));
  const long = (candidate ?? "").trim().length > 22;
  const n = d.services.length;
  const rowH = rowHeight(n);
  const ghosts = ghostRows(n);
  const add = (
    <AddService
      ctx={ctx}
      open={adding}
      setOpen={setAdding}
      focus={grab}
      setFocus={setGrab}
    />
  );
  return (
    <>
      <h2 className="dk-h2">{t(O.one.title, lang)}</h2>
      <p className="dk-lead dkc-one-line">{t(O.one.line, lang)}</p>
      <div className="dkc-one">
        {/* The decision: their services against the three tests. A tick is
            the lanes' passed mark; the row the tests point at sits on the
            band, which moves to it. */}
        <div
          className="dkc-matrix"
          role="table"
          aria-label={t(O.one.title, lang)}
          data-few={n <= 3 ? "" : undefined}
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
            {d.services.map(s => (
              <div
                key={s}
                className="dkc-matrix-row"
                role="row"
                data-lead={same(s, leadRow) ? "" : undefined}
              >
                <span className="dkc-service" role="rowheader">
                  <button
                    type="button"
                    className="dkc-service-name dkc-press dkc-theirs"
                    dir="auto"
                    aria-pressed={same(s, candidate)}
                    onClick={() => setLive(l => ({ ...l, candidate: s }))}
                    onPointerUp={letGo}
                  >
                    {s}
                  </button>
                  {same(s, d.numberOne) && !same(s, candidate) ? (
                    <span className="dkc-numberone">
                      {t(O.one.numberOne, lang)}
                    </span>
                  ) : null}
                </span>
                {O.one.tests.map(x => {
                  const on = Boolean(live.ticks[s]?.[x.key]);
                  return (
                    <span key={x.key} className="dkc-cell" role="cell">
                      <button
                        type="button"
                        className="dkc-tick dkc-press"
                        aria-pressed={on}
                        aria-label={`${s}: ${t(x.label, lang)}`}
                        onClick={() => flip(s, x.key)}
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
            ))}
            {ghosts ? (
              Array.from({ length: ghosts }, (_, i) => (
                <div
                  key={`ghost-${String(i)}`}
                  className="dkc-matrix-row dkc-matrix-ghost"
                  role={i === 0 ? "row" : undefined}
                  aria-hidden={i === 0 ? undefined : true}
                >
                  <span className="dkc-service" role="rowheader">
                    {i === 0 ? add : null}
                  </span>
                  {O.one.tests.map(x => (
                    <span key={x.key} className="dkc-cell" aria-hidden>
                      <i className="dkc-tick dkc-tick-ghost" />
                    </span>
                  ))}
                </div>
              ))
            ) : (
              <div className="dkc-matrix-add" role="row">
                {add}
              </div>
            )}
          </div>
        </div>
        {/* The product column, on the ground (no card around the phone):
            what the choice becomes. */}
        <div className="dkc-product">
          <div className="dkc-product-text">
            <span className="dk-label">{t(O.one.first, lang)}</span>
            <p
              className="dkc-product-name"
              data-state={chosen ? "chosen" : candidate ? "proposal" : "none"}
              data-long={long ? "" : undefined}
            >
              {candidate ? <bdi>{candidate}</bdi> : t(O.one.pending, lang)}
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
                disabled={!candidate}
                onClick={() => {
                  if (!candidate) return;
                  save(
                    { service_focus: candidate, service_chosen_at: true },
                    true,
                  );
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
            service={chosen ? candidate : (d.serviceChosen ?? candidate)}
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
    return stop;
  });
  return (
    <>
      <h2 className="dk-h2">{t(O.road.title, lang)}</h2>
      <div className="dkc-way-wrap">
        <Route stops={stops} now={d.roadNow} still={still} />
        {/* The road ends at its payoff (score round 2): under its last two
            stops, the confirmation their customer gets, rising once the
            line has lit to today; the foot line on the start half, level
            with the card's foot. */}
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
}: {
  done: boolean;
  label: string;
  status: AccessStatus;
  onFlip: () => void;
  lang: Lang;
}) {
  // What was done when the card opened: only a later tick draws.
  const atOpen = useRef(done);
  return (
    <button
      type="button"
      className="dkc-step dkc-press"
      data-status={status}
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

function SetupCard({ row, ctx }: { row: AccessRow; ctx: SlideCtx }) {
  const { d, lang, prep, save } = ctx;
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
  const guideWords = len
    ? tf(O.week.guide, lang, { len })
    : t(O.week.guide, lang).replace(/ · \{len\}$/, "");
  return (
    <article
      className="dkc-setup"
      data-status={row.status}
      data-draw={done && !atOpen.current ? "" : undefined}
    >
      <i className="dkc-setup-edge" aria-hidden />
      {/* The video guide sits on the head's line, before the status (score
          round 2: on a row of its own it left a dead band at the card's
          foot, and beside three steps it had no room). */}
      <header className="dkc-setup-head">
        <h3 className="dkc-setup-name">{name}</h3>
        {guide && ctx.playVideo ? (
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
        {row.ticks.map(k => (
          <StepRing
            key={k.key}
            done={k.status === "done"}
            status={k.status}
            label={t(k.label, lang)}
            onFlip={() => flip(k.key, k.status)}
            lang={lang}
          />
        ))}
      </div>
    </article>
  );
}

function LaterRow({ row, ctx }: { row: AccessRow; ctx: SlideCtx }) {
  const { d, lang, prep, save } = ctx;
  const access = record(prep.access);
  const flip = (key: string, from: AccessStatus) =>
    save({ access: { ...access, [key]: nextStatus(from) } }, true);
  const name = t(row.name, lang);
  const single = row.ticks.length === 1 ? row.ticks[0] : null;
  return (
    <li data-status={row.status}>
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
          {now.map(r => (
            <SetupCard key={r.key} row={r} ctx={ctx} />
          ))}
        </div>
        <p className="dkc-week-group">{t(O.week.later, lang)}</p>
        <ul className="dkc-later">
          {later.map(r => (
            <LaterRow key={r.key} row={r} ctx={ctx} />
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
 * The launch service as O7 names it: the Arabic deck takes the CSM's
 * Arabic name (prep's service_focus_ar, which deckData already prefers),
 * and a name only in Latin letters is left unnamed there, as the journey's
 * queue card keeps a name in the other script off its rows: "لخدمة
 * Kitchens" mixed two scripts in one line (the fixer's round). The launch
 * deck reads the same prep field, so both calls name it the same way.
 */
export function o7Service(d: DeckData): string | null {
  const s = d.serviceFocus;
  if (!s) return null;
  if (d.lang === "ar") return ARABIC_LETTER.test(s) ? s : null;
  // Mid-sentence, a common-noun service keeps sentence case ("templates
  // for kitchens", score round 2): a name whose only capital is its first
  // letter is lowered; one with another capital (a brand) stays as typed.
  return /^[A-Z][^A-Z]*$/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
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
  // Nothing typed yet: nothing drawn; the input's line shows only under
  // the CSM's pointer or while typing.
  return (
    <div className="dkc-redlines" data-empty={lines.length ? undefined : ""}>
      {lines.length ? (
        <ul>
          {lines.map(l => (
            <li key={l}>
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
      <input
        className="dkc-redline-input"
        dir="auto"
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
 * The grid's two lit tiles (DESIGN 22.2.7): many tested, a few kept. On a
 * diagonal of the 3 x 2 grid, so they read as picks, not as a lit column.
 * Tile 0 is their own service's theme, and it stays lit (score round 2: it
 * was dimmed, so the slide showed their own kind of ad switched off), as
 * L3's tile 0 is.
 */
export const STRIP_LIT = new Set([0, 4]);

/**
 * The order the other four switch off on arrival (score round 2): scattered,
 * never a sweep along the grid.
 */
const STRIP_OFF = [3, 1, 5, 2];

/**
 * Six example tiles, 3 x 2, under "We test many ads, fast" (score round 2:
 * under "Your first ads" a client read them as their first ads, half
 * rejected). L3's field in miniature, tagged once: on arrival all six are
 * lit, then four switch off one after another, about 560 ms in all, and two
 * stay lit (under still=1 and reduced motion, that end at once). The tiles
 * take the column's free height, up to 150 x 188, and the grid leaves the
 * slide when there is too little room for it to read as a picture.
 */
function TestStrip({ ctx }: { ctx: SlideCtx }) {
  const { d, lang } = ctx;
  const s = THEMES.indexOf(d.example.theme);
  const tiles = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => tileUrl(THEMES[(s + i) % 12], "a")),
    [s],
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
  const at = toDate(d.next.blueprint);
  const timed = Boolean(at && clock(d.next.blueprint, lang, d.timeZone));
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
                <span className="dkc-cal-block" data-open="">
                  <span className="dkc-cal-open">
                    <svg viewBox="0 0 28 28" aria-hidden>
                      <circle cx="14" cy="14" r="13" />
                    </svg>
                    {t(O.next.cardOpen, lang)}
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
      key={String(d.next.blueprint)}
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
  // The deck ends on the next call: what it is beside it as their calendar
  // will show it, then the call's checklist, closed.
  return (
    <div className="dkc-blueprint">
      <div className="dkc-blueprint-head">
        <div className="dkc-blueprint-words">
          <h2 className="dk-h1 dkc-blueprint-title">
            {t(O.next.bandHead, lang)}
          </h2>
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
      missing: d => [
        ...(d.services.length
          ? []
          : [
              "No services in the onboarding form. Press Add a service and type them as the client says them.",
            ]),
        ...(d.today.service
          ? []
          : [
              "The client picks the launch service on the call: press Launch with this on slide 4, and the checklist ticks it.",
            ]),
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
          : [
              `Starter pack${d.serviceFocus ? ` for ${d.serviceFocus}` : ""}? Tick it only if a ready pack exists. Otherwise this slide doesn't name the service.`,
            ]),
        ...(d.lang === "ar" && d.serviceFocus && !o7Service(d)
          ? [
              `The Arabic deck leaves "${d.serviceFocus}" unnamed on this slide. Type its Arabic name on slide 4 to name it.`,
            ]
          : []),
        ...(d.starterPack && !d.starterAds.length
          ? [
              "No starter ads in the tray, so the starter ads stop stays hidden.",
            ]
          : []),
        ...(d.next.blueprint
          ? []
          : ["Book the Brand Blueprint call from the notes window."]),
      ],
    },
  ];
}
