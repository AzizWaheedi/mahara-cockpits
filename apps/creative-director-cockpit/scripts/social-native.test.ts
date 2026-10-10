import { beforeEach, describe, expect, it, mock } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The Social calendar on Supabase (src/lib/social.ts): every button that
 * needs a model queues the job Salma actually handles, with the payload the
 * Convex version wrote; every write's failure reaches the person; and the
 * Pages list says how old it really is. The client below is a recorder: no
 * network, no keys, no database.
 */

type Any = any;
type Call = {
  table: string;
  op: "select" | "insert" | "upsert" | "update" | "delete";
  payload?: Any;
  options?: Any;
  returning?: string;
  filters: Any[][];
  single?: boolean;
};
type Reply = { data?: Any; error?: Any } | undefined;

const calls: Call[] = [];
const rpcs: { name: string; args: Any }[] = [];
let reply: (c: Call) => Reply = () => undefined;
let rpcReply: (name: string, args: Any) => Reply = () => undefined;
let signed: Reply;
let session: Any = {
  user: { email: "Creative@Tests.Invalid", user_metadata: {} },
};

class Query {
  c: Call;
  constructor(table: string) {
    this.c = { table, op: "select", filters: [] };
  }
  select(cols?: string) {
    if (this.c.op === "select") this.c.filters.push(["select", cols]);
    else this.c.returning = cols ?? "*";
    return this;
  }
  insert(p: Any) {
    Object.assign(this.c, { op: "insert", payload: p });
    return this;
  }
  upsert(p: Any, o?: Any) {
    Object.assign(this.c, { op: "upsert", payload: p, options: o });
    return this;
  }
  update(p: Any) {
    Object.assign(this.c, { op: "update", payload: p });
    return this;
  }
  delete() {
    this.c.op = "delete";
    return this;
  }
  maybeSingle() {
    this.c.single = true;
    return this;
  }
  // biome-ignore lint/suspicious/noThenProperty: awaited like the real query builder
  then(ok: (v: Any) => Any, bad?: (e: Any) => Any) {
    calls.push(this.c);
    const r = reply(this.c);
    const fallback =
      this.c.op === "select"
        ? { data: this.c.single ? null : [] }
        : { data: this.c.returning ? [{ id: "touched" }] : null };
    return Promise.resolve({ error: null, ...fallback, ...(r ?? {}) }).then(
      ok,
      bad,
    );
  }
}
for (const name of ["eq", "neq", "in", "not", "order", "limit"])
  (Query.prototype as Any)[name] = function (this: Query, ...a: Any[]) {
    this.c.filters.push([name, ...a]);
    return this;
  };

const fake = {
  auth: {
    getSession: async () => ({ data: { session }, error: null }),
  },
  rpc: async (name: string, args?: Any) => {
    rpcs.push({ name, args });
    return {
      data: null,
      error: null,
      ...(rpcReply(name, args) ??
        (name === "cockpit_review_clients"
          ? { data: [{ task_id: "86c1abc", name: "Qatar Technology" }] }
          : {})),
    };
  },
  from: (table: string) => new Query(table),
  storage: {
    from: (_bucket: string) => ({
      createSignedUploadUrl: async (path: string) =>
        signed ?? {
          data: { signedUrl: `https://store.invalid/sign/${path}?token=t` },
          error: null,
        },
      getPublicUrl: (path: string) => ({
        data: { publicUrl: `https://store.invalid/public/${path}` },
      }),
    }),
  },
};

mock.module("../src/lib/supabase", () => ({ supabase: fake }));

const social = await import("../src/lib/social");
const rules = await import("../src/lib/socialRules");
const { REVIEW_BASE } = await import("../src/lib/review");

const POST = "86c1abc:2099-01:3";
const post = (extra: Any = {}) => ({
  id: POST,
  client_task_id: "86c1abc",
  batch_id: "86c1abc:2099-01",
  status: "approved",
  media: [
    {
      kind: "image",
      url: "https://x.invalid/1.jpg",
      source: "ai",
      look: "showcase",
    },
    {
      kind: "video",
      url: "https://x.invalid/2.mp4",
      source: "upload",
      cover: null,
    },
    {
      kind: "image",
      url: "https://x.invalid/3.jpg",
      source: "ai",
      look: "bold",
      words: { headline: "Hi" },
    },
  ],
  ...extra,
});

