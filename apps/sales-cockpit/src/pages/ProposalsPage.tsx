import { FileText } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";
import { EmptyState, Failed, SectionCard } from "../components/kit";
import { ProposalChip } from "../components/ProposalPanel";
import { useScope } from "../components/Scope";
import { useLeadsById, useProposals } from "../lib/data";
import { ago } from "../lib/format";
import type { Me } from "../lib/types";

/** Every proposal in flight: the closer's own, or the team's for a manager. */
export default function ProposalsPage({ me }: { me: Me }) {
  const { scope, ScopeSwitch } = useScope(me);
  const proposals = useProposals(scope === "mine" ? (me.email ?? "") : null);
  const ids = (proposals.data ?? [])
    .map(p => p.contact_id)
    .filter((x): x is string => Boolean(x));
  const leads = useLeadsById(ids);
  const names = useMemo(
    () => new Map((leads.data ?? []).map(l => [l.contact_id, l.name])),
    [leads.data],
  );
  const list = proposals.data ?? [];
  const waiting = list.filter(
    p => p.status === "needs_input" || p.status === "ready",
  );
  const rest = list.filter(
    p => !(p.status === "needs_input" || p.status === "ready"),
  );

  const rows = (items: typeof list) => (
    <ul className="divide-y hairline">
      {items.map(p => (
        <li key={p.id}>
          <Link
            to={`/proposal/${p.id}`}
            className="flex items-center gap-3 px-4 py-3 hover:bg-[color:var(--secondary)]"
          >
            <FileText className="muted size-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium" dir="auto">
                {names.get(p.contact_id ?? "") ?? "A lead"}
              </p>
              <p className="muted text-xs">
                {p.lang === "ar" ? "Arabic" : "English"} ·{" "}
                {p.created_by.split("@")[0]} · {ago(p.updated_at)}
              </p>
            </div>
            <ProposalChip p={p} />
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <main className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Proposals</h1>
          <p className="muted text-sm">
            Drafted from the demo call by the proposal writer. Open one to fill
            any blanks, read it, download the PDF and mark it sent.
          </p>
        </div>
        {ScopeSwitch}
      </header>
      {proposals.error ? (
        <Failed
          what="Proposals"
          error={proposals.error}
          retry={proposals.reload}
        />
      ) : !list.length && !proposals.loading ? (
        <SectionCard title="Nothing yet">
          <EmptyState
            icon={FileText}
            title="No proposals yet"
            text="Open a lead after the demo and choose Draft proposal. It takes about ten minutes."
          />
        </SectionCard>
      ) : (
        <>
          {waiting.length ? (
            <SectionCard title="Waiting on you" flush>
              {rows(waiting)}
            </SectionCard>
          ) : null}
          {rest.length ? (
            <SectionCard title="Everything else" flush>
              {rows(rest)}
            </SectionCard>
          ) : null}
        </>
      )}
    </main>
  );
}
