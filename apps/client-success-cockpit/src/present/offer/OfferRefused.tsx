import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { DeckModel } from "../useDeckModel";
import { isOfferDeck } from "./kinds";
import type { OfferModel } from "./useOffer";
export function OfferRefused({
  offer,
  model,
  clientUrl,
  presenting = false,
}: {
  offer: OfferModel;
  model: DeckModel;
  clientUrl: string;
  presenting?: boolean;
}) {
  const [words, setWords] = useState("");
  const [on, setOn] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [win, setWin] = useState("");
  if (presenting)
    return (
      <div className="dk-root">
        <div className="dk-closed">
          This presentation is not ready. Open the private prep window.
        </div>
      </div>
    );
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <a href={clientUrl} className="text-sm text-primary">
        Back to the client
      </a>
      <h1 className="text-2xl font-semibold">Start with the client</h1>
      <p className="text-muted-foreground">
        The offer is paused for these reasons. Resolve them first, or record
        what the client asked for.
      </p>
      <ul className="space-y-3">
        {offer.sources.gate.reasons.map(r => (
          <li className="rounded-lg border p-3" key={r.key}>
            {r.text}
          </li>
        ))}
      </ul>
      {offer.sources.gate.reasons.some(r => r.key === "no_win") ? (
        <section className="dko-panel">
          <h2>They've had a win</h2>
          <label className="dko-field">
            What happened?
            <textarea
              maxLength={200}
              value={win}
              onChange={e => setWin(e.target.value)}
            />
          </label>
          <label className="dko-field">
            When
            <input
              type="date"
              value={on}
              max={new Date().toISOString().slice(0, 10)}
              onChange={e => setOn(e.target.value)}
            />
          </label>
          <Button
            disabled={busy || win.trim().length < 3 || !offer.io}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await offer.io!.markWin(win, on);
                await model.reload();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Record the win
          </Button>
        </section>
      ) : null}
      <section className="dko-panel">
        <h2>The client asked about this offer</h2>
        <label className="dko-field">
          Their words
          <textarea
            maxLength={300}
            value={words}
            onChange={e => setWords(e.target.value)}
          />
        </label>
        <label className="dko-field">
          When
          <input
            type="date"
            value={on}
            max={new Date().toISOString().slice(0, 10)}
            onChange={e => setOn(e.target.value)}
          />
        </label>
        <Button
          disabled={busy || words.trim().length < 3 || !on}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              model.setPrep(
                model.data && isOfferDeck(model.data.deck)
                  ? model.data.deck
                  : "offer_website",
                { client_asked: { words: words.trim(), on } },
                true,
              );
              await model.flush();
              await model.reload();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "Save their request and reopen"}
        </Button>
        {error ? (
          <p role="alert">{error}</p>
        ) : model.save.kind === "error" ? (
          <p role="alert">{model.save.message}</p>
        ) : null}
        <p className="dko-help">
          Their request is dated and logged. The original reasons stay in the
          record.
        </p>
      </section>
    </main>
  );
}
