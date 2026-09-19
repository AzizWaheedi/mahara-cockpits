import { note } from "./health";
import { composioTool } from "./tools";

/**
 * The source adapters.
 *
 * Each of Notion, Gmail and Google Drive answers in its own shape, and each
 * has its own idea of what "matches" means. Everything in this file exists to
 * turn those three shapes into one row the memory core can rank and read:
 *
 *   Gmail  — full text search over mail, body included.
 *   Drive  — file names and metadata (and full text, if Google indexed it).
 *   Notion — page titles and the page's own markdown, read one page at a time.
 *
 * The honest limits of each one are written on the screen next to the results,
 * never hidden: see SOURCE_SEARCH_NOTE.
 */

export type MemoryItemDraft = {
  source: "notion" | "gmail" | "drive" | "note";
  externalId: string;
  title: string;
  /** Everything searchable about the item, flattened into one string. */
  body: string;
  snippet: string;
  url?: string;
  author?: string;
  occurredAt: number;
  /** How it got here: a live search, a sync, or Aziz typing. */
  via: string;
};

export type SourceResult = {
  source: "notion" | "gmail" | "drive";
  ok: boolean;
  /** Plain sentence about what this source did. */
  note: string;
  count: number;
  items: MemoryItemDraft[];
  error: string | null;
};

/** What each source can and cannot match, shown beside its results. */
export const SOURCE_SEARCH_NOTE: Record<string, string> = {
  notion:
    "Notion search matches page titles. Open a page result once and its text joins the index, so it matches on words inside it from then on.",
  gmail: "Gmail search reads the whole message, sender and subject included.",
  drive:
    "Drive search matches file names and Google's own index of the file. The file's contents are not downloaded.",
};

// ---------------------------------------------------------------------------
// Small text helpers (no crypto here: drafts are built inside actions, and a
// plain hash is enough to spot an unchanged item on a re-sync).

/** FNV-1a, hex. Deterministic, cheap, not a security boundary. */
export function hashOf(...parts: string[]): string {
  let h = 0x811c9dc5;
  const text = parts.join("\u0000");
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Collapse the whitespace email bodies arrive wrapped in. */
export function tidy(text: string): string {
  return String(text ?? "")
    .replace(/[\u034f\u200c\u200b\u00ad]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const STOP = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "in",
  "on",
  "for",
  "to",
  "is",
  "was",
  "what",
  "when",
  "who",
  "how",
  "did",
  "do",
  "does",
  "my",
  "me",
  "i",
  "about",
  "with",
  "that",
  "this",
]);

/**
 * Email bodies arrive as HTML often enough that the tags have to go before
 * anything is shown or indexed — otherwise a snippet reads
 * "<!doctype html> <html lang="en"…", which is worse than no snippet at all.
 */
export function stripHtml(text: string): string {
  return tidy(
    String(text ?? "")
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/gi, "'")
      .replace(/&mdash;/gi, "—")
      .replace(/&ndash;/gi, "–")
      .replace(/&hellip;/gi, "…"),
  );
}

/** The words worth matching on, lower-cased, longest first. */
export function terms(query: string): string[] {
  return tidy(query)
    .toLowerCase()
    .split(/[^a-z0-9@._+-]+/)
    .filter(word => word.length > 2 && !STOP.has(word))
    .sort((a, b) => b.length - a.length);
}

/**
 * The preview shown in the results list: the first place the query appears in
 * the item, with a little air around it. Never the first 200 characters
 * blindly — the match is what makes the row worth reading.
 */
export function snippetFor(body: string, query: string, max = 240): string {
  const flat = tidy(body).replace(/\n+/g, " ");
  const lower = flat.toLowerCase();
  let at = -1;
  for (const term of terms(query)) {
    const found = lower.indexOf(term);
    if (found !== -1 && (at === -1 || found < at)) at = found;
  }
  if (at === -1) {
    return flat.length <= max ? flat : `${flat.slice(0, max).trimEnd()}…`;
  }
  const start = Math.max(0, at - 60);
  const end = Math.min(flat.length, start + max);
  const head = start > 0 ? "…" : "";
  const tail = end < flat.length ? "…" : "";
  return `${head}${flat.slice(start, end).trim()}${tail}`;
}

