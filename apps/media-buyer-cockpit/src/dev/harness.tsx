/**
 * The layout harness: the real shell, rail and CEO page, fed by fixtures
 * instead of Convex, so the screens can be checked at phone, tablet and
 * laptop widths without signing in. Started with `bun run harness`; open
 * /harness.html?tab=ads (or any CEO tab key), or /harness.html?path=/team
 * for any other page the routes below carry.
 *
 * Fixtures live in tmp/harness/ (ignored by git and Vercel):
 *   today.json    - the result of ceo/queries:today
 *   people.json   - the result of ceo/people:list
 *   fixtures.json - any other function's result, keyed by its Convex name
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Navigate, Route, Routes } from "react-router";
import { AppLayout } from "@/components/AppLayout";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ThemeProvider as LibThemeProvider } from "@/lib/theme";
import { CeoPage } from "@/pages/CeoPage";
import { MeetingPage } from "@/pages/team/MeetingPage";
import { TeamPage } from "@/pages/team/TeamPage";
import "@/index.css";
import { setFixtures } from "./convexStub";

async function load(path: string): Promise<unknown> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function main() {
  const [today, people, more] = await Promise.all([
    load("/tmp/harness/today.json"),
    load("/tmp/harness/people.json"),
    // Any other function, keyed by its Convex name; optional.
    load("/tmp/harness/fixtures.json").catch(() => ({})),
  ]);
  setFixtures({
    ...(more as Record<string, unknown>),
    "roles:me": {
      isCeo: true,
      isAdmin: true,
      roles: ["media_buyer"],
      cockpits: ["csm", "creative", "editor"],
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
  const start = path?.startsWith("/") ? path : `/ceo${search}`;
  createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
      <LibThemeProvider>
        <ThemeProvider defaultTheme="light" switchable>
          <Toaster />
          <MemoryRouter initialEntries={[start]}>
            <Routes>
              <Route element={<AppLayout />}>
                <Route path="/ceo" element={<CeoPage />} />
                <Route path="/team" element={<TeamPage />} />
                <Route path="/team/:id" element={<MeetingPage />} />
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
