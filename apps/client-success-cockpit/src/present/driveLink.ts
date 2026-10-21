/**
 * The Drive links prep's ads panel takes (docs/csm-decks/DRIVE-IMPORT.md 2
 * and 8): the same rules as the server's cockpit_csm_drive_link_parse, run
 * in the browser so a refusal shows before anything is sent. The server is
 * still the authority. Both are tested against one table of cases,
 * driveLink.cases.json.
 */

export type DriveLinkKind = "file" | "folder" | "either";
export type DriveLinkCode =
  | "link_empty"
  | "link_docs"
  | "link_page"
  | "link_bad";
export type ParsedDriveLink =
  | {
      ok: true;
      id: string;
      kind: DriveLinkKind;
      resourceKey: string | null;
      link: string;
    }
  | { ok: false; code: DriveLinkCode };

const ID = "[A-Za-z0-9_-]{10,200}";
const IS_ID = new RegExp(`^${ID}$`);
const IS_KEY = /^[A-Za-z0-9_-]{1,100}$/;
/** A folder, also as a phone's browser copies it (`/drive/mobile/folders/…`). */
const FOLDER = new RegExp(
  `^/drive(?:/u/[0-9])?(?:/mobile)?/folders/(${ID})/?$`,
);
const FILE = new RegExp(
  `^/file(?:/u/[0-9])?/d/(${ID})(?:/view|/edit|/preview|/)?$`,
);
const DRIVE_PAGE =
  /^\/drive(?:\/u\/[0-9])?(?:\/(?:my-drive|shared-with-me|recent|starred|home|computers|search)?)?\/?$/;
const DOCS = /^\/(?:document|spreadsheets|presentation|forms|drawings)\//;
const PRINTABLE = /^[\x20-\x7e]+$/;
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;

const refuse = (code: DriveLinkCode): ParsedDriveLink => ({ ok: false, code });

/** The first query parameter of that name, as written (no decoding). */
function param(query: string, name: string): string | null {
  for (const part of query.split("&")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq) === name) return part.slice(eq + 1);
  }
  return null;
}

/** The link rebuilt from the id alone: no usp, no authuser, no email. */
export function driveLinkFor(
  id: string,
  kind: DriveLinkKind,
  resourceKey: string | null,
): string {
  const rk = resourceKey ? `resourcekey=${resourceKey}` : "";
  if (kind === "folder")
    return `https://drive.google.com/drive/folders/${id}${rk ? `?${rk}` : ""}`;
  if (kind === "file")
    return `https://drive.google.com/file/d/${id}/view${rk ? `?${rk}` : ""}`;
  return `https://drive.google.com/open?id=${id}${rk ? `&${rk}` : ""}`;
}

