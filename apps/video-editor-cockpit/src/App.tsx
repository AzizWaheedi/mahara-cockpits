import { useEffect, useState } from "react";
import { Route, Routes } from "react-router";
import { SessionProvider, useWho } from "./lib/auth";
import { useMe } from "./lib/data";
import JobPage from "./pages/JobPage";
import JobsPage from "./pages/JobsPage";
import SignInPage from "./pages/SignInPage";

function ThemeToggle() {
  const [light, setLight] = useState(() => {
    try {
      return localStorage.getItem("desk-theme") === "light";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = light ? "light" : "dark";
    try {
      localStorage.setItem("desk-theme", light ? "light" : "dark");
    } catch {
      // A private window forbids this. The tool still works, it just forgets.
    }
  }, [light]);

  return (
    <button type="button" onClick={() => setLight((l) => !l)} className="muted text-xs">
      {light ? "Dark" : "Light"}
    </button>
  );
}

function Shell() {
  const { session, email, name, ready, signOut } = useWho();
  const me = useMe(session ? email : null);

  if (!ready) return null;
  if (!session) return <SignInPage />;

  // The session is real but the address is not on the list. Say so plainly
  // rather than showing a working page with nothing in it.
  if (!me.loading && !me.data) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-lg font-semibold">Not on the editor list</h1>
        <p className="muted mt-2 text-sm">
          {email} can sign in but cannot see any jobs. Ask Aziz to add the address.
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

  return (
    <div className="min-h-full">
      <header
        className="sticky z-10 border-b hairline bg-[color:var(--page)]/90 backdrop-blur"
        style={{ top: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-2.5">
          <span className="text-sm font-semibold tracking-tight">Editor desk</span>
          <span className="muted ml-auto text-xs">{me.data?.name || name}</span>
          <ThemeToggle />
          <button type="button" onClick={signOut} className="muted text-xs">
            Sign out
          </button>
        </div>
      </header>

      <Routes>
        <Route path="/" element={<JobsPage />} />
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
