import {
  ArrowUpRight,
  Camera,
  FileText,
  Globe2,
  Layers,
  MessageCircle,
  Search,
  ShieldCheck,
  UserRound,
  Video,
} from "lucide-react";
import { digits } from "../content";
import type { SlideCtx } from "../deckContext";
import { SearchCapture } from "./SearchExamples";
import type { ServiceOffer } from "./serviceDeck";
import type { CatalogCopy } from "./sources";
import { visualPhoto } from "./visualArt";
import "./visualStories.css";

type Props = {
  kind: Exclude<ServiceOffer, "ugc">;
  copy: CatalogCopy;
  ctx: SlideCtx;
  active: number;
};
const sceneIcons = [
  Layers,
  FileText,
  MessageCircle,
  Globe2,
  Video,
  ShieldCheck,
  Search,
];

/** These are interactive illustrations, not analytics or connected provider controls. */
export function ScopeVisual({ kind, copy, ctx, active }: Props) {
  const index = Math.max(0, Math.min(active, copy.get.length - 1));
  const item = copy.get[index];
  const FocusIcon = sceneIcons[index % sceneIcons.length];
  const own = ctx.offer?.stills?.filter(s => !!s.url) ?? [];
  const photo = (i: number) =>
    own.length ? own[i % own.length].url! : visualPhoto(kind, i);
  const select = (i: number) => ctx.setTour(i + 1);
  const numbered = (i: number) =>
    digits(String(i + 1).padStart(2, "0"), ctx.lang);
  const stepButtons = (className: string) => (
    <div className={className}>
      {copy.get.map((v, i) => (
        <button
          key={v.key}
          type="button"
          aria-label={v.text}
          aria-pressed={active >= 0 && active < copy.get.length && i === index}
          onClick={e => {
            e.stopPropagation();
            select(i);
          }}
        >
          {numbered(i)}
        </button>
      ))}
    </div>
  );
  return (
    <div
      className={`dsv-scene dsv-${kind}`}
      data-demo={kind}
      data-still={ctx.still}
      data-selected={item?.key}
    >
      <div className="dsv-instrument-bar">
        <span>{copy.name}</span>
        <span aria-hidden>
          {numbered(index)} /{" "}
          {digits(String(copy.get.length).padStart(2, "0"), ctx.lang)}
        </span>
      </div>
      {kind === "second_campaign" ? (
        <>
          <div className="dsv-campaign-art" aria-hidden>
            <div className="dsv-ad dsv-ad-existing">
              <img src={photo(0)} alt="" />
              <div>
                <i />
                <i />
              </div>
              <span>{numbered(0)}</span>
            </div>
            <svg
              aria-hidden="true"
              className="dsv-connectors"
              viewBox="0 0 800 400"
              preserveAspectRatio="none"
            >
              <path d="M190 95H415Q445 95 445 125V200H570M190 305H415Q445 305 445 275V200" />
            </svg>
            <div
              className="dsv-ad dsv-ad-next"
              data-focus={index === 0 || index === 2}
            >
              <img key={index === 2 ? "copy" : "ad"} src={photo(2)} alt="" />
              <div>
                <i />
                <i />
              </div>
              <span>{numbered(1)}</span>
            </div>
            <div className="dsv-enquiry" data-focus={index === 1}>
              <FileText />
              <div className="dsv-form-lines">
                <i />
                <i />
                <i />
              </div>
              <ArrowUpRight />
            </div>
          </div>
          {stepButtons("dsv-step-dock")}
        </>
      ) : null}
      {kind === "seo_geo" ? (
        <>
          <div className="dse-scope-capture">
            <SearchCapture
              channel={index === 4 ? "chatgpt" : "google"}
              lang={ctx.lang}
            />
          </div>
          <p className="dse-scope-caption">
            {ctx.lang === "en"
              ? "Real example · 28 Oct 2026 · Not a client result"
              : "مثال حقيقي · ٢٨ أكتوبر ٢٠٢٦ · ليس نتيجة لعميل"}
          </p>
          {stepButtons("dsv-step-dock")}
        </>
      ) : null}
      {kind === "smm" ? (
        <div className="dsv-content-studio">
          <div className="dsv-phone-preview">
            <div className="dsv-phone-speaker" aria-hidden />
            <div className="dsv-phone-photo" key={item?.key}>
              <img src={photo(index)} alt="" />
              {index === 2 || index === 4 ? <Video aria-hidden /> : null}
              <div className="dsv-phone-caption">
                <span>{ctx.d.name}</span>
                <i />
                <i />
              </div>
            </div>
            <div className="dsv-phone-home" aria-hidden />
          </div>
          <div className="dsv-content-shelf">
            <div className="dsv-platform-list">
              {Object.values(copy.platforms ?? {}).map(p => (
                <span key={p}>{p}</span>
              ))}
            </div>
            <div className="dsv-post-grid">
              {copy.get.map((v, i) => (
                <button
                  key={v.key}
                  type="button"
                  aria-label={v.text}
                  aria-pressed={
                    active >= 0 && active < copy.get.length && i === index
                  }
                  onClick={e => {
                    e.stopPropagation();
                    select(i);
                  }}
                >
                  <img src={photo(i)} alt="" />
                  <span>{numbered(i)}</span>
                  {i === 4 ? <Video aria-hidden /> : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {kind === "cameraman" ? (
        <>
          <div className="dsv-film-frame" key={item?.key}>
            <img src={photo(index)} alt="" />
            <div className="dsv-thirds" aria-hidden>
              <i />
              <i />
            </div>
            <div className="dsv-frame-edge" aria-hidden />
            <Camera aria-hidden />
            <span>{numbered(index)}</span>
          </div>
          <div className="dsv-filmstrip">
            {copy.get.map((v, i) => (
              <button
                key={v.key}
                type="button"
                aria-label={v.text}
                aria-pressed={
                  active >= 0 && active < copy.get.length && i === index
                }
                onClick={e => {
                  e.stopPropagation();
                  select(i);
                }}
              >
                <img src={photo(i)} alt="" />
                <span>{numbered(i)}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
      {kind === "closer" ? (
        <div className="dsv-role-studio">
          <div className="dsv-role-rail">
            {copy.get.map((v, i) => {
              const Icon = sceneIcons[i % sceneIcons.length];
              return (
                <button
                  key={v.key}
                  type="button"
                  aria-label={v.text}
                  aria-pressed={
                    active >= 0 && active < copy.get.length && i === index
                  }
                  onClick={e => {
                    e.stopPropagation();
                    select(i);
                  }}
                >
                  <Icon aria-hidden />
                  <span>{numbered(i)}</span>
                </button>
              );
            })}
          </div>
          <div className="dsv-role-document" key={item?.key}>
            <div className="dsv-document-head">
              <UserRound aria-hidden />
              <span>{copy.name}</span>
            </div>
            <span className="dsv-document-number" aria-hidden>
              {numbered(index)}
            </span>
            <div className="dsv-document-diagram" aria-hidden>
              <div>
                <FocusIcon />
              </div>
              <span />
              <div>
                <FileText />
              </div>
            </div>
            <div className="dsv-document-lines" aria-hidden>
              <i />
              <i />
              <i />
            </div>
            <div className="dsv-role-coaching" aria-hidden>
              <div>
                <UserRound />
              </div>
              <div>
                <MessageCircle />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
