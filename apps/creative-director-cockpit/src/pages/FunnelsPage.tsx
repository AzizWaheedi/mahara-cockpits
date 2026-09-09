import { useQuery } from "convex/react";
import { ExternalLink, Filter } from "lucide-react";
import { useState } from "react";
import { api } from "@/../convex/_generated/api";

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

function money(n?: number | null): string {
  if (n === null || n === undefined) return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function KindPill({ kind }: { kind: string }) {
  const tone =
    kind === "Instant form"
      ? "tone-good"
      : kind === "Landing page"
        ? "tone-neutral"
        : kind === "Stays on the post"
          ? "tone-warn"
          : "tone-neutral";
  return (
    <span className={`${tone} rounded px-1.5 py-0.5 text-[10.5px] font-semibold`}>
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
    <div className="rounded-lg border">
      <button
        type="button"
        className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left"
        onClick={() => setOpen(o => !o)}
      >
        <KindPill kind={r.kind} />
        <strong className="text-[13px]">
          {r.formName || r.url || r.account}
        </strong>
        <span className="text-[11.5px] text-muted-foreground">{r.account}</span>
        <span className="ml-auto flex items-center gap-3 text-[11.5px]">
          <span>{r.ads.length} live ad{r.ads.length === 1 ? "" : "s"}</span>
          <span>{money(r.spend)} · 30d</span>
          <span>{r.leads} leads</span>
          <strong>{r.cpl ? `$${r.cpl} CPL` : "no leads"}</strong>
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t px-3 py-3 text-[12px]">
          {r.headline && (
            <p>
              <span className="text-muted-foreground">Form headline: </span>
              <span dir="auto">{r.headline}</span>
            </p>
          )}

          {r.kind === "Instant form" ? (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Filter className="h-3.5 w-3.5" />
                <strong>
                  {gates.length} filtering question
                  {gates.length === 1 ? "" : "s"}
                </strong>
                {gates.length === 0 && (
                  <span className="txt-bad font-semibold">
                    nothing filters this form, every click becomes a lead
                  </span>
                )}
              </div>
              <ol className="ml-4 list-decimal space-y-1.5">
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
                <p className="text-[11.5px] text-muted-foreground">
                  Then it asks for:{" "}
                  {contact
                    .map((q: { label: string }) => q.label)
                    .join(", ")}
                  .
                </p>
              )}
              {r.leadsAllTime ? (
                <p className="text-[11.5px] text-muted-foreground">
                  {r.leadsAllTime} leads through this form all time.
                </p>
              ) : null}
              {r.followUpUrl && (
                <a
                  className="inline-flex items-center gap-1 text-[11.5px] underline"
                  href={r.followUpUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Where it sends them after submitting
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          ) : r.url ? (
            <a
              className="inline-flex items-center gap-1 underline"
              href={r.url}
              target="_blank"
              rel="noreferrer"
            >
              Open the page the ads point at
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <p className="text-muted-foreground">
              These ads keep people on the post, so there is no form and no page
              to script. Leads arrive as comments or messages.
            </p>
          )}

          <div>
            <div className="mb-1 text-[11.5px] font-semibold text-muted-foreground">
              Ads pointing here
            </div>
            <ul className="space-y-0.5">
              {r.ads.map((a: { adId: string; adName: string; status: string }) => (
                <li key={a.adId} className="flex items-center gap-2">
                  <span dir="auto">{a.adName}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {a.status.toLowerCase().replace(/_/g, " ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

export function FunnelsPage() {
  const data = useQuery(api.funnels.list, {});
  if (!data) return <div className="p-4 text-[12.5px]">Loading…</div>;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 pb-16">
      <header>
        <h1 className="text-[19px] font-bold tracking-tight">
          Funnels and lead forms
        </h1>
        <p className="text-[12.5px] text-muted-foreground">
          Where the leads actually come in, for every live ad we run.{" "}
          {data.counts.destinations} destinations across {data.counts.accounts}{" "}
          ad accounts, read straight from Meta.{" "}
          {data.counts.noGate > 0 && (
            <span className="txt-bad font-semibold">
              {data.counts.noGate} form
              {data.counts.noGate === 1 ? " asks" : "s ask"} nothing that
              filters a lead.
            </span>
          )}
        </p>
      </header>

      <section className="rounded-lg border">
        <div className="border-b px-3.5 py-2">
          <div className="text-[13px] font-semibold">
            Does asking more actually cost more
          </div>
          <div className="text-[11.5px] text-muted-foreground">
            Instant forms grouped by how many filtering questions they ask, last
            30 days. Cost per lead is Meta's number. Whether those leads
            qualified is not in Meta, so this tells you the price of a filter,
            not the quality of the lead.
          </div>
        </div>
        <div className="grid gap-2 p-3 sm:grid-cols-4">
          {data.byGates.map(
            // biome-ignore lint/suspicious/noExplicitAny: untyped payload
            (b: any) => (
              <div key={b.gates} className="rounded-md border p-2.5">
                <div className="text-[11.5px] text-muted-foreground">
                  {b.gates} filtering question{b.gates === "1" ? "" : "s"}
                </div>
                <div className="text-[17px] font-bold">
                  {b.cpl ? `$${b.cpl}` : "—"}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  per lead · {b.forms} form{b.forms === 1 ? "" : "s"} ·{" "}
                  {b.leads} leads
                </div>
              </div>
            ),
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-[14px] font-semibold">Every destination we run</h2>
        {/* biome-ignore lint/suspicious/noExplicitAny: untyped payload */}
        {data.rows.map((r: any) => (
          <FunnelRow key={`${r.account}-${r.formId || r.url || r.kind}`} r={r} />
        ))}
      </section>

      <section className="rounded-lg border">
        <div className="border-b px-3.5 py-2">
          <div className="text-[13px] font-semibold">
            The question bank
          </div>
          <div className="text-[11.5px] text-muted-foreground">
            Every filtering question already live somewhere in the account, with
            its answer options. Build a new form out of these instead of writing
            questions from scratch.
          </div>
        </div>
        <div className="divide-y">
          {data.questionBank.map(
            // biome-ignore lint/suspicious/noExplicitAny: untyped payload
            (q: any) => (
              <div key={q.label} className="px-3.5 py-2.5 text-[12px]">
                <div className="flex flex-wrap items-baseline gap-2">
                  <strong dir="auto">{q.label}</strong>
                  <span className="text-[11px] text-muted-foreground">
                    live on {q.accounts.length} account
                    {q.accounts.length === 1 ? "" : "s"} · {q.leads} leads ·{" "}
                    {q.cpl ? `$${q.cpl} CPL` : "no leads yet"}
                  </span>
                </div>
                {q.options.length > 0 && (
                  <div className="text-muted-foreground" dir="auto">
                    {q.options.join(" · ")}
                  </div>
                )}
              </div>
            ),
          )}
        </div>
      </section>

      <p className="text-[11px] text-muted-foreground">
        Meta is the source for destinations, questions and cost per lead. Client
        funnels built in GoHighLevel are not visible yet, the agency token does
        not carry the funnels scope.
      </p>
    </div>
  );
}
