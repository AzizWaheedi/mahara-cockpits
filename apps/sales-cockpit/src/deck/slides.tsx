import { type ReactNode, useEffect, useState } from "react";
import logoOnDark from "../assets/mahara-logo-dark.png";
import {
  CURRENCIES,
  type Currency,
  closePlusTen,
  type Funnel,
  funnelTokens,
  gapFor,
  sayMoney,
  sayPct,
  stepWords,
} from "../lib/funnel";
import coverVilla from "./assets/cover-villa.webp";
import interiorMajlis from "./assets/interior-majlis.webp";
import salesDesk from "./assets/sales-desk.webp";
import siteDusk from "./assets/site-dusk.webp";
import skylineNight from "./assets/skyline-night.webp";
import villaGarden from "./assets/villa-garden.webp";
import {
  CAMPAIGNS,
  CASE_STUDY,
  COUNTRIES,
  FIRMS,
  GOOGLE,
  INCLUDED,
  type L,
  type Lang,
  LINKS,
  MILESTONES,
  NEXT_STEPS,
  PILLARS,
  type PillarKey,
  PROBLEMS,
  PROGRAM,
  type ProblemKey,
  STORIES,
  type Story,
  TIMELINE,
  TRADES,
  t,
} from "./content";
import {
  CaseBox,
  Fit,
  journeySlide,
  numberOneSlide,
  Place,
  reviewsSlide,
  tourSlide,
} from "./journeys";
import { OpenChip } from "./overlay";
import { Out, Rv, Wistia, YouTube } from "./parts";
import { Mark } from "./platforms";
import {
  ADS_TOUR,
  CALLS_TOUR,
  CLOSING_TOUR,
  CONTENT_TOUR,
  caseUrl,
  JOURNEY,
  MORE_STORIES,
  PROFILES,
  PROFILES_AS_OF,
  type Profile,
  REVIEW_PAGES,
  STORY_PROOF,
} from "./proof";
import { PORTAL_TOUR } from "./tour";

/** Every partner's story: the eight Wistia masters and the proof page's two more. */
const ALL_STORIES: Story[] = [...STORIES, ...MORE_STORIES];

/**
 * The deck's slides, in order. Each is a function of what the closer has
 * chosen on the call (the language, the prospect's problem, their numbers)
 * and of whether it is on screen, so a video loads only while it shows.
 */

/** Every photo the slides show, for the deck to load ahead of its slide. */
export const DECK_PHOTOS = [
  coverVilla,
  siteDusk,
  villaGarden,
  interiorMajlis,
  salesDesk,
  skylineNight,
];

export interface NumbersState {
  values: Record<string, string>;
  set: (key: string, value: string) => void;
  currency: Currency;
  setCurrency: (c: Currency) => void;
  /** The numbers came from the call's saved notes. */
  fromCall: boolean;
  funnel: Funnel;
}

export interface DeckCtx {
  lang: Lang;
  problem: ProblemKey | null;
  setProblem: (p: ProblemKey | null) => void;
  match: PillarKey[];
  leadName: string | null;
  presenter: string | null;
  numbers: NumbersState;
  guarantee: boolean;
  setGuarantee: (v: boolean) => void;
  budget: number;
  setBudget: (n: number) => void;
  market: string;
  setMarket: (m: string) => void;
  service: string;
  setService: (s: string) => void;
  /** The screen the portal tour is on. */
  tour: number;
  setTour: (n: number) => void;
}

export interface SlideDef {
  id: string;
  section: L;
  title: L;
  /** The step of the system this slide is about. */
  pillar?: PillarKey;
  /** Every step lit on the rail. */
  railAll?: boolean;
  /** No rail (the cover and the close compose the whole canvas). */
  noRail?: boolean;
  deep?: boolean;
  /** Its questions panel. */
  faq?: PillarKey;
  /** Steps inside the slide that → and ← walk before leaving it. */
  stops?: number;
  /** Kept in the code, left out of the deck for now. */
  hidden?: boolean;
  render: (ctx: DeckCtx, on: boolean) => ReactNode;
}

const S = {
  opening: { en: "Opening", ar: "البداية" },
  proof: { en: "Partners' results", ar: "نتايج شركائنا" },
  you: { en: "Your situation", ar: "وضعك" },
  system: { en: "The system", ar: "النظام" },
  program: { en: "The program", ar: "البرنامج" },
};

const ar = (lang: Lang) => lang === "ar";

/** A money figure in the deck's own voice: $6,000, ٦ آلاف دولار. */
const usd = (n: number, lang: Lang) => sayMoney(n, "USD", lang);

function Header({
  label,
  title,
  lead,
  wide = 1500,
}: {
  label?: string;
  title: string;
  lead?: string;
  wide?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 20,
        maxWidth: wide,
      }}
    >
      {label ? (
        <Rv i={0}>
          <p className="dk-label">{label}</p>
        </Rv>
      ) : null}
      <Rv i={1}>
        <h2 className="dk-h1">{title}</h2>
      </Rv>
      {lead ? (
        <Rv i={2}>
          <p className="dk-lead" style={{ maxWidth: 1250 }}>
            {lead}
          </p>
        </Rv>
      ) : null}
    </div>
  );
}

/** The line a matched pillar opens with: the prospect's own problem, answered. */
function Bridge({ ctx, pillar }: { ctx: DeckCtx; pillar: PillarKey }) {
  const p = PROBLEMS.find(x => x.key === ctx.problem);
  if (!p?.pillars.includes(pillar)) return null;
  return (
    <Rv i={0}>
      <div
        className="dk-glow"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 18,
          padding: "14px 26px",
          borderRadius: 18,
          background: "var(--dk-teal-soft)",
          marginBottom: 28,
        }}
      >
        <span className="dk-label" style={{ fontSize: 22 }}>
          {ar(ctx.lang) ? "هذا يحل مشكلتك" : "This answers your challenge"}
        </span>
        <span style={{ fontSize: 28, lineHeight: 1.35 }}>
          {t(p.bridge, ctx.lang)}
        </span>
      </div>
    </Rv>
  );
}

function pillarLabel(key: PillarKey, lang: Lang) {
  const n = PILLARS.findIndex(p => p.key === key) + 1;
  return ar(lang) ? `الخطوة ${"١٢٣٤٥"[n - 1]} من ٥` : `Step ${n} of 5`;
}

