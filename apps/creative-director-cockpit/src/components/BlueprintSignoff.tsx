import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Circle,
  CircleAlert,
  Lock,
  Minus,
} from "lucide-react";
import { Link } from "react-router";

/**
 * The Brand Blueprint on the dashboard (docs/brand-blueprint SPEC.md 4.2):
 * the three onboarding sign-offs, the offer row, and Today's "Offers to
 * lock". Its own file so the harness can draw it without the whole page.
 */

/**
 * The three sign-offs that actually end creative onboarding.
 *
 * A filled Brand DNA or cheat sheet link means the template was generated, not
 * that the work is done, so completion is read from the closed task, the
 * "Done" on Offer Creation, and the Brand Blueprint's call closed and offer
 * locked (SPEC 4.2). [aziz, 2026-09-08]
 */
export function OnboardingSteps({ r }: { r: any }) {
  const steps = r.onboardingSteps ?? [];
  if (steps.length === 0) return null;
  return (
    <ul className="space-y-1">
      {steps.map(
        (st: {
          key?: string;
          done: boolean;
          gap?: boolean;
          label: string;
          note: string;
          doc: string | null;
        }) => {
          const skip =
            st.key === "blueprint" &&
            !st.done &&
            !r.blueprintExpected &&
            !r.blueprintStarted;
          // The offer is still inside its 2 days: waiting, not late. A
          // closed Brand DNA task with gaps the call noted is not complete.
          const offer =
            st.key === "blueprint" && !st.done ? r.offerWaiting : null;
          const amber = (st.done && st.gap) || offer?.late === true;
          const quiet = skip || (offer && !offer.late);
          const Icon = amber
            ? CircleAlert
            : st.done
              ? Check
              : skip
                ? Minus
                : Circle;
          return (
            <li key={st.label} className="flex gap-2">
              <Icon
                aria-label={
                  st.done && st.gap
                    ? "Done, with gaps"
                    : st.done
                      ? "Done"
                      : skip
                        ? "Not needed"
                        : offer
                          ? offer.late
                            ? "Waiting over 2 days"
                            : "Waiting"
                          : "Not yet"
                }
                className={`mt-0.5 size-3.5 shrink-0 ${
                  amber
                    ? "txt-warn"
                    : st.done
                      ? "txt-good"
                      : quiet
                        ? "text-muted-foreground"
                        : "txt-bad"
                }`}
              />
              <span className="min-w-0">
                {st.doc ? (
                  <a
                    href={st.doc}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    {st.label}
                  </a>
                ) : (
                  st.label
                )}
                <span className="block text-xs text-muted-foreground">
                  {st.note}
                  {offer ? <OfferWaitingLine r={r} /> : null}
                </span>
              </span>
            </li>
          );
        },
      )}
    </ul>
  );
}

/** "under a day", "2 days": how long an offer has waited since the call. */
export function waitedFor(hours: number): string {
  if (hours < 24) return "under a day";
  const d = Math.floor(hours / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

/**
 * The offer row's two ways in (SPEC 4.2), at the end of the Brand Blueprint
 * step's note (which already says how long the offer has waited): part 2
 * closed, part 3 not locked. "Lock the offer" opens the client's page at
 * their Blueprint card. No notification of its own.
 */
export function OfferWaitingLine({ r }: { r: any }) {
  return (
    <span className="block">
      <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1">
        {r.offerSheet ? (
          <a
            href={r.offerSheet}
            target="_blank"
            rel="noreferrer"
            className="whitespace-nowrap text-primary underline-offset-4 hover:underline"
          >
            Open the offer sheet
          </a>
        ) : (
          <span className="text-muted-foreground">
            No offer sheet on the card
          </span>
        )}
        <Link
          to={`/clients/${encodeURIComponent(r.client)}#blueprint`}
          className="whitespace-nowrap text-primary underline-offset-4 hover:underline"
        >
          Lock the offer
        </Link>
      </span>
    </span>
  );
}

/** Today's offers to lock: part 2 closed, part 3 not locked, the longest first. */
export function OffersToLock({
  rows,
}: {
  rows: {
    client: string;
    offerSheet?: string | null;
    hours: number;
    late: boolean;
  }[];
}) {
  if (rows.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-2xl border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Lock className="size-4 shrink-0 translate-y-0.5 text-muted-foreground" />
        <h2 className="text-[15px] font-semibold">Offers to lock</h2>
        <span className="text-xs text-muted-foreground">
          The call is closed. Finish the offer and lock it within 2 days
        </span>
      </div>
      <div className="-mx-4 -mb-4 mt-4 border-t sm:-mx-6 sm:-mb-6">
        <ul className="divide-y">
          {rows.map(o => (
            <li
              key={o.client}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm sm:px-6"
            >
              <span className="min-w-0 flex-1 truncate font-medium" dir="auto">
                {o.client}
              </span>
              <span
                className={`text-xs ${o.late ? "txt-warn font-semibold" : "text-muted-foreground"}`}
              >
                Offer waiting {waitedFor(o.hours)}
              </span>
              <span className="flex basis-full items-center gap-3 text-xs sm:basis-auto">
                {o.offerSheet ? (
                  <a
                    href={o.offerSheet}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 whitespace-nowrap text-primary underline-offset-4 hover:underline"
                  >
                    Open the offer sheet
                    <ArrowUpRight aria-hidden className="size-3.5" />
                  </a>
                ) : null}
                <Link
                  to={`/clients/${encodeURIComponent(o.client)}#blueprint`}
                  className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-primary underline-offset-4 hover:underline"
                >
                  Lock the offer
                  <ChevronRight aria-hidden className="size-3.5" />
                </Link>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
