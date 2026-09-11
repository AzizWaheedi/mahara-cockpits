import { useQuery } from "convex/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { assistLabel, useAssist } from "@/components/useAssist";
import { api } from "../../convex/_generated/api";

/**
 * New client launches, as one job instead of a ClickUp scavenger hunt.
 *
 * The real checklist is spread across four subtasks. This flattens it, and
 * marks the steps that are ad-account work Viktor can execute — everything to
 * do with access, billing or a judgement call stays hers.
 */
/** Issue text with the form URL turned into a link. */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a
            key={`${i}-${p}`}
            href={p.replace(/[.,)]+$/, "")}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline"
          >
            the new-campaign form
          </a>
        ) : (
          <span key={`${i}-${p.slice(0, 12)}`}>{p}</span>
        ),
      )}
    </>
  );
}

export function Onboardings({
  onBuild,
}: {
  onBuild?: (client: string) => void;
}) {
  const rows = useQuery(api.cockpit.onboardings, {});
  // biome-ignore lint/suspicious/noExplicitAny: watch rows
  const watch = useQuery(api.cockpit.launchWatch, {}) as any[] | undefined;
  const [open, setOpen] = useState<string | null>(null);
  const [withMe, setWith] = useState<string | null>(null);

  // A client with a task, an account or live spend is a real launch in
  // motion. The rest are sheet rows left on "Launching" months ago — worth one
  // line, not 23 alarms. [aziz, 2026-09-07]
  const real = (watch ?? []).filter(
    w => (w.hasTask || w.accountId || w.spend7d > 0) && w.issues.length > 0,
  );
  const stale = (watch ?? []).filter(
    w => !w.hasTask && !w.accountId && w.spend7d === 0,
  );
  const problems = real;
  if ((!rows || rows.length === 0) && problems.length === 0) return null;

  return (
    <section className="mb-4 rounded-xl border bg-card p-4 shadow-sm">
      <h2 className="mb-1 text-[12px] font-bold uppercase tracking-widest text-teal-600">
        New client launches
      </h2>
      <p className="mb-3 text-[13px] text-muted-foreground">
        {(rows ?? []).length} waiting to go live. I can do the ad-account build;
        the access and billing steps are yours. Re-checked against the sheet,
        ClickUp and Meta on every sync.
      </p>

      {problems.length > 0 && (
        <div className="callout-warn mb-3 rounded-lg border p-2.5">
          <div className="text-[12px] font-bold uppercase tracking-wide">
            Launches that are stuck on something
          </div>
          <div className="mt-1.5 space-y-1.5">
            {problems.map(w => (
              <div key={w.client} className="text-[13px]">
                <span className="font-semibold">{w.client}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {w.sheetStatus}
                  {w.accountId ? ` · account ${w.accountId}` : ""}
                </span>
                <ul className="ml-3 mt-0.5 list-disc">
                  {w.issues.map((i: string) => (
                    <li key={i}>
                      <Linkified text={i} />
                    </li>
                  ))}
                </ul>
                {w.taskUrl && (
                  <a
                    className="text-[12px] underline"
                    href={w.taskUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    ClickUp task ↗
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {stale.length > 0 && (
        <details className="mb-3 rounded-lg border px-2.5 py-1.5 text-[13px]">
          <summary className="cursor-pointer text-muted-foreground">
            {stale.length} clients in Client Data are still marked Launching
            with no launch task and no ad account — almost certainly statuses
            nobody closed off.
          </summary>
          <div className="mt-1 text-[12px] text-muted-foreground">
            {stale.map(w => w.client).join(" · ")}
          </div>
        </details>
      )}

      <div className="space-y-2">
        {(rows ?? []).map(r => {
          const mine = r.groups
            .flatMap(g => g.items)
            .filter(i => i.viktorCanDo && !i.done).length;
          const isOpen = open === r.taskId;
          return (
            <div key={r.taskId} className="rounded-lg border">
              <div className="flex flex-wrap items-center justify-between gap-2 p-2.5">
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold">{r.client}</div>
                  <div className="text-[12px] text-muted-foreground">
                    {r.done} of {r.total} steps done
                    {mine > 0 && r.accountId && (
                      <span className="txt-good"> · {mine} I can do</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  {onBuild && r.accountId && (
                    <Button
                      size="sm"
                      className="h-7 text-[12px]"
                      onClick={() => onBuild(r.client)}
                    >
                      Build the campaign
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[12px]"
                    onClick={() => setOpen(isOpen ? null : r.taskId)}
                  >
                    {isOpen ? "Hide" : "Checklist"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[12px]"
                    onClick={() =>
                      setWith(withMe === r.client ? null : r.client)
                    }
                  >
                    {withMe === r.client ? "Close" : "Do it with me"}
                  </Button>
                  {r.taskUrl && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-[12px]"
                      asChild
                    >
                      <a href={r.taskUrl} target="_blank" rel="noreferrer">
                        ClickUp
                      </a>
                    </Button>
                  )}
                </div>
              </div>

              {!r.accountId && (
                <div className="callout-warn border-t px-2.5 py-2 text-[13px]">
                  <strong>Blocked before anything can be built.</strong>{" "}
                  {r.accountName
                    ? `Client Data names the ad account "${r.accountName}", but no Meta account of ours matches that name — either it is spelled differently in Meta or it has not been shared with us.`
                    : `There is no ad account for ${r.client} in the Client Data sheet, so nothing here can be automated. Fill that cell first.`}
                </div>
              )}
              {r.accountId && r.accountIdSource === "meta" && (
                <div className="border-t px-2.5 py-1.5 text-[12px] text-muted-foreground">
                  Ad account {r.accountId}, matched from the name in Client Data
                  on the last sync.
                </div>
              )}

              {withMe === r.client && <LaunchWithMe client={r.client} />}

              {isOpen && (
                <div className="border-t p-2.5 pt-2">
                  {r.groups.map(g => (
                    <div key={g.name} className="mb-2.5 last:mb-0">
                      <div className="mb-1 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
                        {g.name}
                      </div>
                      <ul className="space-y-1">
                        {g.items.map(i => (
                          <li
                            key={i.name}
                            className="flex items-start gap-1.5 text-[13px]"
                          >
                            <span
                              className={
                                i.done ? "txt-good" : "text-muted-foreground"
                              }
                            >
                              {i.done ? "✓" : "○"}
                            </span>
                            <span className={i.done ? "opacity-60" : ""}>
                              {i.name}
                            </span>
                            {i.viktorCanDo && !i.done && (
                              <span className="tone-good shrink-0 rounded px-1 text-[11px] font-semibold">
                                I can do this
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * "Set this launch up with me."
 *
 * She should not have to know which of the twenty steps Viktor can do. She
 * tells him what the client sells and drops the Drive links; he checks what is
 * actually missing, loads the creatives into the ad account, writes the copy
 * off ads that already win for that service line, and hands back a list of
 * what is left. Nothing goes live — the build is still her click.
 */
function LaunchWithMe({ client }: { client: string }) {
  const launch = useAssist("launch");
  const [brief, setBrief] = useState("");
  const [links, setLinks] = useState("");
  const row = launch.row;

  return (
    <div className="border-t bg-muted/30 p-2.5">
      <div className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
        Set this launch up with me
      </div>
      <p className="mb-2 mt-0.5 text-[12px] text-muted-foreground">
        Tell me what they sell and who they want, drop the creative links, and
        I'll take it as far as I can: check what's missing, load the creatives
        into the ad account, and write the copy. You build it from there.
      </p>
      <textarea
        className="w-full resize-y rounded border bg-background p-1.5 text-[13px]"
        rows={3}
        placeholder="What do they sell, who is it for, which city, any offer we agreed? Anything you'd tell a new media buyer."
        value={brief}
        onChange={e => setBrief(e.target.value)}
      />
      <input
        className="mt-1.5 w-full rounded border bg-background p-1.5 text-[13px]"
        placeholder="Drive links to the creatives, separated by spaces (optional)"
        value={links}
        onChange={e => setLinks(e.target.value)}
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="h-7 text-[12px]"
          disabled={launch.waiting}
          onClick={() =>
            launch.ask({
              client,
              brief,
              driveLinks: links
                .split(/[\s,]+/)
                .map(x => x.trim())
                .filter(Boolean),
            })
          }
        >
          {launch.waiting ? "Working on it…" : "Take it as far as you can"}
        </Button>
        {assistLabel(row, launch.waiting) && (
          <span className="text-[12px] text-muted-foreground">
            {assistLabel(row, launch.waiting)}
          </span>
        )}
      </div>

      {row?.note && (
        <p className="mt-2 rounded bg-background p-2 text-[13px]">{row.note}</p>
      )}
      {(row?.steps ?? []).length > 0 && (
        <ul className="mt-2 space-y-1">
          {row?.steps?.map(st => (
            <li key={st.label} className="flex items-start gap-1.5 text-[13px]">
              <span
                className={
                  st.state === "done"
                    ? "txt-good"
                    : st.state === "blocked"
                      ? "txt-bad"
                      : "text-muted-foreground"
                }
              >
                {st.state === "done" ? "✓" : st.state === "blocked" ? "×" : "○"}
              </span>
              <span>
                {st.label}
                {st.detail && (
                  <span className="text-muted-foreground"> — {st.detail}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {(row?.variants ?? []).length > 0 && (
        <div className="mt-2 space-y-1.5">
          <div className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
            Copy, ready for the builder
          </div>
          {row?.variants?.map(v => (
            <div
              key={v.headline}
              className="rounded border bg-background p-2 text-[13px]"
            >
              {v.angle && (
                <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  {v.angle}
                </div>
              )}
              <div className="font-semibold" dir="auto">
                {v.headline}
              </div>
              <div dir="auto" className="whitespace-pre-wrap">
                {v.message}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