/**
 * How well one item answers the query. Title matches beat body matches, a
 * memory Aziz wrote beats a synced item, and a recent item beats an old one —
 * so his own note lands above a two-year-old newsletter that mentions the word.
 */
export function scoreOf(
  item: { title: string; body: string; source: string; occurredAt: number },
  query: string,
  now: number,
): number {
  const title = item.title.toLowerCase();
  const body = item.body.toLowerCase();
  let score = 0;
  for (const term of terms(query)) {
    if (title.includes(term)) score += 6;
    else if (title.includes(term.slice(0, Math.max(4, term.length - 3))))
      score += 3;
    // Counting occurrences, capped: a body that says "invoice" forty times is
    // not forty times better than one that says it once.
    const hits = body.split(term).length - 1;
    score += Math.min(hits, 4);
  }
  if (score === 0) return 0;
  if (item.source === "note") score += 4;
  if (item.source === "notion") score += 2;
  const ageDays = Math.max(0, (now - item.occurredAt) / 86_400_000);
  score += Math.max(0, 3 - Math.log10(ageDays + 1) * 1.5);
  return score;
}

// ---------------------------------------------------------------------------
// Gmail

export function fromGmail(
  data: any,
  query: string,
  via: string,
): MemoryItemDraft[] {
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  return messages.map((message: any) => {
    const subject =
      stripHtml(String(message?.subject ?? "")).trim() || "(no subject)";
    const sender = String(message?.sender ?? "").trim();
    const to = String(message?.to ?? "").trim();
    // Some messages carry only HTML, some only text, and a big batch arrives
    // with the body shortened — the preview body is the fallback in both cases.
    const body =
      stripHtml(String(message?.messageText ?? "")) ||
      tidy(String(message?.preview?.body ?? ""));
    return {
      source: "gmail" as const,
      externalId: String(message?.messageId ?? ""),
      title: subject,
      body: tidy(`${subject}\nFrom: ${sender}\nTo: ${to}\n\n${body}`),
      snippet: snippetFor(body || `${sender}`, query),
      url: message?.display_url ? String(message.display_url) : undefined,
      author: sender || undefined,
      occurredAt: Date.parse(String(message?.messageTimestamp ?? "")) || 0,
      via,
    };
  });
}

// ---------------------------------------------------------------------------
// Google Drive

export function fromDrive(
  data: any,
  query: string,
  via: string,
): MemoryItemDraft[] {
  const files = Array.isArray(data?.files) ? data.files : [];
  return files.map((file: any) => {
    const name = String(file?.name ?? "").trim() || "(untitled file)";
    const kind = kindOf(String(file?.mimeType ?? ""));
    const modified = Date.parse(String(file?.modifiedTime ?? "")) || 0;
    const body = tidy(
      `${name} — ${kind} in Google Drive, last changed ${when(modified)}`,
    );
    return {
      source: "drive" as const,
      externalId: String(file?.id ?? ""),
      title: name,
      body,
      snippet: snippetFor(body, query || name),
      url: file?.webViewLink
        ? String(file.webViewLink)
        : file?.display_url
          ? String(file.display_url)
          : undefined,
      author: undefined,
      occurredAt: modified,
      via,
    };
  });
}

function kindOf(mimeType: string): string {
  if (mimeType.includes("spreadsheet")) return "a spreadsheet";
  if (mimeType.includes("presentation")) return "a slideshow";
  if (mimeType.includes("document")) return "a document";
  if (mimeType.includes("pdf")) return "a PDF";
  if (mimeType.includes("folder")) return "a folder";
  if (mimeType.includes("image")) return "an image";
  return "a file";
}

