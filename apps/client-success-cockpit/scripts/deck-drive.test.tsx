import { afterAll, describe, expect, mock, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Window } from "happy-dom";

/**
 * Their ads from a Drive link, the browser's side (the CEO, 2026-10-20:
 * "allow just a drive link to work and it can work with folder or just the
 * video"; docs/csm-decks/DRIVE-IMPORT.md 2 and 8, DESIGN.md 22.7): the link
 * pre-check against the cases the SQL parser is tested on, the paste split,
 * the words against the spec's tables, every state the box shows, the
 * reads' clock (5 s while open, the back-off, hidden, not live), the two
 * calls' names and arguments, and on a mounted box: a pasted WhatsApp
 * message sends each link in turn, says the skipped one as a note, and
 * a file landing reads the tray again.
 */

const win = new Window({ url: "https://localhost/client-success/" });
for (const k of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "Element",
  "Node",
  "Event",
  "FocusEvent",
  "KeyboardEvent",
  "DocumentFragment",
  "Text",
  "sessionStorage",
  "localStorage",
])
  (globalThis as Record<string, unknown>)[k] =
    k === "window" ? win : (win as unknown as Record<string, unknown>)[k];
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
mock.module("@/auth/SupabaseAuthProvider", () => ({
  getCockpitSupabaseClient: () => null,
  useCockpitAuth: () => ({ client: null }),
}));

const { createRoot } = await import("react-dom/client");
const React = await import("react");
const { act } = React;
const L = await import("../src/present/driveLink");
const C = await import("../src/present/driveCopy");
const V = await import("../src/present/driveView");
const H = await import("../src/present/useDriveImports");
const S = await import("../src/present/sources");
const { DriveBox } = await import("../src/present/DriveBox");
const F = await import("../src/practice/fixtures/driveFixtures");

type DriveImport = import("../src/present/sources").DriveImport;
type DriveImports = import("../src/present/sources").DriveImports;

const app = resolve(import.meta.dir, "..");
const repo = resolve(app, "..", "..");
const doc = (name: string) =>
  readFileSync(resolve(repo, "docs/csm-decks", name), "utf8");
/** One markdown section, from its heading to the next of the same level. */
function section(text: string, heading: RegExp): string {
  const lines = text.split("\n");
  const at = lines.findIndex(l => heading.test(l));
  if (at < 0) throw Error(`no section ${heading}`);
  const level = /^#+/.exec(lines[at])?.[0].length ?? 2;
  const end = lines.findIndex(
    (l, i) =>
      i > at && /^#+ /.test(l) && (/^#+/.exec(l)?.[0].length ?? 9) <= level,
  );
  return lines.slice(at, end < 0 ? undefined : end).join("\n");
}
/** A table's rows as their cells. */
const rows = (text: string) =>
  text
    .split("\n")
    .filter(l => /^\|/.test(l) && !/^\|\s*-/.test(l))
    .map(l =>
      l
        .replace(/^\|/, "")
        .replace(/\|\s*$/, "")
        .split(/(?<!\\)\|/)
        .map(c => c.trim()),
    );

const NOW = Date.parse("2026-10-20T13:10:00+03:00");

describe("the link pre-check: the cases the server's parser is tested on", () => {
  const cases = JSON.parse(
    readFileSync(resolve(app, "src/present/driveLink.cases.json"), "utf8"),
  ) as {
    cases: Array<{ name: string; link: string | null; want: unknown }>;
  };

  test("every shape in DRIVE-IMPORT.md 2 is a case", () => {
    expect(cases.cases.length).toBeGreaterThan(50);
    const kinds = new Set(
      cases.cases.map(c =>
        (c.want as { ok: boolean; kind?: string; code?: string }).ok
          ? (c.want as { kind: string }).kind
          : (c.want as { code: string }).code,
      ),
    );
    for (const k of [
      "folder",
      "file",
      "either",
      "link_empty",
      "link_docs",
      "link_page",
      "link_bad",
    ])
      expect(kinds.has(k)).toBe(true);
  });

  for (const c of cases.cases)
    test(c.name, () => {
      expect(L.parseDriveLink(c.link)).toEqual(c.want as never);
    });

  test("the rebuilt link keeps only the id and the resource key", () => {
    const p = L.parseDriveLink(
      "https://drive.google.com/drive/u/1/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345?authuser=sara@maharamedia.com&resourcekey=0-Ab&usp=sharing",
    );
    expect(p.ok && p.link).toBe(
      "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345?resourcekey=0-Ab",
    );
    expect(JSON.stringify(p)).not.toContain("maharamedia");
  });
});

