import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import maharaLogo from "@/assets/mahara-logo-dark.png";
import { AdTray, PhoneRow, useCreatives, useWarmExample } from "./AdsStage";
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
  digits,
  EXAMPLE,
  JOURNEY,
  journeyOwners,
  type L,
  L_NOTES,
  L_TITLES,
  LAUNCH,
  type LaneKey,
  type Lang,
  LINKS,
  partJobs,
  SHARED,
  sep,
  stepNumeral,
  t,
  tf,
} from "./content";
import { type Creative, phoneFor } from "./creative";
import { dayMonth, dayShort, weekdayDate } from "./dates";
import type { SlideCtx, SlideDef } from "./deckContext";
import type { DeckData } from "./deckData";
import { scenesNamed, serviceField, serviceRound } from "./examples";
import { useHug } from "./hug";
import {
  FaintLanes,
  JourneyLanes,
  LANES_W,
  MiniRail,
  Node,
  RebookMark,
  rowY,
} from "./JourneyLanes";
import { type FormQuestion, PHONES, starterTag } from "./launchData";
import {
  PARTNER_STOPS,
  Partnership,
  partnerStop,
  TRAINING_STOPS,
  Training,
} from "./launchExpect";
import {
  AdField,
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
import { StageSwap } from "./StageSwap";
import { queueServices } from "./services";
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
 * The launch deck: thirteen slides, about 27 minutes of a call booked for
 * about 45 (docs/csm-decks/CONTENT.md L1 to L13, DESIGN.md sections 8 and
 * 20). Visual first: the journey is the signature, the piece of the pie
 * the second drawing (launchExpect.tsx), and every picture of what the
 * customer sees is drawn from this client's own data, or drawn as a
 * labelled example. Every word is in content.ts and callScript.ts; this
 * file only places them.
 */

const PORTAL_RATIO = 2384 / 1504;

/**
 * The portal's screens, cropped below their "lead" headings and without the
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
      // The demo row's pending list ends at "Your feedback": its "Lead
      // quality" and the item after it are masked (copy rule 3; the
      // picture is the sales deck's, pinned byte for byte, so it is never
      // edited). The Arabic row ends the same way, at ملاحظاتك (score
      // round 2: its جودة العميل and كيف سار الموعد showed, unlike the
      // English): the mask runs from the row's start to the dot after it.
      en: {
        box: [0.026, 0.4, 0.624, 0.91],
        ratio: PORTAL_RATIO,
        masks: [[0.2815, 0.6848, 0.39, 0.7088]],
      },
      ar: {
        box: [0.376, 0.4, 0.974, 0.91],
        ratio: PORTAL_RATIO,
        masks: [[0.6355, 0.6848, 0.7399, 0.7088]],
      },
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
      en: { box: [0.538, 0.42, 0.983, 0.776], ratio: PORTAL_RATIO },
      ar: { box: [0.017, 0.42, 0.462, 0.776], ratio: PORTAL_RATIO },
    },
  },
};

/**
 * Journey stop 7's outcome form in two pieces, one frame (the fixer's
 * round): the attended buttons, then where the deal stands, with the empty
 * band and the rule between them cut out, so the form is drawn about a
 * tenth larger in the stage's width and its labels read on a share.
 */
const OUTCOME_PIECES: Record<Lang, [number, number][]> = {
  en: [
    [0.42, 0.556],
    [0.598, 0.776],
  ],
  ar: [
    [0.42, 0.556],
    [0.598, 0.776],
  ],
};
const OUTCOME_W = 732;
/**
 * The calls screen in two pieces, one frame (score round 2: the recorded
 * call alone filled the top 40% of the stage): the recorded call's row
 * with its player, then, under the screen's own rule, the next call's row.
 * The band between them, the demo call's summary, is cut out (it names a
 * budget, CONTENT rule 3), as journey stop 7 cuts its form's empty band.
 */
const CALLS_PIECES: [number, number][] = [
  [0.311, 0.668],
  [0.8438, 0.952],
];
/** The calls screen's pieces (1189 px of the screen) drawn at 0.81. */
const CALLS_W = 960;
/** The portal's one stage box (DESIGN 22.6.3): 1104 x 704, from x 680, y 244. */
const PORTAL_STAGE_W = 1104;

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
  const model = useCreatives(ctx);
  // With no creative of their own (a starter template is ours, so it does
  // not count), the cover shows the example ad for their service, tagged
  // "Example ad" (the fixer's round, which overturns DESIGN 22.4.6 for this
  // case): the CEO's "an example ad instead of just the logo". A client
  // with creatives of their own and no pick shows their first ad (DESIGN
  // 22.15: the faint lanes were an empty preview of the next slide); the
  // lanes stay only when there is nothing to show.
  const example = d.launch.cover ? null : model.coverExample;
  useWarmExample(ctx, Boolean(example));
  const cover = model.coverShown;
  const app = example ? lang : model.app;
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
          {/* Past go-live, the rail is lit to its end and says both facts,
              so it agrees with "is live". */}
          <RoadStrip
            now={live ? 5 : 4}
            label={
              live && d.goLive
                ? tf(L1.roadLive, lang, {
                    date: dayMonth(d.goLive, lang, d.timeZone),
                  })
                : t(L1.road, lang)
            }
          />
        </div>
        <p className="dk-lead dkc-cover-line">
          {t(live ? L1.lineLive : L1.line, lang)}
        </p>
      </div>
      {cover ? (
        <div className="dkc-cover-phone">
          <PhoneFigure
            height={760}
            mark="instagram"
            label={t(SHARED.frame.feed, lang)}
            tag={t(example ? EXAMPLE.tag : SHARED.tag.preview, lang)}
            tagBelow
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

/**
 * The ad the journey and the form follow: the ads slide's feed phone,
 * before or after a swap; with only an example, its alternate picture
 * (DESIGN 22.14), so the cover and journey stop 1 differ.
 */
function useFeed(ctx: SlideCtx) {
  const model = useCreatives(ctx);
  useWarmExample(ctx, model.example);
  return { model, feed: model.journey };
}

/** The ad opens a WhatsApp chat (their confirmed destination), not a form. */
const opensWhatsApp = (d: DeckData) =>
  d.launch.form.kind === "whatsapp" && d.launch.form.source !== "example";

/**
 * The chat phone's tag: the words are example wording, and a starter
 * template's picture over them is said too (score round 2 of the five
 * services: the starter's picture sat under "Example wording" alone).
 */
const waTag = (ad: Creative | null) =>
  ad?.starter ? SHARED.tag.exampleWordingStarter : SHARED.tag.exampleWording;

/**
 * The message a WhatsApp ad fills in (example wording, DESIGN 7.5): the
 * service only when it is written in the message's own script, so a
 * customer's line never mixes the two.
 */
function waMessage(d: DeckData, lang: Lang): string {
  // Inside the customer's sentence: "more about interior design".
  const named = d.launch.serviceMid[lang] ?? d.serviceMid;
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
  slide = false,
}: {
  ctx: SlideCtx;
  height: number;
  screen: FormScreen;
  focus?: number | null;
  /** On the form slide itself: its own cover, after the ads slide (22.14). */
  slide?: boolean;
}) {
  const { d, lang } = ctx;
  const { feed: journeyFeed, model } = useFeed(ctx);
  const feed = slide ? model.formCover : journeyFeed;
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
      // On L5 itself (fixer round 2): the message sent, under the ad it
      // came from; journey stop 2 keeps it waiting to send, the ad it came
      // from over the field (score round 2 of the five services: without
      // it the chat was 60% empty).
      sent={slide}
      ad={feed ? (feed.video ? feed.poster : feed.url) : null}
      adTag={feed?.from === "example" ? t(EXAMPLE.short, lang) : null}
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
      coverTag={feed?.from === "example" ? t(EXAMPLE.short, lang) : null}
    />
  );
  return (
    <Phone
      height={height}
      label={t(
        opensWhatsApp(d) ? LAUNCH.form.titleWhatsApp : LAUNCH.form.title,
        lang,
      )}
    >
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
  line: ReactNode;
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

/**
 * Journey stop 6's two outcomes, in the lanes' line language: the meeting's
 * line (the leader's end) runs on, solid, to a node ahead (came, and
 * thinking it over), and drops, dotted, to the lanes' rebook mark (didn't
 * show). Each end carries its name and one line beside it. Done for you,
 * the one thinking it over is followed up by both of us and marked by the
 * client, so that end stays in the client's ink with its first sentence
 * ("Both of us.") in our teal; done with you it is all theirs, in ink.
 */
function Fork({
  lang,
  ours,
  came,
  noShow,
}: {
  lang: Lang;
  /**
   * Done for you: the no-show is ours to rebook (teal), and the follow-up
   * of someone thinking it over is shared (its first sentence in teal).
   * Done with you, both are theirs.
   */
  ours: boolean;
  came: [L, L];
  noShow: [L, L];
}) {
  const cameLine = t(came[1], lang);
  // The shared line's first sentence, ours and theirs together, in teal.
  const both = ours ? /^(.+?\.)\s+(.+)$/s.exec(cameLine) : null;
  // Each end's node sits on its name's first line (the fixer's round): the
  // name, then its line under it. The meeting's line (the anchor, level
  // with "You meet") runs between the two ends: the came end rises off it
  // (84 px over the shared line's two lines, 40 px over one line; the
  // solid line bends up into it) and the no-show's end drops just clear
  // of it, so the whole fork ends above the lanes' foot in Arabic's taller
  // lines too (score round 2: it ran 20 px past them).
  const ar = lang === "ar";
  const yc = 40;
  const y0 = yc + (both ? 84 : 40);
  const y1 = yc + (both ? (ar ? 148 : 128) : ar ? 104 : 96);
  const trunk = 56;
  const end = 168;
  const tone = ours ? "var(--dk-teal)" : "var(--dk-ink-2)";
  return (
    <div
      className="dkc-fork"
      data-ours={ours ? "" : undefined}
      style={{ height: y1 + (ar ? 72 : 62) }}
    >
      <svg
        width={end + 14}
        height={y1 + 16}
        viewBox={`0 0 ${end + 14} ${y1 + 16}`}
        aria-hidden
      >
        <path
          d={
            yc === y0
              ? `M 0 ${y0} L ${end - 14} ${y0}`
              : `M 0 ${y0} L ${trunk + 8} ${y0} C ${trunk + 52} ${y0} ${end - 64} ${yc} ${end - 14} ${yc}`
          }
          fill="none"
          stroke="var(--dk-line-strong)"
          strokeWidth={2}
          strokeLinecap="round"
        />
        <path
          d={`M ${trunk} ${y0} C ${trunk + 56} ${y0} ${end - 72} ${y1} ${end - 12} ${y1}`}
          fill="none"
          stroke={tone}
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray="2 8"
        />
        <Node x={end} y={yc} r={14} state="ahead" />
        <RebookMark x={end} y={y1} r={13} stroke={tone} />
      </svg>
      <i className="dkc-fork-anchor" data-anchor="" style={{ top: y0 }} />
      <div
        className="dkc-fork-end"
        data-both={both ? "" : undefined}
        style={{ top: yc }}
      >
        <b>{t(came[0], lang)}</b>
        {both ? (
          <p>
            <span className="dkc-fork-both">{both[1]}</span> {both[2]}
          </p>
        ) : (
          <p>{cameLine}</p>
        )}
      </div>
      <div className="dkc-fork-end" data-noshow="" style={{ top: y1 }}>
        <b>{t(noShow[0], lang)}</b>
        <p>{t(noShow[1], lang)}</p>
      </div>
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
    const tag =
      feed?.from === "example"
        ? t(EXAMPLE.tag, lang)
        : feed?.starter
          ? starterTag(L, lang)
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
      ? t(waTag(feed), lang)
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
        {/* "5 minutes" underlined in teal, as the form's thank-you band
            marks it (score round 2), so the promise reads the same on both. */}
        <StopWords
          lane={lane}
          line={fiveMinutes(line(text ?? stop.line))}
          lang={lang}
        />
        <figure
          className="dkc-tagged dkc-stage-pic dkc-queue-fig"
          data-level=""
        >
          <QueueCard
            lang={lang}
            // The launch service, then the client's own words for that
            // service only, in the deck's script: never a sub-trade or
            // another service's words (CEO, 2026-10-21: "These are not
            // kitchens"), and a row past them leaves its service out.
            services={queueServices(
              L.service[lang],
              L.serviceKey,
              d.services,
              lang,
            )}
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
    // The stop's words sit right on top of the strip they describe, the
    // two one block: its first node on the lit row's centre line (the
    // leader runs straight into it), its last level with "You meet".
    return (
      <div className="dkc-stage" data-kind="line">
        <div className="dkc-stage-pic dkc-dots-pic" data-level="">
          <div className="dkc-dots-block">
            <StopWords lane={lane} line={line(text ?? stop.line)} lang={lang} />
            <FiveDots lang={lang} dwy={dwy} height={rowY(5) - rowY(3)} />
          </div>
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
    // The two ways a meeting goes, drawn as the lanes draw the fork: the
    // leader runs into the meeting's line, which goes on, solid, to "came,
    // and thinking it over" (both of us follow up and the client marks it,
    // so the client's ink with "Both of us." in teal; done with you, theirs)
    // and drops, dotted, to the lanes' rebook mark for a no-show (ours in
    // teal; done with you, theirs in ink). The stop's words sit at the
    // stage's top, where stops 3 and 5 set theirs (score round 2: the block
    // hung from the row, so the words jumped on this press), and the fork
    // alone is set level with the row. The lanes draw the fork from the
    // next stop, so it is never named twice on one screen.
    // The statement sits directly above the fork it describes (DESIGN
    // 22.6.1): one block, its last line 40 px over the first end's name, so
    // the two never read as apart. The fork is still set level with "You
    // meet" (Journey measures its anchor), and the words travel with it.
    return (
      <div className="dkc-stage" data-kind="line">
        <div className="dkc-stage-pic dkc-fork-pic" data-level="">
          <div className="dkc-fork-block">
            <StopWords
              lane={lane}
              line={tf(stop.line, lang, {
                places: placesLine(L.places, lang),
              })}
              lang={lang}
            />
            <Fork
              lang={lang}
              ours={!dwy}
              came={[F.deciding, dwy ? F.decidingDwy : F.decidingLine]}
              noShow={[F.noShow, dwy ? F.noShowDwy : F.noShowLine]}
            />
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
          <div
            className="dkc-crop dkc-crop-stack"
            style={{ width: OUTCOME_W, borderRadius: 10 }}
          >
            {OUTCOME_PIECES[lang].map(([y0, y1]) => {
              const [x0, , x1] = SHOTS.outcome.crop[lang].box;
              return (
                <Crop
                  key={y0}
                  src={SHOTS.outcome.src[lang]}
                  crop={{ box: [x0, y0, x1, y1], ratio: PORTAL_RATIO }}
                  width={OUTCOME_W}
                  radius={0}
                />
              );
            })}
          </div>
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
    // The incoming stage's picture (the outgoing one fades out beside it).
    const fig = stageRef.current?.querySelector<HTMLElement>(
      '[data-swap="in"] .dkc-stage-pic',
    );
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
            fork={tour >= 6}
            leaderTo={leaderTo}
            onPick={i => setTour(i)}
          />
        </div>
        <div className="dkc-journey-stage" ref={stageRef}>
          <StageSwap at={tour} className="dkc-stage-swap" still={still}>
            <JourneyStage ctx={ctx} i={tour} />
          </StageSwap>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- L4 ads

function Ads({ ctx }: { ctx: SlideCtx }) {
  const { d, lang } = ctx;
  const A = LAUNCH.ads;
  const model = useCreatives(ctx);
  useWarmExample(ctx, model.example);
  const planned = d.launch.platformsPlanned;
  return (
    <div className="dkc-ads">
      <div className="dkc-ads-start">
        <Owner lane="customer" text={A.owner} lang={lang} />
        {/* No "Preview" tag here: the foot under the phones says it. With
            the example in every phone, the title's tag says what they are,
            once (DESIGN 22.4.3). */}
        <div className="dkc-title-tag">
          <h2 className="dk-h2">{t(A.title, lang)}</h2>
          {model.example ? (
            <span className="dk-tag">{t(EXAMPLE.tags, lang)}</span>
          ) : null}
        </div>
        {/* The line says what the phones show: with the example, where their
            ads will show, never "how they will look"; with nothing of theirs
            yet but templates, how their ads will look. */}
        <p className="dk-body dk-ink2 dkc-ads-line">
          {t(
            model.example
              ? A.lineExample
              : model.tray.length || model.meta.length
                ? A.line
                : A.lineEmpty,
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

// -------------------------------------------------- L3 creative freedom

/** One red line on the panel: its words, and whether they said it on O7. */
type RedLineItem = { text: string; told: boolean };

/**
 * One column of red lines under its head ("Never" or "Always"), in either
 * deck (fixer round 2: the Arabic deck stacked its groups, then the card's
 * English lines under a third head with run-in heads, denser than the
 * English deck's two columns). The deck's own lines first, then the card's
 * lines in the other script with no translation, quoted as one block in
 * their own direction at the column's start edge, as wide as its widest
 * line, its marks on its own start; each quoted block carries one small
 * tag saying where they come from ("On your card, in Arabic" /
 * بملفكم، بالإنجليزي). A line drops a leading word its head
 * already says (DESIGN 22.6.2), so "Never" is said once.
 */
function LineGroup({
  lead,
  items,
  quoted = [],
  tag = null,
  lang,
  group,
}: {
  lead: L;
  items: RedLineItem[];
  /** The card's lines in the other script, quoted as written. */
  quoted?: RedLineItem[];
  /** The quoted block's tag, said once on the panel. */
  tag?: L | null;
  lang: Lang;
  group: "never" | "always";
}) {
  if (!items.length && !quoted.length) return null;
  return (
    <div className="dkc-fixed-group" data-group={group}>
      <span className="dkc-fixed-lead">{t(lead, lang)}</span>
      {items.length ? (
        <ul>
          {items.map(l => (
            <RedLine key={l.text} text={underHead(l.text, group)} />
          ))}
        </ul>
      ) : null}
      {quoted.length ? (
        <div className="dkc-fixed-quoted">
          {tag ? (
            <span className="dkc-fixed-sublead">{t(tag, lang)}</span>
          ) : null}
          <ul dir={lang === "ar" ? "ltr" : "rtl"}>
            {quoted.map(l => (
              <RedLine key={l.text} text={underHead(l.text, group)} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One red line, in the client's words: an amber mark (theirs, and fixed),
 * then the line. The row keeps the panel's direction, so every mark sits
 * on one edge, and only the words are isolated in their own direction with
 * their own type: the same rule as O7's list (the visual review).
 */
function RedLine({ text }: { text: string }) {
  return (
    <li>
      <i aria-hidden />
      <span dir="auto" className="dkc-theirs">
        {text}
      </span>
    </li>
  );
}

/** A line that says "always" itself goes with the DO items. */
const ALWAYS = /^(always|دايماً|دائماً)/i;
/** Arabic letters: which script a line is written in. */
const ARABIC = /[\u0600-\u06ff]/;

/** The leading words a head already says (DESIGN 22.6.2). */
const LEADS: Record<"never" | "always", RegExp> = {
  never: /^(?:never|don['\u2019]t|do not|no|أبداً|أبدا|أبد|ابدا|ابد)[\s،,:]+/i,
  always: /^(?:always|do|دايماً|دائماً|دايما|دائما)[\s،,:]+/i,
};

/**
 * A line under its head, without the head's own word: "Never show prices
 * in an ad" reads "Show prices in an ad" under "Never". A line left with
 * fewer than two words keeps its lead; a line's own «ما» or «لا» stays.
 */
export function underHead(text: string, group: "never" | "always"): string {
  const t0 = text.trim();
  const rest = t0.replace(LEADS[group], "");
  if (rest === t0 || rest.split(/\s+/).filter(Boolean).length < 2) return t0;
  return ARABIC.test(rest[0] ?? "")
    ? rest
    : rest[0].toUpperCase() + rest.slice(1);
}

/**
 * The panel's groups (score round 2, DESIGN 22.6.2): Never (the lines
 * typed on O7, then the card's DON'Ts), Always (the DO items, and a typed
 * line that says "always"), and the card's lines in the other script than
 * the deck's with no translation, quoted as written under "On your card,
 * in English" (or "in Arabic"), so an untranslated card line reads as
 * quoted from their card, never as our copy left untranslated. A card line
 * with its Arabic typed in prep (`dos_donts_ar`) takes its own group in the
 * Arabic deck, in Arabic.
 */
export function redLineGroups(
  R: { told: string[]; always: string[]; never: string[] },
  lang: Lang,
  arabic: Record<string, string> = {},
) {
  const quoted = (x: string) => ARABIC.test(x) !== (lang === "ar");
  const told = (x: string) => ({ text: x, told: true });
  const card = (x: string) => ({ text: x, told: false });
  // The Arabic deck reads a card line in Arabic when the CSM typed it.
  const own = (x: string) =>
    lang === "ar" && !ARABIC.test(x) && arabic[x] ? arabic[x] : x;
  // A line typed on O7 and then copied to the card (as prep asks) shows
  // once, as theirs.
  const key = (x: string) => x.trim().toLowerCase();
  const typed = new Set(R.told.map(key));
  const never = R.never.filter(x => !typed.has(key(x))).map(own);
  const always = R.always.filter(x => !typed.has(key(x))).map(own);
  return {
    never: [
      ...R.told.filter(x => !ALWAYS.test(x.trim())).map(told),
      ...never.filter(x => !quoted(x)).map(card),
    ],
    always: [
      ...R.told.filter(x => ALWAYS.test(x.trim())).map(told),
      ...always.filter(x => !quoted(x)).map(card),
    ],
    fromCard: [...never, ...always].filter(quoted).map(card),
    // The quoted block keeps the never/always split the deck's own groups
    // have (DESIGN 22.15): the Arabic deck lost it for English card lines.
    fromCardNever: never.filter(quoted).map(card),
    fromCardAlways: always.filter(quoted).map(card),
  };
}

/** Where the red lines come from, said once under them (DESIGN 22.6.2). */
function sourceLine(R: {
  told: string[];
  always: string[];
  never: string[];
}): L | null {
  const T = LAUNCH.test.fixed.source;
  const told = R.told.length > 0;
  const card = R.always.length + R.never.length > 0;
  return told && card ? T.both : card ? T.card : told ? T.told : null;
}

function RedLinesPanel({ ctx }: { ctx: SlideCtx }) {
  const { d, lang, prepOf, saveTo } = ctx;
  const T = LAUNCH.test.fixed;
  const R = d.launch.redLines;
  const [value, setValue] = useState("");
  const empty = !R.told.length && !R.always.length && !R.never.length;
  const groups = redLineGroups(R, lang, d.dosDontsAr);
  // Each column: the deck's own lines, then the card's quoted ones.
  const never = groups.fromCardNever;
  const always = groups.fromCardAlways;
  const nNever = groups.never.length + never.length;
  const nAlways = groups.always.length + always.length;
  // Never and Always side by side when Always is short (three lines or
  // fewer); else stacked. In either deck (fixer round 2).
  const side = nNever > 0 && nAlways > 0 && nAlways <= 3;
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
  const source = sourceLine(R);
  // The panel, lighter (DESIGN 22.6.2): no head and no foot (the title
  // says "Your red lines are fixed"), the two groups and their lines, and
  // one source line under it.
  return (
    <>
      <div className="dkc-fixed" data-empty={empty ? "" : undefined}>
        {empty ? (
          <>
            <p className="dkc-fixed-copy" data-ask="">
              {t(T.fallback, lang)}
            </p>
            {/* No ruled line on the client's screen: the input is drawn
                only under the CSM's pointer, or while typing. */}
            <input
              className="dkc-redline-input dkc-quiet-input"
              dir={value.trim() ? "auto" : lang === "ar" ? "rtl" : "ltr"}
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
          <div className="dkc-fixed-pair" data-side={side ? "" : undefined}>
            <LineGroup
              lead={T.never}
              items={groups.never}
              quoted={never}
              // Each quoted block carries its tag (score round 2 of the five
              // services: said once, the English line under دايماً read as
              // untagged).
              tag={never.length ? T.card : null}
              lang={lang}
              group="never"
            />
            <LineGroup
              lead={T.always}
              items={groups.always}
              quoted={always}
              tag={always.length ? T.card : null}
              lang={lang}
              group="always"
            />
          </div>
        )}
      </div>
      {!empty && source ? (
        <p className="dk-small dk-ink2 dkc-fixed-source">{t(source, lang)}</p>
      ) : null}
    </>
  );
}

/** Creative freedom's five stops, by name (the notes window and the live region). */
const FREEDOM_STOPS = [
  LAUNCH.test.job.name,
  LAUNCH.test.volume.name,
  LAUNCH.test.input.name,
  LAUNCH.test.check.name,
  LAUNCH.test.content.name,
];

/** How many red lines the panel shows (more than five pushes it past the content box). */
export const redLineCount = (d: DeckData) => {
  const R = d.launch.redLines;
  return R.told.length + R.always.length + R.never.length;
};

/** The words of one stop, in the words column (DESIGN 21.1). */
function FreedomWords({
  ctx,
  pick,
}: {
  ctx: SlideCtx;
  /** Their pick is marked: it runs on one of the lit tiles (the field draws it). */
  pick: boolean;
}) {
  const { lang, tour } = ctx;
  const T = LAUNCH.test;
  const name = (l: L) => (
    <h3 className="dk-h3 dkc-cf-name" data-one-line="">
      {t(l, lang)}
    </h3>
  );
  if (tour === 0)
    return (
      <>
        {name(T.job.name)}
        <p className="dk-body">{t(T.job.copy, lang)}</p>
        <p className="dk-small dk-ink2">{t(T.job.small, lang)}</p>
      </>
    );
  if (tour === 1)
    return (
      <>
        {name(T.volume.name)}
        <p className="dk-body">{t(T.volume.copy, lang)}</p>
        <p className="dk-small dk-ink2">{t(T.volume.small, lang)}</p>
        {/* Their pick is drawn in the field, on a tile that stays lit. */}
        <p className="dk-small dk-ink2">
          {t(pick ? T.open.pick : T.open.pickNone, lang)}
        </p>
      </>
    );
  if (tour === 2)
    // Your input comes first, in fact as well as in the name (DESIGN
    // 22.6.2): the input line, the offer, then the red lines.
    return (
      <>
        {name(T.input.name)}
        <p className="dk-body">{t(T.input.copy, lang)}</p>
        <p className="dk-small dk-ink2">{t(T.input.offer, lang)}</p>
        <RedLinesPanel ctx={ctx} />
      </>
    );
  if (tour === 3)
    return (
      <>
        {name(T.check.name)}
        {/* The stop's hero: the three words, large, under the stop's name,
            and the one small line under them. One line, not a stepper:
            facts, prices and claims are not steps. */}
        <div className="dkc-cf-check">
          <p className="dkc-cf-checks">
            {T.check.words.map((w, i) => (
              <span key={w.en}>
                {i ? (
                  <span className="dkc-cf-dot" aria-hidden>
                    {sep(lang)}
                  </span>
                ) : null}
                {t(w, lang)}
              </span>
            ))}
          </p>
          <p className="dk-small dk-ink2">{t(T.check.line, lang)}</p>
        </div>
        <p className="dk-body">{t(T.check.style, lang)}</p>
      </>
    );
  return (
    <>
      {name(T.content.name)}
      <p className="dk-body">{t(T.content.copy, lang)}</p>
      <p className="dk-small dk-ink2">{t(SHARED.driveMissing, lang)}</p>
    </>
  );
}

/**
 * Creative flexibility (CONTENT L3, DESIGN 21.1): the CEO's "big
 * expectation", set before the ads go live. Two columns from the first
 * stop: the stop's words on the start side, the field of ad tiles on the
 * end side. The field stays put while each press changes one thing in it.
 */
function CreativeFreedom({ ctx }: { ctx: SlideCtx }) {
  const { d, lang, tour } = ctx;
  const T = LAUNCH.test;
  const agreed = d.launch.agreedAt;
  const model = useCreatives(ctx);
  const marked = d.launch.pick ? (model.byId.get(d.launch.pick) ?? null) : null;
  const pick = marked ? (marked.poster ?? marked.url ?? null) : null;
  // Their service's scenes first, every scene once; the two shown large on
  // the slides either side take their detail tile (DESIGN 22.14).
  // Never a scene a starter template was cut from (DESIGN 22.18): L4
  // shows the starters as theirs.
  const tiles = useMemo(() => {
    const avoid = scenesNamed(d.starterAds.map(a => a.fileName));
    return {
      field: serviceField(d.example, 18, avoid),
      next: serviceRound(d.example, 6, avoid),
    };
  }, [d.example, d.starterAds]);
  return (
    <div className="dkc-freedom">
      {/* The stamp sits on the title row, at its end, on the title's
          baseline: never read as a line of the stop's words, and never near
          the mini rail's lit label below the content box. */}
      <div className="dkc-cf-head">
        <h2 className="dk-h2">{t(T.title, lang)}</h2>
        {agreed ? (
          <span className="dk-tag dkc-stamp">
            {tf(T.stamp, lang, {
              date: dayMonth(agreed, lang, d.timeZone),
            })}
          </span>
        ) : null}
      </div>
      {/* The field keeps one place on every stop (DESIGN 22.6.2): the next
          round's band is reserved, empty, until it arrives, so nothing on
          the slide moves between stops but what the stop changes. */}
      <div className="dkc-cf" data-stop={tour}>
        <div className="dkc-cf-words">
          <StageSwap at={tour} className="dkc-cf-stop" still={ctx.still}>
            <FreedomWords ctx={ctx} pick={Boolean(pick)} />
          </StageSwap>
        </div>
        {/* Example ads in every tile, tagged as such; their own pick, when
            marked, is the one tile that is theirs, and the tag says so. */}
        <Tagged
          tag={t(pick && tour > 0 ? EXAMPLE.tagsPick : EXAMPLE.tags, lang)}
          className="dkc-cf-field"
        >
          <AdField
            stop={tour}
            round={t(T.round, lang)}
            change={t(T.check.change, lang)}
            pick={pick}
            photos={tiles.field}
            next={tiles.next}
          />
        </Tagged>
      </div>
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

/**
 * The call's promise ("5 minutes") marked with the teal underline: on the
 * form's thank-you band and on journey stop 3, so the promise reads the
 * same on both.
 */
function fiveMinutes(line: string): ReactNode {
  const m = /(5[\s\u00a0]minutes|٥[\s\u00a0]دقايق)/.exec(line);
  if (!m) return line;
  return (
    <>
      {line.slice(0, m.index)}
      <span className="dkc-thanks-mark">{m[0]}</span>
      {line.slice(m.index + m[0].length)}
    </>
  );
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
    // The thank-you stop draws no leader (score round 2): the band's
    // highlight and its underlined "5 minutes" already pair it with the
    // phone's message, and the leader's detour round the list read as a
    // second thing to follow.
    if (!root || lit == null) {
      setLeader(null);
      return;
    }
    // Measured once the phone has scrolled its question into view.
    const measure = () => {
      const q = root.querySelector<HTMLElement>('[data-part="question"]');
      const row = root.querySelector<HTMLElement>("[data-row-lit]");
      const phone = root.querySelector<HTMLElement>(".dkc-phone");
      if (!q || !row || !phone) {
        setLeader(null);
        return;
      }
      const box = root.getBoundingClientRect();
      const k = box.width / root.offsetWidth || 1;
      const qa = q.getBoundingClientRect();
      const ra = row.getBoundingClientRect();
      const pa = phone.getBoundingClientRect();
      const rtl = lang === "ar";
      // The question's first line: its words, not the block they sit in.
      const label = q.querySelector("b");
      let y = qa.top + 14;
      if (label) {
        const range = document.createRange();
        range.selectNodeContents(label);
        const first = range.getClientRects()[0];
        if (first) y = (first.top + first.bottom) / 2;
      }
      // The dot sits just outside the frame on the list's side, level with
      // the question (the ads' leaders do the same): an English question
      // in the Arabic deck starts on that side, and a dot inside the screen
      // landed on its first letter.
      setLeader({
        a: [
          ((rtl ? pa.left - 10 : pa.right + 10) - box.left) / k,
          (y - box.top) / k,
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
  }, [lit, lang, tour, still, screen]);
  const typeLabel = (q: FormQuestion) =>
    isContact(q)
      ? t({ en: "Filled in by Meta", ar: "تعبّيه ميتا تلقائياً" }, lang)
      : t(F.choice, lang);
  const thanksLine = d.launch.welcomeVideo ? F.thanksVideo : F.thanksLine;
  const { model } = useFeed(ctx);
  // The tag names the picture, so it sits over the phone's outer corner
  // (as journey stop 2 tags the same phone), never on the title's line.
  const tag =
    f.source === "example"
      ? t(SHARED.tag.exampleForm, lang)
      : opensWhatsApp(d)
        ? t(waTag(model.formCover), lang)
        : null;
  return (
    <div
      className="dkc-form-slide"
      ref={pageRef}
      data-wa={opensWhatsApp(d) ? "" : undefined}
    >
      <Tagged tag={tag} className="dkc-form-phone">
        {/* The phone ends well above the mini rail's name (at 852 it had
            ended 27 px above it); with a tag over it, shorter by its line. */}
        <FormPhone
          ctx={ctx}
          height={tag ? 772 : 812}
          screen={screen}
          focus={lit}
          slide
        />
      </Tagged>
      <div className="dkc-form-side">
        <Owner lane="customer" text={F.owner} lang={lang} />
        <h2 className="dk-h2">
          {t(opensWhatsApp(d) ? F.titleWhatsApp : F.title, lang)}
        </h2>
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
            // The call (the last step) is the thank-you stop's band, level
            // with the chat's foot; the first two sit under the line (score
            // round 2 of the five services: all three at the foot left a
            // 360 px gap under the line).
            <div className="dkc-wa-next">
              <span className="dk-label">{t(F.waNextHead, lang)}</span>
              <ol>
                {[...F.waNext, d.mode.dwy ? F.waNextDwy : F.waNextUs].map(
                  (step, i, all) => (
                    <li
                      key={step.en}
                      data-band={i === all.length - 1 ? "" : undefined}
                    >
                      <span className="dkc-q-n">{stepNumeral(i, lang)}</span>
                      <span className="dk-body">
                        {i === all.length - 1
                          ? fiveMinutes(t(step, lang))
                          : t(step, lang)}
                      </span>
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
              // Done for you, the band says the call too, so the promise
              // the phone shows small is read at the slide's size.
              <div className="dkc-form-thanks-side">
                <p className="dk-body">
                  {t(thanksLine, lang)}
                  {d.mode.dwy ? null : <> {fiveMinutes(t(F.waNextUs, lang))}</>}
                </p>
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
              {sep(lang)}
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
            {/* A running timer keeps Latin digits (٠:٠٠ reads as dots at
                this size, DESIGN 13.4); once the call ends it is a length,
                in the deck's digits: ٤:٥١ beside the card's ٤ مساءً. */}
            <b className="dk-ltr">
              {clock.ended ? digits(clock.at, lang) : clock.at}
            </b>
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
          data-voice={dwy ? undefined : ""}
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
              // Done for you: the messages before the meeting are ours, so
              // the customer hears one voice (the launch call SOP).
              line={dwy ? null : t(C.after.oneVoice, lang)}
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
          {/* The stop's lead, over the card (under it, it repeated the
              notes' own label). */}
          <p className="dk-body dkc-lands-lead">
            {t(dwy ? N.captionDwy : N.caption, lang)}
          </p>
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

/**
 * The portal's phone recording (1080 x 1920, checked 2026-10-21): it opens
 * on a title card, then the install steps in Safari (whose menus show in
 * Arabic in the English file, and a phone inside the phone), so it plays
 * from the sign-in to the app's last screen, before the end card. The
 * install address is said in the words column. A file of another size
 * (the portal replaced it) would not fit the crop, so it is not shown and
 * the still stays.
 */
const FILM = {
  en: { from: 13.2, to: 50.2 },
  ar: { from: 13.7, to: 49.8 },
} as const;
const FILM_SIZE = { w: 1080, h: 1920 };

function PortalFilm({ lang }: { lang: Lang }) {
  const [fits, setFits] = useState(true);
  const { from, to } = FILM[lang];
  if (!fits) return null;
  return (
    <video
      key={lang}
      src={`${LINKS.portal}/demos/mahara-mobile-${lang}.mp4#t=${from},${to}`}
      muted
      playsInline
      autoPlay
      loop={false}
      preload="metadata"
      onLoadedMetadata={e => {
        const v = e.currentTarget;
        if (v.videoWidth !== FILM_SIZE.w || v.videoHeight !== FILM_SIZE.h)
          setFits(false);
      }}
      onError={() => setFits(false)}
    />
  );
}

function PortalSlide({ ctx }: { ctx: SlideCtx }) {
  const { d, lang, tour, still } = ctx;
  const P = LAUNCH.portal;
  const stops = portalStops(d);
  const at = stops[Math.min(tour, stops.length - 1)];
  const dwy = d.mode.dwy;
  const crm = dwy && !d.launch.dwyOs;
  const name = (s: (typeof stops)[number]) =>
    dwy && s.nameDwy ? s.nameDwy : s.name;
  const copy = (s: (typeof stops)[number]) =>
    dwy && s.copyDwy ? s.copyDwy : s.copy;
  const head = (
    <>
      <Owner lane="you" text={P.owner} lang={lang} />
      <h2 className="dk-h2">
        {/* "Mahara OS" never breaks across two lines. */}
        {t(crm ? P.titleDwy : P.title, lang).replace(
          "Mahara OS",
          "Mahara\u00a0OS",
        )}
      </h2>
    </>
  );
  // The number-one job, done for you: no screenshot (the journey's last
  // stop already showed the form). The job is the stop's one heading,
  // large, how it is done under it, and the three questions it asks drawn
  // as the three taps, in order, on one line, each with one caption; then
  // what to tell us when a meeting is cancelled or moved, and why on the
  // foot (DESIGN 20.6).
  if (at.key === "outcome" && !dwy)
    return (
      <div className="dkc-portal" data-job="">
        <div className="dkc-portal-start">{head}</div>
        <div className="dkc-job" key={`job-${lang}`}>
          <p className="dk-h1 dkc-job-name">{t(name(at), lang)}</p>
          <p className="dk-lead dkc-job-taps">{t(P.taps, lang)}</p>
          <ol className="dkc-asks">
            {/* Numbered taps, in order: three empty rings over three
                columns read as a template's feature row. */}
            {P.asks.map((a, i) => (
              <li key={a.en}>
                <i aria-hidden>{stepNumeral(i, lang)}</i>
                <span>{t(a, lang)}</span>
                <small>{t(P.askLines[i], lang)}</small>
              </li>
            ))}
          </ol>
          <p className="dkc-job-moved">
            {/* The lanes' rebook mark, in our teal: we rebook. */}
            <svg
              width="30"
              height="30"
              viewBox="0 0 30 30"
              className="dkc-rebook-svg"
              aria-hidden
            >
              <RebookMark x={15} y={15} r={13} stroke="var(--dk-teal)" />
            </svg>
            <span>{t(P.moved, lang)}</span>
          </p>
          <p className="dk-h3 dkc-job-foot">{t(P.footer, lang)}</p>
        </div>
      </div>
    );
  let screen: ReactNode;
  if (at.key === "phone")
    screen = (
      <Tagged tag={t(SHARED.tag.demo, lang)} className="dkc-portal-film">
        <div className="dkc-film">
          {/* Still, and before it plays: a frame from inside the app (its
              overview, cropped to the screen), not the recording's splash.
              The recording itself is cropped to the same screen in CSS. */}
          <img src={lang === "ar" ? phoneAr : phoneEn} alt="" />
          {still ? null : <PortalFilm lang={lang} />}
        </div>
      </Tagged>
    );
  else if (at.key === "outcome")
    screen = (
      // Done with you: the stages their team keeps true, in the journey's
      // line language (their CRM, or Mahara OS once approved for them),
      // and the late check under them.
      <div className="dkc-portal-crm">
        <CrmStages lang={lang} width={820} drop={230} />
        <p className="dk-small dk-ink2 dkc-portal-late">{t(P.lateDwy, lang)}</p>
      </div>
    );
  else if (at.key === "calls") {
    const [x0, , x1] = SHOTS.calls.crop[lang].box;
    screen = (
      <Tagged
        tag={t(SHARED.tag.demo, lang)}
        className="dkc-portal-shot dkc-screen"
      >
        {/* Under the overview's width (score round 2): the waveform was
            caught mid-draw in the source, so at 1080 it read soft beside
            the deck's own type. */}
        <div
          className="dkc-crop dkc-crop-stack"
          style={{ width: CALLS_W, borderRadius: 10 }}
        >
          {CALLS_PIECES.map(([y0, y1]) => (
            <Crop
              key={y0}
              src={SHOTS.calls.src[lang]}
              crop={{ box: [x0, y0, x1, y1], ratio: PORTAL_RATIO }}
              width={CALLS_W}
              radius={0}
            />
          ))}
        </div>
      </Tagged>
    );
  } else {
    const shot = SHOTS.overview;
    screen = (
      <Tagged
        tag={t(SHARED.tag.demo, lang)}
        className="dkc-portal-shot dkc-screen"
      >
        <Crop
          src={shot.src[lang]}
          crop={shot.crop[lang]}
          width={PORTAL_STAGE_W}
          radius={10}
        />
      </Tagged>
    );
  }
  // One stop at a time: the title across the top on one line, the stop's
  // name and its words under it, and its screen beside them. The phone
  // stands the slide's full height at the end margin, beside the title.
  // No list of the other stops (a menu of grey headings read as the app's
  // own navigation, not a slide).
  // One stage for every stop (DESIGN 22.6.3): the box x 680 to 1784, y 244
  // to 948, each figure anchored to its top and end edges, the tag on the
  // box's end corner at one place. Only a figure's own size changes, by the
  // stage swap, so the top edge, the end edge and the tag never move.
  return (
    <div className="dkc-portal" data-stop={at.key}>
      <div className="dkc-portal-head">{head}</div>
      <StageSwap
        at={`stop-${at.key}-${lang}`}
        still={still}
        className="dkc-portal-stop"
      >
        <h3 className="dk-h3">{t(name(at), lang)}</h3>
        <p className="dk-body dk-ink2">{t(copy(at), lang)}</p>
        {at.key === "outcome" ? (
          <p className="dk-body dkc-portal-foot">{t(P.footer, lang)}</p>
        ) : null}
        {/* The install address under "Install it like an app.", large, a
            teal leader running from it to the phone it opens on (score
            round 2 of the five services: beside the phone it floated
            mid-slide, far from the words that say what to do with it). */}
        {at.key === "phone" ? (
          <div className="dkc-portal-install">
            <span className="dk-label">{t(P.installLabel, lang)}</span>
            <p dir="ltr">
              <span>{LINKS.portalInstall.replace(/^https:\/\//, "")}</span>
            </p>
          </div>
        ) : null}
      </StageSwap>
      <div className="dkc-portal-screen">
        <StageSwap
          at={`screen-${at.key}-${lang}`}
          still={still}
          className="dkc-portal-screen-in"
        >
          {screen}
        </StageSwap>
      </div>
    </div>
  );
}

// --------------------------------------------------------- L10 your part

/**
 * The pictures their Drive folder feeds (score round 2): their own
 * creatives, never a starter template, each picture once. A feed post and
 * its Reels crop are two files of one picture (the tray showed one dining
 * room twice), so the feed-shaped ones come first and a tall one is taken
 * only to make two. Three, or two when there are only two; fewer gives no
 * strip (a lone tile reads as a gap).
 */
export function partTiles(creatives: Creative[]): string[] {
  const own = creatives.filter(c => !c.starter && (c.poster ?? c.url));
  const src = (c: Creative) => (c.poster ?? c.url) as string;
  const flat = [...new Set(own.filter(c => phoneFor(c) !== "reels").map(src))];
  const tall = [...new Set(own.filter(c => phoneFor(c) === "reels").map(src))];
  const tiles =
    flat.length >= 2
      ? flat.slice(0, 3)
      : [...new Set([...flat, ...tall])].slice(0, 3);
  return tiles.length >= 2 ? tiles : [];
}

/**
 * The pictures sit with the jobs they show (DESIGN 20.7): their project
 * pictures under "Keep your Drive folder fed" (what the folder feeds), and
 * a calendar week at the foot of "Before your meetings".
 */
function PartTray({ ctx }: { ctx: SlideCtx }) {
  const model = useCreatives(ctx);
  const tiles = partTiles([...model.tray, ...model.meta]);
  if (!tiles.length) return null;
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

/** The week's day off (Tuesday) and its busy hours, by day and hour row. */
const WEEK_OFF = 3;
const WEEK_BUSY = new Set(["0-1", "2-0", "4-2", "5-1"]);
const WEEK_ROWS = 3;

/**
 * A working week in their calendar, Saturday to Thursday (DESIGN 20.7): at
 * least ten open slots at different hours (eleven), a few blocked hours,
 * and a day off blocked hour by hour, never as one full-height block. The
 * dark cells are named once, in a key on the "Day off" line ("Blocked"),
 * never on one cell. Three rows, not four, and the key off its own line
 * (score round 2), so the first column ends level with the others' room.
 * No dates, no customer, no names, no hours written.
 */
function PartWeek({ ctx }: { ctx: SlideCtx }) {
  const { lang } = ctx;
  const P = LAUNCH.part;
  return (
    <span className="dkc-part-pic dkc-wk-wrap" aria-hidden>
      <span className="dkc-wk">
        {P.days.map((day, i) => (
          <span
            key={day.en}
            className="dkc-wk-day"
            data-off={i === WEEK_OFF ? "" : undefined}
          >
            <span className="dkc-wk-off">
              {i === WEEK_OFF ? t(P.dayOff, lang) : ""}
            </span>
            <b className="dkc-wk-name">{t(day, lang)}</b>
            {Array.from({ length: WEEK_ROWS }, (_, h) => {
              const busy = i === WEEK_OFF || WEEK_BUSY.has(`${i}-${h}`);
              return (
                <i
                  key={`${day.en}-${String(h)}`}
                  className="dkc-wk-slot"
                  data-busy={busy ? "" : undefined}
                />
              );
            })}
          </span>
        ))}
      </span>
      <span className="dkc-wk-key">
        <i className="dkc-wk-slot" data-busy="" />
        {t(P.blocked, lang)}
      </span>
    </span>
  );
}

function YourPart({ ctx }: { ctx: SlideCtx }) {
  const { d, lang } = ctx;
  const P = LAUNCH.part;
  const jobs = partJobs(d.mode.dwy);
  const pics: Record<string, ReactNode> = {
    drive: <PartTray ctx={ctx} />,
  };
  // Three moments, two jobs under each (DESIGN 20.7): the heads encode
  // when, so the six read as a schedule, not a feature grid. Each job is a
  // rule, the job, why it matters, and its picture where it has one. The
  // week closes the first column, under its second job (score round 2:
  // between the two it started that column's second job 225 px lower than
  // the others'), and the columns share their rows, so the three second
  // jobs start on one line.
  return (
    <div className="dkc-part">
      <h2 className="dk-h2">{t(P.title, lang)}</h2>
      <div className="dkc-part-cols">
        {(["before", "after", "weeks"] as const).map(head => (
          <section key={head} className="dkc-part-col" data-head={head}>
            <h3 className="dkc-part-head">{t(P.heads[head], lang)}</h3>
            {jobs
              .filter(j => j.head === head)
              .map((j, i, all) => (
                <div key={j.key} className="dkc-part-cell" data-job={j.key}>
                  <p className="dkc-part-job">{t(j.job, lang)}</p>
                  <p className="dkc-part-why">
                    {t(j.why, lang)}
                    {j.moreShown && j.more ? ` ${t(j.more, lang)}` : null}
                  </p>
                  {pics[j.key] ?? null}
                  {head === "before" && i === all.length - 1 ? (
                    <PartWeek ctx={ctx} />
                  ) : null}
                </div>
              ))}
          </section>
        ))}
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
  // Then weekly or every two weeks (their plan and how long they've been
  // with us decide): every check-in after the first is one glyph, a small
  // open diamond, whichever rhythm it falls on; the ones that look back
  // over the month (about 30, 60 and 90 days) are ringed; the first is
  // open at full size, with its own words. Three marks, three meanings,
  // one line of key each (the fixer's round: a solid and an open diamond
  // under one rule meant nothing to the client).
  const weekly = [first ?? 14, ...after].map(n => n + 7).filter(n => n <= DAYS);
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
        <div className="dkc-prog-lane" data-slow="">
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
          {/* Under the label, on the bar's row: the first two weeks are
              usually slower (DESIGN 20.8). */}
          <span
            className="dkc-prog-note dkc-prog-slow"
            style={{ insetInlineStart: 12 }}
          >
            {t(D.slow, lang)}
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
              data-open={ring.has(first) ? undefined : ""}
              style={{ insetInlineStart: x(first) }}
            />
          )}
          {after.map(n =>
            ring.has(n) ? (
              <i
                key={n}
                className="dkc-prog-diamond"
                data-ring=""
                style={{ insetInlineStart: x(n) }}
              />
            ) : (
              <i
                key={n}
                className="dkc-prog-diamond"
                data-open=""
                data-weekly=""
                style={{ insetInlineStart: x(n) }}
              />
            ),
          )}
          {/* The weeks between, there only on a weekly rhythm: in ink-3
              (score round 2), so the axis shows both rhythms the key says,
              not a weekly one alone, with no glyph added to the key. */}
          {weekly.map(n => (
            <i
              key={`w${n}`}
              className="dkc-prog-diamond"
              data-open=""
              data-weekly=""
              data-between=""
              style={{ insetInlineStart: x(n) }}
            />
          ))}
          {/* Its words start under the first diamond's start edge. */}
          <span
            className="dkc-prog-note"
            style={{ insetInlineStart: x(first ?? 10) - 9 }}
          >
            {d.launch.checkin
              ? `${t(D.first, lang).split(sep(lang))[0]}${sep(lang)}${dayShort(d.launch.checkin, lang, d.timeZone)}`
              : t(D.first, lang)}
          </span>
        </div>
        <span />
        {/* Each line under the chart starts with the mark it explains. */}
        <div className="dkc-prog-under">
          <p className="dk-small">
            {/* One mark for the rhythm, whichever it is. */}
            <span className="dkc-prog-keys" aria-hidden>
              <i className="dkc-prog-key" data-open="" />
            </span>
            <span>
              <b>{t(D.later, lang)}</b>
              {sep(lang)}
              {t(D.laterLine, lang)}
              {/* Why it is one of the two, under the rhythm it explains. */}
              <span className="dkc-prog-why">{t(D.laterWhy, lang)}</span>
            </span>
          </p>
          <p className="dk-small dk-ink2">
            <span className="dkc-prog-keys" aria-hidden>
              <i className="dkc-prog-key" data-ring="" />
            </span>
            <span>{t(D.looksBack, lang)}</span>
          </p>
        </div>
        {/* The milestones as the chart's last row, under its rule and
            past go-live's line: in order, never on a date. */}
        <span className="dkc-prog-row-name dkc-prog-ms-name">
          {t(D.msLabel, lang)}
        </span>
        <ol className="dkc-prog-ms">
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
    </div>
  );
}

function FirstNinety({ ctx }: { ctx: SlideCtx }) {
  const { d, lang } = ctx;
  const D = LAUNCH.days;
  const goalRef = useRef<HTMLParagraphElement>(null);
  useHug(goalRef, d.launch.goal90);
  // One primary: the programme, large in the middle of the slide, with
  // its key and the milestones as its own last rows. Their goal sits beside
  // the title, in their words, as the frame for it; the foot under it all.
  return (
    <div className="dkc-days" data-nogoal={d.launch.goal90 ? undefined : ""}>
      <div className="dkc-days-head">
        <h2 className="dk-h2">{t(D.title, lang)}</h2>
        {d.launch.goal90 ? (
          <div className="dkc-days-goal">
            <span className="dk-label">{t(D.goal, lang)}</span>
            <p
              ref={goalRef}
              className="dkc-days-goal-line dkc-theirs"
              dir="auto"
              data-hug=""
            >
              {d.launch.goal90}
            </p>
            <p className="dk-small dk-ink2">{t(D.goalFoot, lang)}</p>
          </div>
        ) : null}
      </div>
      <Programme ctx={ctx} />
      <p className="dk-small dk-ink2 dkc-days-foot">{t(D.footer, lang)}</p>
    </div>
  );
}

// ------------------------------------------------------ L12 good to know

/**
 * Good to know (DESIGN 20.9): the title on the start side, the rows beside
 * it under two small heads, the money (charges, the ad card, their
 * payments to us) then the messages (comments, our replies), each row a
 * head over its line. The replies row shows only for a client who never
 * saw the onboarding deck (O3 said it).
 */
function GoodToKnow({ ctx }: { ctx: SlideCtx }) {
  const { d, lang } = ctx;
  const K = LAUNCH.know;
  const rows = K.rows.filter(r => r.key !== "replies" || d.launch.hoursCard);
  return (
    <div className="dkc-know">
      <h2 className="dk-h2">{t(K.title, lang)}</h2>
      <div className="dkc-know-groups">
        {(["money", "messages"] as const).map(g => {
          const mine = rows.filter(r => r.group === g);
          if (!mine.length) return null;
          return (
            <section key={g} className="dkc-know-group" data-group={g}>
              <h3 className="dk-label dkc-know-head">{t(K.groups[g], lang)}</h3>
              <ul className="dkc-know-list">
                {mine.map(r => {
                  const line =
                    (d.mode.dwy && r.lineDwy) ||
                    (isUae(d) && r.lineUae) ||
                    r.line;
                  // A money row's do-this in ink inside its line ("Tell
                  // your bank", "Tell us first"), so it reads at a glance.
                  const text = t(line, lang);
                  const act = r.act ? t(r.act, lang) : null;
                  const at = act ? text.indexOf(act) : -1;
                  return (
                    <li key={r.key} data-row={r.key}>
                      <b>{t(r.name, lang)}</b>
                      <p>
                        {act && at >= 0 ? (
                          <>
                            {text.slice(0, at)}
                            <span className="dkc-know-act">{act}</span>
                            {text.slice(at + act.length)}
                          </>
                        ) : (
                          text
                        )}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------ L13 green light

function GreenLight({ ctx }: { ctx: SlideCtx }) {
  const { d, lang } = ctx;
  const G = LAUNCH.green;
  // The question alone with the road behind it: the housekeeping was the
  // slide before, so nothing is repeated small above it.
  return (
    <div className="dkc-green dkc-green-two" key="two">
      {/* Their mark back from the cover, top start (score round 4), so the
          call ends where it began: their name on the road. */}
      <div className="dkc-green-mark">
        <ClientMark who={who(d)} size={96} />
      </div>
      <p className="dk-display dkc-green-question">
        {t(d.launch.live ? G.questionLive : G.question, lang)}
      </p>
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
      titleOf: d => (d.launch.live ? LAUNCH.cover.titleLive : L_TITLES.cover),
      cover: true,
      notes: N.cover,
      render: ctx => <Cover ctx={ctx} />,
      missing: d => [
        ...(d.logo
          ? []
          : ["No logo. Upload one, or the deck shows their first letter."]),
        ...(d.goLive
          ? []
          : [
              "No go-live date on the card. Add it here; the cover and the 90 days use it.",
            ]),
        // Only when there is a choice to make (DESIGN 22.15): with no ad of
        // their own the cover shows the example ad, which is designed.
        ...(d.launch.cover || !d.launch.creatives.some(c => !c.starter)
          ? []
          : [
              "Cover: no ad picked, so it shows their first ad. Pick another here if a different one suits.",
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
      // Creative flexibility before the ads (the fixer's round, 2026-10-20):
      // the guard rails are agreed before the client sees a single ad.
      id: "creative-freedom",
      title: L_TITLES["creative-freedom"],
      notes: N["creative-freedom"],
      stops: () => FREEDOM_STOPS.length,
      stopName: i => FREEDOM_STOPS[i] ?? null,
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
        const n = redLineCount(d);
        return n === 0
          ? [
              "No Do's & Don'ts on the card and none typed on the onboarding call. The panel invites them to tell you now.",
            ]
          : n > 5
            ? [
                "More than five red lines show on slide 3. Hide some in prep so the panel fits.",
              ]
            : [];
      },
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
      // The piece of the pie, then the two roads (no rail: the pie is the
      // whole split, not a zoom into one stop).
      id: "partnership",
      title: L_TITLES.partnership,
      notes: N.partnership,
      stops: () => PARTNER_STOPS,
      stopName: (i, ctx) => partnerStop(i, ctx.d.mode.dwy),
      render: ctx => <Partnership ctx={ctx} />,
    },
    {
      // The sales training: the meeting the course is for is lit on the rail.
      id: "training",
      title: L_TITLES.training,
      notes: N.training,
      stops: () => TRAINING_STOPS.length,
      stopName: i => TRAINING_STOPS[i] ?? null,
      rail: () => 5,
      render: ctx => <Training ctx={ctx} />,
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
      id: "good-to-know",
      title: L_TITLES["good-to-know"],
      notes: N["good-to-know"],
      render: ctx => <GoodToKnow ctx={ctx} />,
    },
    {
      id: "green-light",
      title: L_TITLES["green-light"],
      titleOf: d =>
        d.launch.live ? LAUNCH.green.questionLive : L_TITLES["green-light"],
      notes: N["green-light"],
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
