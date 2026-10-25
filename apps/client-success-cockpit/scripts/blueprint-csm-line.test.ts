/**
 * The Brand Blueprint on the CSM's Onboarding panel (docs/brand-blueprint
 * SPEC.md 6.1): the one line, the phase 5 copy and its conditions, the
 * read, and the nudge for a held call with no close (docs/forms/PLAN.md S8,
 * the rule of cockpit_blueprint_sources' blueprintCall.nudge). Synthetic
 * records only.
 *
 * Run: bun test scripts/blueprint-csm-line.test.ts
 */

import { expect, test } from "bun:test";
import {
  blueprintDone,
  blueprintLine,
  blueprintNudge,
  blueprintPrepUrl,
  blueprintPrepWindow,
  mapPhaseOf,
  nudgeLine,
  nudgeStage,
  partWhen,
  phase5Copy,
  readBlueprintStatus,
} from "../src/lib/blueprintStatus";
import { PHASE5_WHATSAPP } from "../src/present/blueprintBrief";

const NOW = "2026-10-24T09:00:00Z"; // 12:00 in Kuwait, a Saturday
const TASK = "86exmpl01";

test("one line: each part's time on Kuwait's clock, or not yet", () => {
  expect(blueprintLine({ parts: null, now: NOW })).toBe(
    "Not started in the cockpit yet.",
  );
  expect(
    blueprintLine({
      parts: {
        "1": { firstAt: "2026-10-22T07:12:00Z" },
        "2": { firstAt: "2026-10-22T07:44:00Z" },
        "3": { firstAt: "2026-10-24T06:30:00Z" },
      },
      now: NOW,
    }),
  ).toBe(
    "Starter ads sent Thu 22 Oct · call closed Thu 22 Oct · offer locked 09:30",
  );
  expect(
    blueprintLine({
      parts: { "1": { firstAt: "2026-10-24T07:12:00Z" } },
      now: NOW,
    }),
  ).toBe("Starter ads sent 10:12 · call not closed yet · offer not locked yet");
  // 23:30 UTC is already the next day in Kuwait.
  expect(partWhen("2026-10-23T23:30:00Z", NOW)).toBe("02:30");
  expect(blueprintDone({ "1": { firstAt: NOW }, "2": { firstAt: NOW } })).toBe(
    false,
  );
});

test("the phase 5 copy: after the close, never while Make sends it", () => {
  const status = (parts: object | null, closeRoute: string | null) => ({
    parts: parts as never,
    closeRoute,
  });
  const args = (s: ReturnType<typeof status>) => ({
    taskId: TASK,
    clientName: "Cedar and Stone Interiors (example)",
    status: s,
    links: {
      drive_folder:
        "https://drive.google.com/drive/folders/1ExampleFolder00001",
    },
  });
  const sent = { "1": { firstAt: NOW } };
  const closed = { ...sent, "2": { firstAt: NOW } };
  expect(phase5Copy(args(status(sent, "card_only")))).toBeNull();
  expect(phase5Copy(args(status(closed, "make")))).toBeNull();
  // The setting could not be read: no copy, rather than a second WhatsApp.
  expect(phase5Copy(args(status(closed, null)))).toBeNull();
  const copy = phase5Copy(args(status(closed, "slack")));
  if (PHASE5_WHATSAPP === null) {
    // Until Make 14's text is copied in, the map link is what is pasted.
    expect(copy).toEqual({
      label: "Copy the phase 5 map link",
      text: `https://mahara-onboarding-map.vercel.app/?phase=5&cid=${TASK}`,
      note: "The phase 5 text is not in the cockpit yet. Send the usual phase 5 message with this map link.",
    });
  } else {
    expect(copy?.label).toBe("Copy the phase 5 message for the group");
    expect(copy?.text).toContain(`?phase=5&cid=${TASK}`);
    expect(copy?.text).toContain("1ExampleFolder00001");
  }
});

test("the deck opens at its prep view, in the window the creative director uses", () => {
  expect(blueprintPrepUrl(TASK)).toBe(
    `/client-success/clients/${TASK}/present/blueprint?view=prep`,
  );
  expect(blueprintPrepWindow(TASK)).toBe(`mahara-prep-${TASK}-blueprint`);
});