describe("a paste split into its links", () => {
  const folder =
    "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv";
  const reel = "https://drive.google.com/file/d/1ZyXwVuTsRqPoNmLkJiHg/view";

  test("a WhatsApp message with three links, a trailing full stop and a duplicate", () => {
    const message = [
      "صباح الخير، هذي صور المشاريع:",
      `${folder}?usp=sharing`,
      `والريل: ${reel}.`,
      `and again (${folder}/),`,
      "the brief <https://docs.google.com/document/d/1AbCdEfGhIjK/edit>",
    ].join("\n");
    const { links, extra } = L.splitDriveLinks(message);
    expect(links).toEqual([
      `${folder}?usp=sharing`,
      reel,
      "https://docs.google.com/document/d/1AbCdEfGhIjK/edit",
    ]);
    expect(extra).toBe(0);
  });

  test("pastes from an Arabic chat: a link after a colon, in guillemets, or with a direction mark", () => {
    const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
    const url = `https://drive.google.com/drive/folders/${id}`;
    expect(L.splitDriveLinks(`الملفات هنا:${url}`).links).toEqual([url]);
    expect(L.splitDriveLinks(`المجلد «${url}» شكراً`).links).toEqual([url]);
    const marked = L.splitDriveLinks(`هذا الرابط ${url}\u200f`);
    expect(marked.links).toEqual([url]);
    const p = L.parseDriveLink(marked.links[0]);
    expect(p.ok && p.id).toBe(id);
  });

  test("eleven links: the first ten go, one is counted beyond them", () => {
    const eleven = Array.from(
      { length: 11 },
      (_, i) =>
        `https://drive.google.com/drive/folders/1Folder${String(i).padStart(4, "0")}abcd`,
    );
    const { links, extra } = L.splitDriveLinks(eleven.join(" \t "));
    expect(links).toEqual(eleven.slice(0, 10));
    expect(extra).toBe(1);
  });

  test("words are not links; typed text with no link is one piece, so it is refused", () => {
    expect(L.splitDriveLinks("thanks, the folder is coming").links).toEqual([]);
    expect(L.typedDriveLinks("hello").links).toEqual(["hello"]);
    expect(L.typedDriveLinks("   ").links).toEqual([]);
    expect(
      L.typedDriveLinks(`drive.google.com/drive/folders/1AbCdEfGhIjKlMn`).links,
    ).toEqual(["drive.google.com/drive/folders/1AbCdEfGhIjKlMn"]);
  });

  test("a long link is cut in the middle, its start and its id's end kept", () => {
    const cut = L.cutMiddle(`${folder}?usp=sharing`, 40);
    expect(cut.length).toBe(40);
    expect(cut.startsWith("https://drive.google.com")).toBe(true);
    expect(cut.endsWith("sharing")).toBe(true);
    expect(cut).toContain("…");
    expect(L.cutMiddle("short", 40)).toBe("short");
  });
});

