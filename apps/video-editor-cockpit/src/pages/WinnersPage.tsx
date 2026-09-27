import { useMemo, useState } from "react";
import AdPreviewFrame from "../components/AdPreview";
import {
  chip,
  Empty,
  Fold,
  KICKER,
  Page,
  PageHeader,
  Problem,
  Prose,
  Spinner,
} from "../components/bits";
import { useStills, useWinners } from "../lib/data";
import { AD_VIDEOS_BUCKET } from "../lib/supabase";
import type { WinnerAd } from "../lib/types";

/**
 * The ads that already worked.
 *
 * The media buyer deployment owns what "winning" means and mirrors the rows
 * here, so this is the same list the media buyer and the creative director
 * see, not a weaker copy. For an editor it is the most useful reference in
 * the company: the hook, the script and the picture of something that paid.
 *
 * Other clients' ads on purpose. This is ad copy meant to be reused, with
 * nothing client-private in it, and the other cockpits show it unscoped too.
 */

/** What an ad with no client tag is filed under, in the list and the filter. */
const NO_CLIENT = "No client";

const CPL = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const SPEND = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function usd(n: number | null, as: Intl.NumberFormat): string {
  return n === null || n === undefined ? "n/a" : as.format(n);
}

function Card({ ad, ours }: { ad: WinnerAd; ours?: string }) {
  return (
    <li className="@container overflow-hidden rounded-2xl border bg-card">
      <div className="grid gap-4 p-4 @sm:grid-cols-[11rem_1fr]">
        <div className="max-w-44">
          <AdPreviewFrame
            adId={ad.ad_id}
            title={`${ad.client ?? "Ad"} · ${ad.service_line ?? ad.ad_name ?? ""}`.trim()}
            thumbUrl={ad.thumb_url}
            format={ad.format}
            watchUrl={ad.watch_url}
            ourCopy={ours}
          />
        </div>
        <div className="min-w-0">
          <p dir="auto" className="truncate text-[15px] font-semibold">
            {ad.client ?? NO_CLIENT}
          </p>
          {ad.service_line || ad.ad_name ? (
            <p dir="auto" className="truncate text-xs text-muted-foreground">
              {ad.service_line ?? ad.ad_name}
            </p>
          ) : null}
          <p className="mt-4 text-xs text-muted-foreground">Cost per lead</p>
          <p className="mt-0.5 whitespace-nowrap text-2xl font-semibold tracking-tight tabular-nums">
            {usd(ad.cpl, CPL)}
          </p>
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">
            {ad.leads === null || ad.leads === undefined
              ? "Leads n/a"
              : `${ad.leads} ${ad.leads === 1 ? "lead" : "leads"}`}{" "}
            ·{" "}
            {ad.spend === null || ad.spend === undefined
              ? "spend n/a"
              : `${usd(ad.spend, SPEND)} spent`}
          </p>
        </div>
      </div>

      {ad.hook ? (
        <p dir="auto" className="rtl-safe border-t px-4 py-3 text-sm">
          <span className={`${KICKER} mr-2`}>Hook</span>
          {ad.hook}
        </p>
      ) : null}

      {ad.body || ad.transcript ? (
        <div className="border-t px-4">
          {ad.body ? (
            <Fold title="Ad copy" hint={ad.format ?? undefined}>
              <Prose text={ad.body} />
            </Fold>
          ) : null}
          {ad.transcript ? (
            <Fold title="What is said in it">
              <Prose text={ad.transcript} />
            </Fold>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export default function WinnersPage() {
  const winners = useWinners();
  const [client, setClient] = useState("");

  const clients = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of winners.data ?? []) {
      const key = a.client ?? NO_CLIENT;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [winners.data]);

  const shown = useMemo(
    () =>
      client
        ? (winners.data ?? []).filter(a => (a.client ?? NO_CLIENT) === client)
        : (winners.data ?? []),
    [winners.data, client],
  );

  // Our own copies, signed in one batch. These are the ads nobody can take
  // away from us: downloaded from Meta while the link still worked.
  const ourCopies = useStills(
    shown.map(a => a.file_path),
    AD_VIDEOS_BUCKET,
  );
  const mine = shown.filter(a => a.file_path).length;

  return (
    <Page wide>
      <PageHeader
        title="What works"
        sub={
          <>
            Ads that already paid, cheapest cost per lead first.
            {shown.length ? (
              <>
                {" "}
                {mine} of {shown.length} play from our own copy.
              </>
            ) : null}
          </>
        }
      />

      {clients.length > 1 ? (
        <div className="-mx-4 mb-6 flex flex-nowrap items-center gap-2 overflow-x-auto px-4 no-scrollbar sm:mx-0 sm:flex-wrap sm:px-0">
          <button
            type="button"
            onClick={() => setClient("")}
            aria-pressed={client === ""}
            className={chip(client === "")}
          >
            All
            {winners.data?.length ? (
              <span className="tabular-nums opacity-70">
                {winners.data.length}
              </span>
            ) : null}
          </button>
          {clients.slice(0, 12).map(([name, n]) => (
            <button
              key={name}
              type="button"
              onClick={() => setClient(name)}
              aria-pressed={client === name}
              className={chip(client === name)}
            >
              <span dir="auto">{name}</span>
              <span className="tabular-nums opacity-70">{n}</span>
            </button>
          ))}
        </div>
      ) : null}

      {winners.error && (
        <Problem>These could not be read: {winners.error}</Problem>
      )}
      {winners.loading && <Spinner what="Reading the winners" />}
      {!winners.loading && !shown.length && (
        <Empty>No winning ads have been mirrored here yet.</Empty>
      )}

      <ul className="grid items-start gap-4 lg:grid-cols-2">
        {shown.map(ad => (
          <Card
            key={ad.ad_id}
            ad={ad}
            ours={ad.file_path ? ourCopies[ad.file_path] : undefined}
          />
        ))}
      </ul>
    </Page>
  );
}
