import { Check, FolderOpen, Plus, X } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import maharaLogo from "@/assets/mahara-logo-dark.png";
import { O, O_NOTES, O_TITLES, SHARED, stepNumeral, t, tf } from "./content";
import { appLanguage, type Creative, creativeOf, phoneFor } from "./creative";
import { dayMonth, dayShort, when } from "./dates";
import type { SlideCtx, SlideDef } from "./deckContext";
import type { AccessRow, AccessStatus, DeckData, Goal } from "./deckData";
import { shownGoals } from "./deckData";
import { useHug } from "./hug";
import { FaintLanes } from "./JourneyLanes";
import { ClientMark, type Identity } from "./mockups/Identity";
import { IgFeed, PhoneFigure, ReelStory } from "./mockups/Phones";
import { WhatsAppGroup } from "./mockups/WhatsAppGroup";
import { Road, type RoadStop } from "./Road";

/**
 * The onboarding deck: seven slides, about ten minutes of a 45 to 60 minute
 * call (docs/csm-decks/CONTENT.md, DESIGN.md section 9). The setup happens
 * live while slide 6 is up; the deck is the frame around it. Every word is
 * in content.ts; this file only places them.
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
 * A cover's name size, stepped by its length so the stack fits under the
 * letterhead for every client: display, then h1 past about 20 characters,
 * then the client's-words size (data-long) past about 30. Arabic glyphs set
 * wider at these sizes, so the Arabic deck steps earlier.
 */
export function nameSize(name: string, lang: SlideCtx["lang"]) {
  const [mid, long] = lang === "ar" ? [14, 20] : [20, 30];
  const n = name.trim().length;
  return {
    className: n > mid ? "dk-h1" : "dk-display",
    long: n > long ? "" : undefined,
  };
}

