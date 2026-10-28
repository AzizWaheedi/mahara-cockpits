import {
  CalendarDays,
  Camera,
  Check,
  ClipboardList,
  FileText,
  Globe2,
  type LucideIcon,
  MessageCircle,
  Search,
  ShieldCheck,
  UserRound,
  Video,
} from "lucide-react";
import { useState } from "react";
import { digits } from "../content";
import type { SlideCtx } from "../deckContext";
import desktop from "./art/examples/joe-and-sera-desktop.webp";
import mobile from "./art/examples/joe-and-sera-mobile.webp";
import { OFFER_CHROME } from "./content/shared";
import { actorPoster } from "./exampleMedia";
import { isOfferDeck, type OfferKey, offerOfDeck } from "./kinds";
import { SEARCH_CAPTURES } from "./SearchExamples";
import type { CatalogCopy } from "./sources";
import { visualPhoto } from "./visualArt";

const stepIcons = {
  content: ClipboardList,
  build: Globe2,
  live: Globe2,
  care: ShieldCheck,
  agree: MessageCircle,
  make: FileText,
  approve: Check,
  check: Search,
  fix: Globe2,
  write: FileText,
  report: ClipboardList,
  keep: ShieldCheck,
  post: Video,
  review: MessageCircle,
  pick: CalendarDays,
  film: Camera,
  use: Video,
  script: FileText,
  recruit: UserRound,
  train: FileText,
  month_one: CalendarDays,
  manage: MessageCircle,
};

/** Existing evidence only. A reference never becomes a promised client result. */
export function journeyEvidence(
  copy: CatalogCopy,
  ctx: SlideCtx,
  active: number,
) {
  const kind = isOfferDeck(ctx.deck) ? offerOfDeck(ctx.deck) : "website";
  const step = copy.steps[active]?.key;
  if (kind === "website")
    return {
      src: step === "live" ? mobile : desktop,
      label: "Joe & Sera",
      shape: step === "live" ? "portrait" : "screen",
      example: true,
    };
  if (kind === "seo_geo") {
    const source = SEARCH_CAPTURES[step === "write" ? "chatgpt" : "google"];
    return {
      src: source.src,
      label: source.name,
      shape: "screen",
      example: true,
    };
  }
  if (kind === "ugc") {
    const portraits = copy.work.flatMap(item => {
      const src = actorPoster(item.url);
      return src ? [{ src, label: item.label }] : [];
    });
    const portrait = portraits[active % (portraits.length || 1)];
    if (portrait) return { ...portrait, shape: "portrait", example: true };
  }
  const own = ctx.offer?.stills?.filter(still => !!still.url) ?? [];
  if (
    own.length &&
    (kind === "second_campaign" || kind === "smm" || kind === "cameraman")
  )
    return {
      src: own[active % own.length].url!,
      label: ctx.d.name,
      shape: "photo",
      example: true,
    };
  if (kind === "second_campaign" || kind === "smm" || kind === "cameraman")
    return {
      src: visualPhoto(kind, active),
      label: copy.name,
      shape: kind === "smm" ? "portrait" : "photo",
      example: true,
    };
  return null;
}

/** Keyed by source so a new image gets a fresh attempt without retaining an old failure. */
function JourneyEvidenceFrame({
  evidence,
  kind,
  icon: FocusIcon,
  stepKey,
  number,
  lang,
}: {
  evidence: ReturnType<typeof journeyEvidence>;
  kind: OfferKey;
  icon: LucideIcon;
  stepKey: string | undefined;
  number: string;
  lang: "en" | "ar";
}) {
  const [failed, setFailed] = useState(false);
  const shown = failed ? null : evidence;
  return (
    <>
      <div
        className="dko-journey-evidence"
        data-evidence-state={
          failed ? "unavailable" : shown ? "image" : "diagram"
        }
      >
        {shown ? (
          <div className="dko-journey-picture" data-shape={shown.shape}>
            <img
              src={shown.src}
              alt={shown.label}
              decoding="async"
              onError={() => setFailed(true)}
            />
            {kind === "cameraman" ? (
              <span className="dko-journey-viewfinder" aria-hidden="true">
                <i />
                <i />
              </span>
            ) : null}
            {kind === "second_campaign" ? (
              <span className="dko-journey-form" aria-hidden="true">
                <FileText />
                <i />
                <i />
                <i />
              </span>
            ) : null}
          </div>
        ) : (
          <div className="dko-journey-role" aria-hidden="true">
            <span>
              <UserRound />
            </span>
            <i />
            <span key={stepKey}>
              <FocusIcon />
            </span>
            <i />
            <span>
              <MessageCircle />
            </span>
          </div>
        )}
        <span className="dko-journey-focus" key={stepKey} aria-hidden="true">
          <FocusIcon />
          <strong>{number}</strong>
        </span>
      </div>
      <div className="dko-journey-evidence-caption">
        <span>
          {shown?.example
            ? OFFER_CHROME.example[lang].split(/[,،]/)[0]
            : (shown?.label ?? OFFER_CHROME.example[lang].split(/[,،]/)[0])}
        </span>
        {shown?.example ? <span dir="auto">{shown.label}</span> : null}
      </div>
    </>
  );
}

/** The whole path stays in place while the presenter focuses one delivery step. */
export function OfferJourneyScene({
  copy,
  ctx,
  active,
}: {
  copy: CatalogCopy;
  ctx: SlideCtx;
  active: number;
}) {
  const kind = isOfferDeck(ctx.deck) ? offerOfDeck(ctx.deck) : "website";
  const evidence = journeyEvidence(copy, ctx, active);
  const step = copy.steps[active];
  const FocusIcon = stepIcons[step?.key as keyof typeof stepIcons] ?? FileText;
  const number = (i: number) =>
    digits(String(i + 1).padStart(2, "0"), ctx.lang);
  return (
    <div
      className="dko-journey-scene"
      data-evidence={evidence?.shape ?? "diagram"}
      data-service={kind}
    >
      <div className="dko-journey-scene-head">
        <span>{copy.name}</span>
        <span className="dko-journey-counter" aria-hidden="true">
          <strong>{number(active)}</strong>
          <span>/ {number(copy.steps.length - 1)}</span>
        </span>
      </div>
      <div className="dko-journey-map" aria-hidden="true">
        {copy.steps.map((item, i) => {
          const Icon =
            stepIcons[item.key as keyof typeof stepIcons] ?? FileText;
          return (
            <div
              className="dko-journey-node"
              key={item.key}
              data-current={i === active}
              data-reached={i <= active}
            >
              <span>
                <Icon />
              </span>
              <small>{number(i)}</small>
            </div>
          );
        })}
      </div>
      <JourneyEvidenceFrame
        key={evidence?.src ?? "diagram"}
        evidence={evidence}
        kind={kind}
        icon={FocusIcon}
        stepKey={step?.key}
        number={number(active)}
        lang={ctx.lang}
      />
      <div className="dko-journey-track" aria-hidden="true">
        {copy.steps.map((item, i) => (
          <i key={item.key} data-reached={i <= active} />
        ))}
      </div>
    </div>
  );
}
