import { ArrowUpRight, FileText } from "lucide-react";
import { type Column, DataTable } from "@/components/ceo/DataTable";
import { EmptyState } from "@/components/ceo/EmptyState";
import { date, relative } from "@/components/ceo/format";
import { Na } from "@/components/ceo/Na";
import { Notes } from "@/components/ceo/Notes";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatusChip } from "@/components/ceo/StatusChip";
import { useQueryState } from "@/lib/cockpitApi";
import { supabase } from "@/lib/supabase";
import {
  type ProposalRecord,
  type ProposalRow,
  proposalChip,
  proposalRows,
  proposalSummary,
} from "./proposals";

/**
 * Proposals, on the Sales tab (A234, 2026-10-11). Drafted by our own writer
 * from the demo call (hermes/sales-desk), never on another person's
 * account; each row opens the proposal's page in the sales cockpit, where it
 * is filled, read, downloaded and marked sent. Read straight from
 * cockpit_sales_proposals with the CEO's own session (the seat policy
 * cockpit_sales_seat() lets the CEO read it), lead names from
 * cockpit_sales_leads under the same policy.
 */

const COLUMNS = [
  "id",
  "status",
  "contact_id",
  "lang",
  "created_by",
  "created_at",
  "updated_at",
  "sent_at",
  "sent_by",
  "error",
  "fill_count",
].join(",");

type Read = { rows: ProposalRow[]; namesRefused: boolean };

async function readProposals(): Promise<Read> {
  const { data, error } = await supabase
    .from("cockpit_sales_proposals")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  const records = (data ?? []) as unknown as ProposalRecord[];
  const ids = [
    ...new Set(records.map(r => r.contact_id).filter((x): x is string => !!x)),
  ];
  const names = new Map<string, string | null>();
  let namesRefused = false;
  if (ids.length) {
    const leads = await supabase
      .from("cockpit_sales_leads")
      .select("contact_id,name")
      .in("contact_id", ids);
    if (leads.error) namesRefused = true;
    for (const l of (leads.data ?? []) as {
      contact_id: string;
      name: string | null;
    }[])
      names.set(l.contact_id, l.name);
  }
  return { rows: proposalRows(records, names), namesRefused };
}

export function ProposalsCard({ order, now }: { order?: number; now: number }) {
  const { data, error } = useQueryState<Read>(readProposals, {});
  const columns: Column<ProposalRow>[] = [
    {
      key: "lead",
      header: "Lead",
      cell: r => (
        <span className="block min-w-0">
          <a
            href={r.href}
            className="group inline-flex min-w-0 max-w-full items-center gap-1 font-medium text-foreground underline decoration-dotted underline-offset-4 hover:decoration-solid"
            dir="auto"
          >
            <span className="truncate">{r.lead}</span>
            <ArrowUpRight
              className="size-3 shrink-0 text-muted-foreground group-hover:text-foreground"
              aria-hidden
            />
          </a>
          <span className="block whitespace-normal text-xs text-muted-foreground">
            {r.language}
            {r.error ? ` · ${r.error}` : ""}
          </span>
        </span>
      ),
      sortValue: r => r.lead,
      className: "max-w-[16rem]",
    },
    {
      key: "status",
      header: "Status",
      cell: r => {
        const chip = proposalChip(r);
        return (
          // min-w-max: the status is the column a phone must not cut
          // ("Archi…"); the lead's name wraps instead.
          <StatusChip
            tone={chip.tone}
            label={chip.label}
            hint={r.error ?? undefined}
            className="min-w-max max-w-none"
          />
        );
      },
      sortValue: r => r.status,
    },
    {
      key: "closer",
      header: "Asked by",
      cell: r => r.closer,
      sortValue: r => r.closer,
      hideBelow: "sm",
    },
    {
      key: "created",
      header: "Created",
      cell: r => (r.createdAt ? date(r.createdAt) : <Na />),
      sortValue: r => r.createdAt,
      numeric: true,
    },
    {
      key: "sent",
      header: "Sent",
      cell: r =>
        r.sentAt ? (
          date(r.sentAt)
        ) : (
          <span className="text-muted-foreground">Not sent</span>
        ),
      sortValue: r => r.sentAt,
      numeric: true,
      hideBelow: "md",
    },
    {
      key: "updated",
      header: "Updated",
      cell: r => (r.updatedAt ? relative(r.updatedAt, now) : <Na />),
      sortValue: r => r.updatedAt,
      numeric: true,
      hideBelow: "lg",
    },
  ];

  return (
    <SectionCard
      id="sales-proposals"
      kicker="Our proposal writer"
      title="Proposals"
      description={data ? proposalSummary(data.rows) : undefined}
      order={order}
      actions={
        <a
          href="/sales/proposals"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
        >
          Open in the sales cockpit
          <ArrowUpRight className="size-3" aria-hidden />
        </a>
      }
      notes={[
        {
          level: "info",
          text: "Drafted by our own writer from the demo call, about ten minutes after a closer asks for one on the lead. Open a proposal to fill any blanks, read it, download the PDF and mark it sent. Read from cockpit_sales_proposals, every state including archived.",
        },
      ]}
    >
      {error ? (
        <Notes
          folded={false}
          notes={[
            {
              level: "warn",
              text: `The proposals could not be read: ${error.message.replace(/\.+$/, "")}. Open them in the sales cockpit meanwhile.`,
            },
          ]}
        />
      ) : !data ? (
        <p className="text-xs text-muted-foreground">Reading proposals</p>
      ) : data.rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No proposals yet"
          text="Closers draft them from a lead in the sales cockpit."
          compact
        />
      ) : (
        <div className="grid gap-3">
          <DataTable
            rows={data.rows}
            columns={columns}
            rowKey={r => r.id}
            initialSort={{ key: "created", dir: "desc" }}
            limit={10}
          />
          {data.namesRefused ? (
            <p className="text-xs text-muted-foreground">
              Lead names could not be read, so each lead shows its contact id.
            </p>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}
