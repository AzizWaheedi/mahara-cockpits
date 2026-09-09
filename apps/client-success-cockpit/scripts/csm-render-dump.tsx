/**
 * Prints the visible text of every CSM screen from a real snapshot, so we can see what
 * the CSM sees without a browser (the screenshot tool does not work in this project).
 *
 * Run: bun scripts/csm-render-dump.tsx [section]
 */
import { mock } from "bun:test";

const snapshot = await Bun.file(
  new URL("./fixtures/csm-snapshot.json", import.meta.url),
).json();

mock.module("convex/react", () => ({
  useQuery: () => snapshot,
  useMutation: () => async () => null,
}));
mock.module("../convex/_generated/api", () => ({
  api: { csm: new Proxy({}, { get: (_t, k) => String(k) }) },
}));
mock.module("sonner", () => ({
  toast: { success: () => {}, error: () => {} },
}));

const { CsmPage } = await import("../src/pages/CsmPage");
const { createRoot } = await import("react-dom/client");
const { createElement, act } = await import("react");
const { Window } = await import("happy-dom");

const win = new Window({ url: "https://localhost/" });
// biome-ignore lint/suspicious/noExplicitAny: globals for React
const g = globalThis as any;
g.window = win;
g.document = win.document;
g.navigator = win.navigator;
g.HTMLElement = win.HTMLElement;
g.Element = win.Element;
g.Node = win.Node;
g.IS_REACT_ACT_ENVIRONMENT = true;

const sections = process.argv[2]
  ? [process.argv[2]]
  : ["start", "clients", "tasks", "hot", "links", "money", "eod"];

for (const section of sections) {
  const host = win.document.createElement("div");
  win.document.body.appendChild(host);
  // biome-ignore lint/suspicious/noExplicitAny: happy-dom element
  const root = createRoot(host as any);
  await act(async () => {
    root.render(createElement(CsmPage, { section: section as never }));
  });
  const text = (host.textContent ?? "").replace(/\s+/g, " ").trim();
  console.log(`\n===== ${section} (${text.length} chars) =====\n${text}`);
  await act(async () => root.unmount());
}
