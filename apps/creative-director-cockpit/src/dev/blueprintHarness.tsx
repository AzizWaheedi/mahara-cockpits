/**
 * The creative director's Brand Blueprint pieces from invented fixtures, to
 * see and shoot every state without signing in (docs/brand-blueprint
 * SPEC.md 5.8): `bunx vite`, then open
 * /creative/blueprint-harness.html?view=card&bp=closed
 *
 * view: card | dashboard | settings | call | notes
 * bp (card): open | part1 | unconfirmed | sent | changed | closed | late |
 *            conflict | needs | locked, and (docs/forms/STAGE1-CONTRACT.md
 *            6.2) nudge (a held call, no close) | posted | notposted (the
 *            close's Slack stops) | refused | refused3 | timedout (the
 *            server drain's refusals)
 * rehearse=1, admin=1, theme=light.
 *
 * view=call is the Blueprint call inside this cockpit (EMBED.md 6): the call
 * page in the cockpit's shell, its frames on the client success deck
 * harness, same origin through the dev proxy. Run both dev servers:
 *   apps/client-success-cockpit:   bunx vite --port 5191 --strictPort
 *   apps/creative-director-cockpit:
 *     CS_DEV=http://localhost:5191 bunx vite --port 5192 --strictPort
 * then open
 *   http://localhost:5192/creative/blueprint-harness.html?view=call&fixture=full&bp=part1
 * fixture: the deck harness's (full | sparse | two | declined | nopack |
 * arabic | nokickoff); bp: open | part1 | sent | closed | locked reach the
 * deck too (any other card state draws the rail only, over part1's deck);
 * #part1 to #part3 open the prep at that part; readonly=1 is a seat that
 * may not write; state=loading | slow | failed | offline | signedout |
 * wronghost | badid draws that state with no frame, and state=noseat the
 * cockpit's own refusal for a seat without the creative director's role.
 * view=notes is the notes popup the deck's N opens (state=checking: its
 * line while the sign-in is checked; state=noseat: the refusal in it).
 * practice=1 with view=call or notes is the practice client's call
 * (docs/call-guide/DESIGN.md), on the deck harness's practice=1 frames.
 *
 * Every save, press and run is held in this page's memory; nothing reaches
 * Supabase, ClickUp, Slack or Make.
 */

