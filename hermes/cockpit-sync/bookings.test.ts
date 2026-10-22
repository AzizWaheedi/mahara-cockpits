import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withNativeContext} from './runtime';
import {calendarKind, dialerReplacedBookingIds, ghlBookingEvents, movedBookingDay, movedFromCounted, placeBookings} from './calculator';
import {capture} from './capture';

// The native context with test doubles for its reads.
// biome-ignore lint/suspicious/noExplicitAny: test doubles stand in for the native reads
const inNative = <T>(reads: unknown, fn: () => Promise<T>) => withNativeContext(reads as any, {} as any, fn);

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
  if (u.pathname === '/calendars/') return Response.json({calendars: [{id: 'cal', name: 'Main Appointment Calendar'}, {id: 'cb', name: 'Callback calendar'}]});
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
 const events = await inNative(reads, () => ghlBookingEvents('loc', 'pit-test'));
 assert.ok(events);
 assert.equal(asked.length, 2, 'the callback calendar is skipped; the booking calendar is asked twice');
 assert.ok(asked.some(a => a.end > now + 30 * 86400000), 'one ask reaches meetings weeks ahead');
 assert.deepEqual(events.map(e => [e.eventId, e.date, e.adId]).sort(), [
  ['ahead', '2026-10-12', 'ad-1'],
  ['edge', '2026-10-11', undefined],
  ['past', '2026-10-09', undefined],
 ]);
});

test('only the main and online appointment calendars are asked, as on the board', () => {
 // cockpit_board_calendar_kind, 20261016111157_board_facts.sql. Names from the
 // Active clients' GHL calendars on 2026-10-22.
 assert.equal(calendarKind('Main Appointment Calendar'), 'main');
 assert.equal(calendarKind('A. Appointment Calendar (Online)'), 'online');
 assert.equal(calendarKind('Not Confirmed Appointments'), 'provisional');
 assert.equal(calendarKind('Callback calendar'), 'callback');
 assert.equal(calendarKind('معاودة الاتصال'), 'callback');
 assert.equal(calendarKind('Reschedule Calendar'), 'reschedule');
 // Decision D0c, default not counted (2026-10-21).
 assert.equal(calendarKind('مكالمة مراجعة المشروع وتنسيق الاستشارة | Project Review & Qualification Call'), 'other');
 assert.equal(calendarKind('Mahara OS Google Sync Test (internal)'), 'other');
 assert.equal(calendarKind('Personal Calendar'), 'other');
 assert.equal(calendarKind(''), 'other');
});

test('the call centre\'s CALLBACK bookings are dropped by id; a lead\'s own booking on the same calendar counts', async () => {
 // Atlantis, 2026-10-16: the call centre's call-backs sat beside a lead's own
 // widget booking. Dropped by id, so a call-back on a main calendar is left
 // out too. The qualification calendar is not asked at all (decision D0c).
 const now = Date.now();
 const asked: string[] = [];
 const fetch = async (url: string) => {
  const u = new URL(url);
  if (u.pathname === '/calendars/') return Response.json({calendars: [{id: 'main', name: 'Main Appointment Calendar'}, {id: 'qual', name: 'Project Review & Qualification Call'}]});
  if (u.pathname === '/calendars/events') {
   asked.push(String(u.searchParams.get('calendarId')));
   if (Number(u.searchParams.get('startTime')) >= now) return Response.json({events: []});
   return Response.json({events: [
    {id: 'cb1', contactId: 'c1', startTime: new Date(now - 86400000).toISOString(), dateAdded: '2026-10-18T09:00:00Z', appointmentStatus: 'confirmed'},
    {id: 'widget', contactId: 'c2', startTime: new Date(now - 86400000).toISOString(), dateAdded: '2026-10-19T09:00:00Z', appointmentStatus: 'confirmed'},
   ]});
  }
  if (u.pathname === '/opportunities/search') return Response.json({opportunities: []});
  return new Response('', {status: 404});
 };
 const reads = {graph: async () => ({}), tool: async () => null, fetch, log: () => {}};
 const events = await inNative(reads, () => ghlBookingEvents('loc', 'pit-test', {callbacks: new Set(['cb1']), moved: new Map(), originalDay: new Map()}));
 assert.deepEqual([...new Set(asked)], ['main'], 'the qualification calendar is not asked');
 assert.deepEqual(events?.map(e => e.eventId), ['widget']);
 // Without the dialer's ids (it could not be read) every booking counts, as before.
 const all = await inNative(reads, () => ghlBookingEvents('loc', 'pit-test'));
 assert.deepEqual(all?.map(e => e.eventId).sort(), ['cb1', 'widget']);
});

