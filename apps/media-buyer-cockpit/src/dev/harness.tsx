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
import { LoginPage } from "@/pages/LoginPage";
import { PlaybookPage } from "@/pages/PlaybookPage";
import { PerformancePage } from "@/pages/performance/PerformancePage";
import { SettingsPage } from "@/pages/SettingsPage";
import { MeetingPage } from "@/pages/team/MeetingPage";
import { TeamPage } from "@/pages/team/TeamPage";
import "@/index.css";
import { getCockpitSupabaseClient } from "@/auth/SupabaseAuthProvider";
import { installBoardHarness } from "./boardHarness";
import { installCallCentreHarness } from "./callCentreHarness";
import { CallsHarnessPage } from "./callsHarnessPage";
import { installCeoHarness } from "./ceoHarness";
import { setFixtures } from "./convexStub";
import { installDataViewHarness } from "./dataViewHarness";
import { installHoursHarness } from "./hoursHarness";
import { portalFixtures } from "./portalFixtures";
import { webinarTargetsFixtures } from "./webinarTargetsFixture";

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
                <Route path="/performance" element={<PerformancePage />} />
                <Route path="/team/:id" element={<MeetingPage />} />
                <Route path="/dashboard" element={<TodayPage />} />
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
