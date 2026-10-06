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
  ClientDatabasePage,
  ClientPage,
  CreativeEodPage,
  DashboardPage,
  FunnelsPage,
  IdeationPage,
  KeyLinksPage,
  LandingPage,
  LoginPage,
  MeetingsPage,
  PlaybookPage,
  ReviewPage,
  ScriptDatabasePage,
  ScriptsPage,
  SettingsPage,
  SignupPage,
  SocialCalendarPage,
  SwipePage,
} from "@/pages";
import { ViktorOAuthCallbackPage } from "@/pages/ViktorOAuthCallbackPage";

/**
 * An old address, sent on to where its part lives now (the simplification
 * audit, approved by Aziz on 2026-10-06). The query string comes along, so a
 * link with ?client= still lands on the client; `to` may carry a #part.
 */
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
        {/* The old addresses land where their part lives now, so a bookmark
            or a link in Slack still works. Outside the layout: a redirect
            inside its page animation left an empty page (2026-10-06). */}
        <Route path="/work" element={<Moved to="/dashboard#scripting" />} />
        <Route path="/calendar" element={<Moved to="/dashboard#scripting" />} />
        <Route
          path="/touchpoints"
          element={<Moved to="/dashboard#touchpoints" />}
        />
        {/* /messages went first: the templates live on the touchpoint rows,
            next to the reason the message is owed. */}
        <Route
          path="/messages"
          element={<Moved to="/dashboard#touchpoints" />}
        />
        <Route path="/profiles" element={<Moved to="/clients?view=worst" />} />
        <Route element={<AppLayout />}>
          {/* biome-ignore lint/a11y/useValidAriaRole: RoleRoute's role prop is a seat name, not an ARIA role */}
          <Route element={<RoleRoute role="creative" />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/clients" element={<ClientDatabasePage />} />
            <Route path="/clients/:name" element={<ClientPage />} />
            <Route path="/links" element={<KeyLinksPage />} />
            <Route
              path="/what-works"
              element={
                <Library>
                  <PlaybookPage />
                </Library>
              }
            />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/funnels" element={<FunnelsPage />} />
            <Route
              path="/scripting"
              element={
                <Library>
                  <ScriptDatabasePage />
                </Library>
              }
            />
            <Route
              path="/scripts"
              element={
                <Library>
                  <ScriptsPage />
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
            <Route path="/social" element={<SocialCalendarPage />} />
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
