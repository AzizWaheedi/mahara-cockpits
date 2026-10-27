import {
  OFFER_KEYS,
  OFFER_NAMES,
  deckOfOffer,
  type OfferKey,
  type OfferDeckKind,
} from "../../../present/offer/kinds";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { checkVideo, type OfferClient } from "../../../present/offer/sources";
import {
  clearDeckVideo,
  type DeckVideos,
  readDeckVideos,
  saveDeckVideo,
} from "../../../present/sources";
export function OfferVideos({
  client,
  isCeo,
}: {
  client: OfferClient;
  isCeo: boolean;
}) {
  const [offer, setOffer] = useState<OfferKey>("website");
  const deck = deckOfOffer(offer);
  const [videos, setVideos] = useState<DeckVideos | null>(null),
    [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const currentScope = useRef({ client, deck });
  currentScope.current = { client, deck };
  const reload = useCallback(async () => {
    // A save from an unmounted offer field cannot refresh a different offer.
    const current = () =>
      currentScope.current.client === client &&
      currentScope.current.deck === deck;
    if (!current()) return;
    const id = ++request.current;
    setError(null);
    try {
      const next = await readDeckVideos(client, deck);
      if (id === request.current && current()) setVideos(next);
    } catch (e) {
      if (id === request.current && current())
        setError(e instanceof Error ? e.message : String(e));
    }
  }, [client, deck]);
  useEffect(() => {
    setVideos(null);
    void reload();
    return () => {
      request.current += 1;
    };
  }, [reload]);
  return (
    <section className="dko-panel">
      <h2>Offer videos</h2>
      <label className="dko-field">
        Offer
        <select
          value={offer}
          onChange={e => setOffer(e.target.value as OfferKey)}
        >
          {OFFER_KEYS.map(k => (
            <option key={k} value={k}>
              {OFFER_NAMES[k]}
            </option>
          ))}
        </select>
      </label>
      <p className="dko-help">
        The same video appears in the deck, recap and proposal. Only the CEO
        changes these links.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {videos ? (
        <div className="dko-fields">
          {(["en", "ar"] as const).map(lang => (
            <VideoField
              key={deck + lang}
              deck={deck}
              client={client}
              isCeo={isCeo}
              lang={lang}
              videos={videos}
              reload={reload}
            />
          ))}
        </div>
      ) : (
        <p className="dko-help">Reading recordings…</p>
      )}
    </section>
  );
}
function VideoField({
  deck,
  client,
  isCeo,
  lang,
  videos,
  reload,
}: {
  client: OfferClient;
  isCeo: boolean;
  lang: "en" | "ar";
  videos: DeckVideos;
  deck: OfferDeckKind;
  reload: () => Promise<void>;
}) {
  const row = videos.rows.find(
    v => v.deck === deck && v.slotKey === "demo" && v.lang === lang,
  );
  const [url, setUrl] = useState(row?.url ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(() => setUrl(row?.url ?? ""), [row?.url]);
  const act = async (clear = false) => {
    setBusy(true);
    setError(null);
    try {
      if (clear)
        await clearDeckVideo(client, {
          deck,
          slotKey: "demo",
          lang,
          revision: row?.revision ?? 0,
        });
      else {
        const checked = await checkVideo(client, url);
        if (!checked.ok)
          throw Error(
            checked.refusal ??
              "This video cannot be watched without signing in.",
          );
        await saveDeckVideo(client, {
          deck,
          slotKey: "demo",
          lang,
          url: checked.url ?? url,
          title: checked.title,
          durationSeconds: checked.durationSeconds,
          revision: row?.revision ?? 0,
        });
      }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <label className="dko-field">
        {lang === "en" ? "English" : "Arabic"}
        <input
          type="url"
          value={url}
          readOnly={!isCeo}
          placeholder="Not recorded yet"
          onChange={e => setUrl(e.target.value)}
        />
      </label>
      {row ? (
        <a
          href={row.url}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-primary underline"
        >
          Watch recording
        </a>
      ) : null}
      {isCeo ? (
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={busy || !url.trim()}
            onClick={() => void act()}
          >
            {busy ? "Checking…" : "Check and save"}
          </Button>
          {row ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void act(true)}
            >
              Clear
            </Button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm txt-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
