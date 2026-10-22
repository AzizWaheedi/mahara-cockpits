import { isolate, type Lang } from "./content";
import {
  bringingFiles,
  broughtFiles,
  DRIVE_FAILED,
  DRIVE_FILE_FAILED,
  DRIVE_NOTE,
  DRIVE_REFUSED,
  DRIVE_UI,
  num,
  severalLinks,
  severalLinksOf,
} from "./driveCopy";
import { cutMiddle, shortLink } from "./driveLink";
import type { DriveImport, DriveImportFile, DriveImports } from "./sources";

/**
 * What the Drive box shows for a read of the client's imports (DESIGN 22.7,
 * DRIVE-IMPORT.md 8's table of states): pure, so the states are tested
 * without a browser. Every line is a sentence from driveCopy.ts.
 */

export type Tone = "muted" | "warn" | "good" | "plain";
export interface Line {
  text: string;
  tone: Tone;
}
export type ImportState =
  | "queued"
  | "nobody"
  | "stalled"
  | "opening"
  | "working"
  | "done"
  | "failed";
export interface FileRow {
  id: string;
  name: string;
  /** The name cut in the middle; the whole name goes in the tooltip. */
  short: string;
  /** The file in Drive, opened in a new tab on the CSM's own screen. */
  href: string;
  state: Line;
  /** A landed file's note (converted to MP4), in the muted tone. */
  note: string | null;
}
export interface ImportBlock {
  id: string;
  link: string;
  short: string;
  open: boolean;
  state: ImportState;
  line: Line;
  /** "Only the newest 20 came in…", after a done line. */
  extra: Line | null;
  /** How far a working import is (files finished of those found); null otherwise. */
  share: number | null;
  files: FileRow[];
}
export interface BoxView {
  /**
   * "Bringing in {n} links from Drive…" with two or more open; "Bringing
   * in {n} of {total} links…" when finished ones show under them.
   */
  head: string | null;
  blocks: ImportBlock[];
}

/** Queued this long with no sign of the worker: "Nothing has picked this up yet." */
export const STALE_MS = 3 * 60_000;
/** Finished imports the box keeps under the open ones. */
export const FINISHED_SHOWN = 3;

export const isOpen = (i: Pick<DriveImport, "status">) =>
  i.status === "queued" || i.status === "working";

/** First strong isolate and its pop: a name keeps its own direction. */
const FSI = String.fromCharCode(0x2068);
const PDI = String.fromCharCode(0x2069);
/** A file name inside a sentence, isolated like <bdi dir=auto> (DESIGN 13.2). */
const named = (text: string, name: string, lang: Lang) =>
  text
    .split("{name}")
    .map(part => isolate(part, lang))
    .join(`${FSI}${name}${PDI}`);

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * {time}: the CSM's local time, "today, 13:02", or "yesterday, 13:02"
 * (final score round 1: "last ran 09:49" dropped a word); in Arabic with
 * الساعة, as a time is said after a verb ("الساعة 13:02", "أمس الساعة
 * 09:05"), and a date with يوم ("يوم ١٦ أكتوبر الساعة 09:05").
 */
export function timeLabel(iso: string, now: Date, lang: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const day = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86_400_000);
  const comma = lang === "ar" ? " الساعة " : ", ";
  let out = lang === "ar" ? `الساعة ${hm}` : `${DRIVE_UI.today.en}, ${hm}`;
  if (days === 1) out = `${DRIVE_UI.yesterday[lang]}${comma}${hm}`;
  else if (days !== 0) {
    const month = new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en-GB", {
      month: lang === "ar" ? "long" : "short",
    }).format(d);
    out = `${lang === "ar" ? `يوم ${num(d.getDate(), "ar")}` : d.getDate()} ${month}${comma}${hm}`;
  }
  // The clock stays in Latin digits (decision 6): a ٠ beside a colon reads
  // as a dot, and ٠٩ would open on a lone ٠.
  return out;
}

/** The open imports, whatever their age, then the three newest finished, newest first. */
export function shownImports(imports: DriveImport[]): DriveImport[] {
  let finished = 0;
  return imports.filter(i => {
    if (isOpen(i)) return true;
    finished += 1;
    return finished <= FINISHED_SHOWN;
  });
}

/** A failed file's sentence in the box's language. */
export function fileFailure(f: DriveImportFile, lang: Lang): string {
  if (lang === "en" && f.message) return f.message;
  const c = f.code;
  const t =
    c === "too_big"
      ? DRIVE_FILE_FAILED.too_big[f.kind === "video" ? "video" : "image"]
      : c
        ? DRIVE_FILE_FAILED[c]
        : null;
  if (t) return named(t[lang], f.name, lang);
  return f.message ?? named(DRIVE_FILE_FAILED.unfinished[lang], f.name, lang);
}

function fileRow(f: DriveImportFile, lang: Lang): FileRow {
  const state: Line =
    f.status === "failed"
      ? { text: fileFailure(f, lang), tone: "warn" }
      : {
          text: DRIVE_UI.file[f.status][lang],
          tone:
            f.status === "landed"
              ? "good"
              : f.status === "working"
                ? "plain"
                : "muted",
        };
  return {
    id: f.driveId,
    name: f.name,
    short: cutMiddle(f.name, 34),
    href: `https://drive.google.com/file/d/${f.driveId}/view`,
    state,
    note:
      f.status === "landed" && f.note === "converted"
        ? named(DRIVE_NOTE.converted[lang], f.name, lang)
        : null,
  };
}

/** A failed import's sentence in the box's language. */
export function importFailure(imp: DriveImport, lang: Lang): string {
  if (lang === "en" && imp.message) return imp.message;
  const c = imp.code;
  if (c === "not_found")
    return isolate(DRIVE_FAILED.not_found[imp.kind][lang], lang);
  if (c) return isolate(DRIVE_FAILED[c][lang], lang);
  return imp.message ?? DRIVE_FAILED.not_started[lang];
}

