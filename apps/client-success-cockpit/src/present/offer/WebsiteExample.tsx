import { ArrowUpRight, Monitor, Smartphone } from "lucide-react";
import { useState } from "react";
import { digits, tf } from "../content";
import type { SlideCtx, SlideDef } from "../deckContext";
import desktop from "./art/examples/joe-and-sera-desktop.webp";
import mobile from "./art/examples/joe-and-sera-mobile.webp";
import { OFFER_CHROME as C } from "./content/shared";
import "./visualStories.css";

/** User-selected public reference. No claim about authorship or business results. */
export function WebsiteExample({ ctx }: { ctx: SlideCtx }) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  return (
    <section
      className="dko-slide dsv-example-slide"
      dir={ctx.lang === "ar" ? "rtl" : "ltr"}
      data-still={ctx.still}
    >
      <header className="dko-slide-head">
        <span className="dko-eyebrow">
          {C.example[ctx.lang].split(/[,،]/)[0]}
        </span>
        <h1>Joe &amp; Sera</h1>
      </header>
      <div className="dsv-real-example" data-device={device}>
        <div className="dsv-reference-desktop">
          <div className="dsv-reference-bar" dir="ltr">
            <i />
            <i />
            <i />
            <span>joeandsera.com</span>
          </div>
          <img src={desktop} alt="joeandsera.com · 1440 × 1000" />
        </div>
        <div className="dsv-reference-mobile">
          <div className="dsv-mobile-notch" aria-hidden />
          <img src={mobile} alt="joeandsera.com · 390 × 844" />
        </div>
      </div>
      <footer className="dsv-example-footer">
        <span>
          {tf(C.captured, ctx.lang, { date: digits("2026-10-27", ctx.lang) })}
        </span>
        <div className="dsv-device-picker">
          <button
            type="button"
            aria-label="1440 × 1000"
            aria-pressed={device === "desktop"}
            onClick={() => setDevice("desktop")}
          >
            <Monitor aria-hidden />
            {digits("1440", ctx.lang)}
          </button>
          <button
            type="button"
            aria-label="390 × 844"
            aria-pressed={device === "mobile"}
            onClick={() => setDevice("mobile")}
          >
            <Smartphone aria-hidden />
            {digits("390", ctx.lang)}
          </button>
        </div>
        <a
          href="https://joeandsera.com/"
          target="_blank"
          rel="noopener noreferrer"
          dir="ltr"
        >
          joeandsera.com <ArrowUpRight aria-hidden />
        </a>
      </footer>
    </section>
  );
}
export function websiteExampleSlide(): SlideDef {
  return {
    id: "examples",
    title: { en: C.example.en.split(",")[0], ar: C.example.ar.split("،")[0] },
    stops: () => 1,
    defaultHidden: () => false,
    notes: {
      say: [
        "Show the user-selected Joe & Sera website reference. The images are dated public screenshots, not evidence of results or a promise to reproduce it. Open the source only when useful.",
      ],
      sayAr: [],
      push: [],
      pushAr: [],
    },
    render: ctx => <WebsiteExample ctx={ctx} />,
  };
}
