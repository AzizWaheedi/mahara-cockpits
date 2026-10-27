import { afterAll, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import {
  fixturePublic,
  proposalFixture,
} from "../src/dev/offer/proposalFixtures";
import {
  applyProposalPatch,
  ProposalSaver,
  sessionProposalDraft,
} from "../src/pages/money/offers/proposal/proposalSaver";
import {
  type Proposal,
  ProposalError,
  type ProposalIO,
} from "../src/pages/money/offers/proposal/proposalSources";

import { OFFER_KEYS } from "../src/present/offer/kinds";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function memoryStorage() {
  const rows = new Map<string, string>();
  return {
    getItem: (k: string) => rows.get(k) ?? null,
    setItem: (k: string, v: string) => {
      rows.set(k, v);
    },
    removeItem: (k: string) => {
      rows.delete(k);
    },
    rows,
  };
}
const row = () => proposalFixture().proposal;
const saved = (
  p: Proposal,
  patch: Parameters<typeof applyProposalPatch>[1],
  revision: number,
) => ({ ...applyProposalPatch(p, patch), revision: revision + 1 });
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("proposal save queue and recoverable edits", () => {
  test("coalesces typing and flushes the latest values once", async () => {
    const p = row();
    const calls: unknown[] = [];
    const queue = new ProposalSaver(
      p,
      async (patch, rev) => {
        calls.push([patch, rev]);
        return saved(p, patch, rev);
      },
      100000,
    );
    try {
      queue.edit({ valid_until: "2026-12-01" });
      queue.edit({ valid_until: "2026-12-02", price_reason: "A second site" });
      await queue.flush();
      expect(calls).toEqual([
        [{ valid_until: "2026-12-02", price_reason: "A second site" }, 1],
      ]);
      expect(queue.snapshot().dirty).toBe(false);
    } finally {
      queue.close();
    }
  });
  test("an in-flight response cannot overwrite newer edits; writes use the returned revision", async () => {
    const p = row();
    const first = deferred<Proposal>();
    const calls: { patch: Record<string, unknown>; rev: number }[] = [];
    const queue = new ProposalSaver(
      p,
      async (patch, rev) => {
        calls.push({ patch, rev });
        return calls.length === 1 ? first.promise : saved(p, patch, rev);
      },
      100000,
    );
    try {
      queue.edit({ valid_until: "2026-12-01" });
      const flushing = queue.flush();
      await tick();
      queue.edit({ valid_until: "2026-12-03" });
      expect(queue.snapshot().proposal.validUntil).toBe("2026-12-03");
      first.resolve({ ...p, validUntil: "2026-12-01", revision: 2 });
      await flushing;
      expect(calls.map(c => c.rev)).toEqual([1, 2]);
      expect(calls[1].patch).toEqual({ valid_until: "2026-12-03" });
      expect(queue.snapshot().proposal.validUntil).toBe("2026-12-03");
    } finally {
      queue.close();
    }
  });
  test("failure retains newer edits and retry sends those values", async () => {
    const p = row();
    const first = deferred<Proposal>();
    const calls: unknown[] = [];
    const queue = new ProposalSaver(
      p,
      async (patch, rev) => {
        calls.push(patch);
        return calls.length === 1 ? first.promise : saved(p, patch, rev);
      },
      100000,
    );
    try {
      queue.edit({ price_reason: "First" });
      const attempt = queue.flush();
      await tick();
      queue.edit({ price_reason: "Newest" });
      first.reject(Error("Offline"));
      await expect(attempt).rejects.toThrow("Offline");
      expect(queue.snapshot().state).toBe("error");
      expect(queue.snapshot().dirty).toBe(true);
      await queue.flush();
      expect(calls).toEqual([
        { price_reason: "First" },
        { price_reason: "Newest" },
      ]);
      expect(queue.snapshot().state).toBe("saved");
    } finally {
      queue.close();
    }
  });
  test("revision conflict never silently retries, and discard never sends pending changes", async () => {
    const p = row();
    let calls = 0;
    const storage = memoryStorage();
    const queue = new ProposalSaver(
      p,
      async () => {
        calls++;
        throw new ProposalError("Changed elsewhere", "40001");
      },
      100000,
      sessionProposalDraft(p.taskId, p.id, storage),
    );
    queue.edit({ price_reason: "Unsaved" });
    await expect(queue.flush()).rejects.toThrow("Changed elsewhere");
    queue.edit({ price_reason: "Still mine" });
    await expect(queue.flush()).rejects.toThrow("Changed elsewhere");
    expect(calls).toBe(1);
    await queue.discard();
    await queue.flush();
    expect(calls).toBe(1);
    expect(storage.rows.size).toBe(0);
  });
  test("SPA departure keeps a session draft; a newer server revision restores it as a conflict", async () => {
    const p = row();
    const storage = memoryStorage();
    let calls = 0;
    const write = async (
      patch: Parameters<typeof applyProposalPatch>[1],
      rev: number,
    ) => {
      calls++;
      return saved(p, patch, rev);
    };
    const first = new ProposalSaver(
      p,
      write,
      100000,
      sessionProposalDraft(p.taskId, p.id, storage),
    );
    first.edit({ valid_until: "2026-12-07" });
    first.close();
    expect(calls).toBe(0);
    const recovered = new ProposalSaver(
      { ...p, revision: 2 },
      write,
      100000,
      sessionProposalDraft(p.taskId, p.id, storage),
    );
    expect(recovered.snapshot().proposal.validUntil).toBe("2026-12-07");
    expect(recovered.snapshot().state).toBe("conflict");
    await expect(recovered.flush()).rejects.toThrow("newer version");
    expect(calls).toBe(0);
    await recovered.discard();
  });
  test("session recovery at the same revision can be retried and clears only its own draft", async () => {
    const p = row();
    const storage = memoryStorage();
    const first = new ProposalSaver(
      p,
      async () => p,
      100000,
      sessionProposalDraft(p.taskId, p.id, storage),
    );
    first.edit({ price_reason: "Recovered" });
    first.close();
    const next = new ProposalSaver(
      p,
      async (patch, rev) => saved(p, patch, rev),
      100000,
      sessionProposalDraft(p.taskId, p.id, storage),
    );
    try {
      expect(next.snapshot().state).toBe("error");
      await next.flush();
      expect(next.snapshot().proposal.priceReason).toBe("Recovered");
      expect(storage.rows.size).toBe(0);
    } finally {
      next.close();
    }
  });
  test("a late old save cannot clear or replace a newer recovered draft", async () => {
    const p = row();
    const storage = memoryStorage();
    const response = deferred<Proposal>();
    const old = new ProposalSaver(
      p,
      () => response.promise,
      100000,
      sessionProposalDraft(p.taskId, p.id, storage),
    );
    old.edit({ price_reason: "Old" });
    const flight = old.flush();
    await tick();
    old.close();
    const next = new ProposalSaver(
      p,
      async () => p,
      100000,
      sessionProposalDraft(p.taskId, p.id, storage),
    );
    next.edit({ price_reason: "New" });
    response.resolve({ ...p, revision: 2, priceReason: "Old" });
    await flight;
    next.close();
    const recovered = sessionProposalDraft(p.taskId, p.id, storage).load();
    expect(recovered?.patch.price_reason).toBe("New");
  });
  test("discard waits for a sent request but prevents late response recovery or further writes", async () => {
    const p = row();
    const storage = memoryStorage();
    const response = deferred<Proposal>();
    let calls = 0;
    const queue = new ProposalSaver(
      p,
      () => {
        calls++;
        return response.promise;
      },
      100000,
      sessionProposalDraft(p.taskId, p.id, storage),
    );
    queue.edit({ price_reason: "In flight" });
    const flight = queue.flush();
    await tick();
    queue.edit({ valid_until: "2026-12-08" });
    let finished = false;
    const discard = queue.discard().then(() => {
      finished = true;
    });
    await tick();
    expect(finished).toBe(false);
    response.resolve({ ...p, revision: 2 });
    await Promise.all([flight, discard]);
    expect(calls).toBe(1);
    expect(storage.rows.size).toBe(0);
  });
  test("a refresh cannot replace another proposal or erase queued edits", async () => {
    const p = row();
    const queue = new ProposalSaver(p, async () => p, 100000);
    try {
      expect(() => queue.replace({ ...p, id: "another" })).toThrow(
        "another proposal",
      );
      queue.edit({ price_reason: "Keep me" });
      expect(() => queue.replace({ ...p, revision: 3 })).toThrow(
        "pending changes",
      );
    } finally {
      await queue.discard();
    }
  });
});

// Browser lifecycle checks use the real builder and IO boundary, with only the iframe mocked.
const win = new Window({
  url: "https://localhost/client-success/clients/fictional-hosh/proposals/example",
});
for (const key of [
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
  (globalThis as Record<string, unknown>)[key] =
    key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
mock.module("../src/pages/money/offers/proposal/ProposalPreview", () => ({
  ProposalPreview: () => <section aria-label="Client page preview" />,
}));
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ProposalBuilder } = await import(
  "../src/pages/money/offers/proposal/ProposalBuilder"
);
afterAll(async () => {
  await win.happyDOM.close();
});
async function browserTest(
  run: (
    host: HTMLElement,
    render: (io: ProposalIO) => Promise<void>,
  ) => Promise<void>,
) {
  win.sessionStorage.clear();
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  const render = async (io: ProposalIO) => {
    await act(async () => {
      root.render(<ProposalBuilder io={io} />);
      await tick();
    });
  };
  try {
    await run(host as unknown as HTMLElement, render);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
}
function ioFixture(sent = false) {
  const bundle = proposalFixture("full", "en", sent);
  let loads = 0;
  let sends = 0;
  const io: ProposalIO = {
    load: async () => {
      loads++;
      return structuredClone(bundle);
    },
    preview: async p => fixturePublic(bundle, p),
    save: async (patch, rev) => {
      bundle.proposal = saved(bundle.proposal, patch, rev);
      const out = { ...bundle.proposal };
      delete out.videoReady;
      return out;
    },
    send: async rev => {
      sends++;
      return {
        code: "abcdefghjkmn",
        url: "https://offer.example/abcdefghjkmn",
        status: "link_copied",
        revision: rev + 1,
        problems: [],
      };
    },
    mark: async (rev, status) => {
      bundle.proposal = { ...bundle.proposal, revision: rev + 1, status };
      const out = { ...bundle.proposal };
      delete out.videoReady;
      delete out.heldFull;
      delete out.warnings;
      return out;
    },
    livePreview: async () => ({
      url: "https://offer.example/abcdefghjkmn?pv=example",
      until: "2026-12-01",
    }),
  };
  return { bundle, io, loads: () => loads, sends: () => sends };
}
const button = (host: HTMLElement, text: string) => {
  const found = Array.from(host.querySelectorAll("button")).find(
    b => b.textContent?.trim() === text,
  );
  if (!found) throw Error(`Missing button ${text}`);
  return found;
};
async function click(host: HTMLElement, text: string) {
  await act(async () => {
    button(host, text).click();
    await tick();
  });
}

test("marking a response reloads metadata instead of falsely removing its video", async () =>
  browserTest(async (host, render) => {
    const f = ioFixture(true);
    await render(f.io);
    await click(host, "Agreed");
    expect(f.loads()).toBe(2);
    expect(host.textContent).not.toContain("No video is set for this language");
    expect(host.textContent).not.toContain("Opening proposal");
  }));
test("a completion from the previous proposal cannot update the new page", async () =>
  browserTest(async (host, render) => {
    const first = ioFixture();
    const second = ioFixture();
    second.bundle.proposal = {
      ...second.bundle.proposal,
      id: "different",
      clientName: "Second fictional client",
    };
    const sending = deferred<Awaited<ReturnType<ProposalIO["send"]>>>();
    let started = false;
    first.io.send = async () => {
      started = true;
      return sending.promise;
    };
    await render(first.io);
    await click(host, "Copy link");
    expect(started).toBe(true);
    await render(second.io);
    await act(async () => {
      sending.resolve({
        code: "abcdefghjkmn",
        url: "https://offer.example/old",
        status: "link_copied",
        revision: 2,
        problems: [],
      });
      await tick();
    });
    expect(host.textContent).toContain("Second fictional client");
    expect(host.querySelector("input[readonly]")).toBeNull();
    expect(second.sends()).toBe(0);
  }));
test("send refreshes warnings and requires current acknowledgements before its RPC", async () =>
  browserTest(async (host, render) => {
    const f = ioFixture();
    await render(f.io);
    f.bundle.proposal.warnings = [
      { key: "changed", text: "A new point to review" },
    ];
    await click(host, "Copy link");
    expect(f.sends()).toBe(0);
    expect(host.textContent).toContain("A new point to review");
    expect(host.textContent).toContain("Review the updated points");
  }));
test("reload discards a recovered conflict without sending its stored patch", async () =>
  browserTest(async (host, render) => {
    const f = ioFixture();
    const p = f.bundle.proposal;
    const store = sessionProposalDraft(p.taskId, p.id, win.sessionStorage);
    store.load();
    store.save({ baseRevision: 1, patch: { valid_until: "2026-12-31" } });
    f.bundle.proposal.revision = 2;
    let saves = 0;
    f.io.save = async () => {
      saves++;
      return f.bundle.proposal;
    };
    win.confirm = () => true;
    await render(f.io);
    expect(
      (host.querySelector("input[type=date]") as HTMLInputElement).value,
    ).toBe("2026-12-31");
    await click(host, "Reload saved proposal");
    expect(saves).toBe(0);
    expect(win.sessionStorage.length).toBe(0);
    expect(
      (host.querySelector("input[type=date]") as HTMLInputElement).value,
    ).toBe(p.validUntil);
  }));

test.each(["link_copied", "accepted", "not_now"] as const)(
  "an expired unchanged %s link is explained and never copied or silently reopened",
  async status =>
    browserTest(async (host, render) => {
      const f = ioFixture(true);
      f.bundle.proposal.status = status;
      f.bundle.proposal.expired = true;
      f.bundle.proposal.validUntil = "2026-10-01";
      await render(f.io);
      expect(host.textContent).toContain("This client's link has expired");
      await click(host, "Copy link");
      expect(f.sends()).toBe(0);
      expect(host.textContent).toContain(
        "Choose a future Valid until date, then select Update link.",
      );
      expect(host.querySelector("input[readonly]")).toBeNull();
      expect(button(host, "Copy link")).toBeDefined();
    }),
);
test("the Valid until error is shown beside its field", async () =>
  browserTest(async (host, render) => {
    const f = ioFixture();
    f.bundle.proposal.problems = [
      {
        field: "valid_until",
        rule: "expired",
        block: true,
        text: "Choose a future date.",
      },
    ];
    await render(f.io);
    const input = host.querySelector("input[type=date]")!;
    const field = input.closest("label");
    expect(field?.textContent).toContain("Choose a future date.");
    expect(input.id).not.toBe("");
    expect(field?.htmlFor).toBe(input.id);
  }));
test("a locked draft can explicitly adopt the current list without publishing", async () =>
  browserTest(async (host, render) => {
    const f = ioFixture();
    f.bundle.catalog.locked = true;
    f.bundle.proposal.price.parts = {};
    let writes = 0;
    const write = f.io.save;
    f.io.save = async (patch, rev) => {
      writes++;
      return write(patch, rev);
    };
    await render(f.io);
    await click(host, "Use current list price");
    expect(writes).toBe(1);
    expect(f.bundle.proposal.price.parts).toEqual({ build: 2000, care: 200 });
    expect(f.sends()).toBe(0);
    expect(host.textContent).not.toContain("Use current list price");
  }));

test("refreshing captures saves recovered edits before reloading assets", async () =>
  browserTest(async (host, render) => {
    const f = ioFixture();
    const p = f.bundle.proposal;
    const draft = sessionProposalDraft(p.taskId, p.id, win.sessionStorage);
    draft.load();
    draft.save({ baseRevision: 1, patch: { valid_until: "2026-12-31" } });
    const events: string[] = [];
    const load = f.io.load;
    const save = f.io.save;
    f.io.load = async () => {
      events.push("load");
      return load();
    };
    f.io.save = async (patch, revision) => {
      events.push("save");
      return save(patch, revision);
    };
    await render(f.io);
    events.length = 0;
    f.bundle.files.push({
      id: "capture-fresh",
      kind: "capture",
      mime: "image/png",
      bytes: 2048,
      width: 1280,
      height: 720,
      fileName: "New capture",
      searchedAs: null,
      capturedOn: "2026-10-26",
      caption: "New capture",
      createdAt: "2026-10-26T12:00:00Z",
      path: "fictional-hosh/capture-fresh.png",
      url: "https://assets.example/capture-fresh.png",
    });
    await click(host, "Refresh captures and logos");
    expect(events).toEqual(["save", "load"]);
    expect(f.bundle.proposal.validUntil).toBe("2026-12-31");
    expect(host.querySelector('img[alt="New capture"]')).not.toBeNull();
    expect(f.sends()).toBe(0);
  }));

test("refreshing assets cannot discard a conflicting recovered draft", async () =>
  browserTest(async (host, render) => {
    const f = ioFixture();
    const p = f.bundle.proposal;
    const draft = sessionProposalDraft(p.taskId, p.id, win.sessionStorage);
    draft.load();
    draft.save({ baseRevision: 1, patch: { valid_until: "2026-12-31" } });
    f.bundle.proposal.revision = 2;
    let saves = 0;
    f.io.save = async () => {
      saves++;
      return f.bundle.proposal;
    };
    await render(f.io);
    await click(host, "Refresh captures and logos");
    expect(saves).toBe(0);
    expect(f.loads()).toBe(1);
    expect(
      (host.querySelector('input[type="date"]') as HTMLInputElement).value,
    ).toBe("2026-12-31");
    expect(host.textContent).toContain("newer version was saved");
  }));

for (const offer of OFFER_KEYS) {
  test(`proposal preparation keeps the ${offer} offer`, async () =>
    browserTest(async (host, render) => {
      const f = ioFixture();
      f.bundle.proposal.offerKey = offer;
      await render(f.io);
      const link = Array.from(host.querySelectorAll("a")).find(
        a => a.textContent?.trim() === "Open preparation",
      );
      expect(link?.getAttribute("href")).toBe(
        `/client-success/clients/${encodeURIComponent(f.bundle.proposal.taskId)}/present/offer/${offer}?view=prep`,
      );
      expect(f.sends()).toBe(0);
    }));
}
