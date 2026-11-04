/**
 * The matcher's tests: docs/forms/STAGE2-CONTRACT.md 5.3, numbered as there.
 * The recordings and bookings follow notes/stage2/maps/matching-evidence.md
 * (sections 3 to 7 and appendix A, Kuwait times): recording ids, business names
 * and the cards of section 7.4 are the contract's own evidence. Rooms, emails,
 * contact names and share links are invented.
 */
import { describe, expect, test } from "bun:test";
import {
  collapseDuplicates,
  exactMatch,
  normalizeRoom,
  placedExactly,
  rankForClient,
  SAME_ROOM_WINDOW_MIN,
  suggestionsFor,
  type Booking,
  type ClientRef,
  type Ctx,
  type Recording,
  type Suggestion,
} from "./callMatch.ts";
import cases from "./rooms.cases.json";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Kuwait wall time on a 2026 day: "10-14 11:31" or "10-14 11:31:10". */
const k = (s: string) => Date.parse(`2026-${s.replace(" ", "T")}+03:00`);
const zoom = (n: number) => `zoom:${10_000_000_000 + n}`;
const share = (id: string) => `https://fathom.video/share/TEST${id}`;
const CSM = "csm@maharamedia.com";
const CEO = "ceo@maharamedia.com";
const ADMIN = "admin@maharamedia.com";
const CS = "Customer Success";
const SALES = "Sales";

const CARD = {
  ocean: "86eyry0na",
  nahood: "86ex4m5ux",
  alkhalil: "86eypmbp3",
  atlantis: "86eyjkdc8",
  merge: "86eywazcu",
  marble: "86eymcqdq",
  cityWood: "86eyt1d33",
  munshaat: "86ey2em6q",
  madana: "z8xmdvffcd",
  arcturus: "card-arcturus",
  smmim: "card-smmim",
  safad: "card-safad",
  makers: "card-makers",
  shades: "card-shades",
  ardon: "card-ardon",
  smart: "card-smart",
};
const CLIENTS: ClientRef[] = [
  { taskId: CARD.ocean, name: "ocean home", aliases: ["ocean"] },
  { taskId: CARD.nahood, name: "نهوض نجد", aliases: [] },
  { taskId: CARD.alkhalil, name: "Alkhalil", aliases: [] },
  { taskId: CARD.atlantis, name: "Atlantis Contracting", aliases: ["atlantis"] },
  { taskId: CARD.merge, name: "mergestudio.kw", aliases: ["mergestudio"] },
  { taskId: CARD.marble, name: "Marble and more", aliases: ["marble"] },
  { taskId: CARD.cityWood, name: "City Wood", aliases: ["citywood", "city"] },
  { taskId: CARD.munshaat, name: "شركة منشآت خالدة", aliases: [] },
  { taskId: CARD.madana, name: "مدانة العمرانية", aliases: [] },
  { taskId: CARD.arcturus, name: "Arcturus Construction", aliases: ["arcturus"] },
  { taskId: CARD.smmim, name: "Smmim studio", aliases: ["smmim"] },
  { taskId: CARD.safad, name: "Safad Consultant Engineering", aliases: ["safad"] },
  { taskId: CARD.makers, name: "Makers", aliases: [] },
  { taskId: CARD.shades, name: "Shades Interior Design & General Contracting", aliases: ["shades"] },
  { taskId: CARD.ardon, name: "Ardon", aliases: [] },
  { taskId: CARD.smart, name: "SMART INTERIOR", aliases: ["smart"] },
];
const NAME = Object.fromEntries(CLIENTS.map(c => [c.taskId, c.name]));

const bk = (id: number, taskId: string, kind: string, status: string, at: string, room: string | null,
  emails: string[] = [], contactNames: string[] = []): Booking =>
  ({ id, taskId, clientName: NAME[taskId], kind, status, startsAt: k(at), endsAt: k(at) + 30 * MIN, room, emails, contactNames });

/** A recording by the CSM (Customer Success) unless the extra says otherwise. */
const rec = (id: string, at: string, minutes: number, room: string | null, cls: Recording["cls"],
  extra: Partial<Recording> = {}): Recording => ({
  recordingId: id,
  startsAt: k(at),
  endsAt: k(at) + minutes * MIN,
  room,
  title: "Impromptu Zoom Meeting",
  meetingTitle: "Impromptu Zoom Meeting",
  cls,
  recorderEmail: CSM,
  recorderTeam: CS,
  inviteeEmails: [CSM],
  shareUrl: share(id),
  ...extra,
});
const unlinked = (r: Recording): Recording => ({ ...r, onTask: null, onTaskMethod: null });
const calendared = (email: string): Partial<Recording> => ({ inviteeEmails: [CSM, email], title: "Check-in call", meetingTitle: "Check-in call" });
const byCeo: Partial<Recording> = { recorderEmail: CEO, recorderTeam: SALES };

const ROLES: Record<string, string> = { [CSM]: "the CSM", [CEO]: "the CEO", [ADMIN]: "an admin" };
const ctxAt = (now: number, extra: Partial<Ctx> = {}): Ctx => ({
  formLinks: new Map(),
  staffNames: ["Csm Person", "Ceo Person", "Admin Person Three"],
  csmEmails: [CSM],
  now,
  viewerEmail: CSM,
  roleOf: e => (e ? ROLES[e] ?? null : null),
  ...extra,
});
const rank = (taskId: string, recs: Recording[], bookings: Booking[], now: number,
  extra: Partial<Ctx & { lastNoteAt: number | null; pastedShareUrl: string | null }> = {}) =>
  rankForClient(taskId, recs, bookings, CLIENTS, { ...ctxAt(now), lastNoteAt: null, ...extra });
const listed = (r: { picked: Suggestion | null; others: Suggestion[] }) => [r.picked, ...r.others].filter((s): s is Suggestion => !!s);

// The bookings and recordings of the window (matching-evidence appendix A and sections 4 and 5).
const B = {
  marble0930: bk(54001, CARD.marble, "checkin", "confirmed", "09-30 15:00", zoom(1), ["owner@marble.example"], ["Dana Example"]),
  madana1004: bk(54002, CARD.madana, "checkin", "confirmed", "10-04 12:00", zoom(2), ["office@madana.example"]),
  madana1005: bk(54019, CARD.madana, "blueprint", "confirmed", "10-05 12:00", zoom(19), ["office@madana.example"]),
  shades1005: bk(54020, CARD.shades, "onboarding", "confirmed", "10-05 12:00", zoom(20), ["contact@shades.example"], ["Hala Sample"]),
  shades1006: bk(54003, CARD.shades, "onboarding", "showed", "10-06 12:00", zoom(3), ["contact@shades.example"], ["Hala Sample"]),
  ardon1007: bk(54004, CARD.ardon, "checkin", "confirmed", "10-07 15:30", zoom(4)),
  munshaat1008: bk(54005, CARD.munshaat, "checkin", "cancelled", "10-08 14:30", zoom(5)),
  cityWood1011: bk(54006, CARD.cityWood, "checkin", "confirmed", "10-11 13:00", zoom(6), ["owner@citywood.example"]),
  smmim1012: bk(54007, CARD.smmim, "onboarding", "confirmed", "10-12 13:00", zoom(7), ["hello@smmim.example"]),
  arcturus1012: bk(54008, CARD.arcturus, "checkin", "confirmed", "10-12 16:30", zoom(8), ["office@arcturus.example"]),
  smmim1013: bk(54009, CARD.smmim, "blueprint", "confirmed", "10-13 13:15", zoom(9), ["hello@smmim.example"]),
  atlantis1013: bk(54010, CARD.atlantis, "checkin", "showed", "10-13 16:30", zoom(10), ["team@atlantis.example"]),
  alkhalil1014: bk(54011, CARD.alkhalil, "checkin", "confirmed", "10-14 11:30", zoom(11), ["info@alkhalil.example"]),
  safad1014: bk(54012, CARD.safad, "checkin", "confirmed", "10-14 12:00", zoom(12), ["office@safad.example"]),
  makers1015: bk(54013, CARD.makers, "blueprint", "confirmed", "10-15 10:00", zoom(13)),
  safad1015: bk(54014, CARD.safad, "checkin", "booked", "10-15 12:30", null),
  cityWood1018: bk(54015, CARD.cityWood, "checkin", "booked", "10-18 12:00", null),
  makers1018: bk(54016, CARD.makers, "blueprint", "confirmed", "10-18 16:00", zoom(16)),
};
const BOOKINGS = Object.values(B);