describe("the words, as the spec writes them", () => {
  const spec = section(
    doc("DRIVE-IMPORT.md"),
    /^## 6\. Every sentence and code/,
  );
  const en = section(
    doc("CONTENT.md"),
    /^## The Drive link \(prep's ads panel/,
  );
  const ar = section(
    doc("CONTENT-AR.md"),
    /^## The Drive link \(prep's ads panel/,
  );
  const code = (cell: string) => /`([a-z_]+)`/.exec(cell)?.[1] ?? "";
  const variant = (cell: string) =>
    /\((?:an? )?([a-z?=]+)/.exec(cell)?.[1] ?? "";

  test("the request's refusals: English from DRIVE-IMPORT.md 6, Arabic from CONTENT-AR", () => {
    const raised = rows(spec).filter(
      r => r.length === 3 && /`22023`/.test(r[0]),
    );
    expect(raised.length).toBe(6);
    for (const [, hint, sentence] of raised)
      expect(C.DRIVE_REFUSED[code(hint)]?.en).toBe(sentence);
    for (const r of rows(ar).filter(
      r => r.length === 3 && /^`link_|^`too_many/.test(r[0]),
    ))
      expect([
        r[0],
        C.DRIVE_REFUSED[code(r[0])]?.en,
        C.DRIVE_REFUSED[code(r[0])]?.ar,
      ]).toEqual([r[0], r[1], r[2]]);
  });

  test("a failed import's and a failed file's sentences, both languages", () => {
    const stored = rows(spec).filter(
      r => r.length === 2 && /^`[a-z_]+`/.test(r[0]),
    );
    let checked = 0;
    for (const [cell, sentence] of stored) {
      const c = code(cell);
      const v = variant(cell);
      const t =
        c === "not_found"
          ? C.DRIVE_FAILED.not_found[
              v === "folder" ? "folder" : v === "file" ? "file" : "either"
            ]
          : c === "too_big"
            ? C.DRIVE_FILE_FAILED.too_big[v === "video" ? "video" : "image"]
            : c === "converted"
              ? C.DRIVE_NOTE.converted
              : ((C.DRIVE_FAILED as Record<string, { en: string; ar: string }>)[
                  c
                ] ??
                (
                  C.DRIVE_FILE_FAILED as Record<
                    string,
                    { en: string; ar: string }
                  >
                )[c]);
      expect([cell, t?.en]).toEqual([cell, sentence]);
      checked += 1;
    }
    expect(checked).toBe(19);
    const arRows = rows(ar).filter(
      r => r.length === 3 && /^`[a-z_]+`/.test(r[0]),
    );
    for (const [cell, english, arabic] of arRows) {
      const c = code(cell);
      const v = variant(cell);
      const t =
        c === "not_found"
          ? C.DRIVE_FAILED.not_found[
              v === "folder" ? "folder" : v === "file" ? "file" : "either"
            ]
          : c === "too_big"
            ? C.DRIVE_FILE_FAILED.too_big[v === "video" ? "video" : "image"]
            : c === "converted"
              ? C.DRIVE_NOTE.converted
              : ((
                  C.DRIVE_REFUSED as Record<string, { en: string; ar: string }>
                )[c] ??
                (C.DRIVE_FAILED as Record<string, { en: string; ar: string }>)[
                  c
                ] ??
                (
                  C.DRIVE_FILE_FAILED as Record<
                    string,
                    { en: string; ar: string }
                  >
                )[c]);
      expect([cell, t?.en, t?.ar]).toEqual([cell, english, arabic]);
    }
    expect(arRows.length).toBe(25);
  });

  test("the box's own lines, word for word in both tables", () => {
    const enCells = rows(en).flatMap(r =>
      r.slice(1).flatMap(c => c.split(" · ")),
    );
    const arPairs = rows(ar).filter(r => r.length === 2);
    const has = (cells: string[], s: string) =>
      cells.some(c => c === s || c.startsWith(`${s} (`));
    const skip = new Set(["yesterday", "today", "file"]);
    for (const [k, v] of Object.entries(C.DRIVE_UI)) {
      if (skip.has(k)) continue;
      const l = v as { en: string; ar: string };
      expect([k, has(enCells, l.en)]).toEqual([k, true]);
      const pair = arPairs.find(
        ([e]) => e.split(" · ").includes(l.en) || e === l.en,
      );
      const arCell = pair?.[1].split(" · ") ?? [];
      const at = pair?.[0].split(" · ").indexOf(l.en) ?? -1;
      expect([k, at >= 0 ? arCell[at] : pair?.[1]]).toEqual([k, l.ar]);
    }
    const states = Object.values(C.DRIVE_UI.file);
    const enStates = enCells.slice(
      enCells.indexOf("Waiting"),
      enCells.indexOf("Waiting") + 4,
    );
    expect(states.map(s => s.en)).toEqual(enStates);
    const arStates = arPairs
      .find(([e]) => e.startsWith("Waiting · "))?.[1]
      .split(" · ");
    expect(states.map(s => s.ar)).toEqual(arStates as string[]);
  });

  test("the counts: English singular and plural, Arabic's four number forms", () => {
    expect(C.bringingFiles(6, "en")).toBe("Bringing in 6 files from Drive…");
    expect(C.bringingFiles(1, "en")).toBe("Bringing in 1 file from Drive…");
    expect(C.broughtFiles(1, "en")).toBe("Brought in 1 file from Drive.");
    expect(C.broughtFiles(4, "en")).toBe("Brought in 4 files from Drive.");
    expect(C.severalLinks(3, "en")).toBe("Bringing in 3 links from Drive…");
    for (const s of [
      "Bringing in {n} files from Drive… · Bringing in 1 file from Drive…",
      "Brought in {n} files from Drive. · Brought in 1 file from Drive.",
      "Bringing in {n} links from Drive…",
    ])
      expect(en).toContain(s);
    expect(C.bringingFiles(1, "ar")).toBe("نجيب ملف واحد من الدرايف…");
    expect(C.bringingFiles(2, "ar")).toBe("نجيب ملفين من الدرايف…");
    expect(C.bringingFiles(6, "ar")).toBe("نجيب ٦ ملفات من الدرايف…");
    expect(C.bringingFiles(14, "ar")).toBe("نجيب ١٤ ملف من الدرايف…");
    expect(C.broughtFiles(10, "ar")).toBe("جبنا ١٠ ملفات من الدرايف.");
    expect(C.severalLinks(2, "ar")).toBe("نجيب رابطين من الدرايف…");
    expect(C.severalLinks(7, "ar")).toBe("نجيب ٧ روابط من الدرايف…");
    // Of how many, when finished links show under the open ones.
    expect(C.severalLinksOf(3, 6, "en")).toBe(
      "Bringing in 3 of 6 links from Drive…",
    );
    expect(C.severalLinksOf(3, 6, "ar")).toBe("نجيب ٣ من ٦ روابط من الدرايف…");
    expect(C.severalLinksOf(2, 12, "ar")).toBe("نجيب ٢ من ١٢ رابط من الدرايف…");
    expect(en).toContain("Bringing in {n} of {total} links from Drive…");
    expect(ar).toContain("نجيب {n} من {total} روابط من الدرايف…");
    expect(ar).toContain(
      "(١: ملف واحد · ٢: ملفين · ٣ إلى ١٠: {n} ملفات · ١١ إلى ٢٠: {n} ملف)",
    );
    expect(ar).toContain("(٢: رابطين · ٣ إلى ١٠: {n} روابط)");
  });

  test("the form rules hold: no exclamation marks, no dashes, plain quotes, Arabic digits", () => {
    const all: Array<{ k: string; v: string }> = [];
    const walk = (v: unknown, k: string) => {
      if (typeof v === "string") all.push({ k, v });
      else if (v && typeof v === "object")
        for (const [kk, vv] of Object.entries(v)) walk(vv, `${k}.${kk}`);
    };
    for (const name of [
      "DRIVE_UI",
      "DRIVE_REFUSED",
      "DRIVE_FAILED",
      "DRIVE_FILE_FAILED",
      "DRIVE_NOTE",
    ])
      walk((C as Record<string, unknown>)[name], name);
    expect(all.length).toBeGreaterThan(80);
    expect(all.filter(x => /[!！]|[—–]|[“”‘’«»]/.test(x.v))).toEqual([]);
    // Latin digits in Arabic only inside a product's name (MP4).
    expect(
      all.filter(
        x =>
          /\.ar$/.test(x.k) &&
          /[0-9]/.test(x.v.replace(/[A-Za-z]+[0-9]+/g, "")),
      ),
    ).toEqual([]);
    expect(
      all.filter(x => /\b(leads?|cost per lead|budget)\b/i.test(x.v)),
    ).toEqual([]);
  });
});

/** A read around `now`, as the server gives it. */
const readOf = (
  s: Parameters<typeof F.driveScenario>[0],
  now = NOW,
): DriveImports => ({
  ...F.driveScenario(s, now),
  at: new Date(now).toISOString(),
});

describe("every state the box shows (DRIVE-IMPORT.md 8)", () => {
  const view = (
    s: Parameters<typeof F.driveScenario>[0],
    lang: "en" | "ar" = "en",
  ) => V.boxView(readOf(s), lang, new Date(NOW));

  test("idle: no import, nothing under the box", () => {
    expect(view("idle")).toEqual({ head: null, blocks: [] });
    expect(V.boxView(null, "en", new Date(NOW))).toEqual({
      head: null,
      blocks: [],
    });
  });

  test("queued, opening, working", () => {
    expect(view("queued").blocks[0].line).toEqual({
      text: "Waiting to start. It usually starts within a minute.",
      tone: "muted",
    });
    expect(view("opening").blocks[0].line.text).toBe("Opening the Drive link…");
    const w = view("working").blocks[0];
    expect(w.line.text).toBe("Bringing in 6 files from Drive…");
    expect(w.files.map(f => f.state.text)).toEqual([
      "In the tray",
      "In the tray",
      "Already in the tray",
      "Bringing in",
      "Waiting",
      "Waiting",
    ]);
    expect(w.files[1].note).toBe(
      "\u2068site-walk.mov\u2069 was converted to MP4 so it plays in every browser.",
    );
    expect(w.share).toBeCloseTo(3 / 6);
    expect(w.files[3].short).toContain("…");
    expect(w.files[3].href).toBe(
      `https://drive.google.com/file/d/${w.files[3].id}/view`,
    );
    expect(view("working", "ar").blocks[0].line.text).toBe(
      "نجيب ٦ ملفات من الدرايف…",
    );
  });

  test("done: all, some with each file's reason, nothing new, more than 20", () => {
    expect(view("done").blocks[0].line).toEqual({
      text: "Brought in 6 files from Drive.",
      tone: "good",
    });
    const some = view("some").blocks[0];
    expect(some.line.text).toBe(
      "Brought in 3 of 6 files. Each one that didn't come in says why below.",
    );
    expect(
      some.files.filter(f => f.state.tone === "warn").map(f => f.state.text),
    ).toEqual([
      "drone-flyover-4k.mov is too long or too large to bring in. Upload a cut under 5 minutes, or send it in the group.",
      "IMG_4471.HEIC is an iPhone photo (HEIC) we couldn't convert. Export it as JPG and upload it here.",
    ]);
    expect(
      V.boxView(readOf("some"), "ar", new Date(NOW)).blocks[0].line.text,
    ).toBe("جبنا ٣ من ٦. واللي ما وصل، مكتوب تحته السبب.");
    expect(
      V.boxView(readOf("some"), "ar", new Date(NOW)).blocks[0].files[4].state
        .text,
    ).toBe(
      "\u2068drone-flyover-4k.mov\u2069 طويل أو حجمه كبير، وما نقدر نجيبه. ارفع نسخة أقل من ٥ دقايق، أو أرسله بالقروب.",
    );
    expect(view("nothing-new").blocks[0].line.text).toBe(
      "Everything in this link is already in the tray.",
    );
    const over = view("over").blocks[0];
    expect(over.line.text).toBe("Brought in 20 files from Drive.");
    expect(over.extra?.text).toBe(
      "Only the newest 20 came in. Paste a subfolder's link for the rest.",
    );
  });

  test("failed: the server's sentence, and its Arabic by code and kind", () => {
    expect(view("failed").blocks[0].line).toEqual({
      text: "We can't open this folder. Ask the client to share it as anyone with the link, or move it into their Drive folder.",
      tone: "warn",
    });
    expect(view("failed", "ar").blocks[0].line.text).toBe(
      "ما نقدر نفتح هالمجلد. اطلب من العميل يشاركه مع أي شخص لديه الرابط، أو ينقله داخل مجلدهم بالدرايف.",
    );
  });

  test("nobody picked it up: queued over 3 minutes and the worker quiet, or never seen", () => {
    expect(view("nobody").blocks[0].line).toEqual({
      text: "Nothing has picked this up yet. The Drive importer last ran yesterday, 13:02. Upload the files here for now.",
      tone: "warn",
    });
    expect(view("nobody", "ar").blocks[0].line.text).toBe(
      "ما بدينا فيه للحين. آخر مرة اشتغلت أداة الدرايف أمس الساعة 13:02. ارفع الملفات هنا لين ترجع تشتغل.",
    );
    expect(view("never").blocks[0].line.text).toBe(
      "The Drive importer hasn't run yet. Upload the files here for now.",
    );
    // Two minutes queued, or a worker seen a minute ago: still just waiting.
    const q = readOf("queued");
    const two = {
      ...q.imports[0],
      requestedAt: new Date(NOW - 2 * 60_000).toISOString(),
    };
    expect(V.nobodyPickedUp(two, q)).toBe(false);
    const four = {
      ...q.imports[0],
      requestedAt: new Date(NOW - 4 * 60_000).toISOString(),
    };
    expect(V.nobodyPickedUp(four, q)).toBe(false);
    expect(V.nobodyPickedUp(four, { ...q, workerSeenAt: null })).toBe(true);
    // A working import is never "nobody": a long download keeps workerSeenAt fresh.
    expect(
      V.nobodyPickedUp(
        { ...four, status: "working" },
        { ...q, workerSeenAt: null },
      ),
    ).toBe(false);
  });

  test("stalled: working, but the importer quiet for over 10 minutes, says so instead of 'Bringing in' forever", () => {
    const q = readOf("queued");
    const working = {
      ...q.imports[0],
      status: "working" as const,
      startedAt: new Date(NOW - 20 * 60_000).toISOString(),
    };
    const at = new Date(NOW).toISOString();
    // Seen 2 minutes ago: still working.
    expect(
      V.stalledWorking(working, {
        at,
        workerSeenAt: new Date(NOW - 2 * 60_000).toISOString(),
      }),
    ).toBe(false);
    // Seen 11 minutes ago: stalled.
    const quiet = {
      at,
      workerSeenAt: new Date(NOW - 11 * 60_000).toISOString(),
    };
    expect(V.stalledWorking(working, quiet)).toBe(true);
    // Never seen: falls back to when it started (20 minutes ago).
    expect(V.stalledWorking(working, { at, workerSeenAt: null })).toBe(true);
    // A queued import is never "stalled".
    expect(V.stalledWorking(q.imports[0], quiet)).toBe(false);
    const line = V.importLine(working, quiet, "en", new Date(NOW));
    expect(line.state).toBe("stalled");
    expect(line.line.tone).toBe("warn");
    expect(line.line.text).toStartWith(
      "This stopped part-way. The Drive importer last ran ",
    );
    expect(
      V.importLine(working, quiet, "ar", new Date(NOW)).line.text,
    ).toStartWith("الاستيراد وقف بالنص. آخر مرة اشتغلت أداة الدرايف الساعة ");
    // The harness's own card (view=drive) shows it, so it can be reviewed.
    expect(F.DRIVE_SCENARIOS).toContain("stalled");
    const stalled = readOf("stalled");
    expect(
      V.importLine(stalled.imports[0], stalled, "en", new Date(NOW)).state,
    ).toBe("stalled");
  });

  test("the harness's pretend worker: a video lands as an MP4 with its poster, and a file two links share lands once", async () => {
    let now = NOW;
    const ads: {
      fileName?: string | null;
      mime: string;
      posterUrl?: string | null;
    }[] = [];
    const io = F.fakeDrive({
      scenario: "idle",
      taskId: "fixture-full",
      addAd: a => ads.push(a),
      now: () => now,
    });
    await io.requestDriveImport(
      "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv",
    );
    await io.requestDriveImport(
      "https://drive.google.com/file/d/1ZyXwVuTsRqPoNmLkJiHgFe/view",
    );
    now += 5 * 60_000;
    const read = await io.readDriveImports();
    const names = ads.map(a => a.fileName);
    // Each Drive file once in the tray, though both links hold living-corner.jpg.
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter(n => n === "living-corner.jpg")).toHaveLength(1);
    const shared = read.imports
      .flatMap(i => i.files)
      .filter(f => f.name === "living-corner.jpg")
      .map(f => f.status)
      .sort();
    expect(shared).toEqual(["landed", "skipped"]);
    const walk = ads.find(a => a.fileName === "site-walk.mov");
    expect(walk?.mime).toBe("video/mp4");
    expect(walk?.posterUrl).toBeTruthy();
  });

  test("several open: the head line, every open import and the three newest finished", () => {
    const v = view("several");
    // Counted against every card the box shows (score round 2: "3 links"
    // sat over six cards).
    expect(v.head).toBe("Bringing in 3 of 6 links from Drive…");
    expect(v.blocks.map(b => b.state)).toEqual([
      "queued",
      "opening",
      "working",
      "done",
      "failed",
      "done",
    ]);
    expect(view("several", "ar").head).toBe("نجيب ٣ من ٦ روابط من الدرايف…");
    expect(view("working").head).toBeNull();
  });

  test("the time: today, yesterday, earlier; Arabic digits in Arabic", () => {
    const now = new Date(2026, 9, 20, 15, 0);
    expect(
      V.timeLabel(new Date(2026, 9, 20, 13, 2).toISOString(), now, "en"),
    ).toBe("today, 13:02");
    expect(
      V.timeLabel(new Date(2026, 9, 19, 9, 5).toISOString(), now, "en"),
    ).toBe("yesterday, 09:05");
    expect(
      V.timeLabel(new Date(2026, 9, 16, 9, 5).toISOString(), now, "en"),
    ).toBe("16 Oct, 09:05");
    expect(
      V.timeLabel(new Date(2026, 9, 19, 9, 5).toISOString(), now, "ar"),
    ).toBe("أمس الساعة 09:05");
    expect(
      V.timeLabel(new Date(2026, 9, 16, 9, 5).toISOString(), now, "ar"),
    ).toBe("يوم ١٦ أكتوبر الساعة 09:05");
  });

  test("the read failed, said with its reason", () => {
    expect(V.readFailedLine("No connection", "en")).toBe(
      "Couldn't check the import: no connection. Trying again.",
    );
    expect(V.readFailedLine("the server did not answer.", "ar")).toBe(
      "ما قدرنا نتأكد من الاستيراد: \u2066the server did not answer\u2069. نحاول مرة ثانية.",
    );
  });
});

