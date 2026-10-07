import { Navigate, Route, Routes, useLocation } from "react-router";
import { AppLayout } from "@/components/AppLayout";
import { Library } from "@/components/Library";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PublicLayout } from "@/components/PublicLayout";
import { PublicOnlyRoute } from "@/components/PublicOnlyRoute";
import { RoleRoute } from "@/components/RoleRoute";
import {
  AdminPage,
  AdsPage,
  CeoPage,
  EndOfDayPage,
  FirstSignInPage,
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
        {/* OTP creates a session before password setup finishes; keep the form mounted. */}
        <Route path="/first-sign-in" element={<FirstSignInPage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        {/* Same-origin cockpit navigation reuses the native Supabase session. */}
        <Route path="/go/:cockpit" element={<GoPage />} />
        {/* The old addresses land where their part lives now, so a bookmark
            or a link in Slack still works. Outside the layout: a redirect
            inside its page animation left an empty page (2026-10-06). */}
        <Route path="/tasks" element={<Moved to="/dashboard#tasks" />} />
        <Route
          path="/touchpoints"
          element={<Moved to="/dashboard#touchpoints" />}
        />
        {/* The starter template had made-up numbers; the old client success
            page here was replaced by the client success cockpit. */}
        <Route path="/template" element={<Moved to="/dashboard" />} />
        <Route path="/csm" element={<Navigate to="/go/csm" replace />} />
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
  return <AuthenticatedRoutes />;
}
