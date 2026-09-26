import { useAction } from "convex/react";
import { Loader2, Sprout } from "lucide-react";
import { useCallback } from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { count, money } from "@/components/ceo/format";
import { Value } from "@/components/ceo/Na";
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
  Note,
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
  // Alignment is added per cell, so the name column never carries both.
  const th = "h-8 px-3 text-xs font-medium text-muted-foreground";
  const td = "whitespace-nowrap px-3 py-2";
  return (
    <div className="ceo-table-scroll -mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[520px] text-sm tabular-nums">
        <thead>
          <tr className="border-b">
            <th scope="col" className={`${th} pl-0 text-left`}>
              Platform
            </th>
            <th
              scope="col"
              className={`${th} text-right`}
              title="Reels and videos published in this window, from the asset library"
            >
              Posted
            </th>
            <th
              scope="col"
              className={`${th} text-right`}
              title="Contacts that arrived with no evidence of a paid ad"
            >
              Contacts
            </th>
            <th
              scope="col"
              className={`${th} text-right`}
              title="Contacts who booked an intro or a demo"
            >
              Booked
            </th>
            <th scope="col" className={`${th} text-right`}>
              Demos shown
            </th>
            <th
              scope="col"
              className={`${th} pr-0 text-right`}
              title="Contacts a setter tagged on the ROAS form"
            >
              Tagged
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map(r => (
            <tr key={r.platform}>
              <td className={`${td} pl-0 text-left font-medium`}>
                {r.platform}
              </td>
              <td className={`${td} text-right text-muted-foreground`}>
                <Value
                  value={r.posts === null ? null : count(r.posts)}
                  hint="The asset library does not track posts for this source."
                />
              </td>
              <td className={`${td} text-right`}>{count(r.contacts)}</td>
              <td className={`${td} text-right`}>{count(r.booked)}</td>
              <td className={`${td} text-right`}>{count(r.demosShown)}</td>
              <td className={`${td} pr-0 text-right text-muted-foreground`}>
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
    <div className="divide-y">
      {w.deals.map(d => (
        <div
          key={d.source}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2 text-sm first:pt-0 last:pb-0"
        >
          <span className="font-medium">{d.source}</span>
          <span className="tabular-nums text-muted-foreground">
            {`${count(d.deals)} ${d.deals === 1 ? "deal" : "deals"} · ${money(d.contracted)} contracted · ${money(d.cash)} collected`}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Where the deal sources come from: the closer's own answer on the closing form. */
const DEALS_NOTE: Note = {
  level: "info",
  text: "Deal sources are what the closer wrote on the closing form. It is the only place a non-paid origin is ever named: every signed deal that carries a contact id traces back to a paid ad.",
};

/** How a contact is split between paid and content, with this window's tagged leads. */
function paidRuleNote(w: ContentWindow): Note {
  return {
    level: "info",
    text: `${count(w.totals.paidLeads)} of the ${count(w.totals.leads)} tagged leads in this window carry evidence of a paid ad, and ${count(w.totals.organicLeads)} came from content. A contact counts as paid when it carries an ad id, when GoHighLevel's attribution carries a Meta ad id, or when its own source text says "ads", so an "instagram ads" contact with no id is credited to the ads, not to the reel.`,
  };
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
    <div className="grid gap-4">
      <TimeframeBar
        tf={tf}
        bounds={shown.bounds}
        ariaLabel="Timeframe for what the content brings in"
        first={FIRST}
        last={last}
      />
      <SectionCard
        title="What the content brings in"
        section={section}
        notes={w ? [DEALS_NOTE, paidRuleNote(w)] : null}
        order={order}
      >
        {() =>
          !w ? (
            shown.error ? (
              <p className="text-sm text-[var(--ceo-critical)]">
                {shown.error}
              </p>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {`Reading ${label}`}
              </p>
            )
          ) : (
            <div className="grid gap-6">
              <div className="grid grid-cols-2 gap-x-6 gap-y-6 @xl:grid-cols-4">
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
            </div>
          )
        }
      </SectionCard>
    </div>
  );
}
