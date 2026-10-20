import { Star } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import maharaLogo from "@/assets/mahara-logo-dark.png";
import { AdTray, PhoneRow, useCreatives } from "./AdsStage";
import callsAr from "./assets/portal/portal-calls-ar.webp";
import callsEn from "./assets/portal/portal-calls-en.webp";
import outcomeAr from "./assets/portal/portal-outcome-ar.webp";
import outcomeEn from "./assets/portal/portal-outcome-en.webp";
import overviewAr from "./assets/portal/portal-overview-ar.webp";
import overviewEn from "./assets/portal/portal-overview-en.webp";
import phoneAr from "./assets/portal/portal-phone-ar.webp";
import phoneEn from "./assets/portal/portal-phone-en.webp";
import {
  ASK,
  CONFIRMATION,
  LANDS_NOTES,
  PLACE_WRITTEN,
  type Place,
  plain,
  TO_GIVE,
} from "./callScript";
import {
  APP,
  digits,
  JOURNEY,
  journeyOwners,
  type L,
  L_NOTES,
  L_TITLES,
  LAUNCH,
  type LaneKey,
  type Lang,
  LINKS,
  SHARED,
  stepNumeral,
  t,
  tf,
} from "./content";
import { dayMonth, dayShort, weekdayDate } from "./dates";
import type { SlideCtx, SlideDef } from "./deckContext";
import type { DeckData } from "./deckData";
import {
  FaintLanes,
  JourneyLanes,
  LANES_W,
  MiniRail,
  rowY,
} from "./JourneyLanes";
import { type FormQuestion, PHONES } from "./launchData";
import {
  AppointmentCard,
  CalendarEntry,
  Confirmation,
  CrmStages,
  Crop,
  type CropBox,
  FiveDots,
  QueueCard,
  Reminders,
  Tagged,
  TestTiles,
} from "./mockups/Cards";
import {
  exampleQuestions,
  type FormScreen,
  InstantForm,
  isContact,
  PageShot,
  WhatsAppChat,
} from "./mockups/Form";
import { ClientMark } from "./mockups/Identity";
import { IgFeed, Phone, PhoneFigure } from "./mockups/Phones";
import { nameSize, who } from "./onboardingDeck";
import { RoadStrip } from "./Road";
import {
  CALL_STAGES,
  type CallTurn,
  callRun,
  clockAt,
  stageRange,
  Transcript,
  useCallCursor,
} from "./Transcript";

/**
 * The launch deck: ten slides, about 22 minutes of a 30-minute slot
 * (docs/csm-decks/CONTENT.md L1 to L10, DESIGN.md section 8). Visual first:
 * the journey is the signature, and every picture of what the customer sees
 * is drawn from this client's own data, or drawn as a labelled example.
 * Every word is in content.ts and callScript.ts; this file only places them.
 */

const letGo = (e: { currentTarget: HTMLElement }) => e.currentTarget.blur();
const PORTAL_RATIO = 2384 / 1504;

/**
 * The portal's screens, cropped below their "lead" headings and above the
 * demo call's summary (CONTENT rule 3), each to the part its stop names so
 * the words read on a share: the appointment updates card ("anything
 * waiting on you"), and the recorded call with its player. Each crop keeps
 * a margin of the screen's own ground, so no word meets the figure's edge.
 * The Arabic screens are mirrored, so their crops are too.
 */
const SHOTS: Record<
  "overview" | "calls" | "outcome",
  { src: Record<Lang, string>; crop: Record<Lang, CropBox> }
> = {
  overview: {
    src: { en: overviewEn, ar: overviewAr },
    crop: {
      en: { box: [0.026, 0.4, 0.624, 0.91], ratio: PORTAL_RATIO },
      ar: { box: [0.376, 0.4, 0.974, 0.91], ratio: PORTAL_RATIO },
    },
  },
  calls: {
    src: { en: callsEn, ar: callsAr },
    crop: {
      // The recorded call's own row, from its top edge: no list heading,
      // and no band of the card's white beside the row's tint. The crop's
      // waveform edge falls in the middle of a gap (each 14 px of the
      // 2x screen), so no bar is cut or touches the frame.
      en: { box: [0.0579, 0.311, 0.5568, 0.668], ratio: PORTAL_RATIO },
      ar: { box: [0.4407, 0.311, 0.9421, 0.668], ratio: PORTAL_RATIO },
    },
  },
  outcome: {
    src: { en: outcomeEn, ar: outcomeAr },
    crop: {
      en: { box: [0.535, 0.42, 0.985, 0.78], ratio: PORTAL_RATIO },
      ar: { box: [0.015, 0.42, 0.465, 0.78], ratio: PORTAL_RATIO },
    },
  },
};

/** The owner line: the journey lane's own type and tone (DESIGN 8.3). */
function Owner({
  lane,
  text,
  lang,
}: {
  lane: LaneKey | "plain";
  text: L;
  lang: Lang;
}) {
  return (
    <p className="dkc-owner" data-lane={lane}>
      {t(text, lang)}
    </p>
  );
}

/** The step's owner chip on the journey's stage. */
function OwnerChip({ lane, lang }: { lane: LaneKey; lang: Lang }) {
  return (
    <span className="dkc-owner-chip" data-lane={lane}>
      {t(SHARED.owner[lane], lang)}
    </span>
  );
}

const isUae = (d: DeckData) => d.uae;

// ------------------------------------------------------------- L1 cover

function Cover({ ctx }: { ctx: SlideCtx }) {
  const { d, lang } = ctx;
  const L1 = LAUNCH.cover;
  const today = dayMonth(d.launch.today, lang, d.timeZone);
  const live = d.launch.live;
  const template = (live ? L1.titleLive : L1.title)[lang];
  const [before, after] = template.split("{name}");
  const size = nameSize(d.name, lang);
  const cover = d.launch.cover;
  const app = useCreatives(ctx).app;
  const props = { who: who(d), pageName: d.pageName, app, deck: lang };
  return (
    <>
      {cover ? null : <FaintLanes dwy={d.mode.dwy} lang={lang} />}
      <header className="dkc-letterhead">
        <img src={maharaLogo} alt="Mahara Media" draggable={false} />
        <p className="dk-dateline">{tf(L1.dateline, lang, { date: today })}</p>
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
      <div className="dkc-cover-main">
        <ClientMark who={who(d)} size={96} />
        <h1
          className={`${size.className} dkc-cover-title`}
          data-long={size.long}
        >
          {before.trim() ? (
            <span className="dk-teal">{before.trim()}</span>
          ) : null}
          <span dir="auto">{d.name}</span>
          {after.trim() ? (
            <span className="dk-teal">{after.trim()}</span>
          ) : null}
        </h1>
        {d.goLive ? (
          <p className="dkc-golive">
            <span className="dk-dateline">{t(L1.goLive, lang)}</span>
            <b>{weekdayDate(d.goLive, lang, d.timeZone)}</b>
          </p>
        ) : null}
        <div className="dkc-cover-road">
          <RoadStrip now={4} label={t(L1.road, lang)} />
        </div>
        <p className="dk-lead dkc-cover-line">
          {t(live ? L1.lineLive : L1.line, lang)}
        </p>
      </div>
      {cover ? (
        <div className="dkc-cover-phone">
          <PhoneFigure
            height={700}
            mark="instagram"
            label={t(SHARED.frame.feed, lang)}
            tag={t(SHARED.tag.preview, lang)}
            foot={false}
          >
            <IgFeed creative={cover} {...props} />
          </PhoneFigure>
        </div>
      ) : null}
    </>
  );
}

// ----------------------------------------------------------- L2 journey

/** The journey's places, joined as the client says them (stop 6). */
function placesLine(places: Place[], lang: Lang): string {
  const P = LAUNCH.journey.places;
  const list = (
    places.length ? places : (["office", "home", "online"] as Place[])
  ).map(p => t(P[p], lang));
  const or = t(LAUNCH.journey.or, lang);
  if (list.length === 1) return list[0];
  if (lang === "ar")
    return list.length === 2
      ? `${list[0]} ${or} ${list[1]}`
      : `${list.slice(0, -1).join(`، ${or} `)}، ${or} ${list.at(-1)}`;
  return list.length === 2
    ? `${list[0]} ${or} ${list[1]}`
    : `${list.slice(0, -1).join(", ")}, ${or} ${list.at(-1)}`;
}

/** The creative on the feed phone (the ads slide's, before or after a swap). */
function useFeed(ctx: SlideCtx) {
  const model = useCreatives(ctx);
  return { model, feed: model.phones.feed };
}

/** The ad opens a WhatsApp chat (their confirmed destination), not a form. */
const opensWhatsApp = (d: DeckData) =>
  d.launch.form.kind === "whatsapp" && d.launch.form.source !== "example";

/**
 * The message a WhatsApp ad fills in (example wording, DESIGN 7.5): the
 * service only when it is written in the message's own script, so a
 * customer's line never mixes the two.
 */
function waMessage(d: DeckData, lang: Lang): string {
  const named = d.launch.service[lang] ?? d.serviceFocus;
  const service =
    named && /[\u0600-\u06ff]/.test(named) === (lang === "ar") ? named : null;
  const F = LAUNCH.form;
  return service ? tf(F.waMessage, lang, { service }) : t(F.waMessageAny, lang);
}

