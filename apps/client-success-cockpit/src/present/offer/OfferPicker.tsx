import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { READY_WORDS } from "../../pages/money/offers/OfferHotRow";
import {
  OFFER_NAMES,
  type OfferKey,
  offerDeckUrl,
  proposalNewUrl,
} from "./kinds";
import { QuickPitchButton } from "./QuickPitchButton";
import { type OfferClient, type OfferStatus, readOfferStatus } from "./sources";
import "./offer.css";
export function OfferPicker({
  taskId,
  client = supabase,
  status,
}: {
  taskId: string;
  client?: OfferClient | null;
  status?: OfferStatus;
}) {
  const [data, setData] = useState<OfferStatus | null>(status ?? null),
    [error, setError] = useState<string | null>(null),
    [retry, setRetry] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry is the explicit reload generation after a failed request.
  useEffect(() => {
    setError(null);
    setData(status ?? null);
    if (status || !client) return;
    let live = true;
    void readOfferStatus(client, taskId).then(
      r => {
        if (live) setData(r);
      },
      e => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      live = false;
    };
  }, [client, taskId, status, retry]);
  if (error)
    return (
      <div role="alert">
        {error}
        <Button onClick={() => setRetry(n => n + 1)}>Try again</Button>
      </div>
    );
  if (!data) return <p role="status">Reading this client's offers…</p>;
  const row = (key: OfferKey) => {
    const o = data.offers.find(v => v.key === key);
    if (!o) return null;
    return (
      <div key={key} className="border-b py-4">
        <div className="flex justify-between gap-3">
          <div>
            <h3 className="font-medium">{OFFER_NAMES[key]}</h3>
            <p className="dko-help">{o.fit.why}</p>
          </div>
          {
            <a
              href={offerDeckUrl(taskId, key, "prep")}
              className="text-sm text-primary underline"
              target="_blank"
              rel="noreferrer"
            >
              Prepare for client
            </a>
          }
        </div>
        <p className="dko-help">
          {o.ready.ok
            ? "Ready"
            : o.ready.missing.map(k => READY_WORDS[k]).join(" · ")}
        </p>
        {o.waitsOn ? <p className="dko-help">{o.waitsOn}</p> : null}
        <div className="flex flex-wrap items-center gap-4">
          <QuickPitchButton
            key={`${taskId}:${key}`}
            taskId={taskId}
            offer={key}
            client={client}
            hold={o.waitsOn}
          />
          <a
            href={proposalNewUrl(taskId, key)}
            className="text-xs text-primary underline"
          >
            Make a proposal
          </a>
        </div>
      </div>
    );
  };
  return (
    <div className="max-h-[65vh] overflow-y-auto pr-2">
      {data.thisMonth ? (
        <section>
          <p className="text-xs font-medium uppercase tracking-wider text-primary">
            This month
          </p>
          {row(data.thisMonth)}
        </section>
      ) : (
        <div className="rounded-lg border p-3">
          <p className="text-sm">
            {data.thisMonthWhy ??
              data.gate.reasons[0]?.text ??
              "No offer suggested right now."}
          </p>
          <p className="dko-help">
            Choose any service below for a quick overview or prepare its client
            version.
          </p>
        </div>
      )}
      <h3 className="mt-6 text-xs font-medium text-muted-foreground">
        All services
      </h3>
      {data.offers.filter(o => o.key !== data.thisMonth).map(o => row(o.key))}
    </div>
  );
}
