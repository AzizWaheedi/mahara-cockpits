import { ArrowLeft, Download, Send } from "lucide-react";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import {
  button,
  buttonPrimary,
  EmptyState,
  Failed,
  field,
  page,
  SectionCard,
} from "../components/kit";
import { ProposalChip } from "../components/ProposalPanel";
import { api } from "../lib/api";
import { useLead, useProposal, useProposalHtml } from "../lib/data";
import { ago } from "../lib/format";
import { supabase } from "../lib/supabase";
import { toast } from "../lib/toast";
import type { Me, Proposal } from "../lib/types";

const VARIANT_WORDS: Record<string, string> = {
  specific: "Built on the client's own figures from the call.",
  general:
    "Built from the call; the client did not give the figures a full return needs.",
  blind: "Built without a usable transcript, so it leans on the standard case.",
};

/** Every string in the draft that still says FILL, with where it sits. */
function fillPaths(
  v: unknown,
  path: (string | number)[] = [],
  out: { path: string; text: string }[] = [],
) {
  if (typeof v === "string") {
    if (/\bFILL\b/.test(v)) out.push({ path: path.join("."), text: v });
  } else if (Array.isArray(v)) {
    for (const [i, x] of v.entries()) fillPaths(x, [...path, i], out);
  } else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v as Record<string, unknown>))
      fillPaths(x, [...path, k], out);
  return out;
}

/** The draft's keys as a closer would name them. */
const FILL_WORDS: Record<string, string> = {
  client_company: "Client's company",
  client_contact: "Client's name",
  client_role: "Client's role",
  city: "City",
  prepared_by: "Prepared by",
  prepared_by_role: "Your role",
  date: "Date",
  valid_until: "Valid until",
  kicker: "Kicker",
  headline: "Headline",
  subhead: "Subheading",
  gap_title: "The gap, title",
  gap_close: "The gap, closing line",
  gap_points: "The gap",
  funnel: "The funnel",
  pattern: "The pattern",
  pattern_note: "The pattern, note",
  tree: "The growth tree",
  tree_title: "The growth tree, title",
  tree_intro: "The growth tree, introduction",
  tree_close: "The growth tree, closing line",
  goal_label: "goal label",
  goal_note: "goal note",
  cost: "The cost",
  local_currency: "currency",
  arithmetic: "The arithmetic",
  project_values: "project value",
  table_title: "table title",
  solution_title: "The solution, title",
  solution_close: "The solution, closing line",
  solution: "The solution",
  solution_targets: "Targets",
  program: "The programme",
  proof: "Proof",
  investment_title: "Investment, title",
  investment_close: "Investment, closing line",
  investment: "Investment",
  total_label: "total label",
  total_amount: "total",
  terms: "Terms",
  roi: "Return on investment",
  usd_rate: "dollar rate",
  fee_usd: "fee in dollars",
  ad_monthly_usd: "monthly ad spend in dollars",
  avg_project_value: "average project value",
  margin_pct: "margin",
  project_note: "project note",
  margin_note: "margin note",
  target_projects_month: "projects a month",
  start_title: "Getting started, title",
  deposit_label: "Deposit, label",
  deposit_amount: "Deposit",
  start_steps: "Getting started",
  start_note: "Getting started, note",
  cta: "The ask",
  verdict_label: "verdict label",
  v: "figure",
  k: "what it is",
  src: "source",
};

/** What one item of a list is called, by the list's key. */
const FILL_ITEM: Record<string, string> = {
  rows: "line",
  stages: "stage",
  layers: "layer",
  branches: "branch",
  subs: "sub-branch",
  gap_points: "point",
  terms: "line",
  solution_targets: "target",
  start_steps: "step",
  program: "part",
  solution: "part",
  pattern: "part",
  proof: "item",
  project_values: "value",
  margins: "margin",
};

/** Lists whose own name adds nothing once the item is named ("line 1"). */
const FILL_CONTAINER = new Set([
  "rows",
  "stages",
  "layers",
  "branches",
  "subs",
]);

