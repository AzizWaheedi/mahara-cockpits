import { Navigate, Route, Routes, useLocation } from "react-router";
import { OAUTH_CALLBACK_PATH } from "@/auth/oauthReturn";
import { AppLayout } from "@/components/AppLayout";
import { Library } from "@/components/Library";
import { PortalAutoSignIn } from "@/components/PortalAutoSignIn";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PublicLayout } from "@/components/PublicLayout";
import { PublicOnlyRoute } from "@/components/PublicOnlyRoute";
import { RoleRoute } from "@/components/RoleRoute";
import { SpaceSessionAutoSignIn } from "@/components/SpaceSessionAutoSignIn";
import { ViktorAutoSignIn } from "@/components/ViktorAutoSignIn";
import { ViktorProductAuthProvider } from "@/lib/viktor-spaces-access/ViktorProductAuthProvider";
import {
  AdminPage,
  AdsPage,
  CeoPage,
  EndOfDayPage,
  GoPage,
  IdeationPage,
  LoginPage,
  PlaybookPage,
  PortalHome,
  SettingsPage,
  SignupPage,
  SwipePage,
  TodayPage,
} from "@/pages";
import { MeetingPage } from "@/pages/team/MeetingPage";
import { TeamPage } from "@/pages/team/TeamPage";
import { ViktorOAuthCallbackPage } from "@/pages/ViktorOAuthCallbackPage";

/** An old address, sent on to where its page lives now, with its query string. */
function Moved({ to }: { to: string }) {
  const { search, hash } = useLocation();
  const [path, query = ""] = to.split("?");
  const [base, anchor] = path.split("#");
  const merged = new URLSearchParams(search);
  for (const [k, v] of new URLSearchParams(query)) merged.set(k, v);
  const qs = merged.toString();
  return (
    <Navigate
      to={`${base}${qs ? `?${qs}` : ""}${anchor ? `#${anchor}` : hash}`}
      replace
    />
  );
}

export function AuthenticatedRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        {/* The portal's front door: sign in, then straight to your cockpit. */}
        <Route path="/" element={<PortalHome />} />
        <Route element={<PublicOnlyRoute />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
        </Route>
      </Route>

      {/* Return leg of "Sign in with Viktor" — outside the auth guards
          because it owns the loading/outcome handling itself. */}
      <Route path={OAUTH_CALLBACK_PATH} element={<ViktorOAuthCallbackPage />} />

      <Route element={<ProtectedRoute />}>
        {/* The door into the cockpits on the other deployments. */}
        <Route path="/go/:cockpit" element={<GoPage />} />
        <Route element={<AppLayout />}>
          {/* biome-ignore lint/a11y/useValidAriaRole: RoleRoute's role prop is a seat name, not an ARIA role */}
          <Route element={<RoleRoute role="admin" />}>
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/ceo" element={<CeoPage />} />
          </Route>
          {/* Media buyer's cockpit — her link only. Three places (the
              simplification audit, approved 2026-10-06): Today, Ads and the
              Library's three tabs; End of day opens from Today. */}
          {/* biome-ignore lint/a11y/useValidAriaRole: RoleRoute's role prop is a seat name, not an ARIA role */}
          <Route element={<RoleRoute role="media_buyer" />}>
            <Route path="/dashboard" element={<TodayPage />} />
            <Route path="/ads" element={<AdsPage />} />
            <Route path="/eod" element={<EndOfDayPage />} />
            <Route
              path="/playbook"
              element={
                <Library>
                  <PlaybookPage />
                </Library>
              }
            />
            <Route
              path="/ideation"
              element={
                <Library>
                  <IdeationPage />
                </Library>
              }
            />
            <Route
              path="/swipe"
              element={
                <Library>
                  <SwipePage />
                </Library>
              }
            />
          </Route>
          {/* The old addresses land where their part lives now, so the
              morning checklist's links and any bookmark still work. */}
          <Route path="/tasks" element={<Moved to="/dashboard#tasks" />} />
          <Route
            path="/touchpoints"
            element={<Moved to="/dashboard#touchpoints" />}
          />
          {/* The starter template had made-up numbers; the old client
              success page here was replaced by the client success cockpit. */}
          <Route path="/template" element={<Moved to="/dashboard" />} />
          <Route path="/csm" element={<Navigate to="/go/csm" replace />} />
          {/* Team meetings: everybody with a seat in the portal. */}
          <Route path="/team" element={<TeamPage />} />
          <Route path="/team/:id" element={<MeetingPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function AuthenticatedAppRoutes() {
  return (
    <ViktorProductAuthProvider enabled>
      {/* Outside the routes so links carrying `viktor_sign_in=auto` work no
          matter which page they land on. */}
      <ViktorAutoSignIn />
      {/* Exchanges a backend-minted space-session token (put in sessionStorage
          by the e2e/screenshot runner) for a Convex Auth session. Inert on a
          normal visit. */}
      <SpaceSessionAutoSignIn />
      <PortalAutoSignIn />
      <AuthenticatedRoutes />
    </ViktorProductAuthProvider>
  );
}
