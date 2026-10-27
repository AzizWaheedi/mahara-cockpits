import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  OFFER_NAMES,
  offerDeckUrl,
  proposalNewUrl,
} from "../../../present/offer/kinds";
import {
  type OfferClient,
  type OfferStatus,
  readOfferStatus,
} from "../../../present/offer/sources";
export const READY_WORDS: Record<string, string> = {
  no_recruiter: "Name the recruiter",
  no_capture: "Add a dated capture",
  capture_old: "Refresh the capture",
  no_price: "Choose the opening price",
  no_payment_link: "Add a payment link",
};
export function OfferHotRow({
  c,
  client = supabase,
  status,
}: {
  c: { taskId: string | number };
  client?: OfferClient | null;
  status?: OfferStatus;
}) {
  const [data, setData] = useState<OfferStatus | null>(status ?? null),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    setData(status ?? null);
    if (status || !client) return;
    let live = true;
    void readOfferStatus(client, String(c.taskId)).then(
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
  }, [c.taskId, client, status]);
  if (error)
    return (
      <p className="text-sm txt-warn">
        Offer readiness could not be read: {error}
      </p>
    );
  if (!data)
    return (
      <p className="text-sm text-muted-foreground">
        Reading this month's offer…
      </p>
    );
  const picked = data.offers.find(o => o.key === data.thisMonth);
  const prepare =
    picked ??
    (data.gate.ok
      ? data.offers.find(o => o.key === "website" && o.fit.ok === null)
      : undefined);
  return (
    <div className="mb-4 border-b pb-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">
            {picked ? OFFER_NAMES[picked.key] : "Offer conversation"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {picked
              ? picked.ready.ok
                ? "Ready to prepare"
                : picked.ready.missing.map(k => READY_WORDS[k]).join(" · ")
              : (data.thisMonthWhy ??
                data.gate.reasons[0]?.text ??
                "No offer suggested right now.")}
          </p>
        </div>
        {prepare ? (
          <a
            className="text-sm text-primary underline"
            href={offerDeckUrl(String(c.taskId), prepare.key, "prep")}
            target="_blank"
            rel="noreferrer"
          >
            Prepare
          </a>
        ) : null}
      </div>
      {!picked && prepare?.ready.missing.length ? (
        <p className="text-sm text-muted-foreground mt-2">
          {prepare.ready.missing.map(k => READY_WORDS[k]).join(" · ")}
        </p>
      ) : null}
      {picked ? (
        <a
          className="mt-2 inline-block text-xs text-primary underline"
          href={proposalNewUrl(String(c.taskId), picked.key)}
        >
          Make a proposal
        </a>
      ) : null}
    </div>
  );
}