test("the read: the card's row and the close switch; a failed setting is no copy", async () => {
  const calls: string[] = [];
  const client = (settings: "ok" | "fail") => ({
    rpc: async (name: string, args?: { p_task_ids?: string[] }) => {
      calls.push(name);
      if (name === "cockpit_blueprint_read") {
        expect(args?.p_task_ids).toEqual([TASK]);
        return {
          data: {
            rows: [
              {
                taskId: TASK,
                clientName: "Example",
                answers: { method: "never shown here" },
                parts: { "1": { firstAt: NOW, lastAt: NOW, sent: {} } },
              },
            ],
            now: NOW,
          },
          error: null,
        };
      }
      return settings === "ok"
        ? { data: { closeRoute: "card_only" }, error: null }
        : {
            data: null,
            error: {
              message:
                "Current confirmed creative or client-success access is required",
            },
          };
    },
  });
  const ok = await readBlueprintStatus(client("ok") as never, TASK);
  expect(ok).toEqual({
    parts: { "1": { firstAt: NOW, lastAt: NOW } },
    closeRoute: "card_only",
    now: NOW,
  });
  expect(calls).toEqual([
    "cockpit_blueprint_read",
    "cockpit_blueprint_settings_read",
  ]);
  const failed = await readBlueprintStatus(client("fail") as never, TASK);
  expect(failed.closeRoute).toBeNull();
  const none = await readBlueprintStatus(
    {
      rpc: async (name: string) =>
        name === "cockpit_blueprint_read"
          ? { data: { rows: [], now: NOW }, error: null }
          : { data: { closeRoute: "make" }, error: null },
    } as never,
    TASK,
  );
  expect(none.parts).toBeNull();
  await expect(
    readBlueprintStatus(
      {
        rpc: async () => ({
          data: null,
          error: { message: "Choose at most 200 client cards" },
        }),
      } as never,
      TASK,
    ),
  ).rejects.toThrow("Choose at most 200 client cards");
});

test("the nudge: a held Blueprint call, before launch, and no close", () => {
  const held = {
    kind: "blueprint",
    startsAt: "2026-10-18T10:00:00Z",
    status: "held",
  };
  const map = (n: number) =>
    `https://mahara-onboarding-map.vercel.app/?phase=${n}&cid=${TASK}`;
  const base = {
    stage: "Brand Blueprint Booked♠️",
    mapUrl: map(4),
    parts: null,
    calls: [held],
    now: NOW,
  };
  expect(blueprintNudge(base)).toEqual({ heldAt: "2026-10-18T10:00:00Z" });
  // Ready For Launch counts too; the latest held call is the one named.
  expect(
    blueprintNudge({
      ...base,
      stage: "Ready For Launch🚀",
      calls: [
        held,
        {
          kind: "blueprint",
          startsAt: "2026-10-20T08:00:00Z",
          status: "showed",
        },
      ],
    }),
  ).toEqual({ heldAt: "2026-10-20T08:00:00Z" });
  // Part 1 alone still nudges; part 2 ends it.
  expect(
    blueprintNudge({ ...base, parts: { "1": { firstAt: NOW } } }),
  ).not.toBeNull();
  expect(
    blueprintNudge({
      ...base,
      parts: { "1": { firstAt: NOW }, "2": { firstAt: NOW } },
    }),
  ).toBeNull();
  // Past phase 4, Active, no call, a call still to come, a cancelled call,
  // another kind of call: no nudge.
  expect(blueprintNudge({ ...base, mapUrl: map(6) })).toBeNull();
  expect(blueprintNudge({ ...base, stage: "Active" })).toBeNull();
  expect(blueprintNudge({ ...base, calls: [] })).toBeNull();
  expect(
    blueprintNudge({
      ...base,
      calls: [{ ...held, startsAt: "2026-10-25T10:00:00Z" }],
    }),
  ).toBeNull();
  expect(
    blueprintNudge({ ...base, calls: [{ ...held, status: "cancelled" }] }),
  ).toBeNull();
  expect(
    blueprintNudge({ ...base, calls: [{ ...held, kind: "launch" }] }),
  ).toBeNull();
  // An unreadable map counts as phase 0, as the SQL's coalesce does.
  expect(blueprintNudge({ ...base, mapUrl: null })).not.toBeNull();
  expect(mapPhaseOf(map(5))).toBe(5);
  expect(mapPhaseOf("https://example.com/map")).toBeNull();
  // Only the two stages read the call store at all.
  expect(nudgeStage("Brand Blueprint Booked♠️")).toBe(true);
  expect(nudgeStage("Ready For Launch🚀")).toBe(true);
  expect(nudgeStage("Onboarding Booked")).toBe(false);
  expect(nudgeStage(null)).toBe(false);
});

test("the nudge's sentence: the call's day on Kuwait's calendar, and what to do", () => {
  expect(nudgeLine("2026-10-18T10:00:00Z")).toBe(
    "Blueprint call held Sun 18 Oct. No Blueprint record yet. Open the call page.",
  );
  // 22:30 UTC is already the next day in Kuwait.
  expect(nudgeLine("2026-10-17T22:30:00Z")).toBe(
    "Blueprint call held Sun 18 Oct. No Blueprint record yet. Open the call page.",
  );
});
