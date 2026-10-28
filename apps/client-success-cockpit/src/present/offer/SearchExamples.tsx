import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import type { SlideCtx, SlideDef } from "../deckContext";
import chatgptCapture from "./art/search/chatgpt-search.png";
import googleCapture from "./art/search/google-web-search.png";
import "./searchExamples.css";

export const SEARCH_CAPTURES = {
  google: {
    src: googleCapture,
    name: "Google",
    url: "https://www.google.com/search?q=interior+design+company+Dubai&hl=en&udm=14",
  },
  chatgpt: {
    src: chatgptCapture,
    name: "ChatGPT",
    url: "https://chatgpt.com/",
  },
} as const;
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

/** Source pixels stay intact. Only the surrounding explanation is translated. */
export function SearchCapture({
  channel,
  lang,
}: {
  channel: keyof typeof SEARCH_CAPTURES;
  lang: "en" | "ar";
}) {
  const item = SEARCH_CAPTURES[channel];
  return (
    <img
      className="dse-capture"
      src={item.src}
      alt={`${item.name}: ${COPY[lang].alt}`}
      decoding="async"
    />
  );
}

export function SearchExamples({ ctx }: { ctx: SlideCtx }) {
  const [channel, setChannel] =
    useState<keyof typeof SEARCH_CAPTURES>("google");
  const copy = COPY[ctx.lang];
  const selected = SEARCH_CAPTURES[channel];
  return (
    <section
      className="dko-slide dse-slide"
      dir={ctx.lang === "ar" ? "rtl" : "ltr"}
      data-still={ctx.still}
    >
      <header className="dko-slide-head">
        <span className="dko-eyebrow">{copy.eyebrow}</span>
        <h1>{copy.title}</h1>
      </header>
      <div className="dse-layout">
        <div className="dse-main">
          <div className="dse-switch" role="group" aria-label={copy.title}>
            {(["google", "chatgpt"] as const).map(key => (
              <button
                key={key}
                type="button"
                aria-pressed={channel === key}
                onClick={e => {
                  setChannel(key);
                  if (e.detail > 0) e.currentTarget.blur();
                }}
              >
                {SEARCH_CAPTURES[key].name}
              </button>
            ))}
            <a href={selected.url} target="_blank" rel="noreferrer">
              {copy.source}
              <ArrowUpRight aria-hidden />
            </a>
          </div>
          <div className="dse-screen" key={channel}>
            <SearchCapture channel={channel} lang={ctx.lang} />
          </div>
        </div>
        <aside>
          <span className="dse-channel">{selected.name}</span>
          <h2>{copy[channel]}</h2>
          <p>{copy.explain}</p>
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
    stops: () => 1,
    defaultHidden: () => false,
    missing: () => [],
    notes: { say: [COPY.en.note], sayAr: [COPY.ar.note], push: [], pushAr: [] },
    render: ctx => <SearchExamples ctx={ctx} />,
  };
}
