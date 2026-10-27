import { ChevronRight } from "lucide-react";
import { OFFER_NAMES, proposalUrl } from "@/present/offer/kinds";
import type { ProposalCardRow } from "./proposalSources";

export function proposalStatus(row: ProposalCardRow): string {
  if (row.status === "archived") return "Archived";
  if (row.expired) return "Expired";
  if (row.status === "accepted") return "Agreed";
  if (row.status === "not_now") return "Follow-up planned";
  if (row.opened?.known && row.opened.visits > 0) return "Opened";
  return row.sentAt ? "Link ready" : "Draft";
}
export function ProposalCard({
  taskId,
  row,
}: {
  taskId: string;
  row: ProposalCardRow;
}) {
  return (
    <a
      href={proposalUrl(taskId, row.id)}
      className="flex items-center justify-between gap-4 rounded-lg py-4 outline-offset-4 hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-primary"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">
            {OFFER_NAMES[row.offerKey]}
          </span>
          <span className="rounded-full border px-2 py-0.5 text-[11px]">
            {proposalStatus(row)}
          </span>
          <span className="text-xs text-muted-foreground">
            {row.lang === "ar" ? "Arabic" : "English"}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {row.sentAt ? `Valid until ${row.validUntil}` : "Not shared yet"}
          {row.updatedAfterSend ? " · Changes waiting to publish" : ""}
        </p>
        {row.sentAt ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {!row.opened?.known
              ? "Opens unknown"
              : `${row.opened.visits} visits · ${row.opened.devices} devices${row.opened.played ? " · Video played" : ""}${row.opened.pressedYes ? " · WhatsApp selected" : ""}`}
          </p>
        ) : null}
      </div>
      <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
    </a>
  );
}
