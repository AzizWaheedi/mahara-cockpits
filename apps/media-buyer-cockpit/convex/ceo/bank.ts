import { USD_PER } from "./data/tap";

/**
 * Bank statements, as CBK Online exports them (Aziz, 2026-09-21: "Cash
 * collected = the bank statement CSV I upload + Whop payments"). CBK has no
 * API, so the statement is a CSV a person downloads and drops on the Money
 * tab. This file is pure: it parses the text, gives every line a kind, sorts
 * the expenses into categories, and matches Whop payouts and Tap
 * settlements to the payments they carry. Nothing here reads a database.
 *
 * The export looks like this (one file per account, per period):
 *
 *   CBK Online,,,,
 *   Customer No  1234567,,,,
 *   Date  01-Jun-2026,,,,
 *   From Date [DD/MM/YYYY]  01/05/2026,,,,
 *   To Date [DD/MM/YYYY]  31/05/2026,,,,
 *   Account  537015XXXXXX4348,,,,
 *   Type  537015XXXXXX4348,,,,
 *   Currency  Control account Card,,,,
 *   ,,,,
 *   Date,Amount,Balance,Reference,TRSH_NUMBER
 *   01/05/2026,-0.15,673.191,Non Sufficient Bal. Decline Fee,123456789
 *   ...
 *   ,"Total Debit Transaction Amount  -4,772.310",,,
 *   ,Curr. Bal.  175.735,,,
 *
 * A card statement's credits are the money moved onto the card, never a
 * client paying; an account statement's credits are client transfers, Whop
 * payouts, Tap settlements and transfers between Mahara's own accounts.
 */

export type AccountKind = "account" | "card";

export type StatementLine = {
  /** Kuwait day, YYYY-MM-DD (the statement carries days, not times). */
  day: string;
  /** Signed: a credit is positive, a debit negative. In the statement currency. */
  amount: number;
  balance: number | null;
  reference: string;
  trsh: string | null;
  /** 1-based line in the file, for a problem message. */
  line: number;
};

export type ParsedStatement = {
  account: string;
  accountKind: AccountKind;
  currency: string;
  fromDay: string | null;
  toDay: string | null;
  lines: StatementLine[];
  totalDebit: number | null;
  totalCredit: number | null;
  closingBalance: number | null;
  /** Rows between the header and the footer that could not be read. */
  problems: string[];
};

export type LineKind =
  | "client_payment"
  | "whop_payout"
  | "whop_topup"
  | "tap_settlement"
  | "own_transfer"
  | "refund_in"
  | "expense"
  | "fee"
  | "excluded"
  | "unknown";

/** What the money adapter and the screens call the kinds. */
export const KIND_LABEL: Record<LineKind, string> = {
  client_payment: "Client payment",
  whop_payout: "Whop payout",
  whop_topup: "Transfer into Whop",
  tap_settlement: "Tap settlement",
  own_transfer: "Own transfer",
  refund_in: "Refund received",
  expense: "Expense",
  fee: "Bank fee",
  excluded: "Excluded",
  unknown: "Unknown",
};

export type Exclusion = { kind: "card" | "vendor"; pattern: string };

const DAY_DMY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const DAY_DMON = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/;
const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

/** "01/05/2026" or "01-May-2026" as YYYY-MM-DD; null when it is neither. */
export function parseDay(s: string): string | null {
  const t = s.trim();
  let m = DAY_DMY.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = DAY_DMON.exec(t);
  if (m) {
    const mm = MONTHS[m[2].toLowerCase()];
    return mm ? `${m[3]}-${mm}-${m[1].padStart(2, "0")}` : null;
  }
  return null;
}

/** "-4,772.310" as a number; null when it is not one. */
export function parseAmount(s: string): number | null {
  const t = s
    .trim()
    .replace(/,/g, "")
    .replace(/^\((.*)\)$/, "-$1");
  if (!t || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** Split one CSV line on commas outside quotes. */
export function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (ch === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map(x => x.trim());
}

/** "Account  537015XXXXXX4348" → ["Account", "537015XXXXXX4348"]. */
function preambleKv(cell: string): [string, string] | null {
  const m = /^([A-Za-z][A-Za-z .]*?(?:\[[^\]]*\])?)\s{2,}(.+)$/.exec(
    cell.trim(),
  );
  if (!m) return null;
  return [
    m[1]
      .replace(/\s*\[[^\]]*\]\s*$/, "")
      .trim()
      .toLowerCase(),
    m[2].trim(),
  ];
}

