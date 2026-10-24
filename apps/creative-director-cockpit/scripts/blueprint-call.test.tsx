import { afterAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The Brand Blueprint call inside the creative director cockpit
 * (docs/brand-blueprint/EMBED.md 7): its two routes and their gates, the
 * frames' addresses, the bridge (only our origin, our frame, our envelope),
 * the presenting layer and its two buttons, every state of 4.6, the parts
 * rail in the card's own words, and Clients lit on the call. The page's
 * logic is a reducer and its screens draw from a state, so all of it is
 * read here without a browser; scripts/blueprint-call-shots.mjs drives the
 * real frames. Synthetic fixtures only.
 *
 * Run: bun test scripts/blueprint-call.test.tsx scripts/blueprint.test.tsx
 */

/** The seat, as each test sets it. */
let auth: Record<string, unknown> = {};
const seat = (s: "creative" | "csm" | "admin" | "out") => {
  auth =
    s === "out"
      ? { ready: true, session: null, isAuthenticated: false, access: null }
      : {
          ready: true,
          session: { user: { id: `u-${s}` } },
          isAuthenticated: true,
          isAdmin: s === "admin",
          isCeo: false,
          client: null,
          name: "Omar",
          access: {
            roles: s === "admin" ? [] : [s],
            isAdmin: s === "admin",
            isCeo: false,
            home: s === "csm" ? "/client-success/" : "/creative/",
          },
        };
};
seat("creative");
mock.module("@/auth/SupabaseAuthProvider", () => ({
  useCockpitAuth: () => auth,
}));

// The routes' table, with the layout and the pages as markers: what is
// tested is where each page sits and which gate it is behind.
const { Outlet } = await import("react-router");
mock.module("@/components/AppLayout", () => ({
  AppLayout: () =>
    createElement("div", { "data-layout": "" }, createElement(Outlet)),
}));
mock.module("@/components/PublicLayout", () => ({
  PublicLayout: () => createElement(Outlet),
}));
const pageNames = [
  ...readFileSync(new URL("../src/pages/index.ts", import.meta.url), "utf8")
    .replace(/\s+/g, " ")
    .matchAll(/export \{([^}]+)\}/g),
].flatMap(m =>
  (m[1] ?? "")
    .split(",")
    .map(n => n.trim())
    .filter(Boolean),
);
mock.module("@/pages", () =>
  Object.fromEntries(
    pageNames.map(n => [n, () => createElement("p", null, `page:${n}`)]),
  ),
);

const { MemoryRouter } = await import("react-router");
const { AuthenticatedRoutes } = await import(
  "../src/auth/authenticated/AuthenticatedAppRoutes"
);
const host = await import("../src/lib/deckHost");
const {
  BlueprintCall,
  callReducer,
  PartsRail,
  portalFrames,
  railView,
  readsAgain,
  startCall,
  wrongHost,
} = await import("../src/pages/BlueprintCallPage");
const { BlueprintNotes } = await import("../src/pages/BlueprintNotesPage");
const { stateView } = await import("../src/components/BlueprintCard");
const { isActive } = await import("../src/components/AppSidebar");
const { isBlueprintCall, offerWait, partState, PARTS } = await import(
  "../src/lib/blueprint"
);
const { fakeBlueprintIO, rowFor, TASK } = await import(
  "../src/dev/blueprintFixtures"
);

type Call = import("../src/pages/BlueprintCallPage").Call;
type CallEvent = import("../src/pages/BlueprintCallPage").CallEvent;

afterAll(() => seat("creative"));

const html = (el: ReactNode, path = `/blueprint/${TASK}`) =>
  renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: [path] }, el),
  ).replace(/<!-- -->/g, "");
const text = (h: string) =>
  h
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const ready: Call = { ...startCall, stage: { kind: "ready" } };
const run = (s: Call, ...events: CallEvent[]) => events.reduce(callReducer, s);
const from = (
  f: "prep" | "deck",
  m: import("../src/lib/deckHost").FrameMessage,
): CallEvent => ({ type: "message", from: f, m });

