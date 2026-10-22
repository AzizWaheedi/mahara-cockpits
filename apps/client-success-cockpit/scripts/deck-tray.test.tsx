import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Window } from "happy-dom";

/**
 * Where each tray file came from (docs/csm-decks/DRIVE-IMPORT.md 12,
 * supabase/migrations/20261020160300_csm_launch_ads_source.sql): the tray's
 * read parses with and without the new fields, prep's list says "From Drive
 * · pasted by {first name} · {when}" on a Drive file and nothing on an
 * upload, a file is deleted through launchAds.remove after one more press,
 * and only prep shows any of it (the deck and the notes window never do).
 */

const win = new Window({ url: "https://localhost/client-success/" });
for (const k of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "MouseEvent",
  "DocumentFragment",
  "Text",
])
  (globalThis as Record<string, unknown>)[k] =
    k === "window" ? win : (win as unknown as Record<string, unknown>)[k];
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import("react-dom/client");
const React = await import("react");
const { act } = React;
const S = await import("../src/present/sources");
const T = await import("../src/present/TrayFiles");

type LaunchAd = import("../src/present/sources").LaunchAd;

const app = resolve(import.meta.dir, "..");
const repo = resolve(app, "..", "..");

/** A tray row as cockpit_csm_launch_ad_json returns it (before 20261020160300). */
const row = (id: string, extra: Partial<LaunchAd> = {}): LaunchAd =>
  S.launchAdSchema.parse({
    id,
    taskId: "86c1abcde",
    kind: "custom",
    status: "ready",
    path: `86c1abcde/${id}.jpg`,
    mime: "image/jpeg",
    bytes: 2048,
    width: 1080,
    height: 1350,
    seconds: null,
    posterPath: null,
    posterMime: null,
    posterBytes: null,
    fileName: `${id}.jpg`,
    placement: null,
    primaryText: null,
    headline: null,
    cta: null,
    language: null,
    hidden: false,
    createdAt: "2026-10-18T10:00:00Z",
    createdBy: "csm@maharamedia.com",
    readyAt: "2026-10-18T10:00:05Z",
    updatedAt: "2026-10-18T10:00:05Z",
    updatedBy: "csm@maharamedia.com",
    removedAt: null,
    purgedAt: null,
    url: `https://example.supabase.co/storage/v1/object/sign/cockpit-launch-ads/${id}.jpg?token=t`,
    posterUrl: null,
    ...extra,
  });

// Local times, so "yesterday, 19:40" holds in any time zone the test runs in.
const NOW = new Date(2026, 9, 19, 9, 0);
const YESTERDAY = new Date(2026, 9, 18, 19, 40).toISOString();
const TODAY = new Date(2026, 9, 19, 8, 5).toISOString();
const EARLIER = new Date(2026, 9, 12, 11, 30).toISOString();

describe("the tray's read, before and after the migration", () => {
  test("a row without a source parses (the live read before 20261020160300)", () => {
    const r = row("a1");
    expect(r.source).toBeUndefined();
    expect(T.provenanceLine(r, NOW)).toBeNull();
  });

  test("a Drive row carries its source, the importer's first name and when", () => {
    const r = row("a2", {
      source: "drive",
      importedBy: "Sara",
      importedAt: YESTERDAY,
    });
    expect(r).toMatchObject({ source: "drive", importedBy: "Sara" });
  });

  test("a source this build does not know reads as none, and the row still parses", () => {
    const r = S.launchAdSchema.parse({
      ...row("a3"),
      source: "meta",
    });
    expect(r.source).toBeNull();
    expect(T.provenanceLine(r, NOW)).toBeNull();
  });

  test("the list call keeps the new fields", async () => {
    const calls: unknown[] = [];
    const client = {
      functions: {
        invoke: async (name: string, opts: { body: unknown }) => {
          calls.push([name, opts.body]);
          return {
            data: {
              ads: [
                row("b1"),
                row("b2", {
                  source: "drive",
                  importedBy: "Noura",
                  importedAt: TODAY,
                }),
              ],
              expiresIn: 3600,
            },
            error: null,
          };
        },
      },
    } as never;
    const ads = await S.listLaunchAds(client, "86c1abcde");
    expect(
      ads.map(a => [a.id, a.source ?? null, a.importedBy ?? null]),
    ).toEqual([
      ["b1", null, null],
      ["b2", "drive", "Noura"],
    ]);
    expect((calls[0] as [string, { operation: string }])[1].operation).toBe(
      "launchAds.list",
    );
  });
});

