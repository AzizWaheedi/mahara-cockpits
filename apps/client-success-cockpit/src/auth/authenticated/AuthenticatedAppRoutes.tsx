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
  BacklogPage,
  ClientPerformancePage,
  ClientsPage,
  EndOfDayPage,
  HotListPage,
  KeyLinksPage,
  LandingPage,
  LoginPage,
  MeetingsPage,
  MyMoneyPage,
  SettingsPage,
  SignupPage,
  StartOfDayPage,
  TaskListPage,
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
          {/* biome-ignore lint/a11y/useValidAriaRole: RoleRoute's role prop is a seat name, not an ARIA role */}
          <Route element={<RoleRoute role="csm" />}>
            <Route path="/dashboard" element={<StartOfDayPage />} />
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/performance" element={<ClientPerformancePage />} />
            <Route path="/tasks" element={<TaskListPage />} />
            <Route path="/hotlist" element={<HotListPage />} />
            <Route path="/links" element={<KeyLinksPage />} />
            <Route path="/money" element={<MyMoneyPage />} />
            <Route path="/eod" element={<EndOfDayPage />} />
            {/* Every page in this cockpit is the CSM's: a session minted for
                another seat gets "not yours", not a crashed screen. */}
            <Route path="/meetings" element={<MeetingsPage />} />
            <Route path="/backlog" element={<BacklogPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
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
      {/* One sign-in for every cockpit: swaps the portal's pass for a session here. */}
      <PortalAutoSignIn />
      <AuthenticatedRoutes />
    </ViktorProductAuthProvider>
  );
}