/** The page with a state, frames on the portal's routes. */
const page = (
  state: Call,
  extra: Partial<Parameters<typeof BlueprintCall>[0]> = {},
) =>
  html(
    createElement(BlueprintCall, {
      taskId: TASK,
      rehearse: false,
      io: fakeBlueprintIO(rowFor("part1")),
      clientName: "Cedar and Stone Interiors (example)",
      initial: state,
      initialRead: {
        row: rowFor("part1"),
        now: new Date().toISOString(),
        at: Date.now(),
      },
      ...extra,
    }),
  );

// --------------------------------------------------------------- 1. routes

describe("the routes", () => {
  const at = (path: string) =>
    text(html(createElement(AuthenticatedRoutes), path));
  const layout = (path: string) =>
    html(createElement(AuthenticatedRoutes), path).includes("data-layout");

  test("the call page sits in the cockpit's layout, behind the creative seat", () => {
    seat("creative");
    expect(at(`/blueprint/${TASK}`)).toBe("page:BlueprintCallPage");
    expect(layout(`/blueprint/${TASK}`)).toBe(true);
    seat("admin");
    expect(at(`/blueprint/${TASK}`)).toBe("page:BlueprintCallPage");
    seat("csm");
    expect(at(`/blueprint/${TASK}`)).toContain("This cockpit isn't yours");
  });

  test("the notes popup sits outside the layout, behind the same gate", () => {
    seat("creative");
    expect(at(`/blueprint/${TASK}/notes`)).toBe("page:BlueprintNotesPage");
    expect(layout(`/blueprint/${TASK}/notes`)).toBe(false);
    seat("admin");
    expect(at(`/blueprint/${TASK}/notes`)).toBe("page:BlueprintNotesPage");
    seat("csm");
    expect(at(`/blueprint/${TASK}/notes`)).toContain(
      "This cockpit isn't yours",
    );
  });

  test("while the sign-in is checked, the notes popup shows one centred line, never the cockpit's shell", () => {
    auth = {
      ready: false,
      session: null,
      isAuthenticated: false,
      access: null,
    };
    const popup = html(
      createElement(AuthenticatedRoutes),
      `/blueprint/${TASK}/notes`,
    );
    expect(text(popup)).toBe("Opening the notes…");
    expect(popup).not.toContain("data-sidebar");
    const call = html(createElement(AuthenticatedRoutes), `/blueprint/${TASK}`);
    expect(call).toContain("data-sidebar");
    expect(text(call)).not.toContain("Opening the notes");
    seat("creative");
  });

  test("signed out, neither draws: the sign-in gate sends both away", () => {
    // ProtectedRoute's Navigate to /login moves after the first paint, so a
    // static render shows nothing at all, never the page.
    seat("out");
    expect(at(`/blueprint/${TASK}`)).toBe("");
    expect(at(`/blueprint/${TASK}/notes`)).toBe("");
    seat("creative");
  });
});

// ------------------------------------------------------------ 2. addresses

describe("the frames' addresses", () => {
  test("the portal's deck routes, in host mode, with the notes popup named", () => {
    const f = portalFrames(TASK, false);
    expect(f.prep("part2")).toBe(
      `/client-success/clients/${TASK}/present/blueprint?view=prep&host=creative&notes=%2Fcreative%2Fblueprint%2F${TASK}%2Fnotes#part2`,
    );
    expect(f.deck()).toBe(
      `/client-success/clients/${TASK}/present/blueprint?host=creative&notes=%2Fcreative%2Fblueprint%2F${TASK}%2Fnotes`,
    );
    expect(f.notes).toBe(`/creative/blueprint/${TASK}/notes`);
    // Only the deck's own path may show in the page.
    expect(f.allowed(`/client-success/clients/${TASK}/present/blueprint`)).toBe(
      true,
    );
    for (const p of [
      `/client-success/clients/${TASK}`,
      `/client-success/login`,
      `/client-success/clients/other01/present/blueprint`,
      `/client-success/clients/${TASK}/present/blueprint/notes`,
      `/client-success/clients/${TASK}/present/onboarding`,
    ])
      expect(f.allowed(p)).toBe(false);
  });

  test("a rehearsal rides in every address", () => {
    const f = portalFrames(TASK, true);
    expect(f.prep(null)).toBe(
      `/client-success/clients/${TASK}/present/blueprint?view=prep&rehearse=1&host=creative&notes=%2Fcreative%2Fblueprint%2F${TASK}%2Fnotes%3Frehearse%3D1`,
    );
    expect(f.notes).toBe(`/creative/blueprint/${TASK}/notes?rehearse=1`);
    expect(host.notesWindowName(TASK, true)).toBe(
      `mahara-notes-${TASK}-blueprint-rehearse`,
    );
  });

  test("a bad card ID builds nothing and says so", () => {
    expect(host.blueprintFrame("86exmpl01/../x", { view: "prep" })).toBeNull();
    expect(host.blueprintCall("not a card")).toBeNull();
    const h = page(startCall, { taskId: "not a card" });
    expect(text(h)).toContain("No client card with that ID.");
    // One name for one place: the back link's own words.
    expect(text(h)).toContain("All clients");
    expect(text(h)).not.toContain("Back to clients");
    expect(h).not.toContain("<iframe");
    expect(
      text(
        html(
          createElement(BlueprintNotes, {
            taskId: "not a card",
            src: null,
            allowed: () => false,
          }),
        ),
      ),
    ).toBe("No client card with that ID.");
  });
});

