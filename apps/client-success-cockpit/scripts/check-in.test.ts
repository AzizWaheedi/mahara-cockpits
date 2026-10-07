import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { nativeFeedDb } from "../../../scripts/lib/nativeFeedDb";
import { actor, member, migration, owner } from "../../media-buyer-cockpit/scripts/lib/cockpitTestDb";
import { runCheckIn, CheckInAccessError } from "../../../supabase/functions/cockpit-csm-api/checkins.ts";
import { prepareCsm, executeCsm } from "../../../supabase/functions/cockpit-csm-api/core.ts";
import { providerTools } from "../../../supabase/functions/cockpit-csm-api/tools.ts";
import { buildCsmReadModel } from "../src/lib/csmReadModel";

const NOW = Date.parse("2026-10-03T08:00:00Z");
const LOCATION = "wwG426bwruWWv9W3fazQ";
const CALENDAR = "SHjlq0UjeR11maltYNyh";
/** The four calls' calendars and lengths, as the client account has them. */
const CALENDARS: Record<string, { name: string; minutes: number }> = {
  z1Ne59rohCCj87KhcXoi: { name: "Onboarding Call", minutes: 60 },
  x84ET6KnA8odlsjYiVLq: { name: "Brand Blueprint Call", minutes: 45 },
  "5E1EVxLJbGiDM3iYl2kL": { name: "Launch Call", minutes: 30 },
  SHjlq0UjeR11maltYNyh: { name: "Client check-in", minutes: 30 },
};
const FIELD = "Csj6vsVH3wSRseT3OkMU";
const TASK = "client-task-1";
const CLIENT_NAME = "Example Design";
const SLOT = "2026-10-04T13:00:00+03:00";
const UID = "50000000-0000-4000-8000-000000000001";
const EMAIL = "csm@example.test";
const NEXT_POC_FIELD = "c48c1323-ca6a-465f-84cb-8c24f0f62df3";
const STATUS_FIELD = "9368ca9e-3549-4320-84ff-9abd0a2901cb";
const STAGE_OPTIONS = ["Needs Contacting","Onboarding Booked","Brand Blueprint Booked\u2660\ufe0f","LAUNCH BOOKED","Active"].map((name,orderindex)=>({id:`stage-${orderindex}`,name,orderindex}));

let db: Awaited<ReturnType<typeof nativeFeedDb>>;
let clients: ReturnType<typeof createClients>;
let contacts: any[];
let slots: string[];
let posts: any[];
let outcome: "ok" | "timeout" | "refused" | "incomplete";
let clickupCustomFields: Array<{ id: string; value: unknown }>;
let clickupComments: Array<{ id: string; comment_text: string }>;
let clickupStage: string;
let stageWrites: string[];

