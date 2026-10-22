/**
 * The Drive box's states for the harness and the shots (DRIVE-IMPORT.md 8's
 * table): `?drive=<scenario>` sets what the client's imports read as, and a
 * link pasted in prep or the notes window runs a pretend worker in memory
 * (queued, opening, the files one by one, done), whose files join the tray
 * the way the desk's do: a video as an MP4 with its poster, and a file that
 * another open link has already brought in is skipped, as the server's
 * unique index refuses it (score round 1: site-walk.mov landed as a
 * picture, and one file landed twice from two links). Every name here is
 * made up; nothing is sent.
 */

import {
  DRIVE_FAILED,
  DRIVE_FILE_FAILED,
  DRIVE_REFUSED,
} from "@/present/driveCopy";
import { parseDriveLink } from "@/present/driveLink";
import {
  type DriveImport,
  DriveImportError,
  type DriveImportFile,
  type DriveImports,
  type LaunchAd,
} from "@/present/sources";
import siteTall from "./custom-hall-tall.webp";
import siteFeed from "./custom-site.webp";
import square from "./custom-square.webp";

/**
 * The harness's "now": the fixtures' Sunday morning, 19 October. Prep, the
 * pretend worker and the Drive sheet all read it, so they agree.
 */
export const HARNESS_NOW = Date.parse("2026-10-19T09:00:00Z");

export const DRIVE_SCENARIOS = [
  "idle",
  "queued",
  "opening",
  "working",
  "done",
  "some",
  "nothing-new",
  "over",
  "failed",
  "nobody",
  "never",
  "several",
  "readfail",
  "notlive",
  "stalled",
] as const;
export type DriveScenario = (typeof DRIVE_SCENARIOS)[number];

const FOLDER = "1hArNeSsFoLdErInTeRiOrS26";
const S = 1000;
const M = 60 * S;

const iso = (t: number) => new Date(t).toISOString();

let n = 0;
/** A made-up uuid that is stable for a scenario. */
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const driveId = (name: string) =>
  `1${name.replace(/[^A-Za-z0-9]/g, "").slice(0, 20)}Xy2026ab`.padEnd(12, "x");

function file(
  name: string,
  status: DriveImportFile["status"],
  extra: Partial<DriveImportFile> = {},
): DriveImportFile {
  const video = /\.(mov|mp4|m4v|webm)$/i.test(name);
  return {
    driveId: driveId(name),
    name,
    kind: video ? "video" : "image",
    bytes: video ? 48_213_211 : 3_402_118,
    status,
    code: null,
    message: null,
    note: null,
    adId: status === "landed" ? uuid() : null,
    ...extra,
  };
}

const failedFile = (
  name: string,
  code: Exclude<DriveImportFile["code"], null>,
): DriveImportFile => {
  const f = file(name, "failed");
  const t =
    code === "too_big"
      ? DRIVE_FILE_FAILED.too_big[f.kind === "video" ? "video" : "image"]
      : DRIVE_FILE_FAILED[code];
  return { ...f, code, message: t.en.replace("{name}", name) };
};

function imp(
  at: number,
  status: DriveImport["status"],
  extra: Partial<DriveImport> = {},
): DriveImport {
  const files = extra.files ?? [];
  const count = (s: DriveImportFile["status"]) =>
    files.filter(f => f.status === s).length;
  const kind = extra.kind ?? "folder";
  const id = extra.driveId ?? FOLDER;
  return {
    id: uuid(),
    taskId: "fixture-full",
    link:
      kind === "folder"
        ? `https://drive.google.com/drive/folders/${id}`
        : `https://drive.google.com/file/d/${id}/view`,
    driveId: id,
    kind,
    status,
    code: null,
    message: null,
    found: files.length || null,
    overLimit: false,
    landed: count("landed"),
    skipped: count("skipped"),
    failed: count("failed"),
    files,
    requestedBy: "sara@maharamedia.com",
    requestedAt: iso(at),
    startedAt: status === "queued" ? null : iso(at + 20 * S),
    finishedAt:
      status === "done" || status === "failed" ? iso(at + 3 * M) : null,
    updatedAt: iso(at + 40 * S),
    ...extra,
  };
}

