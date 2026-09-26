import { useQuery } from "convex/react";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import {
  WinnerFilter,
  type WinnerOrigin,
  WinningAds,
} from "@/components/WinningAds";
import { api } from "../../convex/_generated/api";

/**
 * What works in the GCC.
 *
 * Copied verbatim from the media buyer cockpit at Aziz's request, running over
 * the mirrored `marketPlays` rows. Do not "improve" it here: recopy it when the
 * cockpit version changes, so both roles read the same page. [aziz, 2026-09-07]
 * The winning ads list uses the shared WinningAds component, with the same
 * filters, badges and saved numbers as the media buyer's page. The design
 * pass of 2026-09-26 restyled this copy to this cockpit's page shell (header,
 * cards, chips); the rows, numbers and wording are unchanged.
 *
 * Every ad set we have ever run, grouped by service line, city and the shape of
 * the targeting, ranked by cost per lead. The point is not to admire the data:
 * it is to notice that a play returning $5 leads in one city has never been
 * tried in another, and to copy it.
 */
/** The ad set table opens 50 rows at a time. */
const PAGE = 50;

/** Colour on the dot only: proven, worked once, or did not hold. */
function verdictDot(v: string): string {
  return v === "Proven"
    ? "var(--success)"
    : v === "Worked once"
      ? "var(--warning)"
      : "var(--destructive)";
}

