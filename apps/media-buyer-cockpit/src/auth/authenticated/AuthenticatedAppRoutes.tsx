import { Navigate, Route, Routes } from "react-router";
import { OAUTH_CALLBACK_PATH } from "@/auth/oauthReturn";
import { AppLayout } from "@/components/AppLayout";
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
  CsmPage,
  DashboardPage,
  EndOfDayPage,
  GoPage,
  IdeationPage,
  LoginPage,
  PlaybookPage,
  PortalHome,
  SettingsPage,
  SignupPage,
  StartOfDayPage,
  SwipePage,
  TaskListPage,
  TouchpointsPage,
} from "@/pages";
import { ViktorOAuthCallbackPage } from "@/pages/ViktorOAuthCallbackPage";

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
          {/* Media buyer's cockpit — her link only. */}
          {/* biome-ignore lint/a11y/useValidAriaRole: RoleRoute's role prop is a seat name, not an ARIA role */}
          <Route element={<RoleRoute role="media_buyer" />}>
            <Route path="/dashboard" element={<StartOfDayPage />} />
            <Route path="/ads" element={<AdsPage />} />
            <Route path="/tasks" element={<TaskListPage />} />
            <Route path="/touchpoints" element={<TouchpointsPage />} />
            <Route path="/eod" element={<EndOfDayPage />} />
            <Route path="/playbook" element={<PlaybookPage />} />
            <Route path="/ideation" element={<IdeationPage />} />
            <Route path="/swipe" element={<SwipePage />} />
          </Route>
          {/* Client success cockpit — separate link, separate view. */}
          {/* biome-ignore lint/a11y/useValidAriaRole: RoleRoute's role prop is a seat name, not an ARIA role */}
          <Route element={<RoleRoute role="csm" />}>
            <Route path="/csm" element={<CsmPage />} />
          </Route>
          <Route path="/template" element={<DashboardPage />} />
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
