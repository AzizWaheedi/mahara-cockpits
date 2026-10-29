import {describe, expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {bookingPlan, appointmentMatches, billingFreshness, fieldMatches, kuwaitDay, reconcileBooking} from './projections.ts';

const now = Date.parse('2026-10-04T08:00:00Z');
const context = {actorId:'actor', email:'csm@maharamedia.com', taskId:'abc', clientName:'Renewal Upgrade Acme', client:{ghlContactId:'contact-1'}};
const args = {taskId:'abc', day:'2026-10-05', time:'14:30', minutes:30};

describe('projection provider boundaries', () => {
  test('booking uses the neutral client-facing title and Kuwait time', () => {
    const plan = bookingPlan(args, context, now);
    expect(plan.title).toBe('Results and strategy review: Acme');
    expect(plan.when).toBe('2026-10-05T14:30:00+03:00');
    expect(plan.end).toBe('2026-10-05T12:00:00+00:00');
  });
  test('wrong client and impossible date cannot produce a provider plan', () => {
    expect(() => bookingPlan({...args, taskId:'other'}, context, now)).toThrow();
    expect(() => bookingPlan({...args, day:'2026-02-30'}, context, now)).toThrow();
    expect(() => bookingPlan({...args, minutes:91}, context, now)).toThrow();
  });
  test('reconciliation requires the same contact, calendar, title and interval', () => {
    const plan = {...bookingPlan(args, context, now), calendarId:'cal', contactId:'contact-1'};
    const event = {id:'event', calendarId:'cal', contactId:'contact-1', title:plan.title, startTime:'2026-10-05T11:30:00Z', endTime:'2026-10-05T12:00:00Z', appointmentStatus:'confirmed'};
    expect(appointmentMatches(event, plan)).toBe(true);
    expect(appointmentMatches({...event, contactId:'other'}, plan)).toBe(false);
    expect(appointmentMatches({...event, appointmentStatus:'cancelled'}, plan)).toBe(false);
  });
  test('unknown delivery never creates another appointment during reconciliation', async () => {
    const plan = {...bookingPlan(args, context, now), calendarId:'cal', contactId:'contact-1', locationId:'loc'};
    const requests:string[] = [];
    const provider = {async call(method:string, path:string) {requests.push(method+' '+path); return {events:[]};}};
    const result = await reconcileBooking(plan, provider, {async call() {throw Error('No ClickUp read needed');}});
    expect(result.ok).toBe(false);
    expect(requests.length).toBe(1);
    expect(requests.every(x=>x.startsWith('GET '))).toBe(true);
  });
  test('reading old or missing billing facts does not renew their source freshness', () => {
    expect(billingFreshness(null, now)).toMatchObject({ok:false, ledgerSyncedAt:null});
    const old = billingFreshness('2026-10-03T08:00:00Z', now);
    expect(old.ok).toBe(false);
    expect(old.ledgerSyncedAt).toBe(Date.parse('2026-10-03T08:00:00Z'));
    expect(billingFreshness('2026-10-04T07:50:00Z', now).ok).toBe(true);
  });
});

// Build 5 (docs/forms/STAGE2B-CONTRACT.md 4.5): Next POC as date-only noon Kuwait, read back by the Kuwait day.
describe('the Next POC date', () => {
  const NEXT_POC = 'c48c1323-ca6a-465f-84cb-8c24f0f62df3';
  const task = (value: unknown) => ({id:'abc', custom_fields:[{id:NEXT_POC, value}]});
  test('the plan writes noon Kuwait (09:00 UTC) of the booked day', () => {
    const plan = bookingPlan(args, context, now);
    expect(plan.nextPoc).toBe('2026-10-05');
    expect(plan.nextPocValue).toBe(Date.parse('2026-10-05T09:00:00Z'));
  });
  test('the read-back passes on ClickUp re-timing to 03:00Z or 04:00Z and rejects another day', () => {
    const plan = {taskId:'abc', nextPoc:'2026-10-05'};
    expect(fieldMatches(task(String(Date.parse('2026-10-05T03:00:00Z'))), plan)).toBe(true);
    expect(fieldMatches(task(Date.parse('2026-10-05T04:00:00Z')), plan)).toBe(true);
    expect(fieldMatches(task(String(Date.parse('2026-10-04T03:00:00Z'))), plan)).toBe(false);
    expect(fieldMatches(task(null), plan)).toBe(false);
    expect(fieldMatches({id:'other', custom_fields:[{id:NEXT_POC, value:String(Date.parse('2026-10-05T03:00:00Z'))}]}, plan)).toBe(false);
    // A receipt saved before build 5 (06:00Z) still reconciles by its day.
    expect(fieldMatches(task(String(Date.parse('2026-10-05T06:00:00Z'))), plan)).toBe(true);
    expect(kuwaitDay(String(Date.parse('2026-10-04T21:30:00Z')))).toBe('2026-10-05');
    expect(kuwaitDay('')).toBeNull();
  });
  test('reconciliation confirms a kept booking whose date ClickUp stored at 04:00Z', async () => {
    const plan = {...bookingPlan(args, context, now), calendarId:'cal', contactId:'contact-1', locationId:'loc', eventId:'event'};
    const event = {id:'event', calendarId:'cal', contactId:'contact-1', title:plan.title, startTime:'2026-10-05T11:30:00Z', endTime:'2026-10-05T12:00:00Z', appointmentStatus:'confirmed'};
    const ghl = {async call() {return {appointment:event};}};
    const clickup = {async call() {return task(String(Date.parse('2026-10-05T04:00:00Z')));}};
    expect(await reconcileBooking(plan, ghl, clickup)).toEqual({ok:true, eventId:'event', when:plan.when, title:plan.title});
  });
  test('the live write sends value_options.time false with the value', () => {
    const src = readFileSync(new URL('./projections.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/field\/\$\{NEXT_POC\}`,\{value:plan\.nextPocValue,value_options:\{time:false\}\}\);/);
  });
});