/** Parse a CBK Online CSV export. Throws only when no statement table is found. */
export function parseStatement(text: string): ParsedStatement {
  const rows = text.replace(/^﻿/, "").split(/\r?\n/);
  let account = "";
  let currencyLine = "";
  let fromDay: string | null = null;
  let toDay: string | null = null;
  let header = -1;
  const cols: Record<string, number> = {};
  for (let i = 0; i < rows.length; i++) {
    const cells = splitCsv(rows[i]);
    const first = cells[0] ?? "";
    if (
      /^date$/i.test(first) &&
      cells.some(c => /^amount$|^debit$|^credit$/i.test(c))
    ) {
      header = i;
      cells.forEach((c, j) => {
        cols[c.toLowerCase().replace(/[^a-z_]/g, "")] = j;
      });
      break;
    }
    const kv = preambleKv(first);
    if (!kv) continue;
    const [k, v] = kv;
    if (k === "account") account = v;
    else if (k === "currency" || k === "type")
      currencyLine = `${currencyLine} ${v}`.trim();
    else if (k.startsWith("from date")) fromDay = parseDay(v);
    else if (k.startsWith("to date")) toDay = parseDay(v);
  }
  if (header < 0)
    throw new Error(
      "This is not a CBK statement export: no Date, Amount, Balance table was found.",
    );
  const accountKind: AccountKind = /\bcard\b/i.test(currencyLine)
    ? "card"
    : "account";
  const currency =
    /\b(KWD|USD|EUR|GBP|AED|SAR|QAR)\b/i
      .exec(currencyLine)?.[1]
      ?.toUpperCase() ?? "KWD";

  const lines: StatementLine[] = [];
  const problems: string[] = [];
  let totalDebit: number | null = null;
  let totalCredit: number | null = null;
  let closingBalance: number | null = null;
  const at = (cells: string[], key: string) =>
    cols[key] === undefined ? "" : (cells[cols[key]] ?? "");
  for (let i = header + 1; i < rows.length; i++) {
    const raw = rows[i];
    if (!raw.trim() || raw.replace(/,/g, "").trim() === "") continue;
    const cells = splitCsv(raw);
    const day = parseDay(cells[cols.date ?? 0] ?? "");
    if (!day) {
      // The footer: totals and balances, or a line that is not a transaction.
      const joined = cells.join(" ");
      const num = (label: RegExp) => {
        const m = label.exec(joined);
        return m ? parseAmount(m[1]) : null;
      };
      totalDebit = num(/Total Debit[^0-9-]*(-?[\d,]+\.?\d*)/i) ?? totalDebit;
      totalCredit = num(/Total Credit[^0-9-]*(-?[\d,]+\.?\d*)/i) ?? totalCredit;
      closingBalance =
        num(/Curr\.? Bal\.?[^0-9-]*(-?[\d,]+\.?\d*)/i) ?? closingBalance;
      if (!/total|bal\./i.test(joined))
        problems.push(
          `Line ${i + 1} has no date and is not a total: ${raw.slice(0, 60)}`,
        );
      continue;
    }
    let amount = parseAmount(at(cells, "amount"));
    if (
      amount === null &&
      (cols.debit !== undefined || cols.credit !== undefined)
    ) {
      const d = parseAmount(at(cells, "debit")) ?? 0;
      const c = parseAmount(at(cells, "credit")) ?? 0;
      amount = c - Math.abs(d);
    }
    if (amount === null) {
      problems.push(`Line ${i + 1} has no amount: ${raw.slice(0, 60)}`);
      continue;
    }
    lines.push({
      day,
      amount,
      balance: parseAmount(at(cells, "balance")),
      reference:
        at(cells, "reference") ||
        at(cells, "description") ||
        at(cells, "narration") ||
        "",
      trsh: at(cells, "trsh_number") || at(cells, "trshnumber") || null,
      line: i + 1,
    });
  }
  return {
    account,
    accountKind,
    currency,
    fromDay,
    toDay,
    lines,
    totalDebit,
    totalCredit,
    closingBalance,
    problems,
  };
}

// --- The statement PDF ------------------------------------------------------------

