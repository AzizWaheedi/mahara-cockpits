/**
 * A meeting's doc as HTML, written in the page's editor since 2026-09-30
 * (the CEO: "similar to a Google Doc ... bullet points, sizes, headings ...
 * copy and paste images"), and what the server and the page share around
 * it: telling a doc written before then (plain text) from HTML, turning that
 * text into the editor's HTML, a doc's words for a preview, a light clean
 * on the way in, the doc's pictures (paths in the private team-docs bucket,
 * signed when the page reads the doc), and the meeting's links.
 *
 * No Convex imports: the page (src/pages/team) uses these too.
 */

/** The longest doc a save keeps; pictures are links to the bucket, never inline. */
export const DOC_MAX = 400_000;

export const PICTURE_BUCKET = "team-docs";
export const PICTURE_MAX_BYTES = 10 * 1024 * 1024;
export const PICTURE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** "<meeting>/<yyyy-mm>/<hex>.<ext>": the only shape a picture path takes. */
export const PICTURE_PATH =
  /^[a-z0-9][a-z0-9-]{0,80}\/\d{4}-\d{2}\/[a-f0-9]{16,40}\.(png|jpg|gif|webp)$/;

const BLOCK_START =
  /^\s*<(p|h[1-6]|ul|ol|li|blockquote|pre|table|hr|img|div)[\s>/]/i;

/** A doc the editor wrote, as opposed to one written as plain text before it. */
export function isHtml(doc: string): boolean {
  return BLOCK_START.test(doc);
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const BULLET = /^\s*[-•*]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

/**
 * A plain-text doc as the editor's HTML: blank lines part paragraphs, "- "
 * lines are a bulleted list, "1. " lines a numbered one, and a short line
 * with no closing stop that heads a list is a heading ("Who owns each field
 * of a row" above its list).
 */
export function textToHtml(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(escapeHtml).join("<br>")}</p>`);
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      flush();
      continue;
    }
    const kind = BULLET.test(line) ? "ul" : NUMBERED.test(line) ? "ol" : null;
    if (kind) {
      flush();
      const mark = kind === "ul" ? BULLET : NUMBERED;
      const items: string[] = [];
      while (i < lines.length && mark.test(lines[i])) {
        items.push(lines[i].replace(mark, "").trim());
        i++;
      }
      i--;
      out.push(
        `<${kind}>${items.map(t => `<li><p>${escapeHtml(t)}</p></li>`).join("")}</${kind}>`,
      );
      continue;
    }
    const next = lines[i + 1] ?? "";
    const heads =
      !para.length &&
      (BULLET.test(next) || NUMBERED.test(next)) &&
      line.trim().length <= 90 &&
      !/[.:;,!?]$/.test(line.trim());
    if (heads) {
      out.push(`<h3>${escapeHtml(line.trim())}</h3>`);
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return out.join("");
}

/** The doc as the editor opens it: HTML as it is, older plain text converted. */
export function docHtml(doc: string): string {
  if (!doc.trim()) return "";
  return isHtml(doc) ? doc : textToHtml(doc);
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  apos: "'",
  nbsp: " ",
};

/** A doc's words, one block to a line: for previews and the conflict note. */
export function docText(doc: string): string {
  if (!isHtml(doc)) return doc;
  return doc
    .replace(/<img\b[^>]*>/gi, "[picture]")
    .replace(/<\/p>(\s*<\/(li|td|th|blockquote)>)/gi, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6]|li|blockquote|pre|tr)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e: string) => ENTITIES[e])
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * What a save keeps. The page only ever renders the doc through the
 * editor's schema, which drops anything it does not know; this is the
 * second lock, for anything that reads the column later: no scripts, frames
 * or handlers, no script links, and no picture carried inline or still on
 * someone's own screen (a picture is uploaded to the bucket first).
 */
export function cleanDoc(html: string): string {
  return html
    .replace(
      /<(script|style|iframe|object|embed|noscript|template|svg|math)\b[\s\S]*?<\/\1\s*>/gi,
      "",
    )
    .replace(
      /<\/?(script|style|iframe|object|embed|link|meta|base|form|input|button|textarea|select|svg|math)\b[^>]*>/gi,
      "",
    )
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(
      /\b(href|src)\s*=\s*("|')\s*(?:javascript|vbscript|data:text\/html)[^"']*\2/gi,
      '$1="#"',
    )
    .replace(
      /<img\b[^>]*\bsrc\s*=\s*("|')\s*(?:data|blob):[^"']*\1[^>]*>/gi,
      "",
    );
}

/** The bucket paths of the doc's pictures. */
export function picturePaths(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/\bdata-path="([^"]+)"/g))
    if (PICTURE_PATH.test(m[1])) out.add(m[1]);
  return [...out];
}

/** The doc with each picture pointing at a fresh signed link. */
export function withPictureUrls(
  html: string,
  urls: Map<string, string>,
): string {
  if (!urls.size) return html;
  return html.replace(/<img\b[^>]*>/gi, tag => {
    const path = tag.match(/\bdata-path="([^"]+)"/)?.[1];
    const url = path ? urls.get(path) : undefined;
    if (!url) return tag;
    const src = `src="${url.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`;
    return /\bsrc="[^"]*"/.test(tag)
      ? tag.replace(/\bsrc="[^"]*"/, src)
      : tag.replace(/^<img\b/i, `<img ${src}`);
  });
}

