import { beforeEach, describe, expect, test } from "bun:test";
import { suggestionsFor } from "../../../hermes/csm-calls/callMatch.ts";
import { type FathomHealthRow, fathomTools } from "../cockpit-csm-api/tools.ts";
import { RpcError } from "../cockpit-hours-sync/db.ts";
import { checkinCalls, NOT_FATHOM, OFF_ASK, OFF_NOTE, OFF_PASTE, tieAsks, WAITING_NOTE } from "./calls.ts";
import { makeDoor } from "./door.ts";
import { readFileSync } from "node:fs";
import { asInputs, clearTranscriptCache, ingestItem, kuwaitYesterday, matchCtx, NO_TRANSCRIPT, OUTSIDE_CS, OUTSIDE_CS_LIKELY, recordingOf, toRecording, transcriptOp } from "./fathom.ts";
import {
  adminActor,
  answer,
  booking,
  CEO_EMAIL,
  ceoActor,
  CLOSER_EMAIL,
  closerActor,
  CSM_EMAIL,
  csmActor,
  fakeDeps,
  fakeFetch,
  fathomApi,
  keyRow,
  matchInputs,
  meeting,
  NOW,
  opOf,
  SEAT_TOKEN,
  storeItem,
  TEAM_EMAIL,
  tiedRpc,
} from "./testkit.ts";

// ---------------------------------------------------------------- fathomTools (cockpit-csm-api/tools.ts, 6.3)

