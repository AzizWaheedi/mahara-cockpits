import { describe, expect, mock, test } from "bun:test";

// liveHarness reaches the Supabase client through the room fixtures; nothing
// here calls it, but it needs the build's settings to load.
mock.module("../lib/supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
  SUPABASE_URL: "https://example.invalid",
  PROPOSALS_BUCKET: "sales-proposals",
}));

const { Refused } = await import("./liveHarness");
const { zoomAnswer, zoomKnobs, zoomSettings, zoomTables } = await import(
  "./zoomHarness"
);
type Refused = InstanceType<typeof Refused>;

const NOW = Date.parse("2026-10-10T11:00:00Z");

describe("the harness's Zoom stand-in", () => {
  test("knobs: shared and none unless the address says otherwise", () => {
    expect(zoomKnobs(new URLSearchParams(""))).toEqual({
      zoom: "shared",
      group: "none",
    });
    expect(zoomKnobs(new URLSearchParams("zoom=own&group=made"))).toEqual({
      zoom: "own",
      group: "made",
    });
    expect(zoomKnobs(new URLSearchParams("zoom=nonsense")).zoom).toBe("shared");
  });

  test("its tables never carry the settings key, so spreading them keeps every other setting", () => {
    const t = zoomTables({ zoom: "shared", group: "made" });
    expect(Object.keys(t).sort()).toEqual([
      "cockpit_sales_groups",
      "cockpit_sales_zoom_links",
    ]);
    expect(t.cockpit_sales_groups[0]?.contact_id).toBe("lead-11");
    expect(
      zoomSettings({ zoom: "off", group: "none" })[0]?.value,
    ).toMatchObject({ enabled: false });
    expect(
      zoomSettings({ zoom: "busy", group: "none" })[0]?.value,
    ).toMatchObject({ enabled: true });
  });

  test("a press makes a link once, again gives the same, fresh a new one", () => {
    const k = { zoom: "own", group: "none" } as const;
    const a = zoomAnswer(
      "zoom.link",
      { contact_id: "lead-2", kind: "intro" },
      k,
      NOW,
    );
    const b = zoomAnswer(
      "zoom.link",
      { contact_id: "lead-2", kind: "intro" },
      k,
      NOW + 1000,
    );
    const c = zoomAnswer(
      "zoom.link",
      { contact_id: "lead-2", kind: "intro", fresh: true },
      k,
      NOW + 2000,
    );
    const id = (x: unknown) => (x as { link: { id: string } }).link.id;
    expect(id(b)).toBe(id(a));
    expect(b?.reused).toBe(true);
    expect(id(c)).not.toBe(id(a));
    expect((a as { link: { host: string } }).link.host).toBe("own");
    expect(zoomAnswer("zoom.start", { id: id(a) }, k, NOW)).toMatchObject({
      start_url: expect.stringContaining("/s/"),
    });
  });

  test("the refusals carry sales-api's status and code", () => {
    const tryIt = (zoom: "off" | "nokeys" | "fail") => {
      try {
        zoomAnswer(
          "zoom.link",
          { contact_id: "lead-2", kind: "intro" },
          { zoom, group: "none" },
          NOW,
        );
      } catch (e) {
        return e as Refused;
      }
      return null;
    };
    expect(tryIt("off")?.code).toBe("off");
    expect(tryIt("nokeys")?.status).toBe(503);
    expect(tryIt("fail")?.status).toBe(502);
  });

  test("group.made checks the invite link and keeps one row per lead", () => {
    const k = { zoom: "shared", group: "none" } as const;
    expect(() =>
      zoomAnswer(
        "group.made",
        { contact_id: "lead-3", invite_link: "https://wa.me/1" },
        k,
        NOW,
      ),
    ).toThrow(Refused);
    zoomAnswer(
      "group.made",
      {
        contact_id: "lead-3",
        invite_link: "https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv?mode=x",
      },
      k,
      NOW,
    );
    zoomAnswer("group.made", { contact_id: "lead-3" }, k, NOW + 1000);
    const rows = zoomTables(k).cockpit_sales_groups.filter(
      r => r.contact_id === "lead-3",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.invite_link).toBe(
      "https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv",
    );
  });

  test("other actions are not its", () => {
    expect(
      zoomAnswer("dial.queue", {}, { zoom: "shared", group: "none" }, NOW),
    ).toBeNull();
  });
});
