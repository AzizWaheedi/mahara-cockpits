import { Menu, Search } from "lucide-react";
import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useState,
} from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router";
import { MacOSDock } from "./components/MacOSDock";
import { MacOSMenuBar } from "./components/MacOSMenuBar";
import { PageBoundary } from "./components/PageBoundary";
import { SearchBox } from "./components/SearchBox";
import Sidebar from "./components/Sidebar";
import { Wordmark } from "./components/Wordmark";
import { SessionProvider, useWho } from "./lib/auth";
import { useFollowupsWaiting, useMe, useOwed, useProposals } from "./lib/data";
import { portalUrl } from "./lib/portal";
import { openSearch } from "./lib/search";
import { Toaster } from "./lib/toast";
import type { Me } from "./lib/types";
import SignInPage from "./pages/SignInPage";
import TodayPage from "./pages/TodayPage";

const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const LeadsPage = lazy(() => import("./pages/LeadsPage"));
const LeadPage = lazy(() => import("./pages/LeadPage"));

/**
 * One lead's page, started fresh for each lead: a draft, a picked recording
 * or a half-written note never carries over to the next lead opened.
 */
function KeyedLead({ me }: { me: Me }) {
  const { contactId = "" } = useParams();
  return <LeadPage key={contactId} me={me} />;
}
const CallPage = lazy(() => import("./pages/CallPage"));
const DialerPage = lazy(() => import("./pages/DialerPage"));
const ProposalsPage = lazy(() => import("./pages/ProposalsPage"));
const ContractsPage = lazy(() => import("./pages/ContractsPage"));
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
const PipelinePage = lazy(() => import("./pages/PipelinePage"));
const IntelligencePage = lazy(() => import("./pages/IntelligencePage"));
const TeamPage = lazy(() => import("./pages/TeamPage"));
const DeckPage = lazy(() => import("./pages/DeckPage"));

const ROLE_WORDS: Record<string, string> = {
  setter: "Setter",
  closer: "Closer",
  both: "Setter and closer",
  manager: "Sales manager",
};

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
    ready && !accessError && (isCeo || isAdmin || cockpits.includes("sales"));
  const me = useMe(Boolean(session) && allowed);

  // biome-ignore lint/correctness/useExhaustiveDependencies: closing follows the route
  useEffect(() => setDrawer(false), [location.pathname]);

  if (!ready) return <Waiting text="Opening the sales cockpit…" />;

  if (!session && !accessError) return <SignInPage />;

  if (accessError || me.error)
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
          {accessError || me.error}
        </p>
        <div className="mt-6 flex justify-center gap-4">
          <button
            type="button"
            onClick={() => {
              void refreshAccess().catch(() => {});
              me.reload();
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

  if (allowed && me.loading && !me.data)
    return <Waiting text="Opening the sales cockpit…" />;

  if (!allowed || !me.data?.seat)
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
      banner={null}
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sales_sidebar_collapsed") === "1";
    } catch {
      return false;
    }
  });

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem("sales_sidebar_collapsed", next ? "1" : "0");
      } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);

  const sidebar = (onNavigate?: () => void) => (
    <Sidebar
      name={name}
      role={role}
      isAdmin={isAdmin}
      isManager={Boolean(me.manager)}
      counts={counts}
      onNavigate={onNavigate}
      collapsed={sidebarCollapsed}
      onToggleCollapse={toggleSidebar}
    />
  );

  return (
    <div className="flex h-full lg:pt-[env(safe-area-inset-top,0px)]">
      {/* Floating Detached Sidebar Island (Mahara Soft Floating) */}
      <div className="hidden lg:flex lg:flex-col lg:justify-center my-2.5 ml-3 shrink-0">
        <aside
          className={`h-[calc(100dvh-1.25rem)] rounded-[26px] border border-border bg-background/90 backdrop-blur-2xl shadow-2xl transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] overflow-hidden flex flex-col ${
            sidebarCollapsed ? "w-16" : "w-60"
          }`}
        >
          {sidebar()}
        </aside>
      </div>

      {drawer ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close the menu"
            onClick={() => setDrawer(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <aside className="pt-safe absolute inset-y-2.5 left-2.5 w-64 rounded-[24px] border border-border bg-background/95 shadow-2xl backdrop-blur-2xl overflow-hidden flex flex-col">
            {sidebar(() => setDrawer(false))}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] lg:pb-0">
        {banner}

        {/* Desktop authentic macOS Menu Bar */}
        <div className="hidden lg:block">
          <MacOSMenuBar
            name={name}
            role={role}
            owedCount={counts.owed}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={toggleSidebar}
          />
        </div>

        {/* Mobile header */}
        <header className="pt-safe sticky top-0 z-10 flex items-center justify-between border-b hairline bg-[color:var(--background)]/85 px-4 py-2.5 backdrop-blur-md lg:hidden">
          <div className="flex items-center gap-3">
            <Wordmark size="sm" />
            <span className="muted text-sm">Sales</span>
          </div>
          <div className="flex items-center gap-2">
            {counts.owed > 0 ? (
              <span
                className="rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
                style={{
                  background: "var(--owed)",
                  color: "var(--warning-foreground)",
                }}
              >
                {counts.owed} owed
              </span>
            ) : null}
            <button
              type="button"
              onClick={openSearch}
              aria-label="Search leads and pages"
              className="-mr-2 flex size-10 items-center justify-center rounded-[12px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"
            >
              <Search className="size-5" strokeWidth={1.8} aria-hidden />
            </button>
          </div>
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
              <Route path="/lead/:contactId" element={<KeyedLead me={me} />} />
              <Route path="/call/:contactId" element={<CallPage me={me} />} />
              <Route path="/dialer" element={<DialerPage me={me} />} />
              <Route path="/pipeline" element={<PipelinePage me={me} />} />
              <Route path="/intelligence" element={<IntelligencePage />} />
              <Route path="/proposals" element={<ProposalsPage me={me} />} />
              <Route path="/contracts" element={<ContractsPage me={me} />} />
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
              <Route path="/deck" element={<DeckPage me={me} />} />
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
      <SearchBox isManager={Boolean(me.manager)} />
    </div>
  );
}

/** Below lg the rail becomes the authentic MacOS Floating Dock (SF-01): cosine magnification & click bounce. */
function TabBar({ owed, onMore }: { owed: number; onMore: () => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-3 z-30 flex justify-center px-2 lg:hidden">
      <div className="pointer-events-auto flex items-center gap-1.5">
        <MacOSDock
          owedCount={owed}
          baseSize={36}
          maxScale={1.35}
          className="shadow-2xl"
        />
        <button
          type="button"
          onClick={onMore}
          title="More sections"
          className="floating-dock pointer-events-auto flex size-10 shrink-0 items-center justify-center text-white/70 hover:text-white transition-colors"
        >
          <Menu className="size-4.5" strokeWidth={1.8} aria-hidden />
        </button>
      </div>
    </div>
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