const SIX = () => [
  file("villa-entrance.jpg", "landed"),
  file("living-corner.jpg", "landed"),
  file("site-walk.mov", "landed", { note: "converted" }),
  file("majlis-wide.jpg", "landed"),
  file("stair-detail.jpg", "landed"),
  file("pool-dusk.jpg", "landed"),
];

/** Yesterday at 13:02, the CSM's local time. */
function yesterday1302(now: number) {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  d.setHours(13, 2, 0, 0);
  return d.getTime();
}

/** What the read returns for a scenario, around `now`. */
export function driveScenario(
  name: DriveScenario,
  now: number,
): { imports: DriveImport[]; workerSeenAt: string | null } {
  n = 0;
  const seen = iso(now - 25 * S);
  switch (name) {
    case "queued":
      return { imports: [imp(now - 20 * S, "queued")], workerSeenAt: seen };
    case "opening":
      return {
        imports: [imp(now - 40 * S, "working", { found: null })],
        workerSeenAt: seen,
      };
    case "working":
      return {
        imports: [
          imp(now - 90 * S, "working", {
            files: [
              file("villa-entrance.jpg", "landed"),
              file("site-walk.mov", "landed", { note: "converted" }),
              file("living-corner.jpg", "skipped"),
              file("majlis-wide-angle-golden-hour-final.jpg", "working"),
              file("stair-detail.jpg", "queued"),
              file("pool-dusk.mov", "queued"),
            ],
          }),
        ],
        workerSeenAt: seen,
      };
    case "done":
      return {
        imports: [imp(now - 6 * M, "done", { files: SIX() })],
        workerSeenAt: seen,
      };
    case "some":
      return {
        imports: [
          imp(now - 8 * M, "done", {
            files: [
              file("villa-entrance.jpg", "landed"),
              file("site-walk.mov", "landed", { note: "converted" }),
              file("living-corner.jpg", "skipped"),
              file("majlis-wide.jpg", "landed"),
              failedFile("drone-flyover-4k.mov", "too_big"),
              failedFile("IMG_4471.HEIC", "heic"),
            ],
          }),
        ],
        workerSeenAt: seen,
      };
    case "nothing-new":
      return {
        imports: [
          imp(now - 4 * M, "done", {
            files: [
              file("villa-entrance.jpg", "skipped"),
              file("living-corner.jpg", "skipped"),
              file("site-walk.mov", "skipped"),
              file("majlis-wide.jpg", "skipped"),
            ],
          }),
        ],
        workerSeenAt: seen,
      };
    case "over":
      return {
        imports: [
          imp(now - 12 * M, "done", {
            overLimit: true,
            files: Array.from({ length: 20 }, (_, i) =>
              file(`project-${String(i + 1).padStart(2, "0")}.jpg`, "landed"),
            ),
          }),
        ],
        workerSeenAt: seen,
      };
    case "failed":
      return {
        imports: [
          imp(now - 3 * M, "failed", {
            code: "not_found",
            message: DRIVE_FAILED.not_found.folder.en,
            found: null,
          }),
        ],
        workerSeenAt: seen,
      };
    case "stalled":
      // Working, but the importer last seen 11 minutes ago (STALLED_MS is
      // 10): the box says it stopped part-way, never "Bringing in" forever.
      return {
        imports: [
          imp(now - 14 * M, "working", {
            files: [
              file("villa-entrance.jpg", "landed"),
              file("majlis-wide.jpg", "landed"),
              file("site-walk.mov", "working"),
              file("stair-detail.jpg", "queued"),
            ],
            updatedAt: iso(now - 11 * M),
          }),
        ],
        workerSeenAt: iso(now - 11 * M),
      };
    case "nobody":
      return {
        imports: [imp(now - 4 * M, "queued")],
        workerSeenAt: iso(yesterday1302(now)),
      };
    case "never":
      return { imports: [imp(now - 5 * M, "queued")], workerSeenAt: null };
    case "several":
      return {
        imports: [
          imp(now - 10 * S, "queued", {
            kind: "file",
            driveId: "1SiTeWaLkClIpOctober20",
          }),
          imp(now - 50 * S, "working", {
            driveId: "1MaJlIsPhOtOsRiYaDh2026",
            found: null,
          }),
          imp(now - 2 * M, "working", {
            driveId: "1ViLlAsBeFoReAfTeR2026",
            files: [
              file("before-1.jpg", "landed"),
              file("after-1.jpg", "working"),
              file("before-2.jpg", "queued"),
            ],
          }),
          imp(now - 20 * M, "done", {
            driveId: "1ViLlAeXtErIoRs2026abc",
            files: [
              file("facade-east.jpg", "landed"),
              file("facade-west.jpg", "landed"),
            ],
          }),
          imp(now - 40 * M, "failed", {
            kind: "file",
            driveId: "1QuOtEpDfNoTaPiCtUrE26",
            code: "not_media",
            message: DRIVE_FAILED.not_media.en,
            found: null,
          }),
          imp(now - 60 * M, "done", {
            driveId: "1OlDeRsHoOtSePtEmBeR26",
            files: [file("old-1.jpg", "skipped")],
          }),
          // The fourth finished one: past the box's three, never shown.
          imp(now - 90 * M, "done", {
            driveId: "1HiDdEnFoUrThFiNiShEd26",
            files: [file("hidden.jpg", "landed")],
          }),
        ],
        workerSeenAt: seen,
      };
    default:
      return { imports: [], workerSeenAt: seen };
  }
}

