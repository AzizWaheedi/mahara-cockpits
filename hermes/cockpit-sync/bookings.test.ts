import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withNativeContext} from './runtime';
import {ghlBookingEvents, placeBookings} from './calculator';
import {capture} from './capture';

// Muhammed, 2026-10-12: bookings for a meeting still ahead were invisible
// until the meeting day, and bookings bought by a stopped or replaced
// campaign were dropped. Every booking now counts on the day it was made,
// under the campaign whose ad bought it, and says how it was attributed.

const event = (over: Record<string, unknown>) => ({
 eventId: 'e1', locationId: 'loc', contactId: 'c1', startTime: '2026-10-20T10:00:00+03:00',
 date: '2026-10-12', appointmentDate: '2026-10-20', status: 'confirmed', ...over,
});

test('a booking counts under the campaign whose ad bought it, even a stopped one', () => {
 const ads = new Map([['ad-old', 'CASTELLO-MAHARA-9\\9'], ['ad-new', 'Castello new']]);
 const {rows, unplaced} = placeBookings('Castello Industries', [event({adId: 'ad-old'}), event({eventId: 'e2', adId: 'ad-new'})], ads, 'Castello new', 1);
 assert.equal(unplaced, 0);
 assert.deepEqual(rows.map(r => [r.campaignName, r.adId, r.attribution]), [
  ['CASTELLO-MAHARA-9\\9', 'ad-old', 'ad'],
  ['Castello new', 'ad-new', 'ad'],
 ]);
});

test('a lead with no ad, or an ad we never saw, goes to the current campaign and says so', () => {
 const ads = new Map([['ad-known', 'Liwan |MAHARA|10\\9']]);
 const {rows} = placeBookings('Liwan', [event({adId: undefined}), event({eventId: 'e2', adId: 'ad-unknown'})], ads, 'Liwan current', 1);
 assert.deepEqual(rows.map(r => [r.campaignName, r.adId, r.attribution]), [
  ['Liwan current', undefined, 'none'],
  ['Liwan current', undefined, 'unknown_ad'],
 ]);
});

test('a booking with nowhere to go is counted as unplaced, never silently lost', () => {
 const {rows, unplaced} = placeBookings('Nobody', [event({adId: undefined})], new Map(), undefined, 1);
 assert.equal(rows.length, 0);
 assert.equal(unplaced, 1);
});

test('GHL is asked for past and future meetings, each booking once, dated by when it was made', async () => {
 const asked: {start: number; end: number}[] = [];
 const now = Date.now();
 const fetch = async (url: string) => {
  const u = new URL(url);
  if (u.pathname === '/calendars/') return Response.json({calendars: [{id: 'cal', name: 'Consultation'}, {id: 'cb', name: 'Callback calendar'}]});
  if (u.pathname === '/calendars/events') {
   const start = Number(u.searchParams.get('startTime')), end = Number(u.searchParams.get('endTime'));
   asked.push({start, end});
   const past = {id: 'past', contactId: 'c1', startTime: new Date(now - 86400000).toISOString(), dateAdded: '2026-10-09T09:00:00Z', appointmentStatus: 'showed'};
   const ahead = {id: 'ahead', contactId: 'c2', startTime: new Date(now + 5 * 86400000).toISOString(), dateAdded: '2026-10-12T09:00:00Z', appointmentStatus: 'confirmed'};
   const cancelled = {id: 'gone', contactId: 'c3', startTime: new Date(now + 86400000).toISOString(), dateAdded: '2026-10-12T09:00:00Z', appointmentStatus: 'cancelled'};
   // The meeting at the boundary comes back from both asks.
   const edge = {id: 'edge', contactId: 'c4', startTime: new Date(now).toISOString(), dateAdded: '2026-10-11T09:00:00Z', appointmentStatus: 'confirmed'};
   // A client's own Google Calendar event and a deleted event are not bookings.
   const gcal = {id: 'gcal', startTime: new Date(now - 2 * 86400000).toISOString(), dateAdded: '2026-10-08T09:00:00Z', appointmentStatus: 'confirmed', createdBy: {source: 'google_calendar'}};
   const deleted = {id: 'deleted', contactId: 'c5', startTime: new Date(now + 2 * 86400000).toISOString(), dateAdded: '2026-10-12T09:00:00Z', appointmentStatus: 'confirmed', deleted: true};
   return Response.json({events: start < now - 86400000 ? [past, edge, gcal] : [ahead, cancelled, edge, deleted]});
  }
  if (u.pathname === '/opportunities/search') return Response.json({opportunities: [{contactId: 'c2', attributions: [{utmAdId: 'ad-1'}]}]});
  return new Response('', {status: 404});
 };
 const reads = {graph: async () => ({}), tool: async () => null, fetch, log: () => {}};
 const events = await withNativeContext(reads as any, {} as any, () => ghlBookingEvents('loc', 'pit-test'));
 assert.ok(events);
 assert.equal(asked.length, 2, 'the callback calendar is skipped; the booking calendar is asked twice');
 assert.ok(asked.some(a => a.end > now + 30 * 86400000), 'one ask reaches meetings weeks ahead');
 assert.deepEqual(events.map(e => [e.eventId, e.date, e.adId]).sort(), [
  ['ahead', '2026-10-12', 'ad-1'],
  ['edge', '2026-10-11', undefined],
  ['past', '2026-10-09', undefined],
 ]);
});

const state = (over: Record<string, unknown> = {}) => ({
 onboardings: [], clients: [], manualChanges: [], oldCampaigns: [], oldAds: [], oldTree: [], stills: [], offBoardDismissals: [], ...over,
});

test('the worker reads where each ad ran from the saved history', async () => {
 const {context} = capture(state({dailyStats: [
  {metaAdId: 'ad-aug', campaignName: 'MAHARA-old', date: '2026-08-27'},
  {adName: 'no id', campaignName: 'MAHARA-old', date: '2026-08-27'},
 ]}));
 assert.deepEqual(await context.runQuery('sync.adHistory', {}), [{metaAdId: 'ad-aug', campaignName: 'MAHARA-old', date: '2026-08-27'}]);
});

test('missing ad history stops the run instead of dropping bookings', async () => {
 const {context} = capture(state());
 await assert.rejects(context.runQuery('sync.adHistory', {}), /Ad history/);
});
