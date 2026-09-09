import { Navigate, Route, Routes } from "react-router";
import { OAUTH_CALLBACK_PATH } from "@/auth/oauthReturn";
import { AppLayout } from "@/components/AppLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PublicLayout } from "@/components/PublicLayout";
import { PublicOnlyRoute } from "@/components/PublicOnlyRoute";
import { RoleRoute } from "@/components/RoleRoute";
import { SpaceSessionAutoSignIn } from "@/components/SpaceSessionAutoSignIn";
import { ViktorAutoSignIn } from "@/components/ViktorAutoSignIn";
import { ViktorProductAuthProvider } from "@/lib/viktor-spaces-access/ViktorProductAuthProvider";
import {
  AdsPage,
  CsmPage,
  DashboardPage,
  EndOfDayPage,
  LandingPage,
  LoginPage,
  PlaybookPage,
  SettingsPage,
  SignupPage,
  StartOfDayPage,
  TaskListPage,
  TouchpointsPage,
} from "@/pages";
import { ViktorOAuthCallbackPage } from "@/pages/ViktorOAuthCallbackPage";

export function AuthenticatedRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<LandingPage />} />
        <Route element={<PublicOnlyRoute />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
        </Route>
      </Route>

      {/* Return leg of "Sign in with Viktor" — outside the auth guards
          because it owns the loading/outcome handling itself. */}
      <Route path={OAUTH_CALLBACK_PATH} element={<ViktorOAuthCallbackPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          {/* Media buyer's cockpit — her link only. */}
          <Route element={<RoleRoute role="media_buyer" />}>
            <Route path="/dashboard" element={<StartOfDayPage />} />
            <Route path="/ads" element={<AdsPage />} />
            <Route path="/tasks" element={<TaskListPage />} />
            <Route path="/touchpoints" element={<TouchpointsPage />} />
            <Route path="/eod" element={<EndOfDayPage />} />
            <Route path="/playbook" element={<PlaybookPage />} />
          </Route>
          {/* Client success cockpit — separate link, separate view. */}
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
      <AuthenticatedRoutes />
    </ViktorProductAuthProvider>
  );
}
