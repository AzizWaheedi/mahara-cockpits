/**
 * The layout harness: the real shell, rail and CEO page, fed by fixtures
 * instead of Convex, so the screens can be checked at phone, tablet and
 * laptop widths without signing in. Started with `bun run harness`; open
 * /harness.html?tab=ads (or any CEO tab key), or /harness.html?path=/team
 * for any other page the routes below carry.
 *
 * Team & payroll (hours, leave and pay) and Costs read made-up fixtures
 * through hoursHarness.ts; `?hours=none|never|keys|blocked|firewall|stale`
 * switches the connection scenario, and `#team/hours/2026-09/month` opens a
 * month. `?hours=e2e` renders real backend output with the real rule: run
 * `bun scripts/hours-harness-data.ts` first (made-up people, PGlite, the fake
 * Hubstaff and Timetastic).
 *
 * Fixtures live in tmp/harness/ (ignored by git and Vercel):
 *   today.json    - the result of ceo/queries:today
 *   people.json   - the result of ceo/people:list
 *   fixtures.json - any other function's result, keyed by its Convex name
 * The media buyer's own screens (/dashboard, /ads, /eod, /playbook) and /admin and /settings read the stand-in data in
 * portalFixtures.ts. A client's Calls part reads callCentreHarness.ts
 * (`&calls=` picks the answer). The Client Performance board
 * (?path=/performance) reads boardHarness.ts (`&board=` picks the answer).
 * The Ads page (?path=/ads?range=30d) reads adsPageHarness.ts.
 * Billing (?tab=billing) reads billingFixture.ts: the sheet and Pending
 * payments from the 23 Oct read (`&pending=` picks the scenario).
 * Requests (?path=/requests, /requests?view=mine, /requests/settings) read
 * requestsHarness.ts (`&requests=`, `&seat=`, `&writer=` pick the answer);
 * the task card, the bell and the focus view read tasksHarness.ts.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Navigate, Route, Routes } from "react-router";
import { AppLayout } from "@/components/AppLayout";
import { Library } from "@/components/Library";
import { PublicLayout } from "@/components/PublicLayout";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ThemeProvider as LibThemeProvider } from "@/lib/theme";
import { AdminPage } from "@/pages/AdminPage";
import { CeoPage } from "@/pages/CeoPage";
import { AdsPage, EndOfDayPage, TodayPage } from "@/pages/CockpitPage";
import { DataViewPage } from "@/pages/data/DataViewPage";
import { LaunchPage } from "@/pages/LaunchPage";
import { LoginPage } from "@/pages/LoginPage";
import { PlaybookPage } from "@/pages/PlaybookPage";
import { PerformancePage } from "@/pages/performance/PerformancePage";
import { RequestsPage } from "@/pages/requests/RequestsPage";
import { RequestsSettings } from "@/pages/requests/RequestsSettings";
import { SettingsPage } from "@/pages/SettingsPage";
import { MeetingPage } from "@/pages/team/MeetingPage";
import { TeamPage } from "@/pages/team/TeamPage";
import { installLaunchHarness } from "./launchHarness";
import "@/index.css";
import { getCockpitSupabaseClient } from "@/auth/SupabaseAuthProvider";
import { installAdsPageHarness } from "./adsPageHarness";
import { installBillingHarness } from "./billingFixture";
import { installBoardHarness } from "./boardHarness";
import { installCallCentreHarness } from "./callCentreHarness";
import { CallsHarnessPage } from "./callsHarnessPage";
import { installCeoHarness } from "./ceoHarness";
import { setFixtures } from "./convexStub";
import { installDataViewHarness } from "./dataViewHarness";
import { installHoursHarness } from "./hoursHarness";
import { portalFixtures } from "./portalFixtures";
import { installRequestsHarness } from "./requestsHarness";
import { installResultsHarness } from "./resultsHarness";
import { webinarTargetsFixtures } from "./webinarTargetsFixture";

/**
 * The task card, the bell and the focus view's fixtures (tasksHarness.ts,
 * the cockpit-screens build). Read through a glob so this harness still
 * starts while that file is being written.
 */
const tasksHarness = import.meta.glob<{
  installTasksHarness?: (
    client: ReturnType<typeof getCockpitSupabaseClient>,
  ) => void;
}>("./tasksHarness.ts", { eager: true });

