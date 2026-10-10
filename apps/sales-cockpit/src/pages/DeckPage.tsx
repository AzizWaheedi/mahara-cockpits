import "../deck/deck.css";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate, useSearchParams } from "react-router";
import { readPrefs } from "../components/ScriptParts";
import { numbersFromCall, USES_CALL_NUMBERS } from "../deck/callNumbers";
import {
  FAQS,
  type Lang,
  PILLARS,
  PROBLEMS,
  type ProblemKey,
  t,
} from "../deck/content";
import { FaqPanel, Rail, youtubePoster } from "../deck/parts";
import { PROOF_PHOTOS, YOUTUBE_VIDEOS } from "../deck/proof";
import { DECK_PHOTOS, type DeckCtx, deckSlides } from "../deck/slides";
import { PORTAL_TOUR } from "../deck/tour";
import { useLead, useQuery } from "../lib/data";
import {
  type Currency,
  currencyFor,
  funnel,
  isCurrency,
  readGiven,
  sayCount,
} from "../lib/funnel";
import { supabase } from "../lib/supabase";
import type { Me, Note } from "../lib/types";

/**
 * The pitch deck, presented from the cockpit (Aziz, 2026-09-27: "redo our
 * pitch deck ... go above and beyond ... still embed the testimonials").
 * The July brief's interactive deck in the company brand: bilingual, the
 * eight Wistia stories, a problem picker that lights the steps that answer
 * it, the prospect's own numbers from the call beside ours, the client
 * portal, a budget calculator, and the guarantee kept back until asked for.
 *
 * Opened from a demo (/deck?lead=<id>) it knows the prospect: their name on
 * the cover and their funnel from the call's notes. Keys: → ← or a clicker
 * to move, F full screen, L language, O all slides, Q questions, G the
 * guarantee on the investment slide, Esc back.
 */

const LANG_KEY = "sales_deck_lang";

function readLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === "en" || v === "ar") return v;
  } catch {
    // private window
  }
  return readPrefs().lang;
}

/** The prospect's answers from the call's saved notes: the demo over the intro. */
function useCallValues(contactId: string) {
  return useQuery<Record<string, string>>(async () => {
    if (!contactId) return { data: {}, error: null };
    const { data, error } = await supabase
      .from("cockpit_sales_notes")
      .select("fields,created_at")
      .eq("contact_id", contactId)
      .eq("kind", "script")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) return { data: null, error };
    const notes = (data ?? []) as Pick<Note, "fields" | "created_at">[];
    const of = (script: string) =>
      (
        notes.find(n => (n.fields as { script?: string }).script === script)
          ?.fields as { values?: Record<string, string> } | undefined
      )?.values ?? {};
    return { data: { ...of("intro"), ...of("demo") }, error: null };
  }, [contactId]);
}

