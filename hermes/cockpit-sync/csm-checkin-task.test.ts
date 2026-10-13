import { describe, expect, it } from "bun:test";
import { cadenceInputs, checkinTaskId } from "./csmProviders";
import { withNativeContext, type Reads } from "./runtime";

const TYPED = "c484f390-9695-4ffa-9693-9cc219592713";
const form = (hidden: Record<string, string> | undefined, typed?: string) => ({
  submitted_at: "2026-10-12T09:00:00Z",
  ...(hidden ? { hidden } : {}),
  answers: typed === undefined ? [] : [{ type: "text", text: typed, field: { ref: TYPED } }],
});

describe("the 1-1 form's client", () => {
  it("the link's hidden task_id comes before the typed Client ID", () => {
    expect(checkinTaskId(form({ task_id: "86eyt1d33" }, "86ewvnqh5"))).toBe("86eyt1d33");
    expect(checkinTaskId(form({ task_id: " 86eyt1d33 " }))).toBe("86eyt1d33");
  });

  it("a blank or missing hidden task_id falls back to the typed Client ID", () => {
    for (const hidden of [undefined, {}, { task_id: "" }, { task_id: "  " }] as (Record<string, string> | undefined)[])
      expect(checkinTaskId(form(hidden, " 86ewvnqh5 "))).toBe("86ewvnqh5");
  });

  it("neither gives an empty id", () => {
    expect(checkinTaskId(form(undefined))).toBe("");
    expect(checkinTaskId({})).toBe("");
  });

  it("given the client cards, a hidden id that is not a card gives way to the typed one, as in csm-calls", () => {
    const cards = new Set(["86eyt1d33", "86ewvnqh5"]);
    expect(checkinTaskId(form({ task_id: "xxxxx" }, "86ewvnqh5"), cards)).toBe("86ewvnqh5");
    expect(checkinTaskId(form({ task_id: "86eyt1d33" }, "86ewvnqh5"), cards)).toBe("86eyt1d33");
    expect(checkinTaskId(form({ task_id: "xxxxx" }, ""), cards)).toBe("xxxxx");
    expect(checkinTaskId(form({ task_id: "" }, "86ewvnqh5"), cards)).toBe("86ewvnqh5");
  });

  it("without the client cards there is no roster check, so any non-blank hidden id wins", () => {
    expect(checkinTaskId(form({ task_id: "xxxxx" }, "86ewvnqh5"))).toBe("xxxxx");
  });

  it("a form opened from the client page with no typed id still becomes a note", async () => {
    const reads: Reads = {
      tool: async (_name, args) => ({
        items: String(args.url).includes("fRokTITH")
          ? [form({ task_id: "86eyt1d33" }, ""), form(undefined, "")]
          : [],
      }),
      graph: async () => ({ data: [] }),
      fetch: async () => new Response("{}"),
      log: () => {},
    };
    const { notes } = await withNativeContext(reads, { receipts: [] }, () => cadenceInputs());
    expect(notes.map(n => n.taskId)).toEqual(["86eyt1d33"]);
    expect(notes[0].submitted).toBe("2026-10-12");
  });

  it("given the client cards, a stale link's note goes to the typed client", async () => {
    const reads: Reads = {
      tool: async (_name, args) => ({
        items: String(args.url).includes("fRokTITH") ? [form({ task_id: "xxxxx" }, "86ewvnqh5")] : [],
      }),
      graph: async () => ({ data: [] }),
      fetch: async () => new Response("{}"),
      log: () => {},
    };
    const { notes } = await withNativeContext(reads, { receipts: [] }, () =>
      cadenceInputs(new Set(["86ewvnqh5"])),
    );
    expect(notes.map(n => n.taskId)).toEqual(["86ewvnqh5"]);
  });
});