function Check() {
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 24 24"
      aria-hidden
      style={{ flex: "none", marginTop: 6 }}
    >
      <circle cx="12" cy="12" r="11" fill="rgba(0,207,200,.14)" />
      <path
        d="M7 12.5l3.2 3.2L17 9"
        fill="none"
        stroke="#00CFC8"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// --------------------------------------------------------------- slides

function cover(ctx: DeckCtx) {
  const { lang } = ctx;
  const rtl = ar(lang);
  return (
    <>
      <img className="dk-photo" src={coverVilla} alt="" aria-hidden />
      <div
        className="dk-scrim"
        aria-hidden
        style={{
          background: rtl
            ? "linear-gradient(270deg, rgba(6,13,36,.97) 0%, rgba(6,13,36,.9) 34%, rgba(6,13,36,.35) 68%, rgba(6,13,36,.15) 100%)"
            : "linear-gradient(90deg, rgba(6,13,36,.97) 0%, rgba(6,13,36,.9) 34%, rgba(6,13,36,.35) 68%, rgba(6,13,36,.15) 100%)",
        }}
      />
      <div
        className="dk-scrim"
        aria-hidden
        style={{
          background:
            "linear-gradient(0deg, rgba(6,13,36,.85) 0%, transparent 40%)",
        }}
      />
      <Rv i={0}>
        <img
          src={logoOnDark}
          alt="Mahara Media"
          style={{ height: 64, width: "auto" }}
        />
      </Rv>
      <div style={{ flex: 1 }} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 32,
          maxWidth: 1240,
        }}
      >
        <Rv i={1}>
          <h1 className="dk-display" style={{ fontSize: rtl ? 100 : 104 }}>
            {rtl ? (
              <>
                نساعد شركات المقاولات والتصميم تكسب{" "}
                <span className="dk-teal">مشاريع عالية القيمة.</span>
              </>
            ) : (
              <>
                We help construction and design companies win{" "}
                <span className="dk-teal">high-value projects.</span>
              </>
            )}
          </h1>
        </Rv>
        <Rv i={2}>
          <p
            className="dk-lead"
            style={{ maxWidth: 1000, color: "rgba(242,246,250,.82)" }}
          >
            {rtl
              ? "إعلانات، فريق اتصال، ونظام لإقفال الصفقات.. نشغلها لك بكل الخليج."
              : "Ads, a calling team and a closing system, run for you across the Gulf."}
          </p>
        </Rv>
        <Rv i={3}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            {COUNTRIES.map(c => (
              <span
                key={c.en}
                className="dk-pill"
                style={{
                  background: "rgba(6,13,36,.55)",
                  color: "var(--dk-ink)",
                }}
              >
                {t(c, lang)}
              </span>
            ))}
          </div>
        </Rv>
      </div>
      {ctx.leadName ? (
        <Rv
          i={4}
          style={{ position: "absolute", top: 120, insetInlineEnd: 136 }}
        >
          <p
            className="dk-small"
            style={{ textAlign: "end", color: "rgba(242,246,250,.75)" }}
          >
            {rtl ? "مجهّز لـ" : "Prepared for"}
            <br />
            <span style={{ color: "var(--dk-ink)", fontSize: 30 }}>
              {ctx.leadName}
            </span>
          </p>
        </Rv>
      ) : null}
    </>
  );
}