// ---------------------------------------------- 3. the bridge and presenting

describe("the bridge", () => {
  const frame = {};
  const ok = host.frameMessage({ type: "end" });
  test("only our origin, only that frame's window, only our envelope", () => {
    const o = "https://cockpit.maharamedia.com";
    expect(
      host.acceptFrame({ origin: o, source: frame, data: ok }, o, frame),
    ).toEqual({ type: "end" });
    expect(
      host.acceptFrame(
        { origin: "https://evil.example", source: frame, data: ok },
        o,
        frame,
      ),
    ).toBeNull();
    expect(
      host.acceptFrame({ origin: o, source: {}, data: ok }, o, frame),
    ).toBeNull();
    expect(
      host.acceptFrame(
        { origin: o, source: frame, data: { type: "end" } },
        o,
        frame,
      ),
    ).toBeNull();
    expect(
      host.acceptFrame({ origin: o, source: null, data: ok }, o, null),
    ).toBeNull();
  });
});

describe("presenting", () => {
  test("Present lays the deck over the tab; the prep stays, out of reach", () => {
    const s = run(ready, from("prep", { type: "present" }));
    expect(s.layer).toEqual({ kind: "opening", key: 1 });
    const h = page(s);
    expect(h).toMatch(/<iframe[^>]*title="Brand Blueprint deck"/);
    expect(h).toMatch(/data-layer="opening"/);
    expect(h).toMatch(
      /<iframe(?=[^>]*title="Brand Blueprint prep")(?=[^>]*inert="")[^>]*>/,
    );
    expect(h).toMatch(
      /<iframe(?=[^>]*title="Brand Blueprint deck")(?=[^>]*allow="fullscreen")[^>]*>/,
    );
    expect(text(h)).toContain("Opening the deck…");
    // Present before the prep is drawn does nothing.
    expect(run(startCall, from("prep", { type: "present" })).layer).toBeNull();
  });

  test("the deck drawn takes the keyboard; Back offers prep or the deck again", () => {
    const live = run(
      ready,
      from("prep", { type: "present" }),
      from("deck", { type: "ready", view: "present", name: "Noor" }),
    );
    expect(live.layer?.kind).toBe("live");
    expect(live.focus).toBe(1);
    expect(text(page(live))).not.toContain("Back to prep");
    const ended = run(live, from("deck", { type: "end" }));
    expect(ended.layer?.kind).toBe("ended");
    const h = text(page(ended));
    expect(h).toContain("Back to prep");
    expect(h).toContain("Present again");
    // The deck frame stays, on its closed screen, under the two buttons.
    expect(page(ended)).toMatch(/<iframe[^>]*title="Brand Blueprint deck"/);
    // Back to prep takes the deck frame away; Present again makes a fresh one.
    const back = run(ended, { type: "back-to-prep" });
    expect(back.layer).toBeNull();
    expect(page(back)).not.toContain('title="Brand Blueprint deck"');
    expect(page(back)).not.toMatch(/title="Brand Blueprint prep"[^>]*inert/);
    const again = run(ended, { type: "present-again" });
    expect(again.layer).toEqual({ kind: "opening", key: 2 });
    expect(run(back, from("prep", { type: "present" })).layer?.key).toBe(2);
  });

  test("a deck that never opens, or fails, says so with Back to prep", () => {
    const opening = run(ready, from("prep", { type: "present" }));
    for (const e of [
      { type: "trouble", from: "deck", t: "slow" },
      { type: "trouble", from: "deck", t: "offline" },
      { type: "trouble", from: "deck", t: "left" },
      from("deck", { type: "failed", message: "x" }),
      from("deck", { type: "signed-out" }),
    ] as CallEvent[]) {
      const s = run(opening, e);
      expect(s.layer?.kind).toBe("failed");
      const h = page(s);
      expect(text(h)).toContain("The deck did not open.");
      expect(text(h)).toContain("Back to prep");
      expect(h).not.toContain('title="Brand Blueprint deck"');
    }
    // A slow timer after the deck is drawn changes nothing.
    const live = run(
      opening,
      from("deck", { type: "ready", view: "present", name: "" }),
    );
    expect(run(live, { type: "trouble", from: "deck", t: "slow" })).toEqual(
      live,
    );
  });
});

