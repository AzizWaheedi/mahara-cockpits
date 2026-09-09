/**
 * Prints the Client performance screen as visible text, from the stored payload fixture.
 * Overview by default, `bun scripts/perf-render-dump.tsx profile` for one open client.
 * Run after any copy change — cheap proof the screen reads like a person wrote it.
 */
const fixture = await Bun.file(
  new URL("./fixtures/csm-profiles.json", import.meta.url),
).json();
const want = process.argv[2] === "profile";

let byName: Record<string, unknown> = {
  performanceOverview: fixture.overview,
  clientProfile: fixture.profile,
};
const { mock } = await import("bun:test");
mock.module("convex/react", () => ({
  useQuery: (name: string) => byName[name],
  useMutation: () => async () => null,
}));
mock.module("../convex/_generated/api", () => ({
  api: {
    csm: {
      performanceOverview: "performanceOverview",
      clientProfile: "clientProfile",
      reportIssue: "reportIssue",
    },
  },
}));
mock.module("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

const { ClientPerformancePage } = await import(
  "../src/pages/ClientPerformancePage"
);
const { createRoot } = await import("react-dom/client");
const { createElement, act } = await import("react");
const { Window } = await import("happy-dom");
const win = new Window({ url: "https://localhost/" });
// biome-ignore lint/suspicious/noExplicitAny: happy-dom globals for React
const g = globalThis as any;
g.window = win;
g.document = win.document;
g.navigator = win.navigator;
g.IS_REACT_ACT_ENVIRONMENT = true;
const host = win.document.createElement("div");
win.document.body.appendChild(host);
// biome-ignore lint/suspicious/noExplicitAny: happy-dom element into React DOM
const root = createRoot(host as any);
await act(async () => root.render(createElement(ClientPerformancePage, {})));
if (want) {
  const open = [...host.querySelectorAll("button")].filter(
    b => b.textContent?.trim() === "Open",
  )[0];
  await act(async () => open?.click());
}
console.log(
  (host.textContent ?? "")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/([a-z0-9%])([A-Z])/g, "$1 | $2"),
);
byName = {};
