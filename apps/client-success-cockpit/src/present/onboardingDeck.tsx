import { Check, Plus, X } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import maharaLogo from "@/assets/mahara-logo-dark.png";
import { O, O_NOTES, O_TITLES, SHARED, stepNumeral, t, tf } from "./content";
import { appLanguage, type Creative, creativeOf, phoneFor } from "./creative";
import { dayMonth, dayShort, when } from "./dates";
import type { SlideCtx, SlideDef } from "./deckContext";
import type { AccessRow, AccessStatus, DeckData, Goal } from "./deckData";
import { shownGoals } from "./deckData";
import { FaintLanes } from "./JourneyLanes";
import { ClientMark, type Identity } from "./mockups/Identity";
import { IgFeed, PhoneFigure, ReelStory } from "./mockups/Phones";
import { WhatsAppGroup } from "./mockups/WhatsAppGroup";
import { Road } from "./Road";

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

function Welcome({ ctx }: { ctx: SlideCtx }) {
  const { d, lang } = ctx;
  const date = dayMonth(d.onboardingDay, lang, d.timeZone);
  const long = d.name.length > 24;
  return (
    <>
      <FaintLanes dwy={d.mode.dwy} />
      <header className="dkc-letterhead">
        <img src={maharaLogo} alt="Mahara Media" draggable={false} />
        <p className="dk-dateline">{tf(O.welcome.dateline, lang, { date })}</p>
        <div className="dkc-presenter">
          {d.csmFirst ? <b dir="auto">{d.csmFirst}</b> : null}
          <span className="dk-label">
            {t(d.csmFirst ? SHARED.csmRole : SHARED.csmTeam, lang)}
          </span>
        </div>
      </header>
      <div className="dkc-welcome-main">
        <ClientMark who={who(d)} size={120} />
        <h1 className={`${long ? "dk-h1" : "dk-display"} dkc-welcome-title`}>
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
  return (
    <>
      <p className="dk-lead dkc-goal-ask">{t(O.goals.empty, lang)}</p>
      <textarea
        className="dkc-goal-input"
        rows={1}
        dir="auto"
        value={value}
        placeholder={t(O.goals.input, lang)}
        aria-label={t(O.goals.input, lang)}
        onChange={e => {
          setValue(e.target.value);
          save({ goals: { ...goals, goal90: e.target.value.trim() || null } });
        }}
        onKeyDown={e => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
    </>
  );
}

function Goals({ ctx }: { ctx: SlideCtx }) {
  const { d, lang } = ctx;
  const shown = shownGoals(d);
  const by = new Map<Goal["key"], Goal>(shown.map(g => [g.key, g]));
  // Nothing from the form (a goal typed live here does not count): the
  // question, and the CSM types the answer as the client says it.
  const ask = !shown.some(g => !(g.key === "goal90" && g.from === "prep"));
  if (ask)
    return (
      <>
        <h2 className="dk-h2">{t(O.goals.title, lang)}</h2>
        <GoalAsk ctx={ctx} />
        <p className="dk-small dkc-foot">{t(O.goals.foot, lang)}</p>
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
          <p className="dk-words dkc-theirs" dir="auto">
            {lead.lines[0]}
          </p>
          <div className="dkc-caption">
            <span className="dk-label">{t(lead.label, lang)}</span>
            <span className="dk-tag">{t(O.goals.source, lang)}</span>
          </div>
        </div>
      ) : (
        <div className="dkc-caption" style={{ marginTop: 56 }}>
          <span />
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
              <p className="dk-body dkc-theirs" dir="auto">
                {later.lines[0]}
              </p>
            </div>
          ) : null}
          {challenges ? (
            <div>
              <span className="dk-label">{t(challenges.label, lang)}</span>
              <ul>
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
        rows={rows}
      />
      <p className="dk-body dkc-foot">
        {t(d.uae ? O.team.footUae : O.team.foot, lang)}
      </p>
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
          <Plus aria-hidden style={{ width: 26, height: 26 }} />
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
  // No services yet: the input is the matrix's first row, its cells waiting.
  if (!d.services.length)
    return (
      <div className="dkc-matrix-row" role="row">
        <span className="dkc-service" role="rowheader">
          {input}
        </span>
        {O.one.tests.map(x => (
          <span key={x.key} className="dkc-cell" role="cell">
            <i className="dkc-cell-empty" aria-hidden />
          </span>
        ))}
      </div>
    );
  return (
    <div className="dkc-add" role="row">
      {input}
    </div>
  );
}

function OneService({ ctx }: { ctx: SlideCtx }) {
  const { d, lang, live, setLive, save } = ctx;
  const [adding, setAdding] = useState(d.services.length === 0);
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
        >
          <div className="dkc-matrix-head" role="row">
            <span role="columnheader" />
            {O.one.tests.map(x => (
              <span key={x.key} role="columnheader">
                {t(x.label, lang)}
              </span>
            ))}
          </div>
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
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {candidate ? (
            <div className="dkc-campaign">
              <span className="dk-label">{t(O.one.first, lang)}</span>
              {candidate && confirmed ? (
                <div className="dkc-campaign-done">
                  <Check aria-hidden />
                  <p className="dk-h3">
                    {tf(O.one.result, lang, { service: candidate })}
                  </p>
                </div>
              ) : (
                <>
                  <p className="dk-h3 dkc-theirs" dir="auto">
                    {candidate ?? ""}
                  </p>
                  {candidate ? (
                    <button
                      type="button"
                      className="dkc-btn dkc-press"
                      onClick={() => {
                        save({ service_focus: candidate }, true);
                        setLive(l => ({ ...l, candidate }));
                      }}
                      onPointerUp={letGo}
                    >
                      {t(O.one.launch, lang)}
                    </button>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
          <p className="dk-small dk-ink2">{t(O.one.small, lang)}</p>
        </div>
      </div>
    </>
  );
}

// --------------------------------------------------------------- O5 road

function RoadSlide({ ctx }: { ctx: SlideCtx }) {
  const { d, lang, still } = ctx;
  const date = (v: string | null | undefined, full = false) =>
    v ? (
      <span className="dk-dateline">
        {full ? dayShort(v, lang, d.timeZone) : dayMonth(v, lang, d.timeZone)}
      </span>
    ) : null;
  const stops = O.road.stops.map((name, i) => {
    let under = null;
    if (i < d.roadNow) under = date(d.roadDays[i]);
    else if (i === d.roadNow && i === 2)
      under = <span className="dkc-road-today">{t(O.road.today, lang)}</span>;
    else if (i === 4)
      under = (
        <>
          <span className="dkc-road-line">{t(O.road.launchLine, lang)}</span>
          {date(d.roadDays[i], true)}
        </>
      );
    else if (i === 5)
      under = (
        <span className="dkc-road-line">{t(O.road.afterGoLive, lang)}</span>
      );
    else under = date(d.roadDays[i], true);
    return { name: t(name, lang), under };
  });
  return (
    <>
      <h2 className="dk-h2">{t(O.road.title, lang)}</h2>
      <Road stops={stops} now={d.roadNow} still={still} />
      <p className="dk-body dk-ink2">{t(O.road.footer, lang)}</p>
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
                {t(SHARED.driveLink, lang)}
              </a>
            ) : (
              t(SHARED.driveMissing, lang)
            )}
          </span>
        ) : null}
      </span>
      <span className="dkc-week-state">
        <StatusChip
          status={row.status}
          lang={lang}
          label={name}
          onFlip={single ? () => flip(single.key, single.status) : undefined}
        />
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
  return (
    <div className="dkc-redlines">
      {lines.length ? (
        <ul>
          {lines.map(l => (
            <li key={l}>
              <span dir="auto">{l}</span>
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
  const tag = t(SHARED.tag.starter, lang);
  const props = { who: who(d), pageName: d.pageName, app, deck: lang };
  return (
    <div className="dkc-starter">
      <div className="dkc-starter-side">
        <h2 className="dk-h2">{t(O.next.starterTitle, lang)}</h2>
        <p className="dk-body dk-ink2">{t(O.next.approval, lang)}</p>
      </div>
      <div className="dkc-starter-phones">
        <PhoneFigure
          height={740}
          mark="instagram"
          label={t(SHARED.frame.feed, lang)}
          tag={feed ? tag : null}
          wide
        >
          <IgFeed creative={feed} {...props} />
        </PhoneFigure>
        <PhoneFigure
          height={740}
          mark="instagram"
          label={t(SHARED.frame.reels, lang)}
          tag={reel ? tag : null}
          wide
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
  return (
    <>
      <h2 className="dk-h2">{t(O.next.title, lang)}</h2>
      <div className="dkc-next">
        <div>
          <h3 className="dk-h3">{t(O.next.adsName, lang)}</h3>
          <p className="dk-body">
            {tf(first.line, lang, { service: first.service ?? "" })}
          </p>
          <p className="dk-body">{t(O.next.approval, lang)}</p>
        </div>
        <div>
          <h3 className="dk-h3">{t(O.next.testName, lang)}</h3>
          <p className="dk-body dk-ink2">{t(O.next.testLine, lang)}</p>
          <RedLines ctx={ctx} />
        </div>
      </div>
      <div className="dkc-band">
        <p>
          <b>{t(O.next.bandHead, lang)}</b> · {t(O.next.bandRest, lang)}
        </p>
        {booked ? <span className="dkc-band-when">{booked}</span> : null}
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
            "No goals in the onboarding form. The slide asks the question, and you type their answer live.",
          );
        for (const g of d.goals)
          if (g.held)
            out.push(
              `"${g.label.en}" is held back: ${g.held === "count" ? "it counts leads or appointments" : "it mentions a guarantee or a refund"}. Edit it here to show it.`,
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
              "No services in the onboarding form. Type them on the slide as the client says them.",
            ]),
        ...(d.serviceChosen
          ? []
          : ["Pick the launch service on the call (Launch with this)."]),
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
