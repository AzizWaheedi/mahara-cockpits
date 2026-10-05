import { ArrowLeft, Download, Maximize2, Send, X } from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { DraftWaitNotice, ProposalChip } from "../components/ProposalPanel";
import { api } from "../lib/api";
import { useLead, useProposal, useProposalHtml, useRequest } from "../lib/data";
import { ago } from "../lib/format";
import { downloadLabel, noDocument, notesOf, sentence } from "../lib/proposals";
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

async function save(path: string, name: string) {
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
  // Where the draft is, while it is being drafted: its tries and the
  // writer's reason when it waits.
  const request = useRequest(
    p?.status === "drafting" ? (p.request_id ?? null) : null,
  );
  const [busy, setBusy] = useState(false);
  const [full, setFull] = useState(false);
  // Stable, so the page's polling never moves focus inside full screen.
  const closeFull = useCallback(() => setFull(false), []);

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
  const notes = notesOf(p.validation);
  // Whether Fill in the blanks shows below: blanks left, on a finished draft.
  const fillable =
    mine &&
    ["needs_input", "ready", "failed"].includes(p.status) &&
    fillPaths(p.deal).length > 0;
  // The request this draft is on now; a retry's new one replaces the last.
  const draftRequest =
    request.data && request.data.id === p.request_id ? request.data : null;
  const download = downloadLabel(p);

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
            {/* One download: the PDF, or the page itself when no PDF was
                built, named for what it is. */}
            {download ? (
              <button
                type="button"
                className={button}
                onClick={() =>
                  p.pdf_path
                    ? save(String(p.pdf_path), `${fileBase}.pdf`)
                    : save(String(p.html_path), `${fileBase}.html`)
                }
              >
                <Download className="size-3.5" aria-hidden /> {download}
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
      {/* The writer's notes on this version: which model wrote it, why
          there is no PDF, what was checked. */}
      {notes.length ? (
        <ul className="muted -mt-3 list-disc space-y-0.5 pl-4 text-xs leading-relaxed">
          {notes.map(n => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}

      {p.status === "drafting" ? (
        // Why it is still waiting, when it is: no model answering, or a try
        // that failed and will be made again. The writer's sentence says
        // what happens next and when to tell the CEO. Said once this
        // draft's request is read, so a retry never flashes the old one's
        // age as "Taking longer than usual".
        draftRequest || request.error || !p.request_id ? (
          <DraftWaitNotice
            me={me}
            proposal={p}
            request={draftRequest}
            onChange={() => {
              proposal.reload();
              request.reload();
            }}
          />
        ) : (
          <p className="muted text-sm">Reading where the draft is…</p>
        )
      ) : null}
      {p.status === "failed" ? (
        <div className="callout-bad space-y-2 rounded-[var(--radius-md)] border px-3 py-2 text-sm">
          <p className="font-medium">The draft did not finish.</p>
          <p>{sentence(p.error ?? "The writer gave no reason")}</p>
          {mine ? (
            <button
              type="button"
              disabled={busy}
              className="underline underline-offset-2"
              onClick={() =>
                act(
                  "proposal.retry",
                  { id: p.id },
                  "Drafting again with the same choices. It usually takes about ten minutes.",
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

      <SectionCard
        title="The document"
        flush
        // A blurred card is the containing block of anything fixed inside
        // it; full screen lifts the blur so the document can cover the screen.
        className={full ? "backdrop-filter-none!" : ""}
        side={
          html.data ? (
            <button
              type="button"
              className={button}
              onClick={() => setFull(true)}
            >
              <Maximize2 className="size-3.5" aria-hidden /> Full screen
            </button>
          ) : null
        }
      >
        {html.error ? (
          <div className="p-4">
            <Failed
              what="The document"
              error={html.error}
              retry={html.reload}
            />
          </div>
        ) : html.data ? (
          <>
            <p className="muted border-b hairline px-4 py-2 text-xs sm:px-6">
              Edits made inside the document change this copy only, for printing
              or saving.{" "}
              {fillable
                ? "The stored proposal changes through Fill in the blanks."
                : "The stored proposal stays as it was drafted."}
            </p>
            <Document html={html.data} full={full} onClose={closeFull} />
          </>
        ) : (
          <p className="muted p-4 text-sm">{noDocument(p.status)}</p>
        )}
      </SectionCard>
    </Shell>
  );
}

/**
 * The stored page, sandboxed. Its own editor runs inside: scripts for the
 * editor, modals for its print window, downloads for Save, and the clipboard
 * for Copy. Never allow-same-origin: the page cannot reach the cockpit's
 * session or storage, so edits stay in this copy.
 *
 * Full screen, for a phone, is the same iframe with its frame fixed over the
 * screen, never a second one: the page is not loaded again, so edits made
 * in it survive going in and out. Escape or Close returns.
 */
/** What full screen is to a screen reader: a dialog over the page. */
const FULL_SCREEN_DIALOG = {
  role: "dialog",
  "aria-modal": true,
  "aria-label": "The proposal, full screen",
} as const;

function Document({
  html,
  full,
  onClose,
}: {
  html: string;
  full: boolean;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!full) return;
    const opener = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [full, onClose]);
  return (
    <div
      className={
        full
          ? "pt-safe pb-safe fixed inset-0 z-[60] flex flex-col bg-[color:var(--background)]"
          : ""
      }
      {...(full ? FULL_SCREEN_DIALOG : {})}
    >
      {full ? (
        <header className="flex items-center justify-between gap-3 border-b hairline px-4 py-2">
          <p className="text-sm font-medium">The proposal</p>
          <button
            ref={closeRef}
            type="button"
            className={button}
            onClick={onClose}
          >
            <X className="size-3.5" aria-hidden /> Close full screen
          </button>
        </header>
      ) : null}
      <iframe
        title="The proposal"
        srcDoc={html}
        sandbox="allow-scripts allow-modals allow-downloads"
        allow="clipboard-write"
        className={`block w-full bg-white ${full ? "min-h-0 flex-1" : "h-[80vh]"}`}
      />
    </div>
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