/**
 * A CBK account or card statement PDF, as the text pdf.js (unpdf, on the
 * server) or a layout extractor gives it. Every page repeats the header (card
 * number, period, page count) and a footer (complaints, a promotion), and one
 * transaction can span several lines: the merchant on the first, the original
 * currency amount in brackets, transfer details, the amount and the running
 * balance in whatever order the extractor met them. So the text is cut into
 * blocks at each line that starts with a day, and each block is read as
 * tokens: a three-decimal number is KWD (the one followed by CR or DR is the
 * balance, the other one the amount), a number inside "(USD ...)" is the
 * original amount, the "+" or "-" just before the amount is the direction, and
 * everything else is the description. The running balance then proves every
 * row: the opening balance plus each signed amount has to land on the printed
 * balance, and a row that does not is reported as a problem, not trusted.
 */
const PDF_NOISE =
  /^\d{2}\/\d{2}\/\d{4}\s+to:?\s+\d{2}\/\d{2}\/\d{4}$|^\d{1,3}\/\d{1,3}$|Account Statement|^Date\s*:|Card No|Account No|IBAN|Branch\s*:|Type\s*:|Statement Period|Pages\s*:|Balance B\/Fwd|Balance C\/F|Auth Date|This Statement of Account|within 2 weeks|For Complaints|Safat|Al-Najma|Semi Annually|Call at|^to:?$/i;
const DAY_TOKEN = /^\d{2}\/\d{2}\/\d{4}$/;
const NUMBER_TOKEN = /^[\d,]*\d(\.\d+)?$/;
const BRACKET_OPEN = /^\(([A-Z]{3})\)?$/;

/** True when the text reads like the statement PDF rather than a CSV export. */
export function isStatementPdfText(text: string): boolean {
  return /Statement Period/i.test(text) && !/^Date,Amount/m.test(text);
}

/** Either statement format, told apart by its text. */
export function parseAnyStatement(text: string): ParsedStatement {
  return isStatementPdfText(text)
    ? parseStatementPdfText(text)
    : parseStatement(text);
}

const decimalsOf = (num: string) => (num.split(".")[1] ?? "").length;