/** "investment.rows.0.amount" as "Investment, line 1, amount". */
function pathWords(path: string): string {
  const parts = path.split(".");
  const words: string[] = [];
  parts.forEach((p, i) => {
    if (/^\d+$/.test(p)) {
      words.push(`${FILL_ITEM[parts[i - 1] ?? ""] ?? "item"} ${Number(p) + 1}`);
      return;
    }
    if (FILL_CONTAINER.has(p) && /^\d+$/.test(parts[i + 1] ?? "")) return;
    words.push(FILL_WORDS[p] ?? p.replace(/_/g, " "));
  });
  const line = words.join(", ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

function list(v: unknown): string[] {
  return Array.isArray(v)
    ? v.map(x => (typeof x === "string" ? x : JSON.stringify(x)))
    : [];
}

async function download(path: string, name: string) {
  const { data, error } = await supabase.storage
    .from("sales-proposals")
    .download(path);
  if (error || !data) {
    toast.error(
      `The file could not be downloaded: ${error?.message ?? "nothing came back"}.`,
    );
    return;
  }
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export default function ProposalPage({ me }: { me: Me }) {
  const { id = "" } = useParams();
  const proposal = useProposal(id);
  const p = proposal.data;
  const lead = useLead(p?.contact_id ?? "");
  const html = useProposalHtml(p?.html_path ?? null);
  const [busy, setBusy] = useState(false);

  if (proposal.error)
    return (
      <Shell>
        <Failed
          what="This proposal"
          error={proposal.error}
          retry={proposal.reload}
        />
      </Shell>
    );
  if (!p)
    return (
      <Shell>
        {proposal.loading ? (
          <p className="muted text-sm">Loading the proposal…</p>
        ) : (
          <EmptyState
            title="This proposal is not here"
            text="It may have been archived."
          />
        )}
      </Shell>
    );

  const mine = me.manager || p.created_by === me.email;
  const leadName = lead.data?.name ?? "the lead";
  const fileBase = `proposal-${(lead.data?.company || lead.data?.name || "client").replace(/[^\p{L}\p{N}]+/gu, "-")}-${p.created_at.slice(0, 10)}`;
  const v = (p.validation ?? {}) as Record<string, unknown>;
  const errors = list(v.errors);
  const warnings = list(v.warnings);

  async function act(
    action: string,
    body: Record<string, unknown>,
    done: string,
  ) {
    setBusy(true);
    try {
      await api(action, body);
      toast.success(done);
      proposal.reload();
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <Link
        to={p.contact_id ? `/lead/${p.contact_id}` : "/proposals"}
        className="muted inline-flex items-center gap-1 text-sm hover:underline"
      >
        <ArrowLeft className="size-3.5" aria-hidden />{" "}
        {p.contact_id ? leadName : "Proposals"}
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight" dir="auto">
              Proposal for {leadName}
            </h1>
            <ProposalChip p={p} />
          </div>
          <p className="muted text-sm">
            {p.lang === "ar" ? "Arabic" : "English"} · asked by{" "}
            {p.created_by.split("@")[0]} {ago(p.created_at)}
            {p.model ? " · drafted by the assistant" : ""}
            {p.sent_at ? ` · sent ${ago(p.sent_at)}` : ""}
          </p>
          {p.variant ? (
            <p className="muted text-sm">
              {VARIANT_WORDS[p.variant] ?? p.variant}
            </p>
          ) : null}
        </div>
        {mine ? (
          <div className="flex flex-wrap gap-2">
            {/* One download: the PDF, or the page itself when no PDF was built. */}
            {p.pdf_path ? (
              <button
                type="button"
                className={button}
                onClick={() => download(String(p.pdf_path), `${fileBase}.pdf`)}
              >
                <Download className="size-3.5" aria-hidden /> Download PDF
              </button>
            ) : p.html_path ? (
              <button
                type="button"
                className={button}
                onClick={() =>
                  download(String(p.html_path), `${fileBase}.html`)
                }
              >
                <Download className="size-3.5" aria-hidden /> Download
              </button>
            ) : null}
            {p.status === "ready" ? (
              <button
                type="button"
                disabled={busy}
                className={buttonPrimary}
                onClick={() =>
                  act(
                    "proposal.set",
                    { id: p.id, status: "sent" },
                    "Marked sent.",
                  )
                }
              >
                <Send className="size-3.5" aria-hidden /> Mark sent
              </button>
            ) : null}
            {p.status !== "archived" && p.status !== "sent" ? (
              <button
                type="button"
                disabled={busy}
                className={button}
                onClick={() =>
                  act(
                    "proposal.set",
                    { id: p.id, status: "archived" },
                    "Archived.",
                  )
                }
              >
                Archive
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      {p.status === "drafting" ? (
        <p className="callout-good rounded-[var(--radius-md)] border px-3 py-2 text-sm">
          The proposal is being written. It takes about ten minutes; this page
          updates by itself.
        </p>
      ) : null}
      {p.status === "failed" ? (
        <div className="callout-bad space-y-2 rounded-[var(--radius-md)] border px-3 py-2 text-sm">
          <p>
            The draft did not finish: {p.error ?? "the writer gave no reason"}.
          </p>
          {mine ? (
            <button
              type="button"
              disabled={busy}
              className="underline underline-offset-2"
              onClick={() =>
                act(
                  "proposal.retry",
                  { id: p.id },
                  "Drafting again with the same choices. About ten minutes.",
                )
              }
            >
              Draft again
            </button>
          ) : null}
        </div>
      ) : null}

      {errors.length || warnings.length ? (
        <SectionCard title="What the checker found">
          {errors.length ? (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {errors.map(e => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
          {warnings.length ? (
            <ul className="muted mt-2 list-disc space-y-1 pl-5 text-sm">
              {warnings.map(w => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
        </SectionCard>
      ) : null}

      {mine &&
      p.deal &&
      (p.status === "needs_input" ||
        p.status === "ready" ||
        p.status === "failed") ? (
        <Fills p={p} onDone={proposal.reload} />
      ) : null}

      <SectionCard title="The document" flush>
        {html.error ? (
          <div className="p-4">
            <Failed
              what="The document"
              error={html.error}
              retry={html.reload}
            />
          </div>
        ) : html.data ? (
          <iframe
            title="The proposal"
            srcDoc={html.data}
            sandbox="allow-scripts"
            className="block h-[80vh] w-full bg-white"
          />
        ) : (
          <p className="muted p-4 text-sm">
            {p.status === "drafting"
              ? "The document appears here when the draft is done."
              : "No document was built."}
          </p>
        )}
      </SectionCard>
    </Shell>
  );
}

function Fills({ p, onDone }: { p: Proposal; onDone: () => void }) {
  const blanks = useMemo(() => fillPaths(p.deal), [p.deal]);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      blanks.map(b => [b.path, b.text.trim() === "FILL" ? "" : b.text]),
    ),
  );
  const [busy, setBusy] = useState(false);
  if (!blanks.length) return null;

  async function save(e: FormEvent) {
    e.preventDefault();
    const fills = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v.trim() && !/\bFILL\b/.test(v)),
    );
    if (!Object.keys(fills).length) {
      toast.error("Type at least one figure, replacing FILL.");
      return;
    }
    setBusy(true);
    try {
      await api("proposal.fill", { id: p.id, fills });
      toast.success("Saved. The document is being rebuilt with your figures.");
      onDone();
    } catch (err) {
      toast.error(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title={`Fill in the blanks (${blanks.length})`}>
      <p className="muted mb-4 text-sm">
        The writer only uses figures the client said on the call. Where they did
        not say one it left FILL. Type the real figure or words; anything you
        leave still says FILL and the proposal cannot be marked sent.
      </p>
      <form onSubmit={save} className="space-y-3">
        {blanks.map(b => (
          <label key={b.path} className="block space-y-1">
            <span className="muted block text-xs">{pathWords(b.path)}</span>
            {b.text.trim() !== "FILL" ? (
              <span className="block text-xs" dir="auto">
                Now: {b.text}
              </span>
            ) : null}
            <input
              value={values[b.path] ?? ""}
              onChange={e =>
                setValues(v => ({ ...v, [b.path]: e.target.value }))
              }
              className={field}
              dir="auto"
              placeholder={
                b.text.trim() === "FILL"
                  ? "The figure"
                  : "The sentence with the figure in place"
              }
            />
          </label>
        ))}
        <button type="submit" disabled={busy} className={buttonPrimary}>
          {busy ? "Saving…" : "Save and rebuild"}
        </button>
      </form>
    </SectionCard>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <main className={page}>{children}</main>;
}
