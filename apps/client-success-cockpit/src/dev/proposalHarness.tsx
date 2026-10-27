import { StrictMode, useEffect, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import { ProposalBuilder } from "../pages/money/offers/proposal/ProposalBuilder";
import core from "../pages/money/offers/proposal/page/core.js?raw";
import css from "../pages/money/offers/proposal/page/offer.css?raw";
import strings from "../pages/money/offers/proposal/page/strings.js?raw";
import { proposalSrcdoc } from "../pages/money/offers/proposal/srcdoc";
import {
  fixtureProposalIO,
  fixturePublic,
  proposalFixture,
} from "./offer/proposalFixtures";
import "../index.css";

const query = new URLSearchParams(location.search);
const lang = query.get("lang") === "ar" ? "ar" : "en";
const fixture = query.get("fixture") || "full";
const state = query.get("state") || "draft";
const seed = proposalFixture(fixture, lang, state === "open");
function PageHarness() {
  const ref = useRef<HTMLIFrameElement>(null);
  const src = useMemo(() => {
    if (["draft", "open"].includes(state)) return proposalSrcdoc();
    const url = (s: string) =>
      `data:text/javascript;base64,${btoa(unescape(encodeURIComponent(s)))}`;
    const safeState = ["expired", "archived", "unknown"].includes(state)
      ? state
      : "unknown";
    return `<!doctype html><html lang="${lang}" dir="${lang === "ar" ? "rtl" : "ltr"}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap"><style>${css}</style></head><body><main id="app"></main><script type="module">import {stateView} from ${JSON.stringify(url(core))};import {STRINGS} from ${JSON.stringify(url(strings))};document.getElementById('app').innerHTML=stateView('${safeState}',STRINGS['${lang}'],null);</script></body></html>`;
  }, []);
  useEffect(() => {
    const send = (event: MessageEvent) => {
      if (
        event.source === ref.current?.contentWindow &&
        event.data?.type === "offer:ready"
      )
        ref.current?.contentWindow?.postMessage(
          { type: "offer:preview", proposal: fixturePublic(seed) },
          "*",
        );
    };
    window.addEventListener("message", send);
    return () => window.removeEventListener("message", send);
  }, []);
  return (
    <iframe
      ref={ref}
      title="Fictional client page"
      sandbox="allow-scripts"
      srcDoc={src}
      style={{ display: "block", border: 0, width: "100%", height: "100vh" }}
    />
  );
}
function Harness() {
  const io = useMemo(
    () => fixtureProposalIO(seed, query.get("mode") ?? ""),
    [],
  );
  if (query.get("view") === "page") return <PageHarness />;
  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <p className="mx-auto mb-6 max-w-[1440px] text-xs text-muted-foreground">
        FICTIONAL EXAMPLE · Changes stay in this preview. No client messages are
        sent.
      </p>
      <ProposalBuilder
        io={io}
        checkCustomVideo={async () => ({
          ok: false,
          refusal:
            "This video is private. Set it to anyone with the link, then check again.",
        })}
      />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