/** Where a new picture goes: the meeting's folder, by month, a random name. */
export function picturePath(
  meetingId: string,
  ext: string,
  at: Date,
  hex: string,
): string {
  const folder =
    meetingId
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+/, "")
      .slice(0, 80) || "meeting";
  return `${folder}/${at.toISOString().slice(0, 7)}/${hex}.${ext}`;
}

// --- the meeting's links ------------------------------------------------------------

export type MeetingLink = { label: string; url: string };

/** Boards, screens and docs the team keeps open, named the way the team names them. */
const KNOWN: [RegExp, string][] = [
  [
    /docs\.google\.com\/document\/d\/1cioKqspTOI6zK76ob0lOTzfNLDMe5WS6NJ_hgTwb-p4/,
    "Diagnosing and fixing acquisition constraints",
  ],
  [
    /cockpit\.maharamedia\.com\/client-success\/performance/,
    "Client performance",
  ],
  [/cockpit\.maharamedia\.com\/client-success\/churn/, "Churn tracker"],
  [/cockpit\.maharamedia\.com\/client-success\/projections/, "Projections"],
  [
    /cockpit\.maharamedia\.com\/client-success\/clients/,
    "Clients & touchpoints",
  ],
  [/cockpit\.maharamedia\.com\/client-success\/hotlist/, "Hot list"],
  [/cockpit\.maharamedia\.com\/client-success\/billing/, "Billing"],
  [/cockpit\.maharamedia\.com\/creative\/what-works/, "What works"],
  [/cockpit\.maharamedia\.com\/editor/, "Editor desk"],
  [/cockpit\.maharamedia\.com\/sales/, "Sales cockpit"],
  [/cockpit\.maharamedia\.com\/ads/, "Ads management (cockpit)"],
  [/cockpit\.maharamedia\.com\/team/, "Team meetings"],
  [/dialer\.maharamedia\.com/, "Call center dialer"],
  [/app\.clickup\.com\/.*(901817774521|2kzmr1ky-3738)/, "Ads management board"],
  [/app\.clickup\.com\/.*2kzmr1ky-3818/, "911: critical CPL and CPB"],
  [/app\.clickup\.com\/.*901816723211/, "Client Success board"],
  [/app\.clickup\.com\/.*901816559981/, "Clients - Mahara"],
  [/app\.clickup\.com\/.*901816720767/, "Video Pipeline"],
  [/app\.clickup\.com\/.*901818016338/, "Media / Creative board"],
  [/docs\.google\.com\/spreadsheets/, "Google Sheet"],
  [/docs\.google\.com\/document/, "Google Doc"],
  [/docs\.google\.com\/presentation/, "Google Slides"],
  [/drive\.google\.com/, "Google Drive"],
  [/app\.clickup\.com/, "ClickUp"],
];

/** A pasted address's name: a known board or screen by its own name, anything else by its site. */
export function linkName(url: string): string {
  for (const [re, name] of KNOWN) if (re.test(url)) return name;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 80);
  }
}

export const LINKS_MAX = 30;

/**
 * Links as a save keeps them: http or https only, a label (the address's
 * host when none is given), no two alike. Refuses with a sentence a person
 * can act on.
 */
export function cleanLinks(raw: unknown): MeetingLink[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: MeetingLink[] = [];
  const seen = new Set<string>();
  for (const r of list) {
    const url = String((r as MeetingLink | null)?.url ?? "").trim();
    const label = String((r as MeetingLink | null)?.label ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    if (!url && !label) continue;
    let host = "";
    try {
      const u = new URL(url);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
      host = u.hostname.replace(/^www\./, "");
    } catch {
      throw new Error(
        `"${label || url}" needs a full web address starting with https://.`,
      );
    }
    if (url.length > 1000)
      throw new Error(`The address for "${label || host}" is too long.`);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ label: label || linkName(url) || host, url });
  }
  if (out.length > LINKS_MAX)
    throw new Error(`A meeting keeps up to ${LINKS_MAX} links.`);
  return out;
}

/** Links as stored (jsonb): one that would not save today is left out, not the rest. */
export function linksOf(raw: unknown): MeetingLink[] {
  const out: MeetingLink[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    try {
      out.push(...cleanLinks([r]));
    } catch {
      // Not a web address: not shown.
    }
  }
  return out.slice(0, LINKS_MAX);
}