function when(ms: number): string {
  if (!ms) return "at an unknown time";
  return new Date(ms).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Notion

/** The page's title, wherever the workspace happens to keep it. */
export function notionTitle(page: any): string {
  const properties = page?.properties ?? {};
  for (const value of Object.values(properties)) {
    const prop = value as any;
    if (prop?.type !== "title" || !Array.isArray(prop.title)) continue;
    const text = prop.title
      .map((fragment: any) => String(fragment?.plain_text ?? ""))
      .join("")
      .trim();
    if (text) return text;
  }
  if (page?.title) return String(page.title);
  return "Untitled page";
}

/** Every property that carries text, flattened — the page's own list of facts. */
function notionPropertyText(page: any): string {
  const properties = page?.properties ?? {};
  const lines: string[] = [];
  for (const [name, value] of Object.entries(properties)) {
    const prop = value as any;
    if (!prop || prop.type === "title") continue;
    if (Array.isArray(prop.rich_text)) {
      const text = prop.rich_text
        .map((fragment: any) => String(fragment?.plain_text ?? ""))
        .join("")
        .trim();
      if (text) lines.push(`${name}: ${text}`);
    } else if (prop.type === "select" && prop.select?.name) {
      lines.push(`${name}: ${prop.select.name}`);
    } else if (prop.type === "date" && prop.date?.start) {
      lines.push(`${name}: ${prop.date.start}`);
    } else if (prop.type === "number" && typeof prop.number === "number") {
      lines.push(`${name}: ${prop.number}`);
    } else if (prop.type === "checkbox") {
      lines.push(`${name}: ${prop.checkbox ? "yes" : "no"}`);
    }
  }
  return lines.join("\n");
}

export function fromNotion(
  data: any,
  query: string,
  via: string,
): MemoryItemDraft[] {
  const pages = Array.isArray(data?.results) ? data.results : [];
  return pages
    .filter(
      (page: any) => page?.object !== "database" && page?.in_trash !== true,
    )
    .map((page: any) => {
      const title = notionTitle(page);
      const propertyText = notionPropertyText(page);
      const body = tidy(
        `${title}\n${propertyText}${propertyText ? "\n" : ""}(Notion page)`,
      );
      return {
        source: "notion" as const,
        externalId: String(page?.id ?? ""),
        title,
        body,
        snippet: snippetFor(propertyText || body, query || title),
        url: page?.url ? String(page.url) : undefined,
        author: undefined,
        occurredAt:
          Date.parse(String(page?.last_edited_time ?? "")) ||
          Date.parse(String(page?.created_time ?? "")) ||
          0,
        via,
      };
    });
}

/** The page's markdown, so its words become searchable like an email's. */
export async function readNotionPage(pageId: string): Promise<string | null> {
  const outcome = await composioTool(
    "NOTION_GET_PAGE_MARKDOWN",
    { page_id: pageId },
    "notion",
  );
  if (!outcome.ok) return null;
  const markdown = outcome.data?.markdown ?? outcome.data?.content;
  if (typeof markdown !== "string" || !markdown.trim()) return null;
  return tidy(markdown);
}

// ---------------------------------------------------------------------------
// Live search across the three sources, in one round trip

/**
 * Google Drive answers a query in its own syntax. The plain words go in as a
 * name match, which is what a person means when they type a file name, and the
 * whole phrase is offered as full text so a file whose contents mention it
 * still comes back.
 */
export function driveQuery(query: string): string {
  const clean = tidy(query).replace(/['\\]/g, " ").trim();
  const words = clean
    .split(/\s+/)
    .filter(word => word.length > 1)
    .slice(0, 4);
  const parts = (words.length ? words : [clean])
    .map(word => `name contains '${word}'`)
    .concat(words.length > 1 ? [`fullText contains '${clean}'`] : []);
  return `trashed = false and (${parts.join(" or ")})`;
}

/**
 * Search Notion, Gmail and Drive at the same time and return one list.
 *
 * One HTTP call goes out to Composio; when one source fails the other two
 * still answer, and the failure comes back as a sentence rather than an empty
 * list — an empty list would read as "you have nothing about this", which is a
 * different and much worse thing to be told.
 */
export async function federatedSearch(
  query: string,
  perSource: number,
  via: string,
): Promise<SourceResult[]> {
  const results = await Promise.all([
    composioTool(
      "NOTION_SEARCH_NOTION_PAGE",
      { query, page_size: perSource },
      "notion",
    ),
    composioTool(
      "GMAIL_FETCH_EMAILS",
      { query, max_results: perSource },
      "gmail",
    ),
    composioTool(
      "GOOGLEDRIVE_FIND_FILE",
      { query: driveQuery(query), page_size: perSource },
      "drive",
    ),
  ]);

  const [notion, gmail, drive] = results;
  return [
    shape("notion", notion, () => fromNotion(notion.data, query, via)),
    shape("gmail", gmail, () => fromGmail(gmail.data, query, via)),
    shape("drive", drive, () => fromDrive(drive.data, query, via)),
  ];
}

function shape(
  source: "notion" | "gmail" | "drive",
  outcome: {
    ok: boolean;
    data: unknown;
    error: string | null;
    truncated?: boolean;
  },
  build: () => MemoryItemDraft[],
): SourceResult {
  if (!outcome.ok) {
    return {
      source,
      ok: false,
      note: `${labelFor(source)} did not answer. ${SOURCE_SEARCH_NOTE[source]}`,
      count: 0,
      items: [],
      error: outcome.error,
    };
  }
  const items = build().filter(item => item.externalId);
  // Composio shortens a big batch. The results are still real and still
  // ranked; the words at the end of a long email are what is missing, so the
  // screen says so rather than implying it read everything.
  const shortened = outcome.truncated
    ? " Composio shortened this batch, so the end of long items may be missing — open the item for the whole thing."
    : "";
  return {
    source,
    ok: true,
    note:
      items.length === 0
        ? `Nothing in ${labelFor(source)} matched. ${SOURCE_SEARCH_NOTE[source]}`
        : `${items.length} from ${labelFor(source)}.${shortened} ${SOURCE_SEARCH_NOTE[source]}`,
    count: items.length,
    items,
    error: null,
  };
}

function labelFor(source: string): string {
  if (source === "gmail") return "Gmail";
  if (source === "drive") return "Google Drive";
  return "Notion";
}

/** Recent items from a source, for a sync with no query attached. */
export async function recentFrom(
  source: "notion" | "gmail" | "drive",
  limit: number,
  via: string,
): Promise<SourceResult> {
  if (source === "notion") {
    const outcome = await composioTool(
      "NOTION_SEARCH_NOTION_PAGE",
      { page_size: limit },
      "notion",
    );
    return shape("notion", outcome, () => fromNotion(outcome.data, "", via));
  }
  if (source === "gmail") {
    const outcome = await composioTool(
      "GMAIL_FETCH_EMAILS",
      { max_results: limit, query: "newer_than:30d" },
      "gmail",
    );
    return shape("gmail", outcome, () => fromGmail(outcome.data, "", via));
  }
  const outcome = await composioTool(
    "GOOGLEDRIVE_FIND_FILE",
    {
      query: "trashed = false",
      page_size: limit,
      order_by: "modifiedTime desc",
    },
    "drive",
  );
  return shape("drive", outcome, () => fromDrive(outcome.data, "", via));
}

/** Say in the ledger why a source came back empty, without shouting. */
export function emptyReason(source: string, count: number): string {
  if (count > 0) return `${count} item${count === 1 ? "" : "s"} ready`;
  if (source === "notion") {
    return "No pages matched — Notion only searches pages shared with the Composio integration";
  }
  return "Nothing matched on this pass";
}

export { note };