describe("the provenance line", () => {
  test("From Drive · pasted by {first name} · {when}, on the CSM's clock", () => {
    const at = (importedAt: string, importedBy: string | null = "Sara") =>
      T.provenanceLine(
        row("c1", { source: "drive", importedBy, importedAt }),
        NOW,
      );
    expect(at(YESTERDAY)).toBe(
      "From Drive · pasted by Sara · yesterday, 19:40",
    );
    expect(at(TODAY)).toBe("From Drive · pasted by Sara · today, 08:05");
    expect(at(EARLIER)).toBe("From Drive · pasted by Sara · 12 Oct, 11:30");
    // A name the read did not have: the line still says it came from Drive.
    expect(at(YESTERDAY, null)).toBe("From Drive · yesterday, 19:40");
    expect(at(YESTERDAY, "  ")).toBe("From Drive · yesterday, 19:40");
  });

  test("an upload by hand says nothing", () => {
    expect(T.provenanceLine(row("c2", { source: "upload" }), NOW)).toBeNull();
  });

  test("the form rules: no exclamation mark, no dash, sentence case", () => {
    const line =
      T.provenanceLine(
        row("c3", {
          source: "drive",
          importedBy: "Sara",
          importedAt: YESTERDAY,
        }),
        NOW,
      ) ?? "";
    expect(line).not.toMatch(/[!—–]/);
    expect(line.startsWith("From Drive")).toBe(true);
  });
});

describe("the delete call", () => {
  test("launchAds.remove with the client and the file, nothing else", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const client = {
      functions: {
        invoke: async (
          name: string,
          opts: { body: Record<string, unknown> },
        ) => {
          calls.push([name, opts.body]);
          return {
            data: {
              ad: row("d1", { status: "removed", removedAt: TODAY } as never),
              deleted: true,
            },
            error: null,
          };
        },
      },
    } as never;
    const out = await S.removeLaunchAd(client, "86c1abcde", "d1");
    expect(out.status).toBe("removed");
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toBe("cockpit-csm-api");
    expect(calls[0][1]).toMatchObject({
      operation: "launchAds.remove",
      args: { taskId: "86c1abcde", id: "d1" },
    });
    expect(Object.keys(calls[0][1]).sort()).toEqual([
      "args",
      "operation",
      "requestId",
    ]);
  });

  test("a refusal comes back as the server's sentence", async () => {
    const client = {
      functions: {
        invoke: async () => ({
          data: null,
          error: {
            message: "Edge Function returned a non-2xx status code",
            context: new Response(
              JSON.stringify({
                error: "That file is not one of this client's uploads",
              }),
              { status: 403 },
            ),
          },
        }),
      },
    } as never;
    await expect(S.removeLaunchAd(client, "86c1abcde", "d2")).rejects.toThrow(
      "That file is not one of this client's uploads",
    );
  });
});