describe("the reads' clock", () => {
  function rig(
    reads: Array<DriveImports | Error>,
    hiddenAt: { v: boolean } = { v: false },
  ) {
    const timers: Array<{ fn: () => void; ms: number; id: number }> = [];
    let id = 0;
    const seen: number[] = [];
    const p = new H.DrivePoller({
      read: async () => {
        const r = reads.shift();
        if (!r) throw Error("no more reads");
        if (r instanceof Error) throw r;
        return r;
      },
      onRead: (_r, seq) => seen.push(seq),
      onError: () => {},
      isNotLive: e => e instanceof S.DriveImportError && e.notLive,
      hidden: () => hiddenAt.v,
      setTimer: (fn, ms) => {
        timers.push({ fn, ms, id: ++id });
        return id;
      },
      clearTimer: t => {
        const i = timers.findIndex(x => x.id === t);
        if (i >= 0) timers.splice(i, 1);
      },
    });
    const settle = () => new Promise(r => setTimeout(r, 0));
    const fire = async () => {
      const t = timers.shift();
      t?.fn();
      await settle();
      await settle();
      return t?.ms ?? null;
    };
    return { p, timers, seen, settle, fire };
  }
  const open = readOf("queued");
  const closed = readOf("done");

  test("on mount, then every 5 s while one is open, stopped when none is", async () => {
    const r = rig([open, open, closed]);
    r.p.now();
    await r.settle();
    await r.settle();
    expect(r.p.reads).toBe(1);
    expect(r.timers.map(t => t.ms)).toEqual([5000]);
    expect(await r.fire()).toBe(5000);
    expect(r.timers.map(t => t.ms)).toEqual([5000]);
    await r.fire();
    expect(r.p.reads).toBe(3);
    expect(r.timers).toEqual([]);
  });

  test("a read error backs off to 10, 20, then 60 s; a success returns to 5", async () => {
    const r = rig([
      Error("Failed to fetch"),
      Error("x"),
      Error("x"),
      Error("x"),
      open,
    ]);
    r.p.now();
    await r.settle();
    await r.settle();
    const waits: Array<number | null> = [r.timers[0]?.ms ?? null];
    for (let i = 0; i < 4; i++) {
      await r.fire();
      waits.push(r.timers[0]?.ms ?? null);
    }
    expect(waits).toEqual([10_000, 20_000, 60_000, 60_000, 5000]);
  });

  test("paused while hidden, read at once on return", async () => {
    const hidden = { v: false };
    const r = rig([open, open], hidden);
    r.p.now();
    await r.settle();
    await r.settle();
    hidden.v = true;
    r.p.visibility(true);
    expect(r.timers).toEqual([]);
    r.p.now();
    expect(r.p.reads).toBe(1);
    hidden.v = false;
    r.p.visibility(false);
    await r.settle();
    await r.settle();
    expect(r.p.reads).toBe(2);
    expect(r.timers.map(t => t.ms)).toEqual([5000]);
  });

  test("not live: one read, no retry", async () => {
    const r = rig([new S.DriveImportError("not live", { notLive: true })]);
    r.p.now();
    await r.settle();
    await r.settle();
    expect(r.p.notLive).toBe(true);
    expect(r.timers).toEqual([]);
  });

  test("a request starts the 5 s reads; a read asked for mid-read runs after it", async () => {
    const r = rig([closed, open, open]);
    r.p.now();
    await r.settle();
    await r.settle();
    expect(r.timers).toEqual([]);
    r.p.opened();
    expect(r.timers.map(t => t.ms)).toEqual([5000]);
    r.p.now();
    r.p.now();
    await r.settle();
    await r.settle();
    await r.settle();
    await r.settle();
    expect(r.p.reads).toBe(3);
    expect(r.seen).toEqual([1, 2, 3]);
  });

  test("a landing is a rise in an import's own count, never the first read", () => {
    const a = readOf("working").imports;
    const first = H.landedGrew(null, a);
    expect(first.grew).toBe(false);
    expect(H.landedGrew(first.next, a).grew).toBe(false);
    const more = a.map(i => ({ ...i, landed: i.landed + 1 }));
    expect(H.landedGrew(first.next, more).grew).toBe(true);
    // An old import leaving the read never hides a new landing.
    const fresh = {
      ...a[0],
      id: "11111111-1111-4111-8111-111111111111",
      landed: 1,
    };
    expect(H.landedGrew(first.next, [fresh]).grew).toBe(true);
  });

  test("an import this window just requested stays shown over an older read", () => {
    const base = readOf("done");
    const mine = {
      ...readOf("queued").imports[0],
      id: "22222222-2222-4222-8222-222222222222",
      requestedAt: new Date(NOW).toISOString(),
    };
    const merged = H.withLocal(base, [mine]);
    expect(merged.imports[0].id).toBe(mine.id);
    expect(merged.imports.length).toBe(2);
    expect(
      H.withLocal({ ...base, imports: [mine, ...base.imports] }, [mine]).imports
        .length,
    ).toBe(2);
  });

  test("nextDelay", () => {
    expect(H.nextDelay({ open: false, errors: 0, notLive: false })).toBeNull();
    expect(H.nextDelay({ open: true, errors: 0, notLive: false })).toBe(5000);
    expect(H.nextDelay({ open: true, errors: 0, notLive: true })).toBeNull();
    expect(H.nextDelay({ open: false, errors: 9, notLive: false })).toBe(
      60_000,
    );
  });
});

