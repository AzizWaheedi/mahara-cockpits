import { PageHeader } from "@/components/kit";
import { rememberedSkeleton } from "@/components/RememberedSkeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The Inbox page with its data held back. The header, the WhatsApp desk, the
 * two folds and the footer keep the loaded layout, so the page does not move
 * when the conversations arrive.
 */

export const INBOX_SKELETON_PATHS: string[] = ["/inbox"];

/** One WhatsApp thread: its header, its last messages and its draft. */
function ThreadSkeleton() {
  return (
    <li className="rounded-2xl border bg-card">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2 sm:px-6">
        <Skeleton className="h-4 w-32 max-w-full" />
        <Skeleton className="h-4 w-14 rounded-full" />
        <Skeleton className="h-3 w-8" />
        <Skeleton className="ml-auto h-8 w-20 rounded-lg" />
      </div>
      <div className="space-y-1.5 px-4 py-3 sm:px-6">
        <Skeleton className="h-4 w-3/4 max-w-full" />
        <Skeleton className="h-4 w-1/2 max-w-full" />
        <Skeleton className="h-4 w-2/3 max-w-full" />
      </div>
      <div className="border-t px-4 py-3 sm:px-6 sm:py-4">
        <Skeleton className="h-3 w-40 max-w-full" />
        <div className="mt-2 mb-2 inline-flex gap-1">
          <Skeleton className="h-8 w-16 rounded-full" />
          <Skeleton className="h-8 w-16 rounded-full" />
        </div>
        <Skeleton className="h-20 w-full rounded-lg" />
        <div className="mt-2 flex items-center gap-2">
          <Skeleton className="h-9 w-24 rounded-lg" />
        </div>
      </div>
    </li>
  );
}

/** The WhatsApp desk while its own read is pending. */
export function WhatsAppDeskSkeleton() {
  return (
    <section aria-hidden="true" data-section="whatsapp-desk">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-[15px] font-semibold tracking-tight">WhatsApp</h2>
        <Skeleton className="h-3.5 w-40 max-w-full" />
      </div>
      <ul className="mt-3 space-y-3">
        {[0, 1, 2, 3, 4].map(row => (
          <ThreadSkeleton key={row} />
        ))}
      </ul>
    </section>
  );
}

/** The closed "More from WhatsApp" fold. */
function HistoryFoldSkeleton() {
  return (
    <div className="group rounded-2xl border bg-card">
      <div className="no-marker flex flex-wrap items-center gap-2 px-4 py-4 text-[15px] font-semibold sm:px-6">
        <Skeleton className="size-4 shrink-0 rounded-sm" />
        More from WhatsApp
        <span className="text-xs font-normal text-muted-foreground">
          quiet clients and every thread's history
        </span>
      </div>
    </div>
  );
}

/** The closed "Send something for review" row. */
function SendForReviewSkeleton() {
  return (
    <div className="rounded-2xl border bg-card">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 sm:px-6 sm:py-4">
        <span className="text-[15px] font-semibold">
          Send something for review
        </span>
        <span className="text-xs text-muted-foreground">
          Videos or images, one link for the client
        </span>
      </div>
    </div>
  );
}

function InboxSkeletonStatic() {
  return (
    <div
      aria-hidden="true"
      data-page-skeleton="inbox"
      className="mx-auto w-full max-w-6xl space-y-6"
    >
      <div data-section="page-header">
        <PageHeader
          title="Inbox"
          sub="Client WhatsApp groups waiting on a reply, each with a reply drafted. Edit it if you want, then send. Your calls and calendar are on Today."
          actions={<Skeleton className="h-8 w-36 rounded-lg" />}
        />
      </div>

      <WhatsAppDeskSkeleton />

      <div data-section="more-from-whatsapp">
        <HistoryFoldSkeleton />
      </div>

      <div data-section="send-for-review">
        <SendForReviewSkeleton />
      </div>

      <div
        className="space-y-1.5 text-xs text-muted-foreground"
        data-section="footer"
      >
        <Skeleton className="h-3 w-72 max-w-full" />
        <Skeleton className="h-3 w-56 max-w-full" />
      </div>
    </div>
  );
}

export const InboxSkeleton = rememberedSkeleton("inbox", InboxSkeletonStatic);