export function parseStatementPdfText(text: string): ParsedStatement {
  const flat = text.replace(/\s+/g, " ");
  // pdf.js prints the header's labels first and its values after, so the
  // account is the first masked number in the text (the header comes before
  // any transaction) and the period is the first "day to: day" pair.
  const account =
    /(?:Card|Account) No\s*:?\s*([0-9xX*]{8,24})/.exec(flat)?.[1] ??
    /\b(\d{4,6}[xX*]{4,12}\d{4})\b/.exec(flat)?.[1] ??
    "";
  const period = /(\d{2}\/\d{2}\/\d{4})\s*to:?\s*(\d{2}\/\d{2}\/\d{4})/i.exec(
    flat,
  );
  const fromDay = period ? parseDay(period[1]) : null;
  const toDay = period ? parseDay(period[2]) : null;
  const currency =
    /\b(KWD|USD|EUR|GBP|AED|SAR|QAR)\s+Pages\s*:/i
      .exec(flat)?.[1]
      ?.toUpperCase() ?? "KWD";
  const accountKind: AccountKind = /Card No|CONTROL account|Card Centre/i.test(
    flat,
  )
    ? "card"
    : "account";
  const signed = (m: RegExpExecArray | null): number | null =>
    m
      ? (parseAmount(m[1]) ?? 0) * (m[2].toUpperCase() === "DR" ? -1 : 1)
      : null;
  const opening = signed(
    /Balance B\/Fwd:?\s*([\d,]+\.\d{3})\s*(CR|DR)/i.exec(flat),
  );
  const closingBalance = signed(
    /Balance C\/F:?\s*([\d,]+\.\d{3})\s*(CR|DR)/i.exec(flat),
  );

  // One block per transaction, cut at each line that starts with a day. A
  // line that is only a day comes from the period header on every page.
  const blocks: { line: number; text: string[] }[] = [];
  const rows = text.split(/\r?\n|\f/);
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i].trim();
    if (!line || PDF_NOISE.test(line) || DAY_TOKEN.test(line)) continue;
    if (/^\d{2}\/\d{2}\/\d{4}\s/.test(line))
      blocks.push({ line: i + 1, text: [line] });
    else if (blocks.length) blocks[blocks.length - 1].text.push(line);
  }

  const lines: StatementLine[] = [];
  const problems: string[] = [];
  let prev = opening;
  for (const b of blocks) {
    // Arabic comes out of the extractor as unreadable glyphs; only ASCII is read.
    const toks = b.text
      .join(" ")
      .replace(/[^\x20-\x7e]+/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    const day = parseDay(toks[0] ?? "");
    if (!day) continue;
    const used = new Set<number>([0]);
    if (toks[1] && DAY_TOKEN.test(toks[1])) used.add(1);

    let amountIdx = -1;
    let balanceIdx = -1;
    let amount: number | null = null;
    let balance: number | null = null;
    for (let i = 1; i < toks.length; i++) {
      if (used.has(i)) continue;
      const num = toks[i].replace(/\)$/, "");
      if (!NUMBER_TOKEN.test(num) || decimalsOf(num) !== 3) continue;
      const n = parseAmount(num);
      if (n === null) continue;
      const next = toks[i + 1];
      if ((next === "CR" || next === "DR") && balanceIdx < 0) {
        balance = next === "DR" ? -n : n;
        balanceIdx = i;
        used.add(i);
        used.add(i + 1);
      } else if (amountIdx < 0) {
        amount = n;
        amountIdx = i;
        used.add(i);
      }
    }
    if (amount === null || amountIdx < 0) {
      const head = toks.slice(1, 6).join(" ");
      // A header time stamp ("21/09/2026 14:41:07") is not a transaction.
      if (head && !/^\d{2}:\d{2}/.test(head))
        problems.push(`Line ${b.line} has no amount: ${head.slice(0, 60)}`);
      continue;
    }

    // The direction is the sign just before the amount, past an open bracket.
    let sign = 0;
    let j = amountIdx - 1;
    while (j > 0 && BRACKET_OPEN.test(toks[j])) j--;
    if (toks[j] === "-" || toks[j] === "+") {
      sign = toks[j] === "-" ? -1 : 1;
      used.add(j);
    }

    // The original currency amount: "(USD 532)" in any token order.
    let orig: { currency: string; amount: number } | null = null;
    const open = toks.findIndex((t, i) => i > 0 && BRACKET_OPEN.test(t));
    if (open > 0) {
      used.add(open);
      for (let i = open + 1; i < toks.length && !orig; i++) {
        if (used.has(i)) continue;
        const num = toks[i].replace(/\)$/, "");
        if (NUMBER_TOKEN.test(num)) {
          const n = parseAmount(num);
          if (n !== null) {
            orig = {
              currency: BRACKET_OPEN.exec(toks[open])?.[1] ?? "",
              amount: n,
            };
            used.add(i);
          }
        } else if (toks[i] === ")") used.add(i);
      }
    }

    if (sign === 0 && prev !== null && balance !== null)
      sign = balance >= prev ? 1 : -1;
    if (sign === 0) sign = -1;
    const signedAmount = Math.round(sign * amount * 1000) / 1000;
    if (
      prev !== null &&
      balance !== null &&
      Math.abs(prev + signedAmount - balance) > 0.0005
    )
      problems.push(
        `Line ${b.line}: ${prev.toFixed(3)} ${sign < 0 ? "-" : "+"} ${amount.toFixed(3)} does not give the printed balance ${balance.toFixed(3)}`,
      );
    if (balance !== null) prev = balance;

    const desc = toks
      .filter(
        (t, i) =>
          !used.has(i) &&
          t !== "CR" &&
          t !== "DR" &&
          t !== ")" &&
          !/^\d[\d,]*$/.test(t),
      )
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    lines.push({
      day,
      amount: signedAmount,
      balance,
      reference: orig ? `${desc} (${orig.currency} ${orig.amount})` : desc,
      trsh: null,
      line: b.line,
    });
  }
  const debit = lines
    .filter(l => l.amount < 0)
    .reduce((t, l) => t + l.amount, 0);
  const credit = lines
    .filter(l => l.amount > 0)
    .reduce((t, l) => t + l.amount, 0);
  return {
    account,
    accountKind,
    currency,
    fromDay,
    toDay,
    lines,
    totalDebit: lines.length ? Math.round(debit * 1000) / 1000 : null,
    totalCredit: lines.length ? Math.round(credit * 1000) / 1000 : null,
    closingBalance,
    problems,
  };
}

/** The key a line is stored under: the bank's own transaction number when it has one. */
export function lineHash(account: string, l: StatementLine): string {
  // The CSV export prints the account as 537015XXXXXX4348 and the PDF as
  // 5370xxxxxxxx4348: the last four digits are the account in the key, so a
  // month uploaded both ways lands once. Day, amount and running balance name
  // a transaction in either format; the transaction number only the CSV has.
  const acct = account.replace(/\D/g, "").slice(-4) || account.toLowerCase();
  if (l.balance !== null)
    return `${acct}:${l.day}:${l.amount.toFixed(3)}:${l.balance.toFixed(3)}`;
  return l.trsh
    ? `${acct}:${l.trsh}`
    : `${acct}:${l.day}:${l.amount}:${l.reference.toLowerCase().replace(/\s+/g, " ")}`;
}

