import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { CatalogDeckPreview } from "../../../present/offer/CatalogDeckPreview";
import {
  type Catalog,
  type OfferClient,
  readCatalog,
} from "../../../present/offer/sources";
import { OfferSettings } from "./OfferSettings";
import { OfferVideos } from "./OfferVideos";
import { PitchLog } from "./PitchLog";
import { PriceRow } from "./PriceRow";
import "../../../present/offer/offer.css";
export function OffersTab({
  client = supabase,
}: {
  client?: OfferClient | null;
}) {
  const [data, setData] = useState<Catalog | null>(null),
    [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!client) return;
    setError(null);
    try {
      setData(await readCatalog(client));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [client]);
  useEffect(() => {
    void reload();
  }, [reload]);
  if (!client) return <p>Sign in to read the offer catalogue.</p>;
  if (!data)
    return (
      <div className="dko-panel">
        <h2>Offers</h2>
        <p role={error ? "alert" : "status"}>
          {error ?? "Reading the catalogue…"}
        </p>
        {error ? (
          <Button onClick={() => void reload()}>Try again</Button>
        ) : null}
      </div>
    );
  return (
    <div className="space-y-6">
      <section className="dko-panel">
        <h2>Pitch decks</h2>
        <p className="dko-help">
          A presentation for the conversation, separate from the proposal you
          send afterwards. Preview any deck here without changing a client
          record.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.rows.map(row => (
            <CatalogDeckPreview key={row.offerKey} row={row} />
          ))}
        </div>
      </section>
      <section className="dko-panel">
        <h2>Price list</h2>
        <p className="dko-help">
          {data.isCeo
            ? "Set the list, or leave a price blank. Prices save on Enter or when you leave the field."
            : "The CEO maintains this list. You choose each client's opening price in prep and log a reason when it is below list."}
        </p>
        {data.rows.map(row => (
          <PriceRow
            key={row.offerKey}
            row={row}
            client={client}
            isCeo={data.isCeo}
            onSaved={r =>
              setData(d =>
                d
                  ? {
                      ...d,
                      rows: d.rows.map(x =>
                        x.offerKey === r.offerKey ? r : x,
                      ),
                    }
                  : d,
              )
            }
          />
        ))}
      </section>
      <OfferVideos client={client} isCeo={data.isCeo} />
      <OfferSettings
        client={client}
        settings={data.settings}
        isCeo={data.isCeo}
        reload={reload}
      />
      <PitchLog client={client} />
    </div>
  );
}