describe("fathomTools", () => {
  const rows = () => {
    const out: FathomHealthRow[] = [];
    return { out, health: async (r: FathomHealthRow) => void out.push(r) };
  };

  test("an empty key throws before anything leaves", () => {
    expect(() => fathomTools("", async () => {})).toThrow("FATHOM key is not configured");
  });

  test("the query keeps teams[] and recorded_by[] literal and encodes only values; GET with X-Api-Key, no redirects", async () => {
    const net = fakeFetch(fathomApi({ pages: [[]] }));
    const h = rows();
    await fathomTools("k-test", h.health, net.fetch).meetings({
      createdAfter: "2026-10-26T21:00:00.000Z",
      teams: ["Customer Success"],
      recordedBy: [CSM_EMAIL],
      includeActionItems: true,
      cursor: "abc/def",
    });
    const raw = net.sent[0].url;
    expect(raw).toContain("teams[]=Customer%20Success");
    expect(raw).toContain(`recorded_by[]=${encodeURIComponent(CSM_EMAIL)}`);
    expect(raw).toContain("created_after=2026-10-26T21%3A00%3A00.000Z");
    expect(raw).toContain("include_action_items=true");
    expect(raw).not.toContain("include_summary");
    expect(raw).not.toContain("include_transcript");
    expect(raw).toContain("cursor=abc%2Fdef");
    expect(net.sent[0].method).toBe("GET");
    expect(net.sent[0].headers["x-api-key"]).toBe("k-test");
  });

  test("the allow-list: meetings, users, a recording's summary or transcript by digits, nothing else", async () => {
    const t = fathomTools("k-test", async () => {}, fakeFetch(fathomApi()).fetch);
    expect(() => t.recording("1", "summary")).toThrow("Invalid Fathom resource");
    expect(() => t.recording("194756343/../webhooks", "summary")).toThrow("Invalid Fathom resource");
    expect(() => t.recording("194756343", "download" as "summary")).toThrow("Invalid Fathom resource");
    expect((await t.recording("194756343", "transcript")).kind).toBe("ok");
  });

  test("one intent row before and one response row after, the recording id collapsed", async () => {
    const h = rows();
    const t = fathomTools("k-test", h.health, fakeFetch(fathomApi()).fetch);
    await t.recording("194756343", "summary");
    await t.recording("194756343", "transcript");
    await t.meetings({ createdAfter: NOW.toISOString() });
    await t.users();
    expect(h.out.map(r => `${r.phase} ${r.resource} ${r.http_status ?? ""}`.trim())).toEqual([
      "intent api.fathom.ai/external/v1/recordings/:id/summary",
      "response api.fathom.ai/external/v1/recordings/:id/summary 200",
      "intent api.fathom.ai/external/v1/recordings/:id/transcript",
      "response api.fathom.ai/external/v1/recordings/:id/transcript 200",
      "intent api.fathom.ai/external/v1/meetings",
      "response api.fathom.ai/external/v1/meetings 200",
      "intent api.fathom.ai/external/v1/users",
      "response api.fathom.ai/external/v1/users 200",
    ]);
    expect(h.out.every(r => r.provider === "fathom" && r.method === "GET" && r.object_id === null)).toBe(true);
  });

  test("a receipt that cannot be saved stops the call", async () => {
    const net = fakeFetch(fathomApi());
    const t = fathomTools("k-test", async () => {
      throw new Error("no ledger");
    }, net.fetch);
    await expect(t.users()).rejects.toThrow("no ledger");
    expect(net.sent).toHaveLength(0);
  });

  test("429 is a refusal with retry-after and the rate headers; a 5xx, a timeout or unreadable JSON is unknown", async () => {
    const h = rows();
    const busy = await fathomTools("k", h.health, fakeFetch(fathomApi({ status: 429, retryAfter: "17" })).fetch).meetings({ createdAfter: "x" });
    expect(busy).toEqual({ kind: "refused", status: 429, retryAfter: 17, limit: { limit: 60, remaining: 55, reset: 40 } });
    expect(h.out[1]).toMatchObject({ phase: "response", http_status: 429 });

    const h5 = rows();
    expect(await fathomTools("k", h5.health, fakeFetch(fathomApi({ status: 503 })).fetch).meetings({ createdAfter: "x" })).toEqual({ kind: "unknown" });
    expect(h5.out[1]).toMatchObject({ phase: "unknown", http_status: 503 });

    const ht = rows();
    const timeout = fakeFetch(() => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    expect(await fathomTools("k", ht.health, timeout.fetch).users()).toEqual({ kind: "unknown" });
    expect(ht.out.map(r => r.phase)).toEqual(["intent", "unknown"]);

    const hj = rows();
    const garbled = fakeFetch(() => new Response("<html>", { status: 200 }));
    expect(await fathomTools("k", hj.health, garbled.fetch).users()).toEqual({ kind: "unknown" });
    expect(hj.out[1]).toMatchObject({ phase: "unknown", http_status: 200 });
  });

  test("meetings() drops items outside the teams or recorders asked for, and counts them", async () => {
    const pages = [[meeting(), meeting({ recording_id: 2, recorded_by: { email: "ceo.seat@maharamedia.com", team: "Sales" } })]];
    const byTeam = await fathomTools("k", async () => {}, fakeFetch(fathomApi({ pages })).fetch).meetings({ createdAfter: "x", teams: ["Customer Success"] });
    expect(byTeam.kind === "ok" && (byTeam.body.items as unknown[]).length).toBe(1);
    expect(byTeam.kind === "ok" && byTeam.body.dropped).toBe(1);
    const byPerson = await fathomTools("k", async () => {}, fakeFetch(fathomApi({ pages })).fetch).meetings({ createdAfter: "x", recordedBy: [CSM_EMAIL.toUpperCase()] });
    expect(byPerson.kind === "ok" && (byPerson.body.items as Record<string, unknown>[]).map(m => m.recording_id)).toEqual([194756343]);
    const all = await fathomTools("k", async () => {}, fakeFetch(fathomApi({ pages })).fetch).meetings({ createdAfter: "x" });
    expect(all.kind === "ok" && all.body.dropped).toBe(0);
  });
});

// ---------------------------------------------------------------- checkin.calls (6.4)

type Over = {
  inputs?: Record<string, unknown>;
  due?: Record<string, unknown>;
  key?: unknown;
  find?: unknown;
  routes?: NonNullable<Parameters<typeof fakeDeps>[0]>["routes"];
  /** Bookings the database holds that the window's MatchInputs leaves out (older than the window). */
  dbBookings?: Record<string, unknown>[];
};
function setup(o: Over = {}) {
  const inputs = matchInputs(o.inputs ?? {});
  const found = o.find && typeof o.find === "object" ? ((o.find as { store?: Record<string, any> }).store ?? null) : null;
  return fakeDeps({
    rpc: {
      cockpit_csm_client_gate_for_actor: { taskId: "86exCITYW", clientName: "City Wood" },
      cockpit_forms_key_get: o.key === undefined ? keyRow("fathom") : o.key,
      cockpit_fathom_match_inputs: inputs,
      cockpit_fathom_pull_due: o.due ?? { due: false, lastRunAt: "2026-10-28T08:59:30.000Z", ok: true, note: null },
      cockpit_fathom_ingest: (a: Record<string, any>) => ({ ok: true, meetings: a.p_items.length, calls: [] }),
      cockpit_fathom_pull_mark: { ok: true },
      cockpit_fathom_find_link: o.find ?? { found: false, fathom: false },
      cockpit_form_recordings_tied: tiedRpc({
        store: [...inputs.store, ...(found ? [found] : [])],
        bookings: [...inputs.bookings, ...(o.dbBookings ?? [])],
        formLinks: inputs.formLinks,
      }),
    },
    routes: o.routes ?? [fathomApi({ pages: [[]] })],
  });
}
const body = (over: Record<string, unknown> = {}) => ({ taskId: "86exCITYW", responseId: null, shareUrl: null, refresh: false, ...over });

describe("checkin.calls", () => {
  test("the client gate comes first, with the seat and the card", async () => {
    const f = setup();
    f.service.handlers.cockpit_csm_client_gate_for_actor = () => {
      throw new RpcError("That client is not on your access list", "42501");
    };
    await expect(checkinCalls(opOf(f.deps), body())).rejects.toThrow("That client is not on your access list");
    expect(f.service.calls.map(c => c.name)).toEqual(["cockpit_csm_client_gate_for_actor"]);
    expect(f.service.calls[0].args).toEqual({ p_actor: "11111111-1111-4111-8111-111111111111", p_task_id: "86exCITYW" });
  });

  test("the 60-second cache: not due, no Fathom call; the store still answers", async () => {
    const f = setup({ inputs: { store: [storeItem({ startsAt: "2026-10-28T08:00:00.000Z", endsAt: "2026-10-28T08:30:00.000Z" })] } });
    const a = await checkinCalls(opOf(f.deps), body());
    expect(f.sent).toHaveLength(0);
    expect(f.service.named("cockpit_fathom_ingest")).toHaveLength(0);
    expect(a.fathom).toEqual({ state: "ok", checkedAt: "2026-10-28T08:59:30.000Z", note: null });
    expect(a.picked?.recordingId).toBe("194756343");
  });

  test("due: one light read since 00:00 Kuwait yesterday, every item ingested as a pull, the pull marked", async () => {
    const items = [meeting(), meeting({ recording_id: 194756344, share_url: "https://fathom.video/share/TESTshareBBB2" })];
    const f = setup({ due: { due: true, lastRunAt: null, ok: null, note: null }, routes: [fathomApi({ pages: [items] })] });
    const a = await checkinCalls(opOf(f.deps), body());
    expect(f.sent).toHaveLength(1);
    const url = new URL(f.sent[0].url);
    expect(url.pathname).toBe("/external/v1/meetings");
    expect(url.searchParams.get("created_after")).toBe(kuwaitYesterday(NOW).toISOString());
    expect(url.searchParams.get("created_after")).toBe("2026-10-26T21:00:00.000Z");
    expect(url.searchParams.get("teams[]")).toBe("Customer Success");
    expect(url.searchParams.get("include_action_items")).toBe("true");
    expect(url.searchParams.has("include_summary")).toBe(false);
    expect(url.searchParams.has("include_transcript")).toBe(false);
    const ingest = f.service.named("cockpit_fathom_ingest");
    expect(ingest).toHaveLength(1);
    expect(ingest[0].args.p_via).toBe("pull");
    expect((ingest[0].args.p_items as unknown[]).length).toBe(2);
    expect(f.service.named("cockpit_fathom_pull_mark")[0].args).toEqual({ p_ok: true, p_items: 2, p_note: "2 Customer Success recordings since 00:00 yesterday." });
    expect(f.service.named("cockpit_fathom_match_inputs")).toHaveLength(2);
    expect(a.fathom).toEqual({ state: "ok", checkedAt: NOW.toISOString(), note: null });
    expect(f.health.every(r => String(r.run_key).startsWith("pull:") && r.action_id === null)).toBe(true);
  });

  test("up to 3 pages, following next_cursor", async () => {
    const f = setup({ due: { due: true }, routes: [fathomApi({ pages: [[meeting()], [meeting({ recording_id: 2002 })], [meeting({ recording_id: 3003 })], [meeting({ recording_id: 4004 })]] })] });
    await checkinCalls(opOf(f.deps), body());
    expect(f.sent).toHaveLength(3);
    expect(new URL(f.sent[1].url).searchParams.get("cursor")).toBe("cursor-1");
  });

  test("every fathom state: busy on 429, failed on another refusal or no answer, off with no key; the store still answers", async () => {
    const busy = await checkinCalls(opOf(setup({ due: { due: true }, routes: [fathomApi({ status: 429, retryAfter: "30" })] }).deps), body());
    expect(busy.fathom).toEqual({ state: "busy", checkedAt: NOW.toISOString(), note: "Fathom is busy. Check again in a minute." });
    const refused = await checkinCalls(opOf(setup({ due: { due: true }, routes: [fathomApi({ status: 403 })] }).deps), body());
    expect(refused.fathom.state).toBe("failed");
    expect(refused.fathom.note).toBe("Fathom could not be read just now (403).");
    const f = setup({ due: { due: true }, routes: [fathomApi({ status: 502 })] });
    const down = await checkinCalls(opOf(f.deps), body());
    expect(down.fathom.note).toBe("Fathom could not be read just now (no answer).");
    expect(f.service.named("cockpit_fathom_pull_mark")[0].args).toMatchObject({ p_ok: false, p_items: 0 });
    // No key in the vault: no pull, but the store the worker fills with its own key still answers (A3).
    const off = setup({ key: null, inputs: { bookings: [booking({ startsAt: "2026-10-28T08:00:00.000Z" })], store: [storeItem()] } });
    const a = await checkinCalls(opOf(off.deps), body());
    expect(a.fathom).toEqual({ state: "off", checkedAt: null, note: `${OFF_NOTE} ${OFF_ASK}` });
    expect(a.picked).toMatchObject({ recordingId: "194756343", why: "latest_unlinked", label: "default" });
    expect(a.others.map(v => v.ref)).toEqual(["booking:54460"]);
    expect(off.sent).toHaveLength(0);
    expect(off.service.named("cockpit_fathom_pull_due")).toHaveLength(0);
  });

  test("a last pull that failed shows until the next one is due", async () => {
    const f = setup({ due: { due: false, lastRunAt: "2026-10-28T08:59:55.000Z", ok: false, note: "Fathom is busy. Check again in a minute." } });
    expect((await checkinCalls(opOf(f.deps), body())).fathom.state).toBe("busy");
  });

  test("waiting: a booking started in the last 3 hours and no recording picked", async () => {
    const f = setup({ inputs: { bookings: [booking({ startsAt: "2026-10-28T08:30:00.000Z", room: "meet:kln-opqr-stu" })] } });
    const a = await checkinCalls(opOf(f.deps), body());
    expect(a.picked).toBeNull();
    expect(a.fathom).toEqual({ state: "waiting", checkedAt: "2026-10-28T08:59:30.000Z", note: WAITING_NOTE });
    expect(a.others[0]).toMatchObject({ ref: "booking:54460", kind: "booking", label: "booking", why: "booking", whyText: "The check-in booked for 11:30. No recording found for it." });
    // A booking view names no recorder (A7.3).
    expect(a.others[0]).toMatchObject({ recorder: null, recorderRole: null, blocked: null });
  });

  test("a booking that has not started, or was cancelled, gives no booking view", async () => {
    const f = setup({
      inputs: {
        bookings: [
          booking({ id: 1, startsAt: "2026-10-28T10:00:00.000Z" }),
          booking({ id: 2, status: "cancelled", startsAt: "2026-10-28T06:00:00.000Z" }),
          booking({ id: 3, startsAt: "2026-10-27T06:00:00.000Z", kind: "onboarding" }),
        ],
      },
    });
    const a = await checkinCalls(opOf(f.deps), body());
    expect(a.others.map(v => v.ref)).toEqual(["booking:3"]);
    expect(a.others[0].whyText).toBe("The onboarding call booked for 09:00. No recording found for it.");
  });

  test("the same room picks the recording, links its booking and gives no booking view for it", async () => {
    const f = setup({
      inputs: {
        bookings: [booking({ room: "meet:abc-defg-hij", startsAt: "2026-10-28T07:00:00.000Z" })],
        store: [storeItem({ room: "meet:abc-defg-hij", startsAt: "2026-10-28T07:04:00.000Z" })],
      },
    });
    const a = await checkinCalls(opOf(f.deps), body());
    expect(a.picked).toMatchObject({ why: "same_room", label: "exact", ask: false, whyText: "Same room as the check-in booked for 10:00.", callId: 9001 });
    expect(a.picked?.booking).toEqual({ callId: 54460, startsAt: "2026-10-28T07:00:00.000Z", kind: "checkin", status: "confirmed" });
    expect(a.others.find(v => v.kind === "booking")).toBeUndefined();
  });

  test("the default reads Your for its recorder and The CSM's for an admin; the recorder's role comes from staff", async () => {
    const inputs = { store: [storeItem({ startsAt: "2026-10-28T07:34:00.000Z", endsAt: "2026-10-28T08:10:00.000Z" })] };
    const mine = await checkinCalls(opOf(setup({ inputs }).deps), body());
    expect(mine.picked).toMatchObject({ why: "latest_unlinked", label: "default", ask: true, minutes: 36, recorder: "csm", recorderRole: "the CSM" });
    expect(mine.picked?.whyText).toBe("Your newest call that no client has yet (Wed 28 Oct, 10:34). Is this the call?");
    const theirs = await checkinCalls(opOf(setup({ inputs }).deps, adminActor), body());
    expect(theirs.picked?.whyText).toBe("The CSM's newest call that no client has yet (Wed 28 Oct, 10:34). Is this the call?");
  });

  test("possible: the 8.5 card copy, Your for the recorder's own seat, else the recorder's role", async () => {
    const inputs = (recorderEmail: string) => ({
      bookings: [booking({ startsAt: "2026-10-28T07:30:00.000Z" })],
      store: [storeItem({ startsAt: "2026-10-28T07:34:00.000Z", recorderEmail })],
    });
    const mine = await checkinCalls(opOf(setup({ inputs: inputs(CSM_EMAIL) }).deps), body());
    expect(mine.picked).toMatchObject({ why: "near_booking", label: "possible", ask: true, recorder: "csm", recorderRole: "the CSM", blocked: null });
    expect(mine.picked?.whyText).toBe("Your recording 4 minutes after the check-in booked for 10:30. Is this the call?");
    const read = await checkinCalls(opOf(setup({ inputs: inputs(CSM_EMAIL) }).deps, adminActor), body());
    expect(read.picked?.whyText).toBe("The CSM's recording 4 minutes after the check-in booked for 10:30. Is this the call?");
    const team = await checkinCalls(opOf(setup({ inputs: inputs(TEAM_EMAIL) }).deps), body());
    expect(team.picked).toMatchObject({ why: "near_booking", label: "possible", ask: true, recorder: "team", recorderRole: "the creative director" });
    expect(team.picked?.whyText).toBe("The creative director's recording 4 minutes after the check-in booked for 10:30. Is this the call?");
  });

  test("a hint keeps 5.2's words, before or after its booking", async () => {
    const inputs = {
      bookings: [booking({ startsAt: "2026-10-28T07:00:00.000Z" })],
      store: [
        storeItem({ recordingId: "192952366", startsAt: "2026-10-28T06:26:00.000Z", endsAt: "2026-10-28T06:50:00.000Z", recorderEmail: TEAM_EMAIL }),
        storeItem({ recordingId: "192084146", startsAt: "2026-10-28T07:43:00.000Z", endsAt: "2026-10-28T08:10:00.000Z", recorderEmail: TEAM_EMAIL }),
      ],
    };
    const a = await checkinCalls(opOf(setup({ inputs }).deps), body());
    expect(a.picked).toBeNull();
    const hints = a.others.filter(v => v.why === "hint_window");
    expect(hints.map(v => [v.recordingId, v.label, v.ask, v.whyText])).toEqual([
      ["192084146", "hint", false, "43 min after City Wood's booked call."],
      ["192952366", "hint", false, "34 min before City Wood's booked call."],
    ]);
  });

  test("the exact and likely cards: the client on the invite, the title", async () => {
    const invite = {
      bookings: [booking({ startsAt: "2026-10-28T07:00:00.000Z" })],
      store: [storeItem({ startsAt: "2026-10-28T07:02:00.000Z", inviteeEmails: [CSM_EMAIL, "owner@citywood.example"] })],
    };
    const a = await checkinCalls(opOf(setup({ inputs: invite }).deps), body());
    expect(a.picked).toMatchObject({ why: "invitee_email", label: "exact", ask: false, whyText: "The client was on the invite.", blocked: null });
    expect(a.picked?.booking?.callId).toBe(54460);
    expect(a.others.find(v => v.kind === "booking")).toBeUndefined();
    const titled = { store: [storeItem({ title: "City Wood weekly review", startsAt: "2026-10-28T07:34:00.000Z", recorderEmail: TEAM_EMAIL })] };
    const b = await checkinCalls(opOf(setup({ inputs: titled }).deps), body());
    expect(b.picked).toMatchObject({ why: "title", label: "likely", ask: true, whyText: "The title names City Wood. Is this the call?" });
  });

  test("notesAlready is the store's notes; a recording with no sign has no why line; one on another client is blocked", async () => {
    const inputs = {
      store: [
        storeItem({ recordingId: "191603145", startsAt: "2026-10-28T06:00:00.000Z", notes: { at: "2026-10-28T06:50:00.000Z", source: "typeform" }, onTask: "86exCITYW", onTaskMethod: "same_room" }),
        storeItem({ recordingId: "191610368", startsAt: "2026-10-28T05:00:00.000Z", recorderEmail: TEAM_EMAIL, shareUrl: "https://fathom.video/share/TESTshareCCC3" }),
        storeItem({ recordingId: "191610999", startsAt: "2026-10-28T04:00:00.000Z", onTask: "86exMARBL", onTaskMethod: "invitee_email", shareUrl: "https://fathom.video/share/TESTshareDDD4" }),
        storeItem({ recordingId: "191611000", class: "internal", startsAt: "2026-10-28T03:00:00.000Z" }),
        storeItem({ recordingId: "191611001", gone: true, startsAt: "2026-10-28T02:00:00.000Z" }),
      ],
    };
    const a = await checkinCalls(opOf(setup({ inputs }).deps), body());
    const all = [a.picked, ...a.others].filter(Boolean);
    expect(all.map(v => v?.recordingId)).toEqual(["191603145", "191610368", "191610999"]);
    expect(all[0]).toMatchObject({
      why: "matched",
      label: "exact",
      whyText: "On City Wood in the call store.",
      onClient: "this",
      blocked: null,
      notesAlready: { at: "2026-10-28T06:50:00.000Z", source: "typeform" },
    });
    expect(all[1]).toMatchObject({ why: "picked", label: "hint", ask: false, whyText: "", onClient: "none", recorder: "team", blocked: null });
    expect(all[2]).toMatchObject({
      why: "picked",
      label: "hint",
      ask: false,
      whyText: "",
      onClient: "other",
      otherClient: "Marble 10-12",
      blocked: "On Marble 10-12. If that is wrong, ask an admin to move it.",
    });
  });

  test("a settled recording is not blocked: listed with no why line, never the default, still picked when pasted", async () => {
    const item = storeItem({ settled: true, startsAt: "2026-10-28T07:34:00.000Z" });
    const a = await checkinCalls(opOf(setup({ inputs: { store: [item] } }).deps), body());
    expect(a.picked).toBeNull();
    expect(a.others).toHaveLength(1);
    expect(a.others[0]).toMatchObject({ recordingId: "194756343", why: "picked", label: "hint", whyText: "", blocked: null });
    const pasted = await checkinCalls(opOf(setup({ inputs: { store: [item] }, find: { found: true, store: item } }).deps), body({ shareUrl: "https://fathom.video/share/TESTshareAAA1" }));
    expect(pasted.picked).toMatchObject({ recordingId: "194756343", why: "pasted", label: "exact", blocked: null });
  });

  test("a recording that cannot be picked leaves its booking offered", async () => {
    const bookings = [booking({ startsAt: "2026-10-28T07:00:00.000Z" })];
    const gone = await checkinCalls(opOf(setup({ inputs: { bookings, store: [storeItem({ gone: true, linkedCallId: 54460, startsAt: "2026-10-28T07:02:00.000Z" })] } }).deps), body());
    expect(gone.picked).toBeNull();
    expect(gone.others.map(v => v.ref)).toEqual(["booking:54460"]);
    const theirs = storeItem({ onTask: "86exMARBL", onTaskMethod: "manual", linkedCallId: 54460, startsAt: "2026-10-28T07:02:00.000Z" });
    const elsewhere = await checkinCalls(opOf(setup({ inputs: { bookings, store: [theirs] } }).deps), body());
    expect(elsewhere.picked).toBeNull();
    expect(elsewhere.others.map(v => [v.ref, v.blocked])).toEqual([
      ["fathom:194756343", "On Marble 10-12. If that is wrong, ask an admin to move it."],
      ["booking:54460", null],
    ]);
  });

  test("no contact name, contact email or invitee email in any view", async () => {
    const inputs = {
      bookings: [booking({ startsAt: "2026-10-28T07:30:00.000Z" })],
      store: [storeItem({ startsAt: "2026-10-28T07:34:00.000Z", inviteeEmails: [CSM_EMAIL, "owner@citywood.example"] })],
    };
    const text = JSON.stringify(await checkinCalls(opOf(setup({ inputs }).deps), body()));
    expect(text).not.toContain("owner@citywood.example");
    expect(text).not.toContain("Omar");
    expect(text).not.toContain(CSM_EMAIL);
  });

  test("a pasted link: looked up as pasted (any query, a /calls/ link, three days old), never in an item or a task_id", async () => {
    const old = storeItem({ recordingId: "190000001", startsAt: "2026-10-25T07:00:00.000Z", endsAt: "2026-10-25T07:30:00.000Z", shareUrl: "https://fathom.video/share/TESTshareOLD9" });
    for (const pastedUrl of [
      "https://fathom.video/share/TESTshareOLD9?timestamp=123",
      "https://fathom.video/share/TESTshareOLD9?tab=summary",
      "https://fathom.video/share/TESTshareOLD9/",
      "https://fathom.video/calls/500000009",
    ]) {
      const f = setup({ due: { due: true }, find: () => ({ found: true, store: old }), routes: [fathomApi({ pages: [[meeting()]] })] });
      const a = await checkinCalls(opOf(f.deps), body({ shareUrl: pastedUrl, refresh: true }));
      expect(f.service.named("cockpit_fathom_find_link")[0].args).toEqual({ p_url: pastedUrl });
      const view = [a.picked, ...a.others].find(v => v?.why === "pasted");
      expect(view).toMatchObject({ recordingId: "190000001", label: "exact", whyText: "From the Fathom link you pasted." });
      const items = f.service.named("cockpit_fathom_ingest").flatMap(c => c.args.p_items as Record<string, any>[]);
      expect(JSON.stringify(items)).not.toContain("TESTshareOLD9");
      expect(items.every(i => i.call?.task_id == null)).toBe(true);
    }
  });

  test("a link that is not Fathom's is refused with its sentence", async () => {
    const f = setup({ find: { found: false, fathom: false } });
    await expect(checkinCalls(opOf(f.deps), body({ shareUrl: "https://zoom.us/rec/share/abc" }))).rejects.toThrow(NOT_FATHOM);
    expect(f.sent).toHaveLength(0);
  });

  test("a Fathom link the store does not hold: one pull when the last is over 10 s old, the lookup again, then nothing pasted", async () => {
    let looked = 0;
    const f = setup({
      due: { due: false, lastRunAt: "2026-10-28T08:59:40.000Z", ok: true },
      find: () => (++looked, { found: false, fathom: true }),
      routes: [fathomApi({ pages: [[meeting()]] })],
    });
    const a = await checkinCalls(opOf(f.deps), body({ shareUrl: "https://fathom.video/share/TESTshareNEW1", refresh: true }));
    expect(looked).toBe(2);
    expect(f.sent).toHaveLength(1);
    expect([a.picked, ...a.others].some(v => v?.why === "pasted")).toBe(false);
    const recent = setup({ due: { due: false, lastRunAt: "2026-10-28T08:59:55.000Z", ok: true }, find: { found: false, fathom: true } });
    await checkinCalls(opOf(recent.deps), body({ shareUrl: "https://fathom.video/share/TESTshareNEW1", refresh: true }));
    expect(recent.sent).toHaveLength(0);
  });

  test("the view a pasted link found reads pasted, even when the same room also names its booking", async () => {
    const item = storeItem({ room: "meet:abc-defg-hij", startsAt: "2026-10-28T07:04:00.000Z" });
    const inputs = { bookings: [booking({ room: "meet:abc-defg-hij", startsAt: "2026-10-28T07:00:00.000Z" })], store: [item] };
    const a = await checkinCalls(opOf(setup({ inputs, find: { found: true, store: item } }).deps), body({ shareUrl: "https://fathom.video/share/TESTshareAAA1?timestamp=12" }));
    expect(a.picked).toMatchObject({ recordingId: "194756343", why: "pasted", label: "exact", ask: false, whyText: "From the Fathom link you pasted.", blocked: null });
    expect(a.picked?.booking?.callId).toBe(54460);
    expect(a.others.find(v => v.kind === "booking")).toBeUndefined();
  });

  test("a pasted recording that cannot be picked: why pasted, the save's sentence in blocked, never picked", async () => {
    const pastedView = async (over: Record<string, unknown>) => {
      const item = storeItem({ recordingId: "190000002", shareUrl: "https://fathom.video/share/TESTshareMRB1", ...over });
      const a = await checkinCalls(opOf(setup({ find: { found: true, store: item } }).deps), body({ shareUrl: "https://fathom.video/share/TESTshareMRB1" }));
      expect(a.picked).toBeNull();
      const found = a.others.filter(v => v.why === "pasted");
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ recordingId: "190000002", label: "hint", ask: false, whyText: "" });
      return found[0];
    };
    const team = "That recording is a team meeting, not a client call.";
    const gone = "Fathom no longer has that recording. Pick another call.";
    expect(await pastedView({ onTask: "86exMARBL", onTaskMethod: "manual" })).toMatchObject({
      onClient: "other",
      otherClient: "Marble 10-12",
      blocked: "On Marble 10-12. If that is wrong, ask an admin to move it.",
    });
    expect((await pastedView({ class: "internal" })).blocked).toBe(team);
    expect((await pastedView({ class: "sales" })).blocked).toBe(team);
    expect((await pastedView({ gone: true })).blocked).toBe(gone);
    // In the order the save checks them (3.2): gone, then the class, then the other client.
    expect((await pastedView({ gone: true, class: "internal", onTask: "86exMARBL" })).blocked).toBe(gone);
    expect((await pastedView({ class: "sales", onTask: "86exMARBL", onTaskMethod: "manual" })).blocked).toBe(team);
  });

  test("the view a pasted link found leads the list, ahead of a call whose link is in an earlier 1-1 form (also why pasted)", async () => {
    const inputs = {
      formLinks: [{ shareUrl: "https://fathom.video/share/TESTshareFRM1", taskId: "86exCITYW" }],
      client: { taskId: "86exCITYW", name: "City Wood", lastNoteAt: "2026-10-27T08:00:00.000Z", onClient: [] },
      store: [storeItem({ recordingId: "191700001", shareUrl: "https://fathom.video/share/TESTshareFRM1", startsAt: "2026-10-27T07:00:00.000Z", endsAt: "2026-10-27T07:40:00.000Z" })],
    };
    const team = storeItem({ recordingId: "190000003", class: "internal", shareUrl: "https://fathom.video/share/TESTshareINT1" });
    const a = await checkinCalls(opOf(setup({ inputs, find: { found: true, store: team } }).deps), body({ shareUrl: "https://fathom.video/share/TESTshareINT1" }));
    expect(a.picked).toBeNull();
    expect(a.others.map(v => [v.recordingId, v.why, v.blocked])).toEqual([
      ["190000003", "pasted", "That recording is a team meeting, not a client call."],
      ["191700001", "pasted", null],
    ]);
    expect(a.others[1]).toMatchObject({ label: "exact", whyText: "From the link in an earlier 1-1 form." });
    // What the window does with the answer: the first view that reads pasted is the one the link found.
    expect([a.picked, ...a.others].find(v => v?.why === "pasted")?.recordingId).toBe("190000003");
  });

  test("Check again pulls when the last pull is over 10 s old, never within 10 s", async () => {
    const old = setup({ due: { due: false, lastRunAt: "2026-10-28T08:59:45.000Z", ok: true } });
    await checkinCalls(opOf(old.deps), body({ refresh: true }));
    expect(old.sent).toHaveLength(1);
    const fresh = setup({ due: { due: false, lastRunAt: "2026-10-28T08:59:52.000Z", ok: true } });
    await checkinCalls(opOf(fresh.deps), body({ refresh: true }));
    expect(fresh.sent).toHaveLength(0);
  });

  test("a recording collapsed into its copy is listed once", async () => {
    const inputs = {
      store: [
        storeItem({ recordingId: "194756343", room: "meet:abc-defg-hij", startsAt: "2026-10-28T07:34:00.000Z" }),
        storeItem({ recordingId: "194756350", room: "meet:abc-defg-hij", startsAt: "2026-10-28T07:36:00.000Z", recorderEmail: "ceo.seat@maharamedia.com", recorderTeam: "Sales", class: "client" }),
      ],
    };
    const a = await checkinCalls(opOf(setup({ inputs }).deps), body());
    expect([a.picked, ...a.others].map(v => v?.recordingId)).toEqual(["194756343"]);
  });
});

