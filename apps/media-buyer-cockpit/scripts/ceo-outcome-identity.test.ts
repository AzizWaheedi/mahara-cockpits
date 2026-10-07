import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import {
  CONFIRMED_OUTCOMES_SQL,
  OUTCOME_HISTORY_JOIN_SQL,
} from "../convex/ceo/data/triage";

const schema = `create schema portal_data;
  create table public.appointments (ghl_appointment_id text, ghl_location_id text);
  create table portal_data.appointment_outcomes (appointment_id text, location_id text, attendance text, deal text, revision bigint, source text, request_id text, captured_at timestamptz default now());
  create table portal_data.outbox (location_id text, request_id text, operation text default 'appointment-outcome', object_id text, expected_revision text, state text);`;
const select = `select ap.ghl_location_id as location, ap.ghl_appointment_id as appointment, o.appointment_id is not null as has_outcome, o.attendance, o.deal from public.appointments ap ${OUTCOME_HISTORY_JOIN_SQL} order by location, appointment`;

test("CEO rebuilds each field from confirmed sparse history within the exact location", async () => {
  const db = new PGlite();
  try {
    await db.exec(`${schema}
      insert into public.appointments values ('same-id','location-a'), ('same-id','location-b'), ('unreported','location-a');
      insert into portal_data.appointment_outcomes (appointment_id,location_id,attendance,deal,revision,source,request_id) values
        ('same-id','location-a','no_show','lost',1,'sheet',null),
        ('same-id','location-a','showed',null,2,'portal','attendance'),
        ('same-id','location-a',null,'won',3,'portal','deal'),
        ('same-id','location-a',null,null,4,'portal','quotation-only'),
        ('same-id','location-a','no_show','lost',5,'portal','pending-next'),
        ('same-id','location-b','no_show','pending',10,'sheet',null);
      insert into portal_data.outbox (location_id,request_id,object_id,expected_revision,state) values
        ('location-a','attendance','same-id','2','succeeded'),
        ('location-a','deal','same-id','3','succeeded'),
        ('location-a','quotation-only','same-id','4','succeeded'),
        ('location-a','pending-next','same-id','5','pending');
      update portal_data.appointment_outcomes set captured_at = '2026-10-05T00:00:00Z';
      update portal_data.appointment_outcomes set captured_at = '2100-01-01T00:00:00Z' where request_id = 'pending-next';`);
    expect((await db.query(select)).rows).toEqual([
      {
        location: "location-a",
        appointment: "same-id",
        has_outcome: true,
        attendance: "showed",
        deal: "won",
      },
      {
        location: "location-a",
        appointment: "unreported",
        has_outcome: false,
        attendance: null,
        deal: null,
      },
      {
        location: "location-b",
        appointment: "same-id",
        has_outcome: true,
        attendance: "no_show",
        deal: "pending",
      },
    ]);
    expect(
      (
        await db.query(
          `select count(*)::int as count from (${CONFIRMED_OUTCOMES_SQL}) confirmed`,
        )
      ).rows,
    ).toEqual([{ count: 5 }]);
    expect(
      (
        await db.query(
          `select max(captured_at) < timestamptz '2100-01-01' as confirmed_only from (${CONFIRMED_OUTCOMES_SQL}) confirmed`,
        )
      ).rows,
    ).toEqual([{ confirmed_only: true }]);
  } finally {
    await db.close();
  }
});

test("unconfirmed, absent and mismatched command receipts cannot supply an outcome", async () => {
  const db = new PGlite();
  try {
    await db.exec(`${schema}
      insert into public.appointments values ('pending-only','location-a'), ('cross-location','location-a'), ('wrong-object','location-a'), ('wrong-revision','location-a'), ('wrong-operation','location-a'), ('missing-command','location-a'), ('review','location-a'), ('leased','location-a'), ('failed','location-a');
      insert into portal_data.appointment_outcomes (appointment_id,location_id,attendance,deal,revision,source,request_id)
        select ghl_appointment_id, ghl_location_id, 'showed', 'won', 1, 'portal', ghl_appointment_id from public.appointments;
      insert into portal_data.outbox (location_id,request_id,object_id,expected_revision,state) values
        ('location-a','pending-only','pending-only','1','pending'),
        ('location-b','cross-location','cross-location','1','succeeded'),
        ('location-a','wrong-object','other-appointment','1','succeeded'),
        ('location-a','wrong-revision','wrong-revision','2','succeeded'),
        ('location-a','wrong-operation','wrong-operation','1','succeeded'),
        ('location-a','review','review','1','review'),
        ('location-a','leased','leased','1','leased'),
        ('location-a','failed','failed','1','failed');
      update portal_data.outbox set operation = 'contact-note' where request_id = 'wrong-operation';`);
    const rows = (await db.query(select)).rows;
    expect(rows).toHaveLength(9);
    expect(
      rows.every(
        (r: any) => !r.has_outcome && r.attendance === null && r.deal === null,
      ),
    ).toBe(true);
  } finally {
    await db.close();
  }
});

test("explicit unknown overrides an earlier value while a null sparse patch does not", async () => {
  const db = new PGlite();
  try {
    await db.exec(`${schema}
      insert into public.appointments values ('appointment','location-a');
      insert into portal_data.appointment_outcomes (appointment_id,location_id,attendance,deal,revision,source) values
        ('appointment','location-a','showed','won',1,'sheet'),
        ('appointment','location-a','unknown',null,2,'sheet'),
        ('appointment','location-a',null,'unknown',3,'sheet');`);
    expect((await db.query(select)).rows).toEqual([
      {
        location: "location-a",
        appointment: "appointment",
        has_outcome: true,
        attendance: "unknown",
        deal: "unknown",
      },
    ]);
  } finally {
    await db.close();
  }
});