function jobs(): Any[] {
  return calls
    .filter(c => c.table === "social_jobs" && c.op === "upsert")
    .flatMap(c => {
      expect(c.options).toEqual({ onConflict: "id" });
      return c.payload;
    });
}

function readsPost(row: Any = post()) {
  reply = c =>
    c.table === "social_posts" && c.op === "select" && c.single
      ? { data: row }
      : undefined;
}

beforeEach(() => {
  calls.length = 0;
  rpcs.length = 0;
  reply = () => undefined;
  rpcReply = () => undefined;
  signed = undefined;
  session = { user: { email: "Creative@Tests.Invalid", user_metadata: {} } };
});

describe("Salma's contract", () => {
  it("queues only the kinds Salma has a handler for, and the database agrees", () => {
    const py = readFileSync(
      new URL("../../../hermes/salma/salma.py", import.meta.url),
      "utf8",
    );
    const kinds = /^KINDS = \(([^)]*)\)/m
      .exec(py)?.[1]
      .match(/"([a-z]+)"/g)
      ?.map(k => k.replaceAll('"', ""));
    expect(new Set(rules.SALMA_KINDS)).toEqual(new Set(kinds));
    const sql = readFileSync(
      new URL(
        "../../../supabase/migrations/20261009e_social_native.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const allowed = [...sql.matchAll(/kind = ANY \(ARRAY\[([^\]]*)\]\)/g)].map(
      m => new Set(m[1].match(/'([a-z]+)'/g)?.map(k => k.replaceAll("'", ""))),
    );
    expect(allowed).toHaveLength(2);
    for (const a of allowed) expect(a).toEqual(new Set(rules.SALMA_KINDS));
    expect(() =>
      rules.queuedJob({
        id: "x",
        kind: "animate" as Any,
        requestedBy: "a",
        at: "t",
      }),
    ).toThrow(/no way/);
  });
});