// ------------------------------------------------------------ 4. the states

describe("the states (EMBED.md 4.6)", () => {
  test("loading: the header at once, the stage waiting, the frame unseen", () => {
    const h = page(startCall);
    expect(text(h)).toContain("Cedar and Stone Interiors (example)");
    expect(text(h)).toContain("Brand Blueprint call");
    expect(text(h)).toContain(
      "Present fills this tab with the deck. Share only this tab on the call.",
    );
    expect(text(h)).toContain("Open the notes window");
    expect(text(h)).toContain("Opening the Blueprint…");
    expect(h).toMatch(
      /<iframe(?=[^>]*title="Brand Blueprint prep")(?=[^>]*opacity-0)[^>]*>/,
    );
    // The back link goes to the client's card.
    expect(h).toContain(
      `href="/clients/Cedar%20and%20Stone%20Interiors%20(example)#blueprint"`,
    );
  });

  test("slow: after the wait with no ready, Reload", () => {
    const s = run(startCall, { type: "trouble", from: "prep", t: "slow" });
    expect(s.stage.kind).toBe("slow");
    expect(text(page(s))).toContain(
      "The Blueprint did not open. Reload it. Nothing you saved is lost. Reload",
    );
    // Drawn late after all: it shows.
    expect(
      run(s, from("prep", { type: "ready", view: "prep", name: "" })).stage
        .kind,
    ).toBe("ready");
    // Reload makes a fresh frame.
    const again = run(s, { type: "reload" });
    expect(again.stage.kind).toBe("opening");
    expect(again.prepKey).toBe(1);
  });

  test("refused or failed: the deck's own sentence, no frame, Reload and back", () => {
    const s = run(
      startCall,
      from("prep", {
        type: "failed",
        message: "The Blueprint is for clients in onboarding.",
      }),
    );
    const h = page(s);
    // A headline, then the deck's own sentence as the quiet line, as slow reads.
    expect(text(h)).toContain(
      "The Blueprint did not open. The Blueprint is for clients in onboarding.",
    );
    expect(h).toMatch(
      /<p class="[^"]*text-muted-foreground[^"]*">The Blueprint is for clients in onboarding\.<\/p>/,
    );
    expect(text(h)).toContain("Reload");
    expect(text(h)).toContain("Back to Cedar and Stone Interiors (example)");
    expect(h).not.toContain("<iframe");
    // No name anywhere: the clients, in the back link's own words.
    expect(
      text(
        page(s, {
          clientName: null,
          initialRead: {
            row: { ...rowFor("part1")!, clientName: "" },
            now: new Date().toISOString(),
            at: Date.now(),
          },
        }),
      ),
    ).toContain("All clients");
    // A frame that wandered off its path is hidden the same way.
    const left = run(ready, { type: "trouble", from: "prep", t: "left" });
    expect(left.stage.kind).toBe("failed");
    expect(page(left)).not.toContain("<iframe");
  });

  test("offline when opening, then online", () => {
    const s = run(startCall, { type: "trouble", from: "prep", t: "offline" });
    expect(text(page(s, { offline: true }))).toContain(
      "You're offline. The Blueprint opens when the connection is back.",
    );
    // Nothing to type into yet: the stage says it, the chip does not.
    expect(text(page(s, { offline: true }))).not.toContain(
      "Offline: what you type saves",
    );
    expect(text(page(ready, { offline: true }))).toContain(
      "Offline: what you type saves when the connection is back.",
    );
    expect(
      run(s, { type: "trouble", from: "prep", t: "online" }).stage.kind,
    ).toBe("opening");
    // Offline mid-call: the prep keeps going, the header says so.
    const mid = run(ready, { type: "trouble", from: "prep", t: "offline" });
    expect(mid.stage.kind).toBe("ready");
  });

  test("signed out in the frame: one line, Sign in, and Reload quietly", () => {
    const s = run(ready, from("prep", { type: "signed-out" }));
    const h = page(s);
    expect(text(h)).toContain("Sign in to the cockpit again. Sign in Reload");
    expect(h).not.toContain("<iframe");
    // Without the page's sign-out (the harness), the sign-in page itself,
    // coming back to this call.
    expect(h).toContain(
      `href="/login?next=${encodeURIComponent(`/blueprint/${TASK}`)}"`,
    );
    // On the route, Sign in signs this browser out, so the cockpit's own
    // gate sends him to sign in and back here.
    const routed = page(s, { onSignIn: () => {} });
    expect(routed).not.toContain('href="/login');
    expect(text(routed)).toContain("Sign in Reload");
  });

  test("wrong host: the direct Vercel address sends him to the portal", () => {
    expect(wrongHost("mahara-creative-director.vercel.app")).toBe(true);
    expect(wrongHost("cockpit.maharamedia.com")).toBe(false);
    expect(wrongHost("localhost:5192")).toBe(false);
    const h = page(startCall, {
      host: "mahara-creative-director.vercel.app",
      at: "part2",
    });
    expect(text(h)).toContain(
      "The Blueprint opens on cockpit.maharamedia.com.",
    );
    expect(h).toContain(
      `href="https://cockpit.maharamedia.com/creative/blueprint/${TASK}#part2"`,
    );
    expect(h).not.toContain("<iframe");
  });

  test("read only and rehearsal say so in the header", () => {
    const row = { ...rowFor("part1")!, can: { write: false } };
    expect(
      text(
        page(ready, {
          initialRead: { row, now: new Date().toISOString(), at: Date.now() },
        }),
      ),
    ).toContain("Only the creative director sends the parts.");
    expect(text(page(ready))).not.toContain("Only the creative director");
    const r = text(page(ready, { rehearse: true }));
    expect(r).toContain(
      "Rehearsal: nothing is saved or sent. Each press shows its plan.",
    );
    expect(page(ready, { rehearse: true })).toMatch(/rehearse=1/);
  });

  test("the name: from the card, else the record, else the frame", () => {
    const fromFrame = run(
      startCall,
      from("prep", {
        type: "ready",
        view: "prep",
        name: "Noor Studio Interiors",
      }),
    );
    const noName = {
      row: { ...rowFor("part1")!, clientName: "" },
      now: new Date().toISOString(),
      at: Date.now(),
    };
    expect(
      text(page(fromFrame, { clientName: null, initialRead: noName })),
    ).toContain("Noor Studio Interiors");
    // Nothing has named the client yet: a quiet line, never a guess.
    const waiting = page(startCall, { clientName: null, initialRead: noName });
    expect(waiting).toContain("data-skeleton");
    expect(text(waiting)).not.toContain("All clients");
    // Drawn, and still no name anywhere: the way back is to the clients.
    const drawn = run(
      startCall,
      from("prep", { type: "ready", view: "prep", name: "" }),
    );
    expect(
      text(page(drawn, { clientName: null, initialRead: noName })),
    ).toContain("All clients");
    expect(text(page(startCall, { clientName: null }))).toContain(
      "Cedar and Stone Interiors (example)",
    );
  });
});

