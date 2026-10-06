import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { nativeFeedDb } from "../../../scripts/lib/nativeFeedDb";
import { actor, member, migration, owner } from "../../media-buyer-cockpit/scripts/lib/cockpitTestDb";
import { runCheckIn, CheckInAccessError } from "../../../supabase/functions/cockpit-csm-api/checkins.ts";

const NOW = Date.parse("2026-10-03T08:00:00Z");
const LOCATION = "wwG426bwruWWv9W3fazQ";
const CALENDAR = "SHjlq0UjeR11maltYNyh";
const FIELD = "Csj6vsVH3wSRseT3OkMU";
const TASK = "client-task-1";
const CLIENT_NAME = "Example Design";
const SLOT = "2026-10-04T13:00:00+03:00";
const UID = "50000000-0000-4000-8000-000000000001";
const EMAIL = "csm@example.test";
const NEXT_POC_FIELD = "c48c1323-ca6a-465f-84cb-8c24f0f62df3";

let db: Awaited<ReturnType<typeof nativeFeedDb>>;
let clients: ReturnType<typeof createClients>;
let contacts: any[];
let slots: string[];
let posts: any[];
let outcome: "ok" | "timeout" | "refused" | "incomplete";
let clickupCustomFields: Array<{ id: string; value: unknown }>;
let clickupComments: Array<{ id: string; comment_text: string }>;

beforeEach(async () => {
  setSystemTime(NOW);
  db = await nativeFeedDb();
  await db.exec(migration("20261004b_csm_providers.sql"));
  await db.exec(migration("20261005a_client_onboarding.sql"));
  await db.exec(migration("20261006c_csm_onboarding_checkins.sql"));

  await member(db, UID, EMAIL, ["csm"]);
  await db.query("UPDATE cockpit_members SET clients=$1 WHERE auth_user_id=$2", [[CLIENT_NAME], UID]);

  await db.exec(
    "UPDATE cockpit_csm_source_state SET ready=true,row_count=1,source_snapshot_at=now() WHERE table_name='clients';" +
    "INSERT INTO cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) " +
    "SELECT 'clients','source-client-1',ARRAY['" + CLIENT_NAME + "']," +
    "jsonb_build_object('_id','source-client-1','taskId','" + TASK + "','name','" + CLIENT_NAME + "','stage','Active','syncedAt',1728000000000)," +
    "source_snapshot_at FROM cockpit_csm_source_state WHERE table_name='clients';"
  );

  await actor(db, UID);
  clients = createClients(db);

  contacts = [
    {
      id: "contact-1",
      locationId: LOCATION,
      firstName: "Example",
      lastName: "Owner",
      customFields: [{ id: FIELD, value: TASK }],
    },
  ];
  slots = [SLOT];
  posts = [];
  outcome = "ok";
  clickupCustomFields = [];
  clickupComments = [];
});

afterEach(async () => {
  setSystemTime();
  await db.close();
});

