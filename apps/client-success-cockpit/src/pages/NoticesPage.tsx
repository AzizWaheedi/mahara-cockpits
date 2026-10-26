import { PageHeader } from "@/components/kit";
import {
  NOTICES_PAGE_TITLE,
  NOTICES_SUB,
  NoticesRouting,
} from "@/components/NoticesRouting";
import { portalUrl } from "@/lib/portal";

/*
 * Hallmark · pre-emit critique: P4 H4 E4 S4 R5 V3 · component scope: a page
 * shell around the existing card, nothing new to draw. Tokens, type and the
 * card are the cockpit's own (NoticesRouting.tsx carries the design plan);
 * the shell is the shared BillingReviewLayout ("Back to your cockpit") every
 * seat's page already uses, so a media or creative seat lands somewhere that
 * looks like the cockpits it knows. One column, 16 px gutters, no side scroll
 * at 320 px.
 */

/**
 * Notices and routing on its own page (D17, PLAN.md 4.8): the CEO or an
 * admin can give any seat the right to change who a notice tags and where it
 * posts (cockpit_forms_editors), whatever its role, so the page is open to
 * every signed-in seat. The server's viewer and editor gates decide what each
 * seat sees and may change; a seat they refuse is told so in a sentence. The
 * client success seats also find the same card on their Settings page.
 */
export function NoticesPage() {
  // The page's own h1, as every other page in this shell has (PageHeader);
  // the card under it is labelled by it.
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <PageHeader
        title={<span id={NOTICES_PAGE_TITLE}>Notices and routing</span>}
        sub={NOTICES_SUB}
      />
      <NoticesRouting standalone />
      {/* Ticket routing and the alert rules live in the portal (D17). */}
      <p className="text-sm text-muted-foreground">
        Ticket routing and alert settings are in{" "}
        <a
          href={`${portalUrl()}/requests/settings`}
          className="font-medium text-[color:var(--primary-ink,var(--primary))] underline-offset-4 hover:underline"
        >
          Requests settings
        </a>
        .
      </p>
    </div>
  );
}
