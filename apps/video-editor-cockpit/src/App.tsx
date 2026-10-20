import { Menu, Search } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router";
import { JobsHome, Library } from "./components/Places";
import { SearchBox } from "./components/SearchBox";
import Sidebar from "./components/Sidebar";
import { Wordmark } from "./components/Wordmark";
import { SessionProvider, useWho } from "./lib/auth";
import { useCanOpen, useEodToday, useJobs, useMe } from "./lib/data";
import { kuwaitDay } from "./lib/format";
import { portalUrl } from "./lib/portal";
import { openSearch } from "./lib/search";
import { onEditor } from "./lib/stages";
import { Toaster } from "./lib/toast";
import EodPage from "./pages/EodPage";
import GuidePage from "./pages/GuidePage";
import { IdeationPage } from "./pages/IdeationPage";
import JobPage from "./pages/JobPage";
import MeetingsPage from "./pages/MeetingsPage";
import ReviewPage from "./pages/ReviewPage";
import SendReviewPage from "./pages/SendReviewPage";
import SignInPage from "./pages/SignInPage";
import SwipePage from "./pages/SwipePage";
import VideosPage from "./pages/VideosPage";
import WinnersPage from "./pages/WinnersPage";

function Shell() {
  const {
    session,
    email,
    name,
    isAdmin,
    isCeo,
    cockpits,
    ready,
    error: accessError,
    refreshAccess,
    signOut,
  } = useWho();
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  const allowed =
    ready && !accessError && (isCeo || isAdmin || cockpits.includes("editor"));
  const me = useMe(session && allowed ? email : null);
  const canOpen = useCanOpen(session && allowed ? email : null);
  // The marks beside the navigation. Only things to act on get one: jobs
  // ready to start, and a dot until the day has been filed. (Meetings had a
  // count of every meeting, which never cleared, so it has none.)
  const jobs = useJobs();
  const eodDay = useMemo(kuwaitDay, []);
  const eodToday = useEodToday(eodDay, session && allowed ? email : null);
  const counts = useMemo(
    () => ({
      // The same rule as the Jobs page: ready, and the editor's turn.
      ready: (jobs.data ?? []).filter(j => onEditor(j) && j.state === "ready")
        .length,
      // A failed read says nothing either way, so it draws no dot. A filing
      // that failed did not reach the sheet, so the dot stays.
      eod:
        eodToday.error || eodToday.loading
          ? 0
          : (eodToday.data ?? []).some(r => r.status !== "failed")
            ? 0
            : 1,
    }),
    [jobs.data, eodToday.data, eodToday.error, eodToday.loading],
  );

  // The rail folds to its icons from 1024px (the button at its top, or
  // Ctrl/Cmd + B), and the choice is remembered, as in the client success
  // and media buyer cockpits.
  const [folded, setFolded] = useState(() => {
    try {
      return localStorage.getItem(FOLD_KEY) === "collapsed";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(FOLD_KEY, folded ? "collapsed" : "open");
    } catch {
      // A private window forbids this; the rail just forgets.
    }
  }, [folded]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setFolded(f => !f);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  // index.html names the tab "Mahara Media", because a client opening a
  // review link sees it before anything loads. The desk names itself.
  useEffect(() => {
    document.title = "Editor desk · Mahara";
  }, []);

  // A tap on the phone menu should not leave the drawer over the new page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: closing follows the route
  useEffect(() => setDrawer(false), [location.pathname]);

  if (!ready) return null;

  if (!session && !accessError) return <SignInPage />;

  // The database refused the question rather than answering it. Show what it
  // said: this is not the same as being turned away, and guessing which one
  // it was is how the owner of the place got told he had no seat.
  if (accessError || canOpen.error) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-lg font-semibold">The desk could not be opened</h1>
        <p className="muted mt-2 text-sm">
          Signed in as {email}, but the database refused the request. This is a
          fault, not a permission: nobody needs to add you to anything.
        </p>
        <p className="muted mt-3 rounded-[var(--radius-md)] bg-[color:var(--muted)] px-3 py-2 font-mono text-xs">
          {accessError || canOpen.error}
        </p>
        <div className="mt-6 flex justify-center gap-4">
          <button
            type="button"
            onClick={() => {
              void refreshAccess().catch(() => {});
              canOpen.reload();
            }}
            className="muted text-sm underline underline-offset-4"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={signOut}
            className="muted text-sm underline underline-offset-4"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  // The database answered, and the answer was no.
  if (!allowed || (!canOpen.loading && canOpen.data === false)) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-lg font-semibold">Not on the editor list</h1>
        <p className="muted mt-2 text-sm">
          {email} can sign in but has no seat on the editor desk. An admin adds
          one in the portal at{" "}
          <a
            className="underline underline-offset-2"
            href={`${portalUrl()}/admin`}
          >
            {portalUrl().replace(/^https?:\/\//, "")}/admin
          </a>
          .
        </p>
        <button
          type="button"
          onClick={signOut}
          className="muted mt-6 text-sm underline underline-offset-4"
        >
          Sign out
        </button>
      </div>
    );
  }

  const who = me.data?.name || name;

  return (
    <div className="flex h-full">
      {/* A floating rail from 1024px up, a sheet below it: an iPad held
          upright gets the whole width for the page, as in the other
          cockpits. 14rem open and 4rem folded, plus the 8px float. */}
      <aside
        className="hidden shrink-0 p-2 transition-[width] duration-150 ease-[cubic-bezier(.4,0,.2,1)] motion-reduce:transition-none lg:block"
        style={{ width: folded ? "5rem" : "15rem" }}
      >
        <div className="h-full overflow-hidden rounded-2xl border border-sidebar-border/70 bg-sidebar/95 shadow-lg shadow-black/5 backdrop-blur-md">
          <Sidebar
            name={who}
            isAdmin={isAdmin}
            counts={counts}
            folded={folded}
            onToggleFold={() => setFolded(f => !f)}
          />
        </div>
      </aside>

      {drawer ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close the menu"
            onClick={() => setDrawer(false)}
            className="absolute inset-0 bg-black/50"
          />
          <aside className="absolute inset-y-0 left-0 w-full border-r bg-sidebar pt-safe pb-safe sm:w-[22rem]">
            <Sidebar
              name={who}
              isAdmin={isAdmin}
              counts={counts}
              onNavigate={() => setDrawer(false)}
              onClose={() => setDrawer(false)}
            />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {/* Pinned to the very top and padded by the status bar, so in the
            installed app it covers the strip behind the clock instead of
            starting under it. */}
        <header className="sticky top-0 z-10 border-b bg-background/90 px-2 pt-safe backdrop-blur lg:hidden">
          <div className="flex h-14 items-center gap-2">
            <button
              type="button"
              onClick={() => setDrawer(true)}
              aria-label="Open the menu"
              className="grid size-10 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Menu aria-hidden className="size-5" />
            </button>
            <Wordmark size="sm" />
            <span className="text-sm text-muted-foreground">Editor desk</span>
            <button
              type="button"
              onClick={openSearch}
              aria-label="Search"
              className="ml-auto grid size-10 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Search aria-hidden className="size-5" />
            </button>
          </div>
        </header>

        {/* The layout pads every page, 16 / 24 / 32px (DESIGN.md, Pages). */}
        <main className="min-w-0 flex-1 px-4 pt-4 pb-12 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8">
          <Routes>
            {/* Jobs is home: the list, or the board (?view=board). */}
            <Route path="/" element={<JobsHome eodDue={counts.eod > 0} />} />
            {/* The portal's door lands on /dashboard in every cockpit. */}
            <Route path="/dashboard" element={<Navigate to="/" replace />} />
            {/* The Pipeline page is the board view of Jobs now. */}
            <Route
              path="/pipeline"
              element={<Navigate to="/?view=board" replace />}
            />
            <Route path="/meetings" element={<MeetingsPage />} />
            <Route path="/videos" element={<VideosPage />} />
            {/* What works, Ideation and the swipe file: one Library. */}
            <Route
              path="/winners"
              element={
                <Library>
                  <WinnersPage />
                </Library>
              }
            />
            <Route
              path="/ideas"
              element={
                <Library>
                  <Gutter>
                    <IdeationPage />
                  </Gutter>
                </Library>
              }
            />
            <Route
              path="/swipe"
              element={
                <Library>
                  <Gutter>
                    <SwipePage />
                  </Gutter>
                </Library>
              }
            />
            <Route path="/eod" element={<EodPage />} />
            <Route path="/job/:taskId" element={<OneJob />} />
            <Route path="/guide" element={<GuidePage />} />
            <Route path="/send-review" element={<SendReviewPage />} />
            <Route
              path="*"
              element={
                <div className="py-16 text-center text-sm text-muted-foreground">
                  <p>That page does not exist.</p>
                  <Link
                    to="/"
                    className="mt-2 inline-block text-primary underline-offset-4 hover:underline"
                  >
                    Back to jobs
                  </Link>
                </div>
              }
            />
          </Routes>
        </main>
      </div>
      <SearchBox />
    </div>
  );
}

const FOLD_KEY = "mahara-editor-sidebar";

/**
 * The width for the two pages shared with the other cockpits. The layout's
 * main pads them now, as theirs does.
 */
function Gutter({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl">{children}</div>;
}

/**
 * One job page per job. Keyed by the id, so moving from one job to another
 * starts a fresh page: a cut link or a note typed for one job can never be
 * sent with the next one's id.
 */
function OneJob() {
  const { taskId = "" } = useParams();
  return <JobPage key={taskId} />;
}

/**
 * A client's review link. Matched loosely because the app is served under
 * /editor/ in production and at the root in development, and a check for
 * one breaks the other.
 */
const REVIEW_PATH = /(^|\/)review\/[^/]+$/;

export default function App() {
  // A client holding a review link has no account and never will, so
  // their page is answered here, before the desk's session and its data
  // hooks exist. Answered inside the desk, it waited for the session check
  // and asked Supabase for jobs, meetings and the day's end of day as a
  // signed-out visitor -- three failed requests on every open of the most
  // visible page the agency hands over.
  if (REVIEW_PATH.test(window.location.pathname))
    return (
      <Routes>
        <Route path="/review/:token" element={<ReviewPage />} />
      </Routes>
    );
  return (
    <SessionProvider>
      <Shell />
      <Toaster />
    </SessionProvider>
  );
}
