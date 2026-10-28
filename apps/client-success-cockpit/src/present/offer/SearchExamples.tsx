import { ArrowUpRight, MapPin, MessageCircle, Search } from "lucide-react";
import { useState } from "react";
import { digits } from "../content";
import type { SlideCtx, SlideDef } from "../deckContext";
import chatgptCapture from "./art/search/chatgpt-search.png";
import profileCapture from "./art/search/google-business-profile.jpg";
import googleCapture from "./art/search/google-web-search.png";
import { offerCopy } from "./useOffer";
import "./searchExamples.css";

export const SEARCH_CAPTURES = {
  google: {
    src: googleCapture,
    name: "Google",
    tab: "Google",
    icon: Search,
    shape: "screen",
    url: "https://www.google.com/search?q=interior+design+company+Dubai&hl=en&udm=14",
  },
  profile: {
    src: profileCapture,
    name: "Google Business Profile",
    tab: "Business Profile",
    icon: MapPin,
    shape: "profile",
    url: "https://www.google.com/search?q=Decoria+Riyadh",
  },
  chatgpt: {
    src: chatgptCapture,
    name: "ChatGPT",
    tab: "ChatGPT",
    icon: MessageCircle,
    shape: "screen",
    url: "https://chatgpt.com/",
  },
} as const;
export const SEARCH_STAGES = ["google", "profile", "chatgpt"] as const;
const COPY = {
  en: {
    title: "Two ways clients find you",
    eyebrow: "A real search, in Dubai",
    google: "A list of places to explore.",
    chatgpt: "An answer with sources to follow.",
    explain:
      "Clear service pages and useful answers give both channels something to find and reference.",
    note: "Real captures · 28 Oct 2026 · Example only, not a Mahara client result or a ranking promise.",
    source: "Open source",
    alt: "Real search example for interior design companies in Dubai",
  },
  ar: {
    title: "طريقتان ليجدك العملاء",
    eyebrow: "بحث حقيقي في دبي",
    google: "نتائج يمكن للعميل تصفحها.",
    chatgpt: "إجابة مع مصادر يمكنه الرجوع إليها.",
    explain:
      "صفحات الخدمات الواضحة والإجابات المفيدة تساعد القناتين على العثور على معلوماتكم والرجوع إليها.",
    note: "لقطات حقيقية · ٢٨ أكتوبر ٢٠٢٦ · مثال توضيحي، وليس نتيجة لعميل Mahara أو وعداً بترتيب معين.",
    source: "فتح المصدر",
    alt: "مثال بحث حقيقي عن شركات تصميم داخلي في دبي",
  },
};

/** Source pixels stay intact. A source change also resets a failed image. */
export function SearchCapture({
  channel,
  lang,
}: {
  channel: keyof typeof SEARCH_CAPTURES;
  lang: "en" | "ar";
}) {
  return (
    <CaptureFrame
      key={SEARCH_CAPTURES[channel].src}
      channel={channel}
      lang={lang}
    />
  );
}

function CaptureFrame({
  channel,
  lang,
}: {
  channel: keyof typeof SEARCH_CAPTURES;
  lang: "en" | "ar";
}) {
  const [failed, setFailed] = useState(false);
  const item = SEARCH_CAPTURES[channel];
  const Icon = item.icon;
  return (
    <div
      className="dse-capture-frame"
      data-shape={item.shape}
      data-capture-state={failed ? "unavailable" : "image"}
    >
      {failed ? (
        <a
          className="dse-capture-fallback"
          href={item.url}
          target="_blank"
          rel="noreferrer"
        >
          <Icon aria-hidden="true" />
          <span>{COPY[lang].source}</span>
          <span dir="ltr">{item.name}</span>
          <ArrowUpRight aria-hidden="true" />
        </a>
      ) : (
        <img
          className="dse-capture"
          src={item.src}
          alt={
            channel === "profile"
              ? "Decoria: Google Business Profile"
              : `${item.name}: ${COPY[lang].alt}`
          }
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

export function SearchExamples({ ctx }: { ctx: SlideCtx }) {
  const active = Math.max(0, Math.min(ctx.tour, SEARCH_STAGES.length - 1));
  const channel = SEARCH_STAGES[active];
  const copy = COPY[ctx.lang];
  const selected = SEARCH_CAPTURES[channel];
  const profileText = ctx.offer
    ? offerCopy(ctx.offer, ctx.lang)?.get.find(item => item.key === "profile")
        ?.text
    : null;
  return (
    <section
      className="dko-slide dse-slide"
      dir={ctx.lang === "ar" ? "rtl" : "ltr"}
      data-still={ctx.still}
    >
      <header className="dko-slide-head">
        <span className="dko-eyebrow">
          {channel === "profile" ? selected.name : copy.eyebrow}
        </span>
        <h1>{copy.title}</h1>
      </header>
      <div className="dse-layout">
        <div className="dse-main">
          <div className="dse-switch" role="group" aria-label={copy.title}>
            {SEARCH_STAGES.map((key, index) => {
              const Icon = SEARCH_CAPTURES[key].icon;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={channel === key}
                  onClick={e => {
                    ctx.setTour(index);
                    if (e.detail > 0) e.currentTarget.blur();
                  }}
                >
                  <Icon aria-hidden="true" />
                  <span dir="ltr">{SEARCH_CAPTURES[key].tab}</span>
                </button>
              );
            })}
            <a href={selected.url} target="_blank" rel="noreferrer">
              {copy.source}
              <ArrowUpRight aria-hidden="true" />
            </a>
          </div>
          <div className="dse-screen" data-channel={channel}>
            <SearchCapture channel={channel} lang={ctx.lang} />
          </div>
          <div className="dse-source-bar">
            <span dir="ltr">
              {channel === "profile"
                ? "Decoria · Google Business Profile"
                : selected.name}
            </span>
            <span aria-hidden="true">
              {digits(String(active + 1).padStart(2, "0"), ctx.lang)} /{" "}
              {digits("03", ctx.lang)}
            </span>
          </div>
        </div>
        <aside>
          <span className="dse-channel" dir="ltr">
            {channel === "profile" ? "Google" : selected.name}
          </span>
          <div className="dse-explanation" key={channel}>
            <h2>
              {channel === "profile"
                ? profileText || selected.name
                : copy[channel]}
            </h2>
            <p>{copy.explain}</p>
          </div>
        </aside>
      </div>
      <p className="dse-note">{copy.note}</p>
    </section>
  );
}

export function searchExampleSlide(): SlideDef {
  return {
    id: "examples",
    title: { en: COPY.en.title, ar: COPY.ar.title },
    stops: () => SEARCH_STAGES.length,
    stopName: index => {
      const name =
        SEARCH_CAPTURES[
          SEARCH_STAGES[Math.max(0, Math.min(index, SEARCH_STAGES.length - 1))]
        ].name;
      return { en: name, ar: name };
    },
    defaultHidden: () => false,
    missing: () => [],
    notes: { say: [COPY.en.note], sayAr: [COPY.ar.note], push: [], pushAr: [] },
    render: ctx => <SearchExamples ctx={ctx} />,
  };
}
