import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { OFFER_NAMES } from "../../../present/offer/kinds";
import {
  type CatalogRow,
  type OfferClient,
  saveCatalog,
} from "../../../present/offer/sources";
export function PriceRow({
  row,
  isCeo,
  client,
  onSaved,
}: {
  row: CatalogRow;
  isCeo: boolean;
  client: OfferClient;
  onSaved: (r: CatalogRow) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const flight = useRef(false);
  useEffect(
    () =>
      setDraft(
        Object.fromEntries(
          row.parts.map(p => [
            p.key,
            p.amount === null ? "" : String(p.amount),
          ]),
        ),
      ),
    [row],
  );
  const save = async (
    parts: Record<string, string>,
    patch: Record<string, unknown> = {},
  ) => {
    if (!isCeo || flight.current) return;
    if (
      !Object.keys(patch).length &&
      row.parts.every(
        p => (p.amount === null ? "" : String(p.amount)) === parts[p.key],
      )
    )
      return;
    if (
      Object.values(parts).some(
        v => v !== "" && (!Number.isFinite(Number(v)) || Number(v) <= 0),
      )
    ) {
      setError("Use a positive price, or leave it blank.");
      return;
    }
    flight.current = true;
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await saveCatalog(
          client,
          row.offerKey,
          {
            parts: row.parts.map(p => ({
              key: p.key,
              amount: parts[p.key] === "" ? null : Number(parts[p.key]),
            })),
            ...patch,
          },
          row.revision,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      flight.current = false;
      setBusy(false);
    }
  };
  return (
    <article className="dko-offer-row">
      <div>
        <h3 className="font-medium">{OFFER_NAMES[row.offerKey]}</h3>
        <p className="dko-help">{row.waitsOn ?? "Pitch deck and proposal"}</p>
        {row.locked ? (
          <span className="text-xs txt-warn">Price locked</span>
        ) : null}
      </div>
      <div className="dko-fields">
        {row.parts.map(p => (
          <label className="dko-field" key={p.key}>
            {p.key} · {p.cadence.replaceAll("_", " ")}
            <div className="flex gap-2">
              <input
                className="w-full"
                type="number"
                min="1"
                max="1000000"
                step="0.01"
                value={draft[p.key] ?? ""}
                placeholder="Not set"
                readOnly={!isCeo}
                disabled={busy}
                onChange={e =>
                  setDraft(o => ({ ...o, [p.key]: e.target.value }))
                }
                onBlur={() => void save(draft)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
              />
              <span className="self-center text-xs text-muted-foreground">
                USD
              </span>
            </div>
            {isCeo && p.amount === null ? (
              <button
                type="button"
                className="text-left text-xs text-primary"
                disabled={busy}
                onClick={() => {
                  const next = { ...draft, [p.key]: String(p.hint) };
                  setDraft(next);
                  void save(next);
                }}
              >
                Use the doc's {p.hint} USD
              </button>
            ) : null}
          </label>
        ))}
        {error ? (
          <p role="alert" className="col-span-full text-sm txt-bad">
            {error}
          </p>
        ) : null}
      </div>
      <div>
        {isCeo && row.offerKey === "seo_geo" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void save(draft, { locked: !row.locked })}
          >
            {row.locked ? "Allow price changes" : "Lock price"}
          </Button>
        ) : null}
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {busy ? "Saving…" : `Revision ${row.revision}`}
        </p>
      </div>
    </article>
  );
}