// ---------------------------------------------------------------- the pull's items (3.6)

describe("the ingest item", () => {
  const inputs = (over: Record<string, unknown> = {}) => asInputs(matchInputs(over));

  test("the 3.6 keys only: a candidate with no client carries its hints and candidate true", () => {
    const item = ingestItem(meeting(), inputs({ bookings: [booking({ startsAt: "2026-10-28T07:10:00.000Z" })] }), NOW);
    expect(Object.keys(item.meeting).sort()).toEqual(
      ["class", "ends_at", "external", "invitees", "raw", "recorded_by_email", "recorded_by_name", "recorder_team", "recording_id", "room", "share_url", "starts_at", "summary", "title", "url"].sort(),
    );
    expect(item.meeting).toMatchObject({ recording_id: "194756343", class: "candidate", room: "meet:abc-defg-hij", recorder_team: "Customer Success" });
    expect(Object.keys(item.call ?? {}).sort()).toEqual(
      ["candidate", "client_name", "ends_at", "external_invitees", "hints", "host_email", "host_name", "kind", "linked_call_id", "match_confidence", "match_method", "recording_url", "room", "source_id", "starts_at", "summary", "task_id", "title"].sort(),
    );
    expect(item.call).toMatchObject({ task_id: null, candidate: true, linked_call_id: null });
    expect((item.call?.hints as Record<string, unknown>[])[0]).toMatchObject({ taskId: "86exCITYW", clientName: "City Wood", signal: "near_booking" });
    expect(JSON.stringify(item.call?.hints)).not.toContain("Omar");
  });

  // One mapping from exactMatch to the match block for the worker, the webhook and the pull (A7.2).
  test("the same room: same_room at 1, linked to its booking, with the booking's kind", () => {
    const b = booking({ id: 54462, kind: "blueprint", room: "meet:abc-defg-hij", startsAt: "2026-10-28T06:58:00.000Z" });
    const item = ingestItem(meeting(), inputs({ bookings: [b] }), NOW);
    expect(item.call).toMatchObject({ task_id: "86exCITYW", client_name: "City Wood", match_method: "same_room", match_confidence: 1, linked_call_id: 54462, kind: "blueprint", candidate: false, hints: [] });
  });

  test("the client on the invite of a booking within 30 minutes: appointment_time at 1, linked to it, with its kind", () => {
    const m = meeting({ calendar_invitees: [{ email: CSM_EMAIL, is_external: false }, { email: " Owner@CityWood.example ", is_external: true }] });
    const b = booking({ id: 54470, kind: "onboarding", startsAt: "2026-10-28T07:10:00.000Z" });
    const item = ingestItem(m, inputs({ bookings: [b] }), NOW);
    expect(item.meeting.class).toBe("client");
    expect(item.call).toMatchObject({ task_id: "86exCITYW", client_name: "City Wood", match_method: "appointment_time", match_confidence: 1, linked_call_id: 54470, kind: "onboarding", candidate: false, hints: [] });
  });

  test("the client on the invite with no booking within 30 minutes: invitee_email at 0.9, no link, the title's kind", () => {
    const m = meeting({ title: "Weekly check-in", calendar_invitees: [{ email: "owner@citywood.example", is_external: true }] });
    const b = booking({ id: 54471, kind: "onboarding", startsAt: "2026-10-27T07:00:00.000Z" });
    const item = ingestItem(m, inputs({ bookings: [b] }), NOW);
    expect(item.call).toMatchObject({ task_id: "86exCITYW", client_name: "City Wood", match_method: "invitee_email", match_confidence: 0.9, linked_call_id: null, kind: "checkin", candidate: false, hints: [] });
  });

  test("a stored 1-1 form link: form_task_id at 0.95, no booking, the title's kind", () => {
    const item = ingestItem(meeting({ title: "1-1 call" }), inputs({ formLinks: [{ shareUrl: "https://fathom.video/share/TESTshareAAA1", taskId: "86exMARBL" }] }), NOW);
    expect(item.call).toMatchObject({ task_id: "86exMARBL", client_name: "Marble 10-12", match_method: "form_task_id", match_confidence: 0.95, linked_call_id: null, kind: "checkin", candidate: false, hints: [] });
  });

  // A7.12: hints only on a candidate nothing places; client_name from the named booking; the edited title only.
  /** A call whose edited title names City Wood, with an invitee on no booking: Fathom flags the invitee external or not. */
  const unplaced = (external: boolean, over: Record<string, unknown> = {}) =>
    meeting({
      title: "City Wood weekly review",
      calendar_invitees: [
        { email: CSM_EMAIL, is_external: false },
        { email: "frontdesk@otherco.example", is_external: external },
      ],
      ...over,
    });
  /** City Wood's check-in 10 minutes after the recording starts, in no room. */
  const bookedNear = () => inputs({ bookings: [booking({ startsAt: "2026-10-28T07:10:00.000Z" })] });
  const signals = (call: Record<string, unknown> | null) => (call?.hints as Record<string, unknown>[]).map(h => [h.taskId, h.signal]);

  test("A7.12: a client-class recording nothing places carries no hints; the same call as a candidate carries them", () => {
    const client = ingestItem(unplaced(true), bookedNear(), NOW);
    expect(client.meeting.class).toBe("client");
    expect(client.call).toMatchObject({ task_id: null, client_name: null, match_method: null, match_confidence: null, linked_call_id: null, candidate: false, hints: [] });
    // The title and the booking 10 minutes away both point at City Wood: a candidate carries its best sign.
    const candidate = ingestItem(unplaced(false), bookedNear(), NOW);
    expect(candidate.meeting.class).toBe("candidate");
    expect(candidate.call).toMatchObject({ task_id: null, candidate: true });
    expect(signals(candidate.call)).toEqual([["86exCITYW", "title"]]);
  });

  test("A7.12: the pull writes it the same way from the light list", async () => {
    const candidate = unplaced(false, { recording_id: 194756344, share_url: "https://fathom.video/share/TESTshareBBB2" });
    const f = setup({
      due: { due: true },
      inputs: { bookings: [booking({ startsAt: "2026-10-28T07:10:00.000Z" })] },
      routes: [fathomApi({ pages: [[unplaced(true), candidate]] })],
    });
    await checkinCalls(opOf(f.deps), body());
    const items = f.service.named("cockpit_fathom_ingest").flatMap(c => c.args.p_items as Record<string, any>[]);
    expect(items.map(i => [i.meeting.recording_id, i.meeting.class, i.call?.task_id, i.call?.candidate, signals(i.call)])).toEqual([
      ["194756343", "client", null, false, []],
      ["194756344", "candidate", null, true, [["86exCITYW", "title"]]],
    ]);
  });

  test("A7.12: client_name falls back to the named booking's when the list lacks the client or its name, and is never guessed", () => {
    const b = booking({ id: 54480, taskId: "86exALKHL", clientName: "Alkhalil", room: "meet:abc-defg-hij", startsAt: "2026-10-28T06:58:00.000Z" });
    const missing = ingestItem(meeting(), inputs({ bookings: [b] }), NOW);
    expect(missing.call).toMatchObject({ task_id: "86exALKHL", client_name: "Alkhalil", match_method: "same_room", match_confidence: 1, linked_call_id: 54480, candidate: false, hints: [] });
    const nameless = inputs({ bookings: [b], clients: [{ taskId: "86exALKHL", name: "", aliases: [] }] });
    expect(ingestItem(meeting(), nameless, NOW).call?.client_name).toBe("Alkhalil");
    // A name on the clients list wins over the booking's.
    const renamed = booking({ id: 54481, clientName: "City Wood booking label", room: "meet:abc-defg-hij", startsAt: "2026-10-28T06:58:00.000Z" });
    expect(ingestItem(meeting(), inputs({ bookings: [renamed] }), NOW).call).toMatchObject({ task_id: "86exCITYW", client_name: "City Wood" });
    // A form link names no booking: a client missing from the list stays nameless.
    const linkOnly = ingestItem(meeting(), inputs({ formLinks: [{ shareUrl: "https://fathom.video/share/TESTshareAAA1", taskId: "86exALKHL" }] }), NOW);
    expect(linkOnly.call).toMatchObject({ task_id: "86exALKHL", client_name: null, match_method: "form_task_id", linked_call_id: null, hints: [] });
  });

  test("A7.12: the edited title only: a calendar title that names a client gives no title hint, the edited one does", () => {
    const calendarOnly = meeting({ title: "Impromptu Google Meet Meeting", meeting_title: "City Wood check-in" });
    expect(recordingOf(calendarOnly, "candidate")).toMatchObject({ title: "Impromptu Google Meet Meeting", meetingTitle: "City Wood check-in" });
    expect(ingestItem(calendarOnly, inputs(), NOW).call).toMatchObject({ candidate: true, hints: [] });
    const untitled = meeting({ title: null, meeting_title: "City Wood check-in" });
    expect(recordingOf(untitled, "candidate")).toMatchObject({ title: null, meetingTitle: "City Wood check-in" });
    expect(ingestItem(untitled, inputs(), NOW).call).toMatchObject({ candidate: true, hints: [] });
    const edited = meeting({ title: "City Wood check-in", meeting_title: "Impromptu Google Meet Meeting" });
    const hints = ingestItem(edited, inputs(), NOW).call?.hints as Record<string, unknown>[];
    expect(hints.map(h => [h.taskId, h.signal, h.why])).toEqual([["86exCITYW", "title", "The title names City Wood."]]);
  });

  test("A7.13: the pull's client on the invite names only a listed client, unless that client's booking is within 30 minutes", () => {
    expect(matchCtx(inputs(), NOW.getTime()).clientIds).toEqual(["86exCITYW", "86exMARBL"]);
    const m = meeting({ calendar_invitees: [{ email: CSM_EMAIL, is_external: false }, { email: "owner@unlisted.example", is_external: true }] });
    const unlisted = (startsAt: string) => booking({ id: 54490, taskId: "86exUNLST", clientName: "Unlisted Co", emails: ["owner@unlisted.example"], startsAt });
    // 75 minutes away: the email alone would name the client, but it is not on the list.
    const far = ingestItem(m, inputs({ bookings: [unlisted("2026-10-28T08:15:00.000Z")] }), NOW);
    expect(far.meeting.class).toBe("client");
    expect(far.call).toMatchObject({ task_id: null, client_name: null, match_method: null, linked_call_id: null, hints: [] });
    // 10 minutes away: the booking names its client, listed or not, and gives its name.
    const near = ingestItem(m, inputs({ bookings: [unlisted("2026-10-28T07:10:00.000Z")] }), NOW);
    expect(near.call).toMatchObject({ task_id: "86exUNLST", client_name: "Unlisted Co", match_method: "appointment_time", match_confidence: 1, linked_call_id: 54490 });
  });

  test("the recording's invitee emails: every calendar invitee's, trimmed and lower-cased, once", () => {
    const m = meeting({
      calendar_invitees: [
        { email: " Owner@CityWood.example ", is_external: true },
        { email: "owner@citywood.example", is_external: true },
        { email: CSM_EMAIL.toUpperCase(), is_external: false },
        { email: "", is_external: false },
        { is_external: true },
      ],
    });
    expect(recordingOf(m, "client").inviteeEmails).toEqual(["owner@citywood.example", CSM_EMAIL]);
  });

  test("a recording whose only link is a shadow pick gets no client (shadow runs never feed formLinks)", () => {
    const item = ingestItem(meeting(), inputs({ formLinks: [] }), NOW);
    expect(item.call?.task_id).toBeNull();
    expect(item.call?.match_method).toBeNull();
  });

  test("an internal meeting is stored without its content and gets no call", () => {
    const m = meeting({ calendar_invitees_domains_type: "only_internal", default_summary: { markdown_formatted: "Private team summary" }, action_items: [{ description: "Team only" }] });
    const item = ingestItem(m, inputs(), NOW);
    expect(item.call).toBeNull();
    expect(item.meeting.class).toBe("internal");
    expect(item.meeting.summary).toBeNull();
    expect(JSON.stringify(item.meeting)).not.toContain("Private team summary");
    expect(JSON.stringify(item.meeting)).not.toContain("Team only");
  });
});