/** The pipeline drawn large over a site at dusk: the deck's thesis. */
function path(ctx: DeckCtx) {
  const { lang } = ctx;
  const rtl = ar(lang);
  const span = PILLARS.length - 1;
  return (
    <>
      <img className="dk-photo" src={siteDusk} alt="" aria-hidden />
      <div
        className="dk-scrim"
        aria-hidden
        style={{
          background:
            "linear-gradient(0deg, rgba(6,13,36,.98) 0%, rgba(6,13,36,.9) 38%, rgba(6,13,36,.55) 66%, rgba(6,13,36,.35) 100%)",
        }}
      />
      <Header
        title={
          rtl
            ? "من أول إعلان.. لين المشروع الموقّع. واحنا نشغل كل شي بينهم."
            : "From the first ad to the signed project. We run all of it."
        }
        lead={
          rtl
            ? "خمس خطوات، فريق واحد، وأرقام تشوفها كل يوم."
            : "Five steps, one team, and numbers you can see every day."
        }
      />
      <div style={{ flex: 1 }} />
      <Rv i={3}>
        <div className="dk-bigrail">
          <div className="dk-bigrail-line" />
          {PILLARS.map((p, i) => {
            // Nodes sit in from the ends, so every label can centre on its node.
            const pos = 7 + (i / span) * 86;
            return (
              <div key={p.key}>
                <div
                  className="dk-bignode"
                  style={{ insetInlineStart: `${pos}%` }}
                />
                <div
                  className="dk-biglabel"
                  style={{
                    insetInlineStart: `calc(${pos}% - 150px)`,
                    alignItems: "center",
                    textAlign: "center",
                  }}
                >
                  <span className="dk-num dk-teal" style={{ fontSize: 26 }}>
                    {/* No leading zero in Arabic: ٠ is a dot, so ٠١ reads as ·١. */}
                    {rtl ? "١٢٣٤٥"[i] : `0${i + 1}`}
                  </span>
                  <span className="dk-h3" style={{ fontSize: rtl ? 36 : 34 }}>
                    {t(p.name, lang)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </Rv>
    </>
  );
}

/** A number in Arabic-Indic digits. */
const arNum = (n: number) =>
  String(n).replace(/\d/g, d => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);

/**
 * Every partner at a glance: their logo, their headline number from the
 * case study, and their country (Aziz, 2026-10-07: "the case studies, the
 * logos, and the country of each person").
 */
function results(ctx: DeckCtx) {
  const { lang } = ctx;
  return (
    <>
      <Header
        label={
          ar(lang)
            ? `أكثر من ${FIRMS.ar.replace("+", "")} شركة بالخليج`
            : `${FIRMS.en} firms across the Gulf`
        }
        title={
          ar(lang)
            ? "اللي حصلوه شركاؤنا.. بكلامهم."
            : "What partners got, in their own words."
        }
      />
      <div style={{ flex: 1 }} />
      <div className="dk-partners">
        {ALL_STORIES.map((s, i) => {
          const p = STORY_PROOF[s.id];
          const m = p.metrics[0];
          return (
            <Rv key={s.id} i={2 + Math.floor(i / 5)}>
              <a
                className="dk-partner"
                href={caseUrl(p.slug, lang)}
                target="_blank"
                rel="noreferrer noopener"
              >
                <span className="dk-partner-logo">
                  {p.logo ? (
                    <img src={p.logo} alt={t(s.company, "en")} />
                  ) : (
                    <span>{t(s.company, lang)}</span>
                  )}
                </span>
                <span className="dk-num dk-partner-value">
                  {t(m.value, lang)}
                </span>
                <span className="dk-small">{t(m.label, lang)}</span>
                <Place proof={p} lang={lang} />
              </a>
            </Rv>
          );
        })}
      </div>
      <Rv i={5}>
        <div
          className="dk-hair"
          style={{
            marginTop: 22,
            paddingTop: 20,
            display: "flex",
            gap: 40,
            alignItems: "center",
          }}
        >
          <Out href={GOOGLE.url}>
            {ar(lang)
              ? `${"٤٫٧"} على قوقل، من ${"١٥"} تقييم`
              : `${GOOGLE.rating} on Google, from ${GOOGLE.reviews} reviews`}
          </Out>
          <Out href={LINKS.proof}>
            {ar(lang) ? "صفحة النتايج كاملة" : "The full results page"}
          </Out>
        </div>
      </Rv>
    </>
  );
}

/**
 * One partner: the video, who they are and where, what they got, and the
 * case study's numbers with the link to read it whole.
 */
function storySlide(s: Story, n: number) {
  return (ctx: DeckCtx, on: boolean) => {
    const { lang } = ctx;
    const p = STORY_PROOF[s.id];
    const w = s.ratio > 1.5 ? 880 : 640;
    const h = Math.round(w / s.ratio);
    const of = ALL_STORIES.length;
    return (
      <div className="dk-story">
        <div className="dk-story-media" style={{ width: w }}>
          <Rv i={0}>
            <div className="dk-video" style={{ width: w, height: h }}>
              <Wistia
                id={s.wistia}
                on={on}
                title={`${t(s.who, "en")}, ${t(s.company, "en")}`}
              />
            </div>
          </Rv>
          <Rv i={1}>
            <div className="dk-story-id">
              {p.logo ? (
                <img className="dk-story-logo" src={p.logo} alt="" />
              ) : null}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 32, fontWeight: 600 }}>
                  {t(s.who, lang)}
                </span>
                <span className="dk-body">
                  {t(s.company, lang)}
                  <span className="dk-ink3">{ar(lang) ? "، " : ", "}</span>
                  {t(s.trade, lang)}
                </span>
                <Place proof={p} lang={lang} />
              </div>
            </div>
          </Rv>
        </div>
        <div className="dk-story-words">
          <Rv i={1}>
            <p className="dk-label">
              {ar(lang)
                ? `قصة ${arNum(n + 1)} من ${arNum(of)}`
                : `Story ${n + 1} of ${of}`}
            </p>
          </Rv>
          <Rv i={2}>
            <p className="dk-h2" style={{ fontSize: ar(lang) ? 54 : 50 }}>
              {t(s.result, lang)}
            </p>
          </Rv>
          <Rv i={3}>
            <p className="dk-body dk-ink2">{t(s.why, lang)}</p>
          </Rv>
          <Rv i={4}>
            <CaseBox proof={p} lang={lang} />
          </Rv>
        </div>
      </div>
    );
  };
}

/** What ten more points of closing are worth at the prospect's own numbers. */
function closingGain(ctx: DeckCtx) {
  const { lang, numbers } = ctx;
  const plus = closePlusTen(numbers.funnel);
  if (plus?.moneyYear == null) return null;
  const money = sayMoney(plus.moneyYear, numbers.currency, lang);
  return (
    <p className="dk-gain">
      {ar(lang)
        ? `بأرقامك: لو نسبة إقفالك زادت ١٠ نقاط بس، هذا ${money} زيادة بالسنة.`
        : `At your numbers, ten more points of closing is worth ${money} a year.`}
    </p>
  );
}

function caseStudy(ctx: DeckCtx, on: boolean) {
  const { lang } = ctx;
  return (
    <div style={{ display: "flex", gap: 72, alignItems: "center", flex: 1 }}>
      <Rv i={0} style={{ flex: "none" }}>
        <div className="dk-video" style={{ width: 1000, height: 562 }}>
          <YouTube
            id={CASE_STUDY.youtube}
            on={on}
            title="$2M in signed projects in 60 days"
          />
        </div>
      </Rv>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 26,
          minWidth: 0,
        }}
      >
        <Rv i={1}>
          <p className="dk-label">
            {ar(lang) ? "القصة كاملة، ١٢ دقيقة" : "The full story, 12 minutes"}
          </p>
        </Rv>
        <Rv i={2}>
          <p className="dk-h2" style={{ fontSize: ar(lang) ? 64 : 58 }}>
            {t(CASE_STUDY.result, lang)}
          </p>
        </Rv>
        <Rv i={3}>
          <p className="dk-body">{t(CASE_STUDY.before, lang)}</p>
        </Rv>
      </div>
    </div>
  );
}

function problemSlide(ctx: DeckCtx) {
  const { lang, problem, setProblem } = ctx;
  return (
    <>
      <Header
        title={
          ar(lang)
            ? "شنو أكبر تحدي عندكم الحين؟"
            : "What's your biggest challenge right now?"
        }
        lead={
          ar(lang)
            ? "اختار واحد.. والخطوات اللي تحله بتنوّر لك."
            : "Pick one. The steps that answer it will light up."
        }
      />
      <div style={{ flex: 1 }} />
      <Rv i={3}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(6, 1fr)",
            gap: 24,
          }}
        >
          {PROBLEMS.map((p, i) => (
            <button
              key={p.key}
              type="button"
              className="dk-choice"
              aria-pressed={problem === p.key}
              onClick={() => setProblem(problem === p.key ? null : p.key)}
              style={{
                gridColumn: i < 3 ? "span 2" : "span 3",
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <span
                style={{
                  fontSize: ar(lang) ? 36 : 34,
                  fontWeight: 600,
                  lineHeight: 1.25,
                }}
              >
                {t(p.says, lang)}
              </span>
              <span
                className="dk-body"
                style={{ fontSize: ar(lang) ? 28 : 26 }}
              >
                {t(p.sub, lang)}
              </span>
            </button>
          ))}
        </div>
      </Rv>
    </>
  );
}

const FIELD_LABELS: { key: string; label: L; money?: boolean }[] = [
  {
    key: "leads_month",
    label: { en: "Inquiries a month", ar: "الاستفسارات بالشهر" },
  },
  {
    key: "booked_month",
    label: { en: "Meetings booked", ar: "المواعيد المحجوزة" },
  },
  {
    key: "showed_month",
    label: { en: "Meetings held", ar: "المواعيد اللي صارت" },
  },
  {
    key: "closed_month",
    label: { en: "Projects signed", ar: "المشاريع الموقّعة" },
  },
  {
    key: "project_value",
    label: { en: "Average project", ar: "متوسط المشروع" },
    money: true,
  },
];

function numbersSlide(ctx: DeckCtx) {
  const { lang, numbers } = ctx;
  const f = numbers.funnel;
  const gap = gapFor(f);
  const tok = funnelTokens(f, lang);
  const steps = f.steps.filter(s => s.key !== "ads");
  const names: Record<string, L> = {
    booking: { en: "Inquiry to meeting", ar: "من استفسار لموعد" },
    show: { en: "Meeting that happens", ar: "الموعد يصير فعلاً" },
    close: { en: "Meeting to signature", ar: "من موعد لتوقيع" },
  };
  return (
    <>
      <Header
        label={
          numbers.fromCall
            ? ar(lang)
              ? "من مكالمتنا اليوم"
              : "From our call today"
            : ar(lang)
              ? "نعبيها سوا الحين"
              : "Filled in together, now"
        }
        title={
          ar(lang) ? "أرقامك.. جنب أرقامنا." : "Your numbers, next to ours."
        }
      />
      <div style={{ flex: 1 }} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 640px",
          gap: 64,
          alignItems: "end",
        }}
      >
        <Rv i={2}>
          <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
            {steps.map(st => {
              const theirs =
                st.theirs != null && st.theirs <= 1 ? st.theirs : null;
              const leak = f.leak === st.key;
              return (
                <div
                  key={st.key}
                  style={{ display: "flex", flexDirection: "column", gap: 12 }}
                >
                  <div
                    style={{ display: "flex", alignItems: "baseline", gap: 20 }}
                  >
                    <span style={{ fontSize: 32, flex: 1 }}>
                      {t(names[st.key], lang)}
                    </span>
                    <span
                      className="dk-num"
                      style={{
                        fontSize: 40,
                        fontWeight: 600,
                        color: leak ? "var(--dk-leak)" : "var(--dk-ink)",
                      }}
                    >
                      {theirs == null ? "—" : sayPct(theirs, lang)}
                    </span>
                    <span className="dk-small">
                      {ar(lang) ? "رقمنا" : "ours"} {sayPct(st.ours, lang)}
                    </span>
                  </div>
                  <div
                    style={{
                      position: "relative",
                      height: 14,
                      borderRadius: 999,
                      background: "rgba(255,255,255,.08)",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        insetInlineStart: 0,
                        top: 0,
                        bottom: 0,
                        borderRadius: 999,
                        width: `${Math.min(theirs ?? 0, 1) * 100}%`,
                        background: leak
                          ? "var(--dk-leak)"
                          : st.standing === "ahead"
                            ? "var(--dk-good)"
                            : "rgba(255,255,255,.4)",
                        transition: "width 500ms cubic-bezier(.2,.7,.2,1)",
                      }}
                    />
                    <div
                      aria-hidden
                      style={{
                        position: "absolute",
                        top: -8,
                        bottom: -8,
                        width: 4,
                        borderRadius: 4,
                        insetInlineStart: `calc(${st.ours * 100}% - 2px)`,
                        background: "var(--dk-teal)",
                      }}
                    />
                  </div>
                </div>
              );
            })}
            {!numbers.fromCall ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(5, 1fr)",
                  gap: 16,
                  marginTop: 8,
                  alignItems: "end",
                }}
              >
                {FIELD_LABELS.map(fl => (
                  <label
                    key={fl.key}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "flex-end",
                      gap: 8,
                    }}
                  >
                    <span className="dk-small" style={{ fontSize: 22 }}>
                      {t(fl.label, lang)}
                      {fl.money ? ` (${numbers.currency})` : ""}
                    </span>
                    <input
                      className="dk-input"
                      inputMode="decimal"
                      value={numbers.values[fl.key] ?? ""}
                      onChange={e => numbers.set(fl.key, e.target.value)}
                      dir="ltr"
                    />
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        </Rv>
        <Rv i={3}>
          <div
            className="dk-card dk-glow"
            style={{ display: "flex", flexDirection: "column", gap: 18 }}
          >
            {f.leak &&
            gap &&
            gap.projectsYear != null &&
            gap.projectsYear >= 0.5 ? (
              <>
                <p className="dk-label">
                  {ar(lang) ? "أهم شغلة" : "The one thing"}
                </p>
                <p style={{ fontSize: 36, fontWeight: 600, lineHeight: 1.3 }}>
                  {ar(lang) ? "لو صلحنا بس " : "Fix only "}
                  {stepWords(f.leak, lang)}
                </p>
                <p
                  className="dk-num"
                  style={{
                    fontSize: 76,
                    fontWeight: 600,
                    color: "var(--dk-teal)",
                    lineHeight: 1.05,
                  }}
                >
                  {tok["GAP YEAR"] ?? tok["EXTRA PROJECTS A YEAR"]}
                </p>
                <p className="dk-body">
                  {ar(lang)
                    ? `${tok["EXTRA PROJECTS A YEAR"] ?? ""} بالسنة${tok["GAP YEAR"] ? "، بمتوسط مشروعك" : ""}. بدون ما تصرف ولا فلس زيادة على الإعلانات.`
                    : `${tok["EXTRA PROJECTS A YEAR"] ?? ""} a year${tok["GAP YEAR"] ? " at your average project" : ""}. Without spending a dollar more on ads.`}
                </p>
              </>
            ) : (
              <>
                <p className="dk-label">
                  {ar(lang) ? "أهم شغلة" : "The one thing"}
                </p>
                <p className="dk-body">
                  {ar(lang)
                    ? "نعبي الاستفسارات، المواعيد، اللي حضروا، واللي وقّعوا.. ونشوف وين تضيع أكثر فرص."
                    : "Fill in inquiries, meetings, show-ups and signatures, and the biggest leak shows here."}
                </p>
              </>
            )}
            <p className="dk-small" style={{ fontSize: 22 }}>
              {ar(lang)
                ? "رقمنا هو اللي نحاسب نفسنا عليه مع كل عميل: ربع الاستفسارات مواعيد، ٦٠٪ يحضرون، وخُمس اللي يحضرون يوقّعون."
                : "Ours is what we hold every client's funnel to: a quarter of inquiries booked, 60% held, a fifth of held meetings signed."}
            </p>
            {!numbers.fromCall ? (
              <select
                className="dk-select"
                value={numbers.currency}
                onChange={e => numbers.setCurrency(e.target.value as Currency)}
                aria-label={ar(lang) ? "العملة" : "Currency"}
                style={{ height: 56, fontSize: 24, alignSelf: "flex-start" }}
              >
                {CURRENCIES.map(c => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </Rv>
      </div>
    </>
  );
}

function whoSlide(ctx: DeckCtx) {
  const { lang } = ctx;
  const rtl = ar(lang);
  const pics = [villaGarden, interiorMajlis, siteDusk];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 780px",
        gridTemplateRows: "minmax(0, 1fr)",
        minHeight: 0,
        gap: 72,
        flex: 1,
        alignItems: "stretch",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        <Header
          title={
            rtl
              ? "مبني بس للشركات بالمقاولات والتصميم."
              : "Built only for construction and design firms."
          }
          lead={
            rtl
              ? "ما نشتغل مع مطاعم ولا عيادات ولا محلات. هذا شغلنا كله."
              : "No restaurants, clinics or shops. This is all we do."
          }
        />
        <div style={{ flex: 1 }} />
        <Rv i={3}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            {TRADES.map(tr => (
              <span
                key={tr.en}
                className="dk-pill"
                style={{
                  fontSize: 28,
                  padding: "12px 26px",
                  color: "var(--dk-ink)",
                }}
              >
                {t(tr, lang)}
              </span>
            ))}
          </div>
        </Rv>
      </div>
      <Rv
        i={2}
        style={{
          display: "grid",
          gridTemplateRows: "minmax(0, 1.25fr) minmax(0, 1fr)",
          gridTemplateColumns: "1fr 1fr",
          gap: 20,
          height: "100%",
          minHeight: 0,
        }}
      >
        {pics.map((src, i) => (
          <img
            key={src}
            src={src}
            alt=""
            aria-hidden
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              minHeight: 0,
              borderRadius: 24,
              gridColumn: i === 0 ? "span 2" : undefined,
              border: "1px solid var(--dk-line)",
            }}
          />
        ))}
      </Rv>
    </div>
  );
}

