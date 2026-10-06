import {describe, expect, test} from 'bun:test';
import {bookingPlan, appointmentMatches, billingFreshness, reconcileBooking} from './projections.ts';

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