function Welcome({ ctx }: { ctx: SlideCtx }) {
  const { d, lang } = ctx;
  const date = dayMonth(d.onboardingDay, lang, d.timeZone);
  const size = nameSize(d.name, lang);
  return (
    <>
      <FaintLanes dwy={d.mode.dwy} lang={lang} />
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
      <div className="dkc-welcome-main">
        <ClientMark who={who(d)} size={120} />
        <h1
          className={`${size.className} dkc-welcome-title`}
          data-long={size.long}
        >
          <span className="dkc-hello">{t(O.welcome.hello, lang)}</span>
          <span dir="auto">{d.name}</span>
        </h1>
        <div className="dkc-agenda">
          <p className="dk-body dk-ink2">{t(O.welcome.agendaLead, lang)}</p>
          <ol>
            {O.welcome.agenda.map((a, i) => (
              <li key={a.en} className="dk-body">
                <span className="dk-num">{stepNumeral(i, lang)}</span>
                <span>{t(a, lang)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </>
  );
}

// -------------------------------------------------------------- O2 goals

function GoalAsk({ ctx }: { ctx: SlideCtx }) {
  const { lang, prep, save } = ctx;
  const goals = record(prep.goals);
  const [value, setValue] = useState(
    typeof goals.goal90 === "string" ? goals.goal90 : "",
  );
  // The question is the slide: set large in the middle of the page, with
  // the answer's line under it drawn only under the CSM's pointer or while
  // typing, so the client never sees an empty form field. The footnote
  // ("They're targets…") comes once there is a target on the screen.
  return (
    <>
      <div className="dkc-goal-asking">
        <p className="dk-h1 dkc-goal-ask">{t(O.goals.empty, lang)}</p>
        <textarea
          className="dkc-goal-input"
          data-empty={value.trim() ? undefined : ""}
          rows={1}
          dir="auto"
          value={value}
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
      </div>
      {value.trim() ? (
        <p className="dk-small dkc-foot">{t(O.goals.foot, lang)}</p>
      ) : null}
    </>
  );
}

function Goals({ ctx }: { ctx: SlideCtx }) {
  const { d, lang } = ctx;
  const shown = shownGoals(d);
  const by = new Map<Goal["key"], Goal>(shown.map(g => [g.key, g]));
  const leadRef = useRef<HTMLParagraphElement>(null);
  const laterRef = useRef<HTMLParagraphElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const said = shown.map(g => g.lines.join("|")).join("/");
  useHug(leadRef, said);
  useHug(laterRef, said);
  useHug(listRef, said);
  // Nothing from the form (a goal typed live here does not count): the
  // question, and the CSM types the answer as the client says it.
  const ask = !shown.some(g => !(g.key === "goal90" && g.from === "prep"));
  if (ask)
    return (
      <>
        <h2 className="dk-h2">{t(O.goals.titleAsk, lang)}</h2>
        <GoalAsk ctx={ctx} />
      </>
    );
  const lead = by.get("goal90") ?? by.get("goal12_24");
  const later = lead?.key === "goal90" ? by.get("goal12_24") : undefined;
  const challenges = by.get("challenges");
  const why = by.get("why");
  return (
    <>
      <h2 className="dk-h2">{t(O.goals.title, lang)}</h2>
      {lead ? (
        <div className="dkc-goal-block">
          <p
            ref={leadRef}
            className="dk-words dkc-theirs"
            dir="auto"
            data-hug=""
          >
            {lead.lines[0]}
          </p>
          <div className="dkc-caption">
            <span className="dk-label">{t(lead.label, lang)}</span>
            <span className="dk-tag">{t(O.goals.source, lang)}</span>
          </div>
        </div>
      ) : (
        <div className="dkc-caption" style={{ marginTop: 56 }}>
          <span className="dk-tag">{t(O.goals.source, lang)}</span>
        </div>
      )}
      {later || challenges ? (
        <div
          className="dkc-goal-cols"
          data-one={later && challenges ? undefined : ""}
        >
          {later ? (
            <div>
              <span className="dk-label">{t(later.label, lang)}</span>
              <p
                ref={laterRef}
                className="dk-body dkc-theirs"
                dir="auto"
                data-hug=""
              >
                {later.lines[0]}
              </p>
            </div>
          ) : null}
          {challenges ? (
            <div>
              <span className="dk-label">{t(challenges.label, lang)}</span>
              <ul ref={listRef} data-hug="">
                {challenges.lines.map(l => (
                  <li key={l} className="dk-body dkc-theirs" dir="auto">
                    {l}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      {why ? (
        <p className="dk-body dkc-why">
          <span className="dk-label">{t(why.label, lang)}</span>
          <span className="dkc-theirs" dir="auto">
            {why.lines[0]}
          </span>
        </p>
      ) : null}
      <p className="dk-small dkc-foot">{t(O.goals.foot, lang)}</p>
    </>
  );
}

// --------------------------------------------------------------- O3 team

function Team({ ctx }: { ctx: SlideCtx }) {
  const { d, lang } = ctx;
  const rows = d.mode.dwy
    ? [...O.team.rows.slice(0, 4), O.team.alertsDwy]
    : [...O.team.rows];
  return (
    <>
      <h2 className="dk-h2">{t(O.team.title, lang)}</h2>
      <p className="dk-lead dkc-team-line">{t(O.team.line, lang)}</p>
      <WhatsAppGroup
        who={who(d)}
        lang={lang}
        header={O.team.header}
        about={d.uae ? O.team.footUae : O.team.foot}
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
      <div className="dkc-add" role="row">
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
  const input = (
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
  );
  // No services yet, or more to add: the input alone on the matrix's next
  // row (no empty cells waiting beside it).
  return (
    <div className="dkc-add" role="row">
      {input}
    </div>
  );
}

function OneService({ ctx }: { ctx: SlideCtx }) {
  const { d, lang, live, setLive, save } = ctx;
  // With no services yet the matrix's first row is its quiet "Add a
  // service" control, not an open input on the client's screen.
  const [adding, setAdding] = useState(false);
  const [grab, setGrab] = useState(false);
  const { lead, candidate } = leadService(d, live.ticks, live.candidate);
  const confirmed = same(candidate, d.serviceChosen);
  const flip = (service: string, test: string) =>
    setLive(l => {
      const row = { ...(l.ticks[service] ?? {}) };
      row[test] = !row[test];
      return { ...l, ticks: { ...l.ticks, [service]: row } };
    });
  return (
    <>
      <h2 className="dk-h2">{t(O.one.title, lang)}</h2>
      <p className="dk-lead dkc-one-line">{t(O.one.line, lang)}</p>
      <div className="dkc-one">
        <div
          className="dkc-matrix"
          role="table"
          aria-label={t(O.one.title, lang)}
          data-empty={d.services.length ? undefined : ""}
        >
          {/* The tests head their columns once a service row exists:
              over an empty table they would be an unfinished form. */}
          {d.services.length ? (
            <div className="dkc-matrix-head" role="row">
              <span role="columnheader" />
              {O.one.tests.map(x => (
                <span key={x.key} role="columnheader">
                  {t(x.label, lang)}
                </span>
              ))}
            </div>
          ) : (
            <p className="dkc-one-tests">
              {O.one.tests.map(x => t(x.label, lang)).join(" · ")}
            </p>
          )}
          {d.services.map(s => (
            <div
              key={s}
              className="dkc-matrix-row"
              role="row"
              data-lead={
                same(
                  s,
                  lead ?? live.candidate ?? (confirmed ? candidate : null),
                )
                  ? ""
                  : undefined
              }
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
                {same(s, d.numberOne) ? (
                  <span className="dkc-chip">{t(O.one.numberOne, lang)}</span>
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
                      {on ? <Check aria-hidden /> : null}
                    </button>
                  </span>
                );
              })}
            </div>
          ))}
          <AddService
            ctx={ctx}
            open={adding}
            setOpen={setAdding}
            focus={grab}
            setFocus={setGrab}
          />
        </div>
        {candidate ? (
          <div className="dkc-campaign-col">
            <div
              className="dkc-campaign"
              data-done={confirmed ? "" : undefined}
            >
              {confirmed ? (
                // The result sentence, its lead-in as the label and the
                // service alone on its own line, never split mid-name.
                <span className="dk-label dkc-campaign-done">
                  <Check aria-hidden />
                  {tf(O.one.result, lang, { service: "" }).trim()}
                </span>
              ) : (
                <span className="dk-label">{t(O.one.first, lang)}</span>
              )}
              <p className="dk-h3 dkc-campaign-name">
                <bdi>{candidate}</bdi>
              </p>
              {confirmed ? null : (
                // A quiet control, not a call to action: the client watches
                // the choice, the CSM makes it (gone once confirmed).
                <button
                  type="button"
                  className="dkc-launch dkc-press"
                  onClick={() => {
                    save({ service_focus: candidate }, true);
                    setLive(l => ({ ...l, candidate }));
                  }}
                  onPointerUp={letGo}
                >
                  {t(O.one.launch, lang)}
                </button>
              )}
            </div>
            <p className="dk-small dk-ink2">{t(O.one.small, lang)}</p>
          </div>
        ) : null}
      </div>
    </>
  );
}

// --------------------------------------------------------------- O5 road

function RoadSlide({ ctx }: { ctx: SlideCtx }) {
  const { d, lang, still } = ctx;
  const date = (v: string | null | undefined, full = false) =>
    v ? (
      <span className="dk-num">
        {full ? dayShort(v, lang, d.timeZone) : dayMonth(v, lang, d.timeZone)}
      </span>
    ) : null;
  const stops: RoadStop[] = O.road.stops.map((name, i) => {
    const stop: RoadStop = { name: t(name, lang) };
    if (i < d.roadNow) stop.when = date(d.roadDays[i]);
    else if (i === d.roadNow && i === 2)
      stop.when = (
        <span className="dkc-road-today">{t(O.road.today, lang)}</span>
      );
    else if (i === 5) stop.when = t(O.road.afterGoLive, lang);
    else stop.when = date(d.roadDays[i], true);
    if (i === 4) stop.line = t(O.road.launchLine, lang);
    return stop;
  });
  return (
    <>
      <h2 className="dk-h2">{t(O.road.title, lang)}</h2>
      <div className="dkc-road-wrap">
        <Road stops={stops} now={d.roadNow} still={still} />
        <p className="dk-body dk-ink2 dkc-road-foot">
          {t(O.road.footer, lang)}
        </p>
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
  // Done is quiet (teal on its soft fill, a check); what is still to do is
  // the louder of the two, so the eye goes to what is left.
  const inner = (
    <>
      {status === "done" ? <Check aria-hidden /> : null}
      {words}
    </>
  );
  if (!onFlip)
    return (
      <span className="dkc-status" data-status={status}>
        {inner}
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
      {inner}
    </button>
  );
}

function WeekRow({ row, ctx }: { row: AccessRow; ctx: SlideCtx }) {
  const { d, lang, prep, save } = ctx;
  const access = record(prep.access);
  const flip = (key: string, from: AccessStatus) =>
    save({ access: { ...access, [key]: nextStatus(from) } }, true);
  const name = t(row.name, lang);
  const single = row.ticks.length === 1 ? row.ticks[0] : null;
  return (
    <li>
      <span className="dkc-week-name">{name}</span>
      {/* The row's words, and under them its parts to tick (or the Drive
          folder): the status column holds the one chip, on one line. */}
      <span className="dkc-week-text">
        {t(row.line, lang)}
        {row.key === "content" ? (
          <span className="dkc-week-more">
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
        {single ? null : (
          <span className="dkc-ticks">
            {row.ticks.map(k => (
              <button
                key={k.key}
                type="button"
                className="dkc-tickline dkc-press"
                data-status={k.status}
                aria-label={`${t(k.label, lang)}: ${t(SHARED.status[k.status], lang)}`}
                onClick={() => flip(k.key, k.status)}
                onPointerUp={letGo}
              >
                <i>{k.status === "done" ? <Check aria-hidden /> : null}</i>
                {t(k.label, lang)}
              </button>
            ))}
          </span>
        )}
      </span>
      <span className="dkc-week-state">
        <StatusChip
          status={row.status}
          lang={lang}
          label={name}
          onFlip={single ? () => flip(single.key, single.status) : undefined}
        />
      </span>
    </li>
  );
}

function ThisWeek({ ctx }: { ctx: SlideCtx }) {
  const { d, lang } = ctx;
  return (
    <>
      <h2 className="dk-h2">{t(O.week.title, lang)}</h2>
      <p className="dk-lead dkc-week-line">{t(O.week.line, lang)}</p>
      <ul className="dkc-week" data-many={d.access.length > 5 ? "" : undefined}>
        {d.access.map(r => (
          <WeekRow key={r.key} row={r} ctx={ctx} />
        ))}
      </ul>
    </>
  );
}

// --------------------------------------------------------------- O7 next

/** The first-ads sentence for the kickoff's templated-ads answer (CONTENT O7). */
export function firstAdsLine(d: DeckData) {
  const pack = d.starterPack && d.serviceFocus;
  if (d.templated === "declined")
    return { line: O.next.declined, service: null };
  if (d.templated === "approved")
    return pack
      ? { line: O.next.approved, service: d.serviceFocus }
      : { line: O.next.approvedNoPack, service: null };
  return pack
    ? { line: O.next.pending, service: d.serviceFocus }
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
  // and fixed), then their words in ink. No panel and no box around them,
  // which read as an input field and a warning. Nothing typed yet: nothing
  // drawn; the input's line shows only under the CSM's pointer or while
  // typing, so the client never sees an empty form field.
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
  // phone), then what these are under the tag; stop 1 already said they go
  // live only once approved, so that is not said again. The pair sits on
  // the content's end edge.
  const service = d.starterPack ? d.serviceFocus : null;
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
      <div className="dkc-starter-phones">
        <PhoneFigure
          height={760}
          mark="instagram"
          label={t(SHARED.frame.feed, lang)}
          head={false}
        >
          <IgFeed creative={feed} {...props} />
        </PhoneFigure>
        <PhoneFigure
          height={760}
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

function Next({ ctx }: { ctx: SlideCtx }) {
  const { d, lang, tour } = ctx;
  if (tour === 1) return <StarterAds ctx={ctx} />;
  const first = firstAdsLine(d);
  const booked = d.next.blueprint
    ? when(d.next.blueprint, lang, d.timeZone)
    : null;
  // The title's two halves, side by side: what to expect (the first ads,
  // then the test with their red lines) on the start side, and what's next
  // (the Blueprint call, its date once booked) as the card beside it.
  return (
    <>
      <h2 className="dk-h2">{t(O.next.title, lang)}</h2>
      <div className="dkc-next">
        <div className="dkc-next-expect">
          <section>
            <h3 className="dk-h3">{t(O.next.adsName, lang)}</h3>
            <p className="dk-body">
              {tf(first.line, lang, { service: first.service ?? "" })}
            </p>
            <p className="dk-body dk-ink2">{t(O.next.approval, lang)}</p>
          </section>
          <section>
            <h3 className="dk-h3">{t(O.next.testName, lang)}</h3>
            <p className="dk-body">{t(O.next.testLine, lang)}</p>
            <RedLines ctx={ctx} />
          </section>
        </div>
        <aside className="dkc-band">
          <p className="dk-h3">{t(O.next.bandHead, lang)}</p>
          <p className="dk-body dk-ink2">{t(O.next.bandRest, lang)}</p>
          {booked ? <span className="dkc-band-when">{booked}</span> : null}
        </aside>
      </div>
    </>
  );
}

// ---------------------------------------------------------- the slides

const showsStarter = (d: DeckData) => d.starterPack && d.starterAds.length > 0;

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
          : ["No logo. Upload one, or the deck shows their initials."]),
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
      render: ctx => <Goals ctx={ctx} />,
      missing: d => {
        const out: string[] = [];
        if (!shownGoals(d).length)
          out.push(
            "No goals in the onboarding form. The slide asks the question, and you type their answer live, just under it.",
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
        ...(d.serviceChosen
          ? []
          : [
              "Pick the launch service on the call (point at the campaign card: Launch with this).",
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
      stops: ctx => (showsStarter(ctx.d) ? 2 : 1),
      stopName: i => (i === 1 ? O.next.starterTitle : null),
      render: ctx => <Next ctx={ctx} />,
      missing: d => [
        ...(d.starterPack
          ? []
          : [
              `Starter pack${d.serviceFocus ? ` for ${d.serviceFocus}` : ""}? Tick it only if a ready pack exists. Otherwise this slide doesn't name the service.`,
            ]),
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
