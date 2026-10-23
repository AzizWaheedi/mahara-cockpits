/**
 * The creative director's Brand Blueprint pieces from invented fixtures, to
 * see and shoot every state without signing in (docs/brand-blueprint
 * SPEC.md 5.8): `bunx vite`, then open
 * /creative/blueprint-harness.html?view=card&bp=closed
 *
 * view: card | dashboard | settings
 * bp (card): open | part1 | unconfirmed | sent | changed | closed | late |
 *            conflict | needs | locked
 * rehearse=1, admin=1 (settings: the close switch editable), theme=light.
 *
 * Every save, press and run is held in this page's memory; nothing reaches
 * Supabase, ClickUp, Slack or Make.
 */

import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { Toaster } from "sonner";
import { BlueprintCard } from "@/components/BlueprintCard";
import { BlueprintSettings } from "@/components/BlueprintSettings";
import {
  OffersToLock,
  OnboardingSteps,
  waitedFor,
} from "@/components/BlueprintSignoff";
import { buildSnapshot, snapshotContext } from "@/lib/creativeSourceModels";
import {
  dashboardTables,
  fakeBlueprintIO,
  fakeSettingsIO,
  MEMBERS,
  NAME,
  OFFER_SHEET,
  rowFor,
  settingsFixture,
  TASK,
} from "./blueprintFixtures";
import "@/index.css";

const params = new URLSearchParams(window.location.search);
const view = params.get("view") ?? "card";
const bp = params.get("bp") ?? "closed";
const rehearse = params.get("rehearse") === "1";
const admin = params.get("admin") === "1";
if (params.get("theme") === "light")
  document.documentElement.classList.remove("dark");

/** The top of the client's page, drawn plainly so the card sits in place. */
function PageTop() {
  return (
    <header className="space-y-4">
      <div>
        <p className="text-xs text-muted-foreground">All clients</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-[28px] font-semibold leading-9 tracking-tight">
            {NAME}
          </h1>
          <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium">
            <span
              aria-hidden
              className="size-1.5 rounded-full"
              style={{ background: "var(--warning)" }}
            />
            Launch Booked
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Interior design · launch in 6d · 0 ads live · 0 videos in flight
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {["Brand DNA", "Offer sheet", "Market research", "Drive folder"].map(
          l => (
            <span
              key={l}
              className="inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium"
            >
              {l}
            </span>
          ),
        )}
      </div>
    </header>
  );
}

function CardView() {
  const row = useMemo(() => rowFor(bp), []);
  const io = useMemo(
    () =>
      fakeBlueprintIO(row, {
        conflictOnce: bp === "conflict",
      }),
    [row],
  );
  return (
    <div className="space-y-4">
      <PageTop />
      <BlueprintCard
        taskId={TASK}
        clientName={NAME}
        status="Launch Booked"
        offerSheet={OFFER_SHEET}
        io={io}
        rehearse={rehearse}
      />
    </div>
  );
}

function DashboardView() {
  const [snap, setSnap] = useState<any>(null);
  useEffect(() => {
    void buildSnapshot(
      snapshotContext(dashboardTables() as Record<string, never[]>),
      null,
      { blueprintsTracked: params.get("tracked") !== "0" },
    ).then(setSnap);
  }, []);
  if (!snap) return <p className="text-sm text-muted-foreground">Building…</p>;
  return (
    <div className="space-y-6">
      <OffersToLock rows={snap.offersWaiting} />
      {/* "Every client", one row opened, drawn as the dashboard draws it. */}
      <section className="overflow-hidden rounded-2xl border bg-card p-4 sm:p-6">
        <h2 className="text-[15px] font-semibold">Every client</h2>
        <ul className="-mx-4 -mb-4 mt-4 divide-y border-t sm:-mx-6 sm:-mb-6">
          {snap.clients.map((r: any) => (
            <li key={r.client}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm sm:px-6">
                <span className="min-w-0 flex-1 truncate font-medium">
                  {r.client}
                </span>
                <span className="text-xs text-muted-foreground">
                  {r.offerWaiting ? (
                    <span className={r.offerWaiting.late ? "txt-warn" : ""}>
                      Offer waiting {waitedFor(r.offerWaiting.hours)}
                    </span>
                  ) : null}
                </span>
              </div>
              {r.client === NAME ? (
                <div className="grid gap-4 border-t bg-muted/30 px-4 py-4 text-sm sm:grid-cols-3 sm:px-6">
                  <div className="space-y-1">
                    <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                      Creative onboarding
                    </div>
                    <OnboardingSteps r={r} />
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function SettingsView() {
  const io = useMemo(() => fakeSettingsIO(settingsFixture(admin)), []);
  return (
    <div className="max-w-2xl">
      <BlueprintSettings
        io={io}
        initial={{ settings: settingsFixture(admin), members: MEMBERS }}
      />
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <MemoryRouter>
      <div className="min-h-dvh bg-background p-6 text-foreground sm:p-10">
        <div className="mx-auto w-full max-w-6xl">
          {view === "dashboard" ? (
            <DashboardView />
          ) : view === "settings" ? (
            <SettingsView />
          ) : (
            <CardView />
          )}
        </div>
      </div>
      <Toaster />
    </MemoryRouter>
  </StrictMode>,
);
