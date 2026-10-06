import { useQuery } from "convex/react";
import { useMemo } from "react";
import { Link } from "react-router";
import { Fold, PageHeader } from "@/components/kit";
import { ReportIssue } from "@/components/ReportIssue";
import { SendForReview } from "@/components/SendForReview";
import { WhatsAppDesk } from "@/components/WhatsAppDesk";
import { api } from "../../convex/_generated/api";
import { MeetingsPage } from "./MeetingsPage";

/**
 * Inbox: every WhatsApp conversation waiting on a reply, in one place.
 *
 * It was two inboxes with two drafting agents (Start of day and Meetings &
 * messages). Hala, the one with real drafts in both languages, is the one
 * drafting agent now (Aziz left the choice to Claude, 2026-10-06): her desk
 * leads, and the quiet clients and every thread's history are folded under
 * it. The other agent's second drafts and second Send are gone from here, so
 * a reply has one path out. The cockpit drafts, the CSM sends.
 */
export function InboxPage() {
  const snap = useQuery(api.csm.snapshot, {});
  const clientNames = useMemo(
    () =>
      ((snap?.clients ?? []) as { name: string }[]).map(c => String(c.name)),
    [snap],
  );
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <PageHeader
        title="Inbox"
        sub="Client WhatsApp groups waiting on a reply, each with a reply drafted. Edit it if you want, then send. Your calls and calendar are on Today."
        actions={<ReportIssue page="inbox" />}
      />

      {/* Client groups first; the rest folds under them, never dropped. */}
      <WhatsAppDesk desk="csm" clients={snap ? clientNames : undefined} />

      <Fold
        title="More from WhatsApp"
        hint="quiet clients and every thread's history"
      >
        <MeetingsPage embedded part="history" />
      </Fold>

      {/* Sending a cut for review, folded until it is needed: the reply a
          client is waiting for is often "here it is". */}
      <SendForReview folded />

      <p className="text-xs text-muted-foreground">
        Looking for a client's own thread? Open the client from{" "}
        <Link
          to="/clients"
          className="text-primary underline-offset-4 hover:underline"
        >
          Clients
        </Link>{" "}
        or press Ctrl K and type their name.
      </p>
    </div>
  );
}
