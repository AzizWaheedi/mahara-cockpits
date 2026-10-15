import type { StatusTone } from "@/components/ceo/StatusChip";

/**
 * Proposals in the CEO cockpit (Aziz, 2026-09-24: "We can still draft
 * proposals, and I want to make it in the CEO cockpit here instead of on
 * Muhammed's account"). The writer is ours (hermes/sales-desk, from the
 * demo call); the rows are cockpit_sales_proposals, which the CEO's seat
 * reads under cockpit_sales_seat(). Pure, so the words are tested
 * (scripts/ceo-fixes-screens.test.ts).
 */

export type ProposalStatus =
  | "drafting"
  | "needs_input"
  | "ready"
  | "sent"
  | "failed"
  | "archived";

/** The columns the card reads, as the table stores them. */
export type ProposalRecord = {
  id: string;
  status: string;
  contact_id: string | null;
  lang: string | null;
  created_by: string;
  created_at: string;
  updated_at: string | null;
  sent_at: string | null;
  sent_by: string | null;
  error: string | null;
  fill_count: number | null;
};

export type ProposalRow = {
  id: string;
  status: string;
  /** The lead's name, or "Lead <contact id>" when the name could not be read. */
  lead: string;
  closer: string;
  language: string;
  createdAt: number | null;
  sentAt: number | null;
  updatedAt: number | null;
  /** Where the proposal opens: the sales cockpit's own page for it. */
  href: string;
  /** The writer's sentence on a failed or held draft. */
  error: string | null;
  fillCount: number;
};

/** The sales cockpit's words for each state (apps/sales-cockpit ProposalPanel), in the CEO kit's tones. */
export const PROPOSAL_STATUS: Record<
  ProposalStatus,
  { tone: StatusTone; label: string }
> = {
  drafting: { tone: "neutral", label: "Drafting" },
  needs_input: { tone: "warning", label: "Needs figures" },
  ready: { tone: "good", label: "Ready to send" },
  sent: { tone: "good", label: "Sent" },
  failed: { tone: "critical", label: "Failed" },
  archived: { tone: "neutral", label: "Archived" },
};

export function proposalChip(row: Pick<ProposalRow, "status" | "fillCount">): {
  tone: StatusTone;
  label: string;
} {
  const s = PROPOSAL_STATUS[row.status as ProposalStatus] ?? {
    tone: "neutral" as StatusTone,
    label: row.status,
  };
  return row.status === "needs_input" && row.fillCount > 0
    ? { ...s, label: `${s.label} (${row.fillCount})` }
    : s;
}

/** The proposal's own page in the sales cockpit (its route is /proposal/:id under /sales/). */
export const proposalHref = (id: string) =>
  `/sales/proposal/${encodeURIComponent(id)}`;

/**
 * Who asked for the draft, from their address: "Aziz" from
 * "aziz@maharamedia.com", "Sara Ali" from "sara.ali@…". Proposals are asked
 * for by whoever is signed in on the lead (a closer, or the CEO), so the
 * column says "Asked by", not "Closer".
 */
export const closerName = (email: string | null | undefined) =>
  (email ?? "")
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") || "Unknown";

const stamp = (v: string | null | undefined) => {
  if (!v) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
};

/** The table rows, newest first, with each lead's name where it could be read. */
export function proposalRows(
  records: ProposalRecord[],
  names: Map<string, string | null>,
): ProposalRow[] {
  return records
    .map(r => ({
      id: r.id,
      status: r.status,
      lead:
        (r.contact_id ? names.get(r.contact_id) : null)?.trim() ||
        (r.contact_id ? `Lead ${r.contact_id}` : "No lead"),
      closer: closerName(r.created_by),
      language: r.lang === "ar" ? "Arabic" : "English",
      createdAt: stamp(r.created_at),
      sentAt: stamp(r.sent_at),
      updatedAt: stamp(r.updated_at),
      href: proposalHref(r.id),
      error: r.error?.trim() || null,
      fillCount: Number(r.fill_count) || 0,
    }))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** "2 proposals: 1 failed, 1 archived" for the card's line. */
export function proposalSummary(rows: Pick<ProposalRow, "status">[]): string {
  if (!rows.length) return "No proposals yet";
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.status, (by.get(r.status) ?? 0) + 1);
  const order: string[] = [
    "needs_input",
    "ready",
    "drafting",
    "failed",
    "sent",
    "archived",
  ];
  const parts = [...by.entries()]
    .sort((a, b) => {
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    })
    .map(
      ([s, n]) =>
        `${n} ${(PROPOSAL_STATUS[s as ProposalStatus]?.label ?? s).toLowerCase()}`,
    );
  return `${rows.length} ${rows.length === 1 ? "proposal" : "proposals"}: ${parts.join(", ")}`;
}