describe("the stubs now queue real work", () => {
  it("Add words queues Salma's words job with write set", async () => {
    readsPost();
    expect(await social.addWords({ postId: POST, index: 0 })).toBeNull();
    expect(jobs()).toEqual([
      expect.objectContaining({
        id: `words:${POST}:0`,
        kind: "words",
        client_task_id: "86c1abc",
        batch_id: "86c1abc:2099-01",
        post_id: POST,
        params: { index: 0, write: true },
        status: "queued",
        attempts: 0,
        error: null,
        result: null,
        requested_by: "creative@tests.invalid",
      }),
    ]);
  });

  it("Add words on a video refuses and queues nothing", async () => {
    readsPost();
    await expect(social.addWords({ postId: POST, index: 1 })).rejects.toThrow(
      /no picture at that place/,
    );
    expect(jobs()).toEqual([]);
  });

  it("Write the captions queues one caption job per post", async () => {
    readsPost();
    await social.writeCaption({ postId: POST });
    expect(jobs()).toEqual([
      expect.objectContaining({
        id: `caption:${POST}`,
        kind: "caption",
        params: {},
      }),
    ]);
  });

  it("Make it move queues motion, never the old 'animate', and not for drawn-in words", async () => {
    readsPost();
    await social.makeItMove({ postId: POST, index: 0 });
    expect(jobs()).toEqual([
      expect.objectContaining({
        id: `motion:${POST}:0`,
        kind: "motion",
        params: { index: 0 },
      }),
    ]);
    calls.length = 0;
    await expect(social.makeItMove({ postId: POST, index: 2 })).rejects.toThrow(
      /drawn into it/,
    );
    expect(jobs()).toEqual([]);
  });

  it("a cover and new words go to Salma per item", async () => {
    readsPost();
    await social.makeCover({ postId: POST, index: 1 });
    await social.setWords({
      postId: POST,
      index: 0,
      words: { headline: "New – words" },
    });
    const media = calls.find(
      c => c.table === "social_posts" && c.op === "update",
    )?.payload.media;
    expect(media[0].words).toEqual({ headline: "New words" });
    expect(jobs().map(j => [j.id, j.kind, j.params])).toEqual([
      [`cover:${POST}:1`, "cover", { index: 1 }],
      [`words:${POST}:0`, "words", { index: 0 }],
    ]);
  });

  it("drawing again has one id per thing asked for", async () => {
    readsPost();
    await social.generatePost({ postId: POST });
    await social.generatePost({ postId: POST, index: 0 });
    await social.generatePost({ postId: POST, add: true });
    const got = jobs();
    expect(got.map(j => j.kind)).toEqual(["generate", "generate", "generate"]);
    expect(got[0].id).toBe(`generate:${POST}`);
    expect(got[1]).toMatchObject({
      id: `generate:${POST}:0`,
      params: { index: 0 },
    });
    expect(got[2].id).toStartWith(`generate:${POST}:add:`);
    expect(got[2].params).toEqual({ add: true });
    await expect(
      social.generatePost({ postId: POST, index: 1 }),
    ).rejects.toThrow(/Only a picture the AI drew/);
  });

  it("Refresh now queues Salma's accounts job", async () => {
    await social.refreshPages({});
    expect(jobs()).toEqual([
      expect.objectContaining({
        id: "accounts",
        kind: "accounts",
        params: {},
        status: "queued",
      }),
    ]);
  });

  it("Fill the month hands Salma the empty days and the pillar for each", async () => {
    reply = c => {
      if (c.table === "social_clients" && c.single)
        return {
          data: {
            client_task_id: "86c1abc",
            posts_per_month: 3,
            pillars: ["Craft", "portfolio"],
          },
        };
      if (c.table === "social_posts" && c.op === "select")
        return {
          data: [{ pillar: "craft", scheduled_at: "2099-01-02T07:00:00Z" }],
        };
      return undefined;
    };
    const out = await social.fillMonth({
      clientTaskId: "86c1abc",
      month: "2099-01",
    });
    expect(out.filling).toBe(2);
    const opened = calls.find(
      c => c.table === "social_batches" && c.op === "upsert",
    );
    expect(opened?.payload).toMatchObject({
      id: "86c1abc:2099-01",
      status: "generating",
    });
    expect(opened?.options).toEqual({
      onConflict: "id",
      ignoreDuplicates: true,
    });
    const [job] = jobs();
    expect(job.kind).toBe("fill");
    expect(job.id).toStartWith("fill:86c1abc:2099-01:");
    expect(job.post_id).toBeNull();
    expect(job.params.slots).toEqual(
      out.days.map((day: string, i: number) => ({
        day,
        pillar: ["portfolio", "craft"][i],
      })),
    );
    expect(out.days).not.toContain("2099-01-02");
  });

  it("Fill the month for a client not set up says so and queues nothing", async () => {
    await expect(
      social.fillMonth({ clientTaskId: "86c1abc", month: "2099-01" }),
    ).rejects.toThrow(/not set up for social media/);
    expect(jobs()).toEqual([]);
  });

  it("adding a post queues its caption, and a Reel's cover", async () => {
    reply = c =>
      c.table === "social_posts" && c.op === "select"
        ? { data: [{ n: 4 }] }
        : undefined;
    const out = await social.addPost({
      clientTaskId: "86c1abc",
      month: "2099-01",
      pillar: "Craft",
      topic: "  Glass  ",
      when: "2099-01-20T07:00:00Z",
      media: [{ kind: "video", url: "https://x.invalid/r.mp4" }],
    });
    expect(out).toMatchObject({
      id: "86c1abc:2099-01:5",
      n: 5,
      generating: false,
      cover: true,
    });
    const made = calls.find(
      c => c.table === "social_posts" && c.op === "insert",
    )?.payload;
    expect(made).toMatchObject({
      pillar: "craft",
      topic: "Glass",
      status: "approved",
      slides: 1,
    });
    expect(made).not.toHaveProperty("month");
    expect(jobs().map(j => j.id)).toEqual([
      "caption:86c1abc:2099-01:5",
      "cover:86c1abc:2099-01:5:0",
    ]);
  });
});

