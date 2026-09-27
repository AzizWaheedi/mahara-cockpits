import { afterAll, beforeAll, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { computeMediaRange, readMediaStats } from "../src/lib/mediaStatsClient";
import { actor, cockpitTestDb, member, migration, owner } from "./lib/cockpitTestDb";

let db:PGlite;
const buyer="00000000-0000-4000-8000-000000000011";
const other="00000000-0000-4000-8000-000000000012";
const unconfirmed="00000000-0000-4000-8000-000000000013";
const read=(kind:string,campaign:string|null="Campaign A",start:string|null="2026-09-01",end:string|null="2026-09-27") =>
 db.query<{result:any}>("SELECT cockpit_media_statistics($1,$2,$3::date,$4::date) AS result",[kind,campaign,start,end]);
const daily={campaignName:"Campaign A",date:"2026-09-10",adSetName:"Set",adName:"Active ad",metaAdId:"active",spend:100,leads:5,impressions:2000,linkClicks:100};
beforeAll(async()=>{
 db=await cockpitTestDb();
 await db.exec("CREATE TABLE cockpit_campaigns(client_name text NOT NULL,raw_data jsonb NOT NULL);");
 await member(db,buyer,"buyer@tests.invalid",["media_buyer"]);
 await member(db,other,"csm@tests.invalid",["csm"]);
 await member(db,unconfirmed,"unconfirmed@tests.invalid",["media_buyer"],true,false);
 await db.query("UPDATE cockpit_members SET clients=ARRAY['Client A'] WHERE auth_user_id=$1",[buyer]);
 await db.exec(`INSERT INTO cockpit_campaigns VALUES ('Client A','{"campaignName":"Campaign A"}'),('Client B','{"campaignName":"Campaign B"}');`);
 await db.exec(migration("20260927j_cockpit_media_statistics.sql"));
 await db.query("INSERT INTO cockpit_media_daily_stats(source_deployment,source_id,campaign_name,day,data) VALUES ('fixture','a','Campaign A','2026-09-10',$1)",[daily]);
 await db.query("INSERT INTO cockpit_media_daily_stats(source_deployment,source_id,campaign_name,day,data) VALUES ('fixture','b','Campaign B','2026-09-11',$1)",[{...daily,campaignName:"Campaign B",date:"2026-09-11",spend:900}]);
 await db.query("INSERT INTO cockpit_media_booking_events(source_deployment,source_id,campaign_name,day,data) VALUES ('fixture','booking','Campaign A','2026-09-10',$1)",[{campaignName:"Campaign A",date:"2026-09-10",status:"showed",adId:"active",privateContact:"must not leave server"}]);
});
afterAll(async()=>{await db?.close();});

test("history must be verified before an empty or partial feed can be shown",async()=>{
 await actor(db,buyer);await expect(read("range")).rejects.toThrow("not been imported");
 await owner(db);await db.exec("UPDATE cockpit_media_feed_state SET ready=true;");
});
test("range and trend use actual spend/bookings and omit private source fields",async()=>{
 await actor(db,buyer);const payload=(await read("range")).rows[0].result;
 expect(JSON.stringify(payload)).not.toContain("privateContact");
 const report=await computeMediaRange(payload,{campaignName:"Campaign A",start:"2026-09-01",end:"2026-09-27"});
 expect(report.total.spend).toBe(100);expect(report.total.leads).toBe(5);expect(report.total.cpl).toBe(20);
 expect(report.total.costPerBooking).toBe(100);expect(report.total.showed).toBe(1);
 expect((await read("campaignTrend")).rows[0].result).toEqual([{date:"2026-09-10",spend:100,leads:5,cpl:20}]);
 expect((await read("coverage",null,null,null)).rows[0].result).toEqual({first:"2026-09-10",last:"2026-09-10",rows:null});
 await expect(db.query("SELECT * FROM cockpit_media_booking_events")).rejects.toThrow();
});
test("wrong role, unconfirmed, revoked and cross-client callers are rejected",async()=>{
 for(const id of [null,other,unconfirmed]){await actor(db,id);await expect(read("range")).rejects.toThrow();}
 await actor(db,buyer);await expect(read("range","Campaign B")).rejects.toThrow("outside");
 await owner(db);await db.query("UPDATE cockpit_members SET active=false WHERE auth_user_id=$1",[buyer]);
 await actor(db,buyer);await expect(read("range")).rejects.toThrow();
 await owner(db);await db.query("UPDATE cockpit_members SET active=true WHERE auth_user_id=$1",[buyer]);
});
test("quiet historic ads retain booking identity without inheriting another ad's spend",async()=>{
 const result=await computeMediaRange({rows:[daily],historical:[{...daily,date:"2026-08-20",metaAdId:"quiet",spend:70}],bookings:[{campaignName:"Campaign A",date:"2026-09-12",adId:"quiet",status:"showed"}]},{campaignName:"Campaign A",start:"2026-09-01",end:"2026-09-27"});
 expect(result.total.spend).toBe(100);const quiet=result.ads.find(a=>a.adIds.includes("quiet"));
 expect(quiet?.bookings).toBe(1);expect(quiet?.spend).toBe(0);expect(quiet?.costPerBooking).toBeUndefined();
 expect(result.ads.find(a=>a.adIds.includes("active"))?.bookings).toBe(0);
});
test("an explicitly unrestricted verified media-buyer keeps the original empty-list scope",async()=>{
 await owner(db);await db.query("UPDATE cockpit_members SET clients='{}' WHERE auth_user_id=$1",[buyer]);
 await actor(db,buyer);expect((await read("campaignTrend","Campaign B")).rows[0].result[0].spend).toBe(900);
 await owner(db);await db.query("UPDATE cockpit_members SET clients=ARRAY['Client A'] WHERE auth_user_id=$1",[buyer]);
});
test("read failures are not silently changed into zero figures",async()=>{
 await expect(readMediaStats({rpc:async()=>({data:null,error:new Error("read failed")})} as any,"range",{})).rejects.toThrow("read failed");
 await expect(readMediaStats({rpc:async()=>({data:null,error:null})} as any,"range",{})).rejects.toThrow("did not return");
});
