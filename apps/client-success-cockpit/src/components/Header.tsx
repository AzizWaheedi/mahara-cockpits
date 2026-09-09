import { useConvexAuth } from "convex/react";
import { ArrowRight } from "lucide-react";
import { Link, useLocation } from "react-router";
import { APP_NAME } from "@/lib/constants";
import { Button } from "./ui/button";

type HeaderViewProps = {
  isAuthenticated: boolean;
  isLoading: boolean;
  showAuthActions: boolean;
};

function HeaderView({
  isAuthenticated,
  isLoading,
  showAuthActions,
}: HeaderViewProps) {
  const location = useLocation();

  const isAuthPage =
    location.pathname === "/login" || location.pathname === "/signup";

  return (
    <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-md">
      <div className="container">
        <div className="flex h-16 items-center justify-between">
          <Link
            to="/"
            className="flex items-center gap-2.5 font-semibold text-lg hover:opacity-80 transition-opacity"
          >
            <div className="size-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">
                M
              </span>
            </div>
            <span className="hidden sm:inline">{APP_NAME}</span>
          </Link>

          <nav className="flex items-center gap-2">
            {!showAuthActions || isLoading ? null : isAuthenticated ? (
              <Button size="sm" asChild>
                <Link to="/dashboard">
                  Open App
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            ) : (
              !isAuthPage && (
                <>
                  <Button variant="ghost" size="sm" asChild>
                    <Link to="/login">Sign In</Link>
                  </Button>
                  <Button size="sm" asChild>
                    <Link to="/signup">Get Started</Link>
                  </Button>
                </>
              )
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}

export function Header() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  return (
    <HeaderView
      isAuthenticated={isAuthenticated}
      isLoading={isLoading}
      showAuthActions
    />
  );
}
