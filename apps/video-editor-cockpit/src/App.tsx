import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router";
import { PortalAutoSignIn } from "./components/PortalAutoSignIn";
import { Wordmark } from "./components/Wordmark";
import { SessionProvider, useWho } from "./lib/auth";
import { useCanOpen, useMe } from "./lib/data";
import { otherCockpits, portalUrl } from "./lib/portal";
import JobPage from "./pages/JobPage";
import JobsPage from "./pages/JobsPage";
import SignInPage from "./pages/SignInPage";

/**
 * The same switch as the other cockpits: a `dark` class on the root element
 * and the key "theme". Under the portal they share an origin, so a person who
 * picks light in the media buyer finds light here too.
 */
function ThemeToggle() {
  const [dark, setDark] = useState(() => {
    try {
      const stored = localStorage.getItem("theme");
      if (stored === "light" || stored === "dark") return stored === "dark";
    } catch {
      // A private window forbids this; fall through to the system setting.
    }
    return (
      typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {
      // The tool still works, it just forgets.
    }
  }, [dark]);

  return (
    <button type="button" onClick={() => setDark((d) => !d)} className="muted text-xs">
      {dark ? "Light" : "Dark"}
    </button>
  );
}

/** The portal's other doors, so switching cockpits is one click. */
function SwitchCockpit({ cockpits, isAdmin }: { cockpits: string[]; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const doors = otherCockpits(cockpits, isAdmin);
  if (!doors.length) return null;
  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="muted text-xs"
      >
        Switch cockpit
      </button>
      {open && (
        <div className="panel absolute right-0 z-20 mt-2 w-48 overflow-hidden p-1">
          {doors.map((d) => (
            <a
              key={d.key}
              href={d.href}
              className="block rounded px-2.5 py-1.5 text-sm hover:bg-[color:var(--secondary)]"
            >
              {d.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function Shell() {
  const { session, email, name, cockpits, isAdmin, ready, signOut } = useWho();
  const [bumped, setBumped] = useState(0);
  const me = useMe(session ? email : null);
  const canOpen = useCanOpen(session ? email : null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a portal sign-in reloads the seat
  useEffect(() => {
    if (bumped) {
      me.reload();
      canOpen.reload();
    }
  }, [bumped]);

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

  // The session is real but the database will not answer for this address.
  // Say so plainly rather than showing a working page with nothing in it.
  if (!canOpen.loading && canOpen.data === false) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-lg font-semibold">Not on the editor list</h1>
        <p className="muted mt-2 text-sm">
          {email} can sign in but has no seat on the editor desk. An admin adds one in the portal at{" "}
          <a className="underline underline-offset-2" href={`${portalUrl()}/admin`}>
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

  const admin = isAdmin || me.data?.role === "admin";
  const who = me.data?.name || name;

  return (
    <div className="min-h-full">
      {portalBanner}
      <header
        className="sticky z-10 border-b hairline bg-[color:var(--background)]/90 backdrop-blur"
        style={{ top: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-2.5">
          <Wordmark size="sm" />
          <span className="text-sm font-medium tracking-tight">Editor desk</span>
          <span className="muted ml-auto hidden text-xs sm:inline">{who}</span>
          <SwitchCockpit cockpits={cockpits} isAdmin={admin} />
          <ThemeToggle />
          <button type="button" onClick={signOut} className="muted text-xs">
            Sign out
          </button>
        </div>
      </header>

      <Routes>
        <Route path="/" element={<JobsPage />} />
        {/* The portal's door lands on /dashboard in every cockpit. */}
        <Route path="/dashboard" element={<Navigate to="/" replace />} />
        <Route path="/job/:taskId" element={<JobPage />} />
        <Route
          path="*"
          element={<p className="muted p-10 text-center text-sm">That page does not exist.</p>}
        />
      </Routes>
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
