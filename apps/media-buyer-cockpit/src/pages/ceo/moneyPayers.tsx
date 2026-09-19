import { useAction, useQuery } from "convex/react";
import { UserSearch } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { money, pct, plural } from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import { StatusChip } from "@/components/ceo/StatusChip";
import { api } from "../../../convex/_generated/api";
import type { PayerList, UnmappedPayer } from "../../../convex/ceo/payers";

/**
 * Say who each unattributed Whop payer is.
 *
 * Two thirds of collected cash reaches no client, and it cannot be fixed by
 * matching harder: the payer is a person and the client is a company. The
 * cockpit suggests a card only where the names plainly agree, which on the
 * first live run was 3 payers out of 50. The other 47 are a short list of
 * decisions only somebody who was there can make.
 */
export function PayerMappingCard({ order }: { order?: number }) {
  const load = useAction(api.ceo.payers.list);
  const assign = useAction(api.ceo.payers.assign);
  const cards = useQuery(api.ceo.manualPayments.clientOptions, {}) ?? [];

  const [data, setData] = useState<PayerList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setData(await load({}));
      setError(null);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e).slice(0, 240));
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function save(p: UnmappedPayer, taskId: string | null) {
    setBusy(p.payer);
    try {
      await assign({ payer: p.payer, clickupTaskId: taskId });
      await refresh();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e).slice(0, 240));
    }
    setBusy(null);
  }

  if (error && !data)
    return (
      <SectionCard title="Who these payers are" order={order}>
        {() => (
          <EmptyState
            title="Could not read the payers"
            text={error}
            icon={UserSearch}
          />
        )}
      </SectionCard>
    );
  if (!data) return null;

  const rows = showAll ? data.payers : data.payers.slice(0, 15);
  const share = data.totalUsd > 0 ? data.mappedUsd / data.totalUsd : null;

  return (
    <SectionCard
      id="money-payers"
      kicker="Cash that reaches no client, biggest first"
      title="Who these payers are"
      order={order}
    >
      {() => (
        <div className="grid gap-5">
          <p className="text-sm text-muted-foreground">
            Whop records who paid, not which client they paid for, and the payer
            is usually a person while the client is a company. That cannot be
            matched automatically, so the cockpit suggests a card only where the
            names plainly agree and leaves the rest to you. Saying who someone
            is here attributes every payment they have ever made, and every one
            they make from now on.
          </p>

          <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
            <StatTile
              variant="plain"
              label="Cash reaching no client"
              value={money(data.totalUsd)}
              sub={plural(data.payers.length, "payer")}
              status={<StatusChip tone="serious" label="Unattributed" />}
            />
            <StatTile
              variant="plain"
              label="Now attributed"
              value={money(data.mappedUsd)}
              sub={share === null ? undefined : `${pct(share)} of it`}
              hint="Money the mappings below have given a client."
            />
            <StatTile
              variant="plain"
              label="Still to say"
              value={money(data.totalUsd - data.mappedUsd)}
              sub={`${data.payers.filter(p => !p.mapped).length} payers`}
            />
          </div>

          {data.canAssign ? null : (
            <p className="rounded-md border border-[var(--ceo-warning)] p-3 text-sm">
              Assigning is not switched on yet: the payer table does not exist.
              Run <code>supabase/migrations/20260919_cockpit_core.sql</code> in
              the Creative Triage SQL editor and this list becomes clickable.
              The figures above are live either way.
            </p>
          )}

          <div className="overflow-x-auto rounded-md border">
            <table
              className="w-full text-sm"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="p-2 font-medium">Payer</th>
                  <th className="p-2 text-right font-medium">Cash</th>
                  <th className="p-2 font-medium">Is this client</th>
                  <th className="p-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map(p => {
                  const picked =
                    draft[p.payer] ??
                    p.mapped?.clickupTaskId ??
                    p.suggestion?.clickupTaskId ??
                    "";
                  return (
                    <tr key={p.payer} className="border-t align-top">
                      <td className="p-2">
                        {p.payer}
                        <span className="block text-xs text-muted-foreground">
                          {`${plural(p.payments, "payment")} · ${p.firstMonth}${p.lastMonth === p.firstMonth ? "" : ` to ${p.lastMonth}`}`}
                        </span>
                      </td>
                      <td className="p-2 text-right">{money(p.usd)}</td>
                      <td className="p-2">
                        <select
                          id={`payer-${p.payer}`}
                          value={picked}
                          disabled={!data.canAssign || busy === p.payer}
                          onChange={e =>
                            setDraft(d => ({ ...d, [p.payer]: e.target.value }))
                          }
                          className="w-full min-w-48 rounded-md border bg-background px-2 py-1 text-sm"
                        >
                          <option value="">—</option>
                          {cards.map(c => (
                            <option
                              key={c.clickupTaskId}
                              value={c.clickupTaskId}
                            >
                              {c.name}
                            </option>
                          ))}
                        </select>
                        {p.mapped ? (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            saved
                          </span>
                        ) : p.suggestion ? (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {`suggested: ${p.suggestion.why}`}
                          </span>
                        ) : null}
                      </td>
                      <td className="p-2">
                        <button
                          type="button"
                          disabled={
                            !data.canAssign || busy === p.payer || !picked
                          }
                          onClick={() => save(p, picked || null)}
                          className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-40"
                        >
                          {busy === p.payer
                            ? "…"
                            : p.mapped
                              ? "Change"
                              : "Save"}
                        </button>
                        {p.mapped ? (
                          <button
                            type="button"
                            disabled={busy === p.payer}
                            onClick={() => save(p, null)}
                            className="ml-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                          >
                            Clear
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {data.payers.length > 15 ? (
            <button
              type="button"
              onClick={() => setShowAll(v => !v)}
              className="justify-self-start text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {showAll
                ? "Show the biggest 15"
                : `Show all ${data.payers.length} payers`}
            </button>
          ) : null}

          {error ? (
            <p className="text-sm text-[var(--ceo-critical)]">{error}</p>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}
