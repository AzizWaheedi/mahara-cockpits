import { useMemo, useState } from "react";
import { FilterChips } from "@/components/ceo/FilterChips";
import { AnimatedSelect } from "@/components/ui/animated-select";
import {
  MORNING_GROUPS,
  type MorningGroupKey,
  morningGroups,
  plural,
  stampText,
  waitingText,
} from "@/lib/resultsModel";
import {
  fetchMorning,
  type Morning,
  type UncalledLead,
  useRead,
} from "@/lib/resultsReads";
import { cn } from "@/lib/utils";
import {
  Notice,
  OutLink,
  Problem,
  ResultCard,
  RowsSkeleton,
  SourceNote,
  StateChip,
} from "./ResultsKit";

/** Leads shown in a group before "Show the other N". */
const FIRST = 5;

/**
 * Leads with no call linked to them (Muhammed, 2026-10-21): three groups, each with its count and its
 * leads, the longest waiting first. Never called is the one to call first. Result saved, no call, and
 * Probably called (a call to the same number exists) are where our numbers look worse than the day was.
 * The groups are cockpit_morning_uncalled_read's, and they equal the board's own counts: Never called is
 * its untouched leads and Result saved its outcome-only leads; Probably called is part of what the board
 * counts as called. Read only: it calls and messages no one.
 */