async function load(path: string): Promise<unknown> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function main() {
  // Team & payroll and Costs read through Supabase since the cutover: the
  // client's rpc answers from made-up fixtures (?hours= picks the scenario).
  installHoursHarness(getCockpitSupabaseClient());
  // The CEO sections, actions and the proposals card (ceoHarness.ts).
  installCeoHarness(getCockpitSupabaseClient());
  // The data view (?path=/data&reads=1): made-up rows after a delay.
  installDataViewHarness(getCockpitSupabaseClient());
  // A client's Calls part (?path=/calls?account=...&calls=on_track).
  installCallCentreHarness(getCockpitSupabaseClient());
  // The Client Performance board (?path=/performance&board=...).
  installBoardHarness(getCockpitSupabaseClient());
  // The results view beside it (?path=/performance?view=gap).
  installResultsHarness(getCockpitSupabaseClient());
  // The Ads page (?path=/ads?range=30d): made-up campaigns, their 7-day
  // snapshot and a different read for every range (adsPageHarness.ts).
  installAdsPageHarness(getCockpitSupabaseClient());
  // Billing (?tab=billing&pending=...): the sheet and Pending payments from
  // the 23 Oct read, writes kept in memory (billingFixture.ts).
  installBillingHarness(getCockpitSupabaseClient());
  installLaunchHarness(getCockpitSupabaseClient());
  // Requests (?path=/requests&requests=...&seat=...&writer=...): every
  // function of the requests contract, answered from a made-up store.
  installRequestsHarness(getCockpitSupabaseClient());
  for (const mod of Object.values(tasksHarness))
    mod.installTasksHarness?.(getCockpitSupabaseClient());
  const [today, people, more] = await Promise.all([
    // Optional since the cutover: the CEO tabs that still read them show
    // their empty states without.
    load("/tmp/harness/today.json").catch(() => ({})),
    load("/tmp/harness/people.json").catch(() => ({ people: [] })),
    // Any other function, keyed by its Convex name; optional.
    load("/tmp/harness/fixtures.json").catch(() => ({})),
  ]);
  setFixtures({
    ...webinarTargetsFixtures(),
    ...(more as Record<string, unknown>),
    ...portalFixtures(),
    "roles:me": {
      isCeo: true,
      isAdmin: true,
      roles: ["media_buyer"],
      cockpits: ["csm", "creative", "editor", "sales"],
      name: "Aziz",
    },
    "auth:currentUser": { name: "Aziz Waheedi", email: "aziz@maharamedia.com" },
    "ceo/queries:today": today,
    "ceo/people:list": people,
    "ceo/b2bLaunch:list": [],
    "hermes:thread": undefined,
  });
  const search = window.location.search;
  // ?path=/team opens that page; anything else is a CEO tab.
  const path = new URLSearchParams(search).get("path");
  const start = path?.startsWith("/")
    ? path
    : `/ceo${search}${window.location.hash}`;
  createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
      <LibThemeProvider>
        <ThemeProvider defaultTheme="light" switchable>
          <Toaster />
          <MemoryRouter initialEntries={[start]}>
            <Routes>
              <Route element={<PublicLayout />}>
                <Route path="/login" element={<LoginPage />} />
              </Route>
              <Route element={<AppLayout />}>
                <Route path="/ceo" element={<CeoPage />} />
                <Route path="/team" element={<TeamPage />} />
                <Route path="/requests" element={<RequestsPage />} />
                <Route
                  path="/requests/settings"
                  element={<RequestsSettings />}
                />
                <Route path="/performance" element={<PerformancePage />} />
                <Route path="/team/:id" element={<MeetingPage />} />
                <Route path="/dashboard" element={<TodayPage />} />
                <Route path="/launch" element={<LaunchPage />} />
                <Route path="/clients" element={<LaunchPage />} />
                <Route path="/ads" element={<AdsPage />} />
                <Route path="/calls" element={<CallsHarnessPage />} />
                <Route path="/eod" element={<EndOfDayPage />} />
                <Route
                  path="/playbook"
                  element={
                    <Library>
                      <PlaybookPage />
                    </Library>
                  }
                />
                <Route path="/admin" element={<AdminPage />} />
                <Route path="/data" element={<DataViewPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/ceo" replace />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      </LibThemeProvider>
    </StrictMode>,
  );
}

void main();
