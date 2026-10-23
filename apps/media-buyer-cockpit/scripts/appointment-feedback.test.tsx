import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const envBefore = [process.env, import.meta.env].map(env => ({
  env,
  url: env.VITE_SUPABASE_URL,
  key: env.VITE_SUPABASE_ANON_KEY,
}));
process.env.VITE_SUPABASE_URL = "https://bldgtotkfmhoxmlzowdx.supabase.co";
process.env.VITE_SUPABASE_ANON_KEY = "test-placeholder-key";
Object.assign(import.meta.env, {
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
});
const { AppointmentFeedback, AppointmentFeedbackRow } = await import(
  "../src/components/AppointmentFeedback"
);
const {
  clickupTaskId,
  feedbackTaskIdForClient,
  feedbackQuality,
  feedbackDelivery,
  readAppointmentFeedback,
} = await import("../src/lib/appointmentFeedback");
type Page = import("../src/lib/appointmentFeedback").FeedbackPage;
type Reader = import("../src/lib/appointmentFeedback").FeedbackReader;
const { supabase } = await import("../src/lib/supabase");

const win = new Window({ url: "https://cockpit.test/ads" });
const globals = globalThis as Record<string, unknown>;
const domKeys = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLButtonElement",
  "Element",
  "Node",
  "Event",
  "MouseEvent",
  "MutationObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
];
const old = new Map(domKeys.map(k => [k, globals[k]]));
const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
const originalFetch = globalThis.fetch;
let root: Root | undefined;
let host: HTMLDivElement;

beforeAll(() => {
  for (const k of domKeys)
    globals[k] = (win as unknown as Record<string, unknown>)[k];
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (() => {
    throw new Error("This UI test cannot call a provider.");
  }) as typeof fetch;
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});
afterAll(() => {
  for (const k of domKeys) globals[k] = old.get(k);
  globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
  globalThis.fetch = originalFetch;
  win.happyDOM.abort();
  for (const { env, url, key } of envBefore) {
    if (url === undefined) delete env.VITE_SUPABASE_URL;
    else env.VITE_SUPABASE_URL = url;
    if (key === undefined) delete env.VITE_SUPABASE_ANON_KEY;
    else env.VITE_SUPABASE_ANON_KEY = key;
  }
});

const row = {
  appointmentId: "test-appointment",
  contactId: "test-contact",
  contactName: "Test customer",
  startAt: "2026-10-22T09:00:00Z",
  attendance: "showed",
  deal: "pending",
  leadQuality: 8,
  feedback: "A good fit for our project",
  consultationFeedback: "Needs a quotation",
  notClosedReason: "Waiting for the design",
  updatedAt: "2026-10-23T09:00:00Z",
  deliveryState: "pending" as const,
  source: "portal",
};
const page = (locationId = "location-a", name = "Test customer"): Page => ({
  locationId,
  generatedAt: "2026-10-23T09:00:00Z",
  total: 1,
  items: [{ ...row, contactName: name }],
  hasMore: false,
});
async function render(element: React.ReactNode) {
  if (!root) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  await act(async () => {
    root?.render(element);
  });
}

test("only an exact ClickUp task URL selects a client", () => {
  expect(clickupTaskId("https://app.clickup.com/t/86abc?foo=bar")).toBe(
    "86abc",
  );
  for (const value of [
    "Liwan",
    "86abc",
    "https://evil.test/t/86abc",
    "https://app.clickup.com.evil.test/t/86abc",
    "http://app.clickup.com/t/86abc",
    undefined,
  ])
    expect(clickupTaskId(value)).toBeUndefined();
});

test("a no-show has no lead quality even when legacy data carries one", () => {
  expect(
    feedbackQuality({ ...row, attendance: "no_show", leadQuality: 2 }),
  ).toBeNull();
  expect(feedbackQuality({ ...row, leadQuality: null })).toBeNull();
  expect(feedbackQuality(row)).toBe(8);
});

test("a unique exact client card or declared alias selects feedback without fuzzy collisions", () => {
  const cards = [
    {
      name: "Example Interiors",
      aliases: ["Example Studio"],
      url: "https://app.clickup.com/t/clientA",
    },
    {
      name: "Different Client",
      aliases: [],
      url: "https://app.clickup.com/t/clientB",
    },
  ];
  expect(feedbackTaskIdForClient(cards, " example interiors ")).toBe("clientA");
  expect(feedbackTaskIdForClient(cards, "EXAMPLE STUDIO")).toBe("clientA");
  expect(feedbackTaskIdForClient(cards, "Example-Studio")).toBeUndefined();
  expect(
    feedbackTaskIdForClient(
      [
        ...cards,
        { name: "Example Studio", url: "https://app.clickup.com/t/clientC" },
      ],
      "Example Studio",
    ),
  ).toBeUndefined();
  expect(feedbackTaskIdForClient(cards, "")).toBeUndefined();
});

test("delivery wording never changes a saved comment into a delivery success", () => {
  expect(feedbackDelivery("review")).toContain("team check");
  expect(feedbackDelivery("failed")).toContain("retry");
  expect(feedbackDelivery("pending")).toContain("in progress");
  expect(feedbackDelivery("succeeded")).toBeNull();
});

test("all three client comment fields and rating remain readable while delivery waits", async () => {
  await render(
    <AppointmentFeedback taskId="client-card" reader={async () => page()} />,
  );
  expect(host.textContent).toContain("A good fit for our project");
  expect(host.textContent).toContain("Needs a quotation");
  expect(host.textContent).toContain("Waiting for the design");
  expect(host.textContent).toContain("8");
  expect(host.textContent).toContain("/ 10");
  expect(host.textContent).toContain("Follow-up delivery is in progress");
  expect(host.textContent).toContain("Client portal");
});