function FormPhone({
  ctx,
  height,
  screen,
  focus,
}: {
  ctx: SlideCtx;
  height: number;
  screen: FormScreen;
  focus?: number | null;
}) {
  const { d, lang } = ctx;
  const { feed } = useFeed(ctx);
  const f = d.launch.form;
  const service = d.launch.service[lang] ?? d.serviceFocus;
  const questions =
    f.source === "example" ? exampleQuestions(service, lang) : f.questions;
  const app: Lang =
    f.source === "example"
      ? lang
      : questions.some(q => /[؀-ۿ]/.test(q.label))
        ? "ar"
        : "en";
  const thanks = f.thankYou ?? t(LAUNCH.form.thanksDefault, app);
  const content = opensWhatsApp(d) ? (
    // The customer's own phone, in the deck's language, their message typed.
    <WhatsAppChat
      who={who(d)}
      pageName={d.pageName}
      app={lang}
      message={waMessage(d, lang)}
    />
  ) : f.kind === "website" && f.source !== "example" ? (
    <PageShot shot={d.launch.pageShot} deck={lang} />
  ) : (
    <InstantForm
      who={who(d)}
      pageName={d.pageName}
      app={app}
      form={f}
      questions={questions}
      screen={screen}
      focus={focus}
      thanks={thanks}
      video={d.launch.welcomeVideo}
      cover={feed ? (feed.video ? feed.poster : feed.url) : null}
    />
  );
  return (
    <Phone height={height} label={t(LAUNCH.form.title, lang)}>
      {content}
    </Phone>
  );
}

function StopWords({
  lane,
  line,
  lang,
  aside,
  row,
  children,
}: {
  lane: LaneKey;
  line: string;
  lang: Lang;
  /** A chip on the owner's row, at its end (the tries). */
  aside?: ReactNode;
  /** Beside a phone: the owner chip level with its own row in the lanes. */
  row?: number;
  children?: ReactNode;
}) {
  return (
    <div
      className="dkc-stop-words"
      style={row == null ? undefined : { paddingTop: rowY(row) - 22 }}
    >
      <div className="dkc-stop-head">
        <OwnerChip lane={lane} lang={lang} />
        {aside}
      </div>
      <p className="dk-body">{line}</p>
      {children}
    </div>
  );
}

function JourneyStage({ ctx, i }: { ctx: SlideCtx; i: number }) {
  const { d, lang, still } = ctx;
  const J = LAUNCH.journey;
  const dwy = d.mode.dwy;
  const lane = journeyOwners(dwy)[i];
  const stop = J.stops[i];
  const { feed, model } = useFeed(ctx);
  const L = d.launch;
  const line = (l: L) => t(l, lang);
  if (i === 0) {
    const tag = feed?.starter
      ? t(SHARED.tag.starter, lang)
      : t(SHARED.tag.preview, lang);
    return (
      <div className="dkc-stage" data-kind="phone">
        <Tagged tag={tag} className="dkc-stage-pic" style={{ width: 304 }}>
          <Phone height={650} label={t(SHARED.frame.feed, lang)}>
            <IgFeed
              creative={feed}
              who={who(d)}
              pageName={d.pageName}
              app={model.app}
              deck={lang}
            />
          </Phone>
        </Tagged>
        <StopWords lane={lane} line={line(stop.line)} lang={lang} row={0} />
      </div>
    );
  }
  if (i === 1) {
    const wa = opensWhatsApp(d);
    const tag = wa
      ? t(SHARED.tag.exampleWording, lang)
      : L.form.source === "example"
        ? t(SHARED.tag.exampleForm, lang)
        : t(SHARED.tag.yourForm, lang);
    // The questions screen from its top, as a customer first sees it: the
    // first question first, none scrolled away or cut at the top edge
    // (the form slide walks them one by one).
    return (
      <div className="dkc-stage" data-kind="phone">
        <Tagged tag={tag} className="dkc-stage-pic" style={{ width: 304 }}>
          <FormPhone ctx={ctx} height={650} screen="questions" focus={null} />
        </Tagged>
        <StopWords
          lane={lane}
          line={line((wa ? stop.whatsapp : null) ?? stop.line)}
          lang={lang}
          row={1}
        />
      </div>
    );
  }
  if (i === 2) {
    const text = dwy ? stop.dwy : d.uae ? stop.lineUae : stop.line;
    // The stop's words, then the queue (its new row level with the lit
    // row, so the leader runs straight in), then what's under it: the tries
    // as the card's own legend beside its tag, and "not every enquiry
    // books". Done with you the tries are in the words already.
    return (
      <div className="dkc-stage" data-kind="card">
        <StopWords lane={lane} line={line(text ?? stop.line)} lang={lang} />
        <figure
          className="dkc-tagged dkc-stage-pic dkc-queue-fig"
          data-level=""
        >
          <QueueCard
            lang={lang}
            // One script per card: a service named only in the other script
            // stays off the rows (an Arabic name inside an English row, or
            // the other way round, breaks the row's reading order), and a
            // row with no service leaves it out.
            services={[
              ...(L.service[lang] ? [L.service[lang] as string] : []),
              ...d.services.filter(s => s !== L.service[lang]),
            ].filter(s => /[\u0600-\u06ff]/.test(s) === (lang === "ar"))}
            dwy={dwy}
            still={still}
          />
          <figcaption>
            {dwy ? (
              <span />
            ) : (
              <span className="dkc-queue-tries">{t(J.tries, lang)}</span>
            )}
            <span className="dk-tag">{t(SHARED.tag.example, lang)}</span>
          </figcaption>
        </figure>
        {dwy ? null : (
          <p className="dk-small dk-ink2 dkc-notall">{t(J.notAll, lang)}</p>
        )}
      </div>
    );
  }
  if (i === 3) {
    const text = dwy ? stop.dwy : L.bookingVideo ? stop.video : stop.line;
    return (
      <div className="dkc-stage" data-kind="line">
        <StopWords lane={lane} line={line(text ?? stop.line)} lang={lang} />
        {/* From the lit row down to "You meet": its first node on the lit
            row's centre line (the leader runs straight into it), its last
            level with the meeting. */}
        <div
          className="dkc-stage-pic dkc-dots-pic"
          style={{ top: rowY(3) - 12 }}
        >
          <FiveDots lang={lang} dwy={dwy} height={rowY(5) - rowY(3)} />
        </div>
      </div>
    );
  }
  if (i === 4) {
    const place = L.call.place ?? "office";
    return (
      <div className="dkc-stage" data-kind="card" data-low="">
        <StopWords
          lane={lane}
          line={line((dwy ? stop.dwy : stop.line) ?? stop.line)}
          lang={lang}
        >
          {L.calendar === "todo" ? (
            <p className="dk-small dk-leak">{t(J.noCalendar, lang)}</p>
          ) : null}
        </StopWords>
        <Tagged tag={t(SHARED.tag.example, lang)} className="dkc-stage-pic">
          <CalendarEntry
            lang={lang}
            day={dayShort(L.call.slot.iso, lang, d.timeZone)}
            place={t(LAUNCH.call.lands.places[place], lang)}
            hour={L.call.slot.hour}
          />
        </Tagged>
      </div>
    );
  }
  if (i === 5) {
    const F = J.fork;
    // The two ways a meeting goes, as the fork in the lanes draws them: the
    // no-show card carries the lanes' rebook mark, so the two read as one.
    return (
      <div className="dkc-stage" data-kind="card" data-low="">
        <StopWords
          lane={lane}
          line={tf(stop.line, lang, { places: placesLine(L.places, lang) })}
          lang={lang}
        />
        <div className="dkc-stage-pic dkc-fork">
          {/* Ours in teal; done with you the follow-up is theirs, in ink. */}
          <div data-side={dwy ? "theirs" : "ours"}>
            <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden>
              <circle
                cx={18}
                cy={18}
                r={16}
                fill="none"
                stroke={dwy ? "var(--dk-line-strong)" : "var(--dk-teal)"}
                strokeWidth={2}
              />
              <path
                d="M 11 14 A 8 8 0 1 1 12 23"
                fill="none"
                stroke={dwy ? "var(--dk-ink-2)" : "var(--dk-teal)"}
                strokeWidth={2.5}
                strokeLinecap="round"
              />
              <path
                d="M 8 12 L 11 15 L 14.5 11.5"
                fill="none"
                stroke={dwy ? "var(--dk-ink-2)" : "var(--dk-teal)"}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <b>{t(F.noShow, lang)}</b>
            <p>{t(dwy ? F.noShowDwy : F.noShowLine, lang)}</p>
          </div>
          <div data-side="yours">
            <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden>
              <circle
                cx={18}
                cy={18}
                r={16}
                fill="none"
                stroke="var(--dk-line-strong)"
                strokeWidth={2}
              />
              <path
                d="M 11 18 L 25 18 M 20 13 L 25 18 L 20 23"
                fill="none"
                stroke="var(--dk-ink-2)"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <b>{t(F.deciding, lang)}</b>
            <p>{t(dwy ? F.decidingDwy : F.decidingLine, lang)}</p>
          </div>
        </div>
      </div>
    );
  }
  // Done with you, outcomes are marked in their own CRM until Mahara OS is
  // approved for them (as on the portal slide): its stages, not our form.
  const crm = dwy && !L.dwyOs;
  return (
    // The CRM's stages are set level with "You mark it" (the leader runs
    // straight into their line); the screenshot sits low, as before.
    <div className="dkc-stage" data-kind="card" data-low={crm ? undefined : ""}>
      <StopWords
        lane={lane}
        line={line((dwy ? stop.dwy : stop.line) ?? stop.line)}
        lang={lang}
      />
      {crm ? (
        <div className="dkc-stage-pic dkc-stage-crm" data-level="">
          <CrmStages lang={lang} width={740} drop={44} anchor />
        </div>
      ) : (
        <Tagged
          tag={t(SHARED.tag.demo, lang)}
          className="dkc-stage-pic dkc-screen"
        >
          <Crop
            src={SHOTS.outcome.src[lang]}
            crop={SHOTS.outcome.crop[lang]}
            width={660}
            radius={10}
          />
        </Tagged>
      )}
    </div>
  );
}

