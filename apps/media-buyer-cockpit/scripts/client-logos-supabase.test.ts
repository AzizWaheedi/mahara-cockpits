import { afterAll, beforeAll, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { actor, cockpitTestDb, member, migration, owner } from "./lib/cockpitTestDb";

let db: PGlite;
const buyer = "00000000-0000-4000-8000-000000000001";
const stranger = "00000000-0000-4000-8000-000000000002";
const unconfirmed = "00000000-0000-4000-8000-000000000003";
const read = () => db.query<{ client_key: string; storage_path: string }>("SELECT * FROM public.cockpit_get_client_logos()");

beforeAll(async () => {
  db = await cockpitTestDb();
  await db.exec(`CREATE SCHEMA storage;
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE FUNCTION public.cockpit_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;`);
  await db.exec(migration("20261003a_client_logos.sql"));
  await member(db,buyer,"buyer@tests.invalid",["media_buyer"]);
  await member(db,stranger,"stranger@tests.invalid",["sales"]);
  await member(db,unconfirmed,"unconfirmed@tests.invalid",["media_buyer"],true,false);
  await db.query("UPDATE cockpit_members SET clients=$1 WHERE auth_user_id=$2", [["شركة ألفا"],buyer]);
  await db.exec(`INSERT INTO cockpit_client_logos(client_key,clickup_task_id,storage_path,source_url,verified_at,updated_by) VALUES
    ('شركة ألفا','alpha','alpha/logo.png','https://images.tests.invalid/a.png',now(),'service'),
    ('beta','beta','beta/logo.webp','https://images.tests.invalid/b.webp',now(),'service');`);
  await db.exec(migration("20261004a_cockpit_client_logo_reads.sql"));
});

test("scoped buyer receives only their verified logo and keeps Arabic client identity",async () => {
  await actor(db,buyer);
  expect((await read()).rows).toEqual([{client_key:"شركة ألفا",storage_path:"alpha/logo.png"}]);
  await expect(db.query("SELECT * FROM public.cockpit_client_logos")).rejects.toThrow();
});

test("anonymous, wrong-role, unconfirmed and revoked seats cannot read logos",async () => {
  for (const id of [null,stranger,unconfirmed]) {
    await actor(db,id);
    await expect(read()).rejects.toThrow();
  }
  await owner(db);
  await db.query("UPDATE cockpit_members SET active=false WHERE auth_user_id=$1",[buyer]);
  await actor(db,buyer);
  await expect(read()).rejects.toThrow();
});
