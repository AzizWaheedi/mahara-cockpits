import { Camera, FileText, Play, Search, UserRound } from "lucide-react";
import { ART } from "./art";
import { actorPoster } from "./exampleMedia";
import type { OfferKey } from "./kinds";
import type { CatalogCopy } from "./sources";
import "./quickPitch.css";

/** Decorative service objects. Fictional images are never presented as client work. */
export function OfferCover({
  offer,
  copy,
}: {
  offer: OfferKey;
  copy: CatalogCopy | null;
}) {
  const art = ART.website!;
  const photo = (i: number) =>
    i === 0 ? art.hero! : art.backgrounds[(i - 1) % art.backgrounds.length].url;
  return (
    <div
      className={`dkq-cover dkq-cover-${offer}`}
      aria-hidden="true"
      data-offer-cover={offer}
    >
      {offer === "website" ? (
        <div className="dkq-browser">
          <div className="dkq-browser-bar">
            <i />
            <i />
            <i />
          </div>
          <img src={photo(0)} alt="" />
          <div className="dkq-browser-work">
            {[1, 2, 3].map(i => (
              <img key={i} src={photo(i)} alt="" />
            ))}
          </div>
        </div>
      ) : null}
      {offer === "second_campaign" ? (
        <div className="dkq-branches">
          <i className="dkq-branch-line" />
          <div>
            <img src={photo(0)} alt="" />
            <span />
            <span />
          </div>
          <div>
            <img src={photo(2)} alt="" />
            <span />
            <span />
          </div>
        </div>
      ) : null}
      {offer === "seo_geo" ? (
        <div className="dkq-documents">
          {[0, 1, 2].map(i => (
            <div key={i}>
              <Search />
              <span />
              <span />
              <span />
              <b />
            </div>
          ))}
        </div>
      ) : null}
      {offer === "smm" ? (
        <div className="dkq-editorial">
          {[0, 1, 2, 3].map(i => (
            <div key={i}>
              <img src={photo(i)} alt="" />
              <span />
              <span />
            </div>
          ))}
        </div>
      ) : null}
      {offer === "cameraman" ? (
        <div className="dkq-viewfinder">
          <img src={photo(1)} alt="" />
          <i />
          <Camera />
          <div className="dkq-filmstrip">
            {[0, 2, 3].map(i => (
              <img key={i} src={photo(i)} alt="" />
            ))}
          </div>
        </div>
      ) : null}
      {offer === "ugc" ? (
        <div className="dkq-reels">
          {[0, 1, 2].map(i => {
            const poster = copy?.work[i] ? actorPoster(copy.work[i].url) : null;
            return (
              <div key={i}>
                {poster ? (
                  <img
                    src={poster}
                    alt=""
                    onError={e => {
                      e.currentTarget.hidden = true;
                    }}
                  />
                ) : (
                  <UserRound />
                )}
                <Play />
              </div>
            );
          })}
        </div>
      ) : null}
      {offer === "closer" ? (
        <div className="dkq-role-plan">
          <div>
            <UserRound />
            <i />
            <i />
          </div>
          <span />
          <div>
            <FileText />
            <i />
            <i />
          </div>
          <span />
          <div>
            <UserRound />
            <i />
            <i />
          </div>
        </div>
      ) : null}
    </div>
  );
}