// --------------------------------------------------------------- 6. the rail

describe("the parts rail", () => {
  const now = Date.parse("2026-10-24T09:00:00Z");
  test("where each part was sent, in the card's words; no progress (the prep's panel has it)", () => {
    for (const state of [
      "open",
      "part1",
      "unconfirmed",
      "sent",
      "changed",
      "closed",
      "late",
      "needs",
      "locked",
    ]) {
      const row = rowFor(state);
      const h = text(
        html(
          createElement(PartsRail, {
            read: { row, now: new Date(now).toISOString(), at: Date.now() },
            onRetry: () => {},
            now,
          }),
        ),
      );
      for (const p of PARTS) {
        const st = partState(row, p, row?.answers ?? {}, now);
        const wait = p === 3 ? offerWait(row, now) : null;
        const v = railView(p, st, row, wait);
        expect(h).toContain(v.text);
        // A part with a send to its name reads as the card does.
        if (
          ["sent", "sending", "unconfirmed", "needs_look", "changed"].includes(
            st.kind,
          )
        )
          expect(v.text).toBe(stateView(p, st, row, wait).text);
      }
      // Counts and readiness are the prep's to say.
      expect(h).not.toMatch(/\d+ of \d+|In progress|Ready|Not started/);
    }
    // Not sent yet, in each part's own words.
    const open = text(
      html(
        createElement(PartsRail, {
          read: {
            row: rowFor("open"),
            now: new Date(now).toISOString(),
            at: Date.now(),
          },
          onRetry: () => {},
          now,
        }),
      ),
    );
    expect(open).toContain("Not sent yet");
    expect(open).toContain("Call not closed yet");
    expect(open).toContain("Opens when the call closes");
  });

  test("a failed read says so and offers to read again, never Not started", () => {
    const h = text(
      html(
        createElement(PartsRail, {
          read: { error: "No connection." },
          onRetry: () => {},
        }),
      ),
    );
    expect(h).toBe(
      "The Blueprint record could not be read: No connection. Read it again",
    );
    expect(h).not.toContain("Not started");
  });

  test("a part moving on the call's channel reads the record at once; a save, soon", () => {
    for (const phase of ["queued", "done", "failed", "reconcile"])
      expect(readsAgain({ type: "bp-part", part: 1, phase })).toBe("now");
    expect(
      readsAgain({ type: "bp-part", part: 1, phase: "running" }),
    ).toBeNull();
    expect(readsAgain({ type: "bp-saved", values: {}, revision: 3 })).toBe(
      "soon",
    );
    expect(readsAgain({ type: "state" })).toBeNull();
    expect(readsAgain(null)).toBeNull();
  });
});