// Matches as the store holds them today: calendared calls by appointment_time,
// the 1-1 form links as form_task_id, one title match by name.
const R = {
  r188142043: rec("188142043", "09-30 15:02", 38, null, "client",
    { ...calendared("owner@marble.example"), ...byCeo, onTask: CARD.marble, onTaskMethod: "appointment_time" }),
  r189344849: rec("189344849", "10-04 12:01", 38, null, "client",
    { ...calendared("office@madana.example"), ...byCeo, onTask: CARD.madana, onTaskMethod: "appointment_time" }),
  r189907294: rec("189907294", "10-06 11:58:40", 94, zoom(3), "client",
    { ...calendared("contact@shades.example"), onTask: CARD.shades, onTaskMethod: "appointment_time" }),
  r190467375: rec("190467375", "10-07 15:29:50", 30, zoom(104), "candidate",
    { title: "Ardon Check In Call", onTask: CARD.ardon, onTaskMethod: "name" }),
  r190894076: rec("190894076", "10-08 14:27:40", 25, zoom(105), "candidate"),
  r190915779: rec("190915779", "10-08 15:40", 38, zoom(106), "candidate"),
  r191603145: rec("191603145", "10-11 12:58:10", 34, zoom(6), "client",
    { ...calendared("owner@citywood.example"), title: "City Wood check-in", onTask: CARD.cityWood, onTaskMethod: "appointment_time" }),
  r191610368: rec("191610368", "10-11 16:40", 33, zoom(107), "candidate"),
  r191704587: rec("191704587", "10-12 12:54:40", 76, zoom(7), "client",
    { ...calendared("hello@smmim.example"), onTask: CARD.smmim, onTaskMethod: "appointment_time" }),
  r191770263: rec("191770263", "10-12 16:30:10", 40, zoom(8), "client",
    { ...calendared("office@arcturus.example"), onTask: CARD.arcturus, onTaskMethod: "appointment_time" }),
  ceoCopy191770263: rec("100000002", "10-12 16:30:20", 40, zoom(8), "client", { ...calendared("office@arcturus.example"), ...byCeo }),
  r191793342: rec("191793342", "10-12 17:10", 11, zoom(108), "candidate"),
  r191799288: rec("191799288", "10-12 17:30", 33, zoom(109), "candidate", { onTask: CARD.marble, onTaskMethod: "form_task_id" }),
  r192084146: rec("192084146", "10-13 13:58:20", 27, zoom(110), "candidate", { onTask: CARD.merge, onTaskMethod: "form_task_id" }),
  r192140228: rec("192140228", "10-13 16:26:10", 47, zoom(10), "client",
    { ...calendared("team@atlantis.example"), onTask: CARD.atlantis, onTaskMethod: "appointment_time" }),
  r192502786: rec("192502786", "10-14 11:31:10", 23, zoom(11), "client",
    { ...calendared("info@alkhalil.example"), onTask: CARD.alkhalil, onTaskMethod: "appointment_time" }),
  r192507905: rec("192507905", "10-14 12:13:10", 33, zoom(12), "client",
    { ...calendared("office@safad.example"), onTask: CARD.safad, onTaskMethod: "appointment_time" }),
  r192925234: rec("192925234", "10-15 09:55:40", 43, zoom(111), "candidate"),
  r192935730: rec("192935730", "10-15 10:39", 23, zoom(112), "candidate"),
  r192952366: rec("192952366", "10-15 11:55:40", 68, zoom(113), "candidate"),
  r192975263: rec("192975263", "10-15 13:07:50", 42, zoom(114), "candidate"),
  r193701396: rec("193701396", "10-17 12:56", 21, zoom(115), "candidate", { onTask: CARD.nahood, onTaskMethod: "form_task_id" }),
  r193748067: rec("193748067", "10-18 12:29:40", 8, zoom(116), "candidate"),
  r193748397: rec("193748397", "10-18 12:38:10", 33, zoom(117), "candidate"),
  r193755107: rec("193755107", "10-18 16:00", 45, zoom(119), "internal", { title: "Slow Client Call", meetingTitle: "Slow Client Call" }),
  r194756343: rec("194756343", "10-21 13:56", 36, zoom(120), "candidate", { onTask: CARD.ocean, onTaskMethod: "form_task_id" }),
  ceoCopy194756343: rec("100000003", "10-21 13:56:30", 36, zoom(120), "internal", { ...byCeo, inviteeEmails: [CEO] }),
};
const WORLD = Object.values(R);

