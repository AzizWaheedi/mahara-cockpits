import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bookingGrid, bookingMoney, bookingTotals, daysAgo, diagnose, judge, judgeWithBookings, lastSpendDay, sevenDayWindow} from './calculator';
import {CPB_BAD, CPB_GATE, CPL_GATE} from './constants';
import type {Row} from './runtime';
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
 assert.match(judge(5, 0, undefined, undefined, undefined, undefined, 2).reason, /earlier leads booked: \$2\.50 a booking \(2 bookings\)/);
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

const campaign = (over: Record<string, unknown>): Row => ({
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
 judgeWithBookings([a, b], [], rows, '2026-10-06', '2026-10-12', new Set(['Atlantis 13', 'Atlantis 7']), new Map(), new Map());
 assert.equal(a.bookings7d, 3);
 assert.equal(b.bookings7d, 1);
 assert.equal(a.verdict, 'scale');
 assert.equal(b.verdict, 'kill');
});

test('bookings older than the week do not count', () => {
 const c = campaign({spend7d: 273, leads7d: 41, cpl: 6.66});
 judgeWithBookings([c], [], [booking('C', 'x', '2026-10-01')], '2026-10-06', '2026-10-12', new Set(['C']), new Map(), new Map());
 assert.equal(c.bookings7d, 0);
 assert.equal(c.verdict, 'kill'); // Castello: $273, 41 leads, no booking
 assert.ok(c.findings.some((f: {constraint: string}) => f.constraint === 'Cost per booking'));
});

test('a booking made today is not paired with spend that stops yesterday', () => {
 // City Wood, 2026-10-21: $354.00 spent 14-20 Oct, 3 bookings made 14-20 Oct
 // and 4 made on the 21st. Counting all 7 read $50.57 "scale"; the 7 days
 // hold 3 bookings, $118.00 a booking, a kill.
 const c = campaign({campaignName: 'city wood-mahara-12\\9', spend7d: 354, leads7d: 32, cpl: 11.06});
 const rows = [
  ...['2026-10-14', '2026-10-16', '2026-10-20'].map(d => booking('city wood-mahara-12\\9', 'w1', d)),
  ...[1, 2, 3, 4].map(() => booking('city wood-mahara-12\\9', 'w1', '2026-10-21')),
 ];
 const ad = {campaignName: 'city wood-mahara-12\\9', adName: 'ad-1', spend: 354, leads: 32, cpl: 11.06, verdict: 'scale', reason: ''};
 judgeWithBookings([c], [ad], rows, '2026-10-14', '2026-10-20', new Set(['city wood-mahara-12\\9']), new Map(), new Map([[ad, ['w1']]]));
 assert.equal(c.bookings7d, 3);
 assert.equal(c.costPerBooking, 118);
 assert.equal(c.verdict, 'kill');
 assert.match(c.reason, /^\$118 a booking \(3 bookings\) is over the \$80 line\./);
 assert.equal(ad.verdict, 'kill');
 // The client's own 7-day count stops on the same day.
 const events = rows.map(r => ({date: r.date, status: r.status}));
 assert.deepEqual(bookingTotals(events, '2026-10-14', '2026-10-20'), {booked: 3, showed: 0, noshow: 0});
 assert.equal(bookingTotals(undefined, '2026-10-14', '2026-10-20'), undefined);
});

// One tracker or Meta row: date, campaign and spend (cost, column 4).
const spendRow = (date: string, cost = '10', campaign = 'C') =>
 Object.assign(Array<string>(25).fill(''), {0: date, 2: campaign, 4: cost});

test('the last day of spend is never later than yesterday, and a row with no spend does not move it', () => {
 // A row dated today never moves the end past yesterday.
 assert.equal(lastSpendDay([spendRow(daysAgo(3)), spendRow(daysAgo(1)), spendRow(daysAgo(0))]), daysAgo(1));
 assert.equal(lastSpendDay([spendRow(daysAgo(4)), spendRow(daysAgo(2))]), daysAgo(2));
 // SAFAD's "New Engagement Campaign" read a $0.00 row for 21 Oct overnight.
 assert.equal(lastSpendDay([spendRow(daysAgo(2)), spendRow(daysAgo(1), '0')]), daysAgo(2));
 // No rows, or none with a date, end on yesterday.
 assert.equal(lastSpendDay([]), daysAgo(1));
 assert.equal(lastSpendDay([spendRow('Total'), spendRow('')]), daysAgo(1));
});

