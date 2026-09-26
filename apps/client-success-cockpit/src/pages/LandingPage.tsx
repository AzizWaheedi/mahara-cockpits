import { useConvexAuth } from "convex/react";
import { Check } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/Wordmark";

type LandingPageViewProps = {
  isAuthenticated: boolean;
  isLoading: boolean;
  showAuthActions: boolean;
};

function LandingPageView({
  isAuthenticated,
  isLoading,
  showAuthActions,
}: LandingPageViewProps) {
  return (
    <div className="flex-1 flex flex-col">
      <section className="relative flex-1 flex flex-col items-center justify-center px-4 py-16 md:py-24">
        <div className="max-w-2xl mx-auto text-center space-y-6">
          <div className="flex justify-center">
            <Wordmark size="lg" />
          </div>

          <h1 className="text-4xl sm:text-5xl font-semibold tracking-[-0.03em] leading-[1.05]">
            The daily cockpit.
          </h1>

          <p className="text-base md:text-lg text-muted-foreground max-w-lg mx-auto leading-relaxed">
            One screen per role. Start of day, midday calls, end of day. Pulled
            from ClickUp, Meta, the sheets and the forms before you open it.
          </p>

          {showAuthActions && !isAuthenticated && !isLoading && (
            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
              <Button size="lg" className="text-base h-11 px-6" asChild>
                <Link to="/login">Sign in</Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="text-base h-11 px-6"
                asChild
              >
                <Link to="/signup">Create account</Link>
              </Button>
            </div>
          )}
          {showAuthActions && isAuthenticated && (
            <div className="pt-2">
              <Button size="lg" className="text-base h-11 px-6" asChild>
                <Link to="/dashboard">Open your cockpit</Link>
              </Button>
            </div>
          )}

          <div className="flex items-center justify-center gap-6 pt-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Check className="size-4 text-mahara-teal" />
              Media buyer
            </span>
            <span className="flex items-center gap-1.5">
              <Check className="size-4 text-mahara-teal" />
              Client success
            </span>
            <span className="hidden sm:flex items-center gap-1.5">
              <Check className="size-4 text-mahara-teal" />
              Creative
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}

export function LandingPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  return (
    <LandingPageView
      isAuthenticated={isAuthenticated}
      isLoading={isLoading}
      showAuthActions
    />
  );
}
