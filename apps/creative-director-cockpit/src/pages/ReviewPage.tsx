import { SendForReview } from "@/components/SendForReview";

/**
 * Sending finished work to a client for review.
 *
 * The one place the form lives: the start-of-day screen links here with
 * a single button, beside the WhatsApp desk, because that is where it
 * gets used while answering a client.
 *
 * The form carries its own "Send for review" heading, so the page adds no
 * second title; it lines up with every other page and keeps the form to a
 * readable width.
 */
export function ReviewPage() {
  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="max-w-3xl">
        <SendForReview />
      </div>
    </div>
  );
}
