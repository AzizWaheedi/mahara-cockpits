import { describe, expect, test } from "bun:test";
import { makeAddFiles } from "../src/present/adsActions";
import type { DeckMessage, LiveState } from "../src/present/channel";
import { emptyLive } from "../src/present/channel";
import type { Creative } from "../src/present/creative";
import {
  type DeckClient,
  type LaunchAd,
  uploadLaunchAd,
} from "../src/present/sources";
import {
  addFile,
  LocalAds,
  planUpload,
  remapPhones,
  saveProblem,
  trayCreatives,
} from "../src/present/uploads";

/**
 * Adding a creative on the call (DESIGN 10.3, 10.4) against mocked
 * operations: the file shows at once, the save runs behind it (reserve, a
 * signed PUT with progress, ready), and every refusal is said plainly in
 * the notes window while the canvas only shows what can be shown.
 */

const file = (name: string, type: string, size = 1024) =>
  new File([new Uint8Array(Math.min(size, 16))], name, { type }) as File & {
    size: number;
  };
/** A file that says it is bigger than it is (no 150 MB buffers in a test). */
const sized = (name: string, type: string, size: number) => {
  const f = file(name, type);
  Object.defineProperty(f, "size", { value: size });
  return f;
};

function ad(id: string, extra: Partial<LaunchAd> = {}): LaunchAd {
  return {
    id,
    taskId: "t1",
    kind: "custom",
    status: "ready",
    path: `t1/${id}.jpg`,
    mime: "image/jpeg",
    bytes: 1024,
    url: `https://signed/${id}`,
    ...extra,
  };
}

describe("what happens to a file before it is read", () => {
  test("pictures and videos are shown and saved", () => {
    expect(planUpload(file("a.jpg", "image/jpeg"))).toEqual({
      show: true,
      save: true,
      message: null,
    });
    expect(planUpload(file("a.mov", "video/quicktime")).save).toBe(true);
  });

  test("a PDF changes nothing, and says what to add", () => {
    const p = planUpload(file("brief.pdf", "application/pdf"));
    expect(p.show).toBe(false);
    expect(p.message).toBe(
      "brief.pdf is a PDF. Add a picture (JPG, PNG, WebP) or a video (MP4, MOV, WebM).",
    );
  });

  test("over 150 MB is shown on the phone but not saved", () => {
    const p = planUpload(sized("site.mp4", "video/mp4", 160 * 1024 * 1024));
    expect(p.show).toBe(true);
    expect(p.save).toBe(false);
    expect(p.message).toContain("Shown, not saved: site.mp4 is over 150 MB");
  });
});

describe("adding a file, with the save mocked", () => {
  const facts = async () => ({ width: 1080, height: 1350 });

  test("shown at once, then saving with progress, then saved", async () => {
    const said: DeckMessage[] = [];
    const r = await addFile(
      file("kitchen.jpg", "image/jpeg"),
      { kind: "custom", phone: "feed" },
      {
        facts,
        newId: () => "abc",
        emit: m => said.push(m),
        save: async ({ onProgress }) => {
          onProgress(0.5);
          onProgress(1);
          return ad("saved-1");
        },
      },
    );
    expect(r).toMatchObject({ id: "local-abc", phase: "saved" });
    expect(said[0]).toMatchObject({
      type: "file",
      file: { id: "local-abc", phase: "saving", phone: "feed", width: 1080 },
    });
    expect(said.filter(m => m.type === "upload").map(m => (m as { phase: string }).phase)).toEqual([
      "saving",
      "saving",
      "saved",
    ]);
    expect(said.at(-1)).toMatchObject({ savedId: "saved-1" });
  });

  test("a PDF never reaches the save or the windows", async () => {
    let saved = false;
    const said: DeckMessage[] = [];
    const r = await addFile(file("x.pdf", "application/pdf"), { kind: "custom" }, {
      facts,
      emit: m => said.push(m),
      save: async () => {
        saved = true;
        return ad("x");
      },
    });
    expect(r.phase).toBe("refused");
    expect(saved).toBe(false);
    expect(said).toEqual([]);
  });

  test("a video the browser can't play changes nothing", async () => {
    const r = await addFile(file("odd.mov", "video/quicktime"), { kind: "custom" }, {
      facts: async () => {
        throw Error("no");
      },
      emit: () => {},
      save: async () => ad("x"),
    });
    expect(r).toEqual({
      id: null,
      phase: "refused",
      message: "This browser can't play odd.mov. Export it as MP4.",
    });
  });

  test("too big: shown, never saved", async () => {
    let saved = false;
    const said: DeckMessage[] = [];
    const r = await addFile(
      sized("big.mp4", "video/mp4", 200 * 1024 * 1024),
      { kind: "custom" },
      {
        facts,
        emit: m => said.push(m),
        save: async () => {
          saved = true;
          return ad("x");
        },
      },
    );
    expect(r.phase).toBe("shown");
    expect(saved).toBe(false);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatchObject({ type: "file", file: { phase: "shown" } });
  });

  test("a save that stops says so in plain words; the preview stays", async () => {
    const said: DeckMessage[] = [];
    const r = await addFile(file("a.jpg", "image/jpeg"), { kind: "custom" }, {
      facts,
      emit: m => said.push(m),
      save: async () => {
        throw Error("JWT expired");
      },
    });
    expect(r.phase).toBe("failed");
    expect(r.message).toBe("Saving needs your cockpit sign-in. The preview still works.");
    expect(said[0].type).toBe("file");
    expect(said.at(-1)).toMatchObject({ type: "upload", phase: "failed" });
    expect(saveProblem(Error("Not saved. Add it again to retry."))).toBe(
      "Not saved. Add it again to retry.",
    );
  });
});

