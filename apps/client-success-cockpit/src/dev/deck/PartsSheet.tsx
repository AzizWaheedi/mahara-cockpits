/**
 * The pieces the launch deck reuses, drawn once on a canvas so they can be
 * looked at before that deck exists: the journey lanes (stop 3 and the fork
 * at stop 6, done for you and done with you), the mini rail, the green
 * light's large rail, the road strip and the three phones, in either
 * language (?view=parts&lang=ar).
 */

import "@/present/present.css";
import { useLayoutEffect, useState } from "react";
import { type Lang, SHARED, t } from "@/present/content";
import { creativeOf } from "@/present/creative";
import { JourneyLanes, MiniRail } from "@/present/JourneyLanes";
import {
  FbFeed,
  IgFeed,
  PhoneFigure,
  ReelStory,
} from "@/present/mockups/Phones";
import { RoadStrip } from "@/present/Road";
import { FIXTURES } from "./fixtures";

export function PartsSheet({ lang, sheet }: { lang: Lang; sheet: number }) {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () =>
      setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  const f = FIXTURES.full();
  const ads = f.ads.map(creativeOf);
  const who = { name: "Noor Studio Interiors", initials: "NS", logo: null };
  const props = { who, pageName: "Noor Studio", app: lang, deck: lang };
  const dir = lang === "ar" ? "rtl" : "ltr";
  return (
    <div className="dk-root">
      <div className="dk-stage">
        <div
          className="dk-canvas"
          dir={dir}
          lang={lang}
          style={{ transform: `translate(-50%, -50%) scale(${scale})` }}
        >
          <section
            className="dk-slide"
            data-slide={`parts-${sheet}`}
            data-stop="0"
          >
            {sheet === 0 ? (
              <div style={{ display: "flex", gap: 96 }}>
                <JourneyLanes
                  lang={lang}
                  current={5}
                  dwy={false}
                  fork
                  still
                  leaderTo={{ x: 760, y: 560 }}
                />
                <JourneyLanes lang={lang} current={5} dwy fork still />
              </div>
            ) : sheet === 1 ? (
              <div
                style={{ display: "flex", gap: 64, alignItems: "flex-start" }}
              >
                <PhoneFigure
                  height={760}
                  mark="instagram"
                  label={t(SHARED.frame.feed, lang)}
                >
                  <IgFeed creative={ads[0]} {...props} />
                </PhoneFigure>
                <PhoneFigure
                  height={760}
                  mark="instagram"
                  label={t(SHARED.frame.reels, lang)}
                >
                  <ReelStory creative={ads[0]} {...props} />
                </PhoneFigure>
                <PhoneFigure
                  height={760}
                  mark="facebook"
                  label={t(SHARED.frame.facebook, lang)}
                >
                  <FbFeed creative={null} {...props} />
                </PhoneFigure>
              </div>
            ) : (
              <div
                style={{ display: "flex", flexDirection: "column", gap: 80 }}
              >
                <MiniRail
                  lang={lang}
                  current={2}
                  dwy={false}
                  className=""
                  style={{ position: "relative" }}
                />
                <MiniRail
                  lang={lang}
                  current={0}
                  dwy={false}
                  all
                  scale={2.2}
                  className=""
                  style={{ position: "relative" }}
                />
                <RoadStrip now={4} />
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