test("no-show score stays hidden and comments are plain text", async () => {
  await render(
    <ul>
      <AppointmentFeedbackRow
        row={{
          ...row,
          attendance: "no_show",
          leadQuality: 2,
          feedback: '<img src="bad" onerror="alert(1)">',
          consultationFeedback: "سعره مناسب",
        }}
      />
    </ul>,
  );
  expect(host.textContent).toContain("Not scored: no-show");
  expect(host.textContent).not.toContain("/ 10");
  expect(host.textContent).toContain("سعره مناسب");
  expect(host.querySelector("img")).toBeNull();
  expect(host.querySelector('[dir="auto"]')).not.toBeNull();
});

test("blank and failed reads are distinct, with a retry", async () => {
  await render(
    <AppointmentFeedback
      taskId="empty"
      reader={async () => ({ ...page(), total: 0, items: [] })}
    />,
  );
  expect(host.textContent).toContain("No feedback yet");
  const failed: Reader = async () => {
    throw new Error("Could not read feedback");
  };
  await render(<AppointmentFeedback taskId="error" reader={failed} />);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not read feedback",
  );
  expect(host.textContent).toContain("Try again");
  expect(host.textContent).not.toContain("No feedback yet");
});

test("an unlinked client never sends an unscoped read", async () => {
  let calls = 0;
  await render(
    <AppointmentFeedback
      reader={async () => {
        calls++;
        return page();
      }}
    />,
  );
  expect(calls).toBe(0);
  expect(host.textContent).toContain("linked workspace");
});

test("switching clients clears old comments immediately and ignores a late reply", async () => {
  const pending = new Map<string, (data: Page) => void>();
  const signals: AbortSignal[] = [];
  const reader: Reader = (scope, signal) => {
    signals.push(signal);
    return new Promise(resolve => pending.set(String(scope.taskId), resolve));
  };
  await render(<AppointmentFeedback taskId="first" reader={reader} />);
  await render(<AppointmentFeedback taskId="second" reader={reader} />);
  expect(signals[0].aborted).toBe(true);
  await act(async () =>
    pending.get("second")?.(page("location-b", "Second client's customer")),
  );
  expect(host.textContent).toContain("Second client's customer");
  await act(async () =>
    pending.get("first")?.(page("location-a", "First client's customer")),
  );
  expect(host.textContent).not.toContain("First client's customer");
  expect(host.textContent).toContain("Second client's customer");
});

test("pagination and periods reset when the client changes", async () => {
  const scopes: Array<Parameters<Reader>[0]> = [];
  const reader: Reader = async scope => {
    scopes.push(scope);
    return { ...page(scope.taskId || "location"), hasMore: true };
  };
  await render(
    <AppointmentFeedback
      taskId="first"
      from="2026-10-01"
      to="2026-10-23"
      reader={reader}
    />,
  );
  const next = [...host.querySelectorAll("button")].find(
    b => b.textContent === "Next",
  );
  await act(async () => next?.click());
  expect(scopes.at(-1)?.offset).toBe(5);
  await render(
    <AppointmentFeedback
      taskId="second"
      from="2026-10-01"
      to="2026-10-23"
      reader={reader}
    />,
  );
  expect(scopes.at(-1)).toMatchObject({
    taskId: "second",
    offset: 0,
    from: "2026-10-01",
    to: "2026-10-23",
  });
});

test("RPC reads send the exact identity and reject a mismatched response", async () => {
  const db = supabase as unknown as { rpc: (...args: unknown[]) => unknown };
  const original = db.rpc;
  let args: unknown[] = [];
  db.rpc = (...values) => {
    args = values;
    return {
      abortSignal: async () => ({ data: page("wrong-location"), error: null }),
    };
  };
  try {
    await expect(
      readAppointmentFeedback(
        { locationId: "location-a", taskId: "card-a", offset: 10 },
        new AbortController().signal,
      ),
    ).rejects.toThrow("could not be verified");
    expect(args).toEqual([
      "cockpit_client_appointment_feedback",
      {
        p_location: "location-a",
        p_task_id: "card-a",
        p_from: null,
        p_to: null,
        p_limit: 5,
        p_offset: 10,
      },
    ]);
  } finally {
    db.rpc = original;
  }
});

test("two occurrences of a moved appointment stay visible as separate rows", async () => {
  await render(
    <AppointmentFeedback
      taskId="moved"
      reader={async () => ({
        ...page(),
        total: 2,
        items: [
          row,
          {
            ...row,
            startAt: "2026-10-26T09:00:00Z",
            feedback: "The customer asked to move the meeting",
          },
        ],
      })}
    />,
  );
  expect(host.querySelectorAll("li").length).toBe(2);
  expect(host.textContent).toContain("22 Oct 2026");
  expect(host.textContent).toContain("26 Oct 2026");
});

test("an imported report never implies its appointment time was verified", async () => {
  await render(
    <AppointmentFeedbackRow
      row={{ ...row, startAt: null, occurrenceVerified: false }}
    />,
  );
  expect(host.textContent).toContain(
    "Imported report · appointment time not verified",
  );
  expect(host.textContent).not.toContain("Kuwait time");
});

test("focus refreshes feedback and a failed refresh keeps an explicit stale notice", async () => {
  let reads = 0;
  const reader: Reader = async () => {
    reads++;
    if (reads > 1) throw new Error("Connection unavailable");
    return page();
  };
  await render(<AppointmentFeedback taskId="focus" reader={reader} />);
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(reads).toBe(2);
  expect(host.textContent).toContain("last successful read");
  expect(host.textContent).toContain("Test customer");
});