function systemSlide(ctx: DeckCtx) {
  const { lang, match } = ctx;
  return (
    <>
      <Header
        label="Project to Profit"
        title={
          ar(lang)
            ? "خمس خطوات.. وفريق واحد يشغلها."
            : "Five steps, and one team running them."
        }
      />
      <div style={{ flex: 1 }} />
      <Rv i={2}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 28,
          }}
        >
          {PILLARS.map((p, i) => {
            const hit = match.includes(p.key);
            return (
              <div
                key={p.key}
                className={hit ? "dk-card dk-glow" : "dk-card"}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                  padding: "34px 32px",
                }}
              >
                <span className="dk-num dk-teal" style={{ fontSize: 26 }}>
                  {ar(lang) ? "١٢٣٤٥"[i] : `0${i + 1}`}
                </span>
                <span
                  style={{
                    fontSize: ar(lang) ? 34 : 32,
                    fontWeight: 600,
                    lineHeight: 1.25,
                  }}
                >
                  {t(p.name, lang)}
                </span>
                <span
                  className="dk-body"
                  style={{ fontSize: ar(lang) ? 27 : 25 }}
                >
                  {t(p.line, lang)}
                </span>
                {hit ? (
                  <span
                    className="dk-label"
                    style={{ fontSize: 21, marginTop: "auto" }}
                  >
                    {ar(lang) ? "يحل مشكلتك" : "Answers your challenge"}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </Rv>
    </>
  );
}

function speedSlide(ctx: DeckCtx) {
  const { lang } = ctx;
  const rtl = ar(lang);
  return (
    <>
      <img className="dk-photo" src={salesDesk} alt="" aria-hidden />
      <div
        className="dk-scrim"
        aria-hidden
        style={{
          background: rtl
            ? "linear-gradient(270deg, rgba(6,13,36,.96) 0%, rgba(6,13,36,.85) 45%, rgba(6,13,36,.35) 100%)"
            : "linear-gradient(90deg, rgba(6,13,36,.96) 0%, rgba(6,13,36,.85) 45%, rgba(6,13,36,.35) 100%)",
        }}
      />
      <Header
        label={rtl ? "ليش السرعة" : "Why speed"}
        title={
          rtl
            ? "أول خمس دقايق.. تحدد مصير الليد."
            : "The first five minutes decide the lead."
        }
        wide={1100}
      />
      <div style={{ flex: 1 }} />
      <Rv i={2} style={{ maxWidth: 1000 }}>
        <p
          className="dk-num"
          style={{
            fontSize: 210,
            lineHeight: 0.9,
            fontWeight: 600,
            color: "var(--dk-teal)",
          }}
        >
          {rtl ? "٢١×" : "21×"}
        </p>
        <p
          style={{
            fontSize: rtl ? 42 : 40,
            lineHeight: 1.3,
            fontWeight: 600,
            marginTop: 20,
          }}
        >
          {rtl
            ? "احتمال أعلى إن الليد يتأهل لو اتصلت خلال ٥ دقايق.. بدال ٣٠ دقيقة."
            : "more likely to qualify a lead when you call within 5 minutes instead of 30."}
        </p>
        <p className="dk-small" style={{ marginTop: 18 }}>
          {rtl
            ? "المصدر: دراسة Lead Response Management من MIT وInsideSales."
            : "Source: the Lead Response Management study, MIT and InsideSales."}
        </p>
      </Rv>
    </>
  );
}

function portalSlide(ctx: DeckCtx) {
  const { lang, tour, setTour } = ctx;
  const at = Math.max(0, Math.min(tour, PORTAL_TOUR.length - 1));
  return (
    <div className="dk-tour">
      <div className="dk-tour-side">
        <Rv i={0}>
          <p className="dk-label">{pillarLabel("data", lang)}</p>
        </Rv>
        <Rv i={1}>
          <h2 className="dk-h2 dk-tour-title">
            {ar(lang)
              ? "بوابتك: Mahara OS.. كل شي بمكان واحد"
              : "Your portal, Mahara OS: all in one place"}
          </h2>
        </Rv>
        <Rv i={2} style={{ marginTop: 26 }}>
          <div
            role="tablist"
            aria-label={ar(lang) ? "شاشات البوابة" : "Portal screens"}
            className="dk-stops"
          >
            {PORTAL_TOUR.map((s, i) => (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={i === at}
                className="dk-stop"
                data-on={i === at ? "" : undefined}
                onClick={() => setTour(i)}
              >
                <span className="dk-stop-name">{t(s.name, lang)}</span>
                {i === at ? (
                  <>
                    <span className="dk-stop-line">{t(s.line, lang)}</span>
                    <span className="dk-why">
                      <span className="dk-why-label">
                        {ar(lang) ? "ليش يهمك" : "Why it matters to you"}
                      </span>
                      <span>{t(s.why, lang)}</span>
                    </span>
                  </>
                ) : null}
              </button>
            ))}
          </div>
        </Rv>
      </div>
      <Rv i={2} style={{ minHeight: 0, display: "flex" }}>
        <div
          className="dk-browser"
          style={{ flex: 1, display: "flex", flexDirection: "column" }}
        >
          <div className="dk-browser-bar">
            <i />
            <i />
            <i />
            <span>portal.maharamedia.com</span>
          </div>
          <div
            style={{
              position: "relative",
              flex: 1,
              minHeight: 0,
              background: "#f6f8f7",
            }}
          >
            {PORTAL_TOUR.map((s, i) => (
              <img
                key={s.key}
                className="dk-tour-shot"
                data-on={i === at ? "" : undefined}
                src={s.src[lang]}
                alt={i === at ? t(s.name, lang) : ""}
                aria-hidden={i === at ? undefined : true}
              />
            ))}
            <span className="dk-demo-badge">
              {ar(lang) ? "حساب تجريبي" : "Demo workspace"}
            </span>
          </div>
        </div>
      </Rv>
    </div>
  );
}

function phoneSlide(ctx: DeckCtx, on: boolean) {
  const { lang } = ctx;
  const feats: L[] = [
    {
      en: "Installs on your phone like an app",
      ar: "ينزل على تلفونك مثل التطبيق",
    },
    {
      en: "Record what happened in each meeting in seconds",
      ar: "سجل شنو صار بكل موعد بثواني",
    },
    {
      en: "Your results and what needs you, at a glance",
      ar: "نتايجك واللي ناطرك.. بنظرة وحدة",
    },
    {
      en: "Reminders when a meeting still needs an outcome",
      ar: "تذكير لمن موعد ليلحين بدون نتيجة",
    },
    {
      en: "Your journey: launch, first booking, first won project",
      ar: "رحلتك: الإطلاق، أول موعد، أول مشروع موقّع",
    },
  ];
  return (
    <div style={{ display: "flex", gap: 96, alignItems: "center", flex: 1 }}>
      <Rv i={0} style={{ flex: "none" }}>
        <div
          style={{
            width: 400,
            height: 711,
            borderRadius: 56,
            padding: 12,
            background: "#02060f",
            boxShadow:
              "0 0 0 2px rgba(255,255,255,.12), 0 40px 90px -30px rgba(0,207,200,.35)",
          }}
        >
          <div
            className="dk-video"
            style={{
              width: "100%",
              height: "100%",
              borderRadius: 44,
              border: 0,
            }}
          >
            {on ? (
              // biome-ignore lint/a11y/useMediaCaption: the portal's demo videos carry burned-in captions in both languages
              <video
                src={`${LINKS.portal}/demos/mahara-mobile-${lang}.mp4`}
                poster={`${LINKS.portal}/demos/mobile-poster-${lang}.jpg`}
                controls
                playsInline
                preload="metadata"
              />
            ) : (
              <div className="dk-video-poster" />
            )}
          </div>
        </div>
      </Rv>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 26,
          minWidth: 0,
        }}
      >
        <Rv i={1}>
          <p className="dk-label">
            {ar(lang) ? "على تلفونك" : "On your phone"}
          </p>
        </Rv>
        <Rv i={2}>
          <h2 className="dk-h1">
            {ar(lang)
              ? "شغلك معانا.. بجيبك."
              : "Your work with us, in your pocket."}
          </h2>
        </Rv>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            marginTop: 8,
          }}
        >
          {feats.map((f, i) => (
            <Rv key={f.en} i={3 + i}>
              <div
                style={{ display: "flex", gap: 18, alignItems: "flex-start" }}
              >
                <Check />
                <span
                  style={{ fontSize: ar(lang) ? 33 : 31, lineHeight: 1.35 }}
                >
                  {t(f, lang)}
                </span>
              </div>
            </Rv>
          ))}
        </div>
        <Rv i={9}>
          <Out href={LINKS.portalInstall}>
            {ar(lang) ? "شلون تنزله" : "How to install it"}
          </Out>
        </Rv>
      </div>
    </div>
  );
}