describe("the two calls, as the migration defines them", () => {
  const sqlPath = resolve(
    repo,
    "supabase/migrations/20261020160000_csm_launch_ads_drive.sql",
  );
  const contract = existsSync(sqlPath)
    ? readFileSync(sqlPath, "utf8")
    : doc("DRIVE-IMPORT.md");
  const fake = (answer: { data?: unknown; error?: unknown }) => {
    const calls: Array<[string, unknown]> = [];
    return {
      calls,
      client: {
        rpc: async (name: string, args: unknown) => {
          calls.push([name, args]);
          return { data: answer.data ?? null, error: answer.error ?? null };
        },
      } as never,
    };
  };

  test("the names and the named arguments", async () => {
    expect(contract).toMatch(
      /cockpit_csm_launch_ads_import_request\(\s*p_task_id text,\s*p_link text\)/,
    );
    expect(contract).toMatch(
      /cockpit_csm_launch_ads_imports_read\(\s*p_task_id text\)/,
    );
    const one = readOf("queued").imports[0];
    const a = fake({ data: { ...one, existing: false } });
    const got = await S.requestDriveImport(
      a.client,
      "86c1abcde",
      "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMn",
    );
    expect(a.calls).toEqual([
      [
        "cockpit_csm_launch_ads_import_request",
        {
          p_task_id: "86c1abcde",
          p_link: "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMn",
        },
      ],
    ]);
    expect(got.existing).toBe(false);
    const b = fake({ data: readOf("several") });
    const read = await S.readDriveImports(b.client, "86c1abcde");
    expect(b.calls).toEqual([
      ["cockpit_csm_launch_ads_imports_read", { p_task_id: "86c1abcde" }],
    ]);
    expect(read.imports.length).toBe(7);
  });

  test("a refusal carries the server's sentence and its code from the hint", async () => {
    const a = fake({
      error: {
        code: "22023",
        message:
          "That's a Google Docs link. Paste a Drive folder, or one video or picture.",
        hint: "link_docs",
      },
    });
    const e = await S.requestDriveImport(a.client, "t1", "x").catch(x => x);
    expect(e).toBeInstanceOf(S.DriveImportError);
    expect([e.message, e.code, e.sqlstate, e.aboutLink]).toEqual([
      "That's a Google Docs link. Paste a Drive folder, or one video or picture.",
      "link_docs",
      "22023",
      true,
    ]);
    const gate = fake({
      error: {
        code: "42501",
        message: "That client is not on your access list",
      },
    });
    const g = await S.requestDriveImport(gate.client, "t1", "x").catch(x => x);
    expect([g.message, g.code, g.aboutLink]).toEqual([
      "That client is not on your access list",
      null,
      false,
    ]);
    const missing = fake({
      error: { code: "PGRST202", message: "Could not find the function" },
    });
    const m = await S.readDriveImports(missing.client, "t1").catch(x => x);
    expect(m.notLive).toBe(true);
    const odd = fake({ data: { imports: "no" } });
    await expect(S.readDriveImports(odd.client, "t1")).rejects.toThrow(/shape/);
  });
});

