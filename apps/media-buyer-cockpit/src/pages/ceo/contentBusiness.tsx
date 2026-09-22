import { useAction } from "convex/react";
import { Loader2, Sprout } from "lucide-react";
import { useCallback } from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { count, money } from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import { useServerWindow } from "@/components/ceo/serverWindow";
import { TimeframeBar } from "@/components/ceo/TimeframeBar";
import { useTimeframe } from "@/components/ceo/timeframe";
import type { CeoSection } from "@/components/ceo/useCeo";
import { range as rangeText } from "@/components/ceo/windows";
import { api } from "../../../convex/_generated/api";
import type {
  ContentWindow,
  OrganicPayload,
} from "../../../convex/ceo/payloads";

/**
 * What the content brings in, beside what it reaches.
 *
 * Aziz, 2026-09-22: "I should be able to see how many leads our content has
 * gotten, specifically from organic content and from each platform. And
 * closed deals and revenue as well, the same way the marketing paid ads is."
 *
 * The honest unit here is a contact, not a lead. A lead everywhere else in
 * the cockpit is a contact a setter tagged on the ROAS form, and that form is
 * a step in the paid funnel, so somebody who arrives from a reel or a DM is
 * never tagged and never reaches a lead count. Contacts and the calls they
 * booked need no tag, so that is what this counts, and the note says why.
 *
 * Revenue is the one number the CRM cannot attribute: every signed deal that
 * carries a contact traces back to a paid ad, and the rest carry no contact
 * at all. So deals here are read from the closer's own answer on the closing
 * form, which is the only place a non-paid origin is ever named.
 */

/** The earliest day the CRM has anything worth reading. */
const FIRST = "2025-01-01";

/**
 * Buckets that are not a platform. An old contact re-engaged is not new
 * content, a contact typed into the CRM by hand came from a conversation
 * nobody recorded, and "Not named" is exactly that. They stay in the table,
 * where they can be seen, and out of the headline, which is about content.
 */
const NOT_A_PLATFORM = new Set(["Reactivation", "Not named", "Added by hand"]);