/** A statement's own id: the account and the period. */
export function statementId(p: ParsedStatement): string {
  const from = p.fromDay ?? p.lines[0]?.day ?? "unknown";
  const to = p.toDay ?? p.lines[p.lines.length - 1]?.day ?? "unknown";
  return `${p.account || "unknown"}:${from}:${to}`;
}

const WHOP = /\bwhop\b/i;
const WHOP_PURCHASE = /whop\s*\*/i;
const TAP = /\btap\b|tap payments|tap company|tap\.company/i;
const FEE =
  /non sufficient|decline fee|ann\.?\s*sub\.?\s*fee|service charge|\bcommission\b|\bfee\b|charges?\b/i;
const REFUND = /refund|reversal|chargeback|revers/i;
/** Money moved onto the card from Aziz's own account (the statement's own words). */
const CARD_TOPUP = /card payment|tijari (mobile|online)|control card/i;
const OWN_MASK =
  /\d{3,6}X{4,}\d{3,4}|\/CC\b|\/IB\b|transfer to card|card top ?up|own account|\bunload\b|weyay top up|top up kw|waheedi/i;

/** A vendor exclusion matches a case-insensitive fragment of the reference; a card exclusion matches the account. */
export function isExcluded(
  reference: string,
  account: string,
  exclusions: Exclusion[],
): Exclusion | null {
  const ref = reference.toLowerCase();
  for (const x of exclusions) {
    const p = x.pattern.trim().toLowerCase();
    if (!p) continue;
    if (x.kind === "card" && account.toLowerCase() === p) return x;
    if (x.kind === "vendor" && ref.includes(p)) return x;
  }
  return null;
}

/**
 * What a line is. A credit is client money unless it says Whop, Tap, a
 * refund, an own account or a card top-up (money moved onto the card).
 * Debits are expenses unless they say Whop (money into Whop, or a purchase
 * on Whop) or read as a bank fee.
 */
export function classifyLine(
  l: { amount: number; reference: string },
  // Kept so every caller reads the same way; a credit is judged by its words now.
  _accountKind: AccountKind,
  account: string,
  exclusions: Exclusion[] = [],
): LineKind {
  const ref = l.reference;
  if (l.amount > 0) {
    if (WHOP.test(ref) && !WHOP_PURCHASE.test(ref)) return "whop_payout";
    if (TAP.test(ref)) return "tap_settlement";
    if (REFUND.test(ref)) return "refund_in";
    if (OWN_MASK.test(ref) || CARD_TOPUP.test(ref)) return "own_transfer";
    return "client_payment";
  }
  if (l.amount < 0) {
    if (isExcluded(ref, account, exclusions)) return "excluded";
    if (WHOP_PURCHASE.test(ref)) return "expense";
    if (WHOP.test(ref)) return "whop_topup";
    if (FEE.test(ref)) return "fee";
    // Money moved between Mahara's own accounts, cards and wallets (a card
    // unload, a Weyay top-up, a transfer to another own account) is not a cost.
    if (OWN_MASK.test(ref)) return "own_transfer";
    return "expense";
  }
  return "unknown";
}

export type ExpenseCategory =
  | "ads"
  | "software"
  | "courses"
  | "labour"
  | "bank"
  | "other";