describe("the Pages list says how old it is", () => {
  it("reports the newest time Salma saw a Page, not now", async () => {
    reply = c => {
      if (c.table === "social_meta_pages")
        return {
          data: [
            {
              page_id: "1",
              name: "Qatar Technology",
              ad_clients: [],
              seen_at: "2026-10-01T05:00:00+00:00",
            },
            {
              page_id: "2",
              name: "Other",
              ad_clients: ["86c1abc"],
              seen_at: "2026-10-02T05:00:00+00:00",
            },
          ],
        };
      if (c.table === "social_jobs")
        return { data: { status: "failed", error: "token expired" } };
      return undefined;
    };
    const out = await social.pages({ clientTaskId: "86c1abc" });
    expect(out.refreshedAt).toBe("2026-10-02T05:00:00.000Z");
    expect(out.refreshing).toBe(false);
    expect(out.refreshError).toBe("token expired");
    expect(out.pages.map(p => [p.pageId, p.suggested])).toEqual([
      ["2", "ads"],
      ["1", "name"],
    ]);
  });

  it("says it does not know when there is nothing to go on", async () => {
    reply = c =>
      c.table === "social_jobs" ? { data: { status: "queued" } } : undefined;
    const out = await social.pages({ clientTaskId: "86c1abc" });
    expect(out.refreshedAt).toBeNull();
    expect(out.refreshing).toBe(true);
  });
});

describe("sign-off", () => {
  it("asks the server for the link with the note and every post id", async () => {
    rpcReply = name =>
      name === "cockpit_social_send_signoff"
        ? { data: { token: "tok_1", sent: 2, skipped: 1 } }
        : undefined;
    const out = await social.sendForSignoff({
      clientTaskId: "86c1abc",
      month: "2099-01",
      postIds: ["a", "b", "c"],
      note: "  Have a look  ",
    });
    expect(rpcs.at(-1)).toEqual({
      name: "cockpit_social_send_signoff",
      args: {
        p_client_task_id: "86c1abc",
        p_month: "2099-01",
        p_post_ids: ["a", "b", "c"],
        p_note: "Have a look",
      },
    });
    expect(out).toEqual({ url: `${REVIEW_BASE}/tok_1`, sent: 2, skipped: 1 });
    expect(REVIEW_BASE).toBe("https://cockpit.maharamedia.com/editor/review");
    // The cockpit never moves the batch or marks posts itself.
    expect(calls.filter(c => c.op !== "select")).toEqual([]);
  });

  it("says why when the server refuses, and returns no link", async () => {
    rpcReply = () => ({
      error: { message: "None of those posts is finished yet." },
    });
    await expect(
      social.sendForSignoff({
        clientTaskId: "86c1abc",
        month: "2099-01",
        postIds: ["a"],
      }),
    ).rejects.toThrow("None of those posts is finished yet.");
    rpcReply = () => ({ data: {} });
    await expect(
      social.sendForSignoff({
        clientTaskId: "86c1abc",
        month: "2099-01",
        postIds: ["a"],
      }),
    ).rejects.toThrow(/could not be made/);
  });
});