/** The pretend worker's pace, from the request. */
const OPEN_AT = 2.5 * S;
const PLAN_AT = 5 * S;
const EACH = 1.6 * S;

/** What Drive "holds" behind a pasted link: a folder of five, or one file. */
function planFor(kind: DriveImport["kind"]): DriveImportFile[] {
  if (kind === "file") return [file("living-corner.jpg", "queued")];
  return [
    file("villa-entrance.jpg", "queued"),
    file("living-corner.jpg", "queued"),
    file("site-walk.mov", "queued"),
    file("majlis-wide.jpg", "queued"),
    file("drone-flyover-4k.mov", "queued"),
  ];
}

// Their own pictures only: never a starter template's (score round 2 of
// the five services: one picture is never theirs and ours).
const PICTURES = [siteFeed, square, siteTall];

/**
 * The harness's io for the Drive box: the scenario's imports, and a pretend
 * worker for each link pasted. `addAd` puts a landed file in the tray.
 */
export function fakeDrive(o: {
  scenario: string | null;
  taskId: string;
  addAd: (ad: LaunchAd) => void;
  now?: () => number;
}) {
  const clock = o.now ?? (() => Date.now());
  const scenario = (DRIVE_SCENARIOS as readonly string[]).includes(
    o.scenario ?? "",
  )
    ? (o.scenario as DriveScenario)
    : "idle";
  const start = driveScenario(scenario, clock());
  const live: Array<{ imp: DriveImport; at: number; plan: DriveImportFile[] }> =
    [];
  const landedAds = new Set<string>();
  /** Which import brought each Drive file in first: another link skips it. */
  const owner = new Map<string, string>();
  let pic = 0;

  /** A pasted link's import as the pretend worker has it now. */
  function advance(l: (typeof live)[number], now: number): DriveImport {
    const t = now - l.at;
    if (t < OPEN_AT) return l.imp;
    if (t < PLAN_AT)
      return { ...l.imp, status: "working", startedAt: iso(l.at + OPEN_AT) };
    const files = l.plan.map((f, i) => {
      const doneAt = PLAN_AT + (i + 1) * EACH;
      if (t < doneAt - EACH) return f;
      if (t < doneAt) return { ...f, status: "working" as const };
      if (/4k/.test(f.name)) return failedFile(f.name, "too_big");
      const first = owner.get(f.driveId) ?? l.imp.id;
      owner.set(f.driveId, first);
      if (first !== l.imp.id) return { ...f, status: "skipped" as const };
      const landed: DriveImportFile = {
        ...f,
        status: "landed",
        adId:
          f.adId ?? `${l.imp.id.slice(0, 24)}${String(i).padStart(12, "0")}`,
        note: /\.mov$/.test(f.name) ? "converted" : null,
      };
      const key = `${l.imp.id}:${f.driveId}`;
      if (!landedAds.has(key)) {
        landedAds.add(key);
        const src = PICTURES[pic++ % PICTURES.length];
        // A video lands as the desk converts it: an MP4 with its poster
        // (the harness has no clip, so the poster stands in for both).
        const video = f.kind === "video";
        const stem = f.name.replace(/\.[^.]+$/, "");
        o.addAd({
          id: crypto.randomUUID(),
          taskId: o.taskId,
          kind: "custom",
          status: "ready",
          path: `fixture/drive/${video ? `${stem}.mp4` : f.name}`,
          mime: video ? "video/mp4" : "image/webp",
          bytes: f.bytes ?? 1,
          width: 1080,
          height: video ? 1920 : 1350,
          seconds: video ? 18 : null,
          posterPath: video ? `fixture/drive/${stem}.jpg` : null,
          posterMime: video ? "image/jpeg" : null,
          posterUrl: video ? src : null,
          // The Drive name, as the server keeps it (the box says it was converted).
          fileName: f.name,
          hidden: false,
          url: src,
          // As the tray's read gives a Drive file (20261020160300).
          source: "drive",
          importedBy: "Sara",
          importedAt: iso(l.at),
          // Made as it lands, on the harness's clock (its NOW plus the time
          // since the page opened), so the tray reads it as today's.
          createdAt: iso(l.at + doneAt),
        });
      }
      return landed;
    });
    const all = files.every(
      f =>
        f.status === "landed" ||
        f.status === "failed" ||
        f.status === "skipped",
    );
    const count = (s: DriveImportFile["status"]) =>
      files.filter(f => f.status === s).length;
    return {
      ...l.imp,
      status: all ? "done" : "working",
      startedAt: iso(l.at + OPEN_AT),
      found: files.length,
      files,
      landed: count("landed"),
      skipped: count("skipped"),
      failed: count("failed"),
      finishedAt: all ? iso(now) : null,
      updatedAt: iso(now),
    };
  }

  const read = async (): Promise<DriveImports> => {
    await new Promise(r => setTimeout(r, 120));
    if (scenario === "readfail") throw Error("Failed to fetch");
    if (scenario === "notlive")
      throw new DriveImportError(
        "The Drive import's functions are not live yet.",
        {
          notLive: true,
        },
      );
    const now = clock();
    const mine = live.map(l => advance(l, now)).reverse();
    return {
      imports: [...mine, ...start.imports].slice(0, 20),
      workerSeenAt: live.length ? iso(now - 2 * S) : start.workerSeenAt,
      at: iso(now),
    };
  };

  const request = async (
    link: string,
  ): Promise<DriveImport & { existing: boolean }> => {
    await new Promise(r => setTimeout(r, 350));
    if (scenario === "notlive")
      throw new DriveImportError(
        "The Drive import's functions are not live yet.",
        {
          notLive: true,
        },
      );
    const p = parseDriveLink(link);
    if (!p.ok)
      throw new DriveImportError(DRIVE_REFUSED[p.code].en, {
        code: p.code,
        sqlstate: "22023",
      });
    const now = clock();
    const open = live.find(
      l => l.imp.driveId === p.id && advance(l, now).status !== "done",
    );
    if (open) return { ...advance(open, now), existing: true };
    if (live.filter(l => advance(l, now).status !== "done").length >= 10)
      throw new DriveImportError(DRIVE_REFUSED.too_many_open.en, {
        code: "too_many_open",
        sqlstate: "22023",
      });
    const kind = p.kind === "either" ? "folder" : p.kind;
    const imp: DriveImport = {
      id: crypto.randomUUID(),
      taskId: o.taskId,
      link: p.link,
      driveId: p.id,
      kind: p.kind,
      status: "queued",
      code: null,
      message: null,
      found: null,
      overLimit: false,
      landed: 0,
      skipped: 0,
      failed: 0,
      files: [],
      requestedBy: "sara@maharamedia.com",
      requestedAt: iso(now),
      startedAt: null,
      finishedAt: null,
      updatedAt: iso(now),
    };
    live.push({ imp, at: now, plan: planFor(kind) });
    return { ...imp, existing: false };
  };

  return { readDriveImports: read, requestDriveImport: request };
}
