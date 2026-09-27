import { Wordmark } from "@/components/Wordmark";

/**
 * What a build without sign-in shows at "/". The cockpit itself lives behind
 * the portal's sign-in, so this only says what the app is and where it opens.
 */
export function PublicLandingPage() {
  return (
    <div className="flex flex-1 flex-col">
      <section className="flex flex-1 flex-col items-center justify-center px-4 py-16 md:py-24">
        <div className="mx-auto max-w-2xl space-y-6 text-center">
          <div className="flex justify-center">
            <Wordmark size="lg" />
          </div>
          <h1 className="text-4xl font-semibold leading-[1.05] tracking-[-0.03em] sm:text-5xl">
            The client success cockpit.
          </h1>
          <p className="mx-auto max-w-lg text-base leading-relaxed text-muted-foreground md:text-lg">
            Start of day, calls, touchpoints and end of day for client success,
            pulled from ClickUp, the client sheets and the forms. Team members
            open it from the Mahara portal.
          </p>
        </div>
      </section>
    </div>
  );
}
