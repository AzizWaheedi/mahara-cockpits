import { ArrowUpRight, Globe2, Monitor, Smartphone } from "lucide-react";
import { useState } from "react";
import { digits, tf } from "../content";
import type { SlideCtx, SlideDef } from "../deckContext";
import desktop from "./art/examples/joe-and-sera-desktop.webp";
import mobile from "./art/examples/joe-and-sera-mobile.webp";
import greystone from "./art/website/greystone-desktop.jpg";
import stratum from "./art/website/stratum-desktop.jpg";
import { OFFER_CHROME as C } from "./content/shared";
import "./visualStories.css";
import "./websiteExamples.css";

type ReferenceImage = { src: string; width: number; height: number };
export type WebsiteReference = {
  name: string;
  host: string;
  url: string;
  captured: string;
  desktop: ReferenceImage | null;
  mobile?: ReferenceImage;
};
export const WEBSITE_EXAMPLES: readonly WebsiteReference[] = [
  {
    name: "Joe & Sera",
    host: "joeandsera.com",
    url: "https://joeandsera.com/",
    captured: "2026-10-27",
    desktop: { src: desktop, width: 1440, height: 1000 },
    mobile: { src: mobile, width: 390, height: 844 },
  },
  {
    name: "Stratum",
    host: "stratum.framer.ai",
    url: "https://stratum.framer.ai/",
    captured: "2026-10-28",
    desktop: { src: stratum, width: 1470, height: 662 },
  },
  {
    name: "Greystone",
    host: "greystonegcc.com",
    url: "https://greystonegcc.com/",
    captured: "2026-10-28",
    desktop: { src: greystone, width: 1470, height: 662 },
  },
];

/** A missing or failed reference remains an honest source link, never a fabricated preview. */
export function WebsiteReferenceImage({
  image,
  site,
}: {
  image: ReferenceImage | null;
  site: WebsiteReference;
}) {
  return (
    <ReferenceImageFrame
      key={image?.src ?? "missing"}
      image={image}
      site={site}
    />
  );
}
function ReferenceImageFrame({
  image,
  site,
}: {
  image: ReferenceImage | null;
  site: WebsiteReference;
}) {
  const [failed, setFailed] = useState(false);
  if (!image || failed)
    return (
      <a
        className="dsv-reference-fallback"
        href={site.url}
        target="_blank"
        rel="noopener noreferrer"
        dir="ltr"
      >
        <Globe2 aria-hidden="true" />
        <span>{site.host}</span>
        <ArrowUpRight aria-hidden="true" />
      </a>
    );
  return (
    <img
      className="dsv-source-image"
      src={image.src}
      alt={`${site.host} · ${image.width} × ${image.height}`}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

function ReferenceThumbnail({ image }: { image: ReferenceImage | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="dsv-site-thumb" aria-hidden="true">
      {image && !failed ? (
        <img
          src={image.src}
          alt=""
          decoding="async"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <Globe2 />
      )}
    </span>
  );
}

/** User-selected public references. No claim about authorship or business results. */
export function WebsiteExample({ ctx }: { ctx: SlideCtx }) {
  const active = Math.max(0, Math.min(ctx.tour, WEBSITE_EXAMPLES.length - 1));
  const site = WEBSITE_EXAMPLES[active];
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const selectedDevice = site.mobile ? device : "desktop";
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
        <h1 dir="ltr">{site.name}</h1>
      </header>
      <div className="dsv-website-gallery">
        <div
          className="dsv-site-picker"
          role="group"
          aria-label={C.example[ctx.lang].split(/[,،]/)[0]}
        >
          {WEBSITE_EXAMPLES.map((item, index) => (
            <button
              key={item.url}
              type="button"
              aria-pressed={index === active}
              onClick={event => {
                ctx.setTour(index);
                if (event.detail > 0) event.currentTarget.blur();
              }}
            >
              <ReferenceThumbnail
                key={item.desktop?.src ?? item.url}
                image={item.desktop}
              />
              <span className="dsv-site-name" dir="ltr">
                {item.name}
              </span>
              <span className="dsv-site-host" dir="ltr">
                {item.host}
              </span>
            </button>
          ))}
        </div>
        <div
          className="dsv-real-example"
          data-device={selectedDevice}
          data-has-mobile={!!site.mobile}
          key={site.url}
        >
          <div className="dsv-reference-desktop">
            <div className="dsv-reference-bar" dir="ltr">
              <Monitor aria-hidden="true" />
              <span>{site.host}</span>
            </div>
            <WebsiteReferenceImage image={site.desktop} site={site} />
          </div>
          {site.mobile ? (
            <div className="dsv-reference-mobile">
              <div className="dsv-mobile-notch" aria-hidden="true" />
              <WebsiteReferenceImage image={site.mobile} site={site} />
            </div>
          ) : null}
        </div>
      </div>
      <footer className="dsv-example-footer">
        <span>
          {tf(C.captured, ctx.lang, { date: digits(site.captured, ctx.lang) })}
        </span>
        {site.mobile && site.desktop ? (
          <div className="dsv-device-picker">
            <button
              type="button"
              aria-label={`${site.desktop.width} × ${site.desktop.height}`}
              aria-pressed={device === "desktop"}
              onClick={event => {
                setDevice("desktop");
                if (event.detail > 0) event.currentTarget.blur();
              }}
            >
              <Monitor aria-hidden="true" />
              {digits(String(site.desktop.width), ctx.lang)}
            </button>
            <button
              type="button"
              aria-label={`${site.mobile.width} × ${site.mobile.height}`}
              aria-pressed={device === "mobile"}
              onClick={event => {
                setDevice("mobile");
                if (event.detail > 0) event.currentTarget.blur();
              }}
            >
              <Smartphone aria-hidden="true" />
              {digits(String(site.mobile.width), ctx.lang)}
            </button>
          </div>
        ) : (
          <span className="dsv-reference-size" dir="ltr">
            <Monitor aria-hidden="true" />
            {site.desktop
              ? digits(
                  `${site.desktop.width} × ${site.desktop.height}`,
                  ctx.lang,
                )
              : null}
          </span>
        )}
        <a href={site.url} target="_blank" rel="noopener noreferrer" dir="ltr">
          {site.host}
          <ArrowUpRight aria-hidden="true" />
        </a>
      </footer>
    </section>
  );
}
export function websiteExampleSlide(): SlideDef {
  return {
    id: "examples",
    title: { en: C.example.en.split(",")[0], ar: C.example.ar.split("،")[0] },
    stops: () => WEBSITE_EXAMPLES.length,
    stopName: index => {
      const name =
        WEBSITE_EXAMPLES[
          Math.max(0, Math.min(index, WEBSITE_EXAMPLES.length - 1))
        ].name;
      return { en: name, ar: name };
    },
    defaultHidden: () => false,
    notes: {
      say: [
        "Show the user-selected Joe & Sera, Stratum and Greystone website references. The images are dated public screenshots, not evidence of results or a promise to reproduce them. Open each source only when useful.",
      ],
      sayAr: [],
      push: [],
      pushAr: [],
    },
    render: ctx => <WebsiteExample ctx={ctx} />,
  };
}