const ms = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(t) ? null : t;
};

/** Queued for over 3 minutes while the worker was last seen over 3 minutes ago, or never. */
export function nobodyPickedUp(
  imp: DriveImport,
  read: Pick<DriveImports, "workerSeenAt" | "at">,
): boolean {
  if (imp.status !== "queued") return false;
  const at = ms(read.at);
  const asked = ms(imp.requestedAt);
  if (at === null || asked === null || at - asked <= STALE_MS) return false;
  const seen = ms(read.workerSeenAt);
  return seen === null || at - seen > STALE_MS;
}

/** Past this with no sign of the importer, a working import has stopped part-way. */
export const STALLED_MS = 10 * 60_000;

/**
 * Working, but the importer has not been seen for over 10 minutes (it
 * heartbeats through long downloads, so a quiet worker has stopped: a full
 * disk, a missing cron line). Without this the box said "Bringing in" forever.
 */
export function stalledWorking(
  imp: DriveImport,
  read: Pick<DriveImports, "workerSeenAt" | "at">,
): boolean {
  if (imp.status !== "working") return false;
  const at = ms(read.at);
  if (at === null) return false;
  const seen = ms(read.workerSeenAt) ?? ms(imp.startedAt);
  return seen !== null && at - seen > STALLED_MS;
}

/** One import's line: its state, in the box's words. */
export function importLine(
  imp: DriveImport,
  read: Pick<DriveImports, "workerSeenAt" | "at">,
  lang: Lang,
  now: Date,
): { state: ImportState; line: Line; extra: Line | null } {
  if (imp.status === "queued") {
    if (!nobodyPickedUp(imp, read))
      return {
        state: "queued",
        line: { text: DRIVE_UI.queued[lang], tone: "muted" },
        extra: null,
      };
    const text = read.workerSeenAt
      ? DRIVE_UI.nobody[lang].replace(
          "{time}",
          timeLabel(read.workerSeenAt, now, lang),
        )
      : DRIVE_UI.never[lang];
    return { state: "nobody", line: { text, tone: "warn" }, extra: null };
  }
  if (stalledWorking(imp, read))
    return {
      state: "stalled",
      line: {
        text: DRIVE_UI.stalled[lang].replace(
          "{time}",
          timeLabel(read.workerSeenAt ?? imp.startedAt ?? read.at, now, lang),
        ),
        tone: "warn",
      },
      extra: null,
    };
  if (imp.status === "working")
    return imp.found === null
      ? {
          state: "opening",
          line: { text: DRIVE_UI.opening[lang], tone: "plain" },
          extra: null,
        }
      : {
          state: "working",
          line: { text: bringingFiles(imp.found, lang), tone: "plain" },
          extra: null,
        };
  if (imp.status === "failed")
    return {
      state: "failed",
      line: { text: importFailure(imp, lang), tone: "warn" },
      extra: null,
    };
  // Done: worded from its counts (the server stores no message for it).
  const n = imp.found ?? imp.landed + imp.skipped + imp.failed;
  const line: Line =
    imp.landed === 0 && imp.failed === 0 && imp.skipped > 0
      ? { text: DRIVE_UI.doneNothingNew[lang], tone: "muted" }
      : imp.failed === 0
        ? { text: broughtFiles(imp.landed, lang), tone: "good" }
        : {
            text: DRIVE_UI.doneSome[lang]
              .replace("{landed}", num(imp.landed, lang))
              .replace("{n}", num(n, lang)),
            tone: "plain",
          };
  return {
    state: "done",
    line,
    extra: imp.overLimit
      ? { text: DRIVE_UI.overTwenty[lang], tone: "muted" }
      : null,
  };
}

/** Everything under the box, for one read. */
export function boxView(
  read: DriveImports | null,
  lang: Lang,
  now: Date,
): BoxView {
  if (!read) return { head: null, blocks: [] };
  const list = shownImports(read.imports);
  const open = list.filter(isOpen).length;
  return {
    // Two or more open: how many, and of how many cards when finished
    // ones show under them (score round 2).
    head:
      open < 2
        ? null
        : open < list.length
          ? severalLinksOf(open, list.length, lang)
          : severalLinks(open, lang),
    blocks: list.map(imp => {
      const l = importLine(imp, read, lang, now);
      return {
        id: imp.id,
        link: imp.link,
        short: shortLink(imp.link, 46),
        open: isOpen(imp),
        state: l.state,
        line: l.line,
        extra: l.extra,
        share:
          imp.status === "working" && imp.found
            ? Math.min(1, (imp.landed + imp.skipped + imp.failed) / imp.found)
            : null,
        files: imp.files.map(f => fileRow(f, lang)),
      };
    }),
  };
}

/** "Couldn't check the import: {reason}. Trying again." */
export function readFailedLine(reason: string, lang: Lang): string {
  let r = reason.trim().replace(/[.\s]+$/, "");
  // A sentence after the colon reads on in lower case ("no connection").
  if (/^[A-Z][a-z]/.test(r)) r = r[0].toLowerCase() + r.slice(1);
  return DRIVE_UI.readFailed[lang].replace(
    "{reason}",
    isolate(r || "try again", lang),
  );
}

/** A refusal's sentence: the parser's or the server's, by code, else as written. */
export function refusalText(
  code: string | null,
  message: string,
  lang: Lang,
): string {
  if (lang === "en") return message || DRIVE_REFUSED.link_bad.en;
  return isolate((code && DRIVE_REFUSED[code]?.ar) || message, "ar");
}