export function PlaybookPage() {
  const [service, setService] = useState("");
  const [city, setCity] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [origin, setOrigin] = useState<WinnerOrigin>("all");
  const [savedBy, setSavedBy] = useState("");
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
    origin: origin === "all" ? undefined : origin,
    savedBy: savedBy || undefined,
  });

  // The headline finding: cheapest proven play whose city differs from the
  // most expensive one in the same service line.
  const opportunity = (() => {
    if (!rows || rows.length < 2) return null;
    for (const good of rows) {
      if (good.cpl > 15) break;
      const bad = rows.find(
        (r: any) =>
          r.serviceLine === good.serviceLine &&
          r.city !== good.city &&
          r.cpl > good.cpl * 1.8 &&
          r.spend > 500,
      );
      if (bad) return { good, bad };
    }
    return null;
  })();

  const left = (rows?.length ?? 0) - shown;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="What works in the GCC"
        sub={
          dims
            ? `${dims.plays} ad sets across ${dims.clients} clients, ${dims.cities.length} cities. Every campaign we run adds to this.`
            : "Loading…"
        }
      />

      <div className="space-y-6">
        {opportunity && (
          <div className="bg-mahara-gradient rounded-2xl p-px">
            <div className="rounded-[15px] bg-card p-4 sm:p-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                Worth copying
              </p>
              <p className="mt-2 text-sm leading-relaxed sm:text-[15px]">
                <strong className="font-semibold">
                  {opportunity.good.playType === "broad"
                    ? "Broad"
                    : opportunity.good.playType === "lookalike"
                      ? "Lookalike"
                      : "Interest stack"}
                </strong>{" "}
                is returning{" "}
                <strong className="txt-good font-semibold">
                  ${opportunity.good.cpl}
                </strong>{" "}
                leads for {opportunity.good.serviceLine.toLowerCase()} in{" "}
                {opportunity.good.city}, while {opportunity.bad.city} is paying{" "}
                <strong className="txt-bad font-semibold">
                  ${opportunity.bad.cpl}
                </strong>{" "}
                for the same service line. Worth testing there.
              </p>
            </div>
          </div>
        )}

        <section>
          <div className="mb-3 flex flex-wrap gap-2">
            <AnimatedSelect
              value={service}
              onChange={e => setService(e.target.value)}
              className="h-8 rounded-lg border bg-background px-2 text-sm"
            >
              <option value="">Every service line</option>
              {dims?.serviceLines.map((s: string) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </AnimatedSelect>
            <AnimatedSelect
              value={city}
              onChange={e => setCity(e.target.value)}
              className="h-8 rounded-lg border bg-background px-2 text-sm"
            >
              <option value="">Everywhere</option>
              {dims?.cities.map((c: string) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </AnimatedSelect>
          </div>

          <div className="overflow-x-auto rounded-2xl border bg-card">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium">
                    Service line
                  </th>
                  <th className="px-3 py-2.5 text-left font-medium">City</th>
                  <th className="px-3 py-2.5 text-left font-medium">Play</th>
                  <th className="px-3 py-2.5 text-right font-medium">Spend</th>
                  <th className="px-3 py-2.5 text-right font-medium">Leads</th>
                  <th className="px-3 py-2.5 text-right font-medium">
                    Cost / lead
                  </th>
                  <th className="px-3 py-2.5 text-left font-medium">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {rows?.slice(0, shown).map((r: any) => (
                  <tr
                    key={`${r.serviceLine}${r.city}${r.playType}${r.interests.join()}`}
                    className="border-t"
                  >
                    <td className="px-3 py-2">{r.serviceLine}</td>
                    <td className="px-3 py-2">{r.city}</td>
                    <td className="px-3 py-2">
                      <span className="capitalize">{r.playType}</span>
                      {r.interests.length > 0 && (
                        <span className="block text-xs text-muted-foreground">
                          {r.interests.slice(0, 4).join(", ")}
                          {r.interests.length > 4 &&
                            ` +${r.interests.length - 4}`}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      ${r.spend.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.leads}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      ${r.cpl}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium">
                        <span
                          aria-hidden
                          className="size-1.5 rounded-full"
                          style={{ background: verdictDot(r.verdict) }}
                        />
                        {r.verdict}
                      </span>
                      {r.clients > 1 && (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          {r.clients} clients
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {rows?.length === 0 && (
                  <tr>
                    <td
                      className="p-4 text-center text-muted-foreground"
                      colSpan={7}
                    >
                      Nothing with enough spend to judge yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {left > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => setShown(n => n + PAGE)}
            >
              Show {Math.min(PAGE, left)} more
            </Button>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Only ad sets with at least $100 spend and one lead are shown. Below
            that, a cheap cost per lead is noise. "Proven" means it beat $15 for
            more than one client.
          </p>
        </section>

        <CreativePatterns rows={patterns} />

        <section className="space-y-3">
          <h2 className="text-[15px] font-semibold">
            The winning ads, word for word
          </h2>
          <WinnerFilter
            rows={winners}
            origin={origin}
            onOrigin={setOrigin}
            savedBy={savedBy}
            onSavedBy={setSavedBy}
          />
          <WinningAds
            rows={winners}
            title=""
            sub="Ads found by the weekly check spent at least $100 at $15 or less a lead. Ads marked Saved were picked by the team, with their numbers from the day they were saved. Click one to read its hook, its copy and, for video, what is actually said and shown on screen."
            empty={
              origin === "saved" || savedBy
                ? "Nobody has saved an ad here yet. The media buyer saves one from the Ads table with Save as winner."
                : "No winning ads in this service line yet."
            }
          />
        </section>
      </div>
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
    <section>
      <h2 className="text-[15px] font-semibold">
        What the winning ads look like
      </h2>
      <p className="mt-1 mb-3 text-xs text-muted-foreground">
        Every ad we have run, grouped by what kind of ad it was rather than who
        it targeted. Same rule as above: at least $100 behind a pattern before
        it counts.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:gap-6">
        {PATTERN_GROUPS.map(g => {
          const mine = rows.filter(r => r.kind === g.kind);
          if (mine.length === 0) return null;
          return (
            <div key={g.kind} className="rounded-2xl border bg-card p-4 sm:p-6">
              <div className="text-[15px] font-semibold">{g.title}</div>
              <div className="mb-3 text-xs text-muted-foreground">{g.sub}</div>
              <table className="w-full text-xs">
                <tbody>
                  {mine.map(r => (
                    <tr key={r.key} className="border-t">
                      <td className="py-1.5 pr-2">
                        {r.key}
                        {r.key === "unknown" && (
                          <span className="text-muted-foreground">
                            {" "}
                            (dynamic creative, Meta won't say)
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-2 text-right font-semibold tabular-nums">
                        ${r.cpl.toFixed(2)}
                      </td>
                      <td className="py-1.5 text-right text-muted-foreground">
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
    </section>
  );
}