describe("the save itself, against mocked launchAds operations", () => {
  function client(calls: { operation: string; args: Record<string, unknown> }[]) {
    return {
      rpc: async () => ({ data: null, error: null }),
      auth: {},
      functions: {
        invoke: async (_name: string, { body }: { body: Record<string, unknown> }) => {
          calls.push({
            operation: String(body.operation),
            args: body.args as Record<string, unknown>,
          });
          if (body.operation === "launchAds.reserve")
            return {
              data: {
                ad: ad("new-1", { status: "uploading", posterPath: "t1/new-1.poster.jpg" }),
                upload: { path: "t1/new-1.mp4", url: "https://put/file", token: "t" },
                posterUpload: { path: "t1/new-1.poster.jpg", url: "https://put/poster", token: "t" },
              },
              error: null,
            };
          if (body.operation === "launchAds.ready")
            return { data: { ad: ad("new-1") }, error: null };
          return { data: null, error: { message: "Unknown" } };
        },
      },
    } as unknown as DeckClient;
  }

  test("reserve, PUT the file and its poster with progress, then ready", async () => {
    const calls: { operation: string; args: Record<string, unknown> }[] = [];
    const puts: string[] = [];
    const progress: number[] = [];
    const out = await uploadLaunchAd(client(calls), {
      taskId: "t1",
      file: file("site.mp4", "video/mp4"),
      kind: "custom",
      facts: { width: 1080, height: 1920, seconds: 24, poster: new Blob(["p"], { type: "image/jpeg" }) },
      requestId: "11111111-1111-4111-8111-111111111111",
      onProgress: s => progress.push(s),
      put: async (url, _f, _t, onProgress) => {
        puts.push(url);
        onProgress?.(1);
      },
    });
    expect(out.id).toBe("new-1");
    expect(calls.map(c => c.operation)).toEqual(["launchAds.reserve", "launchAds.ready"]);
    expect(calls[0].args).toMatchObject({
      taskId: "t1",
      kind: "custom",
      mime: "video/mp4",
      width: 1080,
      height: 1920,
      seconds: 24,
      poster: { mime: "image/jpeg", bytes: 1 },
    });
    expect(puts).toEqual(["https://put/file", "https://put/poster"]);
    expect(progress.at(-1)).toBe(1);
  });

  test("the server's own sentence comes back when an operation is refused", async () => {
    const c = {
      rpc: async () => ({ data: null, error: null }),
      auth: {},
      functions: {
        invoke: async () => ({
          data: null,
          error: {
            message: "Edge Function returned a non-2xx status code",
            context: new Response(JSON.stringify({ error: "Choose a client and one of its files." }), {
              status: 400,
            }),
          },
        }),
      },
    } as unknown as DeckClient;
    await expect(
      uploadLaunchAd(c, {
        taskId: "t1",
        file: file("a.jpg", "image/jpeg"),
        kind: "custom",
        facts: {},
        put: async () => {},
      }),
    ).rejects.toThrow("Choose a client and one of its files.");
  });
});

describe("what each window holds", () => {
  test("files posted between windows get their own object URLs, and go when saved", () => {
    const made: string[] = [];
    const freed: string[] = [];
    const store = new LocalAds(
      () => {
        made.push("u");
        return `blob:${made.length}`;
      },
      u => freed.push(u),
    );
    store.apply({
      type: "file",
      file: {
        id: "local-1",
        name: "a.jpg",
        mime: "image/jpeg",
        bytes: 10,
        blob: new Blob(["a"]),
        kind: "custom",
        phase: "saving",
      },
    });
    expect(store.list[0]).toMatchObject({ id: "local-1", url: "blob:1" });
    store.apply({ type: "upload", id: "local-1", phase: "saved", savedId: "s-1", progress: 1 });
    expect(store.list[0]).toMatchObject({ phase: "saved", savedId: "s-1" });
    // The tray shows the saved copy in place of the local one.
    const saved = [{ id: "s-1" } as Creative];
    expect(trayCreatives(saved, store.list).map(c => c.id)).toEqual(["s-1"]);
    expect(trayCreatives([], store.list).map(c => c.id)).toEqual(["local-1"]);
    store.remove("local-1");
    expect(freed).toEqual(["blob:1"]);
  });

  test("a phone that held the local copy points at the saved one", () => {
    expect(remapPhones({ feed: "local-1", reels: "x" }, "local-1", "s-1")).toEqual({
      feed: "s-1",
      reels: "x",
    });
  });

  test("adding files from the notes window: placed on the focused phone, then remapped and read again", async () => {
    let live: LiveState = emptyLive();
    const posted: DeckMessage[] = [];
    let reloads = 0;
    const add = makeAddFiles(
      {
        emit: m => posted.push(m),
        setLive: fn => {
          live = fn(live);
        },
        reload: async () => {
          reloads++;
        },
        hub: { post: (m: DeckMessage) => posted.push(m) } as never,
      },
      {
        fileFacts: async () => ({ width: 1080, height: 1920 }),
        uploadAd: async () => ad("s-9"),
      },
      () => "facebook",
    );
    await add([file("tall.jpg", "image/jpeg")]);
    expect(live.phones?.facebook).toBe("s-9");
    expect(live.selected).toBe("s-9");
    expect(reloads).toBe(1);
    expect(posted.some(m => m.type === "ads")).toBe(true);
  });
});