test("a pull answer is the live JSON of the fake API (sanity)", async () => {
  const r = answer({ a: 1 });
  expect(await r.json()).toEqual({ a: 1 });
});

// ---------------------------------------------------------------- the review's cases (Stage 2a round 2)

describe("checkin.calls: no Fathom key in the vault (A3)", () => {
  test("the CEO's note says where to paste the key; any other seat's says to ask him", async () => {
    const ceo = await checkinCalls(opOf(setup({ key: null }).deps, ceoActor), body());
    expect(ceo.fathom.note).toBe(`${OFF_NOTE} ${OFF_PASTE}`);
    expect(ceo.fathom.note).toBe("Fathom isn't connected, so calls come only from the 15-minute read. Paste the Fathom key in CEO > Client success > Connections for 1-1 notes.");
    const csm = await checkinCalls(opOf(setup({ key: null }).deps), body());
    expect(csm.fathom.note).toBe("Fathom isn't connected, so calls come only from the 15-minute read. Ask the CEO to connect it.");
  });

  test("a pasted link is still looked up in the store: found and picked as pasted, a link that is not Fathom's refused, an unknown one looked up once", async () => {
    const item = storeItem({ recordingId: "190000001", startsAt: "2026-10-28T06:00:00.000Z", shareUrl: "https://fathom.video/share/TESTshareOLD9" });
    const found = setup({ key: null, find: { found: true, store: item } });
    const a = await checkinCalls(opOf(found.deps), body({ shareUrl: "https://fathom.video/share/TESTshareOLD9?tab=summary", refresh: true }));
    expect(a.picked).toMatchObject({ recordingId: "190000001", why: "pasted", label: "exact", blocked: null });
    expect(a.fathom.state).toBe("off");
    expect(found.sent).toHaveLength(0);
    await expect(checkinCalls(opOf(setup({ key: null }).deps), body({ shareUrl: "https://zoom.us/rec/share/abc" }))).rejects.toThrow(NOT_FATHOM);
    let looked = 0;
    const unknown = setup({ key: null, find: () => (++looked, { found: false, fathom: true }) });
    const b = await checkinCalls(opOf(unknown.deps), body({ shareUrl: "https://fathom.video/share/TESTshareNEW1", refresh: true }));
    expect(looked).toBe(1);
    expect(unknown.sent).toHaveLength(0);
    expect([b.picked, ...b.others].some(v => v?.why === "pasted")).toBe(false);
  });
});

