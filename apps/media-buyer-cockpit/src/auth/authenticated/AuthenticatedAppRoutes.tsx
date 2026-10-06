import { Navigate, Route, Routes } from "react-router";
import { AppLayout } from "@/components/AppLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PublicLayout } from "@/components/PublicLayout";
import { PublicOnlyRoute } from "@/components/PublicOnlyRoute";
import { RoleRoute } from "@/components/RoleRoute";
import {
  AdminPage,
  AdsPage,
  CeoPage,
  CsmPage,
  DashboardPage,
  EndOfDayPage,
  FirstSignInPage,
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
import { MeetingPage } from "@/pages/team/MeetingPage";
import { TeamPage } from "@/pages/team/TeamPage";

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
          {/* Team meetings: everybody with a seat in the portal. */}
          <Route path="/team" element={<TeamPage />} />
          <Route path="/team/:id" element={<MeetingPage />} />
          <Route path="/template" element={<DashboardPage />} />
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
