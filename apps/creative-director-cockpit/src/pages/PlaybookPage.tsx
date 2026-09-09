import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { CreativePreview } from "@/components/CreativePreview";

/**
 * What works in the GCC.
 *
 * Copied verbatim from the media buyer cockpit at Aziz's request, running over
 * the mirrored `marketPlays` rows. Do not "improve" it here: recopy it when the
 * cockpit version changes, so both roles read the same page. [aziz, 2026-09-07]
 *
 * Every ad set we have ever run, grouped by service line, city and the shape of
 * the targeting, ranked by cost per lead. The point is not to admire the data:
 * it is to notice that a play returning $5 leads in one city has never been
 * tried in another, and to copy it.
 */
export function PlaybookPage() {
  const [service, setService] = useState("");
  const [city, setCity] = useState("");
  const dims = useQuery(api.market.dimensions, {});
  const rows = useQuery(api.market.playbook, {
    serviceLine: service || undefined,
    city: city || undefined,
  });
  const patterns = useQuery(api.market.creativePatterns, {
    serviceLine: service || undefined,
  });
  const winners = useQuery(api.market.winners, {
    serviceLine: service || undefined,
    limit: 40,
  });

  const verdictTone = (v: string) =>
    v === "Proven" ? "tone-good" : v === "Worked once" ? "tone-warn" : "tone-bad";

  // The headline finding: cheapest proven play whose city differs from the
  // most expensive one in the same service line.
  const opportunity = (() => {
    if (!rows || rows.length < 2) return null;
    for (const good of rows) {
      if (good.cpl > 15) break;
      const bad = rows.find(
        r =>
          r.serviceLine === good.serviceLine &&
          r.city !== good.city &&
          r.cpl > good.cpl * 1.8 &&
          r.spend > 500,
      );
      if (bad) return { good, bad };
    }
    return null;
  })();

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <header className="mb-5">
        <h1 className="text-xl font-bold tracking-tight">What works in the GCC</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {dims
            ? `${dims.plays} ad sets across ${dims.clients} clients, ${dims.cities.length} cities. Every campaign we run adds to this.`
            : "Loading…"}
        </p>
      </header>

      {opportunity && (
        <div className="callout-warn mb-5 rounded-lg border p-3">
          <div className="text-[11px] font-bold uppercase tracking-wide">
            Worth copying
          </div>
          <p className="mt-1 text-[13px]">
            <strong>
              {opportunity.good.playType === "broad"
                ? "Broad"
                : opportunity.good.playType === "lookalike"
                  ? "Lookalike"
                  : "Interest stack"}
            </strong>{" "}
            is returning{" "}
            <strong className="txt-good">${opportunity.good.cpl}</strong> leads for{" "}
            {opportunity.good.serviceLine.toLowerCase()} in {opportunity.good.city}
            , while {opportunity.bad.city} is paying{" "}
            <strong className="txt-bad">${opportunity.bad.cpl}</strong> for the same
            service line. Worth testing there.
          </p>
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        <select
          value={service}
          onChange={e => setService(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-[12px]"
        >
          <option value="">Every service line</option>
          {dims?.serviceLines.map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={city}
          onChange={e => setCity(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-[12px]"
        >
          <option value="">Everywhere</option>
          {dims?.cities.map(c => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-[12.5px]">
          <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-2 text-left font-semibold">Service line</th>
              <th className="p-2 text-left font-semibold">City</th>
              <th className="p-2 text-left font-semibold">Play</th>
              <th className="p-2 text-right font-semibold">Spend</th>
              <th className="p-2 text-right font-semibold">Leads</th>
              <th className="p-2 text-right font-semibold">Cost / lead</th>
              <th className="p-2 text-left font-semibold">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map(r => (
              <tr
                key={`${r.serviceLine}${r.city}${r.playType}${r.interests.join()}`}
                className="border-t"
              >
                <td className="p-2">{r.serviceLine}</td>
                <td className="p-2">{r.city}</td>
                <td className="p-2">
                  <span className="capitalize">{r.playType}</span>
                  {r.interests.length > 0 && (
                    <span className="block text-[11px] text-muted-foreground">
                      {r.interests.slice(0, 4).join(", ")}
                      {r.interests.length > 4 && ` +${r.interests.length - 4}`}
                    </span>
                  )}
                </td>
                <td className="p-2 text-right tabular-nums">
                  ${r.spend.toLocaleString()}
                </td>
                <td className="p-2 text-right tabular-nums">{r.leads}</td>
                <td className="p-2 text-right font-semibold tabular-nums">
                  ${r.cpl}
                </td>
                <td className="p-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${verdictTone(r.verdict)}`}
                  >
                    {r.verdict}
                  </span>
                  {r.clients > 1 && (
                    <span className="ml-1 text-[11px] text-muted-foreground">
                      {r.clients} clients
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {rows?.length === 0 && (
              <tr>
                <td className="p-4 text-center text-muted-foreground" colSpan={7}>
                  Nothing with enough spend to judge yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <CreativePatterns rows={patterns} />

      <WinningAds rows={winners} />

      <p className="mt-3 text-[11.5px] text-muted-foreground">
        Only ad sets with at least $100 spend and one lead are shown — below that a
        cheap cost per lead is noise. "Proven" means it beat $15 for more than one
        client.
      </p>
    </div>
  );
}

const PATTERN_GROUPS: { kind: string; title: string; sub: string }[] = [
  { kind: "format", title: "Ad format", sub: "video, image or carousel" },
  { kind: "cta", title: "Call to action", sub: "the button on the ad" },
  {
    kind: "copy",
    title: "Copy shape",
    sub: "how the writing is built, not the words themselves",
  },
  { kind: "language", title: "Language", sub: "Arabic, English or mixed" },
];

/**
 * The creative half of the playbook.
 *
 * Targeting tells you who saw the ad; this tells you what the ad was. Both
 * halves are needed before a winning play can be copied to another client.
 */
function CreativePatterns({
  rows,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: query payload is untyped
  rows: any[] | undefined;
}) {
  if (!rows || rows.length === 0) return null;

  return (
    <div className="mt-6">
      <h2 className="text-[13px] font-bold">What the winning ads look like</h2>
      <p className="mb-2 text-[11.5px] text-muted-foreground">
        Every ad we have run, grouped by what kind of ad it was rather than who
        it targeted. Same rule as above: at least $100 behind a pattern before
        it counts.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {PATTERN_GROUPS.map(g => {
          const mine = rows.filter(r => r.kind === g.kind);
          if (mine.length === 0) return null;
          return (
            <div key={g.kind} className="rounded-lg border p-3">
              <div className="text-[12px] font-bold">{g.title}</div>
              <div className="mb-1.5 text-[11px] text-muted-foreground">
                {g.sub}
              </div>
              <table className="w-full text-[11.5px]">
                <tbody>
                  {mine.map(r => (
                    <tr key={r.key} className="border-t">
                      <td className="py-1 pr-2">
                        {r.key}
                        {r.key === "unknown" && (
                          <span className="text-muted-foreground">
                            {" "}
                            (dynamic creative — Meta won't say)
                          </span>
                        )}
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums font-semibold">
                        ${r.cpl.toFixed(2)}
                      </td>
                      <td className="py-1 text-right text-[10.5px] text-muted-foreground">
                        {r.leads} leads · {r.clients}{" "}
                        {r.clients === 1 ? "client" : "clients"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The winning ads themselves — copy, hook and script.
 *
 * Patterns tell you the shape; this is the actual ad. Aziz's ask: when
 * something like Arcturus performs, we should be able to open it, read what it
 * said, and reuse the angle for the next client. [aziz, 2026-09-06]
 */
/** "2026-08-14" → "14 Aug". Blank stays blank rather than becoming a fake date. */
function fmtDay(d: string | null | undefined): string {
  if (!d) return "";
  const t = Date.parse(d);
  if (Number.isNaN(t)) return d;
  return new Date(t).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function WinningAds({
  // biome-ignore lint/suspicious/noExplicitAny: query payload is untyped
  rows,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: query payload is untyped
  rows: any[] | undefined;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (!rows || rows.length === 0) return null;

  return (
    <div className="mt-6">
      <h2 className="text-[13px] font-bold">The winning ads, word for word</h2>
      <p className="mb-2 text-[11.5px] text-muted-foreground">
        Every ad that spent at least $100 and stayed under $15 a lead, kept
        permanently — switched off or not — with the dates it was winning in.
        Click one to read its hook, its copy and, for video, what is actually
        said and shown on screen.
      </p>
      <div className="divide-y rounded-lg border">
        {rows.map(r => {
          const isOpen = open === r.adId;
          return (
            <div key={r.adId}>
              <div className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50">
                <CreativePreview
                  name={r.adName}
                  thumbUrl={r.thumbUrl ?? undefined}
                  previewSrc={r.previewSrc ?? undefined}
                  metaAdId={r.adId}
                />
                <span className="w-14 shrink-0 text-right text-[12.5px] font-bold tabular-nums">
                  ${r.cpl.toFixed(2)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium">
                    {r.client}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {r.hook || r.headline || r.adName}
                  </span>
                </span>
                <span className="shrink-0 text-right text-[10.5px] text-muted-foreground">
                  {r.leads} leads · ${r.spend} · {r.city}
                  <span className="block">
                    {r.wonFrom
                      ? `won ${fmtDay(r.wonFrom)}${r.wonTo && r.wonTo !== r.wonFrom ? `–${fmtDay(r.wonTo)}` : ""}`
                      : ""}
                    {r.stillLive === false ? (
                      <span
                        className="ml-1 rounded bg-muted px-1 font-semibold uppercase"
                        title={r.retiredOn ? `Off since ${r.retiredOn}` : "Not running"}
                      >
                        retired
                      </span>
                    ) : r.stillLive ? (
                      <span className="ml-1 font-semibold txt-good">live</span>
                    ) : null}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : r.adId)}
                  className="shrink-0 rounded border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted"
                >
                  {isOpen ? "Hide" : "Read it"}
                </button>
              </div>
              {isOpen && (
                <div className="space-y-3 border-t bg-muted/30 px-3 py-3 text-[12px]">
                  <div className="flex flex-wrap gap-1.5 text-[10.5px]">
                    {[
                      r.serviceLine,
                      r.format,
                      r.cta,
                      r.voice,
                      r.playType,
                      ...(r.copyTraits ?? []),
                    ]
                      .filter(Boolean)
                      .map((t: string) => (
                        <span
                          key={t}
                          className="rounded border px-1.5 py-0.5 text-muted-foreground"
                        >
                          {t}
                        </span>
                      ))}
                  </div>
                  {r.headline && (
                    <div>
                      <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                        Headline
                      </div>
                      <div dir="auto">{r.headline}</div>
                    </div>
                  )}
                  {r.body && (
                    <div>
                      <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                        Copy
                      </div>
                      <div dir="auto" className="whitespace-pre-wrap">
                        {r.body}
                      </div>
                    </div>
                  )}
                  {r.transcript ? (
                    <div>
                      <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                        What the video says and shows
                      </div>
                      <div dir="auto" className="whitespace-pre-wrap">
                        {r.transcript}
                      </div>
                    </div>
                  ) : (
                    r.format === "video" && (
                      <div className="text-muted-foreground">
                        No script read for this one yet.
                      </div>
                    )
                  )}
                  {r.interests?.length > 0 && (
                    <div>
                      <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                        Targeting
                      </div>
                      <div dir="auto">{r.interests.join(" · ")}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