function Table({ w }: { w: ContentWindow }) {
  const rows = w.platforms.filter(p => p.contacts > 0 || (p.posts ?? 0) > 0);
  if (!rows.length)
    return (
      <EmptyState
        title="Nothing arrived from content in this window"
        text="No contact in these days came in without evidence of a paid ad, and nothing was published either."
        icon={Sprout}
      />
    );
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[520px] text-sm tabular-nums">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th className="py-1.5 text-left font-medium">Platform</th>
            <th
              className="py-1.5 text-right font-medium"
              title="Reels and videos published in this window, from the asset library"
            >
              Posted
            </th>
            <th
              className="py-1.5 text-right font-medium"
              title="Contacts that arrived with no evidence of a paid ad"
            >
              Contacts
            </th>
            <th
              className="py-1.5 text-right font-medium"
              title="Contacts who booked an intro or a demo"
            >
              Booked
            </th>
            <th className="py-1.5 text-right font-medium">Demos shown</th>
            <th
              className="py-1.5 text-right font-medium"
              title="Contacts a setter tagged on the ROAS form"
            >
              Tagged
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.platform} className="border-b last:border-b-0">
              <td className="py-1.5 text-left font-medium">{r.platform}</td>
              <td className="py-1.5 text-right text-muted-foreground">
                {r.posts === null ? "—" : count(r.posts)}
              </td>
              <td className="py-1.5 text-right">{count(r.contacts)}</td>
              <td className="py-1.5 text-right">{count(r.booked)}</td>
              <td className="py-1.5 text-right">{count(r.demosShown)}</td>
              <td className="py-1.5 text-right text-muted-foreground">
                {count(r.leads)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Deals({ w }: { w: ContentWindow }) {
  if (!w.deals.length)
    return (
      <p className="text-sm text-muted-foreground">
        Nothing was signed in this window.
      </p>
    );
  return (
    <div className="grid gap-1.5">
      {w.deals.map(d => (
        <div
          key={d.source}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b py-1.5 text-sm last:border-b-0"
        >
          <span className="font-medium">{d.source}</span>
          <span className="tabular-nums text-muted-foreground">
            {`${count(d.deals)} ${d.deals === 1 ? "deal" : "deals"} · ${money(d.contracted)} contracted · ${money(d.cash)} collected`}
          </span>
        </div>
      ))}
      <p className="pt-1 text-xs text-muted-foreground">
        What the closer wrote on the closing form. It is the only place a
        non-paid origin is ever named: every signed deal that carries a contact
        id traces back to a paid ad.
      </p>
    </div>
  );
}

export function ContentBusiness({
  payload,
  section,
  order,
}: {
  payload: OrganicPayload;
  section: CeoSection<"organic"> | null | undefined;
  order: number;
}) {
  const tf = useTimeframe("30d");
  const readWindow = useAction(api.ceo.windows.content);
  const storedWindow = payload.business;
  const last = storedWindow?.to ?? null;

  const pick = useCallback(
    (b: { from: string; to: string }) =>
      storedWindow && b.from === storedWindow.from && b.to === storedWindow.to
        ? storedWindow
        : null,
    [storedWindow],
  );
  const fetchWindow = useCallback(
    async (b: { from: string; to: string }) =>
      (await readWindow(b)) as ContentWindow,
    [readWindow],
  );
  const shown = useServerWindow({
    tf,
    first: FIRST,
    last,
    stored: pick,
    read: fetchWindow,
  });

  const w = shown.data;
  const label = shown.bounds
    ? rangeText(shown.bounds.from, shown.bounds.to)
    : "Pick both dates";
  const fromContent = w
    ? w.platforms
        .filter(p => !NOT_A_PLATFORM.has(p.platform))
        .reduce(
          (t, p) => ({
            contacts: t.contacts + p.contacts,
            booked: t.booked + p.booked,
            demos: t.demos + p.demosShown,
          }),
          { contacts: 0, booked: 0, demos: 0 },
        )
    : null;

  return (
    <div className="grid gap-3">
      <TimeframeBar
        tf={tf}
        bounds={shown.bounds}
        ariaLabel="Timeframe for what the content brings in"
        first={FIRST}
        last={last}
      />
      <SectionCard
        kicker={`${label} · contacts, calls and deals`}
        title="What the content brings in"
        section={section}
        order={order}
      >
        {() =>
          !w ? (
            shown.error ? (
              <p className="text-sm text-[var(--ceo-bad)]">{shown.error}</p>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {`Reading ${label}`}
              </p>
            )
          ) : (
            <div className="grid gap-5">
              <div className="grid grid-cols-2 gap-x-6 gap-y-5 @md:grid-cols-4">
                <StatTile
                  variant="plain"
                  label="Contacts from content"
                  value={count(fromContent?.contacts ?? 0)}
                  sub={`of ${count(w.totals.contacts)} that arrived`}
                  hint="Contacts with no ad id, no Meta attribution id and nothing in their source that says ads. Reactivated contacts, ones typed in by hand and ones the CRM cannot place are in the table below but not in this number."
                />
                <StatTile
                  variant="plain"
                  label="Calls booked"
                  value={count(fromContent?.booked ?? 0)}
                  sub={`${count(fromContent?.demos ?? 0)} demos shown`}
                />
                <StatTile
                  variant="plain"
                  label="Deals not put down to ads"
                  value={count(w.dealsOrganic.deals)}
                  sub={`of ${count(w.dealsAll.deals)} signed`}
                  hint="What the closer wrote on the closing form."
                />
                <StatTile
                  variant="plain"
                  label="Revenue not from ads"
                  value={money(w.dealsOrganic.contracted)}
                  sub={`${money(w.dealsOrganic.cash)} collected`}
                />
              </div>
              <Table w={w} />
              <div className="grid gap-2">
                <h3 className="text-sm font-semibold">
                  Every deal signed, by what the closer put it down to
                </h3>
                <Deals w={w} />
              </div>
              <p className="text-xs text-muted-foreground">
                {`${count(w.totals.paidLeads)} of the ${count(w.totals.leads)} tagged leads in this window carry evidence of a paid ad, and ${count(w.totals.organicLeads)} came from content. A contact counts as paid when it carries an ad id, when GoHighLevel's attribution carries a Meta ad id, or when its own source text says "ads" — so an "instagram ads" contact with no id is credited to the ads, not to the reel.`}
              </p>
            </div>
          )
        }
      </SectionCard>
    </div>
  );
}