function includedSlide(ctx: DeckCtx) {
  const { lang } = ctx;
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 560px",
        gap: 80,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        <Header
          label={t(PROGRAM.name, lang)}
          title={ar(lang) ? "شنو يشمل البرنامج." : "What the program includes."}
        />
        <div
          style={{
            marginTop: 44,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {INCLUDED.map((it, i) => (
            <Rv key={it.en} i={2 + (i % 5)}>
              <div
                style={{ display: "flex", gap: 18, alignItems: "flex-start" }}
              >
                <Check />
                <span
                  style={{ fontSize: ar(lang) ? 31 : 30, lineHeight: 1.35 }}
                >
                  {t(it, lang)}
                </span>
              </div>
            </Rv>
          ))}
        </div>
      </div>
      <Rv i={1} style={{ minHeight: 0, display: "flex" }}>
        <div
          style={{
            position: "relative",
            flex: 1,
            borderRadius: 28,
            overflow: "hidden",
            border: "1px solid var(--dk-line)",
          }}
        >
          <img className="dk-photo" src={interiorMajlis} alt="" aria-hidden />
        </div>
      </Rv>
    </div>
  );
}

function timelineSlide(ctx: DeckCtx) {
  const { lang } = ctx;
  const rtl = ar(lang);
  return (
    <>
      <Header title={rtl ? "أول ٩٠ يوم." : "The first 90 days."} />
      <div style={{ flex: 1 }} />
      <Rv i={2}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 28,
          }}
        >
          {TIMELINE.map((s, i) => (
            <div
              key={s.when.en}
              style={{ display: "flex", flexDirection: "column", gap: 16 }}
            >
              <div
                style={{
                  height: 6,
                  borderRadius: 6,
                  background: "var(--dk-grad)",
                  opacity: 0.35 + i * 0.2,
                }}
              />
              <span className="dk-label" style={{ fontSize: 26 }}>
                {t(s.when, lang)}
              </span>
              <span style={{ fontSize: rtl ? 31 : 29, lineHeight: 1.4 }}>
                {t(s.what, lang)}
              </span>
            </div>
          ))}
        </div>
      </Rv>
      <Rv i={3}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 24,
            marginTop: 44,
            height: 250,
          }}
        >
          {[siteDusk, villaGarden].map((src, i) => (
            <div
              key={src}
              style={{
                position: "relative",
                borderRadius: 24,
                overflow: "hidden",
                border: "1px solid var(--dk-line)",
              }}
            >
              <img className="dk-photo" src={src} alt="" aria-hidden />
              <div
                className="dk-scrim"
                aria-hidden
                style={{
                  background:
                    "linear-gradient(0deg, rgba(6,13,36,.9), transparent 60%)",
                }}
              />
              <span
                className="dk-pill"
                style={{
                  position: "absolute",
                  bottom: 22,
                  insetInlineStart: 24,
                  background: "rgba(6,13,36,.7)",
                  color: "var(--dk-ink)",
                }}
              >
                {i === 0
                  ? rtl
                    ? "من أول يوم"
                    : "From day one"
                  : t(MILESTONES[MILESTONES.length - 1], lang)}
              </span>
            </div>
          ))}
        </div>
      </Rv>
      <Rv i={4}>
        <div
          style={{
            marginTop: 22,
            display: "flex",
            alignItems: "center",
            gap: 18,
            flexWrap: "wrap",
          }}
        >
          <span className="dk-small" style={{ fontSize: 24 }}>
            {rtl ? "بوابتك تتابع:" : "Your portal tracks:"}
          </span>
          {MILESTONES.map(m => (
            <span
              key={m.en}
              className="dk-pill"
              style={{ color: "var(--dk-ink)" }}
            >
              {t(m, lang)}
            </span>
          ))}
        </div>
      </Rv>
    </>
  );
}