test('a location with no main or online calendar has unknown bookings, never zero', async () => {
 const logs: string[] = [];
 const fetch = async (url: string) => {
  const u = new URL(url);
  if (u.pathname === '/calendars/') return Response.json({calendars: [{id: 'c', name: 'Consultation'}, {id: 'nc', name: 'Not Confirmed Appointments'}]});
  throw new Error(`not asked: ${u.pathname}`);
 };
 const reads = {graph: async () => ({}), tool: async () => null, fetch, log: (level: string) => { logs.push(level); }};
 assert.equal(await inNative(reads, () => ghlBookingEvents('loc', 'pit-test')), undefined);
 assert.deepEqual(logs, ['warn']);
});

test('a RESCHEDULE\'s booking is left out only while the one it moved still counts, and dated by the lead\'s booking', async () => {
 // Decision D0b, 2026-10-21. SAFAD's MxRYJYyO64JjX7lL7kMc moved
 // hncsfdNodMEdkVNW3245, which GHL and public.appointments no longer hold: it
 // is the lead's only booking and counts on its own day. Arcturus's
 // l1Ar6ZhyTqKN4baJush0 (28 Sep) moved OQGyKMbxm7ZiEwNar9h4, which GHL no
 // longer holds but public.appointments knows was booked on 22 Sep: it counts
 // on 22 Sep, the day the board counts it. A move whose original still counts
 // is the same booking, counted once as the original.
 const now = Date.now();
 const at = (id: string, day: string, over: Record<string, unknown> = {}) =>
  ({id, contactId: `c-${id}`, startTime: new Date(now - 86400000).toISOString(), dateAdded: `${day}T09:00:00Z`, appointmentStatus: 'confirmed', ...over});
 const fetch = async (url: string) => {
  const u = new URL(url);
  if (u.pathname === '/calendars/') return Response.json({calendars: [{id: 'main', name: 'Main Appointment Calendar'}]});
  if (u.pathname === '/calendars/events') {
   if (Number(u.searchParams.get('startTime')) >= now) return Response.json({events: []});
   return Response.json({events: [
    at('orig', '2026-10-10'), at('moved', '2026-10-12'),
    at('safad', '2026-10-20'),
    at('arcturus', '2026-09-28'),
    at('dropped', '2026-10-09', {appointmentStatus: 'cancelled'}), at('rebooked', '2026-10-13'),
    at('first', '2026-10-01'), at('second', '2026-10-05'), at('third', '2026-10-08'),
    at('cb', '2026-10-14'), at('cbmoved', '2026-10-15'),
    at('lateMove', '2026-10-16'),
    at('gone2', '2026-10-17', {deleted: true}), at('afterDeleted', '2026-10-18'),
   ]});
  }
  if (u.pathname === '/opportunities/search') return Response.json({opportunities: []});
  return new Response('', {status: 404});
 };
 const reads = {graph: async () => ({}), tool: async () => null, fetch, log: () => {}};
 const dialer = {
  callbacks: new Set(['cb']),
  moved: new Map([
   ['moved', 'orig'], // original still counts: left out
   ['safad', 'hncsfdNodMEdkVNW3245'], // original gone everywhere: counts on its own day
   ['arcturus', 'OQGyKMbxm7ZiEwNar9h4'], // original gone from GHL, booked 22 Sep: counts on 22 Sep
   ['rebooked', 'dropped'], // original held and cancelled: a new booking on its own day
   ['second', 'first'], ['third', 'second'], // moved twice: counted once, as the first
   ['cbmoved', 'cb'], // a moved call-back is still a call-back
   ['lateMove', 'oldMeeting'], // original's meeting older than the 30 days read: its own weeks
   ['afterDeleted', 'gone2'], // GHL marks the original deleted: it is gone
  ]),
  originalDay: new Map([
   ['OQGyKMbxm7ZiEwNar9h4', '2026-09-22'],
   ['dropped', '2026-10-09'],
   ['oldMeeting', '2026-08-30'],
   ['gone2', '2026-10-17'],
  ]),
 };
 const events = await inNative(reads, () => ghlBookingEvents('loc', 'pit-test', dialer));
 assert.deepEqual(events?.map(e => [e.eventId, e.date]).sort(), [
  ['afterDeleted', '2026-10-17'],
  ['arcturus', '2026-09-22'],
  ['first', '2026-10-01'],
  ['lateMove', '2026-08-30'],
  ['orig', '2026-10-10'],
  ['rebooked', '2026-10-13'],
  ['safad', '2026-10-20'],
 ]);
 // The middle of a chain may be gone: the move still finds the first booking.
 assert.equal(movedFromCounted('third', dialer.moved, new Set(['first'])), true);
 assert.equal(movedFromCounted('safad', dialer.moved, new Set(['orig'])), false);
 assert.equal(movedFromCounted('cbmoved', dialer.moved, new Set(), dialer.callbacks), true);
 // Bad data that loops never drops a booking for itself.
 assert.equal(movedFromCounted('x', new Map([['x', 'x']]), new Set(['x'])), false);
 // A chain of moves GHL no longer holds is dated by its earliest known booking.
 const chain = new Map([['c3', 'c2'], ['c2', 'c1']]);
 assert.equal(movedBookingDay('c3', chain, new Set(), new Map([['c2', '2026-10-05'], ['c1', '2026-10-01']])), '2026-10-01');
 assert.equal(movedBookingDay('c3', chain, new Set(['c2']), new Map([['c1', '2026-10-01']])), undefined);
 assert.equal(movedBookingDay('x', new Map([['x', 'x']]), new Set(), new Map([['x', '2026-10-01']])), undefined);
});