describe("prep's list, mounted", () => {
  const host = win.document.createElement("div");
  win.document.body.appendChild(host);
  const root = createRoot(host as unknown as Element);
  afterAll(async () => {
    await act(async () => root.unmount());
  });
  const text = () => host.textContent ?? "";
  const items = () => [...host.querySelectorAll("[data-tray-file]")];
  const buttons = (label: RegExp) =>
    [...host.querySelectorAll("button")].filter(b =>
      label.test(
        `${b.getAttribute("aria-label") ?? ""} ${b.textContent ?? ""}`.trim(),
      ),
    ) as unknown as HTMLButtonElement[];
  const press = async (b: HTMLButtonElement | undefined) => {
    if (!b) throw Error("no such button");
    await act(async () => {
      b.click();
    });
  };

  const ads = [
    row("e1", { fileName: "dining-north-riyadh.jpg", source: "upload" }),
    row("e2", {
      fileName: "home-walk.mp4",
      mime: "video/mp4",
      source: "drive",
      importedBy: "Sara",
      importedAt: YESTERDAY,
      hidden: true,
    }),
    row("e3", {
      fileName: "majlis-wide.jpg",
      kind: "starter",
      source: "drive",
      importedBy: "Noura",
      importedAt: TODAY,
    }),
  ];

  test("newest first; a Drive file says who pasted it and when, an upload says nothing; never an address or a link", async () => {
    await act(async () => {
      root.render(<T.TrayFiles ads={ads} now={NOW} />);
    });
    expect(items().map(li => li.getAttribute("data-tray-file"))).toEqual([
      "drive",
      "drive",
      "upload",
    ]);
    const lines = items().map(li => li.textContent ?? "");
    expect(lines[0]).toContain("majlis-wide.jpg");
    expect(lines[0]).toContain("Picture · starter template");
    expect(lines[0]).toContain("From Drive · pasted by Noura · today, 08:05");
    expect(lines[1]).toContain("Video · their own · hidden from the deck");
    expect(lines[1]).toContain(
      "From Drive · pasted by Sara · yesterday, 19:40",
    );
    expect(lines[2]).toContain("dining-north-riyadh.jpg");
    expect(lines[2]).not.toContain("From Drive");
    expect(text()).toContain("Their files (3)");
    expect(text()).not.toContain("@");
    expect(text()).not.toContain("drive.google.com");
    // Nothing can be deleted where the window has no delete.
    expect(buttons(/Delete/).length).toBe(0);
  });

  test("delete asks once more, then calls the delete with the file's id, takes the row away and says so", async () => {
    const removed: string[] = [];
    let reread = 0;
    await act(async () => {
      root.render(
        <T.TrayFiles
          ads={ads}
          now={NOW}
          remove={async id => {
            removed.push(id);
          }}
          onRemoved={() => {
            reread += 1;
          }}
        />,
      );
    });
    expect(buttons(/^Delete majlis-wide\.jpg/).length).toBe(1);
    await press(buttons(/^Delete majlis-wide\.jpg/)[0]);
    expect(removed).toEqual([]);
    expect(text()).toContain("Delete it for good?");
    // Keep it: nothing happens.
    await press(buttons(/^Keep it$/)[0]);
    expect(text()).not.toContain("Delete it for good?");
    expect(removed).toEqual([]);
    await press(buttons(/^Delete majlis-wide\.jpg/)[0]);
    await press(buttons(/^Delete$/)[0]);
    expect(removed).toEqual(["e3"]);
    expect(reread).toBe(1);
    expect(items().length).toBe(2);
    expect(
      items().some(li => li.textContent?.includes("majlis-wide.jpg")),
    ).toBe(false);
    expect(host.querySelector("[role=status]")?.textContent).toBe(
      "Deleted majlis-wide.jpg.",
    );
  });

  test("a delete that fails keeps the row and says what happened", async () => {
    await act(async () => {
      root.render(
        <T.TrayFiles
          key="failing"
          ads={ads}
          now={NOW}
          remove={async () => {
            throw Error(
              "No connection. Your change is kept here and saves when you are back online.",
            );
          }}
        />,
      );
    });
    await press(buttons(/^Delete home-walk\.mp4/)[0]);
    await press(buttons(/^Delete$/)[0]);
    expect(items().length).toBe(3);
    expect(host.querySelector("[role=status]")?.textContent).toBe(
      "home-walk.mp4 wasn't deleted. No connection. Your change is kept here and saves when you are back online.",
    );
  });

  test("an empty tray says what to do next; a long one folds after six", async () => {
    await act(async () => {
      root.render(<T.TrayFiles key="empty" ads={[]} now={NOW} />);
    });
    expect(text()).toContain(
      "Nothing saved for this client yet. Paste a Drive link or add a file above.",
    );
    const many = Array.from({ length: 8 }, (_, i) => row(`f${i}`));
    await act(async () => {
      root.render(<T.TrayFiles key="many" ads={many} now={NOW} />);
    });
    expect(items().length).toBe(T.TRAY_SHOWN);
    await press(buttons(/^Show all 8$/)[0]);
    expect(items().length).toBe(8);
  });
});

describe("only prep shows where a file came from", () => {
  const present = resolve(app, "src/present");
  const files = readdirSync(present).filter(f => /\.tsx?$/.test(f));
  const read = (f: string) => readFileSync(resolve(present, f), "utf8");

  test("the read's new fields are used by sources.ts and the list alone", () => {
    expect(
      files.filter(f => /\bimportedBy\b|\bimportedAt\b/.test(read(f))).sort(),
    ).toEqual(["TrayFiles.tsx", "sources.ts"]);
  });

  test("the list is mounted by prep alone (never the deck or the notes window)", () => {
    expect(
      files.filter(f => /from "\.\/TrayFiles"/.test(read(f))).sort(),
    ).toEqual(["PrepView.tsx"]);
  });

  test("the deck's own read (deck sources) is not the one the migration changes", () => {
    const sql = readFileSync(
      resolve(
        repo,
        "supabase/migrations/20261020160300_csm_launch_ads_source.sql",
      ),
      "utf8",
    );
    const replaced = [
      ...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g),
    ].map(m => m[1]);
    expect(replaced).toEqual([
      "cockpit_csm_launch_ads_read",
      "cockpit_csm_launch_ad_reserve",
    ]);
  });
});