function budgetSlide(ctx: DeckCtx) {
  const { lang, budget, setBudget } = ctx;
  const leads = Math.round(budget / CAMPAIGNS.perLead);
  const booked = Math.round(budget / CAMPAIGNS.perBooking);
  const perDay = Math.round(budget / 30);
  const n = (x: number) =>
    ar(lang)
      ? String(x).replace(/\d/g, d => "٠١٢٣٤٥٦٧٨٩"[Number(d)])
      : x.toLocaleString("en-US");
  return (
    <>
      <Header
        label={ar(lang) ? "ميزانية الإعلانات" : "The ad budget"}
        title={ar(lang) ? "شنو تييب لك ميزانيتك." : "What your ad budget buys."}
        lead={
          ar(lang)
            ? "الميزانية تروح للمنصات مباشرة. احنا ما نلمسها."
            : "The budget goes straight to the platforms. We never touch it."
        }
      />
      <div style={{ flex: 1 }} />
      <Rv i={3}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 28,
            alignItems: "end",
          }}
        >
          <div
            className="dk-card"
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            <span className="dk-small">{ar(lang) ? "بالشهر" : "A month"}</span>
            <span className="dk-num" style={{ fontSize: 72, fontWeight: 600 }}>
              {usd(budget, lang)}
            </span>
            <span className="dk-body">
              {ar(lang)
                ? `يعني ${usd(perDay, lang)} باليوم`
                : `${usd(perDay, lang)} a day`}
            </span>
          </div>
          <div
            className="dk-card"
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            <span className="dk-small">
              {ar(lang) ? "استفسارات، تقريباً" : "Inquiries, about"}
            </span>
            <span
              className="dk-num dk-teal"
              style={{ fontSize: 72, fontWeight: 600 }}
            >
              {n(leads)}
            </span>
            <span className="dk-body">
              {ar(lang)
                ? `بمعدل ${usd(CAMPAIGNS.perLead, lang)} للاستفسار`
                : `at ${usd(CAMPAIGNS.perLead, lang)} an inquiry`}
            </span>
          </div>
          <div
            className="dk-card"
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            <span className="dk-small">
              {ar(lang)
                ? "مواعيد محجوزة، تقريباً"
                : "Booked appointments, about"}
            </span>
            <span
              className="dk-num dk-teal"
              style={{ fontSize: 72, fontWeight: 600 }}
            >
              {n(booked)}
            </span>
            <span className="dk-body">
              {ar(lang)
                ? `بمعدل ${usd(CAMPAIGNS.perBooking, lang)} للموعد`
                : `at ${usd(CAMPAIGNS.perBooking, lang)} a booking`}
            </span>
          </div>
        </div>
      </Rv>
      <Rv i={4}>
        <div
          style={{
            marginTop: 36,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <input
            type="range"
            className="dk-range"
            min={500}
            max={3000}
            step={100}
            value={budget}
            onChange={e => setBudget(Number(e.target.value))}
            aria-label={ar(lang) ? "الميزانية بالشهر" : "Monthly budget"}
            dir="ltr"
          />
          <span className="dk-small" style={{ fontSize: 22 }}>
            {ar(lang)
              ? `الأرقام هي معدل ${t(CAMPAIGNS.window, lang)}. سوقك وعرضك يغيرونها.`
              : `The rates are the average of ${t(CAMPAIGNS.window, lang)}. Your market and offer move them.`}
          </span>
        </div>
      </Rv>
    </>
  );
}

function investmentSlide(ctx: DeckCtx) {
  const { lang, guarantee, setGuarantee } = ctx;
  const [lo, hi] = PROGRAM.adsPerDay;
  return (
    <>
      <Header
        label={t(PROGRAM.name, lang)}
        title={ar(lang) ? "الاستثمار." : "The investment."}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 32,
          alignItems: "stretch",
          marginTop: 72,
        }}
      >
        <Rv i={2}>
          <div
            className="dk-card"
            style={{
              height: "100%",
              minHeight: 380,
              display: "flex",
              flexDirection: "column",
              gap: 18,
              padding: "44px 48px",
            }}
          >
            <span className="dk-small">
              {ar(lang) ? "١. ميزانية الإعلانات" : "1. The ad budget"}
            </span>
            <span
              className="dk-num"
              style={{
                fontSize: ar(lang) ? 76 : 96,
                fontWeight: 600,
                lineHeight: 1.1,
                whiteSpace: "nowrap",
              }}
            >
              {ar(lang)
                ? `${usd(lo, lang)} لـ${usd(hi, lang)}`
                : `${usd(lo, lang)} to ${usd(hi, lang)}`}
            </span>
            <span className="dk-body">
              {ar(lang)
                ? "باليوم، تدفعها للمنصات مباشرة.. مو لنا."
                : "a day, paid straight to the platforms, not to us."}
            </span>
            <span className="dk-small" style={{ marginTop: "auto" }}>
              {ar(lang)
                ? `يعني تقريباً ${usd(lo * 30, lang)} لـ${usd(hi * 30, lang)} بالشهر.`
                : `About ${usd(lo * 30, lang)} to ${usd(hi * 30, lang)} a month.`}
            </span>
          </div>
        </Rv>
        <Rv i={3}>
          <button
            type="button"
            className="dk-card dk-glow"
            onClick={() => setGuarantee(!guarantee)}
            style={{
              height: "100%",
              width: "100%",
              textAlign: "start",
              color: "inherit",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              gap: 18,
              padding: "44px 48px",
              font: "inherit",
            }}
          >
            <span className="dk-small">
              {ar(lang)
                ? `٢. ${t(PROGRAM.name, lang)}`
                : `2. The ${t(PROGRAM.name, lang)}`}
            </span>
            <span
              className="dk-num dk-teal"
              style={{
                fontSize: ar(lang) ? 100 : 120,
                fontWeight: 600,
                lineHeight: 1.1,
                whiteSpace: "nowrap",
              }}
            >
              {usd(PROGRAM.usd, lang)}
            </span>
            <span className="dk-body">
              {ar(lang)
                ? `لـ٩٠ يوم. العربون ${usd(PROGRAM.deposit, lang)} اليوم، وينخصم من المبلغ.`
                : `for 90 days. A ${usd(PROGRAM.deposit, lang)} deposit today, taken off the total.`}
            </span>
          </button>
        </Rv>
      </div>
      {guarantee ? (
        <div
          className="dk-glow"
          style={{
            marginTop: 28,
            borderRadius: 24,
            padding: "28px 36px",
            background: "var(--dk-teal-soft)",
            display: "flex",
            gap: 28,
            alignItems: "baseline",
            animation: "dk-up 520ms cubic-bezier(.2,.7,.2,1) both",
          }}
        >
          <span className="dk-label" style={{ flex: "none" }}>
            {t(PROGRAM.guaranteeLabel, lang)}
          </span>
          <span
            style={{
              fontSize: ar(lang) ? 36 : 34,
              fontWeight: 600,
              lineHeight: 1.35,
            }}
          >
            {t(PROGRAM.guarantee, lang)}
          </span>
        </div>
      ) : null}
    </>
  );
}