/** One link, by DRIVE-IMPORT.md 2's rules, in their order. */
export function parseDriveLink(
  text: string | null | undefined,
): ParsedDriveLink {
  const s = (text ?? "").trim();
  if (!s) return refuse("link_empty");
  if (s.length > 2000 || !PRINTABLE.test(s)) return refuse("link_bad");
  let rest = s;
  const scheme = SCHEME.exec(s);
  if (scheme) {
    const name = scheme[1].toLowerCase();
    if (name !== "http" && name !== "https") return refuse("link_bad");
    rest = s.slice(scheme[0].length);
    if (!rest.startsWith("//")) return refuse("link_bad");
    rest = rest.slice(2);
  }
  const cut = rest.search(/[/?#]/);
  const authority = cut < 0 ? rest : rest.slice(0, cut);
  // A user, a password or a port.
  if (authority.includes("@") || authority.includes(":"))
    return refuse("link_bad");
  const host = authority.toLowerCase();
  const after = cut < 0 ? "" : rest.slice(cut);
  const hash = after.indexOf("#");
  const noFragment = hash < 0 ? after : after.slice(0, hash);
  const q = noFragment.indexOf("?");
  const path = q < 0 ? noFragment : noFragment.slice(0, q);
  const query = q < 0 ? "" : noFragment.slice(q + 1);
  const key = param(query, "resourcekey");
  const resourceKey = key && IS_KEY.test(key) ? key : null;
  const ok = (id: string, kind: DriveLinkKind): ParsedDriveLink => ({
    ok: true,
    id,
    kind,
    resourceKey,
    link: driveLinkFor(id, kind, resourceKey),
  });
  const idParam = () => {
    const id = param(query, "id");
    return id && IS_ID.test(id) ? id : null;
  };

  if (host === "docs.google.com")
    return refuse(DOCS.test(path) ? "link_docs" : "link_bad");
  if (host === "drive.google.com" || host === "www.drive.google.com") {
    const folder = FOLDER.exec(path);
    if (folder) return ok(folder[1], "folder");
    const file = FILE.exec(path);
    if (file) return ok(file[1], "file");
    if (path === "/folderview" || path === "/open" || path === "/uc") {
      const id = idParam();
      if (!id) return refuse("link_bad");
      return ok(
        id,
        path === "/folderview"
          ? "folder"
          : path === "/open"
            ? "either"
            : "file",
      );
    }
    if (DRIVE_PAGE.test(path)) return refuse("link_page");
    return refuse("link_bad");
  }
  if (host === "drive.usercontent.google.com" && path === "/download") {
    const id = idParam();
    return id ? ok(id, "file") : refuse("link_bad");
  }
  return refuse("link_bad");
}

/**
 * The marks Arabic chats and mail put around a link and inside a line
 * (right-to-left and left-to-right marks, embeddings, isolates, a zero
 * width space or joiner, a byte-order mark): read as spaces, so a link
 * never carries one.
 */
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/**
 * The pieces of a paste meant as links (a word is not): a scheme or www.,
 * or a host with a path, up to a space, a bracket, a guillemet or a quote,
 * so a link right after Arabic words or a colon ("الملفات هنا:https://…")
 * or inside «…» is found whole.
 */
const LINKS =
  /(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|www\.)[^\s<>«»"']+|(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}\/[^\s<>«»"']*/g;

/** A piece as WhatsApp and mail wrap it: "(link)." or "<link>,". */
const unwrap = (piece: string) =>
  piece.replace(/^[(<]+/, "").replace(/[.,)>]+$/, "");

/**
 * A paste split into its links (DRIVE-IMPORT.md 8): invisible marks read as
 * spaces, each link pulled out of the text around it and unwrapped, words
 * that are not links left out, each link once (by its Drive id when it
 * parses), the first 10 in `links` and the count beyond them in `extra`.
 * Pieces the parser refuses stay, so each one gets its own line under the
 * field.
 */
export function splitDriveLinks(text: string): {
  links: string[];
  extra: number;
} {
  const seen = new Set<string>();
  const all: string[] = [];
  const clean = text.replace(INVISIBLE, " ");
  for (const m of clean.matchAll(LINKS)) {
    const piece = unwrap(m[0].trim());
    if (!piece) continue;
    const parsed = parseDriveLink(piece);
    const key = parsed.ok ? `id:${parsed.id}` : `text:${piece}`;
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(piece);
  }
  return { links: all.slice(0, 10), extra: Math.max(0, all.length - 10) };
}

/**
 * What a typed field holds: its links, or, when nothing in it looks like a
 * link, the text itself as one piece (so "hello" is refused with a
 * sentence, not ignored).
 */
export function typedDriveLinks(text: string): {
  links: string[];
  extra: number;
} {
  const split = splitDriveLinks(text);
  if (split.links.length || !text.trim()) return split;
  return { links: [text.trim()], extra: 0 };
}

/** A link as the box shows it: no scheme, cut in the middle when long. */
export function shortLink(link: string, max = 46): string {
  return cutMiddle(link.replace(/^https?:\/\//i, ""), max);
}

/** A long link cut in the middle, so its start and its id's end both show. */
export function cutMiddle(text: string, max = 46): string {
  if (text.length <= max) return text;
  const head = Math.ceil((max - 1) * 0.6);
  const tail = max - 1 - head;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}