describe("checkin.calls: recordings from outside Customer Success", () => {
  /** The CEO's call with a prospect, team Sales: it reads client until the sales desk indexes it. */
  const sales = (over: Record<string, unknown> = {}) =>
    storeItem({
      recordingId: "195000001",
      startsAt: "2026-10-28T07:40:00.000Z",
      endsAt: "2026-10-28T08:20:00.000Z",
      title: "Pricing call",
      meetingTitle: "Pricing call",
      class: "client",
      recorderEmail: CEO_EMAIL,
      recorderTeam: "Sales",
      inviteeEmails: [CEO_EMAIL, "buyer@prospect.example"],
      shareUrl: "https://fathom.video/share/TESTshareSAL1",
      ...over,
    });
  const ids = (a: Awaited<ReturnType<typeof checkinCalls>>) => [a.picked, ...a.others].filter(Boolean).map(v => v?.recordingId);

  test("one with no sign for this client is never listed, for the CSM, an admin or the CEO who recorded it", async () => {
    const inputs = { store: [sales(), storeItem({ startsAt: "2026-10-28T07:00:00.000Z" })] };
    for (const actor of [csmActor, adminActor, ceoActor]) {
      const f = setup({ inputs });
      const a = await checkinCalls(opOf(f.deps, actor), body());
      expect(ids(a)).toEqual(["194756343"]);
      // Never listed, so the tie rule is not even asked about it.
      expect(f.service.named("cockpit_form_recordings_tied")).toHaveLength(0);
    }
  });

  test("a title alone never ties it: the CSM sees it disabled with the sentence and her own call takes the pick; the CEO and an admin pick it", async () => {
    // The CSM's own call this morning: the default pick when nothing better stands.
    const hers = storeItem({ startsAt: "2026-10-28T07:34:00.000Z" });
    const titled = sales({ title: "City Wood pricing review" });
    const f = setup({ inputs: { store: [titled, hers] } });
    const csm = await checkinCalls(opOf(f.deps), body());
    expect(csm.picked).toMatchObject({ recordingId: "194756343", why: "latest_unlinked", blocked: null });
    expect(csm.others).toHaveLength(1);
    expect(csm.others[0]).toMatchObject({ recordingId: "195000001", why: "picked", label: "hint", ask: false, whyText: "", shareUrl: null, blocked: OUTSIDE_CS });
    // Asked once, for the viewer, about the one recording made outside Customer Success that a sign names here.
    expect(f.service.named("cockpit_form_recordings_tied").map(c => c.args)).toEqual([
      { p_recording_ids: ["195000001"], p_task_id: "86exCITYW", p_actor: csmActor.actorId, p_response_id: null },
    ]);
    for (const actor of [ceoActor, adminActor]) {
      const a = await checkinCalls(opOf(setup({ inputs: { store: [titled, hers] } }).deps, actor), body());
      expect(a.picked).toMatchObject({ recordingId: "195000001", why: "title", label: "likely", ask: true, recorder: "other", recorderRole: "the CEO", blocked: null });
      expect(a.others.map(v => [v.recordingId, v.blocked])).toEqual([["194756343", null]]);
    }
  });

  test("an exact sign or its call row ties it for every seat: the client on the invite, on this client in the store", async () => {
    const invited = {
      bookings: [booking({ startsAt: "2026-10-28T07:30:00.000Z" })],
      store: [sales({ inviteeEmails: [CEO_EMAIL, "owner@citywood.example"] })],
    };
    expect((await checkinCalls(opOf(setup({ inputs: invited }).deps), body())).picked).toMatchObject({ recordingId: "195000001", why: "invitee_email", label: "exact", blocked: null });
    const f = setup({ inputs: { store: [sales({ onTask: "86exCITYW", onTaskMethod: "manual" })] } });
    const placed = await checkinCalls(opOf(f.deps), body());
    expect(placed.picked).toMatchObject({ recordingId: "195000001", why: "matched", onClient: "this", blocked: null });
    // Its call row settles it (rule 2), so the database is not asked.
    expect(f.service.named("cockpit_form_recordings_tied")).toHaveLength(0);
  });

  // A7.14 rule 2 as decided in round 3 (A7.17): the worker's matchMeeting places every client-class meeting, a
  // closer's prospect call the sales desk has not indexed included, by a client's name in its title, its meeting
  // title or an invitee's name (`name`, 0.6) or an invitee at a client's company domain (`invitee_email`, 0.8).
  // Such a row on this card settles nothing: the recording is held to rules 1, 3 and 4 like one on no card.
  // Refused, it reads A7.14's second sentence, OUTSIDE_CS_LIKELY (round 4, A7.18): the client's Calls card lists
  // the call on this client, so OUTSIDE_CS's "is not on this client" would be false. A closer's call on no card
  // keeps OUTSIDE_CS. stage2a-writers.test.ts pins the same calls against the real v.
  describe("a closer's call the worker put on this card by a likely sign (round 3)", () => {
    const closer = (over: Record<string, unknown> = {}) => sales({ recorderEmail: CLOSER_EMAIL, ...over });
    /** Placed by the client's name in its title: the title is also a likely sign in the window. */
    const byName = closer({
      recordingId: "195000011",
      title: "City Wood pricing review",
      shareUrl: "https://fathom.video/share/TESTshareSAL3",
      onTask: "86exCITYW",
      onTaskMethod: "name",
      onTaskConfidence: 0.6,
    });
    /** Placed by a company domain, with no booking in the window to give a sign: only its row names this client. */
    const byDomain = closer({
      recordingId: "195000012",
      startsAt: "2026-10-28T08:00:00.000Z",
      endsAt: "2026-10-28T08:30:00.000Z",
      inviteeEmails: [CLOSER_EMAIL, "buyer@citywood.example"],
      shareUrl: "https://fathom.video/share/TESTshareSAL4",
      onTask: "86exCITYW",
      onTaskMethod: "invitee_email",
      onTaskConfidence: 0.8,
    });
    // The CSM's own call this morning: the default pick when nothing better stands.
    const hers = storeItem({ startsAt: "2026-10-28T07:34:00.000Z" });
    const store = [byName, byDomain, hers];

    test("the CSM sees both listed disabled with OUTSIDE_CS_LIKELY (round 4), never picked, no link; her own call takes the pick; the database is asked once", async () => {
      const f = setup({ inputs: { store } });
      const csm = await checkinCalls(opOf(f.deps), body());
      expect(csm.picked).toMatchObject({ recordingId: "194756343", why: "latest_unlinked", blocked: null });
      expect(csm.others.map(v => [v.recordingId, v.why, v.label, v.ask, v.whyText, v.shareUrl, v.onClient, v.blocked])).toEqual([
        ["195000012", "picked", "hint", false, "", null, "this", OUTSIDE_CS_LIKELY],
        ["195000011", "picked", "hint", false, "", null, "this", OUTSIDE_CS_LIKELY],
      ]);
      // Rule 2 does not settle a likely row, so both are asked about, for the viewer, in one call.
      expect(f.service.named("cockpit_form_recordings_tied").map(c => c.args)).toEqual([
        { p_recording_ids: ["195000011", "195000012"], p_task_id: "86exCITYW", p_actor: csmActor.actorId, p_response_id: null },
      ]);
      // Neither is ever the matcher's exact store match.
      expect(csm.others.some(v => v.why === "matched")).toBe(false);
    });

    test("a closer's call on no card keeps OUTSIDE_CS for the CSM, listed by its title or pasted; on this card by a likely sign, pasted, it reads OUTSIDE_CS_LIKELY (round 4)", async () => {
      const unplaced = closer({ recordingId: "195000013", title: "City Wood pricing review", shareUrl: "https://fathom.video/share/TESTshareSAL5" });
      const listed = await checkinCalls(opOf(setup({ inputs: { store: [unplaced, hers] } }).deps), body());
      expect(listed.others.map(v => [v.recordingId, v.why, v.onClient, v.blocked])).toEqual([["195000013", "picked", "none", OUTSIDE_CS]]);
      const paste = async (item: Record<string, unknown>) => {
        const f = setup({ inputs: { store: [item] }, find: { found: true, store: item } });
        const a = await checkinCalls(opOf(f.deps), body({ shareUrl: String(item.shareUrl) }));
        expect(a.picked).toBeNull();
        return a.others.map(v => [v.recordingId, v.why, v.onClient, v.blocked]);
      };
      expect(await paste({ ...unplaced, title: "Pricing call" })).toEqual([["195000013", "pasted", "none", OUTSIDE_CS]]);
      expect(await paste(byDomain)).toEqual([["195000012", "pasted", "this", OUTSIDE_CS_LIKELY]]);
    });

    test("the CEO, an admin and its recorder may use both: the title picks the one, the other is listed with no why line", async () => {
      for (const actor of [ceoActor, adminActor, closerActor]) {
        const f = setup({ inputs: { store } });
        const a = await checkinCalls(opOf(f.deps, actor), body());
        expect([actor.email, a.picked?.recordingId, a.picked?.why, a.picked?.label, a.picked?.blocked]).toEqual([actor.email, "195000011", "title", "likely", null]);
        expect(a.others.map(v => [v.recordingId, v.why, v.label, v.blocked])).toEqual([
          ["194756343", "latest_unlinked", "default", null],
          ["195000012", "picked", "hint", null],
        ]);
        expect(f.service.named("cockpit_form_recordings_tied").map(c => c.args.p_actor)).toEqual([actor.actorId]);
      }
    });

    test("a store that sends no confidence reads an invitee_email row as a likely one (the safe side); at 0.9, a known contact, it ties without asking", async () => {
      const legacy = { ...byDomain };
      delete (legacy as Record<string, unknown>).onTaskConfidence;
      const old = setup({ inputs: { store: [legacy, hers] } });
      const a = await checkinCalls(opOf(old.deps), body());
      expect(a.others.find(v => v.recordingId === "195000012")).toMatchObject({ why: "picked", blocked: OUTSIDE_CS_LIKELY });
      expect(old.service.named("cockpit_form_recordings_tied")).toHaveLength(1);
      // Numeric text is read as the number it is, and anything else as missing.
      const text = setup({ inputs: { store: [{ ...byDomain, onTaskConfidence: "0.9" }, hers] } });
      expect((await checkinCalls(opOf(text.deps), body())).picked).toMatchObject({ recordingId: "195000012", why: "matched", label: "exact", blocked: null });
      const known = setup({ inputs: { store: [{ ...byDomain, onTaskConfidence: 0.9 }, hers] } });
      const b = await checkinCalls(opOf(known.deps), body());
      expect(b.picked).toMatchObject({ recordingId: "195000012", why: "matched", label: "exact", onClient: "this", blocked: null });
      expect(known.service.named("cockpit_form_recordings_tied")).toHaveLength(0);
    });

    test("a Customer Success recording with a name row still ties (rule 1), for the CSM, without asking", async () => {
      const csName = storeItem({ startsAt: "2026-10-28T07:34:00.000Z", title: "City Wood check-in", onTask: "86exCITYW", onTaskMethod: "name", onTaskConfidence: 0.6 });
      const f = setup({ inputs: { store: [csName] } });
      const a = await checkinCalls(opOf(f.deps), body());
      expect(a.picked).toMatchObject({ recordingId: "194756343", why: "title", label: "likely", onClient: "this", blocked: null });
      expect(f.service.named("cockpit_form_recordings_tied")).toHaveLength(0);
    });

    // R4-regressions-3: a likely row is no store match (5.2 row 3b), so her own call on this card by a company domain
    // would have no sign at all; 5.2 row 8 asks only "not on another client", so it is her default, as unplaced.
    test("the CSM's own call the worker put on this card by a company domain (0.8) or a name, with no other sign, is her default pick, which asks; at 0.9 it is the store match", async () => {
      const own = (over: Record<string, unknown>) =>
        storeItem({ startsAt: "2026-10-28T07:34:00.000Z", inviteeEmails: [CSM_EMAIL, "buyer@citywood.example"], onTask: "86exCITYW", ...over });
      const pick = async (item: Record<string, any>) => {
        const f = setup({ inputs: { store: [item] } });
        const a = await checkinCalls(opOf(f.deps), body());
        expect(f.service.named("cockpit_form_recordings_tied")).toHaveLength(0);
        expect(a.others.filter(v => v.kind === "fathom")).toEqual([]);
        const p = a.picked;
        return p && [p.recordingId, p.why, p.label, p.ask, p.onClient, p.blocked, p.whyText];
      };
      const asDefault = ["194756343", "latest_unlinked", "default", true, "this", null, "Your newest call that no client has yet (Wed 28 Oct, 10:34). Is this the call?"];
      expect(await pick(own({ onTaskMethod: "invitee_email", onTaskConfidence: 0.8 }))).toEqual(asDefault);
      expect(await pick(own({ onTaskMethod: "invitee_email", onTaskConfidence: null }))).toEqual(asDefault);
      expect(await pick(own({ onTaskMethod: "name", onTaskConfidence: 0.6 }))).toEqual(asDefault);
      expect(await pick(own({ onTaskMethod: "invitee_email", onTaskConfidence: 0.9 }))).toEqual(["194756343", "matched", "exact", false, "this", null, "On City Wood in the call store."]);
      // Unplaced, the same call is the same default.
      expect(await pick(own({ onTask: null, onTaskMethod: null }))).toEqual([...asDefault.slice(0, 4), "none", ...asDefault.slice(5)]);
    });

    test("this client's older call rows (onClient) are asked about unless an exact sign or a person placed them", () => {
      const at = (d: number) => `2026-10-2${d}T07:00:00.000Z`;
      const older = asInputs(
        matchInputs({
          client: {
            taskId: "86exCITYW",
            name: "City Wood",
            lastNoteAt: null,
            onClient: [
              { recordingId: "193000001", callId: 1, method: "name", confidence: 0.6, startsAt: at(0) },
              { recordingId: "193000002", callId: 2, method: "invitee_email", confidence: 0.8, startsAt: at(1) },
              { recordingId: "193000003", callId: 3, method: "invitee_email", confidence: 0.9, startsAt: at(2) },
              { recordingId: "193000004", callId: 4, method: "appointment_time", confidence: 1, startsAt: at(3) },
              { recordingId: "193000005", callId: 5, method: "invitee_email", startsAt: at(4) },
              { recordingId: "193000006", callId: 6, method: "manual", confidence: 1, startsAt: at(5) },
            ],
          },
        }),
      );
      expect(tieAsks(older, "86exCITYW", NOW.getTime(), null)).toEqual(["193000001", "193000002", "193000005"]);
    });

    test("the door's model (testkit tiedRpc) follows rule 2 as decided: a likely row on this card goes on to rules 1, 3 and 4; a row on another card ties nothing", () => {
      const ask = (rpc: ReturnType<typeof tiedRpc>, actor = csmActor, task = "86exCITYW") =>
        rpc({ p_recording_ids: ["195000011", "195000012"], p_task_id: task, p_actor: actor.actorId, p_response_id: null });
      const rpc = tiedRpc({ store: [byName, byDomain] });
      expect([csmActor, ceoActor, adminActor, closerActor].map(a => ask(rpc, a))).toEqual([[], ["195000011", "195000012"], ["195000011", "195000012"], ["195000011", "195000012"]]);
      // An exact sign or a person's row settles it for every seat.
      const exact = tiedRpc({ store: [{ ...byName, onTaskMethod: "manual", onTaskConfidence: 1 }, { ...byDomain, onTaskConfidence: 0.9 }] });
      expect(ask(exact)).toEqual(["195000011", "195000012"]);
      // A likely row still ties by rule 3: the domain row's invitee is on this card's booking.
      const booked = tiedRpc({ store: [byDomain], bookings: [booking({ id: 54007, startsAt: "2026-10-27T05:00:00.000Z", emails: ["buyer@citywood.example"] })] });
      expect(ask(booked)).toEqual(["195000012"]);
      // On another card: nothing here, whatever the seat, and the gate still holds rule 4.
      const elsewhere = tiedRpc({ store: [{ ...byName, onTask: "86exMARBL", onTaskMethod: "manual", onTaskConfidence: 1 }] });
      expect(ask(elsewhere, ceoActor)).toEqual([]);
      expect(ask(tiedRpc({ store: [byName, byDomain], gate: () => false }), ceoActor)).toEqual([]);
    });
  });

  test("the database's rule sees every booking: an invitee on this client's booking three days before the window ties it for the CSM, listed and picked", async () => {
    // Older than the window, so the window's MatchInputs does not hold this booking; the database does.
    const old = [booking({ id: 54001, startsAt: "2026-10-23T09:00:00.000Z", endsAt: "2026-10-23T09:30:00.000Z" })];
    const titled = sales({ title: "City Wood pricing review", inviteeEmails: [CEO_EMAIL, "owner@citywood.example"] });
    const a = await checkinCalls(opOf(setup({ inputs: { store: [titled] }, dbBookings: old }).deps), body());
    expect(a.picked).toMatchObject({ recordingId: "195000001", why: "title", label: "likely", blocked: null });
    // Pasted with a plain title, it stands as pasted.
    const plain = sales({ inviteeEmails: [CEO_EMAIL, "owner@citywood.example"] });
    const b = await checkinCalls(opOf(setup({ inputs: { store: [plain] }, find: { found: true, store: plain }, dbBookings: old }).deps), body({ shareUrl: "https://fathom.video/share/TESTshareSAL1" }));
    expect(b.picked).toMatchObject({ recordingId: "195000001", why: "pasted", label: "exact", blocked: null });
    // Without that booking, the same CSM reads the sentence.
    const c = await checkinCalls(opOf(setup({ inputs: { store: [titled] } }).deps), body());
    expect(c.picked).toBeNull();
    expect(c.others[0]).toMatchObject({ recordingId: "195000001", blocked: OUTSIDE_CS });
  });

  test("an invitee on this client's booking and another client's ties it for each card (A7.14 rule 3): picked by its title here, by its pasted link there; on the other client's booking alone, it ties nothing here", async () => {
    // One email on two listed clients' bookings, neither within 30 minutes of the call. The invitee clause has no
    // other-card condition, so the database ties the call for each card (stage2a-writers.test.ts runs the real v).
    const both = [
      booking({ id: 54002, startsAt: "2026-10-27T05:00:00.000Z", endsAt: "2026-10-27T05:30:00.000Z" }),
      booking({ id: 54003, taskId: "86exMARBL", clientName: "Marble 10-12", startsAt: "2026-10-27T06:00:00.000Z", endsAt: "2026-10-27T06:30:00.000Z" }),
    ];
    const titled = sales({ title: "City Wood pricing review", inviteeEmails: [CEO_EMAIL, "owner@citywood.example"] });
    const here = setup({ inputs: { store: [titled] }, dbBookings: both });
    const a = await checkinCalls(opOf(here.deps), body());
    expect(a.picked).toMatchObject({ recordingId: "195000001", why: "title", label: "likely", onClient: "none", blocked: null });
    expect(here.service.named("cockpit_form_recordings_tied").map(c => c.args)).toEqual([
      { p_recording_ids: ["195000001"], p_task_id: "86exCITYW", p_actor: csmActor.actorId, p_response_id: null },
    ]);
    // The other card: its title names City Wood, so it is listed there only when pasted, and then tied too.
    const marble = { client: { taskId: "86exMARBL", name: "Marble 10-12", lastNoteAt: null, onClient: [] } };
    const there = setup({ inputs: { ...marble, store: [titled] }, find: { found: true, store: titled }, dbBookings: both });
    const b = await checkinCalls(opOf(there.deps), body({ taskId: "86exMARBL", shareUrl: "https://fathom.video/share/TESTshareSAL1" }));
    expect(b.picked).toMatchObject({ recordingId: "195000001", why: "pasted", label: "exact", blocked: null });
    expect(there.service.named("cockpit_form_recordings_tied").map(c => c.args.p_task_id)).toEqual(["86exMARBL"]);
    // The address on the other client's booking alone is no sign for this one: the CSM reads the sentence here.
    const theirs = [both[1]];
    const c = await checkinCalls(opOf(setup({ inputs: { store: [titled] }, dbBookings: theirs }).deps), body());
    expect(c.picked).toBeNull();
    expect(c.others[0]).toMatchObject({ recordingId: "195000001", onClient: "none", blocked: OUTSIDE_CS });
  });

  test("the door's model of the tie rule (testkit tiedRpc) checks rule 3's clauses on their own for the card asked, as v does", () => {
    const ask = (rpc: ReturnType<typeof tiedRpc>, task: string) => rpc({ p_recording_ids: ["195000001"], p_task_id: task, p_actor: csmActor.actorId, p_response_id: null });
    const shared = sales({ inviteeEmails: [CEO_EMAIL, "ops@shared.invalid"] });
    const twoCards = [
      booking({ id: 54002, startsAt: "2026-10-27T05:00:00.000Z", emails: ["ops@shared.invalid"] }),
      booking({ id: 54003, taskId: "86exMARBL", clientName: "Marble 10-12", startsAt: "2026-10-27T06:00:00.000Z", emails: ["ops@shared.invalid"] }),
    ];
    // An address on live bookings of two listed cards ties the call for each.
    const invite = tiedRpc({ store: [shared], bookings: twoCards });
    expect([ask(invite, "86exCITYW"), ask(invite, "86exMARBL")]).toEqual([["195000001"], ["195000001"]]);
    // A card that is not on the clients list needs its booking within 30 minutes of the call.
    expect(ask(tiedRpc({ store: [shared], bookings: twoCards, listed: ["86exMARBL"] }), "86exCITYW")).toEqual([]);
    const nearUnlisted = [...twoCards, booking({ id: 54004, startsAt: "2026-10-28T07:20:00.000Z", emails: ["ops@shared.invalid"] })];
    expect(ask(tiedRpc({ store: [shared], bookings: nearUnlisted, listed: ["86exMARBL"] }), "86exCITYW")).toEqual(["195000001"]);
    // The room: every live booking in it within 90 minutes must be this card's. Another card's booking there
    // fails the room clause only: this card's invitee and its 1-1 form are still read, even when the room's
    // bookings are all the other card's.
    const room = "meet:abc-defg-hij";
    const inRoom = sales({ room, inviteeEmails: [CEO_EMAIL, "ops@shared.invalid"] });
    const ours = booking({ id: 54005, room, startsAt: "2026-10-28T07:10:00.000Z", emails: [] });
    const theirs = booking({ id: 54006, taskId: "86exMARBL", clientName: "Marble 10-12", room, startsAt: "2026-10-28T08:00:00.000Z", emails: [] });
    expect(ask(tiedRpc({ store: [inRoom], bookings: [ours] }), "86exCITYW")).toEqual(["195000001"]);
    expect(ask(tiedRpc({ store: [inRoom], bookings: [ours, theirs] }), "86exCITYW")).toEqual([]);
    expect(ask(tiedRpc({ store: [inRoom], bookings: [theirs] }), "86exCITYW")).toEqual([]);
    expect(ask(tiedRpc({ store: [inRoom], bookings: [theirs, twoCards[0]] }), "86exCITYW")).toEqual(["195000001"]);
    expect(ask(tiedRpc({ store: [inRoom], bookings: [theirs], formLinks: [{ shareUrl: inRoom.shareUrl, taskId: "86exCITYW" }] }), "86exCITYW")).toEqual(["195000001"]);
    // A 1-1 form of another card holds the link: no tie here.
    expect(ask(tiedRpc({ store: [inRoom], bookings: [ours, theirs], formLinks: [{ shareUrl: inRoom.shareUrl, taskId: "86exMARBL" }] }), "86exCITYW")).toEqual([]);
  });

  test("more than 50 recordings to ask about are asked 50 at a time", async () => {
    const many = Array.from({ length: 51 }, (_, i) => sales({ recordingId: String(195100000 + i), title: "City Wood pricing review", shareUrl: `https://fathom.video/share/TESTshareM${i}` }));
    const f = setup({ inputs: { store: many } });
    const a = await checkinCalls(opOf(f.deps, ceoActor), body());
    expect(f.service.named("cockpit_form_recordings_tied").map(c => c.args.p_recording_ids.length)).toEqual([50, 1]);
    expect([a.picked, ...a.others].filter(v => v?.blocked === null)).toHaveLength(51);
  });

  test("the database's answer is the tie: a list that names the recording ties it; one that leaves it out, or any other answer, does not", async () => {
    const invited = {
      bookings: [booking({ startsAt: "2026-10-28T07:30:00.000Z" })],
      store: [sales({ inviteeEmails: [CEO_EMAIL, "owner@citywood.example"] })],
    };
    for (const [answer, tied] of [
      [[], false],
      [["195000002"], false],
      [null, false],
      [{ "195000001": true }, false],
      [["195000001"], true],
    ] as const) {
      const f = setup({ inputs: invited });
      f.service.handlers.cockpit_form_recordings_tied = answer;
      const a = await checkinCalls(opOf(f.deps), body());
      if (tied) expect(a.picked).toMatchObject({ recordingId: "195000001", why: "invitee_email", blocked: null });
      else {
        expect(a.picked).toBeNull();
        expect(a.others.find(v => v.recordingId === "195000001")).toMatchObject({ why: "picked", label: "hint", blocked: OUTSIDE_CS });
      }
    }
  });

  test("pasted by the CSM with nothing that ties it here: listed as pasted, refused with its sentence, never picked", async () => {
    const item = sales();
    const a = await checkinCalls(opOf(setup({ inputs: { store: [item] }, find: { found: true, store: item } }).deps), body({ shareUrl: "https://fathom.video/share/TESTshareSAL1" }));
    expect(a.picked).toBeNull();
    expect(a.others).toHaveLength(1);
    expect(a.others[0]).toMatchObject({ recordingId: "195000001", why: "pasted", label: "hint", whyText: "", blocked: OUTSIDE_CS, shareUrl: "https://fathom.video/share/TESTshareSAL1" });
    expect(OUTSIDE_CS).toContain("ask an admin to match it");
  });

  test("the tie rule's two sentences are A7.14's words, copied from the contract", () => {
    const contract = readFileSync(new URL("../../../docs/forms/STAGE2-CONTRACT.md", import.meta.url), "utf8").replace(/\s+/g, " ");
    expect(contract).toContain(`reads \`${OUTSIDE_CS}\` (\`OUTSIDE_CS\`)`);
    expect(contract).toContain(`reads \`${OUTSIDE_CS_LIKELY}\` (\`OUTSIDE_CS_LIKELY\`)`);
    expect(OUTSIDE_CS_LIKELY).not.toBe(OUTSIDE_CS);
  });

  test("pasted by a seat that may place it (the CEO who recorded it, an admin, the CEO on another's call): it stands as pasted and is picked", async () => {
    // The CEO's unbooked check-in: a plain title, no booking in range, nothing in the store ties it to City Wood.
    const own = sales({ title: "Impromptu Google Meet Meeting", meetingTitle: "Impromptu Google Meet Meeting" });
    for (const actor of [ceoActor, adminActor]) {
      const a = await checkinCalls(opOf(setup({ inputs: { store: [own] }, find: { found: true, store: own } }).deps, actor), body({ shareUrl: "https://fathom.video/share/TESTshareSAL1" }));
      expect(a.picked).toMatchObject({ recordingId: "195000001", why: "pasted", label: "exact", ask: false, whyText: "From the Fathom link you pasted.", blocked: null, shareUrl: "https://fathom.video/share/TESTshareSAL1" });
      expect(a.others).toEqual([]);
    }
    // The closer's call is placed by a boss through the queue too, so the CEO's paste of it stands; the CSM's does not.
    const closer = sales({ recorderEmail: "closer.seat@maharamedia.com", shareUrl: "https://fathom.video/share/TESTshareSAL2" });
    const asCeo = await checkinCalls(opOf(setup({ inputs: { store: [closer] }, find: { found: true, store: closer } }).deps, ceoActor), body({ shareUrl: "https://fathom.video/share/TESTshareSAL2" }));
    expect(asCeo.picked).toMatchObject({ recordingId: "195000001", why: "pasted", blocked: null });
    const asCsm = await checkinCalls(opOf(setup({ inputs: { store: [closer] }, find: { found: true, store: closer } }).deps, csmActor), body({ shareUrl: "https://fathom.video/share/TESTshareSAL2" }));
    expect(asCsm.picked).toBeNull();
    expect(asCsm.others[0]).toMatchObject({ why: "pasted", blocked: OUTSIDE_CS });
    // A paste never lifts the save's own refusals, for any seat.
    const indexed = sales({ class: "sales" });
    const gone = await checkinCalls(opOf(setup({ inputs: { store: [indexed] }, find: { found: true, store: indexed } }).deps, ceoActor), body({ shareUrl: "https://fathom.video/share/TESTshareSAL1" }));
    expect(gone.picked).toBeNull();
    expect(gone.others[0]).toMatchObject({ why: "pasted", blocked: "That recording is a team meeting, not a client call." });
  });

  test("pasted by the CSM, the CEO's copy of her own call stands for her copy", async () => {
    // One call recorded twice in the same room: hers is kept, and the paste of his copy finds hers.
    const room = "meet:abc-defg-hij";
    const hers = storeItem({ room, startsAt: "2026-10-28T07:34:00.000Z" });
    const his = sales({ room, startsAt: "2026-10-28T07:36:00.000Z" });
    const a = await checkinCalls(opOf(setup({ inputs: { store: [hers, his] }, find: { found: true, store: his } }).deps), body({ shareUrl: "https://fathom.video/share/TESTshareSAL1" }));
    expect(a.picked).toMatchObject({ recordingId: "194756343", why: "pasted", label: "exact", blocked: null });
    expect(a.others).toEqual([]);
  });

  test("not pasted, the seat that may place it still sees no listing of its untied recordings (a tap would send a prospect's call to a model)", async () => {
    const a = await checkinCalls(opOf(setup({ inputs: { store: [sales()] } }).deps, ceoActor), body());
    expect(ids(a)).toEqual([]);
  });

  test("every sign this recording gives this client lists it, not only the best three clients a hint keeps", async () => {
    // Four clients named in one title: City Wood sorts fourth, past the three suggestionsFor keeps.
    const clients = [
      { taskId: "86exALPHA", name: "Alpha Kitchens", aliases: [] },
      { taskId: "86exBRAVO", name: "Bravo Studio", aliases: [] },
      { taskId: "86exCEDAR", name: "Cedar Homes", aliases: [] },
      { taskId: "86exCITYW", name: "City Wood", aliases: [] },
    ];
    const four = sales({ title: "Alpha Kitchens Bravo Studio Cedar Homes City Wood review" });
    const rec = toRecording(four as never);
    const ctx = matchCtx(asInputs(matchInputs({ clients })), NOW.getTime());
    expect(suggestionsFor(rec, [], clients, ctx).map(s => s.taskId)).not.toContain("86exCITYW");
    // The CSM: listed, disabled with the sentence (a title alone never ties a recording made outside Customer Success).
    const csm = await checkinCalls(opOf(setup({ inputs: { clients, store: [four] } }).deps), body());
    expect(csm.picked).toBeNull();
    expect(csm.others).toHaveLength(1);
    expect(csm.others[0]).toMatchObject({ recordingId: "195000001", why: "picked", label: "hint", whyText: "", shareUrl: null, blocked: OUTSIDE_CS });
    // The CEO, whom rule 4 lets place it: picked by its title.
    const ceo = await checkinCalls(opOf(setup({ inputs: { clients, store: [four] } }).deps, ceoActor), body());
    expect(ceo.picked).toMatchObject({ recordingId: "195000001", why: "title", label: "likely", blocked: null });
    expect(ceo.others).toEqual([]);
  });

  test("a CSM seat's recording with no Fathom team is still a Customer Success one", async () => {
    const a = await checkinCalls(opOf(setup({ inputs: { store: [storeItem({ recorderTeam: null, startsAt: "2026-10-28T07:34:00.000Z" })] } }).deps), body());
    expect(a.picked).toMatchObject({ why: "latest_unlinked", recorder: "csm", blocked: null });
  });
});

