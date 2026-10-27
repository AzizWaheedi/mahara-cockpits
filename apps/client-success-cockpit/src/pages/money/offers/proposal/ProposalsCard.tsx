import { useEffect, useState } from "react";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { Button } from "@/components/ui/button";
import { ProposalCard } from "./ProposalCard";
import { type ProposalCardRow, readProposals } from "./proposalSources";

export function ProposalsCard({ taskId }: { taskId: string }) {
  const { client } = useCockpitAuth();
  const [rows, setRows] = useState<ProposalCardRow[] | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh is the explicit user-requested reload generation.
  useEffect(() => {
    if (!client) return;
    let active = true;
    setError("");
    setRows(null);
    void readProposals(client, taskId)
      .then(out => {
        if (active) setRows(out.rows);
      })
      .catch(e => {
        if (active)
          setError(
            e instanceof Error
              ? e.message
              : "Proposals did not load. Try again.",
          );
      });
    return () => {
      active = false;
    };
  }, [client, taskId, refresh]);
  return (
    <section className="rounded-2xl border bg-card p-4 sm:p-6">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">Proposals</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRefresh(x => x + 1)}
        >
          Refresh
        </Button>
      </header>
      {error ? (
        <p role="alert" className="mt-4 text-sm">
          {error}
        </p>
      ) : !rows ? (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          Loading proposals
        </p>
      ) : rows.length ? (
        <div className="mt-2 divide-y">
          {rows.map(row => (
            <ProposalCard key={row.id} taskId={taskId} row={row} />
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          Proposals you prepare for this client appear here. Start with Make a
          proposal above.
        </p>
      )}
    </section>
  );
}
