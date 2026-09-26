import { useQuery } from "convex/react";
import { ArrowUpRight, ChevronRight, Filter } from "lucide-react";
import { useState } from "react";
import { api } from "@/../convex/_generated/api";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";

/**
 * Funnels and lead forms.
 *
 * Aziz, 2026-09-07: the creative director scripts the funnels too, and the questions on the form
 * are the lever for lead quality. So this is the destination behind every live
 * ad: the instant form with its exact questions, the landing page, or the
 * WhatsApp thread, with 30 day spend and cost per lead joined on Ad ID.
 *
 * Everything here is read from Meta. Cost per lead is what Meta reports, not a
 * quality score: we cannot see from Meta whether a lead was qualified, so this
 * page never claims to.
 */

/** Long lists open 50 at a time. */
const PAGE = 50;

function money(n?: number | null): string {
  if (n === null || n === undefined) return "n/a";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/** The colour sits on the dot only; the label stays plain. */
const KIND_DOT: Record<string, string> = {
  "Instant form": "var(--success)",
  "Stays on the post": "var(--warning)",
};

function KindPill({ kind }: { kind: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium">
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ background: KIND_DOT[kind] ?? "var(--muted-foreground)" }}
      />
      {kind}
    </span>
  );
}

// biome-ignore lint/suspicious/noExplicitAny: query payload is untyped
export function FunnelRow({ r }: { r: any }) {
  const [open, setOpen] = useState(false);
  const gates = r.questions.filter((q: { isGate: boolean }) => q.isGate);
  const contact = r.questions.filter((q: { isGate: boolean }) => !q.isGate);
  return (
    <div className="rounded-xl border bg-card">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left"
        onClick={() => setOpen(o => !o)}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <ChevronRight
            aria-hidden
            className={`size-4 shrink-0 text-muted-foreground motion-safe:transition-transform ${
              open ? "rotate-90" : ""
            }`}
          />
          <KindPill kind={r.kind} />
          <span className="min-w-0 truncate text-sm font-semibold" dir="auto">
            {r.formName || r.url || r.account}
          </span>
        </span>
        <span className="flex basis-full flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-xs text-muted-foreground sm:basis-auto sm:pl-0">
          <span dir="auto">{r.account}</span>
          <span>
            {r.ads.length} live ad{r.ads.length === 1 ? "" : "s"}
          </span>
          <span>{money(r.spend)} in 30d</span>
          <span>{r.leads} leads</span>
          <span className="font-semibold text-foreground tabular-nums">
            {r.cpl ? `$${r.cpl} CPL` : "no leads"}
          </span>
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t px-4 py-4 text-sm">
          {r.headline && (
            <p>
              <span className="text-muted-foreground">Form headline: </span>
              <span dir="auto">{r.headline}</span>
            </p>
          )}

          {r.kind === "Instant form" ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Filter className="size-3.5 text-muted-foreground" />
                <span className="font-semibold">
                  {gates.length} filtering question
                  {gates.length === 1 ? "" : "s"}
                </span>
                {gates.length === 0 && (
                  <span className="txt-bad font-medium">
                    nothing filters this form, every click becomes a lead
                  </span>
                )}
              </div>
              <ol className="ml-5 list-decimal space-y-1.5">
                {gates.map((q: { label: string; options: string[] }) => (
                  <li key={q.label}>
                    <span dir="auto">{q.label}</span>
                    {q.options.length > 0 && (
                      <span className="block text-muted-foreground" dir="auto">
                        {q.options.join(" · ")}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
              {contact.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Then it asks for:{" "}
                  {contact.map((q: { label: string }) => q.label).join(", ")}.
                </p>
              )}
              {r.leadsAllTime ? (
                <p className="text-xs text-muted-foreground">
                  {r.leadsAllTime} leads through this form all time.
                </p>
              ) : null}
              {r.followUpUrl && (
                <a
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  href={r.followUpUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Where it sends them after submitting
                  <ArrowUpRight className="size-3.5" />
                </a>
              )}
            </div>
          ) : r.url ? (
            <a
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              href={r.url}
              target="_blank"
              rel="noreferrer"
            >
              Open the page the ads point at
              <ArrowUpRight className="size-3.5" />
            </a>
          ) : (
            <p className="text-muted-foreground">
              These ads keep people on the post, so there is no form and no page
              to script. Leads arrive as comments or messages.
            </p>
          )}

          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              Ads pointing here
            </p>
            <ul className="mt-1.5 space-y-1">
              {r.ads.map(
                (a: { adId: string; adName: string; status: string }) => (
                  <li
                    key={a.adId}
                    className="flex flex-wrap items-baseline gap-x-2"
                  >
                    <span dir="auto" className="min-w-0 break-words">
                      {a.adName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {a.status.toLowerCase().replace(/_/g, " ")}
                    </span>
                  </li>
                ),
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

export function FunnelsPage() {
  const data = useQuery(api.funnels.list, {});
  const [rowsShown, setRowsShown] = useState(PAGE);
  const [bankShown, setBankShown] = useState(PAGE);
  if (!data)
    return (
      <div className="mx-auto w-full max-w-6xl text-sm text-muted-foreground">
        Loading…
      </div>
    );

  const rowsLeft = data.rows.length - rowsShown;
  const bankLeft = data.questionBank.length - bankShown;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Funnels and lead forms"
        sub={`Where the leads come in for every live ad we run: ${data.counts.destinations} destinations across ${data.counts.accounts} ad accounts, read straight from Meta.`}
        actions={
          data.counts.noGate > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium">
              <span
                aria-hidden
                className="size-1.5 rounded-full bg-destructive"
              />
              {data.counts.noGate} form
              {data.counts.noGate === 1 ? " asks" : "s ask"} nothing that
              filters a lead
            </span>
          ) : undefined
        }
      />

      <div className="space-y-6">
        <section className="rounded-2xl border bg-card p-4 sm:p-6">
          <h2 className="text-[15px] font-semibold">
            Does asking more actually cost more
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Instant forms grouped by how many filtering questions they ask, last
            30 days. Cost per lead is Meta's number. Whether those leads
            qualified is not in Meta, so this tells you the price of a filter,
            not the quality of the lead.
          </p>
          <div className="@container mt-4">
            <div className="grid grid-cols-2 gap-4 @2xl:grid-cols-4">
              {data.byGates.map(
                // biome-ignore lint/suspicious/noExplicitAny: untyped payload
                (b: any) => (
                  <div key={b.gates} className="rounded-xl bg-muted/40 p-4">
                    <p className="text-xs text-muted-foreground">
                      {b.gates} filtering question{b.gates === "1" ? "" : "s"}
                    </p>
                    <p className="mt-1 whitespace-nowrap text-2xl font-semibold tracking-tight tabular-nums">
                      {b.cpl ? `$${b.cpl}` : "n/a"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      per lead · {b.forms} form{b.forms === 1 ? "" : "s"} ·{" "}
                      {b.leads} leads
                    </p>
                  </div>
                ),
              )}
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-[15px] font-semibold">
            Every destination we run
          </h2>
          <div className="space-y-2">
            {/* biome-ignore lint/suspicious/noExplicitAny: untyped payload */}
            {data.rows.slice(0, rowsShown).map((r: any) => (
              <FunnelRow
                key={`${r.account}-${r.formId || r.url || r.kind}`}
                r={r}
              />
            ))}
          </div>
          {rowsLeft > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => setRowsShown(n => n + PAGE)}
            >
              Show {Math.min(PAGE, rowsLeft)} more
            </Button>
          )}
        </section>

        <section className="overflow-hidden rounded-2xl border bg-card">
          <div className="p-4 sm:px-6 sm:pt-6">
            <h2 className="text-[15px] font-semibold">The question bank</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Every filtering question already live somewhere in the account,
              with its answer options. Build a new form out of these instead of
              writing questions from scratch.
            </p>
          </div>
          <div className="divide-y border-t">
            {data.questionBank.slice(0, bankShown).map(
              // biome-ignore lint/suspicious/noExplicitAny: untyped payload
              (q: any) => (
                <div key={q.label} className="px-4 py-3 text-sm sm:px-6">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <strong className="font-semibold" dir="auto">
                      {q.label}
                    </strong>
                    <span className="text-xs text-muted-foreground">
                      live on {q.accounts.length} account
                      {q.accounts.length === 1 ? "" : "s"} · {q.leads} leads ·{" "}
                      {q.cpl ? `$${q.cpl} CPL` : "no leads yet"}
                    </span>
                  </div>
                  {q.options.length > 0 && (
                    <p className="mt-0.5 text-muted-foreground" dir="auto">
                      {q.options.join(" · ")}
                    </p>
                  )}
                </div>
              ),
            )}
          </div>
          {bankLeft > 0 && (
            <div className="border-t px-4 py-3 sm:px-6">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setBankShown(n => n + PAGE)}
              >
                Show {Math.min(PAGE, bankLeft)} more
              </Button>
            </div>
          )}
        </section>

        <p className="text-xs text-muted-foreground">
          Meta is the source for destinations, questions and cost per lead.
          Client funnels built in GoHighLevel are not visible yet: the agency
          token does not carry the funnels scope.
        </p>
      </div>
    </div>
  );
}
