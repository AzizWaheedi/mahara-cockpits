import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { fetchBacklog, queueGap } from "@/lib/backlog";

// biome-ignore lint/suspicious/noExplicitAny: gap rows
type Any = any;

const GAP_NAMES: Record<string, string> = {
  sheet_link: "no stat sheet",
  sheet_access: "sheet unreadable",
  ghl: "no GHL account",
  ghl_error: "GHL unreadable",
  call: "no recorded call",
  csm: "no CSM",
};

/**
 * Data backlog: every active client whose card is missing an input, with the
 * fix. One click queues it as a task on the Client Success list in ClickUp;
 * the media buyer backend sends queued tasks every five minutes.
 */
export function BacklogPage() {
  const auth = useCockpitAuth();
  const [data, setData] = useState<Any | null>(null);

  const loadData = useCallback(() => {
    if (!auth.client) return;
    fetchBacklog(auth.client, auth.clients)
      .then(setData)
      .catch(err => {
        console.error("fetchBacklog error", err);
        setData({ rows: [], counts: {}, activeClients: 0 });
      });
  }, [auth.client, auth.clients]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleQueue = async (args: {
    taskId?: string;
    clientName: string;
    label: string;
    fix: string;
  }) => {
    if (!auth.client) return;
    try {
      await queueGap(auth.client, auth.email, args);
      toast.success(`Queued task for ${args.clientName}`);
      loadData();
    } catch (e) {
      toast.error(String(e));
    }
  };

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const { rows, counts, activeClients } = data as Any;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Data backlog</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {rows.length} of {activeClients} active clients are missing something
          the cockpit needs. Queue a fix and it becomes a ClickUp task on the
          Client Success list.
        </p>
        <ul className="mt-2 flex flex-wrap gap-2 text-[12px]">
          {Object.entries(counts as Record<string, number>).map(([k, n]) => (
            <li key={k} className="rounded-full border px-2.5 py-0.5">
              {GAP_NAMES[k] ?? k} · {n}
            </li>
          ))}
        </ul>
      </header>

      {rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Every active client has a sheet, a GHL account, a CSM and a recent
          call.
        </p>
      ) : (
        <ul className="space-y-3">
          {(rows as Any[]).map(r => (
            <li
              key={r.taskId}
              className="rounded-xl border bg-card p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <a
                  href={`https://app.clickup.com/t/${r.taskId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold hover:underline"
                >
                  {r.clientName}
                </a>
                <span className="text-[12px] text-muted-foreground">
                  {r.bucket}
                </span>
                {r.csm ? (
                  <span className="ml-auto text-[12px] text-muted-foreground">
                    {r.csm}
                  </span>
                ) : null}
              </div>
              <ul className="mt-2 divide-y">
                {(r.gaps as Any[]).map(g => (
                  <li
                    key={g.gap}
                    className="flex flex-wrap items-start gap-3 py-2 text-[13px]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{g.label}</p>
                      <p className="text-muted-foreground">{g.fix}</p>
                    </div>
                    {g.sent && g.resultUrl ? (
                      <a
                        href={g.resultUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[12px] text-primary underline"
                      >
                        In ClickUp
                      </a>
                    ) : g.error ? (
                      <span className="text-[12px] text-red-600">
                        failed: {g.error}
                      </span>
                    ) : g.queued ? (
                      <span className="text-[12px] text-muted-foreground">
                        queued
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="rounded-md border px-2.5 py-1 text-[12px] hover:bg-muted"
                        onClick={() =>
                          handleQueue({
                            taskId: r.taskId,
                            clientName: r.clientName,
                            label: g.label,
                            fix: g.fix,
                          })
                        }
                      >
                        Queue in ClickUp
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