function nextSlide(ctx: DeckCtx) {
  const { lang } = ctx;
  return (
    <>
      <Header title={ar(lang) ? "الخطوات الياية." : "What happens next."} />
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <Rv i={2}>
          <div
            style={{
              position: "relative",
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 40,
            }}
          >
            {/* The four steps are one sequence: a line joins their numbers. */}
            <div
              aria-hidden
              style={{
                position: "absolute",
                top: 43,
                insetInlineStart: 44,
                width: 1266,
                height: 3,
                borderRadius: 3,
                background: "var(--dk-grad)",
                opacity: 0.7,
              }}
            />
            {NEXT_STEPS.map((s, i) => (
              <div
                key={s.en}
                style={{
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  gap: 30,
                }}
              >
                <span
                  className="dk-num"
                  style={{
                    width: 88,
                    height: 88,
                    borderRadius: 999,
                    display: "grid",
                    placeItems: "center",
                    background: "var(--dk-space)",
                    border: "3px solid var(--dk-teal)",
                    color: "var(--dk-teal)",
                    fontSize: 40,
                    fontWeight: 600,
                  }}
                >
                  {ar(lang) ? "١٢٣٤"[i] : i + 1}
                </span>
                <span
                  style={{
                    fontSize: ar(lang) ? 38 : 36,
                    lineHeight: 1.35,
                    paddingInlineEnd: 24,
                  }}
                >
                  {t(s, lang)}
                </span>
              </div>
            ))}
          </div>
        </Rv>
      </div>
    </>
  );
}

function closeSlide(ctx: DeckCtx) {
  const { lang } = ctx;
  return (
    <>
      <img className="dk-photo" src={skylineNight} alt="" aria-hidden />
      <div
        className="dk-scrim"
        aria-hidden
        style={{
          background:
            "linear-gradient(0deg, rgba(6,13,36,.96) 0%, rgba(6,13,36,.6) 45%, rgba(6,13,36,.25) 100%)",
        }}
      />
      <div style={{ flex: 1 }} />
      <Rv i={0}>
        <h2 className="dk-display" style={{ maxWidth: 1450 }}>
          {ar(lang)
            ? "خلنا نحط أول مشاريعك بالكلندر."
            : "Let's put your first projects on the calendar."}
        </h2>
      </Rv>
      <Rv
        i={1}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 36,
          marginTop: 56,
        }}
      >
        <img
          src={logoOnDark}
          alt="Mahara Media"
          style={{ height: 52, width: "auto" }}
        />
        <span
          className="dk-small"
          style={{ fontSize: 26, color: "rgba(242,246,250,.75)" }}
        >
          {ctx.presenter ? `${ctx.presenter}, ` : ""}Mahara Media
        </span>
        <span style={{ flex: 1 }} />
        <Out href={LINKS.site}>maharamedia.com</Out>
      </Rv>
    </>
  );
}

// --------------------------------------------------------- our channels

/** A count in the deck's digits: 2,855, ٢٬٨٥٥. */
const sayCount = (n: number, lang: Lang) => {
  const en = n.toLocaleString("en-US");
  return ar(lang)
    ? en.replace(/\d/g, d => "٠١٢٣٤٥٦٧٨٩"[Number(d)]).replace(/,/g, "٬")
    : en;
};

const prefersStill = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/**
 * A figure that runs up to its value as the slide comes in, at the #1
 * page's pace (motion.tsx CountUp: 1.5 s, easing out). Its own because a
 * follower count has a thousands comma, which CountUp's figure() does not
 * read.
 */
function Count({ n, lang, delay }: { n: number; lang: Lang; delay: number }) {
  const [v, setV] = useState(() => (prefersStill() ? n : 0));
  useEffect(() => {
    if (prefersStill()) {
      setV(n);
      return;
    }
    let raf = 0;
    const start = performance.now() + delay;
    const tick = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - start) / 1500));
      setV(Math.round(n * (1 - (1 - k) ** 4)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [n, delay]);
  const final = sayCount(n, lang);
  return (
    <span className="dk-num dk-channel-value">
      <span className="sr-only">{final}</span>
      <span aria-hidden style={{ minWidth: `${final.length}ch` }}>
        {sayCount(v, lang)}
      </span>
    </span>
  );
}

const PLATFORM: Record<Profile["key"], L> = {
  youtube: { en: "YouTube", ar: "يوتيوب" },
  instagram: { en: "Instagram", ar: "إنستقرام" },
};

/** A profile page as it showed, a link to it, its counters ringed. */
function ProfileCard({
  p,
  lang,
  height,
}: {
  p: Profile;
  lang: Lang;
  height: number;
}) {
  const pct = (f: number) => `${(f * 100).toFixed(2)}%`;
  return (
    <a
      className="dk-profile"
      data-link=""
      href={p.href}
      target="_blank"
      rel="noreferrer noopener"
      style={{ width: Math.round(height * p.shot.r), height }}
      aria-label={`${p.shot.alt}. ${t(p.open, lang)}`}
    >
      <img src={p.shot.src} alt="" />
      <i
        className="dk-profile-ring"
        aria-hidden
        style={{
          left: pct(p.spot.x),
          top: pct(p.spot.y),
          width: pct(p.spot.w),
          height: pct(p.spot.h),
        }}
      />
      <OpenChip>{t(p.open, lang)}</OpenChip>
    </a>
  );
}

/** A profile's figures, set large beside its screenshot. */
function ProfileFigures({ p, lang, i }: { p: Profile; lang: Lang; i: number }) {
  return (
    <div className="dk-channel-figs" data-side={i === 0 ? "start" : "end"}>
      <span className="dk-channel-name">
        <Mark mark={p.key} size={44} />
        <span>{t(PLATFORM[p.key], lang)}</span>
      </span>
      {p.figures.map((f, j) => (
        <div key={f.label.en} className="dk-channel-fig">
          <Count n={f.n} lang={lang} delay={520 + (i * 2 + j) * 160} />
          <span className="dk-channel-label">{t(f.label, lang)}</span>
        </div>
      ))}
      {p.note ? (
        <span className="dk-pill dk-channel-note">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
            <path
              d="M6.5 12.5l3.6 3.6L17.5 8.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {t(p.note, lang)}
        </span>
      ) : null}
      <bdi className="dk-channel-handle" dir="ltr">
        {p.handle}
      </bdi>
    </div>
  );
}

/**
 * Our own channels at the end of the deck (Aziz, 2026-10-08: "take a
 * screenshot of our ig and yt profiles with the vids on the grid so it
 * shows all the stuff and our numbers"). Each profile is its real page,
 * one click from the live one, its counters ringed on the screenshot and
 * set large beside it; the two sets of figures meet in the middle.
 */
function channelsSlide(ctx: DeckCtx) {
  const { lang } = ctx;
  const [yt, ig] = PROFILES;
  const figs = 270;
  const near = 44;
  const middle = 64;
  return (
    <>
      <Rv i={0}>
        <p className="dk-label">{ar(lang) ? "قنواتنا" : "Our channels"}</p>
      </Rv>
      <Rv i={1}>
        <h2 className="dk-h2" style={{ marginTop: 12 }}>
          {ar(lang)
            ? "نعلّم السوق جدام الكل.. تابعنا."
            : "We teach the industry in public. Follow along."}
        </h2>
      </Rv>
      <Rv i={2} className="dk-channels">
        <Fit>
          {box => {
            const room = box.w - figs * 2 - near * 2 - middle;
            const h = Math.floor(
              Math.min(box.h, room / (yt.shot.r + ig.shot.r)),
            );
            return (
              <div className="dk-channels-row" style={{ gap: near }}>
                <ProfileCard p={yt} lang={lang} height={h} />
                <div
                  className="dk-channels-mid"
                  style={{ width: figs * 2 + middle, gap: middle }}
                >
                  <ProfileFigures p={yt} lang={lang} i={0} />
                  <ProfileFigures p={ig} lang={lang} i={1} />
                </div>
                <ProfileCard p={ig} lang={lang} height={h} />
              </div>
            );
          }}
        </Fit>
      </Rv>
      <Rv i={3}>
        <p className="dk-channels-source">{t(PROFILES_AS_OF, lang)}</p>
      </Rv>
    </>
  );
}

