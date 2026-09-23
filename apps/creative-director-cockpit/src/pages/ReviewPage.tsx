import { SendForReview } from "@/components/SendForReview";

/**
 * Sending finished work to a client for review.
 *
 * Also on the start-of-day screen, beside the WhatsApp desk, because
 * that is where it gets used while answering a client. This is the page
 * for when somebody comes looking for it rather than stumbling on it.
 */
export function ReviewPage() {
  return (
    <div className="mx-auto max-w-4xl p-5">
      <SendForReview />
    </div>
  );
}
