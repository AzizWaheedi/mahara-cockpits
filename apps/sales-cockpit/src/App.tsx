import { CalendarDays, Menu, PhoneCall, Sun, UserSearch } from "lucide-react";
import { lazy, type ReactNode, Suspense, useEffect, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router";
import { PageBoundary } from "./components/PageBoundary";
import {
  PortalAutoSignIn,
  portalSignInPending,
} from "./components/PortalAutoSignIn";
import Sidebar from "./components/Sidebar";
import { Wordmark } from "./components/Wordmark";
import { SessionProvider, useWho } from "./lib/auth";
import { useFollowupsWaiting, useMe, useOwed, useProposals } from "./lib/data";
import { portalUrl } from "./lib/portal";
import { Toaster } from "./lib/toast";
import type { Me } from "./lib/types";
import SignInPage from "./pages/SignInPage";
import TodayPage from "./pages/TodayPage";

const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const LeadsPage = lazy(() => import("./pages/LeadsPage"));
const LeadPage = lazy(() => import("./pages/LeadPage"));
const CallPage = lazy(() => import("./pages/CallPage"));
const DialerPage = lazy(() => import("./pages/DialerPage"));
const ProposalsPage = lazy(() => import("./pages/ProposalsPage"));
const ProposalPage = lazy(() => import("./pages/ProposalPage"));
const NumbersPage = lazy(() => import("./pages/NumbersPage"));
const GoalsPage = lazy(() => import("./pages/GoalsPage"));
const EodPage = lazy(() => import("./pages/EodPage"));
const FollowupsPage = lazy(() => import("./pages/FollowupsPage"));
const RecordingsPage = lazy(() => import("./pages/RecordingsPage"));
const RecordingPage = lazy(() => import("./pages/RecordingPage"));
const ReviewOnlyPage = lazy(() =>
  import("./pages/RecordingPage").then(m => ({ default: m.ReviewOnlyPage })),
);
const LinksPage = lazy(() => import("./pages/LinksPage"));
const TeamPage = lazy(() => import("./pages/TeamPage"));

const ROLE_WORDS: Record<string, string> = {
  setter: "Setter",
  closer: "Closer",
  both: "Setter and closer",
  manager: "Sales manager",
};

function Shell() {
  const { session, email, name, isAdmin, ready, signOut } = useWho();
  const [bumped, setBumped] = useState(0);
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  const me = useMe(Boolean(session));

  // biome-ignore lint/correctness/useExhaustiveDependencies: a portal sign-in reloads the seat
  useEffect(() => {
    if (bumped) me.reload();
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: closing follows the route
  useEffect(() => setDrawer(false), [location.pathname]);

  const portalBanner = (
    <PortalAutoSignIn
      hasSession={Boolean(session)}
      ready={ready}
      onSignedIn={() => setBumped(b => b + 1)}
    />
  );

  if (!ready) return <Waiting text="Opening the sales cockpit…" />;

  if (!session)
    return (
      <>
        {portalBanner}
        {portalWaiting ? (
          <Waiting text="Opening the sales cockpit from the portal…" />
        ) : (
          <SignInPage />
        )}
      </>
    );

  if (me.error)
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-lg font-semibold">
          The sales cockpit could not be opened
        </h1>
        <p className="muted mt-2 text-sm">
          Signed in as {email}, but the database refused the request. This is a
          fault, not a permission: nobody needs to add you to anything.
        </p>
        <p className="muted mt-3 rounded-[var(--radius-md)] bg-[color:var(--muted)] px-3 py-2 font-mono text-xs">
          {me.error}
        </p>
        <div className="mt-6 flex justify-center gap-4">
          <button
            type="button"
            onClick={() => me.reload()}
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

  if (me.loading && !me.data)
    return <Waiting text="Opening the sales cockpit…" />;

  if (!me.data?.seat)
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-lg font-semibold">Not on the sales team</h1>
        <p className="muted mt-2 text-sm">
          {email} can sign in but has no seat in the sales cockpit. Aziz gives
          one on the portal's Admin page at{" "}
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

  return (
    <Seated
      me={me.data}
      name={me.data.name || name}
      isAdmin={isAdmin}
      drawer={drawer}
      setDrawer={setDrawer}
      banner={portalBanner}
    />
  );
}

/** The signed-in cockpit. Exported for the layout harness (src/dev/harness.tsx). */
export function Seated({
  me,
  name,
  isAdmin,
  drawer,
  setDrawer,
  banner,
}: {
  me: Me;
  name: string;
  isAdmin: boolean;
  drawer: boolean;
  setDrawer: (v: boolean) => void;
  banner: ReactNode;
}) {
  const mine = me.manager ? null : (me.ghl_user_id ?? "__none__");
  const owed = useOwed(mine, 30, 120_000);
  const proposals = useProposals(me.manager ? null : (me.email ?? null));
  const followups = useFollowupsWaiting(me.email ?? null, Boolean(me.manager));
  const counts = {
    followups: (followups.data ?? []).length,
    owed: (owed.data ?? []).length,
    proposals: (proposals.data ?? []).filter(
      p => p.status === "needs_input" || p.status === "ready",
    ).length,
  };
  const role = ROLE_WORDS[String(me.role)] ?? "Sales";
  const { pathname } = useLocation();
  const sidebar = (onNavigate?: () => void) => (
    <Sidebar
      name={name}
      role={role}
      isAdmin={isAdmin}
      isManager={Boolean(me.manager)}
      counts={counts}
      onNavigate={onNavigate}
    />
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-56 shrink-0 border-r hairline bg-[color:var(--card)] md:block">
        {sidebar()}
      </aside>

      {drawer ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close the menu"
            onClick={() => setDrawer(false)}
            className="absolute inset-0 bg-black/50"
          />
          <aside className="pt-safe absolute inset-y-0 left-0 w-64 border-r hairline bg-[color:var(--card)]">
            {sidebar(() => setDrawer(false))}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto pb-16 md:pb-0">
        {banner}
        <header className="pt-safe sticky top-0 z-10 flex items-center gap-3 border-b hairline bg-[color:var(--background)]/90 px-4 py-2.5 backdrop-blur md:hidden">
          <Wordmark size="sm" />
          <span className="muted text-sm">Sales</span>
        </header>

        {/* Keyed by the address, so moving to another page clears an error. */}
        <PageBoundary key={pathname}>
          <Suspense fallback={<Waiting text="Loading…" />}>
            <Routes>
              <Route path="/" element={<TodayPage me={me} />} />
              {/* The portal's door lands on /dashboard in every cockpit. */}
              <Route path="/dashboard" element={<Navigate to="/" replace />} />
              <Route path="/calendar" element={<CalendarPage me={me} />} />
              <Route path="/leads" element={<LeadsPage />} />
              <Route path="/lead/:contactId" element={<LeadPage me={me} />} />
              <Route path="/call/:contactId" element={<CallPage me={me} />} />
              <Route path="/dialer" element={<DialerPage me={me} />} />
              <Route path="/proposals" element={<ProposalsPage me={me} />} />
              <Route path="/proposal/:id" element={<ProposalPage me={me} />} />
              <Route path="/numbers" element={<NumbersPage me={me} />} />
              <Route path="/goals" element={<GoalsPage me={me} />} />
              <Route path="/eod" element={<EodPage me={me} />} />
              <Route path="/followups" element={<FollowupsPage me={me} />} />
              <Route path="/recordings" element={<RecordingsPage me={me} />} />
              <Route
                path="/recording/:id"
                element={<RecordingPage me={me} />}
              />
              <Route path="/review/:id" element={<ReviewOnlyPage />} />
              <Route path="/links" element={<LinksPage me={me} />} />
              <Route
                path="/team"
                element={
                  me.manager ? (
                    <TeamPage me={me} />
                  ) : (
                    <Navigate to="/" replace />
                  )
                }
              />
              <Route
                path="*"
                element={
                  <p className="muted p-10 text-center text-sm">
                    That page does not exist.
                  </p>
                }
              />
            </Routes>
          </Suspense>
        </PageBoundary>
      </div>

      <TabBar owed={counts.owed} onMore={() => setDrawer(true)} />
    </div>
  );
}

/** Below md the rail becomes a tab bar: the four places a rep goes all day; Numbers and the rest are under More. */
function TabBar({ owed, onMore }: { owed: number; onMore: () => void }) {
  const tabs = [
    { to: "/", label: "Today", icon: Sun },
    { to: "/dialer", label: "Dialer", icon: PhoneCall },
    { to: "/calendar", label: "Calendar", icon: CalendarDays, n: owed },
    { to: "/leads", label: "Leads", icon: UserSearch },
  ];
  return (
    <nav
      className="pb-safe fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t hairline bg-[color:var(--card)]/95 backdrop-blur md:hidden"
      aria-label="Sections"
    >
      {tabs.map(({ to, label, icon: Icon, n }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          className={({ isActive }) =>
            `no-touch relative flex flex-col items-center gap-0.5 py-2 text-[11px] ${isActive ? "font-medium" : "muted"}`
          }
        >
          <Icon className="size-5" strokeWidth={1.75} aria-hidden />
          {label}
          {n ? (
            <span
              className="absolute top-1 left-1/2 ml-2 rounded-full px-1 text-[10px] font-semibold tabular-nums"
              style={{ background: "var(--owed)", color: "#1b1300" }}
            >
              {n}
            </span>
          ) : null}
        </NavLink>
      ))}
      <button
        type="button"
        onClick={onMore}
        className="no-touch muted flex flex-col items-center gap-0.5 py-2 text-[11px]"
      >
        <Menu className="size-5" strokeWidth={1.75} aria-hidden />
        More
      </button>
    </nav>
  );
}

function Waiting({ text }: { text: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6 text-center">
      <p className="muted text-sm">{text}</p>
    </div>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <Shell />
      <Toaster />
    </SessionProvider>
  );
}