export default function DeckPage({ me }: { me: Me }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const leadId = params.get("lead") ?? "";
  const lead = useLead(leadId);
  const callValues = useCallValues(leadId);

  const slides = useMemo(() => deckSlides(), []);
  const [index, setIndex] = useState(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    const at = slides.findIndex(s => s.id === id);
    return at >= 0 ? at : 0;
  });
  // ?lang=en or ?lang=ar opens the deck in that language (a link sent ahead).
  const [lang, setLang] = useState<Lang>(() => {
    const asked = params.get("lang");
    return asked === "en" || asked === "ar" ? asked : readLang();
  });
  const [problem, setProblem] = useState<ProblemKey | null>(null);
  const [faq, setFaq] = useState(false);
  const [overview, setOverview] = useState(false);
  const [guarantee, setGuarantee] = useState(false);
  const [budget, setBudget] = useState(1200);
  const [market, setMarket] = useState("KW");
  const [service, setService] = useState("interior");
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [typedCurrency, setTypedCurrency] = useState<Currency | null>(null);
  const [tour, setTour] = useState(0);
  const [scale, setScale] = useState(1);
  const [idle, setIdle] = useState(false);

  const slide = slides[Math.min(index, slides.length - 1)];

  // The call's notes, read again (see callNumbers.ts): when the deck comes
  // back into view, once more a moment later since the script saves as its
  // tab is left, and when a slide that uses the numbers comes up.
  const rereadCall = callValues.reload;
  useEffect(() => {
    if (!leadId) return;
    let later = 0;
    const back = () => {
      if (document.visibilityState !== "visible") return;
      rereadCall();
      window.clearTimeout(later);
      later = window.setTimeout(rereadCall, 2500);
    };
    document.addEventListener("visibilitychange", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
      window.clearTimeout(later);
    };
  }, [leadId, rereadCall]);
  const usesNumbers = (USES_CALL_NUMBERS as readonly string[]).includes(
    slide.id,
  );
  useEffect(() => {
    if (leadId && usesNumbers) rereadCall();
  }, [leadId, usesNumbers, rereadCall]);

  // The prospect's numbers: from the call when it saved them, else typed here.
  const saved = callValues.data ?? {};
  const fromCall = numbersFromCall(saved, typed);
  const values = fromCall ? saved : { ...saved, ...typed };
  const currency: Currency =
    typedCurrency ??
    (isCurrency(values.currency)
      ? values.currency
      : currencyFor(lead.data?.country));
  const f = useMemo(
    () => funnel(readGiven(values), currency),
    [values, currency],
  );

  // A market from the lead's country, once, for the platform picks.
  useEffect(() => {
    const c = String(lead.data?.country ?? "").toUpperCase();
    if (["KW", "SA", "AE", "QA", "BH", "OM"].includes(c)) setMarket(c);
  }, [lead.data?.country]);

  const match = useMemo(
    () => PROBLEMS.find(p => p.key === problem)?.pillars ?? [],
    [problem],
  );

  const go = useCallback(
    (i: number) => {
      const next = Math.max(0, Math.min(slides.length - 1, i));
      setIndex(next);
      setTour(0);
      setFaq(false);
      setOverview(false);
    },
    [slides.length],
  );

  // → and ← walk a slide's own steps (the portal tour) before leaving it,
  // and coming back from the next slide lands on its last step.
  const step = useCallback(
    (dir: 1 | -1) => {
      const stops = slide.stops ?? 1;
      if (tour + dir >= 0 && tour + dir < stops) {
        setTour(tour + dir);
        return;
      }
      const target = index + dir;
      if (target < 0 || target >= slides.length) return;
      go(target);
      if (dir < 0) setTour((slides[target].stops ?? 1) - 1);
    },
    [slide, tour, index, slides, go],
  );

  // A link to a slide (#numbers) opens it, also when the deck is already open.
  useEffect(() => {
    const onHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      const at = slides.findIndex(s => s.id === id);
      if (at >= 0) {
        setIndex(at);
        setTour(0);
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [slides]);

  // The address carries the slide, so a link or a reload lands on it.
  useEffect(() => {
    const id = slides[index]?.id;
    if (id) window.history.replaceState(null, "", `#${id}`);
  }, [index, slides]);

  useLayoutEffect(() => {
    const fit = () =>
      setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // Every photo, portal screen and YouTube cover loads in the background once
  // the deck is up, so no slide waits on its picture in front of the prospect.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      for (const src of [
        ...DECK_PHOTOS,
        ...PROOF_PHOTOS,
        ...PORTAL_TOUR.flatMap(s => [s.src.en, s.src.ar]),
        ...YOUTUBE_VIDEOS.map(v => youtubePoster(v.id)),
      ]) {
        const img = new Image();
        img.decoding = "async";
        img.src = src;
      }
    }, 1200);
    return () => window.clearTimeout(timer);
  }, []);

  // The controls step aside while presenting; a move of the mouse brings them back.
  useEffect(() => {
    let timer = window.setTimeout(() => setIdle(true), 2500);
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), 2500);
    };
    window.addEventListener("mousemove", wake);
    window.addEventListener("touchstart", wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("touchstart", wake);
    };
  }, []);

  const toggleLang = useCallback(() => {
    setLang(l => {
      const next = l === "ar" ? "en" : "ar";
      try {
        localStorage.setItem(LANG_KEY, next);
      } catch {
        // it still switches, it just forgets
      }
      return next;
    });
  }, []);

  const fullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  }, []);

  const leave = useCallback(() => {
    navigate(leadId ? `/call/${leadId}?script=demo` : "/");
  }, [navigate, leadId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "SELECT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable);
      if (typing) {
        if (e.key === "Escape") el.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (
        k === "ArrowRight" ||
        k === "PageDown" ||
        (k === " " && el?.tagName !== "BUTTON")
      ) {
        e.preventDefault();
        step(1);
      } else if (k === "ArrowLeft" || k === "PageUp") {
        e.preventDefault();
        step(-1);
      } else if (k === "Home") go(0);
      else if (k === "End") go(slides.length - 1);
      else if (k === "f" || k === "F") fullscreen();
      else if (k === "l" || k === "L") toggleLang();
      else if (k === "o" || k === "O") setOverview(v => !v);
      else if ((k === "g" || k === "G") && slide.id === "investment")
        setGuarantee(v => !v);
      else if ((k === "q" || k === "Q" || k === "?") && slide.faq)
        setFaq(v => !v);
      else if (k === "Escape") {
        if (faq) setFaq(false);
        else if (overview) setOverview(false);
        else if (!document.fullscreenElement) leave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    go,
    step,
    slides.length,
    fullscreen,
    toggleLang,
    slide,
    faq,
    overview,
    leave,
  ]);

  // A swipe on a tablet moves a slide.
  const [touchX, setTouchX] = useState<number | null>(null);

  const ctx: DeckCtx = {
    lang,
    problem,
    setProblem,
    match,
    leadName: lead.data?.name?.trim() || null,
    presenter: (me.name ?? "").split(/\s+/)[0] || null,
    numbers: {
      values,
      set: (key, value) => setTyped(v => ({ ...v, [key]: value })),
      currency,
      setCurrency: c => setTypedCurrency(c),
      fromCall,
      funnel: f,
    },
    guarantee,
    setGuarantee,
    budget,
    setBudget,
    market,
    setMarket,
    service,
    setService,
    tour,
    setTour,
  };

  const dir = lang === "ar" ? "rtl" : "ltr";
  const faqs = slide.faq ? FAQS[slide.faq] : null;
  const pillarName = slide.faq
    ? PILLARS.find(p => p.key === slide.faq)?.name
    : null;

  return (
    <div
      className="dk-root"
      data-idle={idle && !overview ? "" : undefined}
      onTouchStart={e => setTouchX(e.touches[0]?.clientX ?? null)}
      onTouchEnd={e => {
        const end = e.changedTouches[0]?.clientX ?? null;
        if (touchX == null || end == null) return;
        const dx = end - touchX;
        if (Math.abs(dx) > 70) step(dx < 0 ? 1 : -1);
        setTouchX(null);
      }}
    >
      <div className="dk-stage">
        <div
          className="dk-canvas"
          dir={dir}
          lang={lang}
          style={{ transform: `translate(-50%, -50%) scale(${scale})` }}
        >
          <section
            key={`${slide.id}-${lang}`}
            className={`dk-slide${slide.deep ? " dk-deep" : ""}${slide.noRail ? " dk-norail" : ""}`}
            data-active=""
            aria-roledescription="slide"
            aria-label={t(slide.title, lang)}
          >
            {slide.render(ctx, true)}
          </section>
          {slide.noRail ? null : (
            <>
              <Rail
                lang={lang}
                now={slide.pillar ?? null}
                all={slide.railAll}
                match={match}
              />
              <span className="dk-count" aria-hidden>
                {lang === "ar"
                  ? `${sayCount(index + 1, lang)} / ${sayCount(slides.length, lang)}`
                  : `${String(index + 1).padStart(2, "0")} / ${slides.length}`}
              </span>
            </>
          )}
          {faqs && faq ? (
            <FaqPanel
              lang={lang}
              title={pillarName ? t(pillarName, lang) : ""}
              faqs={faqs}
              onClose={() => setFaq(false)}
            />
          ) : null}
        </div>
      </div>

      <div className="dk-chrome" style={{ top: 14, left: 14 }}>
        <button type="button" onClick={leave}>
          {leadId ? "Back to the call" : "Leave"}
        </button>
      </div>
      <div className="dk-chrome" style={{ top: 14, right: 14 }}>
        {faqs ? (
          <button
            type="button"
            onClick={() => setFaq(v => !v)}
            aria-pressed={faq}
            title="Q"
          >
            Questions
          </button>
        ) : null}
        <button
          type="button"
          aria-pressed={lang === "ar"}
          onClick={() => lang !== "ar" && toggleLang()}
        >
          ع
        </button>
        <button
          type="button"
          aria-pressed={lang === "en"}
          onClick={() => lang !== "en" && toggleLang()}
        >
          EN
        </button>
        <button
          type="button"
          onClick={() => setOverview(v => !v)}
          aria-pressed={overview}
        >
          All slides
        </button>
        <button type="button" onClick={fullscreen}>
          Full screen
        </button>
      </div>
      <div className="dk-chrome dk-nav">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={index === 0}
          aria-label="Previous slide"
        >
          ←
        </button>
        <span
          style={{
            fontSize: 13,
            color: "rgba(242,246,250,.7)",
            padding: "0 8px",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {sayCount(index + 1, lang)} / {sayCount(slides.length, lang)}
        </span>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={index === slides.length - 1}
          aria-label="Next slide"
        >
          →
        </button>
      </div>

      {overview ? (
        <div className="dk-overview" role="dialog" aria-label="All slides">
          <div style={{ maxWidth: 1180, margin: "0 auto" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                marginBottom: 28,
              }}
            >
              <p style={{ flex: 1, fontSize: 20, fontWeight: 600 }}>
                All slides
              </p>
              <p style={{ fontSize: 13, color: "rgba(242,246,250,.55)" }}>
                → ← move · F full screen · L language · Q questions · G
                guarantee · Esc back
              </p>
            </div>
            {[...new Set(slides.map(s => s.section.en))].map(sec => (
              <div key={sec} style={{ marginBottom: 28 }}>
                <p style={{ fontSize: 13, color: "#00cfc8", marginBottom: 10 }}>
                  {t(
                    slides.find(s => s.section.en === sec)?.section ?? {
                      en: sec,
                      ar: sec,
                    },
                    lang,
                  )}
                </p>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(220px, 1fr))",
                    gap: 10,
                  }}
                >
                  {slides.map((s, i) =>
                    s.section.en === sec ? (
                      <button
                        key={s.id}
                        type="button"
                        aria-current={i === index}
                        onClick={() => go(i)}
                        dir={dir}
                      >
                        <span className="dk-overview-n">
                          {sayCount(i + 1, lang)}
                        </span>
                        {t(s.title, lang)}
                      </button>
                    ) : null,
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
