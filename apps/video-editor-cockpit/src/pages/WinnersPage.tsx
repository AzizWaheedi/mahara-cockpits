import { useMemo, useState } from "react";
import AdPreviewFrame from "../components/AdPreview";
import { Empty, Fold, Problem, Prose, Spinner } from "../components/bits";
import { useWinners } from "../lib/data";
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
function money(n: number | null): string {
  return n === null || n === undefined ? "—" : `${n.toFixed(1)}`;
}

function Card({ ad }: { ad: WinnerAd }) {
  return (
    <li className="panel overflow-hidden">
      <div className="grid gap-3 p-3 sm:grid-cols-[13rem_1fr]">
        <div className="max-w-52">
          <AdPreviewFrame
            adId={ad.ad_id}
            thumbUrl={ad.thumb_url}
            format={ad.format}
            watchUrl={ad.watch_url}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{ad.client ?? "—"}</p>
          <p className="muted truncate text-xs">{ad.service_line ?? ad.ad_name ?? ""}</p>
          <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
            <div className="flex gap-1.5">
              <dt className="muted">cost per lead</dt>
              <dd className="tabular-nums font-medium" style={{ color: "var(--success)" }}>
                {money(ad.cpl)}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="muted">leads</dt>
              <dd className="tabular-nums">{ad.leads ?? "—"}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="muted">spend</dt>
              <dd className="tabular-nums">{money(ad.spend)}</dd>
            </div>
          </dl>
        </div>
      </div>

      {ad.hook ? (
        <p dir="auto" className="rtl-safe border-t hairline px-3 py-2 text-sm">
          <span className="muted mr-2 text-[11px] uppercase tracking-wide">Hook</span>
          {ad.hook}
        </p>
      ) : null}

      <div className="px-3 pb-1">
        {ad.body ? (
          <Fold title="Ad copy" hint={ad.format ?? undefined}>
            <Prose text={ad.body} />
          </Fold>
        ) : null}
        {ad.transcript ? (
          <Fold title="What is said in it" hint={`${ad.transcript.length} characters`}>
            <Prose text={ad.transcript} />
          </Fold>
        ) : null}
      </div>
    </li>
  );
}

export default function WinnersPage() {
  const winners = useWinners();
  const [client, setClient] = useState("");

  const clients = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of winners.data ?? []) {
      const key = a.client ?? "—";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [winners.data]);

  const shown = useMemo(
    () => (client ? (winners.data ?? []).filter((a) => a.client === client) : (winners.data ?? [])),
    [winners.data, client],
  );

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Winning ads</h1>
        <p className="muted mt-1 text-sm">
          Ads that already paid, cheapest cost per lead first. The same list the media buyer and the
          creative director work from. Other clients' ads on purpose: this is copy meant to be
          reused.
        </p>
      </header>

      <div className="mb-5 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setClient("")}
          aria-pressed={client === ""}
          className={`rounded-full px-3 py-1.5 text-xs font-medium ${
            client === ""
              ? "bg-[color:var(--primary)] text-[color:var(--primary-foreground)]"
              : "raised muted"
          }`}
        >
          All {winners.data?.length ? `(${winners.data.length})` : ""}
        </button>
        {clients.slice(0, 12).map(([name, n]) => (
          <button
            key={name}
            type="button"
            onClick={() => setClient(name)}
            aria-pressed={client === name}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              client === name
                ? "bg-[color:var(--primary)] text-[color:var(--primary-foreground)]"
                : "raised muted"
            }`}
          >
            {name} <span className="tabular-nums opacity-70">{n}</span>
          </button>
        ))}
      </div>

      {winners.error && <Problem>These could not be read: {winners.error}</Problem>}
      {winners.loading && <Spinner what="Reading the winners" />}
      {!winners.loading && !shown.length && (
        <Empty>No winning ads have been mirrored here yet.</Empty>
      )}

      <ul className="space-y-3">
        {shown.map((ad) => (
          <Card key={ad.ad_id} ad={ad} />
        ))}
      </ul>
    </div>
  );
}