export function MorningList({ className }: { className?: string }) {
  const read = useRead("morning", () => fetchMorning(null));
  const [paidOnly, setPaidOnly] = useState(false);
  const [location, setLocation] = useState<string | null>(null);
  const data = read.status === "ready" ? read.data : read.status === "error" ? read.data : undefined;
  const groups = useMemo(
    () => morningGroups(data?.leads ?? [], { paidOnly, location }),
    [data, paidOnly, location],
  );
  const counts = {
    never_called: groups.never_called.length,
    outcome_only: groups.outcome_only.length,
    phone_only: groups.phone_only.length,
  };
  const total = counts.never_called + counts.outcome_only + counts.phone_only;
  const unfiltered = !paidOnly && location === null;
  const withLeads = (data?.clients ?? []).filter(c => c.noCallLinked > 0);

  return (
    <ResultCard
      id="morning-list"
      kicker="This morning"
      title="Leads with no call linked"
      className={className}
      aside={
        data ? (
          <p className="text-right text-xs text-muted-foreground tabular-nums">
            <span className="block text-xl font-semibold leading-7 text-foreground">
              {total}
            </span>
            {plural(data.totals.callable, "callable lead")}
          </p>
        ) : undefined
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <FilterChips
          ariaLabel="Which leads"
          value={paidOnly ? "paid" : "all"}
          onChange={k => setPaidOnly(k === "paid")}
          options={[
            { key: "all", label: "All leads" },
            { key: "paid", label: "Paid ads only" },
          ]}
        />
        <AnimatedSelect
          aria-label="Client"
          className="ceo-select-sm"
          value={location ?? "all"}
          onChange={e => setLocation(e.target.value === "all" ? null : e.target.value)}
        >
          <option value="all">All clients</option>
          {withLeads.map(c => (
            <option key={c.locationId} value={c.locationId}>
              {c.clientName} ({c.noCallLinked})
            </option>
          ))}
        </AnimatedSelect>
      </div>

      <div className="mt-4">
        {read.status === "loading" ? <RowsSkeleton rows={5} /> : null}
        {read.status === "error" ? (
          <Problem message={read.message} onRetry={read.reload} />
        ) : null}
        {data && total === 0 ? (
          <Notice
            title={
              unfiltered
                ? "Every callable lead has a call linked"
                : "No lead matches this pick"
            }
            text={
              unfiltered
                ? "Nothing fell through. This list fills as new leads arrive."
                : "Choose all leads or all clients to see the rest."
            }
          />
        ) : null}
        {data && total > 0 ? (
          <div className="grid gap-4 lg:grid-cols-3">
            {MORNING_GROUPS.map(g => (
              <Group
                key={g.key}
                group={g.key}
                title={g.title}
                hint={g.hint}
                leads={groups[g.key]}
                showClient={location === null}
              />
            ))}
          </div>
        ) : null}
      </div>

      {data ? <Tie data={data} unfiltered={unfiltered} /> : null}
    </ResultCard>
  );
}

function Group({
  group,
  title,
  hint,
  leads,
  showClient,
}: {
  group: MorningGroupKey;
  title: string;
  hint: string;
  leads: UncalledLead[];
  showClient: boolean;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? leads : leads.slice(0, FIRST);
  return (
    <section
      aria-labelledby={`morning-${group}`}
      className="min-w-0 rounded-xl bg-muted/40 p-4"
    >
      <h3 id={`morning-${group}`} className="flex items-baseline gap-2 text-sm font-semibold">
        {title}
        <span className="font-normal tabular-nums text-muted-foreground">
          {leads.length}
        </span>
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p>
      {leads.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">None right now.</p>
      ) : (
        <ul className="mt-3 divide-y">
          {shown.map(l => (
            <LeadLine key={`${l.locationId}:${l.contactId}`} lead={l} showClient={showClient} />
          ))}
        </ul>
      )}
      {leads.length > FIRST ? (
        <button
          type="button"
          onClick={() => setAll(a => !a)}
          aria-expanded={all}
          className="mt-3 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {all ? "Show fewer" : `Show the other ${leads.length - FIRST}`}
        </button>
      ) : null}
    </section>
  );
}

function LeadLine({ lead: l, showClient }: { lead: UncalledLead; showClient: boolean }) {
  const waited = waitingText(l.hoursWaiting);
  const detail = [
    waited ? `${waited} ago` : null,
    l.phoneLast4 ? `ends ${l.phoneLast4}` : null,
    l.group === "outcome_only" && l.lastOutcome ? `saved: ${l.lastOutcome.toLowerCase()}` : null,
    l.group === "phone_only" && l.lastCallAt ? `same number called ${stampText(l.lastCallAt)}` : null,
  ].filter(Boolean);
  return (
    <li className="py-2.5 text-sm first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 font-medium">
          {l.firstName || "Lead"}
          {showClient ? (
            <span className="font-normal text-muted-foreground"> · {l.clientName}</span>
          ) : null}
        </p>
        {l.paid ? <StateChip tone="accent">Paid ad</StateChip> : null}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className={cn("min-w-0 text-xs text-muted-foreground")}>{detail.join(" · ")}</p>
        {l.contactUrl ? (
          <OutLink href={l.contactUrl} className="text-xs">
            Open in CRM
          </OutLink>
        ) : null}
      </div>
    </li>
  );
}

/** Where the groups meet the board's own counts, and what that says. */
function Tie({ data, unfiltered }: { data: Morning; unfiltered: boolean }) {
  const t = data.totals;
  const differs = data.clients.filter(c => c.matchesBoard === false);
  return (
    <SourceNote>
      A lead is listed when it is one of the last 30 days' callable leads (a Kuwait, Saudi, UAE or Qatar
      number, not a WhatsApp chat, and at least one working hour old) and no call the caller saved is linked to
      it. Done-with-you clients are left out, as on the board.{" "}
      {unfiltered
        ? `Never called (${t.neverCalled}) and Result saved, no call (${t.outcomeOnly}) equal the board's untouched and outcome-only counts. The board counts Probably called (${t.phoneOnly}) as called, because a call to the same number exists. ${
            differs.length === 0
              ? t.matchesBoard
                ? "Every client agrees with the board."
                : "The board holds no figure for these clients yet."
              : `${plural(differs.length, "client")} differ from the board (${differs.map(c => c.clientName).join(", ")}): the board refreshes every 30 minutes, so a lead called since then can make them differ by a few.`
          }`
        : "The board's own counts include leads from every source and every client, so they are shown on the full list only."}{" "}
      As of {stampText(data.asOf)} Kuwait time.
    </SourceNote>
  );
}
