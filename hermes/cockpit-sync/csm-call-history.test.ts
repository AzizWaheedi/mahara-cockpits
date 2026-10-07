import { describe, expect, it } from "bun:test";
import { mergeCalls } from "./csmProfileCalculations";
import { fathomCalls } from "./csmProviders";
import { withNativeContext, type Reads, type NativeRunContext } from "./runtime";

function makeMockReads(handler: (name: string, args: Record<string, any>) => any): Reads {
  return {
    tool: async (name: string, args: Record<string, any>) => handler(name, args),
    graph: async () => ({ data: [] }),
    fetch: async () => new Response("{}"),
    log: () => {},
  };
}

describe("mergeCalls regression tests", () => {
  it("retains cached calls lacking clientName across empty bounded reads and removes storage truncation", () => {
    const cachedWithoutClientName = Array.from({ length: 12 }, (_, i) => ({
      title: `Cached Call ${i + 1}`,
      at: `2026-09-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
      url: `https://fathom.video/call-${i + 1}`,
    }));

    const result = mergeCalls([], cachedWithoutClientName, "Acme Corp");
    expect(result.length).toBe(12);
    for (const call of result) {
      expect(call.clientName).toBe("Acme Corp");
    }
  });

  it("preserves same-URL human brief notes and unknown human fields while refreshing provider title summary timestamp", () => {
    const cached = [
      {
        title: "Old Title",
        at: "2026-09-01T10:00:00Z",
        url: "https://fathom.video/call-1",
        clientName: "Acme Corp",
        brief: "Human brief note about onboarding",
        notes: "Important human notes",
        unknownHumanField: "Custom reviewer rating",
      },
    ];

    const fresh = [
      {
        title: "Refreshed Provider Title",
        at: "2026-09-02T10:00:00Z",
        url: "https://fathom.video/call-1",
        summary: "Refreshed provider summary",
        external: ["lead@example.com"],
      },
    ];

    const result = mergeCalls(fresh, cached, "Acme Corp");
    expect(result.length).toBe(1);
    const call = result[0];
    expect(call.clientName).toBe("Acme Corp");
    expect(call.title).toBe("Refreshed Provider Title");
    expect(call.at).toBe("2026-09-02T10:00:00Z");
    expect(call.summary).toBe("Refreshed provider summary");
    expect(call.brief).toBe("Human brief note about onboarding");
    expect(call.notes).toBe("Important human notes");
    expect(call.unknownHumanField).toBe("Custom reviewer rating");
  });

  it("keeps fresh calls on next empty read", () => {
    const initialFresh = [
      {
        title: "Call 1",
        at: "2026-09-01T10:00:00Z",
        url: "https://fathom.video/call-1",
        external: [],
      },
    ];

    const firstPass = mergeCalls(initialFresh, [], "Acme Corp");
    expect(firstPass.length).toBe(1);
    expect(firstPass[0].clientName).toBe("Acme Corp");

    const secondPass = mergeCalls([], firstPass, "Acme Corp");
    expect(secondPass.length).toBe(1);
    expect(secondPass[0].title).toBe("Call 1");
    expect(secondPass[0].clientName).toBe("Acme Corp");
  });

  it("preserves no-URL calls with distinct title+timestamp and annotations", () => {
    const cached = [
      {
        title: "Weekly Sync",
        at: "2026-08-01T10:00:00Z",
        clientName: "Acme Corp",
        notes: "Week 1 notes",
      },
      {
        title: "Weekly Sync",
        at: "2026-08-08T10:00:00Z",
        clientName: "Acme Corp",
        notes: "Week 2 notes",
      },
    ];

    const result = mergeCalls([], cached, "Acme Corp");
    expect(result.length).toBe(2);
    expect(result.map(r => r.at)).toContain("2026-08-01T10:00:00Z");
    expect(result.map(r => r.at)).toContain("2026-08-08T10:00:00Z");
  });

  it("prevents explicit conflicting clientName from leaking between clients", () => {
    const cached = [
      {
        title: "Client B Call",
        at: "2026-09-01T10:00:00Z",
        url: "https://fathom.video/client-b",
        clientName: "Client B",
      },
    ];

    const fresh = [
      {
        title: "Leaked Call",
        at: "2026-09-02T10:00:00Z",
        url: "https://fathom.video/client-b",
        clientName: "Client B",
        external: [],
      },
    ];

    const result = mergeCalls(fresh as any, cached, "Client A");
    expect(result.filter(r => r.clientName === "Client B").length).toBe(0);
    expect(result.length).toBe(0);
  });
});

describe("fathomCalls regression tests with optional since argument", () => {
  const dummyContext: NativeRunContext = { receipts: [] };

  it("accepts optional since argument and sends valid ISO checkpoint across every pagination page", async () => {
    const customSince = "2026-09-01T00:00:00Z";
    const requestedUrls: string[] = [];

    const mockReads = makeMockReads((name, args) => {
      if (name === "native_fathom_get") {
        requestedUrls.push(args.url);
        if (args.url.includes("cursor=page2_cursor")) {
          return { items: [{ title: "Meeting 2", scheduled_start_time: "2026-09-02T00:00:00Z" }] };
        }
        return {
          items: [{ title: "Meeting 1", scheduled_start_time: "2026-09-01T10:00:00Z" }],
          next_cursor: "page2_cursor",
        };
      }
      throw new Error(`Unexpected tool call: ${name}`);
    });

    const calls = await withNativeContext(mockReads, dummyContext, () => fathomCalls(customSince));
    expect(calls.length).toBe(2);
    expect(requestedUrls.length).toBe(2);
    for (const url of requestedUrls) {
      expect(url).toContain(`created_after=${encodeURIComponent(customSince)}`);
    }
  });

  it("repeated cursor fails gracefully", async () => {
    let callCount = 0;
    const readsWithLoop = makeMockReads((name) => {
      if (name === "native_fathom_get") {
        callCount++;
        return {
          items: [{ title: `Meeting ${callCount}` }],
          next_cursor: "same_cursor",
        };
      }
      throw new Error(`Unexpected tool call: ${name}`);
    });

    await expect(
      withNativeContext(readsWithLoop, dummyContext, () => fathomCalls()),
    ).rejects.toThrow("Fathom pagination did not advance");
  });

  it("invalid timestamp fails before provider reads", async () => {
    let providerWasCalled = false;
    const mockReads = makeMockReads((name) => {
      if (name === "native_fathom_get") {
        providerWasCalled = true;
        return { items: [] };
      }
      throw new Error(`Unexpected tool call: ${name}`);
    });

    const invalidTimestamp = "not-a-valid-date";
    await expect(
      withNativeContext(mockReads, dummyContext, () => fathomCalls(invalidTimestamp)),
    ).rejects.toThrow();

    expect(providerWasCalled).toBe(false);
  });
});