describe("the box, mounted", () => {
  const host = win.document.createElement("div");
  win.document.body.appendChild(host);
  const root = createRoot(host as unknown as Element);
  afterAll(async () => {
    await act(async () => root.unmount());
  });
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
  const field = () =>
    host.querySelector("input") as unknown as HTMLInputElement;
  const button = () =>
    host.querySelector("button[type=submit]") as unknown as HTMLButtonElement;
  const help = () =>
    host.querySelector("form > div:last-child")?.textContent ?? "";

  function Harness({
    io,
    hub,
    onLanded,
  }: {
    io: import("../src/present/useDriveImports").DriveIO;
    hub: {
      on: (fn: (m: { type: string }) => void) => () => void;
      post: (m: { type: string }) => void;
    };
    onLanded: () => void;
  }) {
    const box = H.useDriveImports({
      taskId: "t1",
      io,
      hub: hub as never,
      onLanded,
    });
    return <DriveBox box={box} now={() => new Date(NOW)} />;
  }

  test("a pasted WhatsApp message: each link in turn, the skipped one said quietly, then the files land", async () => {
    const sent: string[] = [];
    let landed = 0;
    let reads = 0;
    const listeners = new Set<(m: { type: string }) => void>();
    const posted: string[] = [];
    const hub = {
      on: (fn: (m: { type: string }) => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      post: (m: { type: string }) => posted.push(m.type),
    };
    const imports: DriveImport[] = [];
    let gate: () => void = () => {};
    const io = {
      requestDriveImport: async (link: string) => {
        sent.push(link);
        await new Promise<void>(r => {
          gate = r;
        });
        const p = L.parseDriveLink(link);
        const imp: DriveImport = {
          ...readOf("queued").imports[0],
          id: `33333333-3333-4333-8333-${String(sent.length).padStart(12, "0")}`,
          link: p.ok ? p.link : link,
          driveId: p.ok ? p.id : "x",
          requestedAt: new Date(NOW).toISOString(),
        };
        imports.unshift(imp);
        return { ...imp, existing: false };
      },
      readDriveImports: async () => {
        reads += 1;
        return {
          imports: imports.map(i => ({
            ...i,
            status: landed ? ("working" as const) : i.status,
            found: landed ? 2 : null,
            landed,
          })),
          workerSeenAt: new Date(NOW).toISOString(),
          at: new Date(NOW).toISOString(),
        };
      },
    };
    let reloads = 0;
    await act(async () => {
      root.render(
        <Harness io={io} hub={hub} onLanded={() => (reloads += 1)} />,
      );
    });
    await act(async () => wait(10));
    expect(reads).toBe(1);
    expect(help()).toBe(C.DRIVE_UI.hint.en);
    expect(button().disabled).toBe(true);

    const message =
      "Hi Sara, the photos: https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv?usp=sharing\nand the reel https://drive.google.com/file/d/1ZyXwVuTsRqPoNmLkJiHg/view. The brief: https://docs.google.com/document/d/1AbCdEfGhIjK/edit";
    const paste = new win.Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { getData: (t: string) => (t === "text/plain" ? message : "") },
    });
    await act(async () => {
      field().dispatchEvent(paste as never);
    });
    expect(paste.defaultPrevented).toBe(true);
    expect(button().textContent).toBe("Checking…");
    expect(field().readOnly).toBe(true);
    expect(field().value.split(" ").length).toBe(3);
    await act(async () => {
      gate();
      await wait(5);
    });
    await act(async () => {
      gate();
      await wait(5);
    });
    // The rebuilt links, in the paste's order; the Docs link never sent.
    expect(sent).toEqual([
      "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv",
      "https://drive.google.com/file/d/1ZyXwVuTsRqPoNmLkJiHg/view",
    ]);
    expect(button().textContent).toBe("Started");
    // The paste worked: the field is cleared and never red; the Docs link
    // left out is a muted note under the box (the fixer's round).
    expect(field().value).toBe("");
    expect(field().getAttribute("aria-invalid")).toBe(null);
    const note = host.querySelector("[data-drive-skipped]");
    expect(note?.textContent).toContain("Skipped");
    expect(note?.textContent).toContain(
      ": That's a Google Docs link. Paste a Drive folder, or one video or picture.",
    );
    expect(note?.className).toContain("text-muted-foreground");
    expect(host.querySelector(".txt-warn")).toBe(null);
    expect(posted).toContain("drive");
    expect(host.textContent).toContain("Bringing in 2 links from Drive…");
    expect(host.textContent).toContain(C.DRIVE_UI.queued.en);

    // Another window's request, or the worker landing files: a read at once.
    landed = 1;
    await act(async () => {
      for (const l of listeners) l({ type: "drive" });
      await wait(10);
    });
    expect(reloads).toBe(1);
    expect(host.textContent).toContain("Bringing in 2 files from Drive…");
    await act(async () => wait(2100));
    expect(button().textContent).toBe("Bring in");
  });

  test("typed text that is not a link: the sentence on leaving the field, the button off", async () => {
    const io = {
      requestDriveImport: async () => {
        throw Error("never");
      },
      readDriveImports: async () => readOf("idle"),
    };
    const hub = { on: () => () => {}, post: () => {} };
    await act(async () => {
      root.render(<Harness io={io} hub={hub} onLanded={() => {}} />);
    });
    const set = Object.getOwnPropertyDescriptor(
      win.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      set?.call(field(), "https://drive.google.com/drive/my-drive");
      field().dispatchEvent(new win.Event("input", { bubbles: true }) as never);
    });
    // Not yet: no error while typing.
    expect(help()).toBe(C.DRIVE_UI.hint.en);
    expect(button().disabled).toBe(true);
    await act(async () => {
      field().dispatchEvent(
        new win.FocusEvent("focusout", { bubbles: true }) as never,
      );
    });
    expect(help()).toContain(
      "This link opens a Drive page, not a folder. Open the folder and copy its link.",
    );
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(field().getAttribute("aria-describedby")).toBe(
      host.querySelector("form > div:last-child")?.getAttribute("id") ?? "",
    );
  });

  test("a file that didn't come in names itself once, as the link to it in Drive", async () => {
    const box = {
      enabled: true,
      lang: "en" as const,
      read: readOf("some"),
      readProblem: null,
      notLive: false,
      sending: false,
      send: async () => ({ sent: 0, refused: [] }),
    };
    await act(async () => {
      root.render(
        <DriveBox key="static" box={box} now={() => new Date(NOW)} />,
      );
    });
    const failed = [...host.querySelectorAll("[data-drive-file=warn]")];
    expect(failed.length).toBe(2);
    const first = failed[0];
    expect(first.textContent).toBe(
      "drone-flyover-4k.mov is too long or too large to bring in. Upload a cut under 5 minutes, or send it in the group.",
    );
    const a = first.querySelector("a");
    expect(a?.textContent).toBe("drone-flyover-4k.mov");
    expect(a?.getAttribute("href")).toMatch(
      /^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/view$/,
    );
    expect(a?.getAttribute("target")).toBe("_blank");
    // A finished import keeps only what needs the CSM; the landed rows are
    // behind "Show the list ({n})" (the fixer's round: 20 rows pushed the
    // panel's other controls out of a 900 px window).
    expect(host.querySelectorAll("[data-drive-file=good]").length).toBe(0);
    const more = [...host.querySelectorAll("button")].find(b =>
      /^Show the list \(\d+\)$/.test(b.textContent ?? ""),
    );
    expect(more?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      (more as HTMLButtonElement | undefined)?.click();
    });
    expect(more?.textContent).toBe(C.DRIVE_UI.hideList.en);
    expect(more?.getAttribute("aria-expanded")).toBe("true");
    // Opened, the landed ones keep their row: the name, then "In the tray".
    const good = [...host.querySelectorAll("[data-drive-file=good]")].map(
      li => li.textContent,
    );
    expect(good[0]).toBe("villa-entrance.jpgIn the tray");
  });

  test("in Arabic the fold counts in Arabic digits", async () => {
    const box = {
      enabled: true,
      lang: "ar" as const,
      read: readOf("some"),
      readProblem: null,
      notLive: false,
      sending: false,
      send: async () => ({ sent: 0, refused: [] }),
    };
    await act(async () => {
      root.render(
        <DriveBox key="static-ar" box={box} now={() => new Date(NOW)} />,
      );
    });
    const more = [...host.querySelectorAll("button")].find(b =>
      (b.textContent ?? "").startsWith("اعرض القائمة"),
    );
    expect(more?.textContent).toMatch(/^اعرض القائمة \([٠-٩]+\)$/);
  });

  test("the functions not live yet: one sentence, the field off, no retries", async () => {
    let reads = 0;
    const io = {
      requestDriveImport: async () => {
        throw Error("never");
      },
      readDriveImports: async () => {
        reads += 1;
        throw new S.DriveImportError("not live", { notLive: true });
      },
    };
    const hub = { on: () => () => {}, post: () => {} };
    await act(async () => {
      root.render(
        <Harness key="notlive" io={io} hub={hub} onLanded={() => {}} />,
      );
    });
    await act(async () => wait(20));
    expect(host.textContent).toContain(C.DRIVE_UI.notLive.en);
    expect(field().disabled).toBe(true);
    expect(reads).toBe(1);
  });
});
