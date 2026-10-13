import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bookingGrid, diagnose, judge, judgeWithBookings} from './calculator';
import {CPB_BAD, CPB_GATE, CPL_GATE} from './constants';
import * as site from '../../apps/media-buyer-cockpit/src/lib/kpi';

// Muhammed, 2026-10-13: an ad is judged on cost per lead and cost per booking
// together. Cheap leads that do not book are not a working ad; dearer leads
// that book cheaply are. The live ads of that day are the examples.

const v = (spend: number, leads: number, booked?: number, freq?: number) =>
 judge(spend, leads, leads ? spend / leads : undefined, undefined, undefined, freq, booked).verdict;

test('the grid: cost per booking and cost per lead read together', () => {
 // booking <= $60: scale, scale, hold
 assert.equal(bookingGrid(100, 10, 10, 2).verdict, 'scale');
 assert.equal(bookingGrid(100, 5, 20, 2).verdict, 'scale');
 assert.equal(bookingGrid(100, 4, 25, 2).verdict, 'hold');
 // booking $60 to $80: hold, hold, kill
 assert.equal(bookingGrid(140, 14, 10, 2).verdict, 'hold');
 assert.equal(bookingGrid(140, 7, 20, 2).verdict, 'hold');
 assert.equal(bookingGrid(140, 5, 28, 2).verdict, 'kill');
 // booking over $80: kill in every column
 assert.equal(bookingGrid(200, 20, 10, 2).verdict, 'kill');
 assert.equal(bookingGrid(200, 10, 20, 2).verdict, 'kill');
 assert.equal(bookingGrid(200, 5, 40, 2).verdict, 'kill');
 // no booking: the spend so far is the least one booking costs
 assert.equal(bookingGrid(40, 4, 10, 0).verdict, 'hold');
 assert.equal(bookingGrid(40, 2, 20, 0).verdict, 'hold');
 assert.equal(bookingGrid(50, 2, 25, 0).verdict, 'kill');
 assert.equal(bookingGrid(70, 7, 10, 0).verdict, 'hold');
 assert.equal(bookingGrid(70, 1, 70, 0).verdict, 'kill');
 assert.equal(bookingGrid(90, 9, 10, 0).verdict, 'kill');
});

test('the live ads of 2026-10-13 get the verdicts the grid gives them', () => {
 assert.equal(v(236, 19, 1), 'kill'); // Ardon AD-2: $12.40 a lead, $236 a booking
 assert.equal(v(145, 20, 0), 'kill'); // Castello ad-1: $7.30 a lead, no booking
 assert.equal(v(74, 5, 0), 'hold'); // Alkhalil ad-1: $14.80 a lead, no booking yet
 assert.equal(v(96, 5, 2), 'scale'); // Ocean Home ad-4: $19.20 a lead, $48 a booking
 assert.equal(v(177, 21, 9), 'scale'); // Ocean Home ad-5: $8.40 a lead, $20 a booking
});

test('the reason says both numbers', () => {
 const r = judge(96, 5, 19.2, undefined, undefined, undefined, 2).reason;
 assert.match(r, /\$48 a booking \(2 bookings\)/);
 assert.match(r, /\$19\.20 a lead/);
 assert.match(r, /they book/);
 assert.match(judge(145, 20, 7.25, undefined, undefined, undefined, 0).reason, /Cheap leads that do not book/);
});

test('a no-booking kill on dear leads names the cost per lead once', () => {
 for (const [spend, leads] of [[70, 1], [50, 2]]) {
  const r = judge(spend, leads, spend / leads, undefined, undefined, undefined, 0).reason;
  assert.equal(r.match(/a lead/g)?.length, 1, r);
  assert.match(r, /over \$22\.50, and no booking yet\.$/);
 }
});

test('zero new leads but earlier leads booked: hold, or kill over the $80 line', () => {
 assert.equal(v(5, 0, 2), 'hold'); // AD-post-2 of 2026-10-13: $5, 2 bookings
 assert.equal(v(150, 0, 2), 'hold'); // $75 a booking: within the line, never scale
 assert.equal(v(170, 0, 2), 'kill'); // $85 a booking
 assert.equal(v(50, 0, 2, 3), 'hold'); // frequency does not turn it into a refresh
 assert.match(judge(5, 0, undefined, undefined, undefined, undefined, 2).reason, /earlier leads booked: \$3 a booking \(2 bookings\)/);
});

test('fatigue turns a working ad into a refresh, never rescues a kill', () => {
 assert.equal(v(177, 21, 9, 3), 'fatiguing');
 assert.equal(v(236, 19, 1, 3), 'kill');
});

test('zero leads after spend is still a kill, and no spend is no delivery', () => {
 assert.equal(v(50, 0, 0), 'kill');
 assert.equal(v(50, 0), 'kill');
 assert.equal(v(0, 0, 0), 'no delivery');
});

test('without booking data the cost per lead rule stands and the reason says why', () => {
 const why = 'Judged on cost per lead only: Done With You clients have no bookings to count.';
 const j = judge(121, 11, 11, undefined, undefined, undefined, undefined, why);
 assert.equal(j.verdict, 'scale');
 assert.ok(j.reason.endsWith(why));
 // Missing bookings never count as zero: $145 at $7.30 a lead is not a kill here.
 assert.equal(v(145, 20), 'scale');
});

const campaign = (over: Record<string, unknown>) => ({
 campaignName: 'C', onBoard: true, internal: false, spend7d: 100, leads7d: 10, cpl: 10,
 dayRate: 100 / 7, daysLive: 20, verdict: 'scale', reason: 'old', rank: 30, ...over,
});
const booking = (campaignName: string, adId: string | undefined, date = '2026-10-12', status = 'confirmed') =>
 ({campaignName, adId, date, status, attribution: adId ? 'ad' : 'none'});