function Journey({ ctx }: { ctx: SlideCtx }) {
  const { d, lang, tour, still, setTour } = ctx;
  const lanesRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [leaderTo, setLeaderTo] = useState<{ x: number; y: number } | null>(
    null,
  );
  // Measured after every render (a stage may set itself level first), and
  // set only when it moved, so it settles in one pass.
  useLayoutEffect(() => {
    const lanes = lanesRef.current;
    const fig = stageRef.current?.querySelector<HTMLElement>(".dkc-stage-pic");
    // A tagged figure's picture, not its caption: the leader ends on the
    // card or the phone itself.
    const pic =
      fig?.querySelector<HTMLElement>(":scope > :not(figcaption)") ?? fig;
    if (!lanes || !pic || !fig) {
      setLeaderTo(l => (l ? null : l));
      return;
    }
    const a = lanes.getBoundingClientRect();
    const k = a.width / LANES_W || 1;
    const want = rowY(tour);
    const anchor = pic.querySelector<HTMLElement>("[data-anchor]");
    const mid = () => {
      const c = (anchor as HTMLElement).getBoundingClientRect();
      return ((c.top + c.bottom) / 2 - a.top) / k;
    };
    // A card whose row the leader names sits level with the lit row when
    // the words above it leave the room; it never moves up into them.
    if (anchor && fig.hasAttribute("data-level")) {
      fig.style.marginTop = "";
      // On top of the figure's own margin, never in place of it.
      const base = Number.parseFloat(getComputedStyle(fig).marginTop) || 0;
      const short = want - mid();
      if (short > 0) fig.style.marginTop = `${base + short}px`;
    }
    const b = pic.getBoundingClientRect();
    const x = lang === "ar" ? (a.right - b.right) / k : (b.left - a.left) / k;
    const top = (b.top - a.top) / k;
    const bottom = (b.bottom - a.top) / k;
    // On a named row: straight when that row is within reach of the lit
    // one's centre line, else to the row's own centre.
    const at = anchor ? mid() : null;
    const y =
      at != null
        ? Math.abs(at - want) <= 20
          ? want
          : at
        : Math.max(top + 24, Math.min(bottom - 24, want));
    setLeaderTo(l =>
      l && Math.abs(l.x - (x - 4)) < 0.5 && Math.abs(l.y - y) < 0.5
        ? l
        : { x: x - 4, y },
    );
  });
  return (
    <div className="dkc-journey">
      <h2 className="dk-h2">{t(JOURNEY.title, lang)}</h2>
      <p className="dk-lead dkc-journey-line">{t(JOURNEY.line, lang)}</p>
      <div className="dkc-journey-body">
        <div ref={lanesRef}>
          <JourneyLanes
            lang={lang}
            current={tour}
            dwy={d.mode.dwy}
            still={still}
            fork={tour >= 5}
            leaderTo={leaderTo}
            onPick={i => setTour(i)}
          />
        </div>
        <div className="dkc-journey-stage" ref={stageRef}>
          <div key={tour} className="dkc-stage-swap">
            <JourneyStage ctx={ctx} i={tour} />
          </div>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- L3 ads

function Ads({ ctx }: { ctx: SlideCtx }) {
  const { d, lang } = ctx;
  const A = LAUNCH.ads;
  const model = useCreatives(ctx);
  const planned = d.launch.platformsPlanned;
  return (
    <div className="dkc-ads">
      <div className="dkc-ads-start">
        <Owner lane="customer" text={A.owner} lang={lang} />
        {/* No "Preview" tag here: the foot under the phones says it. */}
        <h2 className="dk-h2">{t(A.title, lang)}</h2>
        {/* With nothing in the tray yet, the line says what the phones show:
            "right now" would promise what the tray says is being finished. */}
        <p className="dk-body dk-ink2 dkc-ads-line">
          {t(
            model.tray.length || model.meta.length ? A.line : A.lineEmpty,
            lang,
          )}
        </p>
        {planned.length ? (
          <p className="dk-small dk-ink2">
            {tf(A.planned, lang, {
              platforms: planned.join(lang === "ar" ? "، " : ", "),
            })}
          </p>
        ) : null}
        <AdTray ctx={ctx} model={model} />
      </div>
      <PhoneRow ctx={ctx} model={model} who={who(d)} pageName={d.pageName} />
    </div>
  );
}

// -------------------------------------------------- L4 creative freedom

/**
 * The feed phone with its "Sponsored" word named (creative freedom's first
 * stop): one leader, its dot just outside the frame on the side where the
 * word is and level with it, so no line crosses the app's own header, and
 * the label beyond it on that side.
 */
function SponsoredPhone({ ctx, height }: { ctx: SlideCtx; height: number }) {
  const { d, lang } = ctx;
  const { feed, model } = useFeed(ctx);
  const ref = useRef<HTMLDivElement>(null);
  const side = model.app === lang ? "start" : "end";
  const [at, setAt] = useState<{ dot: number; y: number; w: number } | null>(
    null,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: measured again when the language or the picture changes
  useLayoutEffect(() => {
    const root = ref.current;
    const sp = root?.querySelector<HTMLElement>('[data-part="sponsored"]');
    const phone = root?.querySelector<HTMLElement>(".dkc-phone");
    if (!root || !sp || !phone) return;
    const r = root.getBoundingClientRect();
    const k = r.width / root.offsetWidth || 1;
    const s = sp.getBoundingClientRect();
    const p = phone.getBoundingClientRect();
    const rtl = lang === "ar";
    // Logical x: from the root's inline-start edge.
    const lx = (px: number) => (rtl ? r.right - px : px - r.left) / k;
    const edge =
      side === "start"
        ? lx(rtl ? p.right : p.left)
        : lx(rtl ? p.left : p.right);
    setAt({
      dot: side === "start" ? edge - 12 : edge + 12,
      y: (s.top + s.height / 2 - r.top) / k,
      w: r.width / k,
    });
  }, [lang, feed?.id, height, side]);
  const run = 44;
  return (
    <div className="dkc-own-page" data-side={side} ref={ref}>
      <Phone height={height} label={t(SHARED.frame.feed, lang)}>
        <IgFeed
          creative={feed}
          who={who(d)}
          pageName={d.pageName}
          app={model.app}
          deck={lang}
        />
      </Phone>
      {at ? (
        <>
          <span
            className="dkc-own-leader"
            data-side={side}
            aria-hidden
            style={{
              insetInlineStart: side === "start" ? at.dot - run : at.dot,
              top: at.y,
              width: run,
            }}
          >
            <i />
          </span>
          <span
            className="dkc-own-label"
            style={
              side === "start"
                ? { insetInlineEnd: at.w - (at.dot - run - 12), top: at.y }
                : { insetInlineStart: at.dot + run + 12, top: at.y }
            }
          >
            {/* The word as the phone shows it, in the phone's language. */}
            {tf(LAUNCH.ads.leaders.sponsored, lang, {
              word: t(APP.sponsored, model.app),
            })}
          </span>
        </>
      ) : null}
    </div>
  );
}

/**
 * A group of red lines. Its lead ("Never", "Always") shows only when an
 * item does not already say it, so "Never show prices" is not read twice.
 */
function LineGroup({
  lead,
  items,
  says,
  lang,
}: {
  lead: L;
  items: string[];
  says: RegExp;
  lang: Lang;
}) {
  if (!items.length) return null;
  const needsLead = items.some(x => !says.test(x.trim()));
  return (
    <div className="dkc-fixed-group">
      {needsLead ? (
        <span className="dkc-fixed-lead">
          {t(lead, lang).replace(/\s*…$/, "")}
        </span>
      ) : null}
      <ul>
        {items.map(l => (
          <RedLine key={l} text={l} />
        ))}
      </ul>
    </div>
  );
}

/**
 * One red line, in the client's words: an amber mark (theirs, and fixed),
 * then the line, the whole row in the line's own direction: an English
 * line in the Arabic deck has its mark on its left, where an English list
 * starts (never trailing after its last word), and its own type, not the
 * Arabic leading; an Arabic line in the English deck the same, mirrored.
 */
function RedLine({ text }: { text: string }) {
  return (
    <li dir="auto">
      <i aria-hidden />
      <span className="dkc-theirs">{text}</span>
    </li>
  );
}

const NEVER = /^(never|no|don'?t|do not|avoid|لا|ما|أبد|بدون)\b|^(لا|ما|أبد)/i;
/** Every line already says "never" itself, so it needs no lead. */
const saysNever = (items: string[]) =>
  items.length > 0 && items.every(x => NEVER.test(x.trim()));

function RedLinesPanel({ ctx, lit }: { ctx: SlideCtx; lit: boolean }) {
  const { d, lang, prepOf, saveTo } = ctx;
  const T = LAUNCH.test.fixed;
  const R = d.launch.redLines;
  const [value, setValue] = useState("");
  const empty = !R.told.length && !R.always.length && !R.never.length;
  const add = () => {
    const v = value.trim();
    if (!v) return;
    const prep = prepOf("onboarding");
    const key =
      lang === "ar" &&
      Array.isArray(prep.red_lines_ar) &&
      prep.red_lines_ar.length
        ? "red_lines_ar"
        : "red_lines";
    const before = Array.isArray(prep[key]) ? (prep[key] as string[]) : [];
    saveTo("onboarding", { [key]: [...before, v] }, true);
    setValue("");
  };
  return (
    <div
      className="dkc-fixed"
      data-lit={lit ? "" : undefined}
      data-empty={empty ? "" : undefined}
    >
      <h3 className="dkc-col-head">{t(T.name, lang)}</h3>
      {lit ? (
        <>
          {R.told.length ? (
            // The card's "Never" lines that already say so join the told
            // list: one list, one rhythm, under one lead.
            <div className="dkc-fixed-group">
              <span className="dkc-fixed-lead">{t(T.told, lang)}</span>
              <ul>
                {[...R.told, ...(saysNever(R.never) ? R.never : [])].map(l => (
                  <RedLine key={l} text={l} />
                ))}
              </ul>
            </div>
          ) : null}
          {R.told.length && saysNever(R.never) ? null : (
            <LineGroup
              lead={T.never}
              items={R.never}
              says={NEVER}
              lang={lang}
            />
          )}
          <LineGroup
            lead={T.always}
            items={R.always}
            says={/^(always|دايماً|دائماً)/i}
            lang={lang}
          />
          {empty ? (
            <>
              <p className="dkc-fixed-copy">{t(T.fallback, lang)}</p>
              {/* No ruled line on the client's screen: the input is drawn
                  only under the CSM's pointer, or while typing. */}
              <input
                className="dkc-redline-input dkc-quiet-input"
                dir="auto"
                value={value}
                placeholder={t(T.input, lang)}
                aria-label={t(T.input, lang)}
                onChange={e => setValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    add();
                  }
                }}
                onBlur={add}
              />
            </>
          ) : (
            <p className="dkc-fixed-copy">{t(T.copy, lang)}</p>
          )}
        </>
      ) : null}
    </div>
  );
}

function CreativeFreedom({ ctx }: { ctx: SlideCtx }) {
  const { d, lang, tour, still } = ctx;
  const T = LAUNCH.test;
  const model = useCreatives(ctx);
  const pick = d.launch.pick ? (model.byId.get(d.launch.pick) ?? null) : null;
  const proof = tour === 3;
  const agreed = d.launch.agreedAt;
  let body: ReactNode;
  if (proof)
    body = (
      <div className="dkc-proof" key="proof">
        <Tagged tag={t(SHARED.tag.illustration, lang)}>
          <TestTiles still={still} />
        </Tagged>
        <div className="dkc-proof-words">
          <h3 className="dkc-col-head">{t(T.proof.name, lang)}</h3>
          <p className="dk-body">{t(T.proof.caption, lang)}</p>
        </div>
      </div>
    );
  else if (tour === 0)
    // The first stop is the page alone: its words in the place and size
    // they keep for the next two stops (one press, one change), and the
    // feed phone large in the room the columns will take, so "Sponsored"
    // can be read where the leader ends.
    body = (
      <div className="dkc-freedom-intro" key="intro">
        <section>
          <h3 className="dkc-col-head">{t(T.page.name, lang)}</h3>
          <p className="dk-body dkc-col-copy">{t(T.page.copy, lang)}</p>
        </section>
        <SponsoredPhone ctx={ctx} height={660} />
      </div>
    );
  else
    body = (
      // The columns hug their own words, tops level: no column is
      // stretched into an empty band, and the page's phone, read at the
      // first stop, is not shrunk into an ornament here.
      <div className="dkc-freedom-cols" key="cols">
        <section data-lit="">
          <h3 className="dkc-col-head">{t(T.page.name, lang)}</h3>
          <p className="dk-body dkc-col-copy">{t(T.page.copy, lang)}</p>
        </section>
        <RedLinesPanel ctx={ctx} lit />
        {/* Ahead, as the journey draws what is ahead: its head and what we
            test quiet beside the lit panel, so the panel never stands alone
            in an empty row; the next press lights it and adds its words. */}
        <section data-lit={tour >= 2 ? "" : undefined}>
          <h3 className="dkc-col-head">{t(T.open.name, lang)}</h3>
          {/* What we test, listed as the red lines are: one line each, the
              open ones marked in ink where the fixed ones are amber. */}
          <ul className="dkc-open-list">
            {T.open.chips.map(c => (
              <li key={c.en}>
                <i aria-hidden />
                {t(c, lang)}
              </li>
            ))}
          </ul>
          {tour >= 2 ? (
            <>
              <div className="dkc-open-pick">
                {(pick?.poster ?? pick?.url) ? (
                  <span className="dkc-open-thumb">
                    <img src={(pick.poster ?? pick.url) as string} alt="" />
                    <Star aria-hidden />
                  </span>
                ) : null}
                <p className="dk-small">
                  {t(pick ? T.open.pick : T.open.pickNone, lang)}
                </p>
              </div>
              {/* How a test starts and how theirs joins it: one paragraph. */}
              <p className="dk-small dk-ink2 dkc-open-foot">
                {t(T.open.approve, lang)} {t(T.footer, lang)}
              </p>
            </>
          ) : null}
        </section>
      </div>
    );
  return (
    <div className="dkc-freedom">
      <Owner lane="plain" text={T.owner} lang={lang} />
      <h2 className="dk-h2">{t(T.title, lang)}</h2>
      {body}
      {agreed ? (
        <div className="dkc-freedom-foot">
          <span className="dk-tag dkc-stamp">
            {tf(T.stamp, lang, { date: dayMonth(agreed, lang, d.timeZone) })}
          </span>
        </div>
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------- L5 form

function formStops(d: DeckData): number {
  const f = d.launch.form;
  if (f.kind !== "form" && f.source !== "example") return 1;
  const questions =
    f.source === "example"
      ? exampleQuestions(d.launch.service[d.lang] ?? d.serviceFocus, d.lang)
      : f.questions;
  const custom = questions.filter(q => !isContact(q)).length;
  return 1 + Math.min(6, custom) + 1;
}

function FormSlide({ ctx }: { ctx: SlideCtx }) {
  const { d, lang, tour, still } = ctx;
  const F = LAUNCH.form;
  const f = d.launch.form;
  const service = d.launch.service[lang] ?? d.serviceFocus;
  const questions: FormQuestion[] =
    f.source === "example" ? exampleQuestions(service, lang) : f.questions;
  const custom = questions
    .map((q, i) => ({ q, i }))
    .filter(x => !isContact(x.q))
    .slice(0, 6);
  const stops = formStops(d);
  const destination = f.source !== "example" && f.kind !== "form";
  const screen: FormScreen =
    destination || tour === 0
      ? "intro"
      : tour >= stops - 1
        ? "thanks"
        : "questions";
  const lit = screen === "questions" ? (custom[tour - 1]?.i ?? null) : null;
  const pageRef = useRef<HTMLDivElement>(null);
  const [leader, setLeader] = useState<{
    a: [number, number];
    b: [number, number];
  } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: measured again when the lit question or the form changes
  useEffect(() => {
    const root = pageRef.current;
    if (!root || lit == null) {
      setLeader(null);
      return;
    }
    // Measured once the phone has scrolled its question into view.
    const measure = () => {
      const q = root.querySelector<HTMLElement>('[data-part="question"]');
      const row = root.querySelector<HTMLElement>("[data-row-lit]");
      if (!q || !row) {
        setLeader(null);
        return;
      }
      const box = root.getBoundingClientRect();
      const k = box.width / root.offsetWidth || 1;
      const qa = q.getBoundingClientRect();
      const ra = row.getBoundingClientRect();
      const rtl = lang === "ar";
      setLeader({
        a: [
          ((rtl ? qa.left - 4 : qa.right + 4) - box.left) / k,
          (qa.top + 14 - box.top) / k,
        ],
        b: [
          ((rtl ? ra.right + 12 : ra.left - 12) - box.left) / k,
          ((ra.top + ra.bottom) / 2 - box.top) / k,
        ],
      });
    };
    measure();
    const late = window.setTimeout(measure, still ? 40 : 480);
    return () => window.clearTimeout(late);
  }, [lit, lang, tour, still]);
  const typeLabel = (q: FormQuestion) =>
    isContact(q)
      ? t({ en: "Filled in by Meta", ar: "تعبّيه ميتا تلقائياً" }, lang)
      : t(F.choice, lang);
  const thanksLine = d.launch.welcomeVideo ? F.thanksVideo : F.thanksLine;
  return (
    <div className="dkc-form-slide" ref={pageRef}>
      <div className="dkc-form-phone">
        <FormPhone ctx={ctx} height={852} screen={screen} focus={lit} />
      </div>
      <div className="dkc-form-side">
        <Owner lane="customer" text={F.owner} lang={lang} />
        <div className="dkc-title-tag">
          <h2 className="dk-h2">{t(F.title, lang)}</h2>
          {f.source === "example" ? (
            <span className="dk-tag">{t(SHARED.tag.exampleForm, lang)}</span>
          ) : opensWhatsApp(d) ? (
            <span className="dk-tag">{t(SHARED.tag.exampleWording, lang)}</span>
          ) : null}
        </div>
        <p className="dk-body dk-ink2 dkc-form-line">
          {destination && f.kind === "whatsapp"
            ? t(F.whatsapp, lang)
            : f.source === "example"
              ? t(F.fallback, lang)
              : t(d.mode.dwy ? F.lineDwy : F.line, lang)}
        </p>
        {destination ? (
          f.kind === "website" ? (
            <p className="dk-body">{t(F.page, lang)}</p>
          ) : (
            // A WhatsApp ad: what happens after the chat opens, step by step.
            <div className="dkc-wa-next">
              <span className="dk-label">{t(F.waNextHead, lang)}</span>
              <ol>
                {[...F.waNext, d.mode.dwy ? F.waNextDwy : F.waNextUs].map(
                  (step, i) => (
                    <li key={step.en}>
                      <span className="dkc-q-n">{stepNumeral(i, lang)}</span>
                      <span className="dk-body">{t(step, lang)}</span>
                    </li>
                  ),
                )}
              </ol>
            </div>
          )
        ) : (
          // The thank-you stop keeps the list (every question passed, dimmed)
          // and lights the step after it, so the column reads as the form's
          // last screen, not two lines over empty ground.
          <div
            className="dkc-qlist"
            data-thanks={screen === "thanks" ? "" : undefined}
          >
            <span className="dk-label">{t(F.list, lang)}</span>
            <ol>
              {questions.map((q, i) => {
                const n = custom.findIndex(x => x.i === i);
                const isLit = i === lit;
                return (
                  <li
                    key={`${q.type}-${q.label}-${String(i)}`}
                    data-row-lit={isLit ? "" : undefined}
                    data-dim={
                      (lit != null && !isLit) || screen === "thanks"
                        ? ""
                        : undefined
                    }
                  >
                    <span className="dkc-q-n">
                      {n >= 0 ? stepNumeral(n, lang) : ""}
                    </span>
                    <span className="dkc-q-label dkc-theirs" dir="auto">
                      {isContact(q)
                        ? t(
                            q.type === "name"
                              ? { en: "Full name", ar: "الاسم الكامل" }
                              : q.type === "phone"
                                ? { en: "Phone number", ar: "رقم الهاتف" }
                                : q.type === "email"
                                  ? { en: "Email", ar: "البريد الإلكتروني" }
                                  : { en: "City", ar: "المدينة" },
                            lang,
                          )
                        : q.label}
                      {q.note ? (
                        <span className="dkc-q-note">{q.note}</span>
                      ) : null}
                    </span>
                    <span className="dkc-q-type">{typeLabel(q)}</span>
                    <span className="dkc-q-gate">
                      {q.isGate ? (
                        <span className="dkc-gate">{t(F.gate, lang)}</span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ol>
            {screen === "thanks" ? (
              // The line alone: the stop's name would only repeat it.
              <div className="dkc-form-thanks-side">
                <p className="dk-body">{t(thanksLine, lang)}</p>
              </div>
            ) : (
              <p className="dk-small dk-ink2">{t(F.thanksStep, lang)}</p>
            )}
          </div>
        )}
      </div>
      {leader ? (
        <svg className="dkc-form-leader" aria-hidden>
          <path
            d={`M ${leader.a[0]} ${leader.a[1]} L ${(leader.a[0] + leader.b[0]) / 2} ${leader.a[1]} L ${(leader.a[0] + leader.b[0]) / 2} ${leader.b[1]} L ${leader.b[0]} ${leader.b[1]}`}
            fill="none"
            stroke="var(--dk-line-strong)"
            strokeWidth={2}
          />
          <circle
            cx={leader.a[0]}
            cy={leader.a[1]}
            r={6}
            fill="var(--dk-teal)"
          />
        </svg>
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------- L6 call

const subtitlesOn = (ctx: SlideCtx) => ctx.live.subtitles ?? ctx.lang === "en";

/**
 * A label that runs on into the legend ends as a sentence first: done with
 * you's label ("From the playbook we give you") has no full stop of its own.
 */
export const sentence = (s: string) =>
  /[.!?؟。]\s*$/.test(s) ? s : `${s.trimEnd()}.`;

function CallSlide({ ctx }: { ctx: SlideCtx }) {
  const { d, lang, tour, still, setTour } = ctx;
  const C = LAUNCH.call;
  const call = d.launch.call;
  const dwy = d.mode.dwy;
  const subtitles = subtitlesOn(ctx);
  const run = useCallCursor({
    turns: call.turns,
    tour,
    lang,
    subtitles,
    still,
    setTour,
  });
  const phase =
    tour < CALL_STAGES ? "call" : tour === CALL_STAGES ? "after" : "lands";
  const shown =
    phase === "call"
      ? Math.min(run.shown, call.turns.length)
      : call.turns.length;
  const clock = clockAt(call.turns, shown);
  const current = phase === "call" ? tour : CALL_STAGES;
  const confirmIndex = call.turns.findIndex(x => x.at === "4:29");
  const service = d.launch.service[lang] ?? d.serviceFocus;
  const place = call.place;
  const company = lang === "ar" ? (d.nameAr ?? d.nameEn) : d.nameEn;
  const confirmation = [
    { text: plain(CONFIRMATION.opening[lang], lang, call.slots) },
    // The template's Latin date and time, kept whole in an Arabic line.
    {
      text: tf(CONFIRMATION.date, lang, {
        date: `\u2066${call.slot.templateDate}\u2069`,
      }),
    },
    {
      text: tf(CONFIRMATION.time, lang, {
        time: `\u2066${call.slot.templateTime}\u2069`,
      }),
    },
    ...(place
      ? [
          {
            text: tf(CONFIRMATION.place, lang, {
              place: t(PLACE_WRITTEN[place], lang),
            }),
            link: place === "office",
          },
        ]
      : []),
    { text: t(CONFIRMATION.closing, lang) },
  ];
  // A slot still to give us shows as a dashed chip in the transcript.
  const asks = Object.values(call.slots).some(v => Boolean(v[lang].ask));
  const N = C.lands;
  const notes = [
    t(LANDS_NOTES.planning, lang),
    tf(LANDS_NOTES.budget, lang, { note: call.band.note[lang] }),
    t(LANDS_NOTES.pain[call.pain], lang),
  ];
  return (
    <div className="dkc-call" data-phase={phase}>
      <Owner
        lane={dwy ? "you" : "us"}
        text={dwy ? LAUNCH.portal.owner : C.owner}
        lang={lang}
      />
      <h2 className="dk-h2">{t(dwy ? C.titleDwy : C.title, lang)}</h2>
      <div className="dkc-call-sub">
        <p className="dk-body dk-ink2">
          <bdi>{d.name}</bdi>
          {service ? (
            <>
              {" · "}
              <bdi>{service}</bdi>
            </>
          ) : null}
        </p>
        {/* One tag on the screen: the transcript's while it plays. Stop 7's
            confirmation and stop 8's appointment carry their own. */}
        <span
          className="dk-tag"
          style={phase === "call" ? undefined : { visibility: "hidden" }}
        >
          {t(dwy ? C.tagDwy : C.tag, lang)}
        </span>
      </div>
      <div className="dkc-call-main">
        <aside className="dkc-call-card">
          <div className="dkc-call-card-head">
            <ClientMark who={who(d)} size={56} />
            <span className="dkc-call-card-name">
              <bdi>{tf(dwy ? C.cardDwy : C.card, lang, { name: company })}</bdi>
            </span>
          </div>
          <div className="dkc-clock">
            <span className="dk-label">
              {t(clock.ended ? C.clockEnd : C.clockOn, lang)}
            </span>
            <b className="dk-ltr">{clock.at}</b>
          </div>
          <ol className="dkc-stages">
            {C.stages.map((s, i) => {
              const state =
                i < current ? "past" : i === current ? "now" : "ahead";
              return (
                <li
                  key={s.en}
                  data-state={state}
                  aria-current={state === "now" ? "step" : undefined}
                >
                  <span className="dkc-stage-n">
                    {state === "past" ? (
                      <svg
                        width="22"
                        height="22"
                        viewBox="0 0 22 22"
                        aria-hidden
                      >
                        <path
                          d="M 5 11.5 L 9 15.5 L 17 7"
                          fill="none"
                          stroke="var(--dk-teal)"
                          strokeWidth={2.5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : (
                      stepNumeral(i, lang)
                    )}
                  </span>
                  <span>{t(s, lang)}</span>
                </li>
              );
            })}
          </ol>
        </aside>
        <div className="dkc-call-record">
          <Transcript
            turns={call.turns}
            shown={shown}
            slots={call.slots}
            dialect={call.dialect}
            lang={lang}
            subtitles={subtitles}
            dwy={dwy}
            only={phase === "after" ? confirmIndex : null}
            still={still}
          />
        </div>
        <div
          className="dkc-after"
          aria-hidden={phase === "call"}
          data-line={dwy ? "" : undefined}
        >
          {dwy ? (
            <p className="dk-body dkc-after-line">{t(C.after.lineDwy, lang)}</p>
          ) : null}
          <div className="dkc-after-row">
            <Reminders
              lang={lang}
              dwy={dwy}
              lit={phase !== "call"}
              still={still}
            />
            <Tagged
              tag={t(SHARED.tag.exampleWording, lang)}
              className="dkc-after-wa"
            >
              <Confirmation who={who(d)} name={company} lines={confirmation} />
            </Tagged>
          </div>
        </div>
        <div className="dkc-lands" aria-hidden={phase !== "lands"}>
          <Tagged tag={t(SHARED.tag.example, lang)}>
            <AppointmentCard
              lang={lang}
              rows={[
                { label: N.who, value: t(LANDS_NOTES.customer, lang) },
                {
                  label: N.when,
                  value: `${call.slot.day[lang]}${lang === "ar" ? "، " : ", "}${call.slot.written[lang]}`,
                },
                {
                  label: N.where,
                  value: place
                    ? t(N.places[place], lang)
                    : t(N.places.office, lang),
                },
                {
                  label: N.service,
                  // Not known yet: the call's own chip, never a placeholder.
                  value: service ? (
                    <bdi>{service}</bdi>
                  ) : (
                    <span className="dkc-ask">
                      <span>
                        {t(TO_GIVE, lang)}: {t(ASK.service, lang)}
                      </span>
                    </span>
                  ),
                },
              ]}
              notes={notes}
              dwy={dwy}
            />
          </Tagged>
          <p className="dk-small dk-ink2">
            {t(dwy ? N.captionDwy : N.caption, lang)}
          </p>
        </div>
      </div>
      <div className="dkc-call-foot">
        <p className="dk-small dk-ink2">
          {sentence(t(dwy ? C.labelDwy : C.label, lang))} {t(C.legend, lang)}
        </p>
        {/* One sentence about the chips, and only when there is one. */}
        {asks ? (
          <p className="dk-small dk-ink2">
            {t(call.guideChecked ? C.guide : C.guideUnchecked, lang)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- L7 portal

function portalStops(d: DeckData) {
  const all = LAUNCH.portal.stops;
  if (!d.mode.dwy) return all;
  if (d.launch.dwyOs) return all.filter(s => s.key !== "calls");
  return all.filter(s => s.key === "outcome");
}

function PortalSlide({ ctx }: { ctx: SlideCtx }) {
  const { d, lang, tour, still, setTour } = ctx;
  const P = LAUNCH.portal;
  const stops = portalStops(d);
  const at = stops[Math.min(tour, stops.length - 1)];
  const dwy = d.mode.dwy;
  const crm = dwy && !d.launch.dwyOs;
  const name = (s: (typeof stops)[number]) =>
    dwy && s.nameDwy ? s.nameDwy : s.name;
  const copy = (s: (typeof stops)[number]) =>
    dwy && s.copyDwy ? s.copyDwy : s.copy;
  let screen: ReactNode;
  if (at.key === "phone")
    screen = (
      <Tagged tag={t(SHARED.tag.demo, lang)} className="dkc-portal-film">
        <div className="dkc-film">
          {/* Still, and before it plays: a frame from inside the app (its
              overview, cropped to the screen), not the recording's splash.
              The recording itself is cropped to the same screen in CSS. */}
          <img src={lang === "ar" ? phoneAr : phoneEn} alt="" />
          {still ? null : (
            <video
              key={lang}
              src={`${LINKS.portal}/demos/mahara-mobile-${lang}.mp4`}
              muted
              playsInline
              autoPlay
              loop={false}
              preload="metadata"
            />
          )}
        </div>
      </Tagged>
    );
  else if (at.key === "outcome" && crm)
    screen = (
      // The stop's own name already says it is their number-one job, so
      // the drawing carries no second tag saying so.
      <div className="dkc-portal-crm">
        <CrmStages lang={lang} width={820} drop={230} />
      </div>
    );
  else {
    const shot = SHOTS[at.key as "overview" | "calls" | "outcome"];
    screen = (
      <Tagged
        tag={at.key === "outcome" ? null : t(SHARED.tag.demo, lang)}
        className="dkc-portal-shot dkc-screen"
      >
        {at.key === "outcome" ? (
          <div className="dkc-shot-tags">
            <span className="dkc-job-tag">{t(P.jobTag, lang)}</span>
            <span className="dk-tag">{t(SHARED.tag.demo, lang)}</span>
          </div>
        ) : null}
        <Crop
          src={shot.src[lang]}
          crop={shot.crop[lang]}
          width={1080}
          radius={10}
        />
      </Tagged>
    );
  }
  return (
    <div className="dkc-portal">
      <div className="dkc-portal-start">
        <Owner lane="you" text={P.owner} lang={lang} />
        <h2 className="dk-h2">
          {/* "Mahara OS" never breaks across two lines. */}
          {t(crm ? P.titleDwy : P.title, lang).replace(
            "Mahara OS",
            "Mahara\u00a0OS",
          )}
        </h2>
        <ol className="dkc-portal-stops">
          {stops.map((s, i) => (
            <li
              key={s.key}
              data-state={i === tour ? "now" : i < tour ? "past" : "ahead"}
            >
              <button
                type="button"
                className="dkc-press"
                aria-current={i === tour ? "step" : undefined}
                onClick={() => setTour(i)}
                onPointerUp={letGo}
              >
                {t(name(s), lang)}
              </button>
              {/* A slide of one stop gives its words the body's size. */}
              {i === tour ? (
                <p
                  className={`${stops.length === 1 ? "dk-body" : "dk-small"} dk-ink2`}
                >
                  {t(copy(s), lang)}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
        {at.key === "outcome" ? (
          <p className="dk-body dkc-portal-foot">{t(P.footer, lang)}</p>
        ) : null}
      </div>
      <div className="dkc-portal-screen" key={`${at.key}-${lang}`}>
        {screen}
      </div>
    </div>
  );
}

// ---------------------------------------------------------- L8 your part

/**
 * The pictures sit on the rows they show (DESIGN 8.8, after the second
 * critic pass): three of their creatives at the end of "Leave the ads
 * running", and a calendar day with a blocked hour at the end of "Block
 * busy times". A tray of fewer than three gives no strip (one or two lone
 * tiles read as gaps), and that row's words run on.
 */
function PartTray({ ctx }: { ctx: SlideCtx }) {
  const model = useCreatives(ctx);
  const tiles = [...model.tray, ...model.meta]
    .map(c => c.poster ?? c.url)
    .filter((x): x is string => Boolean(x))
    .slice(0, 3);
  if (tiles.length < 3) return null;
  return (
    <span className="dkc-part-pic dkc-part-tray" aria-hidden>
      {tiles.map((src, i) => (
        <i key={`t-${String(i)}`}>
          <img src={src} alt="" draggable={false} />
        </i>
      ))}
    </span>
  );
}

/** A day in their calendar with one hour blocked, as the journey's card draws a day. */
function PartDay({ ctx }: { ctx: SlideCtx }) {
  const { d, lang } = ctx;
  const hours = LAUNCH.journey.calendar.hours.slice(0, 3);
  return (
    <span className="dkc-part-pic dkc-part-day" aria-hidden>
      <b className="dkc-part-dayname">
        {dayShort(d.launch.call.slot.iso, lang, d.timeZone)}
      </b>
      {hours.map((h, i) => (
        <span key={h.en} className="dkc-part-hour">
          <span className="dkc-part-time">{t(h, lang)}</span>
          <i />
          {i === 1 ? (
            <b className="dkc-part-busy">
              <svg aria-hidden="true">
                <defs>
                  <pattern
                    id="dkc-part-hatch"
                    width="10"
                    height="10"
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(45)"
                  >
                    <line
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="10"
                      stroke="var(--dk-line-strong)"
                      strokeWidth="3"
                    />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#dkc-part-hatch)" />
              </svg>
              <span>{t(LAUNCH.part.busy, lang)}</span>
            </b>
          ) : null}
        </span>
      ))}
    </span>
  );
}

function YourPart({ ctx }: { ctx: SlideCtx }) {
  const { d, lang } = ctx;
  const P = LAUNCH.part;
  const dwy = d.mode.dwy;
  const pics: Record<string, ReactNode> = {
    ads: <PartTray ctx={ctx} />,
    calendar: <PartDay ctx={ctx} />,
  };
  return (
    <div className="dkc-part">
      <h2 className="dk-h2">{t(P.title, lang)}</h2>
      <p className="dk-lead dkc-part-line">{t(P.line, lang)}</p>
      <div className="dkc-part-list">
        <div className="dkc-part-head">
          <span />
          <span className="dk-label">{t(P.why, lang)}</span>
        </div>
        <ul className="dkc-part-rows">
          {P.rows.map(r => (
            <li key={r.key}>
              <b className="dkc-part-job">
                {t(dwy && r.jobDwy ? r.jobDwy : r.job, lang)}
              </b>
              <span className="dkc-part-why">
                {t(dwy && r.whyDwy ? r.whyDwy : r.why, lang)}
              </span>
              {pics[r.key] ?? null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ------------------------------------------------------- L9 first 90 days

const DAY = 86_400_000;

function Programme({ ctx }: { ctx: SlideCtx }) {
  const { d, lang, still } = ctx;
  const D = LAUNCH.days;
  const start = d.goLive ? new Date(`${d.goLive}T12:00:00Z`).getTime() : null;
  // The chart runs from go-live to day 90 and ends there, on its own marked
  // line: the title's 90 days are on the axis. The weeks head from day 0 to
  // day 77; week 13's head (day 84) would sit on day 90's.
  const DAYS = 90;
  const weeks = Array.from({ length: 12 }, (_, i) => i);
  const W = 1648 - 300;
  const col = (7 / DAYS) * W;
  const x = (day: number) => (day / DAYS) * W;
  const booked =
    d.launch.checkin && start
      ? Math.round((new Date(d.launch.checkin).getTime() - start) / DAY)
      : null;
  const first = booked != null && booked >= 3 && booked <= 21 ? booked : null;
  const after = Array.from(
    { length: 6 },
    (_, i) => (first ?? 14) + 14 * (i + 1),
  ).filter(n => n <= DAYS);
  const ring = new Set(
    [30, 60, 90].map(target =>
      [first ?? 10, ...after].reduce((a, b) =>
        Math.abs(b - target) < Math.abs(a - target) ? b : a,
      ),
    ),
  );
  // A programme's week heads: the day, with the month where it changes.
  const dayLabel = (at: number, prevAt: number | null) => {
    const day = new Date((start as number) + at * DAY);
    const month =
      prevAt == null ||
      day.getUTCMonth() !==
        new Date((start as number) + prevAt * DAY).getUTCMonth();
    const n = digits(day.getUTCDate(), lang);
    if (!month) return { text: n, month: false };
    const name = new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en-GB", {
      month: lang === "ar" ? "long" : "short",
      calendar: "gregory",
      timeZone: "UTC",
    }).format(day);
    return { text: `${n} ${name}`, month: true };
  };
  const label = (i: number): { text: string; month: boolean } =>
    // No go-live date: bare week numbers under the axis title "Week".
    start
      ? dayLabel(i * 7, i ? (i - 1) * 7 : null)
      : { text: digits(i + 1, lang), month: false };
  // Day 90's date, with its month (it ends the axis).
  const endDate = start ? dayLabel(DAYS, null).text : null;
  return (
    <div className="dkc-prog" data-still={still ? "" : undefined}>
      <div
        className="dkc-prog-grid"
        style={{ "--col": `${col}px` } as CSSProperties}
      >
        {start ? (
          <span />
        ) : (
          <span className="dkc-prog-axis">
            {tf(D.week, lang, { n: "" }).trim()}
          </span>
        )}
        <div className="dkc-prog-weeks">
          {weeks.map(i => {
            const l = label(i);
            return (
              <span
                key={i}
                className="dkc-prog-week"
                data-month={l.month ? "" : undefined}
                style={{ insetInlineStart: i * col + 12 }}
              >
                {l.text}
              </span>
            );
          })}
          <i className="dkc-prog-golive" />
          <span className="dkc-prog-golive-label">{t(D.goLive, lang)}</span>
          {/* The end: day 90, its name and date ending on its line. */}
          <i className="dkc-prog-end" style={{ insetInlineStart: x(DAYS) }} />
          <span className="dkc-prog-end-label">{t(D.day90, lang)}</span>
          {endDate ? (
            <span className="dkc-prog-week dkc-prog-end-date" data-month="">
              {endDate}
            </span>
          ) : null}
        </div>
        <span className="dkc-prog-row-name">{t(D.finding, lang)}</span>
        <div className="dkc-prog-lane">
          <i className="dkc-prog-bar" style={{ width: x(14) }} />
          <i
            className="dkc-prog-float"
            style={{ insetInlineStart: x(14), width: x(35) - x(14) }}
          />
          <span className="dkc-prog-note" style={{ insetInlineStart: 12 }}>
            {t(D.weeks12, lang)}
          </span>
          <span
            className="dkc-prog-note dkc-prog-open"
            style={{ insetInlineStart: x(14) + 12 }}
          >
            {t(D.open, lang)}
          </span>
        </div>
        <span className="dkc-prog-row-name">{t(D.checkins, lang)}</span>
        <div className="dkc-prog-lane dkc-prog-checks">
          {first == null ? (
            // Not booked yet: the diamond open, a week or two in.
            <i
              className="dkc-prog-diamond"
              data-open=""
              style={{ insetInlineStart: x(10) }}
            />
          ) : (
            <i
              className="dkc-prog-diamond"
              data-ring={ring.has(first) ? "" : undefined}
              style={{ insetInlineStart: x(first) }}
            />
          )}
          {after.map(n => (
            <i
              key={n}
              className="dkc-prog-diamond"
              data-ring={ring.has(n) ? "" : undefined}
              style={{ insetInlineStart: x(n) }}
            />
          ))}
          {/* Its words start under the first diamond's start edge. */}
          <span
            className="dkc-prog-note"
            style={{ insetInlineStart: x(first ?? 10) - 9 }}
          >
            {d.launch.checkin
              ? `${t(D.first, lang).split(" · ")[0]} · ${dayShort(d.launch.checkin, lang, d.timeZone)}`
              : t(D.first, lang)}
          </span>
        </div>
        <span />
        {/* Each line under the chart starts with the mark it explains. */}
        <div className="dkc-prog-under">
          <p className="dk-small">
            <i className="dkc-prog-key" aria-hidden />
            <span>
              <b>{t(D.later, lang)}</b> · {t(D.laterLine, lang)}
            </span>
          </p>
          <p className="dk-small dk-ink2">
            <i className="dkc-prog-key" data-ring="" aria-hidden />
            <span>{t(D.looksBack, lang)}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

function FirstNinety({ ctx }: { ctx: SlideCtx }) {
  const { d, lang } = ctx;
  const D = LAUNCH.days;
  return (
    // With no goal line the chart and its milestones sit in the middle of
    // the room under the title, not high with a void before the footer.
    <div className="dkc-days" data-nogoal={d.launch.goal90 ? undefined : ""}>
      <h2 className="dk-h2">{t(D.title, lang)}</h2>
      {d.launch.goal90 ? (
        <div className="dkc-days-goal">
          <span className="dk-label">{t(D.goal, lang)}</span>
          <p className="dkc-days-goal-line dkc-theirs" dir="auto">
            {d.launch.goal90}
          </p>
          <p className="dk-small dk-ink2">{t(D.goalFoot, lang)}</p>
        </div>
      ) : null}
      <Programme ctx={ctx} />
      <div className="dkc-days-ms">
        <span className="dk-label">{t(D.msLabel, lang)}</span>
        <ol>
          {D.milestones.map((m, i) => (
            <li key={m.en}>
              {i ? (
                <span className="dkc-ms-sep" aria-hidden>
                  {lang === "ar" ? "‹" : "›"}
                </span>
              ) : null}
              <span>{t(m, lang)}</span>
            </li>
          ))}
        </ol>
      </div>
      <p className="dk-small dk-ink2 dkc-days-foot">{t(D.footer, lang)}</p>
    </div>
  );
}

// -------------------------------------------------------- L10 green light

function GreenLight({ ctx }: { ctx: SlideCtx }) {
  const { d, lang, tour } = ctx;
  const G = LAUNCH.green;
  const cards = [
    G.charges,
    G.comments,
    ...(d.launch.hoursCard ? [isUae(d) ? G.hoursUae : G.hours] : []),
  ];
  if (tour === 0)
    // The housekeeping first, on its own: the title on the start side, the
    // two or three things to know as ruled rows beside it. The question is
    // the next press, never shown greyed out ahead of time.
    return (
      <div className="dkc-green dkc-green-one" key="one">
        <h2 className="dk-h1">{t(G.title, lang)}</h2>
        <ul className="dkc-green-list">
          {cards.map(c => (
            <li key={c.en} className="dk-lead">
              {t(c, lang)}
            </li>
          ))}
        </ul>
      </div>
    );
  // The question alone with the road behind it: the reminders were said a
  // press ago, so they are not repeated small above it.
  return (
    <div className="dkc-green dkc-green-two" key="two">
      <p className="dk-display dkc-green-question">{t(G.question, lang)}</p>
      {/* The road walked, drawn level as the cover's strip is: under the
          ask, steps down toward its end would read as a falling chart. Its
          end is always named, with the date once there is one. */}
      <div className="dkc-green-rail">
        <MiniRail
          lang={lang}
          current={6}
          dwy={d.mode.dwy}
          all
          scale={1.8}
          col={212}
          rowGap={0}
          end={16}
          className="dkc-green-mini"
        />
        <span className="dkc-green-golive">
          {d.goLive
            ? tf(G.rail, lang, { date: dayMonth(d.goLive, lang, d.timeZone) })
            : t(LAUNCH.days.goLive, lang)}
        </span>
      </div>
      {d.launch.checkin ? (
        <p className="dk-body dkc-green-next">
          {tf(G.next, lang, {
            date: dayShort(d.launch.checkin, lang, d.timeZone),
          })}
        </p>
      ) : null}
    </div>
  );
}

// -------------------------------------------------------------- the slides

/** The ads slide's keys: 1, 2, 3 place the selected creative; M marks their pick. */
function adsKey(key: string, ctx: SlideCtx): boolean {
  const k = key.toLowerCase();
  const selected = ctx.live.selected;
  if (["1", "2", "3"].includes(k)) {
    if (!selected) return true;
    ctx.setLive(l => {
      const phone = PHONES[Number(k) - 1];
      return {
        ...l,
        phones: { ...(l.phones ?? {}), [phone]: selected },
        undo: { phones: l.phones ?? {}, at: Date.now() },
      };
    });
    return true;
  }
  if (k === "m") {
    if (selected && !selected.startsWith("local-"))
      ctx.save(
        { their_pick: ctx.d.launch.pick === selected ? null : selected },
        true,
      );
    return true;
  }
  return false;
}

/** The call's keys: P plays it through or pauses, R replays the stage, S subtitles, D dialect. */
function callKey(key: string, ctx: SlideCtx): boolean {
  const k = key.toLowerCase();
  if (k === "p") {
    callRun.toggle();
    return true;
  }
  if (k === "r") {
    callRun.replay();
    return true;
  }
  if (k === "s") {
    const on = subtitlesOn(ctx);
    ctx.setLive(l => ({ ...l, subtitles: !on }));
    return true;
  }
  if (k === "d") {
    ctx.save(
      { dialect: ctx.d.launch.call.dialect === "sa" ? "kw" : "sa" },
      true,
    );
    return true;
  }
  return false;
}

export const callPlaying = (turns: CallTurn[], tour: number) => {
  const [, end] = stageRange(turns, tour + 1);
  return callRun.state.tour === tour && callRun.state.shown < end;
};

export function launchSlides(): SlideDef[] {
  const N = L_NOTES;
  return [
    {
      id: "cover",
      title: L_TITLES.cover,
      cover: true,
      notes: N.cover,
      render: ctx => <Cover ctx={ctx} />,
      missing: d => [
        ...(d.logo
          ? []
          : ["No logo. Upload one, or the deck shows their initials."]),
        ...(d.goLive
          ? []
          : [
              "No go-live date on the card. Add it here; the cover and the 90 days use it.",
            ]),
        ...(d.launch.cover
          ? []
          : [
              "Cover: pick one of their custom creatives, or the cover shows the lanes.",
            ]),
      ],
    },
    {
      id: "journey",
      title: L_TITLES.journey,
      notes: N.journey,
      stops: () => 7,
      stopName: (i, ctx) =>
        JOURNEY.rows[i]
          ? (ctx.d.mode.dwy && JOURNEY.rows[i].dwy) || JOURNEY.rows[i].name
          : null,
      render: ctx => <Journey ctx={ctx} />,
      missing: d => [
        ...(d.mode.known
          ? []
          : [
              "Service model not set. The deck uses done for you. Change it if their team calls.",
            ]),
        ...(d.launch.calendar === "todo"
          ? [
              "The kickoff says Google Calendar is not connected, so stop 5 asks them to connect it.",
            ]
          : []),
      ],
    },
    {
      id: "ads",
      title: L_TITLES.ads,
      notes: N.ads,
      stops: () => 4,
      stopName: i =>
        i === 0
          ? null
          : [SHARED.frame.feed, SHARED.frame.reels, SHARED.frame.facebook][
              i - 1
            ],
      rail: () => 0,
      onKey: adsKey,
      render: ctx => <Ads ctx={ctx} />,
      missing: d => {
        const out: string[] = [];
        if (!d.launch.creatives.length && !d.launch.metaCreatives.length)
          out.push(
            "No ads yet. Upload them here so the tray is full before the call.",
          );
        return out;
      },
    },
    {
      id: "creative-freedom",
      title: L_TITLES["creative-freedom"],
      notes: N["creative-freedom"],
      stops: ctx => (ctx.d.launch.proofShown ? 4 : 3),
      stopName: i =>
        [
          LAUNCH.test.page.name,
          LAUNCH.test.fixed.name,
          LAUNCH.test.open.name,
          LAUNCH.test.proof.name,
        ][i] ?? null,
      rail: () => 0,
      onKey: (key, ctx) => {
        if (key.toLowerCase() !== "a") return false;
        ctx.save(
          { creative_agreed_at: ctx.d.launch.agreedAt ? null : true },
          true,
        );
        return true;
      },
      render: ctx => <CreativeFreedom ctx={ctx} />,
      missing: d => {
        const R = d.launch.redLines;
        return R.told.length || R.always.length || R.never.length
          ? []
          : [
              "No Do's & Don'ts on the card and none typed on the onboarding call. The panel invites them to tell you now.",
            ];
      },
    },
    {
      id: "form",
      title: L_TITLES.form,
      notes: N.form,
      stops: ctx => formStops(ctx.d),
      stopName: (i, ctx) => {
        const n = formStops(ctx.d);
        return i === 0
          ? LAUNCH.form.stops[0]
          : i === n - 1
            ? LAUNCH.form.stops[2]
            : LAUNCH.form.stops[1];
      },
      rail: () => 1,
      defaultHidden: d => d.launch.formHidden,
      hiddenWhy:
        "No form confirmed. Pick their form from their campaigns and tick 'This is their form', or type the questions. Otherwise the form slide stays hidden.",
      render: ctx => <FormSlide ctx={ctx} />,
      missing: d =>
        d.launch.formHidden
          ? [
              "No form confirmed. Pick their form from their campaigns and tick 'This is their form', or type the questions.",
            ]
          : d.launch.form.kind === "whatsapp"
            ? [
                "Their ad opens WhatsApp. Check the destination with the media buyer before the call.",
              ]
            : [],
    },
    {
      id: "call",
      title: L_TITLES.call,
      notes: N.call,
      stops: () => 8,
      stopName: i =>
        i < CALL_STAGES
          ? LAUNCH.call.stages[i]
          : i === CALL_STAGES
            ? LAUNCH.call.stop7
            : LAUNCH.call.stop8,
      rail: ctx =>
        ctx.tour < CALL_STAGES ? 2 : ctx.tour === CALL_STAGES ? 3 : 4,
      intercept: (dir, ctx) => {
        if (dir !== 1 || ctx.tour >= CALL_STAGES) return false;
        if (!callPlaying(ctx.d.launch.call.turns, ctx.tour)) return false;
        return callRun.finish();
      },
      onKey: callKey,
      render: ctx => <CallSlide ctx={ctx} />,
      missing: d => [
        ...d.launch.call.missing,
        ...(d.launch.call.guideChecked
          ? []
          : [
              "Call guide not checked. Open it, and tick once it's the page the dialer reads.",
            ]),
        ...(d.launch.call.dialectFrom === "default"
          ? [
              "No country on file: the call uses the Kuwaiti dialect. Change it if they're in Saudi Arabia.",
            ]
          : []),
      ],
    },
    {
      id: "portal",
      title: L_TITLES.portal,
      notes: N.portal,
      stops: ctx => portalStops(ctx.d).length,
      stopName: (i, ctx) => {
        const s = portalStops(ctx.d)[i];
        return s ? (ctx.d.mode.dwy && s.nameDwy) || s.name : null;
      },
      rail: () => 6,
      render: ctx => <PortalSlide ctx={ctx} />,
      missing: d =>
        d.mode.dwy && !d.launch.dwyOs
          ? [
              "Done with you: Mahara OS not approved for this client. Its screens stay hidden; the slide shows their CRM stages.",
            ]
          : [],
    },
    {
      id: "your-part",
      title: L_TITLES["your-part"],
      notes: N["your-part"],
      render: ctx => <YourPart ctx={ctx} />,
    },
    {
      id: "first-90-days",
      title: L_TITLES["first-90-days"],
      notes: N["first-90-days"],
      render: ctx => <FirstNinety ctx={ctx} />,
      missing: d => [
        ...(d.goLive
          ? []
          : ["No go-live date: the 90 days count weeks, not dates."]),
        ...(d.launch.goal90
          ? []
          : [
              "No 90-day goal to show (none in the form, or it counts enquiries or appointments). The line is left out.",
            ]),
      ],
    },
    {
      id: "green-light",
      title: L_TITLES["green-light"],
      notes: N["green-light"],
      stops: () => 2,
      render: ctx => <GreenLight ctx={ctx} />,
      missing: d =>
        d.launch.checkin
          ? []
          : [
              "Book the first check-in from the notes window, a week or two after go-live.",
            ],
    },
  ];
}

export { formStops, placesLine, portalStops };