describe("checkin.calls: the edited title (A7.13)", () => {
  test("the title sign reads editedTitle when the store sends it, even when null; the window still shows the stored title", async () => {
    const calendar = storeItem({ recorderEmail: TEAM_EMAIL, title: "City Wood check-in", editedTitle: null, meetingTitle: "City Wood check-in", startsAt: "2026-10-28T07:34:00.000Z" });
    expect(toRecording(calendar as never).title).toBeNull();
    const a = await checkinCalls(opOf(setup({ inputs: { store: [calendar] } }).deps), body());
    expect(a.picked).toBeNull();
    expect(a.others[0]).toMatchObject({ recordingId: "194756343", why: "picked", whyText: "", title: "City Wood check-in" });
    const edited = storeItem({ recorderEmail: TEAM_EMAIL, title: "City Wood weekly review", editedTitle: "City Wood weekly review", meetingTitle: "Impromptu Google Meet Meeting", startsAt: "2026-10-28T07:34:00.000Z" });
    const b = await checkinCalls(opOf(setup({ inputs: { store: [edited] } }).deps), body());
    expect(b.picked).toMatchObject({ why: "title", whyText: "The title names City Wood. Is this the call?", title: "City Wood weekly review" });
    // A store that predates the key: the title, as before.
    const older = storeItem({ title: "City Wood weekly review" });
    expect(toRecording(older as never).title).toBe("City Wood weekly review");
  });
});