describe("failures reach the person", () => {
  it("an upload link storage refuses is an error, never the public address", async () => {
    signed = {
      data: null,
      error: { message: "new row violates row-level security policy" },
    };
    await expect(
      social.uploadUrl({
        clientTaskId: "86c1abc",
        filename: "a.jpg",
        contentType: "image/jpeg",
      }),
    ).rejects.toThrow(/Storage would not take the upload/);
    signed = undefined;
    const ok = await social.uploadUrl({
      clientTaskId: "86c1abc",
      filename: "My photo!.jpg",
      contentType: "image/jpeg",
    });
    expect(ok.uploadUrl).toContain("/sign/86c1abc/");
    expect(ok.uploadUrl).not.toBe(ok.publicUrl);
    expect(ok.kind).toBe("image");
    await expect(
      social.uploadUrl({
        clientTaskId: "86c1abc",
        filename: "a.heic",
        contentType: "image/heic",
      }),
    ).rejects.toThrow(/HEIC/);
    await expect(
      social.uploadUrl({
        clientTaskId: "86c1abc",
        filename: "a.pdf",
        contentType: "application/pdf",
      }),
    ).rejects.toThrow(/Only images and videos/);
  });

  it("a refused job says which role is missing", async () => {
    readsPost();
    const base = reply;
    reply = c =>
      c.table === "social_jobs"
        ? {
            error: {
              message:
                'new row violates row-level security policy for table "social_jobs"',
              code: "42501",
            },
          }
        : base(c);
    await expect(social.generatePost({ postId: POST })).rejects.toThrow(
      /creative role/,
    );
    await expect(social.writeCaption({ postId: POST })).rejects.toThrow(
      /creative role/,
    );
  });

  it("linking accounts and planning surface their write errors", async () => {
    reply = c => {
      if (c.table === "social_meta_pages")
        return { data: { page_id: "p1", name: "Page" } };
      if (c.table === "social_clients" && c.op === "upsert")
        return { error: { message: "boom" } };
      return undefined;
    };
    await expect(
      social.linkAccounts({ clientTaskId: "86c1abc", pageId: "p1" }),
    ).rejects.toThrow("boom");
    reply = c => {
      if (c.table === "social_batches")
        return { data: { id: "b", status: "planned" } };
      if (c.table === "social_jobs" && c.op === "upsert")
        return { error: { message: "queue down" } };
      return undefined;
    };
    await expect(
      social.writePlan({ clientTaskId: "86c1abc", month: "2099-01" }),
    ).rejects.toThrow("queue down");
  });

  it("an update or delete that touched nothing is not reported as done", async () => {
    reply = c => {
      if (c.table === "social_posts" && c.op === "select")
        return { data: { id: POST, ghl_post_id: null, status: "approved" } };
      if (c.op === "delete" || c.op === "update") return { data: [] };
      return undefined;
    };
    await expect(social.removePost({ postId: POST })).rejects.toThrow(
      /creative role/,
    );
    await expect(
      social.updatePost({ postId: POST, caption: "x" }),
    ).rejects.toThrow(/creative role/);
    await expect(social.removeFromLibrary({ id: "a1" })).rejects.toThrow(
      /photo is gone/,
    );
  });

  it("a post GoHighLevel holds is not moved from here, and says what to do", async () => {
    reply = c =>
      c.table === "social_posts" && c.op === "select"
        ? { data: { id: POST, ghl_post_id: "g1" } }
        : undefined;
    await expect(
      social.schedulePost({ postId: POST, when: "2099-01-20T07:00:00Z" }),
    ).rejects.toThrow(/not available yet.*GoHighLevel's planner/);
    expect(calls.filter(c => c.op === "update")).toEqual([]);
  });

  it("a signed-out browser writes nothing", async () => {
    session = null;
    await expect(social.refreshPages({})).rejects.toThrow(/signed out/);
    expect(jobs()).toEqual([]);
  });

  it("the roster is keyed by the ClickUp card id", async () => {
    reply = c =>
      c.table === "social_clients"
        ? { data: [{ client_task_id: "86c1abc", active: true }] }
        : undefined;
    const out = await social.roster({});
    expect(out.clients).toEqual([
      expect.objectContaining({
        taskId: "86c1abc",
        name: "Qatar Technology",
        active: true,
      }),
    ]);
    rpcReply = name =>
      name === "cockpit_review_clients"
        ? { error: { message: "Active creative access required" } }
        : undefined;
    await expect(social.roster({})).rejects.toThrow(
      "Active creative access required",
    );
  });

  it("a worker health read that fails is shown, not hidden", async () => {
    reply = c =>
      c.table === "social_worker_status"
        ? {
            error: {
              message: "permission denied for table social_worker_status",
            },
          }
        : undefined;
    const out = await social.batch({
      clientTaskId: "86c1abc",
      month: "2099-01",
    });
    expect(out.health).toEqual([
      expect.objectContaining({
        check: "worker status",
        detail: expect.stringContaining("could not be read"),
      }),
    ]);
  });
});
