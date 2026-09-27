import { Menu } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router";
import {
  PortalAutoSignIn,
  portalSignInPending,
} from "./components/PortalAutoSignIn";
import Sidebar from "./components/Sidebar";
import { Wordmark } from "./components/Wordmark";
import { SessionProvider, useWho } from "./lib/auth";
import { useCanOpen, useEodToday, useJobs, useMe } from "./lib/data";
import { portalUrl } from "./lib/portal";
import { Toaster } from "./lib/toast";
import EodPage from "./pages/EodPage";
import { IdeationPage } from "./pages/IdeationPage";
import JobPage from "./pages/JobPage";
import JobsPage from "./pages/JobsPage";
import MeetingsPage from "./pages/MeetingsPage";
import PipelinePage from "./pages/PipelinePage";
import ReviewPage from "./pages/ReviewPage";
import SendReviewPage from "./pages/SendReviewPage";
import SignInPage from "./pages/SignInPage";
import SwipePage from "./pages/SwipePage";
import VideosPage from "./pages/VideosPage";
import WinnersPage from "./pages/WinnersPage";

/** Kuwait's day, which is the day the end of day is filed for. */
function kuwaitDay(): string {
  const now = new Date();
  const kuwait = new Date(
    now.getTime() + (3 * 60 + now.getTimezoneOffset()) * 60_000,
  );
  return kuwait.toISOString().slice(0, 10);
}

function Shell() {
  const { session, email, name, isAdmin, ready, signOut } = useWho();
  const [bumped, setBumped] = useState(0);
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  const me = useMe(session ? email : null);
  const canOpen = useCanOpen(session ? email : null);
  // The marks beside the navigation. Only things to act on get one: jobs
  // ready to start, and a dot until the day has been filed. (Meetings had a
  // count of every meeting, which never cleared, so it has none.)
  const jobs = useJobs();
  const eodDay = useMemo(kuwaitDay, []);
  const eodToday = useEodToday(eodDay);
  const counts = useMemo(
    () => ({
      ready: (jobs.data ?? []).filter(j => j.state === "ready").length,
      eod: eodToday.data?.length ? 0 : 1,
    }),
    [jobs.data, eodToday.data],
  );

  // index.html names the tab "Mahara Media", because a client opening a
  // review link sees it before anything loads. The desk names itself.
  useEffect(() => {
    document.title = "Editor desk · Mahara";
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a portal sign-in reloads the seat
  useEffect(() => {
    if (bumped) {
      me.reload();
      canOpen.reload();
    }
  }, [bumped]);

  // While the portal is signing this person in, the sign-in form stays out
  // of sight; a swap that never finishes falls through after its window.
  const portalWaiting = !session && portalSignInPending();
  const [, wake] = useState(0);
  useEffect(() => {
    if (!portalWaiting) return;
    const t = setTimeout(() => wake(n => n + 1), 46_000);
    return () => clearTimeout(t);
  }, [portalWaiting]);

  // A tap on the phone menu should not leave the drawer over the new page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: closing follows the route
  useEffect(() => setDrawer(false), [location.pathname]);

  const portalBanner = (
    <PortalAutoSignIn
      hasSession={Boolean(session)}
      ready={ready}
      onSignedIn={() => setBumped(b => b + 1)}
    />
  );

  if (!ready) return null;

  if (!session)
    return (
      <>
        {portalBanner}
        {portalWaiting ? <PortalWaiting /> : <SignInPage />}
      </>
    );

  // The database refused the question rather than answering it. Show what it
  // said: this is not the same as being turned away, and guessing which one
  // it was is how the owner of the place got told he had no seat.
  if (canOpen.error) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-lg font-semibold">The desk could not be opened</h1>
        <p className="muted mt-2 text-sm">
          Signed in as {email}, but the database refused the request. This is a
          fault, not a permission: nobody needs to add you to anything.
        </p>
        <p className="muted mt-3 rounded-[var(--radius-md)] bg-[color:var(--muted)] px-3 py-2 font-mono text-xs">
          {canOpen.error}
        </p>
        <div className="mt-6 flex justify-center gap-4">
          <button
            type="button"
            onClick={() => canOpen.reload()}
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
  if (!canOpen.loading && canOpen.data === false) {
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
          , or being named Assigned Editor on a ClickUp card is enough.
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

  const admin = isAdmin || me.data?.role === "admin";
  const who = me.data?.name || name;

  return (
    <div className="flex h-full">
      {/* A rail from 1024px up, a drawer below it: an iPad held upright
          gets the whole width for the page, as in the other cockpits. */}
      <aside className="hidden w-60 shrink-0 border-r bg-card pt-safe lg:block">
        <Sidebar name={who} isAdmin={admin} counts={counts} />
      </aside>

      {drawer ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close the menu"
            onClick={() => setDrawer(false)}
            className="absolute inset-0 bg-black/50"
          />
          <aside className="absolute inset-y-0 left-0 w-[min(18rem,85vw)] border-r bg-card pt-safe pb-safe sm:w-[22rem]">
            <Sidebar
              name={who}
              isAdmin={admin}
              counts={counts}
              onNavigate={() => setDrawer(false)}
            />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {portalBanner}
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
          </div>
        </header>

        <main className="min-w-0 flex-1 lg:pt-[env(safe-area-inset-top,0px)]">
          <Routes>
            <Route path="/" element={<JobsPage />} />
            {/* The portal's door lands on /dashboard in every cockpit. */}
            <Route path="/dashboard" element={<Navigate to="/" replace />} />
            <Route path="/pipeline" element={<PipelinePage />} />
            <Route path="/meetings" element={<MeetingsPage />} />
            <Route path="/videos" element={<VideosPage />} />
            <Route path="/winners" element={<WinnersPage />} />
            <Route
              path="/ideas"
              element={
                <Gutter>
                  <IdeationPage />
                </Gutter>
              }
            />
            <Route
              path="/swipe"
              element={
                <Gutter>
                  <SwipePage />
                </Gutter>
              }
            />
            <Route path="/eod" element={<EodPage />} />
            <Route path="/job/:taskId" element={<JobPage />} />
            <Route path="/send-review" element={<SendReviewPage />} />
            <Route
              path="*"
              element={
                <div className="px-4 py-16 text-center text-sm text-muted-foreground">
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
    </div>
  );
}

/**
 * The gutter for the two pages shared with the other cockpits. Theirs sit
 * inside a padded layout; this desk has none, so without this they ran from
 * edge to edge of the screen.
 */
function Gutter({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      {children}
    </div>
  );
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

/** What shows for the seconds the portal takes to open the desk. */
function PortalWaiting() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6 text-center">
      <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
        Opening the editor desk from the portal…
      </p>
    </div>
  );
}
