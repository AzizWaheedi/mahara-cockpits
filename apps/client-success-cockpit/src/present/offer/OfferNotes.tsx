import { useState } from "react";
import { Button } from "@/components/ui/button";
import { LogPitchDialog } from "../../pages/money/offers/LogPitchDialog";
import { fill } from "../content";
import type { DeckModel } from "../useDeckModel";
import type { OfferNotesCopy } from "./content/types";
import { WEBSITE_DECK as W } from "./content/website";
import { proposalNewUrl } from "./kinds";
import { formatMoney } from "./price";
import type { OfferModel } from "./useOffer";
export function OfferNotes({
  offer: m,
  model,
}: {
  offer: OfferModel | null | undefined;
  model: DeckModel;
}) {
  const [branch, setBranch] = useState("no_site"),
    [objection, setObjection] = useState("busy"),
    [lower, setLower] = useState<Record<string, string>>({}),
    [reason, setReason] = useState(""),
    [video, setVideo] = useState<string | null>(null),
    [next, setNext] = useState(""),
    [copied, setCopied] = useState(false),
    [error, setError] = useState<string | null>(null);
  if (!m) return null;
  const say = (v: OfferNotesCopy) =>
    model.lang === "ar" ? (m.dialect === "sa" ? v.saySa : v.sayKw) : v.say;
  const list = (v: OfferNotesCopy) => (
    <ul className="dko-notes-list" dir={model.lang === "ar" ? "rtl" : "ltr"}>
      {say(v).map(l => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  );
  const held = m.pitch?.heldFull === true;
  return (
    <div className="space-y-4" data-offer-notes>
      <section className="dko-panel">
        <h2>On this call</h2>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => model.hub.post({ type: "key", key: "h" })}
          >
            How it runs · H
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => model.hub.post({ type: "key", key: "v" })}
          >
            Play the video · V
          </Button>
        </div>
        <p className="dko-help">
          No cleared website proof is on file. The proof slide stays hidden.
        </p>
        <label className="dko-field">
          Their answer
          <select value={branch} onChange={e => setBranch(e.target.value)}>
            <option value="no_site">No site</option>
            <option value="broken">It doesn't open</option>
            <option value="working_on_it">Working on it</option>
          </select>
        </label>
        {list(W.branches[branch as keyof typeof W.branches])}
        <details>
          <summary className="cursor-pointer">If they push back</summary>
          <label className="dko-field mt-3">
            What's behind it
            <select
              value={objection}
              onChange={e => setObjection(e.target.value)}
            >
              <option value="busy">Too busy</option>
              <option value="burned">A bad past experience</option>
              <option value="expensive">Feels expensive</option>
            </select>
          </label>
          {list(W.objections[objection as keyof typeof W.objections])}
        </details>
      </section>
      <section className="dko-panel dko-private-price">
        <h2>Price discussion, private</h2>
        {list(W.price.hold)}
        <Button
          size="sm"
          variant={held ? "outline" : "default"}
          disabled={m.busy || !!m.priceProblem || held}
          onClick={() => void m.savePitch({ held_full: true })}
        >
          {held ? "Full price held, logged" : "Held full price"}
        </Button>
        {held && !m.row?.locked ? (
          <>
            <p className="dko-help">
              A lower number stays here. It never appears in the shared deck.
            </p>
            <div className="dko-fields">
              {m.row?.parts.map(p => (
                <label key={p.key} className="dko-field">
                  Final {p.key} · USD
                  <input
                    type="number"
                    min="1"
                    max="1000000"
                    step="0.01"
                    value={
                      lower[p.key] ??
                      String(
                        m.pitch?.finalPrice?.[p.key] ??
                          m.opening?.[p.key] ??
                          "",
                      )
                    }
                    onChange={e =>
                      setLower(o => ({ ...o, [p.key]: e.target.value }))
                    }
                  />
                </label>
              ))}
            </div>
            <label className="dko-field">
              Reason
              <input
                value={reason}
                maxLength={140}
                onChange={e => setReason(e.target.value)}
              />
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={m.busy || !reason.trim()}
              onClick={() =>
                void m.savePitch({
                  final_price: Object.fromEntries(
                    m.row!.parts.map(p => [
                      p.key,
                      Number(
                        lower[p.key] ??
                          m.pitch?.finalPrice?.[p.key] ??
                          m.opening?.[p.key],
                      ),
                    ]),
                  ),
                  final_reason: reason,
                })
              }
            >
              Record the agreed price
            </Button>
            {m.pitch?.finalPrice ? (
              <ul>
                {say(W.price.lower).map(l => (
                  <li key={l}>
                    {fill(l, {
                      final: formatMoney(
                        m.pitch!.finalPrice!.build,
                        "USD",
                        model.lang,
                      ),
                    })}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
        {held && m.row?.splitAllowed ? (
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={m.pitch?.split === true}
              onChange={e => void m.savePitch({ split: e.target.checked })}
            />
            Record the allowed split
          </label>
        ) : null}
        {m.error ? (
          <p role="alert" className="txt-bad">
            {m.error}
          </p>
        ) : null}
      </section>
      <section className="dko-panel">
        <h2>Close the loop</h2>
        <LogPitchDialog offer={m} inline />
        {typeof m.prep.payment_link === "string" ? (
          <a
            className="text-primary underline"
            href={m.prep.payment_link}
            target="_blank"
            rel="noreferrer"
          >
            Open their payment link
          </a>
        ) : (
          <p className="dko-help">Add the real payment link in prep.</p>
        )}
        <a
          className="text-primary underline"
          href={proposalNewUrl(m.sources.gate.taskId, "website")}
          target="_blank"
          rel="noreferrer"
        >
          Prepare a proposal
        </a>
        <label className="dko-field">
          Agreed next step
          <input
            value={next}
            maxLength={200}
            onChange={e => setNext(e.target.value)}
          />
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={m.busy || !m.io}
          onClick={async () => {
            setError(null);
            try {
              const pitch = m.pitch ?? (await m.savePitch({}));
              if (!pitch) return;
              const v = await m.io!.pitchVideo(pitch.id);
              setVideo(v.url);
              if (!v.url)
                setError(
                  v.note ?? "No video is recorded in this language yet.",
                );
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Get the follow-up video
        </Button>
        {video ? (
          <>
            <p className="dko-help">
              {m.sources.doorLive
                ? "This link records anonymous video visits."
                : "Direct video link. Visits are not counted."}
            </p>
            <Button
              size="sm"
              disabled={!next.trim()}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    fill(W.whatsapp[model.lang === "en" ? "en" : m.dialect], {
                      video,
                      next,
                      name: model.data?.csmFirst ?? "",
                    }),
                  );
                  setCopied(true);
                } catch {
                  setError("Copy failed. Select the link below and copy it.");
                }
              }}
            >
              {copied ? "Copied" : "Copy WhatsApp recap"}
            </Button>
            <a
              href={video}
              className="break-all text-xs underline"
              target="_blank"
              rel="noreferrer"
            >
              {video}
            </a>
          </>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
      </section>
      <details className="dko-panel">
        <summary className="cursor-pointer">Facts, only if useful</summary>
        {W.facts.map(f => (
          <p className="text-sm" key={f.text}>
            {f.text}
            <span className="block text-xs text-muted-foreground">
              {f.source} · {f.year}
            </span>
          </p>
        ))}
      </details>
    </div>
  );
}
