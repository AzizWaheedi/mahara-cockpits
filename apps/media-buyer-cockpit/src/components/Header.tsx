import { Link, useLocation } from "react-router";
import { Wordmark } from "@/components/Wordmark";

/**
 * The public pages' header: the wordmark and nothing else. The sign-in form
 * below it is the only way in, so there is no "Sign in" or "Get started"
 * above it. The front door, the sign-in and the sign-up pages carry their
 * own large wordmark, so there the header keeps only the safe-area space and
 * the mark shows once.
 */
export function Header() {
  const location = useLocation();
  const ownMark = ["/", "/login", "/signup"].includes(location.pathname);
  if (ownMark) return <div className="pt-safe" />;
  return (
    <header className="sticky top-0 z-50 border-b bg-background/80 pt-safe backdrop-blur-md">
      <div className="container">
        <div className="flex h-16 items-center">
          <Link
            to="/"
            aria-label="Mahara Media"
            className="flex items-center transition-opacity hover:opacity-80"
          >
            <Wordmark size="sm" />
          </Link>
        </div>
      </div>
    </header>
  );
}