beforeEach(async () => {
  setSystemTime(NOW);
  db = await nativeFeedDb();
  await db.exec(migration("20261004b_csm_providers.sql"));
  await db.exec(migration("20261005a_client_onboarding.sql"));
  await db.exec(migration("20261006c_csm_onboarding_checkins.sql"));
  await db.exec(migration("20261007a_csm_call_kinds.sql"));

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
  clickupStage = "Active";
  stageWrites = [];
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
      const calendar = /^\/calendars\/([^/]+)$/.exec(url.pathname)?.[1];
      if (calendar && calendar in CALENDARS) {
        return new Response(
          JSON.stringify({
            calendar: {
              id: calendar,
              locationId: LOCATION,
              name: CALENDARS[calendar].name,
              isActive: true,
              slotDuration: CALENDARS[calendar].minutes,
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
            id: `appointment-${posts.length}`,
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
      if (method === "GET" && url.pathname === "/api/v2/list/901816559981/field") {
        return new Response(JSON.stringify({fields:[{id:STATUS_FIELD,name:"Client status",type_config:{options:STAGE_OPTIONS}}]}),{status:200});
      }
      if (method === "POST" && url.pathname.includes(`/task/${TASK}/field/`)) {
        const fieldId = url.pathname.split("/").pop()!;
        const body = init?.body ? JSON.parse(init.body as string) : {};
        if (fieldId === STATUS_FIELD) {
          const option = STAGE_OPTIONS.find(o => o.id === body.value);
          if (!option) throw new Error("Unknown stage option");
          clickupStage = option.name;
          stageWrites.push(clickupStage);
          return new Response(JSON.stringify({ok:true}),{status:200});
        }
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
            custom_fields: [
              ...clickupCustomFields,
              {id:STATUS_FIELD,value:STAGE_OPTIONS.find(o=>o.name===clickupStage)?.orderindex,type_config:{options:STAGE_OPTIONS}},
            ],
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

const book = (reqId = crypto.randomUUID(), overrideArgs?: Partial<{ taskId: string; contactId: string; startTime: string; kind: string }>) => {
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
    const ready = await prepare();
    expect(ready).toHaveProperty("contact");
    if (!("contact" in ready) || !("slots" in ready)) throw new Error("Expected prepared booking");
    expect(ready.contact).toEqual({
      id: "contact-1",
      name: "Example Owner",
      phone: null,
      email: null,
      url: `https://app.maharamedia.com/v2/location/${LOCATION}/contacts/detail/contact-1`,
    });
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

const bookKind = (kind: string, startTime = SLOT) => book(crypto.randomUUID(), {kind, startTime});
async function setStage(stage: string) {
  clickupStage = stage;
  await owner(db);
  await db.query("UPDATE cockpit_csm_sources SET data=jsonb_set(data,'{stage}',to_jsonb($1::text)) WHERE table_name='clients'", [stage]);
  await db.query("UPDATE cockpit_csm_client_overrides SET data=jsonb_set(data,'{stage}',to_jsonb($1::text)) WHERE task_id=$2", [stage,TASK]);
  await actor(db, UID);
}

describe("every call type (2026-10-06)", () => {
  test("each call books on its own calendar, length and title", async () => {
    const want = {
      onboarding: [
        "z1Ne59rohCCj87KhcXoi",
        "2026-10-04T11:00:00.000Z",
        "Onboarding call",
      ],
      blueprint: [
        "x84ET6KnA8odlsjYiVLq",
        "2026-10-04T10:45:00.000Z",
        "Brand Blueprint call",
      ],
      launch: [
        "5E1EVxLJbGiDM3iYl2kL",
        "2026-10-04T10:30:00.000Z",
        "Launch call",
      ],
    } as const;
    for (const [kind, [calendarId, endTime, label]] of Object.entries(want)) {
      await bookKind(kind);
      expect(posts.at(-1)).toMatchObject({
        calendarId,
        endTime,
        title: `Example Design | ${label}`,
        contactId: "contact-1",
        locationId: LOCATION,
      });
    }
    await owner(db);
    const appointments = (await db.query<{kind:string}>("SELECT request->>'kind' AS kind FROM cockpit_csm_actions WHERE operation='checkIns.book' AND state='confirmed'")).rows;
    expect(appointments.map(a => a.kind).sort()).toEqual([
      "blueprint",
      "launch",
      "onboarding",
    ]);
  });

  test("a receipt belongs to its call: a Blueprint and a check-in at the same time do not collide", async () => {
    await book();
    await bookKind("blueprint");
    expect(posts).toHaveLength(2);
    await owner(db);
    const bookings = (await db.query<{request:{kind?:string;startTime:string}}>("SELECT request FROM cockpit_csm_actions WHERE operation='checkIns.book' AND state='confirmed'")).rows;
    expect(bookings).toHaveLength(2);
    expect(bookings.map(b => b.request.kind ?? "checkin").sort()).toEqual(["blueprint","checkin"]);
    expect(bookings.every(b => b.request.startTime === "2026-10-04T10:00:00.000Z")).toBe(true);
  });

  test("a booking moves the board forward, never back", async () => {
    await setStage("Needs Contacting");
    const first = await bookKind("onboarding");
    expect(first).toHaveProperty("stage", "Onboarding Booked");
    await owner(db);
    const state = (await db.query<{data:{stage:string}}>("SELECT data FROM cockpit_csm_client_overrides WHERE task_id=$1", [TASK])).rows[0];
    expect(state.data.stage).toBe("Onboarding Booked");
    expect(stageWrites).toEqual(["Onboarding Booked"]);

    // An onboarding call booked again later does not pull a Blueprint client back.
    await setStage("Brand Blueprint Booked\u2660\ufe0f");
    slots = ["2026-10-04T15:00:00+03:00"];
    const again = await bookKind("onboarding", "2026-10-04T15:00:00+03:00");
    expect(again).not.toHaveProperty("stage");
    await owner(db);
    const updated = (await db.query<{data:{stage:string}}>("SELECT data FROM cockpit_csm_client_overrides WHERE task_id=$1", [TASK])).rows[0];
    expect(updated.data.stage).toBe("Brand Blueprint Booked\u2660\ufe0f");
    expect(stageWrites).toEqual(["Onboarding Booked"]);
  });

  test("a check-in never moves the board, and a live client stays live", async () => {
    await book();
    await setStage("Active");
    slots = ["2026-10-04T16:00:00+03:00"];
    const r = await bookKind("launch", "2026-10-04T16:00:00+03:00");
    expect(r).not.toHaveProperty("stage");
    expect(stageWrites).toHaveLength(0);
  });

  test("the main contact is read for the client, inside the CSM's scope only", async () => {
    // HighLevel's contactName is lower case; the name fields win.
    contacts[0].contactName = "example owner";
    contacts[0].phone = "+96550000000";
    contacts[0].email = "owner@example.test";
    const c = await runCheckIn(clients.client, clients.admin, {operation:"checkIns.contact",args:{taskId:TASK},requestId:crypto.randomUUID()}, envLookup, createSyntheticFetch());
    expect(c).toMatchObject({
      id: "contact-1",
      name: "Example Owner",
      phone: "+96550000000",
      email: "owner@example.test",
    });
    await owner(db);
    await db.query("UPDATE cockpit_members SET clients=$1 WHERE auth_user_id=$2", [["Different Client"],UID]);
    await actor(db, UID);
    let providerCalls = 0;
    const deniedFetch: typeof fetch = async () => { providerCalls++; throw new Error("A denied read must not reach the provider"); };
    await expect(runCheckIn(clients.client, clients.admin, {operation:"checkIns.contact",args:{taskId:TASK},requestId:crypto.randomUUID()}, envLookup, deniedFetch)).rejects.toThrow(CheckInAccessError);
    expect(providerCalls).toBe(0);
  });

  test("an unknown call cannot be booked", async () => {
    await expect(bookKind("strategy")).rejects.toThrow();
    expect(posts).toHaveLength(0);
  });
});

describe("native call identity and source safeguards", () => {
  test("a request cannot be reused with another contact, time, or kind", async () => {
    const requestId = crypto.randomUUID();
    await book(requestId);
    for (const changed of [
      {contactId:"different-contact"},
      {startTime:"2026-10-04T14:00:00+03:00"},
      {kind:"blueprint"},
    ]) await expect(book(requestId,changed)).rejects.toThrow();
    await expect(book(crypto.randomUUID(),{contactId:"different-contact"})).rejects.toThrow();
    expect(posts).toHaveLength(1);
  });

  test("a source-only earlier call survives while the confirmed stage advances", async () => {
    await setStage("Needs Contacting");
    await owner(db);
    await db.query("UPDATE cockpit_csm_sources SET data=data||$1::jsonb WHERE table_name='clients'", [JSON.stringify({nextCallAt:"2026-10-04T08:00:00.000Z",nextPoc:"2026-10-04"})]);
    await actor(db,UID);
    const result = await bookKind("onboarding");
    expect(result).toHaveProperty("stage","Onboarding Booked");
    await owner(db);
    const source = (await db.query<{data:Record<string,unknown>}>("SELECT data FROM cockpit_csm_sources WHERE table_name='clients'")).rows[0].data;
    const overrides = (await db.query<{task_id:string;data:Record<string,unknown>;confirmed_at:string}>("SELECT task_id,data,confirmed_at FROM cockpit_csm_client_overrides WHERE task_id=$1",[TASK])).rows;
    const model = buildCsmReadModel({
      source: {},
      tables: {clients:[{...source,rank:1,hot:[],loose:[]}],clientOverrides:overrides,clientProfiles:[],decisions:[],appointments:[],syncRuns:[],rosterDays:[],churnEvents:[],kpi:[],csTasks:[]},
    },{day:"2026-10-03",month:"2026-10",profiles:[],prefs:[],hotRows:[],dismissed:[],money:null},
    {checks:[],decisions:[],plan:[],eod:null,eodOwner:EMAIL,eodDay:"2026-10-03"});
    expect(model.clients[0].nextCallAt).toBe("2026-10-04T08:00:00.000Z");
    expect(model.clients[0].stage).toBe("Onboarding Booked");
  });

  test("a provider stage ahead of the snapshot is never moved back", async () => {
    await setStage("Needs Contacting");
    clickupStage = "Brand Blueprint Booked\u2660\ufe0f";
    const result = await bookKind("onboarding");
    expect(result).not.toHaveProperty("stage");
    expect(stageWrites).toHaveLength(0);
    expect(clickupStage).toBe("Brand Blueprint Booked\u2660\ufe0f");
  });

  for (const first of ["projection","checkin"] as const) {
    test(`${first} receipt blocks the same instant through the other booking path`, async () => {
      const legacyId = crypto.randomUUID();
      const insertProjection = async () => {
        await owner(db);
        return db.query(
          "INSERT INTO cockpit_csm_actions(id,operation,actor_id,actor_email,context,request,state) VALUES($1,'projections.bookCall',$2,$3,$4,$5,'confirmed')",
          [legacyId,UID,EMAIL,JSON.stringify({taskId:TASK,clientName:CLIENT_NAME,bookingWhen:SLOT}),JSON.stringify({taskId:TASK,when:SLOT})],
        );
      };
      if (first === "projection") {
        await insertProjection();
        await actor(db,UID);
        await expect(book()).rejects.toThrow();
        expect(posts).toHaveLength(0);
      } else {
        await book();
        await expect(insertProjection()).rejects.toThrow();
        expect(posts).toHaveLength(1);
      }
      await owner(db);
      const count = (await db.query<{n:number}>("SELECT count(*)::int AS n FROM cockpit_csm_actions WHERE operation IN ('checkIns.book','projections.bookCall')")).rows[0];
      expect(count.n).toBe(1);
    });
  }
});

test("closing a commitment is authorized and writes only its comment, never a contact date", async () => {
  const args = {taskId:TASK,kind:"commitment",action:"Commitment handled: Review the launch brief",note:"1-1 call notes"};
  const context = await clients.client.rpc("cockpit_csm_action_context",{p_operation:"act",p_args:args});
  expect(context.error).toBeNull();
  const provider = providerTools("synthetic-clickup-token",async () => {},createSyntheticFetch());
  const plan = await prepareCsm("act",args,context.data as Record<string,unknown>,provider);
  expect(plan.updates).toEqual([]);
  expect(plan.patch).toEqual({});
  const result = await executeCsm(plan,provider);
  expect(result.result.ok).toBe(true);
  expect(clickupCustomFields).toHaveLength(0);
  expect(clickupComments).toHaveLength(1);
  expect(clickupComments[0].comment_text).toContain(args.action);
  expect(result.patch).not.toHaveProperty("lastPoc");
  expect(result.patch).not.toHaveProperty("lastCall");
});

for (const operation of ["checkIns.contact", "checkIns.prepare"] as const) {
  for (const change of ["revoke", "source"] as const) {
    test(`${operation} refuses the response when ${change} changes after the provider answers`, async () => {
      const provider = createSyntheticFetch();
      let changed = false;
      const request: typeof fetch = async (input, init) => {
        const response = await provider(input, init);
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!changed && (operation === "checkIns.contact" ? url.endsWith("/contacts/search") : url.includes("/free-slots"))) {
          changed = true;
          await owner(db);
          if (change === "revoke") await db.query("UPDATE cockpit_members SET active=false WHERE auth_user_id=$1",[UID]);
          else await db.exec("UPDATE cockpit_csm_sources SET source_snapshot_at=source_snapshot_at+interval '1 second' WHERE table_name='clients'; UPDATE cockpit_csm_source_state SET source_snapshot_at=source_snapshot_at+interval '1 second' WHERE table_name='clients'");
          await actor(db,UID);
        }
        return response;
      };
      await expect(runCheckIn(clients.client,clients.admin,{
        operation,args:{taskId:TASK,...(operation==="checkIns.prepare"?{day:"2026-10-04"}:{})},requestId:crypto.randomUUID(),
      },envLookup,request)).rejects.toThrow(CheckInAccessError);
      expect(changed).toBe(true);
      expect(posts).toHaveLength(0);
    });
  }
}