function createSyntheticFetch(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(urlStr);
    const method = init?.method ?? "GET";

    if (url.origin === "https://services.leadconnectorhq.com") {
      if (url.pathname === "/contacts/search") {
        return new Response(JSON.stringify({ contacts, total: contacts.length }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.pathname === `/calendars/${CALENDAR}`) {
        return new Response(
          JSON.stringify({
            calendar: {
              id: CALENDAR,
              locationId: LOCATION,
              name: "Client check-in",
              isActive: true,
              slotDuration: 30,
              slotDurationUnit: "mins",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.pathname.endsWith("/free-slots")) {
        return new Response(
          JSON.stringify({ "2026-10-04": { slots } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.pathname === "/calendars/events/appointments") {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        posts.push(body);
        if (outcome === "timeout") throw new Error("socket closed after send");
        if (outcome === "refused") {
          return new Response(JSON.stringify({ message: "busy" }), {
            status: 409,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (outcome === "incomplete") {
          return new Response(JSON.stringify({ id: "appointment-1" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({
            id: "appointment-1",
            contactId: body.contactId,
            calendarId: body.calendarId,
            locationId: body.locationId,
            startTime: body.startTime,
            endTime: body.endTime,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
    }

    if (url.origin === "https://api.clickup.com") {
      if (method === "POST" && url.pathname.includes(`/task/${TASK}/field/`)) {
        const fieldId = url.pathname.split("/").pop()!;
        const body = init?.body ? JSON.parse(init.body as string) : {};
        clickupCustomFields = clickupCustomFields.filter(f => f.id !== fieldId);
        clickupCustomFields.push({ id: fieldId, value: body.value });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (method === "GET" && url.pathname === `/api/v2/task/${TASK}`) {
        return new Response(
          JSON.stringify({
            id: TASK,
            custom_fields: clickupCustomFields,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (method === "POST" && url.pathname === `/api/v2/task/${TASK}/comment`) {
        const commentBody = init?.body ? JSON.parse(init.body as string) : {};
        const commentId = `comment-${clickupComments.length + 1}`;
        clickupComments.push({ id: commentId, comment_text: commentBody.comment_text });
        return new Response(
          JSON.stringify({ id: commentId, comment_text: commentBody.comment_text }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (method === "GET" && url.pathname === `/api/v2/task/${TASK}/comment`) {
        return new Response(
          JSON.stringify({ comments: clickupComments }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
    }

    throw new Error(`Unexpected provider request: ${method} ${url.pathname}`);
  }) as typeof fetch;
}

function createClients(database: typeof db) {
  let queue = Promise.resolve();
  const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.then(() => {}, () => {});
    return next;
  };

  const rpc = (name: string, args: Record<string, unknown>, role: "authenticated" | "service_role") =>
    serialized(async () => {
      await database.exec(`SET ROLE ${role};`);
      const keys = Object.keys(args);
      const sql = `SELECT ${name}(${keys.map((k, i) => `${k}=>$${i + 1}`).join(",")}) as value`;
      try {
        const res = await database.query<{ value: unknown }>(sql, Object.values(args));
        return { data: res.rows[0]?.value, error: null };
      } catch (err: any) {
        return { data: null, error: { message: err?.message ?? String(err) } };
      }
    });

  const client = {
    rpc: (name: string, args: Record<string, unknown>) => rpc(name, args, "authenticated"),
  };

  const admin = {
    rpc: (name: string, args: Record<string, unknown>) => rpc(name, args, "service_role"),
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) =>
        serialized(async () => {
          await database.exec("SET ROLE service_role;");
          const cols = Object.keys(row);
          const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
          const sql = `INSERT INTO ${table}(${cols.join(",")}) VALUES(${placeholders}) RETURNING *`;
          try {
            const res = await database.query(sql, Object.values(row));
            return { data: res.rows, error: null };
          } catch (err: any) {
            return { data: null, error: { message: err?.message ?? String(err) } };
          }
        }),
      update: (patch: Record<string, unknown>) => ({
        eq: (col1: string, val1: unknown) => ({
          eq: (col2: string, val2: unknown) =>
            serialized(async () => {
              await database.exec("SET ROLE service_role;");
              const keys = Object.keys(patch);
              const setClause = keys.map((k, i) => `${k}=$${i + 1}`).join(",");
              const sql = `UPDATE ${table} SET ${setClause} WHERE ${col1}=$${keys.length + 1} AND ${col2}=$${keys.length + 2} RETURNING *`;
              try {
                const res = await database.query(sql, [...Object.values(patch), val1, val2]);
                return { data: res.rows, error: null };
              } catch (err: any) {
                return { data: null, error: { message: err?.message ?? String(err) } };
              }
            }),
        }),
      }),
    }),
  };

  return { client, admin };
}

const envLookup = (name: string) => {
  if (name === "GHL_MAHARA_LOCATION") return LOCATION;
  if (name === "GHL_MAHARA_PIT") return "synthetic-pit";
  if (name === "CLICKUP_API_TOKEN") return "synthetic-clickup-token";
  return undefined;
};

const prepare = (reqId = crypto.randomUUID()) => {
  const { client, admin } = clients;
  return runCheckIn(
    client,
    admin,
    {
      operation: "checkIns.prepare",
      args: { taskId: TASK, day: "2026-10-04" },
      requestId: reqId,
    },
    envLookup,
    createSyntheticFetch(),
  );
};

const book = (reqId = crypto.randomUUID(), overrideArgs?: Partial<{ taskId: string; contactId: string; startTime: string }>) => {
  const { client, admin } = clients;
  return runCheckIn(
    client,
    admin,
    {
      operation: "checkIns.book",
      args: {
        taskId: TASK,
        contactId: "contact-1",
        startTime: SLOT,
        ...overrideArgs,
      },
      apply: true,
      requestId: reqId,
    },
    envLookup,
    createSyntheticFetch(),
  );
};

describe("check-in contact and availability", () => {
  test("finds the exact Client ID and works with no renewal date", async () => {
    const ready = (await prepare()) as any;
    expect(ready.contact).toEqual({ id: "contact-1", name: "Example Owner" });
    expect(ready.slots).toEqual([SLOT]);
    expect(posts).toHaveLength(0);
  });

  test("missing and duplicate contacts cannot be booked", async () => {
    contacts = [];
    await expect(prepare()).rejects.toThrow();
    contacts = [
      { id: "a", locationId: LOCATION },
      { id: "b", locationId: LOCATION },
    ];
    await expect(book()).rejects.toThrow();
    expect(posts).toHaveLength(0);
  });

  test("ignoring the ID filter or returning another location cannot book", async () => {
    contacts[0].customFields[0].value = "another-client";
    await expect(book()).rejects.toThrow();
    contacts[0].customFields[0].value = TASK;
    contacts[0].locationId = "other-account";
    await expect(book()).rejects.toThrow();
    expect(posts).toHaveLength(0);
  });

  test("does not expose contact information without client access", async () => {
    const unauthedClient = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        await db.exec("SET ROLE anon;");
        try {
          const res = await db.query<{ value: unknown }>(`SELECT ${name}($1) as value`, [args.p_task_id]);
          return { data: res.rows[0]?.value, error: null };
        } catch (err: any) {
          return { data: null, error: { message: err?.message ?? String(err) } };
        }
      },
    };
    const { admin } = createClients(db);
    await expect(
      runCheckIn(
        unauthedClient,
        admin,
        { operation: "checkIns.prepare", args: { taskId: TASK, day: "2026-10-04" }, requestId: crypto.randomUUID() },
        envLookup,
        createSyntheticFetch(),
      ),
    ).rejects.toThrow(CheckInAccessError);

    await owner(db);
    await db.query("UPDATE cockpit_members SET clients=$1 WHERE auth_user_id=$2", [["Different Client"], UID]);
    await actor(db, UID);
    await expect(prepare()).rejects.toThrow(CheckInAccessError);
  });

  test("revoked CSM access cannot book", async () => {
    await owner(db);
    await db.query("UPDATE cockpit_members SET active=false WHERE auth_user_id=$1", [UID]);
    await actor(db, UID);
    await expect(book()).rejects.toThrow(CheckInAccessError);
    expect(posts).toHaveLength(0);
  });

  test("empty availability and stale selected time do not create appointments", async () => {
    slots = [];
    expect(((await prepare()) as any).slots).toEqual([]);
    await expect(book()).rejects.toThrow();
    expect(posts).toHaveLength(0);
  });

  test("invalid dates and changed contacts fail before a write", async () => {
    const { client, admin } = createClients(db);
    await expect(
      runCheckIn(
        client,
        admin,
        {
          operation: "checkIns.prepare",
          args: { taskId: TASK, day: "2026-02-31" },
          requestId: crypto.randomUUID(),
        },
        envLookup,
        createSyntheticFetch(),
      ),
    ).rejects.toThrow();
    contacts[0].id = "contact-changed";
    await expect(book()).rejects.toThrow();
    expect(posts).toHaveLength(0);
  });
});

describe("confirmed booking, receipts and retry protection", () => {
  test("records the provider receipt and next call after confirmed provider updates", async () => {
    const booked = (await book()) as any;
    expect(booked).toEqual({
      appointmentId: "appointment-1",
      startTime: "2026-10-04T10:00:00.000Z",
      endTime: "2026-10-04T10:30:00.000Z",
    });
    expect(posts).toHaveLength(1);
    expect(posts[0].contactId).toBe("contact-1");
    expect(posts[0].calendarId).toBe(CALENDAR);
    expect(posts[0].locationId).toBe(LOCATION);

    await owner(db);
    const actions = (await db.query<{ state: string; result: any }>("SELECT state, result FROM cockpit_csm_actions WHERE operation='checkIns.book'")).rows;
    expect(actions).toHaveLength(1);
    expect(actions[0].state).toBe("confirmed");
    expect(actions[0].result.appointmentId).toBe("appointment-1");

    const overrides = (await db.query<{ data: any }>("SELECT data FROM cockpit_csm_client_overrides WHERE task_id=$1", [TASK])).rows;
    expect(overrides).toHaveLength(1);
    expect(overrides[0].data.nextCallAt).toBe("2026-10-04T10:00:00.000Z");
    expect(overrides[0].data.nextPoc).toBe("2026-10-04");

    const fieldUpdate = clickupCustomFields.find(f => f.id === NEXT_POC_FIELD);
    expect(fieldUpdate?.value).toBe(Date.parse("2026-10-04T09:00:00+03:00"));
    expect(clickupComments).toHaveLength(1);
  });

  test("concurrent clicks and repeated requests create only one appointment", async () => {
    const firstReqId = crypto.randomUUID();
    const secondReqId = crypto.randomUUID();
    await Promise.allSettled([book(firstReqId), book(secondReqId)]);
    slots = [];
    await book(firstReqId);
    expect(posts).toHaveLength(1);

    await owner(db);
    const countRes = await db.query<{ count: number }>("SELECT count(*)::int as count FROM cockpit_csm_actions WHERE operation='checkIns.book' AND state='confirmed'");
    expect(countRes.rows[0].count).toBe(1);
  });

  test("a timeout keeps an unknown receipt and blocks automatic retry", async () => {
    outcome = "timeout";
    const reqId = crypto.randomUUID();
    await expect(book(reqId)).rejects.toThrow();
    outcome = "ok";
    await expect(book(reqId)).rejects.toThrow();
    expect(posts).toHaveLength(1);

    await owner(db);
    const action = (await db.query<{ state: string }>("SELECT state FROM cockpit_csm_actions WHERE id=$1", [reqId])).rows[0];
    expect(action.state).toBe("reconcile");
  });

  test("an incomplete provider response cannot report success or retry", async () => {
    outcome = "incomplete";
    const reqId = crypto.randomUUID();
    await expect(book(reqId)).rejects.toThrow();
    await expect(book(reqId)).rejects.toThrow();
    expect(posts).toHaveLength(1);

    await owner(db);
    const overrides = (await db.query<{ count: number }>("SELECT count(*)::int as count FROM cockpit_csm_client_overrides WHERE task_id=$1", [TASK])).rows[0];
    expect(overrides.count).toBe(0);
  });

  test("a definitive provider refusal allows no second booking and retains reconcile state", async () => {
    outcome = "refused";
    const reqId = crypto.randomUUID();
    await expect(book(reqId)).rejects.toThrow();

    outcome = "ok";
    await expect(book(reqId)).rejects.toThrow();
    expect(posts).toHaveLength(1);

    await owner(db);
    const action = (await db.query<{ state: string }>("SELECT state FROM cockpit_csm_actions WHERE id=$1", [reqId])).rows[0];
    expect(action.state).toBe("reconcile");
  });

  test("a later booking preserves an earlier upcoming call", async () => {
    await owner(db);
    const actionId = crypto.randomUUID();
    await db.query(
      "INSERT INTO cockpit_csm_actions(id,operation,actor_id,actor_email,context,request,state) " +
      "VALUES($1,'act',$2,$3,$4,$5,'confirmed')",
      [
        actionId,
        UID,
        EMAIL,
        JSON.stringify({ taskId: TASK, clientName: CLIENT_NAME }),
        JSON.stringify({ action: "prior call" }),
      ]
    );
    await db.query(
      "INSERT INTO cockpit_csm_client_overrides(task_id,client_name,data,action_id) " +
      "VALUES($1,$2,$3,$4)",
      [
        TASK,
        CLIENT_NAME,
        JSON.stringify({
          nextCallAt: "2026-10-04T08:00:00.000Z",
          nextPoc: "2026-10-04",
        }),
        actionId,
      ]
    );
    await actor(db, UID);

    await book();

    await owner(db);
    const override = (await db.query<{ data: any }>("SELECT data FROM cockpit_csm_client_overrides WHERE task_id=$1", [TASK])).rows[0];
    expect(override.data.nextCallAt).toBe("2026-10-04T08:00:00.000Z");
  });
});
