/**
 * The client's portal tasks (convex/portalTasksCore.ts): the client's tag is
 * found however the card spells the name, a task reads the way the CSM needs
 * it, and open tasks come first.
 *
 * Run: bun test scripts/portal-tasks.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
  portalTask,
  sortPortalTasks,
  tagFor,
  tagKey,
} from "../src/lib/portalTasksCore";

const TAGS = [
  { name: "shades interior design & general contracting" },
  { name: "مدانة العمرانية للإستشارات" },
  { name: "ocean home" },
  { name: "oceanhome" },
];

describe("the client's tag", () => {
  test("case and spacing do not matter", () => {
    expect(
      tagFor(" Shades Interior  Design & General Contracting ", TAGS),
    ).toBe("shades interior design & general contracting");
    expect(tagFor("Ocean Home", TAGS)).toBe("ocean home");
  });

  test("an Arabic presentation form on the card still finds the tag", () => {
    // The card writes للإ as lam plus the lam-alef ligature U+FEFA; the tag has plain letters.
    expect(tagKey("\u0644\ufefaستشارات")).toBe(tagKey("للإستشارات"));
    expect(tagFor("مدانة العمرانية \u0644\ufefaستشارات", TAGS)).toBe(
      "مدانة العمرانية للإستشارات",
    );
  });

  test("a client with no tag gets none, never a near miss", () => {
    expect(tagFor("Render", TAGS)).toBeNull();
    expect(tagFor("Ocean", TAGS)).toBeNull();
    expect(tagFor("", TAGS)).toBeNull();
  });
});

const field = (value: unknown) => ({
  id: "8e4ad7d7-fabf-4fd2-a08d-13c6ac2bda12",
  value,
  type_config: {
    options: [
      { id: "opt-pay", orderindex: 0, name: "Ads payment declined" },
      { id: "opt-up", orderindex: 2, name: "Upload content" },
    ],
  },
});

describe("a task as the CSM reads it", () => {
  test("request type, due date, published and done", () => {
    const t = portalTask({
      id: "t1",
      name: " Upload your project photos ",
      status: { status: "to do", type: "open" },
      due_date: String(Date.UTC(2026, 9, 8, 6)),
      url: "https://app.clickup.com/t/t1",
      custom_fields: [
        field(2),
        { id: "74518115-b491-42f4-bdec-3eec98f1b629", value: "true" },
      ],
    });
    expect(t).toEqual({
      id: "t1",
      name: "Upload your project photos",
      status: "to do",
      done: false,
      due: "2026-10-08T06:00:00.000Z",
      requestType: "Upload content",
      published: true,
      url: "https://app.clickup.com/t/t1",
    });
    expect(portalTask({ custom_fields: [field("opt-pay")] }).requestType).toBe(
      "Ads payment declined",
    );
    expect(portalTask({ status: { status: "complete" } }).done).toBe(true);
    expect(portalTask({ status: { status: "pending" } }).published).toBe(false);
  });

  test("open tasks first by due date, finished after, newest first", () => {
    const mk = (id: string, done: boolean, due: string | null) => ({
      id,
      name: id,
      status: done ? "complete" : "to do",
      done,
      due,
      requestType: null,
      published: true,
      url: null,
    });
    const sorted = sortPortalTasks([
      mk("done-old", true, "2026-10-01T00:00:00Z"),
      mk("open-late", false, "2026-10-09T00:00:00Z"),
      mk("open-none", false, null),
      mk("done-new", true, "2026-10-05T00:00:00Z"),
      mk("open-soon", false, "2026-10-07T00:00:00Z"),
    ]).map(t => t.id);
    expect(sorted).toEqual([
      "open-soon",
      "open-late",
      "open-none",
      "done-new",
      "done-old",
    ]);
  });
});
