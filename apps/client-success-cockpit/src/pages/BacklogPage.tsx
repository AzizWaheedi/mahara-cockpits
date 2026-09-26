import { useMutation, useQuery } from "convex/react";
import { ArrowUpRight } from "lucide-react";
import { ExtLink, PageHeader } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { api } from "../../convex/_generated/api";

// biome-ignore lint/suspicious/noExplicitAny: gap rows
type Any = any;

const GAP_NAMES: Record<string, string> = {
  sheet_link: "No stat sheet",
  sheet_access: "Sheet unreadable",
  ghl: "No GHL account",
  ghl_error: "GHL unreadable",
  call: "No recorded call",
  csm: "No CSM",
};

/**
 * Data backlog: every active client whose card is missing an input, with the
 * fix. One click queues it as a task on the Client Success list in ClickUp;
 * the media buyer backend sends queued tasks every five minutes.
 */
export function BacklogPage() {
  const data = useQuery(api.gaps.list, {});
  const queue = useMutation(api.gaps.queue);
  if (!data)
    return (
      <p className="mx-auto w-full max-w-6xl text-sm text-muted-foreground">
        Loading…
      </p>
    );
  const { rows, counts, activeClients } = data as Any;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <PageHeader
        title="Data backlog"
        sub={`${rows.length} of ${activeClients} active clients are missing something the cockpit needs. Queue a fix and it becomes a ClickUp task on the Client Success list.`}
      >
        {/* Only the gaps that exist: a chip reading "0" says nothing. */}
        <ul className="mt-3 flex flex-wrap gap-2 text-xs">
          {Object.entries(counts as Record<string, number>)
            .filter(([, n]) => n > 0)
            .map(([k, n]) => (
              <li key={k} className="rounded-full border px-2.5 py-0.5">
                {GAP_NAMES[k] ?? k}{" "}
                <span className="tabular-nums text-muted-foreground">{n}</span>
              </li>
            ))}
        </ul>
      </PageHeader>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
          Every active client has a sheet, a GHL account, a CSM and a recent
          call.
        </p>
      ) : (
        <ul className="space-y-3">
          {(rows as Any[]).map(r => (
            <li
              key={r.taskId}
              className="rounded-2xl border bg-card p-4 sm:p-6"
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <a
                  href={`https://app.clickup.com/t/${r.taskId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-semibold underline-offset-4 hover:underline"
                >
                  {r.clientName}
                  <ArrowUpRight
                    aria-hidden
                    className="size-3.5 text-muted-foreground"
                  />
                </a>
                <span className="text-xs text-muted-foreground">
                  {r.bucket
                    ? String(r.bucket).charAt(0).toUpperCase() +
                      String(r.bucket).slice(1)
                    : ""}
                </span>
                {r.csm ? (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {r.csm}
                  </span>
                ) : null}
              </div>
              <ul className="mt-3 divide-y">
                {(r.gaps as Any[]).map(g => (
                  <li
                    key={g.gap}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 text-sm last:pb-0"
                  >
                    <div className="min-w-0 flex-1 basis-60">
                      <p className="font-medium">{g.label}</p>
                      <p className="text-muted-foreground">{g.fix}</p>
                    </div>
                    {g.sent && g.resultUrl ? (
                      <ExtLink href={g.resultUrl} className="text-xs">
                        In ClickUp
                      </ExtLink>
                    ) : g.error ? (
                      <span className="text-xs txt-bad">Failed: {g.error}</span>
                    ) : g.queued ? (
                      <span className="text-xs text-muted-foreground">
                        Queued
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          queue({
                            taskId: r.taskId,
                            clientName: r.clientName,
                            label: g.label,
                            fix: g.fix,
                          })
                        }
                      >
                        Queue in ClickUp
                      </Button>
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
