import { expect, mock, test } from "bun:test";

let user: any;
let member: any;
let authError: Error | null = null;
const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({data:member,error:null}) };
mock.module("../src/lib/supabase", () => ({IDEA_STILLS_BUCKET:"fixture-stills",supabase:{
  auth:{getUser:async () => ({data:{user},error:authError})},
  from:() => query,
}}));
const { api } = await import("../src/lib/cockpitApi");

test("action and query references stay stable without thenable behavior", async () => {
  expect(api.ceo.goals.board).toBe(api.ceo.goals.board);
  expect(api.chat.thread).toBe(api.chat.thread);
  expect(api.chat.thread).not.toBe(api.chat.ask);
  expect(api.then).toBeUndefined();
  expect(await Promise.resolve(api)).toBe(api);
  expect(JSON.stringify({query:api.stats.range,args:{start:"2026-09-01"}})).toBe('{"query":"stats.range","args":{"start":"2026-09-01"}}');
});

test("unmigrated operations never fabricate success, identity, or financial totals", async () => {
  for (const operation of [
    api.personalCalendars.mine,
    api.ceo.frequency.forRange, api.ceo.windows.list, api.unknown.write,
  ]) {
    await expect(operation({ campaignName: "Fixture", status: "Paused" }))
      .rejects.toThrow("No action was performed");
  }
});

test("roles.me uses verified active membership, never invented role or email defaults", async () => {
  user = {id:"fixture-user",email:"person@tests.invalid",email_confirmed_at:"2026-09-01"};
  member = {auth_user_id:user.id,email:user.email,roles:["csm"],clients:["Fixture"],name:"Fixture",active:true};
  const result = await api.roles.me();
  expect(result.roles).toEqual(["csm"]);
  expect(result.clients).toEqual(["Fixture"]);
  expect(result.isCeo).toBe(false);
  member.roles = ["admin", "ceo"];
  expect((await api.roles.me()).isCeo).toBe(false);
  member.active = false;
  expect(await api.roles.me()).toBeNull();
  member.active = true;
  user.email_confirmed_at = null;
  expect(await api.roles.me()).toBeNull();
  user = null;
  expect(await api.roles.me()).toBeNull();
  authError = new Error("Verification unavailable");
  await expect(api.roles.me()).rejects.toThrow("Verification unavailable");
  authError = null;
});