test("Ask Hermes stays off the call page, and on everywhere else", () => {
  // AppLayout leaves HermesChat out where this is true.
  expect(isBlueprintCall(`/blueprint/${TASK}`)).toBe(true);
  expect(isBlueprintCall("/clients/Noor")).toBe(false);
  expect(isBlueprintCall("/dashboard")).toBe(false);
  const layout = readFileSync(
    new URL("../src/components/AppLayout.tsx", import.meta.url),
    "utf8",
  );
  expect(layout).toContain(
    "{isBlueprintCall(location.pathname) ? null : <HermesChat />}",
  );
});

test("the shared deck's colours are the cockpit's tokens", () => {
  const src = readFileSync(
    new URL("../src/pages/BlueprintCallPage.tsx", import.meta.url),
    "utf8",
  );
  expect(src).not.toMatch(/#[0-9a-f]{6}\b/i);
  const css = readFileSync(
    new URL("../src/index.css", import.meta.url),
    "utf8",
  );
  expect(css).toContain("--color-deck-ground: var(--deck-ground);");
  expect(css).toContain("--color-deck-ink: var(--deck-ink);");
});

// ------------------------------------------------------------- 7. the rail lit

test("Clients stays lit on the call page", () => {
  expect(isActive(`/blueprint/${TASK}`, "/clients")).toBe(true);
  expect(isActive(`/blueprint/${TASK}/notes`, "/clients")).toBe(true);
  expect(isActive(`/blueprint/${TASK}`, "/dashboard")).toBe(false);
  expect(isActive("/clients/Noor", "/clients")).toBe(true);
});

// ------------------------------------------------------- the protocol's twin

test("deckHost.ts is the client success app's file, byte for byte, and imports nothing", () => {
  const mine = readFileSync(new URL("../src/lib/deckHost.ts", import.meta.url));
  const theirs = readFileSync(
    new URL(
      "../../client-success-cockpit/src/present/deckHost.ts",
      import.meta.url,
    ),
  );
  expect(mine.equals(theirs)).toBe(true);
  expect(mine.toString()).not.toMatch(/^(import |export .* from )/m);
});
