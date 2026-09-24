import { Navigate, Route, Routes } from "react-router";
import { OAUTH_CALLBACK_PATH } from "@/auth/oauthReturn";
import { AppLayout } from "@/components/AppLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PublicLayout } from "@/components/PublicLayout";
import { PublicOnlyRoute } from "@/components/PublicOnlyRoute";
import { RoleRoute } from "@/components/RoleRoute";
import {
  CalendarPage,
  ClientDatabasePage,
  ClientPage,
  ClientsPage,
  CreativeEodPage,
  DashboardPage,
  FunnelsPage,
  IdeationPage,
  KeyLinksPage,
  LandingPage,
  LoginPage,
  FirstSignInPage,
  MeetingsPage,
  PlaybookPage,
  ReviewPage,
  ScriptDatabasePage,
  ScriptsPage,
  SettingsPage,
  SignupPage,
  SocialCalendarPage,
  SwipePage,
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
          <Route path="/first-sign-in" element={<FirstSignInPage />} />
        </Route>
      </Route>

      {/* Return leg of "Sign in with Viktor" — outside the auth guards
          because it owns the loading/outcome handling itself. */}
      <Route path={OAUTH_CALLBACK_PATH} element={<ViktorOAuthCallbackPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          {/* biome-ignore lint/a11y/useValidAriaRole: RoleRoute's role prop is a seat name, not an ARIA role */}
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
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/funnels" element={<FunnelsPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/scripting" element={<ScriptDatabasePage />} />
            <Route path="/scripts" element={<ScriptsPage />} />
            <Route path="/ideation" element={<IdeationPage />} />
            <Route path="/swipe" element={<SwipePage />} />
            <Route path="/social" element={<SocialCalendarPage />} />
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
  return <AuthenticatedRoutes />;
}
