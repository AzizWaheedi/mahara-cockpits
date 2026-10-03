import { useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Navigate, Route, Routes } from "react-router";
import { Toaster } from "sonner";
import { AppLayout } from "../../src/components/AppLayout";
import { ThemeProvider } from "../../src/contexts/ThemeContext";
import { BacklogPage } from "../../src/pages/BacklogPage";
import { BillingPage } from "../../src/pages/BillingPage";
import { ChurnPage } from "../../src/pages/ChurnPage";
import { ClientPerformancePage } from "../../src/pages/ClientPerformancePage";
import { CsmPage } from "../../src/pages/CsmPage";
import { MeetingsPage } from "../../src/pages/MeetingsPage";
import { ProjectionsPage } from "../../src/pages/ProjectionsPage";
import { SettingsPage } from "../../src/pages/SettingsPage";
import { usePreviewState } from "./convex";
import "../../src/index.css";

function Preview() {
  const state = usePreviewState();
  const banner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      document.documentElement.style.setProperty(
        "--preview-banner",
        `${entry.target.getBoundingClientRect().height}px`,
      ),
    );
    if (banner.current) observer.observe(banner.current);
    return () => observer.disconnect();
  }, []);
  return (
    <ThemeProvider defaultTheme="dark">
      <HashRouter>
        <div
          ref={banner}
          className="sticky top-0 z-40 min-h-12 flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-card px-4 py-2 text-xs"
        >
          <strong>Design preview · Fictional data</strong>
          <span>No messages, invitations or provider changes.</span>
          <label>
            Scenario{" "}
            <select
              aria-label="Preview scenario"
              value={state.mode}
              onChange={e => state.change(e.target.value)}
              className="ml-2 rounded-lg border bg-background p-1.5"
            >
              <option value="normal">Normal</option>
              <option value="no-slots">No available times</option>
              <option value="action-error">Failed connection</option>
              <option value="page-error">Page error</option>
              <option value="stale">Stale data</option>
              <option value="empty">Empty</option>
              <option value="loading">Loading</option>
            </select>
          </label>
          <span aria-live="polite">{state.receipts} simulated saves</span>
        </div>
        <style>{`header.sticky { top: var(--preview-banner, 3rem); } @media (min-width: 1024px) { [data-sidebar=sidebar] { margin-top: var(--preview-banner, 3rem); height: calc(100svh - var(--preview-banner, 3rem)); } }`}</style>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<CsmPage section="start" />} />
            <Route path="/clients" element={<CsmPage section="clients" />} />
            <Route path="/performance" element={<ClientPerformancePage />} />
            <Route path="/tasks" element={<CsmPage section="tasks" />} />
            <Route path="/hotlist" element={<CsmPage section="hot" />} />
            <Route path="/money" element={<CsmPage section="money" />} />
            <Route path="/links" element={<CsmPage section="links" />} />
            <Route path="/eod" element={<CsmPage section="eod" />} />
            <Route path="/meetings" element={<MeetingsPage />} />
            <Route path="/backlog" element={<BacklogPage />} />
            <Route path="/billing" element={<BillingPage />} />
            <Route path="/projections" element={<ProjectionsPage />} />
            <Route path="/churn" element={<ChurnPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/dashboard" />} />
          </Route>
        </Routes>
        <Toaster richColors />
      </HashRouter>
    </ThemeProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
