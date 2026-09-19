import { useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { PortalAutoSignIn } from "./components/PortalAutoSignIn";
import Sidebar from "./components/Sidebar";
import { Wordmark } from "./components/Wordmark";
import { SessionProvider, useWho } from "./lib/auth";
import { useCanOpen, useEodToday, useJobs, useMe, useMeetings } from "./lib/data";
import { portalUrl } from "./lib/portal";
import EodPage from "./pages/EodPage";
import IdeasPage from "./pages/IdeasPage";
import JobPage from "./pages/JobPage";
import JobsPage from "./pages/JobsPage";
import MeetingsPage from "./pages/MeetingsPage";
import PipelinePage from "./pages/PipelinePage";
import SignInPage from "./pages/SignInPage";
import VideosPage from "./pages/VideosPage";
import WinnersPage from "./pages/WinnersPage";

/** Kuwait's day, which is the day the end of day is filed for. */
function kuwaitDay(): string {
  const now = new Date();
  const kuwait = new Date(now.getTime() + (3 * 60 + now.getTimezoneOffset()) * 60_000);
  return kuwait.toISOString().slice(0, 10);
}

function Shell() {
  const { session, email, name, isAdmin, ready, signOut } = useWho();
  const [bumped, setBumped] = useState(0);
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  const me = useMe(session ? email : null);
  const canOpen = useCanOpen(session ? email : null);
  // The numbers beside the navigation. Only things to act on get one.
  const jobs = useJobs();
  const meetings = useMeetings();
  const eodDay = useMemo(kuwaitDay, []);
  const eodToday = useEodToday(eodDay);
  const counts = useMemo(
    () => ({
      ready: (jobs.data ?? []).filter((j) => j.state === "ready").length,
      meetings: (meetings.data ?? []).length,
      // One, until the day has been filed. A nudge, not a tally.
      eod: eodToday.data?.length ? 0 : 1,
    }),
    [jobs.data, meetings.data, eodToday.data],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: a portal sign-in reloads the seat
  useEffect(() => {
    if (bumped) {
      me.reload();
      canOpen.reload();
    }
  }, [bumped]);

  // A tap on the phone menu should not leave the drawer over the new page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: closing follows the route
  useEffect(() => setDrawer(false), [location.pathname]);

  const portalBanner = (
    <PortalAutoSignIn
      hasSession={Boolean(session)}
      ready={ready}
      onSignedIn={() => setBumped((b) => b + 1)}
    />
  );

  if (!ready) return null;
  if (!session)
    return (
      <>
        {portalBanner}
        <SignInPage />
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
          Signed in as {email}, but the database refused the request. This is a fault, not a
          permission: nobody needs to add you to anything.
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
          {email} can sign in but has no seat on the editor desk. An admin adds one in the portal at{" "}
          <a className="underline underline-offset-2" href={`${portalUrl()}/admin`}>
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
      {/* Fixed on a desktop, a drawer on a phone: the same shape as the
          other cockpits without pulling in their sidebar library. */}
      <aside className="hidden w-56 shrink-0 border-r hairline bg-[color:var(--card)] md:block">
        <Sidebar name={who} isAdmin={admin} counts={counts} />
      </aside>

      {drawer ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close the menu"
            onClick={() => setDrawer(false)}
            className="absolute inset-0 bg-black/50"
          />
          <aside className="absolute inset-y-0 left-0 w-60 border-r hairline bg-[color:var(--card)]">
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
        <header
          className="sticky z-10 flex items-center gap-3 border-b hairline bg-[color:var(--background)]/90 px-4 py-2.5 backdrop-blur md:hidden"
          style={{ top: "env(safe-area-inset-top, 0px)" }}
        >
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label="Open the menu"
            className="muted text-sm"
          >
            Menu
          </button>
          <Wordmark size="sm" className="ml-auto" />
        </header>

        <Routes>
          <Route path="/" element={<JobsPage />} />
          {/* The portal's door lands on /dashboard in every cockpit. */}
          <Route path="/dashboard" element={<Navigate to="/" replace />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/meetings" element={<MeetingsPage />} />
          <Route path="/videos" element={<VideosPage />} />
          <Route path="/winners" element={<WinnersPage />} />
          <Route path="/ideas" element={<IdeasPage />} />
          <Route path="/eod" element={<EodPage />} />
          <Route path="/job/:taskId" element={<JobPage />} />
          <Route
            path="*"
            element={<p className="muted p-10 text-center text-sm">That page does not exist.</p>}
          />
        </Routes>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  );
}
