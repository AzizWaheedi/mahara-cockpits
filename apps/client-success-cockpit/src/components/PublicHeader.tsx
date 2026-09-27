import { Link } from "react-router";
import { Wordmark } from "@/components/Wordmark";
import { APP_NAME } from "@/lib/constants";

export function PublicHeader() {
  return (
    <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-md pt-safe">
      <div className="container">
        <div className="flex h-16 items-center justify-between">
          <Link
            to="/"
            className="flex items-center gap-2.5 font-semibold text-lg hover:opacity-80 transition-opacity"
          >
            <Wordmark size="sm" />
            <span className="hidden sm:inline text-sm text-muted-foreground">
              {APP_NAME}
            </span>
          </Link>
        </div>
      </div>
    </header>
  );
}