import {
  type ReactNode,
  StrictMode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { Toaster } from "sonner";
import { AppSidebar } from "@/components/AppSidebar";
import { BlueprintCard } from "@/components/BlueprintCard";
import { BlueprintSettings } from "@/components/BlueprintSettings";
import {
  OffersToLock,
  OnboardingSteps,
  waitedFor,
} from "@/components/BlueprintSignoff";
import { NotesOpening } from "@/components/ProtectedRoute";
import { NotYourCockpit } from "@/components/RoleRoute";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { isBlueprintCall } from "@/lib/blueprint";
import { buildSnapshot, snapshotContext } from "@/lib/creativeSourceModels";
import { type PartAnchor, PRACTICE_NAME, PRACTICE_TASK } from "@/lib/deckHost";
import {
  BlueprintCall,
  type Call,
  type CallFrames,
  startCall,
} from "@/pages/BlueprintCallPage";
import { BlueprintNotes } from "@/pages/BlueprintNotesPage";
import {
  callFor,
  dashboardTables,
  fakeBlueprintIO,
  fakeSettingsIO,
  MEMBERS,
  NAME,
  noticesFor,
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
const light = params.get("theme") === "light";
/** practice=1 (view=call or notes): the practice client's call, docs/call-guide/DESIGN.md. */
const practice = params.get("practice") === "1";
if (light) document.documentElement.classList.remove("dark");

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
        call: callFor(bp),
        notices: noticesFor(bp),
      }),
    [row],
  );
  return (
    <div className="space-y-4">
      <PageTop />
      <BlueprintCard
        taskId={TASK}
        clientName={NAME}
        status={bp === "nudge" ? "Brand Blueprint Booked♠️" : "Launch Booked"}
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

// ------------------------------------------------- the call (EMBED.md 6)

/** The card states the deck harness has too; the others draw part1's deck. */
const DECK_BP = new Set(["open", "part1", "sent", "closed", "locked"]);
const fixture = params.get("fixture") ?? "full";
const cardBp = params.get("bp") ?? "part1";
const deckBp = DECK_BP.has(cardBp) ? cardBp : "part1";
/** The deck harness's own ID, so the call's channel is its frames' channel. */
const CALL_TASK = practice ? PRACTICE_TASK : `fixture-${fixture}`;
const DECK_HARNESS = "/client-success/present-harness.html";

function deckHarness(v: "prep" | "present" | "notes", notes?: string) {
  const q = new URLSearchParams({
    deck: "blueprint",
    view: v,
    fixture,
    bp: deckBp,
  });
  if (practice) q.set("practice", "1");
  if (rehearse) q.set("rehearse", "1");
  if (light) q.set("theme", "light");
  q.set("host", "creative");
  if (notes) q.set("notes", notes);
  return `${DECK_HARNESS}?${q.toString()}`;
}

/** The notes popup the deck's N and the header's button open. */
const notesView = (() => {
  const q = new URLSearchParams({ view: "notes", fixture, bp: cardBp });
  if (practice) q.set("practice", "1");
  if (rehearse) q.set("rehearse", "1");
  if (light) q.set("theme", "light");
  return `/creative/blueprint-harness.html?${q.toString()}`;
})();

const harnessFrames: CallFrames = {
  prep: at => `${deckHarness("prep", notesView)}${at ? `#${at}` : ""}`,
  deck: () => deckHarness("present", notesView),
  notes: notesView,
  allowed: p => p === DECK_HARNESS,
};

/** state=: each of the page's own states at once, with no frame. */
function forcedCall(state: string | null): Call | null {
  const stage: Call["stage"] | null =
    state === "loading"
      ? { kind: "opening" }
      : state === "slow"
        ? { kind: "slow" }
        : state === "failed"
          ? {
              kind: "failed",
              message:
                "The deck could not be drawn. Reload it to go on. Nothing you saved is lost.",
            }
          : state === "offline"
            ? { kind: "offline" }
            : state === "signedout"
              ? { kind: "signedout" }
              : null;
  return stage ? { ...startCall, stage } : null;
}

const partOf = (hash: string): PartAnchor | null => {
  const h = hash.slice(1);
  return h === "part1" || h === "part2" || h === "part3" ? h : null;
};

function CallView() {
  const state = params.get("state");
  const forced = forcedCall(state);
  if (state === "noseat") return <NotYourCockpit home="/client-success/" />;
  if (practice) return <PracticeHarnessCall />;
  return <HarnessCall state={state} forced={forced} />;
}

/** The practice call, as PracticeCallPage draws it, on the deck harness's practice frames. */
function PracticeHarnessCall() {
  const [read] = useState(() => ({
    row: null,
    now: new Date().toISOString(),
    at: Date.now(),
  }));
  return (
    <BlueprintCall
      taskId={PRACTICE_TASK}
      rehearse={false}
      practice
      io={null}
      clientName={PRACTICE_NAME}
      frames={harnessFrames}
      initialRead={read}
      host={window.location.host}
    />
  );
}

function HarnessCall({
  state,
  forced,
}: {
  state: string | null;
  forced: Call | null;
}) {
  const [at, setAt] = useState(() => partOf(window.location.hash));
  useEffect(() => {
    const on = () => setAt(partOf(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const io = useMemo(() => {
    const r = rowFor(cardBp);
    // The record's name stays out, so the header shows the deck's client
    // (the frame's `ready`), as a pasted address does.
    return fakeBlueprintIO(
      r
        ? {
            ...r,
            taskId: CALL_TASK,
            clientName: "",
            can: { write: params.get("readonly") !== "1" },
          }
        : null,
    );
  }, []);
  return (
    <BlueprintCall
      taskId={state === "badid" ? "not a card" : CALL_TASK}
      rehearse={rehearse}
      io={io}
      at={at}
      frames={harnessFrames}
      initial={forced ?? undefined}
      frameless={Boolean(forced)}
      offline={state === "offline"}
      host={
        state === "wronghost"
          ? "mahara-creative-director.vercel.app"
          : window.location.host
      }
      readOnly={params.get("readonly") === "1" ? true : undefined}
    />
  );
}

/**
 * The cockpit's own rail and page padding, as AppLayout draws them, and Ask
 * Hermes where AppLayout shows it (never on the call: isBlueprintCall).
 */
function CockpitShell({
  path,
  children,
}: {
  path: string;
  children: ReactNode;
}) {
  return (
    <ThemeProvider defaultTheme={light ? "light" : "dark"}>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <div className="flex-1 px-4 pt-4 pb-24 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8 lg:pb-12">
            {children}
          </div>
          {isBlueprintCall(path) ? null : (
            <span
              data-hermes=""
              className="glow-teal fixed right-4 bottom-4 z-40 flex h-11 items-center gap-2 rounded-full border bg-card/95 px-4 text-[13px] font-semibold lg:right-6 lg:bottom-6"
            >
              <span className="inline-block size-2 rounded-full bg-[color:var(--mahara-teal)]" />
              Ask Hermes
            </span>
          )}
        </SidebarInset>
      </SidebarProvider>
    </ThemeProvider>
  );
}

const CALL_PATH = `/blueprint/${CALL_TASK}`;

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    {view === "call" ? (
      <MemoryRouter initialEntries={[CALL_PATH]}>
        <CockpitShell path={CALL_PATH}>
          <CallView />
        </CockpitShell>
        <Toaster />
      </MemoryRouter>
    ) : view === "notes" ? (
      params.get("state") === "checking" ? (
        <NotesOpening />
      ) : params.get("state") === "noseat" ? (
        <NotYourCockpit home="/client-success/" />
      ) : (
        <BlueprintNotes
          taskId={CALL_TASK}
          src={deckHarness("notes")}
          allowed={p => p === DECK_HARNESS}
        />
      )
    ) : (
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
    )}
  </StrictMode>,
);