describe("5.3 tests 1 to 10", () => {
  const ctx = ctxAt(k("10-26 12:00"));

  test("1. two calls on two clients' back-to-back bookings each match their own room, never the nearest time", () => {
    const bookings = [B.alkhalil1014, B.safad1014];
    expect(exactMatch(R.r192502786, bookings, ctx)).toEqual({ taskId: CARD.alkhalil, signal: "same_room", bookingId: 54011 });
    expect(exactMatch(R.r192507905, bookings, ctx)).toEqual({ taskId: CARD.safad, signal: "same_room", bookingId: 54012 });
    // In Safad's room 10 minutes after Alkhalil's booking and 20 before Safad's: still Safad's.
    const early = rec("100000011", "10-14 11:40", 15, zoom(12), "candidate");
    expect(exactMatch(early, bookings, ctx)).toEqual({ taskId: CARD.safad, signal: "same_room", bookingId: 54012 });
    const both = [R.r192502786, R.r192507905];
    expect(rank(CARD.alkhalil, both, bookings, k("10-14 13:00"))).toEqual({
      picked: {
        recordingId: "192502786",
        taskId: CARD.alkhalil,
        clientName: "Alkhalil",
        signal: "same_room",
        label: "exact",
        why: "Same room as the check-in booked for 11:30.",
        bookingId: 54011,
        preselect: true,
        ask: false,
      },
      others: [],
    });
    expect(rank(CARD.safad, both, bookings, k("10-14 13:00")).picked).toMatchObject({
      recordingId: "192507905",
      signal: "same_room",
      why: "Same room as the check-in booked for 12:00.",
    });
  });

  test("2. 43 minutes after Smmim studio's booking is a hint for Smmim only; mergestudio.kw's window picks it as the default", () => {
    const r = unlinked(R.r192084146);
    expect(suggestionsFor(r, BOOKINGS, CLIENTS, ctx)).toEqual([
      {
        recordingId: "192084146",
        taskId: CARD.smmim,
        clientName: "Smmim studio",
        signal: "hint_window",
        label: "hint",
        why: "43 min after Smmim studio's booked call.",
        bookingId: 54009,
        minutes: 43,
        preselect: false,
        ask: false,
      },
    ]);
    const { picked } = rank(CARD.merge, [r], [B.smmim1013], k("10-13 14:46"));
    expect(picked).toMatchObject({
      recordingId: "192084146",
      signal: "latest_unlinked",
      label: "default",
      why: "Your newest call that no client has yet.",
      preselect: true,
      ask: true,
    });
  });

  test("3. of two recordings near Makers' 10:00 booking, only the one 4 minutes before is possible", () => {
    expect(suggestionsFor(R.r192925234, [B.makers1015], CLIENTS, ctx)).toEqual([
      {
        recordingId: "192925234",
        taskId: CARD.makers,
        clientName: "Makers",
        signal: "near_booking",
        label: "possible",
        why: "Started 4 min before Makers's booked call at 10:00.",
        bookingId: 54013,
        minutes: 4,
        preselect: true,
        ask: true,
      },
    ]);
    expect(suggestionsFor(R.r192935730, [B.makers1015], CLIENTS, ctx).map(s => [s.signal, s.minutes])).toEqual([["hint_window", 39]]);
    const res = rank(CARD.makers, [R.r192925234, R.r192935730], [B.makers1015], k("10-15 11:30"));
    expect(res.picked).toMatchObject({ recordingId: "192925234", signal: "near_booking", preselect: true });
    expect(listed(res).filter(s => s.signal === "near_booking").map(s => s.recordingId)).toEqual(["192925234"]);
    expect(res.others.map(s => [s.recordingId, s.signal, s.preselect])).toEqual([["192935730", "latest_unlinked", false]]);
  });

  test("4. a booking another recording already claims by room gives a later recording no suggestion", () => {
    const recs = [R.r191770263, R.ceoCopy191770263, R.r191793342];
    const res = rank(CARD.arcturus, recs, [B.arcturus1012], k("10-12 18:00"));
    expect(res.picked).toMatchObject({ recordingId: "191770263", signal: "same_room", bookingId: 54008 });
    const later = listed(res).filter(s => s.recordingId === "191793342");
    expect(later.filter(s => s.signal === "near_booking" || s.signal === "hint_window")).toEqual([]);
    // The next morning the default no longer applies either: nothing at all for it, and the CEO's copy never shows.
    expect(rank(CARD.arcturus, recs, [B.arcturus1012], k("10-13 06:00")).others).toEqual([]);
    // Unclaimed, the same recording would have been a hint.
    expect(listed(rank(CARD.arcturus, [R.r191793342], [B.arcturus1012], k("10-13 06:00"))).map(s => s.signal)).toEqual(["hint_window"]);
    // A room match that started 30 minutes late claims the booking it names just the same.
    const late = { ...R.r191770263, startsAt: k("10-12 17:00") };
    expect(rank(CARD.arcturus, [late, R.r191793342], [B.arcturus1012], k("10-13 06:00")).others).toEqual([]);
  });

  test("5. a team meeting on Makers' booking is never offered, not even in the booked room", () => {
    expect(exactMatch(R.r193755107, BOOKINGS, ctx)).toBeNull();
    expect(suggestionsFor(R.r193755107, BOOKINGS, CLIENTS, ctx)).toEqual([]);
    for (const cls of ["internal", "sales"] as const) {
      const inRoom = { ...R.r193755107, cls, room: zoom(16), shareUrl: share("193755107") };
      const withLink = { ...ctx, formLinks: new Map([[share("193755107"), CARD.makers]]) };
      expect(exactMatch(inRoom, [B.makers1018], withLink)).toBeNull();
      expect(suggestionsFor(inRoom, [B.makers1018], CLIENTS, withLink)).toEqual([]);
      expect(rank(CARD.makers, [inRoom], [B.makers1018], k("10-18 17:00"), { formLinks: withLink.formLinks }))
        .toEqual({ picked: null, others: [] });
    }
  });

  test("6. a same-room copy by another recorder is one entry, the other gets duplicateOf", () => {
    const mine = { ...unlinked(R.r194756343), title: "Ocean Home check-in" };
    const copy = rec("100000003", "10-21 13:56:30", 36, zoom(120), "client",
      { ...byCeo, inviteeEmails: [CEO], title: "Ocean Home check-in" });
    expect(collapseDuplicates([copy, mine]).map(r => [r.recordingId, r.duplicateOf])).toEqual([
      ["100000003", "194756343"],
      ["194756343", null],
    ]);
    const res = rank(CARD.ocean, [copy, mine], [], k("10-21 15:46"));
    expect(listed(res).map(s => s.recordingId)).toEqual(["194756343"]);
    expect(res.picked).toMatchObject({ signal: "title", label: "likely", why: "The title names ocean home.", preselect: true, ask: true });
    // The copy that is on a client is the one kept.
    const onClient = { ...copy, onTask: CARD.ocean, onTaskMethod: "manual" };
    expect(collapseDuplicates([onClient, mine]).map(r => r.duplicateOf)).toEqual([null, "100000003"]);
    // More than 10 minutes apart, or another room: two calls.
    expect(collapseDuplicates([{ ...copy, startsAt: mine.startsAt + 11 * MIN }, mine]).map(r => r.duplicateOf)).toEqual([null, null]);
    expect(collapseDuplicates([{ ...copy, room: zoom(121) }, mine]).map(r => r.duplicateOf)).toEqual([null, null]);
    // The same recording listed twice comes back once.
    expect(collapseDuplicates([mine, { ...mine }]).map(r => r.recordingId)).toEqual(["194756343"]);
  });

  test("7. a recording Fathom no longer returns is never offered", () => {
    const gone = { ...unlinked(R.r194756343), gone: true };
    const withLink = { ...ctx, formLinks: new Map([[share("194756343"), CARD.ocean]]) };
    expect(exactMatch(gone, [], withLink)).toBeNull();
    expect(suggestionsFor(gone, [], CLIENTS, withLink)).toEqual([]);
    expect(rank(CARD.ocean, [gone], [], k("10-21 15:46"), { formLinks: withLink.formLinks, pastedShareUrl: share("194756343") }))
      .toEqual({ picked: null, others: [] });
    // A gone copy never hides the live one.
    const goneCopy = { ...R.ceoCopy194756343, cls: "candidate" as const, recorderTeam: CS, gone: true };
    expect(collapseDuplicates([goneCopy, unlinked(R.r194756343)]).map(r => r.duplicateOf)).toEqual(["194756343", null]);
  });

  test("8. City Wood's form of 10-11 17:54 picks the room-matched call, not the newer unlinked one", () => {
    const { recs, bookings, ctx: at } = asOf(FORMS[3]);
    const res = rankForClient(CARD.cityWood, recs, bookings, CLIENTS, at);
    expect(res.picked).toMatchObject({ recordingId: "191603145", signal: "same_room", why: "Same room as the check-in booked for 13:00." });
    expect(res.others.map(s => [s.recordingId, s.signal, s.preselect])).toEqual([["191610368", "latest_unlinked", false]]);
  });

  test("9. two clients booked at the same minute: no possible for either", () => {
    const r = rec("100000009", "10-05 12:03", 30, zoom(130), "candidate");
    const bookings = [B.madana1005, B.shades1005];
    expect(suggestionsFor(r, bookings, CLIENTS, ctx).filter(s => s.signal === "near_booking")).toEqual([]);
    for (const taskId of [CARD.madana, CARD.shades])
      expect(listed(rank(taskId, [r], bookings, k("10-05 13:00"))).filter(s => s.signal === "near_booking")).toEqual([]);
    // One booking alone at that minute: possible.
    expect(suggestionsFor(r, [B.madana1005], CLIENTS, ctx).map(s => [s.taskId, s.signal])).toEqual([[CARD.madana, "near_booking"]]);
  });

  test("10. a first name alone never gives speaker_name", () => {
    const call = (speakers: string[]) => rec("196038290", "10-25 15:11", 40, zoom(131), "candidate", { speakers });
    const full = suggestionsFor(call(["Csm Person", "Hala Sample"]), [B.shades1006], CLIENTS, ctx);
    expect(full).toEqual([
      {
        recordingId: "196038290",
        taskId: CARD.shades,
        clientName: "Shades Interior Design & General Contracting",
        signal: "speaker_name",
        label: "likely",
        why: "Shades Interior Design & General Contracting's contact spoke on this call.",
        preselect: true,
        ask: true,
      },
    ]);
    expect(suggestionsFor(call(["Csm Person", "Hala"]), [B.shades1006], CLIENTS, ctx)).toEqual([]);
    expect(suggestionsFor(call(["HalaSample"]), [B.shades1006], CLIENTS, ctx)).toEqual([]);
    const firstNameOnFile = { ...B.shades1006, contactNames: ["Hala"] };
    expect(suggestionsFor(call(["Hala"]), [firstNameOnFile], CLIENTS, ctx)).toEqual([]);
    // A staff member's name, and a name on two clients' contacts, prove nothing.
    expect(suggestionsFor(call(["Hala Sample"]), [B.shades1006], CLIENTS, { ...ctx, staffNames: ["Hala Sample"] })).toEqual([]);
    const twoClients = [B.shades1006, { ...B.makers1015, contactNames: ["hala  SAMPLE"] }];
    expect(suggestionsFor(call(["Hala Sample"]), twoClients, CLIENTS, ctx)).toEqual([]);
  });
});