test('the 7 days end on the sheet\'s last day while it is a day behind, though the Meta fill reaches yesterday', () => {
 // 22 Oct 00:22 Kuwait: the sheet's accounts stopped on 20 Oct, the accounts
 // the Meta fill reads (Merge Studio, AlOla) reached 21 Oct. Ending on the
 // 21st paired City Wood's 4 bookings of that day with spend that stopped on
 // the 20th: $295.95 / 7 = $42.28 "scale".
 const sheet = [spendRow(daysAgo(3), '34.78', 'city wood'), spendRow(daysAgo(2), '34.78', 'city wood'), spendRow(daysAgo(2), '20', 'Marble')];
 const meta = [spendRow(daysAgo(2), '32.10', 'Merge'), spendRow(daysAgo(1), '58.88', 'Merge'), spendRow(daysAgo(1), '49.21', 'Ola')];
 assert.deepEqual(sevenDayWindow(sheet, meta), {since7: daysAgo(8), until7: daysAgo(2)});
 // Once the sheet has yesterday, the 7 days end yesterday.
 assert.deepEqual(sevenDayWindow([...sheet, spendRow(daysAgo(1), '30', 'city wood')], meta), {since7: daysAgo(7), until7: daysAgo(1)});
 // A sheet two or more days behind has every spending account filled from Meta.
 const stale = [spendRow(daysAgo(5)), spendRow(daysAgo(4))];
 assert.deepEqual(sevenDayWindow(stale, [spendRow(daysAgo(3)), spendRow(daysAgo(1))]), {since7: daysAgo(7), until7: daysAgo(1)});
 // ... unless the fill failed or found nothing: then the sheet's own end stands.
 assert.deepEqual(sevenDayWindow(stale, undefined), {since7: daysAgo(10), until7: daysAgo(4)});
 assert.deepEqual(sevenDayWindow(stale, []), {since7: daysAgo(10), until7: daysAgo(4)});
 // The sheet unreadable: the Meta fill reads every account to yesterday.
 assert.deepEqual(sevenDayWindow([], meta), {since7: daysAgo(7), until7: daysAgo(1)});
 // The window is always 7 days, so the day rate (spend / 7) stays true.
 const {since7, until7} = sevenDayWindow(sheet, meta);
 assert.equal((Date.parse(until7) - Date.parse(since7)) / 86400000, 6);
});

test('overnight, City Wood is paired to the days its spend covers', () => {
 // The fix replayed on the 22 Oct 00:22 publish: the window ends on 20 Oct,
 // so the 4 bookings made on 21 Oct wait for 21 Oct's spend.
 const {since7, until7} = sevenDayWindow([spendRow(daysAgo(2))], [spendRow(daysAgo(1))]);
 const c = campaign({campaignName: 'city wood-mahara-12\\9', spend7d: 354, leads7d: 32, cpl: 11.06});
 const rows = [
  ...[daysAgo(8), daysAgo(6), daysAgo(2)].map(d => booking('city wood-mahara-12\\9', 'w1', d)),
  ...[1, 2, 3, 4].map(() => booking('city wood-mahara-12\\9', 'w1', daysAgo(1))),
  booking('city wood-mahara-12\\9', 'w1', daysAgo(0)),
 ];
 judgeWithBookings([c], [], rows, since7, until7, new Set(['city wood-mahara-12\\9']), new Map(), new Map());
 assert.equal(c.bookings7d, 3);
 assert.equal(c.verdict, 'kill');
 assert.equal(bookingTotals(rows.map(r => ({date: r.date, status: r.status})), since7, until7)?.booked, 3);
});

test('zero new leads: the spend is written to the cent too', () => {
 assert.equal(
  judge(80.4, 0, undefined, undefined, undefined, undefined, 1).reason,
  '$80.40 spent, zero leads in 7 days, and $80.40 a booking (1 booking) is over the $80 line.',
 );
 assert.match(judge(50.5, 0, undefined, undefined, undefined, undefined, 2).reason, /^\$50\.50 spent and zero leads in 7 days, but earlier leads booked: \$25\.25 a booking \(2 bookings\)\./);
 assert.equal(judge(41.65, 0, undefined, undefined, undefined, undefined, 0).reason, '$41.65 spent, zero leads in 7 days.');
 assert.equal(judge(233.36, 0, undefined, undefined, undefined, undefined, 0).reason, '$233 spent, zero leads in 7 days.');
});

test('the $60 and $80 lines judge the cents shown, so "$80" is never over the $80 line', () => {
 // $240.01 on 3 bookings is $80.0033 a booking: it reads "$80" and sits on the line.
 const atLine = judge(240.01, 20, 12, undefined, undefined, undefined, 3);
 assert.equal(atLine.verdict, 'hold');
 assert.match(atLine.reason, /^\$80 a booking \(3 bookings\) is over the \$60 gate but within \$80/);
 assert.equal(judge(240.03, 20, 12, undefined, undefined, undefined, 3).verdict, 'kill'); // $80.01
 // $180.01 on 3 is $60.0033: "$60", inside the gate.
 assert.equal(judge(180.01, 20, 9, undefined, undefined, undefined, 3).verdict, 'scale');
 assert.equal(bookingGrid(80.004, 4, 20, 0).verdict, 'hold'); // "$80 spent", no booking, not over $80
 assert.equal(bookingGrid(80.01, 4, 20, 0).verdict, 'kill');
 const f = diagnose({spend: 180.01, leads: 20, cpl: 9, dayRate: 26, bookings: 3, bookingRate: 15, costPerBooking: 180.01 / 3});
 assert.ok(!f.some(x => x.constraint === 'Cost per booking'));
});

