import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

/**
 * The shared deck's own error boundary (the deck is on the client's
 * screen): a slide that throws breaks into one calm line with no stack and
 * no error text, the next slide draws again, and the failure is reported
 * once.
 */

const win = new Window({
  url: "https://localhost/client-success/clients/t1/present/launch",
});
for (const k of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "DocumentFragment",
  "Text",
  "sessionStorage",
])
  (globalThis as Record<string, unknown>)[k] =
    k === "window" ? win : (win as unknown as Record<string, unknown>)[k];
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
mock.module("@/auth/SupabaseAuthProvider", () => ({
  getCockpitSupabaseClient: () => null,
  useCockpitAuth: () => ({ client: null }),
}));

const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { DeckBoundary } = await import("../src/present/DeckBoundary");

const host = win.document.createElement("div");
win.document.body.append(host);
const root = createRoot(host as unknown as Element);
afterAll(async () => {
  await act(async () => root.unmount());
  await win.happyDOM.close();
});

function Broken(): never {
  throw new Error("Cannot read properties of undefined (reading 'questions')");
}

test("a slide that throws shows one calm line, no stack and no error text, and is reported once", async () => {
  const reports: { title: string; detail: string }[] = [];
  const report = async (r: { title: string; detail: string }) => {
    reports.push(r);
  };
  const quiet = console.error;
  console.error = () => {};
  try {
    for (const key of ["a", "b"])
      await act(async () =>
        root.render(
          <DeckBoundary
            key={key}
            where="form"
            report={report}
            fallback={<strong>This slide could not be drawn.</strong>}
          >
            <Broken />
          </DeckBoundary>,
        ),
      );
  } finally {
    console.error = quiet;
  }
  const text = host.textContent ?? "";
  expect(text).toBe("This slide could not be drawn.");
  for (const leak of ["Cannot read", "questions", "at ", ".tsx", "Error"])
    expect(text.includes(leak)).toBe(false);
  expect(reports.length).toBe(1);
  expect(reports[0].title).toContain("#form");
  // The next slide (a new boundary) draws as usual.
  await act(async () =>
    root.render(
      <DeckBoundary key="next" where="call" fallback={<strong>broken</strong>}>
        <p>The call</p>
      </DeckBoundary>,
    ),
  );
  expect(host.textContent).toBe("The call");
});