describe("5.3 test 11: normalizeRoom over rooms.cases.json", () => {
  const all = cases as { input: string | null; expected: string | null; note: string }[];

  test("every pair", () => {
    expect(all.length).toBeGreaterThanOrEqual(20);
    expect(all.filter(c => normalizeRoom(c.input) !== c.expected).map(c => [c.input, normalizeRoom(c.input), c.expected])).toEqual([]);
    expect(normalizeRoom(undefined)).toBeNull();
  });

  test("the file covers the cases the contract names", () => {
    const hit = (re: RegExp, expected: string | null) => all.some(c => re.test(c.input ?? "") && c.expected === expected);
    expect(hit(/us05web\.zoom\.us\/j\/12345678901\?pwd=TEST/, "zoom:12345678901")).toBe(true);
    expect(hit(/us06web\.zoom\.us\/j\/12345678901\?pwd=TEST/, "zoom:12345678901")).toBe(true);
    expect(hit(/^https:\/\/zoom\.us\/j\//, "zoom:12345678901")).toBe(true);
    expect(hit(/meet\.google\.com\/abc-defg-hij$/, "meet:abc-defg-hij")).toBe(true);
    expect(hit(/meet\.google\.com\/[a-z-]+\?authuser=/, "meet:abc-defg-hij")).toBe(true);
    expect(hit(/teams\.microsoft\.com/, null)).toBe(true);
    expect(hit(/maps/, null)).toBe(true);
    expect(all.some(c => c.input === "" && c.expected === null)).toBe(true);
    expect(hit(/[A-Z]{5}/, "zoom:12345678901")).toBe(true);
    expect(hit(/\/$/, "meet:vwx-yzab-cde")).toBe(true);
  });

  test("every value is invented: passcode TEST only, Meet codes from the allow-list only", () => {
    const text = JSON.stringify(cases);
    expect([...text.matchAll(/pwd=([^&"#\s]*)/gi)].map(m => m[1]).filter(v => v !== "TEST")).toEqual([]);
    const allowed = new Set(["abc-defg-hij", "kln-opqr-stu", "vwx-yzab-cde"]);
    expect([...text.matchAll(/[a-z]{3}-[a-z]{4}-[a-z]{3}/gi)].map(m => m[0]).filter(c => !allowed.has(c))).toEqual([]);
  });
});

// 5.3 test 12: the ten fRokTITH forms of matching-evidence section 5, each rebuilt
// as of its submit (7.4 step 1): no form's own link, no pasted link, onTask only
// from a booking-time method, lastNoteAt before the submit, only recordings Fathom
// had listed by then, now = the submit; the window from 00:00 Kuwait the day before.
type Form = { n: number; taskId: string; at: string; pick: string; signal: string; link: string | null };
const FORMS: Form[] = [
  { n: 1, taskId: CARD.marble, at: "09-30 17:19", pick: "188142043", signal: "invitee_email", link: null },
  { n: 2, taskId: CARD.madana, at: "10-04 12:46", pick: "189344849", signal: "invitee_email", link: "189344849" },
  { n: 3, taskId: CARD.munshaat, at: "10-08 15:23", pick: "190894076", signal: "near_booking", link: null },
  { n: 4, taskId: CARD.cityWood, at: "10-11 17:54", pick: "191603145", signal: "same_room", link: "191603145" },
  { n: 5, taskId: CARD.marble, at: "10-12 19:14", pick: "191799288", signal: "latest_unlinked", link: "191799288" },
  { n: 6, taskId: CARD.merge, at: "10-13 14:46", pick: "192084146", signal: "latest_unlinked", link: "192084146" },
  { n: 7, taskId: CARD.atlantis, at: "10-13 17:45", pick: "192140228", signal: "same_room", link: "192140228" },
  { n: 8, taskId: CARD.alkhalil, at: "10-14 12:04", pick: "192502786", signal: "same_room", link: null },
  { n: 9, taskId: CARD.nahood, at: "10-17 14:52", pick: "193701396", signal: "latest_unlinked", link: "193701396" },
  { n: 10, taskId: CARD.ocean, at: "10-21 15:46", pick: "194756343", signal: "latest_unlinked", link: "194756343" },
];
const AS_OF_METHODS = new Set(["client_id_field", "invitee_email", "appointment_time", "same_room"]);
const kuwaitMidnight = (ms: number) => Date.parse(`${new Date(ms + 3 * HOUR).toISOString().slice(0, 10)}T00:00:00+03:00`);

function asOf(f: Form) {
  const now = k(f.at);
  const from = kuwaitMidnight(now) - DAY;
  const listedBy = (r: Recording) => (r.endsAt ?? r.startsAt) + 16_000; // Fathom lists a call about 16 s after it ends
  const known = WORLD.filter(r => listedBy(r) < now).map(r => (AS_OF_METHODS.has(r.onTaskMethod ?? "") ? r : unlinked(r)));
  // The store's window, plus this client's own calls of the last 14 days (6.4 step 4).
  const recs = known.filter(r => r.startsAt >= from || (r.onTask === f.taskId && r.startsAt >= now - 14 * DAY));
  const bookings = BOOKINGS.filter(b => b.startsAt >= from - 2 * HOUR && b.startsAt <= now + 2 * HOUR);
  const before = FORMS.filter(o => k(o.at) < now);
  const formLinks = new Map(before.filter(o => o.link).map(o => [share(o.link as string), o.taskId]));
  const notes = before.filter(o => o.taskId === f.taskId).map(o => k(o.at));
  const ctx = { ...ctxAt(now, { formLinks, viewerEmail: null }), lastNoteAt: notes.length ? Math.max(...notes) : null };
  return { recs, bookings, ctx };
}

describe("5.3 test 12: the ten forms as of each submit", () => {
  test("rankForClient picks the pinned recording of 7.4 for all ten, none by a pasted link or a form or manual match", () => {
    const got = FORMS.map(f => {
      const { recs, bookings, ctx } = asOf(f);
      const { picked } = rankForClient(f.taskId, recs, bookings, CLIENTS, ctx);
      const r = recs.find(x => x.recordingId === picked?.recordingId);
      if (picked?.signal === "matched") expect(AS_OF_METHODS.has(r?.onTaskMethod ?? "")).toBe(true);
      return { n: f.n, recordingId: picked?.recordingId, signal: picked?.signal };
    });
    expect(got).toEqual(FORMS.map(f => ({ n: f.n, recordingId: f.pick, signal: f.signal })));
    expect(got.filter(g => g.signal === "pasted" || g.signal === "matched")).toEqual([]);
  });

  test("form 5: Marble's call of 09-30, already noted, is listed but never preselected", () => {
    const { recs, bookings, ctx } = asOf(FORMS[4]);
    const res = rankForClient(CARD.marble, recs, bookings, CLIENTS, ctx);
    expect(res.picked).toMatchObject({ recordingId: "191799288", why: "The CSM's newest call that no client has yet." });
    expect(res.others.map(s => [s.recordingId, s.signal, s.preselect])).toEqual([["188142043", "matched", false]]);
    expect(res.others[0].why).toBe("On Marble and more in the call store.");
  });

  test("form 3: the only recording 2 minutes from the cancelled booking is preselected as possible", () => {
    const { recs, bookings, ctx } = asOf(FORMS[2]);
    expect(rankForClient(CARD.munshaat, recs, bookings, CLIENTS, ctx).picked).toEqual({
      recordingId: "190894076",
      taskId: CARD.munshaat,
      clientName: "شركة منشآت خالدة",
      signal: "near_booking",
      label: "possible",
      why: "Started 2 min before شركة منشآت خالدة's booked call at 14:30.",
      bookingId: 54005,
      minutes: 2,
      preselect: true,
      ask: true,
    });
  });
});

describe("5.3 tests 13 to 19", () => {
  test("13. the default is the CSM's newest unlinked call, never a newer one by the CEO", () => {
    const csm = rec("100000013", "10-25 10:00", 30, zoom(132), "candidate");
    const ceo = rec("100000014", "10-25 11:00", 30, zoom(133), "client", { ...byCeo, inviteeEmails: [CEO, "someone@client.example"] });
    const res = rank(CARD.cityWood, [ceo, csm], [], k("10-25 12:00"));
    expect(res.picked).toMatchObject({ recordingId: "100000013", signal: "latest_unlinked", label: "default", preselect: true, ask: true });
    expect(listed(res).some(s => s.recordingId === "100000014")).toBe(false);
    // An admin's seat is not the CSM's either.
    const admin = { ...csm, recordingId: "100000015", startsAt: k("10-25 11:30"), recorderEmail: ADMIN };
    expect(rank(CARD.cityWood, [admin, csm], [], k("10-25 12:00")).picked?.recordingId).toBe("100000013");
  });

  test("14. exactMatch names a booking for the room, for an invite only within 30 minutes, and never for a form link", () => {
    const ctx = ctxAt(k("10-11 18:00"));
    const b = B.cityWood1011;
    expect(exactMatch(rec("100000021", "10-11 13:05", 30, zoom(6), "candidate"), [b], ctx))
      .toEqual({ taskId: CARD.cityWood, signal: "same_room", bookingId: 54006 });
    const invite = (at: string) => rec("100000022", at, 30, null, "client", calendared("Owner@CityWood.example"));
    expect(exactMatch(invite("10-11 13:20"), [b], ctx)).toEqual({ taskId: CARD.cityWood, signal: "invitee_email", bookingId: 54006 });
    const far = exactMatch(invite("10-11 13:40"), [b], ctx);
    expect(far).toEqual({ taskId: CARD.cityWood, signal: "invitee_email" });
    expect(far && "bookingId" in far).toBe(false);
    const link = rec("100000023", "10-11 13:05", 30, null, "candidate");
    const byForm = exactMatch(link, [b], { ...ctx, formLinks: new Map([[share("100000023"), CARD.cityWood]]) });
    expect(byForm).toEqual({ taskId: CARD.cityWood, signal: "pasted" });
    expect(byForm && "bookingId" in byForm).toBe(false);
    // An email on two clients' bookings is decided only by a booking within 30 minutes.
    const other = { ...B.atlantis1013, startsAt: k("10-11 16:00"), emails: ["owner@citywood.example"] };
    expect(exactMatch(invite("10-11 13:20"), [b, other], ctx)).toEqual({ taskId: CARD.cityWood, signal: "invitee_email", bookingId: 54006 });
    expect(exactMatch(invite("10-11 14:40"), [b, other], ctx)).toBeNull();
    // Mahara's own address on a booking proves nothing.
    const ours = { ...b, room: null, emails: [CSM] };
    expect(exactMatch(rec("100000024", "10-11 13:05", 30, null, "client", calendared(CEO)), [ours], ctx)).toBeNull();
  });

  test("14b. the client on the invite names only a client on the clients list, as the worker's contacts index does; its booking within 30 minutes names it, listed or not (A7.13)", () => {
    const b = B.cityWood1011;
    const invite = (at: string) => rec("100000031", at, 30, null, "client", calendared("Owner@CityWood.example"));
    const listing = (...clientIds: string[]) => ctxAt(k("10-11 18:00"), { clientIds });
    // City Wood has left the clients list: its email alone, with no booking near, names no one, and gives no hint either.
    const without = listing(CARD.makers, CARD.atlantis);
    expect(exactMatch(invite("10-11 13:40"), [b], without)).toBeNull();
    expect(suggestionsFor(invite("10-11 13:40"), [b], CLIENTS, without).some(s => s.signal === "invitee_email")).toBe(false);
    // Its booking within 30 minutes still names it (the writers' appointment_time, with the booking's name).
    expect(exactMatch(invite("10-11 13:20"), [b], without)).toEqual({ taskId: CARD.cityWood, signal: "invitee_email", bookingId: 54006 });
    // On the list, the email names it as before; with no list given, every booking's client counts.
    expect(exactMatch(invite("10-11 13:40"), [b], listing(CARD.cityWood))).toEqual({ taskId: CARD.cityWood, signal: "invitee_email" });
    expect(exactMatch(invite("10-11 13:40"), [b], ctxAt(k("10-11 18:00")))).toEqual({ taskId: CARD.cityWood, signal: "invitee_email" });
    // The same email on a listed client's booking and an unlisted one's, neither near: the listed client, as the
    // worker's index has it (with every client counted, the email is on two clients and names neither).
    const atlantis = { ...B.atlantis1013, emails: ["owner@citywood.example"] };
    expect(exactMatch(invite("10-11 13:40"), [b, atlantis], without)).toEqual({ taskId: CARD.atlantis, signal: "invitee_email" });
    expect(exactMatch(invite("10-11 13:40"), [b, atlantis], ctxAt(k("10-11 18:00")))).toBeNull();
    // An unlisted client's booking within 30 minutes wins over a listed client's booking far away, as the worker's appointment_time does.
    expect(exactMatch(invite("10-11 13:20"), [b, atlantis], without)).toEqual({ taskId: CARD.cityWood, signal: "invitee_email", bookingId: 54006 });
  });

  test("15. a booking room reused by another client's recording 3 days later is not same_room, and the chain goes on", () => {
    const reused = rec("100000025", "10-17 11:35", 30, zoom(11), "candidate");
    const ctx = ctxAt(k("10-17 13:00"));
    expect(exactMatch(reused, [B.alkhalil1014], ctx)).toBeNull();
    const formLinks = new Map([[share("100000025"), CARD.safad]]);
    expect(exactMatch(reused, [B.alkhalil1014], { ...ctx, formLinks })).toEqual({ taskId: CARD.safad, signal: "pasted" });
    expect(listed(rank(CARD.alkhalil, [reused], [B.alkhalil1014], ctx.now)).some(s => s.signal === "same_room")).toBe(false);
    expect(rank(CARD.alkhalil, [reused], [B.alkhalil1014], ctx.now, { formLinks })).toEqual({ picked: null, others: [] });
    expect(rank(CARD.safad, [reused], [B.alkhalil1014], ctx.now, { formLinks }).picked).toMatchObject({
      recordingId: "100000025",
      signal: "pasted",
      label: "exact",
      why: "From the link in an earlier 1-1 form.",
    });
  });

  test("16. one room on two clients' bookings within 90 minutes is same_room for neither", () => {
    const room = zoom(140);
    const a = bk(54101, CARD.alkhalil, "checkin", "confirmed", "10-20 10:00", room);
    const s = bk(54102, CARD.safad, "checkin", "confirmed", "10-20 11:00", room);
    const r = rec("100000026", "10-20 10:05", 30, room, "candidate");
    const ctx = ctxAt(k("10-20 12:00"));
    expect(exactMatch(r, [a, s], ctx)).toBeNull();
    for (const taskId of [CARD.alkhalil, CARD.safad])
      expect(listed(rank(taskId, [r], [a, s], ctx.now)).some(x => x.signal === "same_room")).toBe(false);
    expect(exactMatch(r, [a], ctx)).toEqual({ taskId: CARD.alkhalil, signal: "same_room", bookingId: 54101 });
    // Two bookings of one client in that room: the closest.
    const a2 = bk(54103, CARD.alkhalil, "checkin", "cancelled", "10-20 09:00", room);
    expect(exactMatch(r, [a2, a], ctx)?.bookingId).toBe(54101);
  });

  test("17. the bound keeps every real pair: same room at 16 and 89 minutes, not at 91", () => {
    expect(SAME_ROOM_WINDOW_MIN).toBe(90);
    const b = B.cityWood1011;
    const ctx = ctxAt(k("10-11 18:00"));
    const at = (minutes: number) => ({ ...rec("100000027", "10-11 13:00", 30, zoom(6), "candidate"), startsAt: b.startsAt + minutes * MIN });
    expect(exactMatch(at(16), [b], ctx)?.signal).toBe("same_room");
    expect(exactMatch(at(-89), [b], ctx)?.signal).toBe("same_room");
    expect(exactMatch(at(89), [b], ctx)?.signal).toBe("same_room");
    expect(exactMatch(at(91), [b], ctx)).toBeNull();
    // A cancelled booking still proves its room; a gone one does not.
    expect(exactMatch(at(5), [{ ...b, status: "cancelled" }], ctx)?.signal).toBe("same_room");
    expect(exactMatch(at(5), [{ ...b, status: "gone" }], ctx)).toBeNull();
  });

  test("18. a pasted link, however it is written, is picked once the server has found its recording; a link that is not Fathom's is not", () => {
    const old = rec("100000028", "10-22 10:00", 30, zoom(150), "candidate"); // three days before now
    const now = k("10-25 10:00");
    const stored = share("100000028");
    // The server's lookup returns the stored share link for every form of the link (a /calls/{n} link too).
    for (const pasted of [stored, `${stored}?timestamp=123`, `${stored}?tab=summary`, `${stored}/`, `HTTPS://FATHOM.VIDEO/share/TEST100000028#x`])
      expect(rank(CARD.cityWood, [old], [], now, { pastedShareUrl: pasted }).picked).toMatchObject({
        recordingId: "100000028",
        signal: "pasted",
        label: "exact",
        why: "From the Fathom link you pasted.",
        preselect: true,
        ask: false,
      });
    expect(rank(CARD.cityWood, [old], [], now, { pastedShareUrl: "https://example.com/share/TEST100000028" }))
      .toEqual({ picked: null, others: [] });
    // A pasted link never makes an exact match: exactMatch reads stored 1-1 forms only.
    expect(exactMatch(old, [], ctxAt(now))).toBeNull();
    // A recording on another client is never picked, pasted or not.
    expect(rank(CARD.cityWood, [{ ...old, onTask: CARD.atlantis, onTaskMethod: "manual" }], [], now, { pastedShareUrl: stored }))
      .toEqual({ picked: null, others: [] });
  });

  test("19. the default's why reads Your for the recorder's own seat and The CSM's for everyone else; a settled call is never the default", () => {
    const own = rec("100000029", "10-25 10:00", 30, zoom(160), "candidate");
    const now = k("10-25 11:00");
    expect(rank(CARD.cityWood, [own], [], now, { viewerEmail: CSM }).picked?.why).toBe("Your newest call that no client has yet.");
    for (const viewer of [ADMIN, CEO, null])
      expect(rank(CARD.cityWood, [own], [], now, { viewerEmail: viewer }).picked?.why).toBe("The CSM's newest call that no client has yet.");
    expect(rank(CARD.cityWood, [own], [], now, { viewerEmail: ADMIN, roleOf: undefined }).picked?.why)
      .toBe("The CSM's newest call that no client has yet.");
    const settled = rec("100000030", "10-25 10:30", 20, zoom(161), "candidate", { settled: true });
    const res = rank(CARD.cityWood, [settled, own], [], now);
    expect(res.picked).toMatchObject({ recordingId: "100000029", signal: "latest_unlinked" });
    expect(listed(res).filter(s => s.recordingId === "100000030")).toEqual([]);
    expect(rank(CARD.cityWood, [settled], [], now)).toEqual({ picked: null, others: [] });
    // With a stronger signal a settled call stays listed for the Change sheet, never preselected.
    const named = { ...settled, title: "City Wood follow-up" };
    const withTitle = rank(CARD.cityWood, [named, own], [], now);
    expect(withTitle.picked?.recordingId).toBe("100000029");
    expect(withTitle.others.map(s => [s.recordingId, s.signal, s.preselect])).toEqual([["100000030", "title", false]]);
    // Pasted in the window, it is picked: the person chose it.
    expect(rank(CARD.cityWood, [named, own], [], now, { pastedShareUrl: share("100000030") }).picked?.recordingId).toBe("100000030");
  });
});

describe("the rest of 5.2", () => {
  const ctx = ctxAt(k("10-26 12:00"));

  test("only rows 1 to 3 are exact matches: no title, speaker, domain, store match or time ever makes one", () => {
    const r = rec("100000031", "10-15 10:02", 30, zoom(170), "candidate",
      { title: "Makers review", speakers: ["Hala Sample"], inviteeEmails: [CSM, "new.person@shades.example"], onTask: CARD.makers, onTaskMethod: "manual" });
    expect(exactMatch(r, [B.makers1015, B.shades1006], ctx)).toBeNull();
    expect(suggestionsFor(r, [B.makers1015, B.shades1006], CLIENTS, ctx).map(s => [s.taskId, s.signal])).toEqual([
      [CARD.makers, "matched"],
      [CARD.shades, "speaker_name"],
    ]);
  });

  test("matched: a call stored on this client by a strong method; the title name rule does not count", () => {
    const stored = rec("100000032", "10-26 10:00", 30, zoom(171), "candidate", { onTask: CARD.ardon, onTaskMethod: "form_task_id" });
    expect(rank(CARD.ardon, [stored], [], ctx.now).picked).toMatchObject({ signal: "matched", label: "exact", why: "On Ardon in the call store.", preselect: true, ask: false });
    // A name row is no store match: the CSM's own call is then her default, as it would be unplaced; another seat's gets nothing.
    const byName = { ...stored, onTaskMethod: "name" };
    expect(listed(rank(CARD.ardon, [byName], [], ctx.now)).map(s => [s.signal, s.label])).toEqual([["latest_unlinked", "default"]]);
    expect(rank(CARD.ardon, [{ ...byName, ...byCeo }], [], ctx.now)).toEqual({ picked: null, others: [] });
    // Stored on another client: never offered here, by any signal.
    expect(rank(CARD.cityWood, [{ ...stored, title: "City Wood check-in" }], [], ctx.now)).toEqual({ picked: null, others: [] });
  });

  test("matched: the client on the invite counts only at 0.9 or more (a known contact), never a company domain at 0.8 or a row with no confidence (round 3)", () => {
    const stored = rec("100000041", "10-26 10:00", 30, zoom(178), "candidate", { onTask: CARD.ardon, onTaskMethod: "invitee_email" });
    const at = (onTaskConfidence: number | null | undefined) => rank(CARD.ardon, [{ ...stored, onTaskConfidence }], [], ctx.now);
    expect(at(0.9).picked).toMatchObject({ signal: "matched", label: "exact", why: "On Ardon in the call store.", preselect: true, ask: false });
    expect(at(1).picked?.signal).toBe("matched");
    // The worker's company-domain placement, and a store that sends no confidence: no exact sign. Recorded by
    // another seat, nothing is offered; the CSM's own call is her default, which asks (R4-regressions-3, below).
    for (const c of [0.8, null, undefined]) {
      expect(rank(CARD.ardon, [{ ...stored, ...byCeo, onTaskConfidence: c }], [], ctx.now)).toEqual({ picked: null, others: [] });
      expect(listed(at(c)).map(s => [s.signal, s.label, s.ask])).toEqual([["latest_unlinked", "default", true]]);
    }
    // A likely row's other signs still read as what they are: the title is likely, never matched.
    const titled = { ...stored, onTaskConfidence: 0.8, title: "Ardon pricing review" };
    expect(rank(CARD.ardon, [titled], [], ctx.now).picked).toMatchObject({ signal: "title", label: "likely", ask: true });
    // The hints of a candidate never carry a likely row as matched either.
    expect(suggestionsFor({ ...stored, onTaskConfidence: 0.8 }, [], CLIENTS, ctx)).toEqual([]);
    expect(suggestionsFor({ ...stored, onTaskConfidence: 0.9 }, [], CLIENTS, ctx).map(s => s.signal)).toEqual(["matched"]);
  });

  test("placedExactly: an exact sign's or a person's call row, the client on the invite from 0.9; a name, a domain, no confidence or no client is not", () => {
    const on = (onTaskMethod: string | null, onTaskConfidence?: number | null, onTask: string | null = CARD.ardon) =>
      placedExactly({ onTask, onTaskMethod, onTaskConfidence });
    for (const m of ["same_room", "appointment_time", "form_task_id", "manual", "client_id_field"]) expect([m, on(m)]).toEqual([m, true]);
    expect([on("invitee_email", 0.9), on("invitee_email", 0.95), on("invitee_email", 1)]).toEqual([true, true, true]);
    expect([on("invitee_email", 0.8), on("invitee_email", null), on("invitee_email")]).toEqual([false, false, false]);
    expect([on("name", 0.6), on("name", 1), on(null, 1), on("", 1)]).toEqual([false, false, false, false]);
    expect(on("manual", 1, null)).toBe(false);
  });

  // R4-regressions-3: row 8 asks only "not on another client, not settled". A CSM's call the worker put on this
  // client by a likely sign is no store match (3b), so it is her default as it would be unplaced; rule 1 ties it.
  test("the default: the CSM's call stored on this client by a company domain (0.8) or a name is her default, as it would be unplaced; an exact row stays matched", () => {
    // 10:34 with a City Wood colleague who is no known contact and has no booking: the worker's domain index placed it.
    const domain = rec("100000042", "10-26 10:34", 30, zoom(179), "candidate",
      { inviteeEmails: [CSM, "buyer@citywood.example"], onTask: CARD.cityWood, onTaskMethod: "invitee_email", onTaskConfidence: 0.8 });
    const now = k("10-26 12:00");
    expect(rank(CARD.cityWood, [domain], [], now)).toEqual({
      picked: {
        recordingId: "100000042",
        taskId: CARD.cityWood,
        clientName: "City Wood",
        signal: "latest_unlinked",
        label: "default",
        why: "Your newest call that no client has yet.",
        preselect: true,
        ask: true,
      },
      others: [],
    });
    // The same call unplaced, or placed by a name, reads the same; placed by a known contact (0.9) it is the store match.
    const sig = (r: Recording) => listed(rank(CARD.cityWood, [r], [], now)).map(s => [s.signal, s.label, s.preselect]);
    expect(sig(unlinked(domain))).toEqual([["latest_unlinked", "default", true]]);
    expect(sig({ ...domain, onTaskMethod: "name", onTaskConfidence: 0.6 })).toEqual([["latest_unlinked", "default", true]]);
    expect(sig({ ...domain, onTaskConfidence: 0.9 })).toEqual([["matched", "exact", true]]);
    // The default's other rules still hold: after this client's last notes, within 12 hours, not settled, her own seats.
    expect(rank(CARD.cityWood, [domain], [], now, { lastNoteAt: k("10-26 11:00") }).picked).toBeNull();
    expect(rank(CARD.cityWood, [domain], [], k("10-26 22:35")).picked).toBeNull();
    expect(rank(CARD.cityWood, [{ ...domain, settled: true }], [], now)).toEqual({ picked: null, others: [] });
    expect(rank(CARD.cityWood, [{ ...domain, ...byCeo }], [], now)).toEqual({ picked: null, others: [] });
    // On another client by the same likely sign: never this client's default.
    expect(rank(CARD.cityWood, [{ ...domain, onTask: CARD.marble }], [], now)).toEqual({ picked: null, others: [] });
    // A newer unplaced call of hers takes the default, as it would over an older unplaced one.
    const newer = rec("100000043", "10-26 11:20", 20, zoom(180), "candidate");
    const both = rank(CARD.cityWood, [domain, newer], [], now);
    expect(both.picked).toMatchObject({ recordingId: "100000043", signal: "latest_unlinked" });
    expect(both.others).toEqual([]);
    // A newer call an exact sign or a person put on this client stays matched and leaves the default to the older one.
    const exactRow = { ...newer, onTask: CARD.cityWood, onTaskMethod: "manual" };
    const withExact = rank(CARD.cityWood, [domain, exactRow], [], now);
    expect(withExact.picked).toMatchObject({ recordingId: "100000043", signal: "matched", label: "exact" });
    expect(withExact.others.map(s => [s.recordingId, s.signal, s.preselect])).toEqual([["100000042", "latest_unlinked", false]]);
  });

  test("title: the full name or a distinctive alias in the edited title; generic aliases and Fathom's meeting title never", () => {
    const titled = (title: string, meetingTitle = "Impromptu Google Meet Meeting") =>
      suggestionsFor(rec("100000033", "10-26 10:00", 30, zoom(172), "candidate", { title, meetingTitle }), [], CLIENTS, ctx).map(s => s.taskId);
    expect(titled("Ardon Check In Call")).toEqual([CARD.ardon]);
    expect(titled("citywood weekly")).toEqual([CARD.cityWood]);
    expect(titled("Atlantis sync")).toEqual([CARD.atlantis]);
    expect(titled("City tour")).toEqual([]);
    expect(titled("Ocean view")).toEqual([]);
    expect(titled("Smart ideas")).toEqual([]);
    expect(titled("Impromptu Zoom Meeting", "City Wood check-in")).toEqual([]);
    expect(titled("مكالمة نهوض نجد")).toEqual([CARD.nahood]);
  });

  test("domain: a company domain on one client's bookings; free mail and a shared domain never", () => {
    const call = (mail: string) => rec("100000034", "10-26 10:00", 30, zoom(173), "candidate", { inviteeEmails: [CSM, mail] });
    expect(suggestionsFor(call("someone.new@citywood.example"), [B.cityWood1011], CLIENTS, ctx)).toEqual([
      {
        recordingId: "100000034",
        taskId: CARD.cityWood,
        clientName: "City Wood",
        signal: "domain",
        label: "likely",
        why: "Same company email domain.",
        preselect: true,
        ask: true,
      },
    ]);
    const freeMail = { ...B.cityWood1011, emails: ["invented.owner@gmail.com"] };
    expect(suggestionsFor(call("invented.other@gmail.com"), [freeMail], CLIENTS, ctx)).toEqual([]);
    const shared = [B.cityWood1011, { ...B.atlantis1013, emails: ["office@citywood.example"] }];
    expect(suggestionsFor(call("someone.new@citywood.example"), shared, CLIENTS, ctx)).toEqual([]);
  });

  test("hints read the right side of the booking; time signals need a Customer Success recorder", () => {
    const s = suggestionsFor(R.r192952366, [B.safad1015], CLIENTS, ctx);
    expect(s.map(x => [x.signal, x.minutes, x.why])).toEqual([["hint_window", 34, "34 min before Safad Consultant Engineering's booked call."]]);
    expect(suggestionsFor(R.r192975263, [B.safad1015], CLIENTS, ctx).map(x => x.why)).toEqual(["38 min after Safad Consultant Engineering's booked call."]);
    expect(suggestionsFor({ ...R.r192925234, recorderEmail: CEO, recorderTeam: SALES, cls: "client" }, [B.makers1015], CLIENTS, ctx)).toEqual([]);
  });

  test("the closest recording wins a booking, and is preselected only when no other recording was that close", () => {
    const a = rec("100000035", "10-15 09:57", 30, zoom(174), "candidate");
    const b = rec("100000036", "10-15 10:12", 30, zoom(175), "candidate");
    const res = rank(CARD.makers, [a, b], [B.makers1015], k("10-15 11:00"));
    expect(listed(res).filter(s => s.signal === "near_booking").map(s => [s.recordingId, s.preselect])).toEqual([["100000035", false]]);
    expect(res.picked).toBeNull();
    expect(res.others.map(s => [s.recordingId, s.signal])).toEqual([
      ["100000035", "near_booking"],
      ["100000036", "latest_unlinked"],
    ]);
  });

  test("the default: started after the client's last notes and within 12 hours", () => {
    const r = rec("100000037", "10-25 10:00", 30, zoom(176), "candidate");
    expect(rank(CARD.cityWood, [r], [], k("10-25 21:59")).picked?.signal).toBe("latest_unlinked");
    expect(rank(CARD.cityWood, [r], [], k("10-25 22:01")).picked).toBeNull();
    expect(rank(CARD.cityWood, [r], [], k("10-25 12:00"), { lastNoteAt: k("10-25 10:30") }).picked).toBeNull();
    expect(rank(CARD.cityWood, [r], [], k("10-25 12:00"), { lastNoteAt: k("10-25 09:30") }).picked?.recordingId).toBe("100000037");
  });

  test("a call that started before the client's last notes is listed but never preselected", () => {
    const r = rec("100000038", "10-25 10:00", 30, zoom(6), "candidate");
    const b = { ...B.cityWood1011, startsAt: k("10-25 10:00") };
    const res = rank(CARD.cityWood, [r], [b], k("10-25 12:00"), { lastNoteAt: k("10-25 10:45") });
    expect(res).toEqual({ picked: null, others: [expect.objectContaining({ recordingId: "100000038", signal: "same_room", preselect: false })] });
  });

  test("the why for each kind of booking, in Kuwait time", () => {
    const call = (kind: string) => {
      const b = { ...B.cityWood1011, kind };
      return suggestionsFor(rec("100000039", "10-11 13:02", 30, zoom(6), "candidate"), [b], CLIENTS, ctx)[0].why;
    };
    expect(call("checkin")).toBe("Same room as the check-in booked for 13:00.");
    expect(call("onboarding")).toBe("Same room as the onboarding call booked for 13:00.");
    expect(call("blueprint")).toBe("Same room as the Brand Blueprint call booked for 13:00.");
    expect(call("launch")).toBe("Same room as the launch call booked for 13:00.");
    expect(call("other")).toBe("Same room as the call booked for 13:00.");
  });

  test("suggestionsFor keeps the best per client, best first, at most 3", () => {
    const r = rec("100000040", "10-15 10:05", 30, zoom(177), "candidate", { title: "Makers, Ardon, Alkhalil and Atlantis" });
    const s = suggestionsFor(r, [B.makers1015], CLIENTS, ctx);
    expect(s.length).toBe(3);
    // Four clients named: the title outranks Makers' own near_booking, and equal ranks fall back to the card id.
    expect(s.map(x => [x.taskId, x.signal])).toEqual([
      [CARD.atlantis, "title"],
      [CARD.alkhalil, "title"],
      [CARD.ardon, "title"],
    ]);
  });

  test("no suggestion carries a contact name or an email", () => {
    const recs = WORLD.map(unlinked);
    const all = recs.flatMap(r => suggestionsFor({ ...r, speakers: ["Hala Sample", "Dana Example"] }, BOOKINGS, CLIENTS, ctx));
    for (const c of CLIENTS) all.push(...listed(rank(c.taskId, recs, BOOKINGS, k("10-15 12:00"))));
    expect(all.length).toBeGreaterThan(10);
    const text = JSON.stringify(all);
    for (const banned of ["Hala", "Dana", "@", "example"]) expect(text.includes(banned)).toBe(false);
  });
});
