import { Navigate, Route, Routes } from "react-router";
import { AppLayout } from "@/components/AppLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PublicLayout } from "@/components/PublicLayout";
import { PublicOnlyRoute } from "@/components/PublicOnlyRoute";
import { RoleRoute } from "@/components/RoleRoute";
import {
  BacklogPage,
  BillingPage,
  ChurnPage,
  ClientPerformancePage,
  ClientsPage,
  EndOfDayPage,
  FirstSignInPage,
  HotListPage,
  KeyLinksPage,
  LandingPage,
  LoginPage,
  MeetingsPage,
  MyMoneyPage,
  ProjectionsPage,
  SettingsPage,
  SignupPage,
  StartOfDayPage,
  TaskListPage,
} from "@/pages";

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
            <Route path="/dashboard" element={<StartOfDayPage />} />
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/performance" element={<ClientPerformancePage />} />
            <Route path="/tasks" element={<TaskListPage />} />
            <Route path="/hotlist" element={<HotListPage />} />
            <Route path="/links" element={<KeyLinksPage />} />
            <Route path="/money" element={<MyMoneyPage />} />
            <Route path="/projections" element={<ProjectionsPage />} />
            <Route path="/churn" element={<ChurnPage />} />
            <Route path="/eod" element={<EndOfDayPage />} />
            {/* Every page in this cockpit is the CSM's: a session minted for
                another seat gets "not yours", not a crashed screen. */}
            <Route path="/meetings" element={<MeetingsPage />} />
            <Route path="/backlog" element={<BacklogPage />} />
            <Route path="/billing" element={<BillingPage />} />
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