test('the dialer\'s CALLBACK ids and RESCHEDULE moves come from its dispositions; a failed read gives none and warns', async () => {
 const queries: string[] = [];
 const logs: string[] = [];
 const ok = {graph: async () => ({}), fetch: async () => new Response(''), log: (level: string) => { logs.push(level); },
  tool: async (_name: string, args: {query: string}) => { queries.push(args.query); return {result: JSON.stringify([
   {outcome: 'CALLBACK', id: 'a1', original: null}, {outcome: 'CALLBACK', id: 'a2', original: null},
   {outcome: 'RESCHEDULE', id: 'n1', original: 'o1', original_day: '2026-09-22', original_status: 'confirmed', original_source: null, original_calendar: 'Main Appointment Calendar'},
   {outcome: 'RESCHEDULE', id: 'n0', original: null},
   {outcome: 'RESCHEDULE', id: 'n2', original: 'o2', original_day: null},
   {outcome: 'RESCHEDULE', id: 'n3', original: 'o3', original_day: '2026-10-01', original_status: 'cancelled', original_calendar: 'Main Appointment Calendar'},
   {outcome: 'RESCHEDULE', id: 'n4', original: 'o4', original_day: '2026-10-02', original_status: 'confirmed', original_calendar: 'Not Confirmed Appointments'},
   {outcome: 'RESCHEDULE', id: 'n5', original: 'o5', original_day: '2026-10-03', original_status: 'confirmed', original_source: 'google_calendar', original_calendar: 'Main Appointment Calendar'},
   {outcome: 'RESCHEDULE', id: 'n6', original: 'o6', original_day: '2026-10-04', original_status: 'showed', original_calendar: 'A. Appointment Calendar (Online)'},
   {outcome: 'CALLBACK', id: '', original: null},
  ])}; }};
 const read = await inNative(ok, () => dialerReplacedBookingIds());
 assert.deepEqual([...(read?.callbacks ?? [])].sort(), ['a1', 'a2']);
 // A RESCHEDULE that names no original moved nothing that can be checked: it counts.
 assert.deepEqual([...(read?.moved ?? [])].map(([k]) => k), ['n1', 'n2', 'n3', 'n4', 'n5', 'n6']);
 // Only an original public.appointments holds as a counted main or online booking dates a move.
 assert.deepEqual([...(read?.originalDay ?? [])], [['o1', '2026-09-22'], ['o6', '2026-10-04']]);
 assert.match(queries[0], /'RESCHEDULE', 'CALLBACK'/);
 assert.match(queries[0], /bookingVerification/);
 assert.match(queries[0], /originalAppointmentId/);
 assert.match(queries[0], /public\.appointments/);
 assert.match(queries[0], /Asia\/Kuwait/);
 assert.doesNotMatch(queries[0], /\blimit\s+\d/i, 'the native transport refuses a capped read');
 assert.deepEqual(logs, []);
 // In this harness the tool failure only throws. On the native worker the
 // failed read is also a source fault, so that run does not publish at all.
 const down = {...ok, tool: async () => { throw new Error('Supabase is down'); }};
 assert.equal(await inNative(down, () => dialerReplacedBookingIds()), undefined);
 assert.deepEqual(logs, ['warn']);
 // An answer that is not rows: call-backs count this run, with a warning.
 const odd = {...ok, tool: async () => ({result: '{"error":"not rows"}'})};
 assert.equal(await inNative(odd, () => dialerReplacedBookingIds()), undefined);
 assert.deepEqual(logs, ['warn', 'warn']);
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
