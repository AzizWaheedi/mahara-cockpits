import { Navigate, Route, Routes, useLocation } from "react-router";
import { AppLayout } from "@/components/AppLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PublicLayout } from "@/components/PublicLayout";
import { PublicOnlyRoute } from "@/components/PublicOnlyRoute";
import { RoleRoute } from "@/components/RoleRoute";
import {
  BacklogPage,
  ClientPage,
  ClientsPage,
  EndOfDayPage,
  FirstSignInPage,
  InboxPage,
  KeyLinksPage,
  LandingPage,
  LoginPage,
  MoneyPage,
  SettingsPage,
  SignupPage,
  TodayPage,
} from "@/pages";

/** An old address, sent on to where its page lives now, with its query string. */
function Moved({ to }: { to: string }) {
  const { search, hash } = useLocation();
  const [path, query = ""] = to.split("?");
  const merged = new URLSearchParams(search);
  for (const [k, v] of new URLSearchParams(query)) merged.set(k, v);
  const qs = merged.toString();
  return <Navigate to={`${path}${qs ? `?${qs}` : ""}${hash}`} replace />;
}

export function AuthenticatedRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<LandingPage />} />
        <Route element={<PublicOnlyRoute />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
        </Route>
        {/* OTP creates a session before password setup finishes; keep the form mounted. */}
        <Route path="/first-sign-in" element={<FirstSignInPage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          {/* biome-ignore lint/a11y/useValidAriaRole: RoleRoute's role prop is a seat name, not an ARIA role */}
          <Route element={<RoleRoute role="csm" />}>
            {/* Five places (the simplification audit, approved 2026-10-06). */}
            <Route path="/dashboard" element={<TodayPage />} />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/clients/:key" element={<ClientPage />} />
            <Route path="/money" element={<MoneyPage />} />
            <Route path="/links" element={<KeyLinksPage />} />
            {/* Today's own pages. */}
            <Route path="/eod" element={<EndOfDayPage />} />
            <Route path="/backlog" element={<BacklogPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            {/* The old addresses land where their page lives now, query string
                kept, so a bookmark or a Slack link never breaks. Every page in
                this cockpit is the CSM's: a session minted for another seat
                gets "not yours", not a crashed screen. */}
            <Route path="/tasks" element={<Moved to="/dashboard" />} />
            <Route path="/meetings" element={<Moved to="/inbox" />} />
            <Route
              path="/performance"
              element={<Moved to="/clients?view=results" />}
            />
            <Route
              path="/billing"
              element={<Moved to="/money?tab=billing" />}
            />
            <Route
              path="/projections"
              element={<Moved to="/money?tab=projections" />}
            />
            <Route path="/churn" element={<Moved to="/money?tab=churn" />} />
            <Route path="/hotlist" element={<Moved to="/money?tab=hot" />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function AuthenticatedAppRoutes() {
  return <AuthenticatedRoutes />;
}
