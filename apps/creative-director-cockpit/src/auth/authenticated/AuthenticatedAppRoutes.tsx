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
  CalendarPage,
  ClientDatabasePage,
  ClientPage,
  ClientsPage,
  CreativeEodPage,
  DashboardPage,
  FunnelsPage,
  KeyLinksPage,
  LandingPage,
  LoginPage,
  MeetingsPage,
  PlaybookPage,
  ScriptDatabasePage,
  SettingsPage,
  SignupPage,
  TouchpointsPage,
  WorkPage,
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
          <Route element={<RoleRoute role="creative" />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/work" element={<WorkPage />} />
            <Route path="/touchpoints" element={<TouchpointsPage />} />
            <Route path="/clients" element={<ClientDatabasePage />} />
            <Route path="/clients/:name" element={<ClientPage />} />
            {/* /messages is gone: the templates live on the client touchpoints
              rows now, next to the reason the message is owed. */}
            <Route path="/messages" element={<TouchpointsPage />} />
            <Route path="/links" element={<KeyLinksPage />} />
            <Route path="/what-works" element={<PlaybookPage />} />
            <Route path="/funnels" element={<FunnelsPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/scripting" element={<ScriptDatabasePage />} />
            <Route path="/profiles" element={<ClientsPage />} />
            <Route path="/eod" element={<CreativeEodPage />} />
            <Route path="/meetings" element={<MeetingsPage />} />
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
