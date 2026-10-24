import { afterAll, beforeAll, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
  actor,
  BUYER,
  database,
  OTHER,
  owner,
  sdk,
} from "../../../hermes/media-native/test/database";
import { MediaNativeWorker } from "../../../hermes/media-native/worker";
import { migration } from "./lib/cockpitTestDb";

let db: Awaited<ReturnType<typeof database>>;
const file = "20261024131543_launch_creative_imports.sql";
const links = ["https://drive.google.com/file/d/abcdefghijklmnop/view"];
function table(file: string, name: string) {
  return migration(file).match(
    new RegExp(
      `CREATE TABLE(?: IF NOT EXISTS)? public\\.${name} \\([\\s\\S]*?\\n\\);`,
    ),
  )![0];
}
async function enqueue(
  id = crypto.randomUUID(),
  who = BUYER,
  account = "111111",
  files = links,
) {
  await owner(db);
  await db.exec("SET ROLE service_role");
  return (
    await db.query<any>(
      "select cockpit_launch_import_enqueue($1,'alpha',$2,$3,$4) r",
      [who, account, JSON.stringify(files), id],
    )
  ).rows[0].r;
}
beforeAll(async () => {
  db = await database();
  for (const [f, n] of [
    ["20261016111157_board_facts.sql", "cockpit_board_clients"],
    ["20261016210000_board_facts_checked.sql", "cockpit_board_account_ties"],
    ["20261017100000_meta_budgets.sql", "cockpit_meta_account_state"],
  ])
    await db.exec(table(f, n));
  const source = migration("20261024b_media_launch_desk.sql");
  await db.exec(
    source.match(
      /CREATE OR REPLACE FUNCTION public.cockpit_launch_accounts[\s\S]*?\$\$;/,
    )![0],
  );
  await db.exec(migration(file));
  await db.exec(migration(file));
  await db.exec(
    "INSERT INTO cockpit_board_clients(location_id,clickup_id,client_name,status,service_mode,ad_account_ids) VALUES('alpha','alpha','Alpha','Active','DFY',ARRAY['111111','222222']),('beta','beta','Beta','Active','DFY',ARRAY['333333']);",
  );
}, 30000);
afterAll(async () => db?.close());
test("only the server can enqueue; the client can only read its allowed imports", async () => {
  for (const role of ["anon", "authenticated"])
    expect(
      (
        await db.query<any>(
          "select has_function_privilege($1,'cockpit_launch_import_enqueue(uuid,text,text,jsonb,uuid)','EXECUTE') ok",
          [role],
        )
      ).rows[0].ok,
    ).toBe(false);
  await expect(enqueue(crypto.randomUUID(), OTHER)).rejects.toThrow();
  await expect(enqueue(crypto.randomUUID(), BUYER, "333333")).rejects.toThrow();
  await expect(
    enqueue(crypto.randomUUID(), BUYER, "111111", ["https://evil.test/file"]),
  ).rejects.toThrow();
});
test("duplicate requests and teammates reuse one job; conflicting request ids are refused", async () => {
  const first = await enqueue();
  const second = await enqueue();
  expect(second.id).toBe(first.id);
  expect(second.reused).toBe(true);
  await expect(enqueue(first.id, BUYER, "222222")).rejects.toThrow();
  await actor(db, BUYER);
  const rows = (
    await db.query<any>("select cockpit_launch_imports('alpha','111111') r")
  ).rows[0].r;
  expect(rows).toHaveLength(1);
  await actor(db, OTHER);
  await expect(
    db.query("select cockpit_launch_imports('alpha','111111')"),
  ).rejects.toThrow();
  await owner(db);
});
test("the real worker uploads only to the selected verified account and saves its receipt", async () => {
  const names = ["GOOGLE_SERVICE_ACCOUNT_JSON", "META_SYSTEM_TOKEN"];
  const prior = Object.fromEntries(names.map(k => [k, process.env[k]]));
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: "claude@studied-handler-508106-m5.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    token_uri: "https://oauth2.googleapis.com/token",
  });
  process.env.META_SYSTEM_TOKEN = "offline-token";
  const writes: string[] = [];
  try {
    const result = await new MediaNativeWorker({
      apply: true,
      once: true,
      supabaseClient: sdk(db),
      fetchImpl: async (input, init) => {
        const u = new URL(String(input));
        if (init?.method === "POST") writes.push(u.pathname);
        if (u.hostname === "oauth2.googleapis.com")
          return Response.json({
            access_token: "offline-google",
            token_type: "Bearer",
          });
        if (u.hostname === "www.googleapis.com" && !u.searchParams.has("alt"))
          return Response.json({
            id: "abcdefghijklmnop",
            name: "Approved.jpg",
            mimeType: "image/jpeg",
            size: "3",
          });
        if (u.hostname === "www.googleapis.com")
          return new Response(new Uint8Array([1, 2, 3]));
        if (u.pathname === "/v21.0/act_111111/adimages")
          return Response.json({ images: { file: { hash: "verified-hash" } } });
        throw Error(`Unexpected provider ${u.pathname}`);
      },
    }).run();
    expect(result.errors).toEqual([]);
    expect(result.processed).toBe(1);
    expect(writes.filter(x => x.includes("/act_"))).toEqual([
      "/v21.0/act_111111/adimages",
    ]);
    await owner(db);
    const saved = (
      await db.query<any>(
        "select data from cockpit_media_native_records where data->>'launchImport'='true'",
      )
    ).rows[0].data;
    expect(saved.status).toBe("ready");
    expect(saved.media[0].imageHash).toBe("verified-hash");
  } finally {
    for (const key of names) {
      if (prior[key] === undefined) delete process.env[key];
      else process.env[key] = prior[key];
    }
  }
});
test("revoking an account after queueing blocks all provider work", async () => {
  await enqueue(crypto.randomUUID(), BUYER, "222222");
  await owner(db);
  await db.exec(
    "UPDATE cockpit_board_clients SET ad_account_ids=ARRAY['111111'] WHERE clickup_id='alpha'",
  );
  let calls = 0;
  const result = await new MediaNativeWorker({
    apply: true,
    once: true,
    supabaseClient: sdk(db),
    fetchImpl: async () => {
      calls++;
      throw Error("No request permitted");
    },
  }).run();
  expect(calls).toBe(0);
  expect(result.errors.length).toBeGreaterThan(0);
});