const CATEGORY_RULES: { category: ExpenseCategory; test: RegExp }[] = [
  {
    category: "ads",
    test: /facebk|facebook|meta platforms|\bmeta\b|google ads|googleads|tiktok|snap\b|snapchat/i,
  },
  {
    category: "courses",
    test: /whop\s*\*|teachable|kajabi|skool|circle\.so|udemy|maven/i,
  },
  {
    category: "labour",
    // A transfer to a named person from the card account ("QPA…|Bill Payment |NAME", Ziina) is a person paid, not a vendor.
    test: /salary|salaries|payroll|wages|freelanc|upwork|fiverr|khamsat|mostaql|payoneer|hired!|deel\b|remote\.com|\|\s*(bill payment|services payment|business income|other)\s*\||\bziina\b/i,
  },
  { category: "bank", test: FEE },
  {
    category: "software",
    test: /openai|anthropic|claude|chatgpt|notion|slack|zoom|canva|adobe|vercel|supabase|github|make\.com|integromat|typeform|clickup|apple\.com\/bill|google\s*\*|gsuite|google workspace|google cloud|microsoft|dropbox|figma|loom|calendly|zapier|twilio|maqsam|whapi|resend|convex|namecheap|godaddy|hostinger|elevenlabs|heygen|runway|frame\.io|foreplay|apify|composio|gohighlevel|highlevel|goghl|\bghl\b|cursor|linear\.app|1password|cloudflare|aws\b|amazon web|digitalocean|hetzner|render\.com|railway|descript|capcut|midjourney|perplexity|grammarly|manychat|klaviyo|mailchimp|webflow|framer|squarespace|wix\b|shopify|proton|windsor|wistia|fathom|higgsfield|pitch\.com|gamma\.app|hubstaff|viktor|roasform|vidalytics|leadsie|manus|atlassian|elfsigh|wispr|brain\.fm|waghl|excalidraw|fireflies|otter\.ai|tldv|riverside|veed|submagic|opus|synthesia|pictory|airtable|smartsheet|monday\.com|asana|trello|miro|lucid|semrush|ahrefs|similarweb|hotjar|mixpanel|posthog|segment|hubspot|pipedrive|zoho|intercom|crisp|tidio|drift|aircall|ringcentral|dialpad|justcall|openphone|skype|viber|telegram|whatsapp business|wati|interakt|respond\.io|chatwoot|bunny\.net|mux\b|vimeo|youtube premium|spotify for|linkedin|sales navigator|apollo\.io|lusha|hunter\.io|snov|instantly|smartlead|lemlist|beehiiv|substack|convertkit|kit\.com|carrd|tally\.so|jotform|paperform|docusign|pandadoc|dropbox sign|hellosign|calendly|cal\.com|savvycal|zcal/i,
  },
];

/** Which P&L line an expense sits on, by the reference alone. */
export function categorise(reference: string): ExpenseCategory {
  for (const r of CATEGORY_RULES) if (r.test.test(reference)) return r.category;
  return "other";
}

/** A line's amount in USD at the cockpit's fixed rate; null when the currency has no rate. */
export function toUsd(amount: number, currency: string): number | null {
  const rate = USD_PER[currency.toUpperCase()];
  if (rate === undefined) return null;
  return Math.round(amount * rate * 100) / 100;
}

export type Payout = { id: string; day: string; usd: number };
export type PaymentLike = { id: string; day: string; usd: number };
export type PayoutMatch = {
  from: string;
  to: string;
  count: number;
  usd: number;
};

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/**
 * Match each payout or settlement to the run of payments it carries: the
 * payments in the `lookback` days before it, oldest first, until their sum
 * lands within `tolerance` of the payout (fees make a payout a little less
 * than the payments). Each payment is used once. Unmatched payouts are
 * still not cash: the payments behind them were counted on their own rail.
 */
export function matchPayouts(
  payouts: Payout[],
  payments: PaymentLike[],
  opts: { lookback: number; tolerance: number } = {
    lookback: 14,
    tolerance: 0.03,
  },
): Map<string, PayoutMatch> {
  const out = new Map<string, PayoutMatch>();
  const used = new Set<string>();
  const sorted = [...payments].sort((a, b) =>
    a.day < b.day ? -1 : a.day > b.day ? 1 : 0,
  );
  for (const p of [...payouts].sort((a, b) => (a.day < b.day ? -1 : 1))) {
    const pool = sorted.filter(
      x =>
        !used.has(x.id) &&
        dayDiff(x.day, p.day) >= 0 &&
        dayDiff(x.day, p.day) <= opts.lookback,
    );
    let hit: PaymentLike[] | null = null;
    for (let start = 0; start < pool.length && !hit; start++) {
      let sum = 0;
      const run: PaymentLike[] = [];
      for (let i = start; i < pool.length; i++) {
        sum += pool[i].usd;
        run.push(pool[i]);
        const gap = Math.abs(sum - p.usd) / p.usd;
        if (gap <= opts.tolerance) {
          hit = [...run];
          break;
        }
        if (sum > p.usd * (1 + opts.tolerance)) break;
      }
    }
    if (hit) {
      for (const h of hit) used.add(h.id);
      out.set(p.id, {
        from: hit[0].day,
        to: hit[hit.length - 1].day,
        count: hit.length,
        usd: Math.round(hit.reduce((t, h) => t + h.usd, 0) * 100) / 100,
      });
    }
  }
  return out;
}