// ---------------------------------------------------------- the order

export function deckSlides(): SlideDef[] {
  const all: SlideDef[] = [
    {
      id: "cover",
      section: S.opening,
      title: { en: "Cover", ar: "الغلاف" },
      noRail: true,
      deep: true,
      render: c => cover(c),
    },
    {
      id: "path",
      section: S.opening,
      title: { en: "From ad to signed project", ar: "من الإعلان للتوقيع" },
      noRail: true,
      deep: true,
      render: c => path(c),
    },
    {
      id: "results",
      section: S.proof,
      title: { en: "Partners' results", ar: "نتايج شركائنا" },
      render: c => results(c),
    },
    ...ALL_STORIES.map(
      (s, i): SlideDef => ({
        id: s.id,
        section: S.proof,
        title: { en: s.company.en, ar: s.company.ar },
        deep: true,
        render: (c, on) => storySlide(s, i)(c, on),
      }),
    ),
    {
      // Left out for now (Aziz, 2026-10-07); kept so it can come back.
      id: "case",
      section: S.proof,
      title: { en: "$2M in 60 days", ar: "٢ مليون دولار بـ٦٠ يوم" },
      deep: true,
      hidden: true,
      render: (c, on) => caseStudy(c, on),
    },
    ...REVIEW_PAGES.map(
      (_, i): SlideDef => ({
        id: `reviews-${i + 1}`,
        section: S.proof,
        title: {
          en: `Google reviews, ${i + 1} of ${REVIEW_PAGES.length}`,
          ar: `تقييمات قوقل، ${arNum(i + 1)} من ${arNum(REVIEW_PAGES.length)}`,
        },
        render: c => reviewsSlide(i)(c),
      }),
    ),
    {
      id: "number-one",
      section: S.proof,
      title: { en: "The #1 partner", ar: "الشريك رقم ١" },
      deep: true,
      render: c => numberOneSlide(c),
    },
    {
      id: "content",
      section: S.proof,
      title: { en: "We teach the industry", ar: "نعلّم السوق" },
      stops: CONTENT_TOUR.length,
      render: (c, on) =>
        tourSlide({
          ctx: c,
          on,
          label: ar(c.lang)
            ? "نعطي للسوق كله"
            : "We give to the whole industry",
          title: ar(c.lang)
            ? "نفس الأنظمة اللي نشغلها لشركائنا.. نشرحها ببلاش."
            : "The systems we run for partners, explained for free.",
          stops: CONTENT_TOUR,
        }),
    },
    {
      id: "problem",
      section: S.you,
      title: { en: "Your biggest challenge", ar: "أكبر تحدي" },
      render: c => problemSlide(c),
    },
    {
      id: "numbers",
      section: S.you,
      title: { en: "Your numbers", ar: "أرقامك" },
      render: c => numbersSlide(c),
    },
    {
      id: "who",
      section: S.system,
      title: { en: "Who we work with", ar: "مع منو نشتغل" },
      render: c => whoSlide(c),
    },
    {
      id: "system",
      section: S.system,
      title: { en: "Project to Profit", ar: "Project to Profit" },
      railAll: true,
      render: c => systemSlide(c),
    },
    {
      id: "ads",
      section: S.system,
      title: { en: "1. Targeted premium ads", ar: "١. الإعلانات" },
      pillar: "ads",
      faq: "ads",
      stops: ADS_TOUR.length,
      render: (c, on) =>
        tourSlide({
          ctx: c,
          on,
          label: pillarLabel("ads", c.lang),
          title: ar(c.lang)
            ? "إعلانات يبنيها الذكاء الاصطناعي.. للمشاريع عالية القيمة"
            : "Ads engineered by AI, for premium projects",
          stops: ADS_TOUR,
          top: <Bridge ctx={c} pillar="ads" />,
        }),
    },
    {
      id: "filter",
      section: S.system,
      title: { en: "2. Lead filtration", ar: "٢. الفلترة" },
      pillar: "filter",
      faq: "filter",
      stops: JOURNEY.length,
      render: (c, on) =>
        journeySlide({
          ctx: c,
          on,
          label: pillarLabel("filter", c.lang),
          title: ar(c.lang)
            ? "رحلة العميل: من الإعلان لين الموعد"
            : "The journey: from the ad to a booked meeting",
          stops: JOURNEY,
          top: <Bridge ctx={c} pillar="filter" />,
        }),
    },
    {
      id: "speed",
      section: S.system,
      title: { en: "Why five minutes", ar: "ليش ٥ دقايق" },
      pillar: "sales",
      deep: true,
      render: c => speedSlide(c),
    },
    {
      id: "sales",
      section: S.system,
      title: { en: "3. The project sales team", ar: "٣. فريق المبيعات" },
      pillar: "sales",
      faq: "sales",
      stops: CALLS_TOUR.length,
      render: (c, on) =>
        tourSlide({
          ctx: c,
          on,
          label: pillarLabel("sales", c.lang),
          title: t(PILLARS[2].name, c.lang),
          stops: CALLS_TOUR,
          top: <Bridge ctx={c} pillar="sales" />,
        }),
    },
    {
      id: "closing",
      section: S.system,
      title: { en: "4. Closing mastery", ar: "٤. إقفال الصفقات" },
      pillar: "closing",
      faq: "closing",
      stops: CLOSING_TOUR.length,
      render: (c, on) =>
        tourSlide({
          ctx: c,
          on,
          label: pillarLabel("closing", c.lang),
          title: ar(c.lang)
            ? "إتقان توقيع المشاريع"
            : "Project Closing Mastery",
          stops: CLOSING_TOUR,
          top: <Bridge ctx={c} pillar="closing" />,
          note: closingGain(c),
        }),
    },
    {
      id: "portal",
      section: S.system,
      title: { en: "5. Your portal", ar: "٥. بوابتك" },
      pillar: "data",
      faq: "data",
      stops: PORTAL_TOUR.length,
      render: c => portalSlide(c),
    },
    {
      id: "phone",
      section: S.system,
      title: { en: "The portal on your phone", ar: "البوابة على تلفونك" },
      pillar: "data",
      deep: true,
      render: (c, on) => phoneSlide(c, on),
    },
    {
      id: "included",
      section: S.program,
      title: { en: "What's included", ar: "شنو يشمل" },
      railAll: true,
      render: c => includedSlide(c),
    },
    {
      id: "timeline",
      section: S.program,
      title: { en: "The first 90 days", ar: "أول ٩٠ يوم" },
      railAll: true,
      render: c => timelineSlide(c),
    },
    {
      id: "budget",
      section: S.program,
      title: { en: "The ad budget", ar: "ميزانية الإعلانات" },
      railAll: true,
      render: c => budgetSlide(c),
    },
    {
      id: "investment",
      section: S.program,
      title: { en: "The investment", ar: "الاستثمار" },
      railAll: true,
      render: c => investmentSlide(c),
    },
    {
      id: "next",
      section: S.program,
      title: { en: "Next steps", ar: "الخطوات الياية" },
      railAll: true,
      render: c => nextSlide(c),
    },
    {
      // Our own numbers, at the end (Aziz, 2026-10-08).
      id: "channels",
      section: S.program,
      title: { en: "Our channels", ar: "قنواتنا" },
      railAll: true,
      render: c => channelsSlide(c),
    },
    {
      id: "close",
      section: S.program,
      title: { en: "Close", ar: "الختام" },
      noRail: true,
      deep: true,
      render: c => closeSlide(c),
    },
  ];
  return all.filter(slide => !slide.hidden);
}