test('a client with two campaigns: each counts only the bookings it bought', () => {
 // Atlantis, 2026-10-13: both campaigns showed the client's 4 bookings.
 const a = campaign({campaignName: 'Atlantis 13', spend7d: 68, leads7d: 7, cpl: 9.71});
 const b = campaign({campaignName: 'Atlantis 7', spend7d: 162, leads7d: 4, cpl: 40.5});
 const rows = [booking('Atlantis 13', 'x1'), booking('Atlantis 13', 'x1'), booking('Atlantis 13', undefined), booking('Atlantis 7', 'y1')];
 judgeWithBookings([a, b], [], rows, '2026-10-06', new Set(['Atlantis 13', 'Atlantis 7']), new Map(), new Map());
 assert.equal(a.bookings7d, 3);
 assert.equal(b.bookings7d, 1);
 assert.equal(a.verdict, 'scale');
 assert.equal(b.verdict, 'kill');
});

test('bookings older than the week do not count', () => {
 const c = campaign({spend7d: 273, leads7d: 41, cpl: 6.66});
 judgeWithBookings([c], [], [booking('C', 'x', '2026-10-01')], '2026-10-06', new Set(['C']), new Map(), new Map());
 assert.equal(c.bookings7d, 0);
 assert.equal(c.verdict, 'kill'); // Castello: $273, 41 leads, no booking
 assert.ok(c.findings.some((f: {constraint: string}) => f.constraint === 'Cost per booking'));
});

test('an untracked campaign keeps no booking numbers and says why', () => {
 const c = campaign({spend7d: 174, leads7d: 15, cpl: 11.6});
 const why = new Map([['C', 'Judged on cost per lead only: this client has no GHL connection in the cockpit.']]);
 judgeWithBookings([c], [], [], '2026-10-06', new Set(), why, new Map());
 assert.equal(c.bookings7d, undefined);
 assert.equal(c.verdict, 'scale');
 assert.match(c.reason, /no GHL connection/);
});

test('an off-board campaign keeps its own verdict', () => {
 const c = campaign({onBoard: false, verdict: 'off board', reason: 'Spending with no task.'});
 judgeWithBookings([c], [], [], '2026-10-06', new Set(['C']), new Map(), new Map());
 assert.equal(c.verdict, 'off board');
 assert.equal(c.reason, 'Spending with no task.');
});

test('an ad counts the bookings of every Meta id it ran under, and only those', () => {
 const ad = {campaignName: 'C', adName: 'ad-4', spend: 96, leads: 5, cpl: 19.2, verdict: 'hold', reason: ''};
 const other = {campaignName: 'C', adName: 'ad-9', spend: 70, leads: 7, cpl: 10, verdict: 'scale', reason: ''};
 const lost = {campaignName: 'C', adName: 'no id', spend: 70, leads: 7, cpl: 10, verdict: 'scale', reason: ''};
 const ids = new Map<object, string[]>([[ad, ['a1', 'a2']], [other, ['b1']], [lost, []]]);
 const rows = [booking('C', 'a1'), booking('C', 'a2'), booking('C', undefined)];
 judgeWithBookings([], [ad, other, lost], rows, '2026-10-06', new Set(['C']), new Map(), ids);
 assert.equal((ad as Record<string, unknown>).bookings7d, 2);
 assert.equal(ad.verdict, 'scale');
 assert.equal((other as Record<string, unknown>).bookings7d, 0);
 assert.equal(other.verdict, 'hold'); // $70, no booking yet
 assert.equal((lost as Record<string, unknown>).bookings7d, undefined);
 assert.match(lost.reason, /no Meta id/);
});

test('findings: dear leads that book cheaply are not an offer problem', () => {
 const f = diagnose({spend: 96, leads: 5, cpl: 19.2, dayRate: 14, bookings: 2, bookingRate: 40, costPerBooking: 48});
 assert.ok(!f.some(x => x.constraint === 'Offer or qualification'));
 assert.ok(!f.some(x => x.constraint === 'Cost per booking'));
});

test('findings: the lead to booking line reads a percent', () => {
 const f = diagnose({spend: 334, leads: 25, cpl: 13.36, dayRate: 48, bookings: 1, bookingRate: 4, costPerBooking: 334});
 const line = f.find(x => x.constraint === 'Lead to booking');
 assert.ok(line);
 assert.match(line.evidence, /Only 4% of leads book; the line is 25%/);
 const fine = diagnose({spend: 280, leads: 26, cpl: 10.76, dayRate: 40, bookings: 11, bookingRate: 42, costPerBooking: 25});
 assert.ok(!fine.some(x => x.constraint === 'Lead to booking'));
});

test('the worker and the media buyer site use the same gates', () => {
 assert.equal(CPL_GATE, site.CPL_GATE);
 assert.equal(CPB_GATE, site.CPB_GATE);
 assert.equal(CPB_BAD, site.CPB_BAD);
});

test('the playbook on the site gives the verdict the worker gives', () => {
 for (let spend = 5; spend <= 400; spend += 5)
  for (const leads of [1, 2, 3, 5, 8, 13, 21, 34])
   for (const booked of [0, 1, 2, 3, 5]) {
    const worker = bookingGrid(spend, leads, spend / leads, booked).verdict;
    const shown = site.gridCell(spend, leads, booked).verdict;
    assert.equal(shown, worker, `$${spend}, ${leads} leads, ${booked} booked`);
   }
});