test('a cost per booking under $100 keeps its cents in the reason', () => {
 // Khalida 14\10, 2026-10-20: $80.27 read "$80 a booking ... over the $80 line".
 const r = judge(80.27, 4, 20.07, undefined, undefined, undefined, 1).reason;
 assert.match(r, /^\$80\.27 a booking \(1 booking\) is over the \$80 line\./);
 assert.equal(bookingMoney(80.27), '$80.27');
 assert.equal(bookingMoney(48), '$48');
 assert.equal(bookingMoney(99.999), '$100');
 assert.equal(bookingMoney(265.3), '$265');
 assert.equal(bookingMoney(1211.23), '$1,211');
 // No booking yet: the spend is the least one booking costs, written the same way.
 assert.match(judge(60.4, 6, 10.07, undefined, undefined, undefined, 0).reason, /^\$60\.40 spent, 6 leads at \$10\.07 a lead, and no booking yet\. One booking now would still cost over \$60\./);
});

test('an untracked campaign keeps no booking numbers and says why', () => {
 const c = campaign({spend7d: 174, leads7d: 15, cpl: 11.6});
 const why = new Map([['C', 'Judged on cost per lead only: this client has no GHL connection in the cockpit.']]);
 judgeWithBookings([c], [], [], '2026-10-06', '2026-10-12', new Set(), why, new Map());
 assert.equal(c.bookings7d, undefined);
 assert.equal(c.verdict, 'scale');
 assert.match(c.reason, /no GHL connection/);
});

test('an off-board campaign keeps its own verdict', () => {
 const c = campaign({onBoard: false, verdict: 'off board', reason: 'Spending with no task.'});
 judgeWithBookings([c], [], [], '2026-10-06', '2026-10-12', new Set(['C']), new Map(), new Map());
 assert.equal(c.verdict, 'off board');
 assert.equal(c.reason, 'Spending with no task.');
});

test('an ad counts the bookings of every Meta id it ran under, and only those', () => {
 const ad = {campaignName: 'C', adName: 'ad-4', spend: 96, leads: 5, cpl: 19.2, verdict: 'hold', reason: ''};
 const other = {campaignName: 'C', adName: 'ad-9', spend: 70, leads: 7, cpl: 10, verdict: 'scale', reason: ''};
 const lost = {campaignName: 'C', adName: 'no id', spend: 70, leads: 7, cpl: 10, verdict: 'scale', reason: ''};
 const ids = new Map<object, string[]>([[ad, ['a1', 'a2']], [other, ['b1']], [lost, []]]);
 const rows = [booking('C', 'a1'), booking('C', 'a2'), booking('C', undefined)];
 judgeWithBookings([], [ad, other, lost], rows, '2026-10-06', '2026-10-12', new Set(['C']), new Map(), ids);
 assert.equal(ad.verdict, 'scale');
 assert.match(ad.reason, /\$48 a booking \(2 bookings\)/);
 assert.equal(other.verdict, 'hold'); // $70, no booking yet
 assert.match(other.reason, /no booking yet/);
 assert.match(lost.reason, /no Meta id/);
});

// The ad fields cockpit_native_mirrors owns for cockpit_ads (2026-10-13). Any
// other field on an ad row is refused by the publish once its value changes.
const MIRROR_AD_FIELDS = new Set(['_id', '_creationTime', 'campaignName', 'adName', 'spend', 'leads', 'cpl', 'linkCtr', 'cpm', 'optInRate', 'frequency', 'thumbnailUrl', 'previewSrc', 'metaAdId', 'stillKey', 'stillUrl', 'stillTinyUrl', 'verdict', 'reason', 'syncedAt', 'creativeId']);

test('judging adds no field to an ad that the database mirror does not own', () => {
 const ad = {campaignName: 'C', adName: 'ad-4', spend: 96, leads: 5, cpl: 19.2, verdict: 'hold', reason: ''};
 judgeWithBookings([], [ad], [booking('C', 'a1')], '2026-10-06', '2026-10-12', new Set(['C']), new Map(), new Map([[ad, ['a1']]]));
 assert.deepEqual(Object.keys(ad).filter(k => !MIRROR_AD_FIELDS.has(k)), []);
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