describe("checkin.calls: another client's recording", () => {
  const theirs = storeItem({ recordingId: "191610999", startsAt: "2026-10-28T04:00:00.000Z", endsAt: "2026-10-28T04:30:00.000Z", title: "Marble 10-12 monthly check-in", onTask: "86exMARBL", onTaskMethod: "invitee_email", shareUrl: "https://fathom.video/share/TESTshareDDD4", notes: { at: "2026-10-28T05:00:00.000Z", source: "typeform" } });
  const scoped = () => {
    const f = setup({ inputs: { store: [theirs] } });
    f.service.handlers.cockpit_csm_client_gate_for_actor = (a: Record<string, any>) => {
      if (a.p_task_id !== "86exCITYW") throw new RpcError("That client is not on your access list", "42501");
      return { taskId: a.p_task_id, clientName: "City Wood" };
    };
    return f;
  };

  test("a seat whose list leaves that client out sees when and how long, and the sentence, nothing of the call", async () => {
    const f = scoped();
    const a = await checkinCalls(opOf(f.deps), body());
    expect(a.others).toHaveLength(1);
    expect(a.others[0]).toMatchObject({
      recordingId: "191610999",
      startsAt: "2026-10-28T04:00:00.000Z",
      minutes: 30,
      title: null,
      shareUrl: null,
      otherClient: null,
      onClient: "other",
      notesAlready: null,
      blocked: "On another client. If that is wrong, ask an admin to move it.",
    });
    expect(JSON.stringify(a)).not.toContain("Marble");
    expect(f.service.named("cockpit_csm_client_gate_for_actor").map(c => c.args.p_task_id)).toEqual(["86exCITYW", "86exMARBL"]);
  });

  test("a seat that may see it reads the client's name and the title, never the link; an admin's seat asks no second gate", async () => {
    const f = scoped();
    f.service.handlers.cockpit_csm_client_gate_for_actor = { taskId: "x" };
    const a = await checkinCalls(opOf(f.deps), body());
    expect(a.others[0]).toMatchObject({ title: "Marble 10-12 monthly check-in", otherClient: "Marble 10-12", shareUrl: null, blocked: "On Marble 10-12. If that is wrong, ask an admin to move it." });
    const admin = scoped();
    const b = await checkinCalls(opOf(admin.deps, adminActor), body());
    expect(b.others[0]).toMatchObject({ otherClient: "Marble 10-12", shareUrl: null });
    expect(admin.service.named("cockpit_csm_client_gate_for_actor")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- checkin.transcript (6.2)

describe("checkin.transcript", () => {
  const RESPONSE = "44444444-4444-4444-8444-444444444444";
  const LINES = [{ speaker: { display_name: "Csm Seat" }, text: "Hello.", timestamp: "00:00:05" }];
  beforeEach(() => clearTranscriptCache());

  /** One response on City Wood (the CSM's unless `seat` says whose), its saved call, the store's view of the recording and its draft inputs. */
  function world(o: { saved?: string | null; item?: Record<string, unknown>; inputs?: Record<string, unknown>; key?: unknown; gate?: unknown; signed?: boolean; seat?: typeof csmActor } = {}) {
    const item = storeItem({ startsAt: "2026-10-28T07:00:00.000Z", ...o.item });
    return fakeDeps({
      seat: {
        cockpit_form_responses_read: {
          response: { id: RESPONSE, taskId: "86exCITYW", state: "draft", answers: o.saved === null ? {} : { call: { kind: "fathom", recordingId: o.saved ?? "194756343", why: "picked", confirmed: true } } },
        },
      },
      rpc: {
        cockpit_form_draft_inputs: {
          recordingId: String(item.recordingId),
          class: item.class,
          gone: item.gone,
          title: item.title,
          startsAt: "2026-10-28T07:00:00Z",
          endsAt: "2026-10-28T07:30:00Z",
          transcriptPath: `fathom/${item.recordingId}.txt`,
          ...o.inputs,
        },
        cockpit_fathom_match_inputs: matchInputs({ store: [item] }),
        cockpit_forms_key_get: o.key === undefined ? keyRow("fathom") : o.key,
        cockpit_csm_client_gate_for_actor:
          o.gate ??
          ((a: Record<string, any>) => {
            if (a.p_task_id !== "86exCITYW") throw new RpcError("That client is not on your access list", "42501");
            return { taskId: a.p_task_id };
          }),
        cockpit_forms_actor: csmActor,
        cockpit_form_recordings_tied: tiedRpc({ store: [item], responses: { [RESPONSE]: o.seat ?? csmActor } }),
      },
      routes: [fathomApi({ transcripts: { "194756343": LINES, "195000001": LINES } })],
      signed: o.signed,
    });
  }
  const ask = (f: ReturnType<typeof world>, recordingId = "194756343", actor = csmActor) => transcriptOp(opOf(f.deps, actor), { responseId: RESPONSE, recordingId });
  const sales = { recordingId: "195000001", class: "client", recorderEmail: CEO_EMAIL, recorderTeam: "Sales", title: "Pricing call", inviteeEmails: [CEO_EMAIL, "buyer@prospect.example"] };

  test("a Customer Success candidate: a 60-second link to its own stored file", async () => {
    const f = world({ saved: null });
    expect(await ask(f)).toEqual({ url: "https://storage.example/signed/fathom/194756343.txt?expires=60" });
    expect(f.signedPaths).toEqual(["fathom/194756343.txt:60"]);
    expect(f.sent).toHaveLength(0);
  });

  test("nothing stored: the text Fathom holds, read with the forms key under transcript:{response}; no key and no file: the 404 sentence", async () => {
    const f = world({ inputs: { transcriptPath: null } });
    expect(await ask(f)).toEqual({ text: "[00:00:05] Csm Seat: Hello." });
    expect(f.sent.map(r => new URL(r.url).pathname)).toEqual(["/external/v1/recordings/194756343/transcript"]);
    expect(f.health.length).toBeGreaterThan(0);
    expect(f.health.every(r => r.run_key === `transcript:${RESPONSE}` && r.action_id === null)).toBe(true);
    await expect(ask(world({ inputs: { transcriptPath: null }, key: null }))).rejects.toThrow(NO_TRANSCRIPT);
  });

  test("only this recording's own file is ever signed: any other path falls through to Fathom", async () => {
    for (const path of ["fathom/abc.txt", "fathom/999999.txt", "fathom/194756343.txt/../x", "other/194756343.txt"]) {
      const f = world({ inputs: { transcriptPath: path } });
      expect(await ask(f)).toEqual({ text: "[00:00:05] Csm Seat: Hello." });
      expect(f.signedPaths).toEqual([]);
    }
  });

  test("not the saved call: a team meeting, a Sales-team recording, a gone one and another client's are refused before any read", async () => {
    const refused = async (o: Parameters<typeof world>[0], message: string, status: number, recordingId = "194756343") => {
      const f = world({ saved: null, ...o });
      const e = await ask(f, recordingId).catch(x => x);
      expect([e.message, e.status]).toEqual([message, status]);
      expect(f.sent).toHaveLength(0);
      expect(f.signedPaths).toEqual([]);
    };
    await refused({ item: { class: "internal" } }, "That recording is a team meeting, not a client call.", 400);
    await refused({ item: sales }, "That recording is a team meeting, not a client call.", 400, "195000001");
    await refused({ item: { gone: true } }, "Fathom no longer has that recording. Pick another call.", 400);
    await refused({ item: { onTask: "86exMARBL", onTaskMethod: "manual" } }, "That recording is on another client. If that is wrong, ask an admin to move it.", 403);
  });

  test("the saved call is held to the same rule: since turned sales or internal, gone, moved, or a Sales-team call nothing ties here", async () => {
    const refused = async (o: Parameters<typeof world>[0], message: string, status: number, recordingId = "194756343") => {
      const f = world(o);
      const e = await ask(f, recordingId).catch(x => x);
      expect([e.message, e.status]).toEqual([message, status]);
      expect(f.sent).toHaveLength(0);
      expect(f.signedPaths).toEqual([]);
    };
    // The store pass strips a recording the sales desk indexes: no path, and no Fathom read either.
    await refused({ item: { class: "sales" }, inputs: { transcriptPath: null } }, "That recording is a team meeting, not a client call.", 400);
    await refused({ item: { class: "internal" }, inputs: { transcriptPath: null } }, "That recording is a team meeting, not a client call.", 400);
    await refused({ item: { gone: true } }, "Fathom no longer has that recording. Pick another call.", 400);
    await refused({ item: { onTask: "86exMARBL", onTaskMethod: "manual" } }, "That recording is on another client. If that is wrong, ask an admin to move it.", 403);
    await refused({ saved: "195000001", item: sales }, OUTSIDE_CS, 400, "195000001");
    // A seat that may place it itself (the CEO who recorded it, an admin) reads its own saved call.
    for (const actor of [ceoActor, adminActor]) {
      const f = world({ saved: "195000001", item: sales, seat: actor });
      expect(await ask(f, "195000001", actor)).toEqual({ url: "https://storage.example/signed/fathom/195000001.txt?expires=60" });
      expect(f.service.named("cockpit_form_recordings_tied").map(c => c.args)).toEqual([
        { p_recording_ids: ["195000001"], p_task_id: "86exCITYW", p_actor: null, p_response_id: RESPONSE },
      ]);
    }
    // Rule 4 reads the seat whose response saved it: the CEO who opens the CSM's notes reads only what she may.
    const hers = world({ saved: "195000001", item: sales });
    const e = await ask(hers, "195000001", ceoActor).catch(x => x);
    expect([e.message, e.status]).toEqual([OUTSIDE_CS, 400]);
    expect(hers.signedPaths).toEqual([]);
    // Not the saved call, it is still refused for every seat (6.2: only a Customer Success recording).
    const unsaved = world({ saved: null, item: sales });
    await expect(ask(unsaved, "195000001", ceoActor)).rejects.toThrow("That recording is a team meeting, not a client call.");
    // An admin's seat reads the other client's name.
    const moved = world({ item: { onTask: "86exMARBL", onTaskMethod: "manual" } });
    await expect(ask(moved, "194756343", adminActor)).rejects.toThrow("That recording is on Marble 10-12. If that is wrong, ask an admin to move it.");
  });

  test("a saved Sales-team call that only its title names for this client: refused for the CSM, served for the CEO on his own notes", async () => {
    const item = { ...sales, title: "City Wood pricing review" };
    const csm = world({ saved: "195000001", item });
    const e = await ask(csm, "195000001").catch(x => x);
    expect([e.message, e.status]).toEqual([OUTSIDE_CS, 400]);
    expect(csm.sent).toHaveLength(0);
    expect(csm.signedPaths).toEqual([]);
    const ceo = world({ saved: "195000001", item, seat: ceoActor });
    expect(await ask(ceo, "195000001", ceoActor)).toEqual({ url: "https://storage.example/signed/fathom/195000001.txt?expires=60" });
  });

  test("a saved closer's call the worker put on this card by a name (0.6) or a company domain (0.8): OUTSIDE_CS_LIKELY for the CSM before any read (round 4); served for the CEO, an admin and its recorder on their own notes (round 3); on no card, OUTSIDE_CS", async () => {
    const placed = [
      { onTask: "86exCITYW", onTaskMethod: "name", onTaskConfidence: 0.6, title: "City Wood pricing review" },
      { onTask: "86exCITYW", onTaskMethod: "invitee_email", onTaskConfidence: 0.8, inviteeEmails: [CLOSER_EMAIL, "buyer@citywood.example"] },
    ];
    for (const how of placed) {
      const item = { ...sales, recorderEmail: CLOSER_EMAIL, ...how };
      const csm = world({ saved: "195000001", item });
      const e = await ask(csm, "195000001").catch(x => x);
      expect([how.onTaskMethod, e.message, e.status]).toEqual([how.onTaskMethod, OUTSIDE_CS_LIKELY, 400]);
      expect(csm.sent).toHaveLength(0);
      expect(csm.signedPaths).toEqual([]);
      // Rule 2 does not settle it: the database is asked for the response's own seat.
      expect(csm.service.named("cockpit_form_recordings_tied").map(c => c.args)).toEqual([
        { p_recording_ids: ["195000001"], p_task_id: "86exCITYW", p_actor: null, p_response_id: RESPONSE },
      ]);
      for (const actor of [ceoActor, adminActor, closerActor]) {
        const f = world({ saved: "195000001", item, seat: actor });
        expect([actor.email, await ask(f, "195000001", actor)]).toEqual([actor.email, { url: "https://storage.example/signed/fathom/195000001.txt?expires=60" }]);
      }
      // The CEO who opens the CSM's notes reads only what she may.
      const hers = world({ saved: "195000001", item });
      const no = await ask(hers, "195000001", ceoActor).catch(x => x);
      expect([no.message, no.status]).toEqual([OUTSIDE_CS_LIKELY, 400]);
      expect(hers.signedPaths).toEqual([]);
    }
    // The same closer's call on no card keeps OUTSIDE_CS for the CSM.
    const onNoCard = world({ saved: "195000001", item: { ...sales, recorderEmail: CLOSER_EMAIL, title: "City Wood pricing review" } });
    const e = await ask(onNoCard, "195000001").catch(x => x);
    expect([e.message, e.status]).toEqual([OUTSIDE_CS, 400]);
    expect(onNoCard.signedPaths).toEqual([]);
  });

  test("a saved Sales-team call whose invitee is on this client's booking three days before the window is served for the CSM", async () => {
    const item = { ...sales, inviteeEmails: [CEO_EMAIL, "owner@citywood.example"] };
    const f = world({ saved: "195000001", item });
    f.service.handlers.cockpit_form_recordings_tied = tiedRpc({ store: [storeItem(item)], bookings: [booking({ id: 54001, startsAt: "2026-10-23T09:00:00.000Z" })], responses: { [RESPONSE]: csmActor } });
    expect(await ask(f, "195000001")).toEqual({ url: "https://storage.example/signed/fathom/195000001.txt?expires=60" });
  });

  test("through the door: the op answers the link, and a refusal its sentence", async () => {
    const post = (b: Record<string, unknown>) => new Request("https://x/functions/v1/cockpit-forms-api", { method: "POST", headers: { Authorization: SEAT_TOKEN }, body: JSON.stringify(b) });
    const ok = await makeDoor(world().deps)(post({ op: "checkin.transcript", responseId: RESPONSE, recordingId: "194756343" }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ url: "https://storage.example/signed/fathom/194756343.txt?expires=60" });
    const no = await makeDoor(world({ item: { class: "sales" } }).deps)(post({ op: "checkin.transcript", responseId: RESPONSE, recordingId: "194756343" }));
    expect(no.status).toBe(400);
    expect(await no.json()).toEqual({ error: "That recording is a team meeting, not a client call." });
  });
});
