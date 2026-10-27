import { useEffect, useState } from "react";
import { OFFER_NAMES } from "../../../present/offer/kinds";
import { type OfferClient, readPitchLog } from "../../../present/offer/sources";
export function PitchLog({ client }: { client: OfferClient }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<
      Awaited<ReturnType<typeof readPitchLog>>["rows"]
    >([]),
    [busy, setBusy] = useState(true),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError(null);
    void readPitchLog(client, `${month}-01`)
      .then(
        x => {
          if (live) setRows(x.rows);
        },
        e => {
          if (live) setError(e instanceof Error ? e.message : String(e));
        },
      )
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [client, month]);
  return (
    <section className="dko-panel">
      <div className="flex items-center justify-between">
        <h2>Conversations recorded</h2>
        <input
          aria-label="Pitch log month"
          type="month"
          value={month}
          onChange={e => {
            if (e.target.value) setMonth(e.target.value);
          }}
          className="rounded border bg-background p-2 text-sm"
        />
      </div>
      {error ? (
        <p role="alert">{error}</p>
      ) : busy ? (
        <p className="dko-help">Reading the log…</p>
      ) : !rows.length ? (
        <p className="dko-help">No offer conversations recorded this month.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                {[
                  "Client / offer",
                  "Date / owner",
                  "Opening price",
                  "Agreed price / reason",
                  "Answer",
                ].map(v => (
                  <th key={v} className="p-3">
                    {v}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b">
                  <td className="p-3">
                    <a
                      className="text-primary"
                      href={`${import.meta.env.BASE_URL}clients/${encodeURIComponent(r.taskId)}`}
                    >
                      {r.clientName}
                    </a>
                    <p className="dko-help">{OFFER_NAMES[r.offerKey]}</p>
                  </td>
                  <td className="p-3">
                    {r.pitchedOn}
                    <p className="dko-help">{r.csm}</p>
                  </td>
                  <td className="p-3">
                    {r.openingPrice
                      ? Object.entries(r.openingPrice)
                          .map(([k, v]) => `${k}: ${v} USD`)
                          .join(" · ")
                      : "Not recorded"}
                    <p className="dko-help">{r.openingReason}</p>
                  </td>
                  <td className="p-3">
                    {r.finalPrice
                      ? Object.entries(r.finalPrice)
                          .map(([k, v]) => `${k}: ${v} USD`)
                          .join(" · ")
                      : "Opening price"}
                    <p className="dko-help">{r.finalReason}</p>
                  </td>
                  <td className="p-3">
                    {r.answer?.replaceAll("_", " ") ?? "In progress"}
                    {r.followUpOn ? (
                      <p className="dko-help">Follow up {r.followUpOn}</p>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
