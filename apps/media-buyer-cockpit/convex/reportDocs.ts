import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import { clientDataFor, normTight, readClientData } from "./clientData";
import { bridge } from "./comms";
import { callTool, googleAccessToken, unwrap } from "./tools";

/**
 * One client's monthly report as a branded, editable Google Doc.
 *
 * Requested from the Client Success app (a row in its `reportDocs` table),
 * built here because that app has no Google access. The CSM edits the doc
 * before it goes anywhere, which is the point of a doc rather than a PDF.
 *
 * Everything factual comes from the client's own stat sheet via the stored
 * profile. The only generated prose is "what this means" and "what we are
 * doing next": the model is handed the numbers and the diagnosis and told to
 * add nothing. Ported from Viktor's csm_report_doc.py on 2026-09-10 when the
 * app had been saying "Writing 2026-09 now" with nothing writing it.
 *
 * Branding: Inter, H1/H2 navy #091333, H3 cyan #00CFC8.
 */

// biome-ignore lint/suspicious/noExplicitAny: profile and Docs payloads
type Any = any;

const NAVY = { red: 0x09 / 255, green: 0x13 / 255, blue: 0x33 / 255 };
const CYAN = { red: 0x00 / 255, green: 0xcf / 255, blue: 0xc8 / 255 };
const INK = { red: 0.12, green: 0.12, blue: 0.14 };
const MUTED = { red: 0.42, green: 0.45, blue: 0.5 };
const WHITE = { red: 1, green: 1, blue: 1 };
const BAND = { red: 0xf4 / 255, green: 0xfa / 255, blue: 0xfa / 255 };
const RULE = { red: 0xdd / 255, green: 0xe2 / 255, blue: 0xe8 / 255 };

const SHARE_WITH = ["aziz@maharamedia.com", "abdulelah@maharamedia.com"];
/** Client KPI gates Aziz locked. Kept in step with the CS app's csmDiagnosis.ts. */
const GATES = { bookingRate: 25, showRate: 75, closeRate: 20 };
const EXTRAS = ["lost", "byAd", "appointments", "ads"];

/** No em or en dash anywhere a client reads. */
function humanise(text: unknown, rtl: boolean): string {
  let t = String(text ?? "");
  t = t.replace(/—/g, rtl ? "، " : ", ").replace(/–/g, " to ");
  t = t.replace(/ ,/g, ",").replace(/,,/g, ",").replace(/, ,/g, ",");
  t = t.replace(/ ،/g, "،").replace(/،،/g, "،");
  t = t.replace(/\s*,\s*$/, "").replace(/[ \t]{2,}/g, " ");
  return t.trim();
}

type Lang = "en" | "ar";
const LABELS: Record<Lang, Any> = {
  en: {
    s1: "Performance snapshot",
    s2: "Pipeline health",
    s3: "Appointment log",
    s4: "Ad performance",
    s5: "Why leads were marked lost",
    head: (c: string) => `${c}  ·  CSM CHECK-IN REPORT`,
    meta: (d: string, per: string) =>
      `Report date: ${d}  |  Period: ${per}  |  Prepared by: Mahara Media`,
    snapcols: ["Metric", "Value", "Notes"],
    stalerow: "Appointments with no outcome",
    nosheet:
      "We could not read your tracking sheet for this period, so the table below is empty rather than wrong. Nothing here should be read as a result until the sheet is connected and filled in.",
    apptcols: ["Added", "Appointment", "Lead", "Outcome", "From ad"],
    adcols: ["Ad", "Leads", "Booked", "Attended", "Did not attend", "Closed"],
    lostcols: ["Reason", "Leads", "What they told us"],
    lostintro: (n: number, t: number) =>
      `${t} leads are marked lost in the CRM. Here is why, from the notes your team wrote at the time, across the ${n} most recent.`,
    noout: "outcome not filled in",
    attended: "attended",
    didnot: "did not attend",
    closed: "closed",
    title: (c: string, m: string) => `${c} · performance report, ${m}`,
    need: "What we need from you",
    ads: "What is running right now",
    rows: [
      ["Enquiries", "leads"],
      ["Appointments booked", "booked"],
      ["Attended", "shows"],
      ["Did not attend", "noshows"],
      ["Quotations given", "quotes"],
      ["Projects closed", "closes"],
    ],
    unfilled: (n: number) =>
      `${n} appointments on the sheet have no outcome filled in. Until they are marked attended or closed they count as nothing happened, both in this report and in how we optimise your budget.`,
    nothingUnfilled:
      "Every appointment on the sheet has an outcome. Thank you, this is what lets us optimise properly.",
    vs: (a: number, b: number) => `${a} vs ${b} last month`,
  },
  ar: {
    s1: "ملخص الأداء",
    s2: "صحة الپايبلاين",
    s3: "سجل المواعيد",
    s4: "أداء الإعلانات",
    s5: "أسباب خروج العملاء المحتملين",
    head: (c: string) => `${c}  ·  تقرير متابعة العملاء`,
    meta: (d: string, per: string) =>
      `تاريخ التقرير: ${d}  |  الفترة: ${per}  |  إعداد: مهارة ميديا`,
    snapcols: ["المؤشر", "القيمة", "ملاحظات"],
    stalerow: "مواعيد بدون نتيجة",
    nosheet:
      "ما قدرنا نقرأ شيت المتابعة لهذي الفترة، فالجدول تحت فاضي مب غلط. لا تعتبرون أي رقم هنا نتيجة لين يتربط الشيت ويتعبى.",
    apptcols: ["أُضيف", "الموعد", "العميل", "النتيجة", "من إعلان"],
    adcols: ["الإعلان", "استفسارات", "مواعيد", "حضروا", "ما حضروا", "تقفلت"],
    lostcols: ["السبب", "العدد", "شنو قالوا"],
    lostintro: (n: number, t: number) =>
      `${t} عميل محتمل مسجلين كخارج بالنظام. هذي الأسباب، من ملاحظات فريقك وقتها، لآخر ${n} حالة.`,
    noout: "النتيجة ما تعبت",
    attended: "حضر",
    didnot: "ما حضر",
    closed: "تقفلت",
    title: (c: string, m: string) => `${c} · تقرير الأداء، ${m}`,
    need: "اللي نحتاجه منك",
    ads: "اللي شغال حالياً",
    rows: [
      ["الاستفسارات", "leads"],
      ["المواعيد المحجوزة", "booked"],
      ["الحضور", "shows"],
      ["ما حضروا", "noshows"],
      ["العروض المقدمة", "quotes"],
      ["المشاريع المتقفلة", "closes"],
    ],
    unfilled: (n: number) =>
      `${n} موعد بالشيت ما فيهم نتيجة. طالما ما تحددون: حضر ولا لا، وتقفل ولا لا، تُحسب كأن ما صار فيها شي، بهذا التقرير وبطريقة تحسيننا لميزانيتك.`,
    nothingUnfilled:
      "كل المواعيد بالشيت فيها نتيجة. شكراً لك، هذا اللي يخلينا نحسّن بشكل صحيح.",
    vs: (a: number, b: number) => `${a} مقابل ${b} الشهر الماضي`,
  },
};

const NARRATIVE_PROMPT = `You write monthly client reports for Mahara Media, a marketing agency for construction and design businesses in the Gulf. The reader is the client, a business owner, not a marketer.

Rules:
- Use only the numbers and constraints given. Invent nothing: no results, no dates, no promises, no benchmark claims.
- Plain, confident, specific. No agency jargon, no "synergy", no hype.
- Never call the client a contractor. All money in USD.
- If a number is bad, say it plainly and say what is being done about it. Owning it is what keeps the client.
- Never use an em dash or an en dash. A comma or a full stop, always.
- Write in the requested language, and in Gulf Arabic if that is Arabic, not formal translation Arabic.

Return JSON with:
- "means": 2 to 4 sentences for the client explaining what the numbers say, including the single biggest leak.
- "next": 3 to 5 short lines: what Mahara is doing next, and what the client's own team should change. Derived only from the constraints given.

The data:
`;

const NARRATIVE_SCHEMA = {
  type: "object",
  properties: {
    means: { type: "string" },
    next: { type: "array", items: { type: "string" } },
  },
  required: ["means", "next"],
};

const kuwaitNow = () => new Date(Date.now() + 3 * 3600_000);
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const kuwaitMonth = () => {
  const d = kuwaitNow();
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const kuwaitToday = () => {
  const d = kuwaitNow();
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, "0")}, ${d.getUTCFullYear()}`;
};

const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : null);
const nums = (o: Any): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(o ?? {}))
    if (typeof v === "number") out[k] = Math.trunc(v);
  return out;
};

/** Which month the report is about, plus what to compare it to. */
function reportingPeriod(
  perf: Any,
): [Record<string, number>, Record<string, number>, string] {
  const m = nums(perf?.month);
  const l = nums(perf?.lastMonth);
  const a = nums(perf?.allTime);
  if (!(m.leads ?? 0) && !(m.booked ?? 0) && (l.leads ?? 0) > 0)
    return [l, {}, String(perf?.lastMonthLabel ?? "")];
  if (!(m.leads ?? 0) && !(l.leads ?? 0) && (a.leads ?? 0) > 0)
    return [a, {}, "since start"];
  return [m, l, String(perf?.monthLabel ?? kuwaitMonth())];
}

function constraintsFor(profile: Any): string[] {
  const perf = profile?.performance ?? {};
  const m = nums(perf.month);
  const l = nums(perf.lastMonth);
  const leads = (m.leads ?? 0) + (l.leads ?? 0);
  const booked = (m.booked ?? 0) + (l.booked ?? 0);
  const shows = (m.shows ?? 0) + (l.shows ?? 0);
  const noshows = (m.noshows ?? 0) + (l.noshows ?? 0);
  const closes = (m.closes ?? 0) + (l.closes ?? 0);
  if (leads === 0)
    return [
      "there is no readable appointment data for this client yet, so no stage of the funnel can be judged, and the report must say exactly that rather than imply the funnel is healthy",
    ];
  const out: string[] = [];
  const br = pct(booked, leads);
  const sr = pct(shows, shows + noshows);
  const cr = pct(closes, shows);
  if (perf.staleCount)
    out.push(
      `${perf.staleCount} appointments have no outcome filled in on their sheet, we are optimising half blind until they are marked`,
    );
  if (br !== null && leads >= 10 && br < GATES.bookingRate)
    out.push(
      `only ${br}% of enquiries became appointments (target ${GATES.bookingRate}%), speed to lead and follow-up on the client's side, not the ads`,
    );
  if (sr !== null && shows + noshows >= 8 && sr < GATES.showRate)
    out.push(
      `show rate ${sr}% (target ${GATES.showRate}%), book same or next day and confirm twice, once at booking and once the morning of`,
    );
  if (cr !== null && shows >= 5 && cr < GATES.closeRate)
    out.push(
      `close rate ${cr}% of attended (target ${GATES.closeRate} to 30%), review two call recordings before blaming lead quality`,
    );
  if (!out.length)
    out.push(
      "every measurable stage is at or above target, the constraint is budget and capacity, not the funnel",
    );
  return out;
}

async function narrative(profile: Any, language: Lang, note?: string) {
  const perf = profile?.performance ?? {};
  const [period, previous, label] = reportingPeriod(perf);
  const payload = {
    client: profile?.clientName,
    month: label,
    thisMonth: period,
    lastMonth: previous,
    allTime: nums(perf.allTime),
    appointmentsWithNoOutcome: perf.staleCount,
    constraints: constraintsFor(profile),
    csmNote: note ?? "",
    language: language === "ar" ? "Arabic" : "English",
  };
  const res: Any = unwrap(
    await callTool("ai_structured_output", {
      prompt: NARRATIVE_PROMPT + JSON.stringify(payload),
      output_schema: NARRATIVE_SCHEMA,
    }),
  );
  const data = typeof res === "string" ? JSON.parse(res) : res;
  if (!data || !data.means) throw new Error("the model returned nothing");
  return data as { means: string; next: string[] };
}

/** The diagnosis as prose, for when no model is available. Facts only. */
function plainStory(
  profile: Any,
  language: Lang,
): { means: string; next: string[] } {
  const perf = profile?.performance ?? {};
  const [m, l, label] = reportingPeriod(perf);
  const cons = constraintsFor(profile);
  if (language === "ar") {
    const means = `هذا التقرير يغطي ${label}: ${m.leads ?? 0} استفسار، ${m.booked ?? 0} موعد محجوز، ${m.shows ?? 0} حضروا، ${m.closes ?? 0} تقفلت${Object.keys(l).length ? ` (الشهر الماضي: ${l.leads ?? 0} استفسار، ${l.booked ?? 0} موعد)` : ""}.`;
    return { means, next: cons.map(c => c) };
  }
  const means = `This report covers ${label}: ${m.leads ?? 0} enquiries, ${m.booked ?? 0} appointments booked, ${m.shows ?? 0} attended, ${m.closes ?? 0} closed${Object.keys(l).length ? ` (last month: ${l.leads ?? 0} enquiries, ${l.booked ?? 0} booked)` : ""}. The main constraint right now: ${cons[0]}.`;
  return { means, next: cons.map(c => c.charAt(0).toUpperCase() + c.slice(1)) };
}

function outcomeOf(row: Any, L: Any): string {
  if (
    String(row?.closed ?? "")
      .trim()
      .toUpperCase()
      .startsWith("Y")
  )
    return L.closed;
  const show = String(row?.show ?? "")
    .trim()
    .toUpperCase();
  if (show.startsWith("Y")) return L.attended;
  if (show.startsWith("N")) return L.didnot;
  return L.noout;
}

type Seg = [string, "h1" | "h2" | "h3" | "meta" | "body" | "bullet"];
type Block = ["text", Seg[]] | ["table", string[][]];

function blocksFor(
  profile: Any,
  language: Lang,
  story: { means: string; next: string[] },
  note: string | undefined,
  extras: string[],
  spend?: { spend: number; cpl?: number; account?: string },
): Block[] {
  const L = LABELS[language];
  const perf = profile?.performance ?? {};
  const [m, l, monthLabel] = reportingPeriod(perf);
  let n = 0;
  const head = (key: string) => `${++n}.  ${L[key]}`;
  const blocks: Block[] = [
    [
      "text",
      [
        [L.head(profile?.clientName ?? ""), "h1"],
        [L.meta(kuwaitToday(), monthLabel), "meta"],
      ],
    ],
    ["text", [[head("s1"), "h2"]]],
  ];
  const noData = !(m.leads ?? 0) && !(nums(perf.allTime).leads ?? 0);
  if (noData) blocks.push(["text", [[L.nosheet, "body"]]]);
  const snap: string[][] = [L.snapcols];
  for (const [label, key] of L.rows as [string, string][]) {
    const noteCell = Object.keys(l).length
      ? L.vs(m[key] ?? 0, l[key] ?? 0)
      : "";
    snap.push([label, String(m[key] ?? 0), noteCell]);
  }
  if (spend?.spend) {
    snap.push([
      "Amount spent on ads",
      `$${spend.spend.toFixed(2)} USD`,
      spend.account ?? "",
    ]);
    if (spend.cpl)
      snap.push([
        "Cost per lead",
        `$${spend.cpl.toFixed(2)} USD`,
        "Ad spend / leads",
      ]);
  }
  const stale = Number(perf.staleCount ?? 0);
  snap.push([L.stalerow, String(stale), L.noout]);
  blocks.push(["table", snap]);

  const segs: Seg[] = [
    [head("s2"), "h2"],
    [String(story.means ?? "").trim(), "body"],
  ];
  for (const line of story.next ?? [])
    segs.push([String(line).trim(), "bullet"]);
  segs.push([L.need, "h3"]);
  segs.push([stale ? L.unfilled(stale) : L.nothingUnfilled, "body"]);
  blocks.push(["text", segs]);

  const rows: Any[] = [...(perf.recent ?? [])].reverse();
  if (extras.includes("appointments") && rows.length) {
    blocks.push(["text", [[head("s3"), "h2"]]]);
    const log: string[][] = [L.apptcols];
    for (const r of rows.slice(-25))
      log.push([
        String(r.added ?? ""),
        String(r.appDate ?? ""),
        String(r.name ?? ""),
        outcomeOf(r, L),
        String(r.ad ?? r.source ?? ""),
      ]);
    blocks.push(["table", log]);
  }

  const byAd: Any[] =
    (monthLabel === "since start" ? perf.byAdAllTime : undefined) ??
    perf.byAd ??
    [];
  if (extras.includes("byAd") && byAd.length) {
    blocks.push(["text", [[head("s4"), "h2"]]]);
    const table: string[][] = [L.adcols];
    for (const a of byAd)
      table.push([
        String(a.ad ?? ""),
        String(a.leads ?? 0),
        String(a.booked ?? 0),
        String(a.shows ?? 0),
        String(a.noshows ?? 0),
        String(a.closes ?? 0),
      ]);
    blocks.push(["table", table]);
  }

  const lost = profile?.lost ?? {};
  if (extras.includes("lost") && (lost.reasons ?? []).length) {
    const leads: Any[] = lost.leads ?? [];
    blocks.push([
      "text",
      [
        [head("s5"), "h2"],
        [L.lostintro(leads.length, lost.total ?? leads.length), "body"],
      ],
    ]);
    const table: string[][] = [L.lostcols];
    for (const r of lost.reasons) {
      const reason = String(r.reason ?? "").replace(/\s*\(Write why.*\)/, "");
      const notes = leads
        .filter(x => x.reason === r.reason && String(x.note ?? "").trim())
        .map(x => String(x.note).trim());
      table.push([
        reason,
        String(r.count ?? 0),
        notes.slice(0, 3).join(" · ").slice(0, 400),
      ]);
    }
    blocks.push(["table", table]);
  }

  if (extras.includes("ads") && (profile?.ads ?? []).length) {
    const s: Seg[] = [[L.ads, "h2"]];
    for (const c of profile.ads) {
      const live = (c.adsets ?? []).reduce(
        (k: number, st: Any) =>
          k +
          (st.ads ?? []).filter((a: Any) =>
            /active/i.test(String(a.status ?? "")),
          ).length,
        0,
      );
      s.push([`${c.campaign ?? ""} · ${live} ads live`, "bullet"]);
    }
    blocks.push(["text", s]);
  }
  if (note)
    blocks.push([
      "text",
      [[`CSM note (delete before sending): ${note}`, "body"]],
    ]);
  return blocks;
}

// --- Google Docs --------------------------------------------------------------------

async function gapi(url: string, init: RequestInit = {}): Promise<Any> {
  const token = await googleAccessToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      `${init.method ?? "GET"} ${url.replace(/\?.*$/, "").slice(-60)} ${res.status}: ${String(json?.error?.message ?? "").slice(0, 200)}`,
    );
  return json;
}

async function batch(docId: string, requests: Any[]) {
  for (let i = 0; i < requests.length; i += 400)
    await gapi(
      `https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`,
      {
        method: "POST",
        body: JSON.stringify({ requests: requests.slice(i, i + 400) }),
      },
    );
}

const document = (docId: string) =>
  gapi(`https://docs.googleapis.com/v1/documents/${docId}`);

function tableShell(tableStart: number, rows: number, cols: number): Any[] {
  const loc = { index: tableStart };
  const band = (i: number, n: number, colour: Any) => ({
    updateTableCellStyle: {
      tableRange: {
        tableCellLocation: {
          tableStartLocation: loc,
          rowIndex: i,
          columnIndex: 0,
        },
        rowSpan: n,
        columnSpan: cols,
      },
      tableCellStyle: {
        backgroundColor: { color: { rgbColor: colour } },
        paddingTop: { magnitude: 5, unit: "PT" },
        paddingBottom: { magnitude: 5, unit: "PT" },
        paddingLeft: { magnitude: 7, unit: "PT" },
        paddingRight: { magnitude: 7, unit: "PT" },
      },
      fields:
        "backgroundColor,paddingTop,paddingBottom,paddingLeft,paddingRight",
    },
  });
  const reqs: Any[] = [band(0, 1, NAVY)];
  for (let r = 2; r < rows; r += 2) reqs.push(band(r, 1, BAND));
  const hairline = {
    color: { color: { rgbColor: RULE } },
    width: { magnitude: 0.5, unit: "PT" },
    dashStyle: "SOLID",
  };
  reqs.push({
    updateTableCellStyle: {
      tableStartLocation: loc,
      tableCellStyle: {
        borderTop: hairline,
        borderBottom: hairline,
        borderLeft: hairline,
        borderRight: hairline,
      },
      fields: "borderTop,borderBottom,borderLeft,borderRight",
    },
  });
  return reqs;
}

async function appendTable(docId: string, rows: string[][], rtl: boolean) {
  if (!rows.length) return;
  const width = Math.max(...rows.map(r => r.length));
  await batch(docId, [
    {
      insertTable: {
        endOfSegmentLocation: {},
        rows: rows.length,
        columns: width,
      },
    },
  ]);
  const doc = await document(docId);
  const tables = (doc.body?.content ?? []).filter((el: Any) => el.table);
  if (!tables.length)
    throw new Error("the table was inserted but cannot be found");
  const last = tables[tables.length - 1];
  const table = last.table;
  const reqs: Any[] = tableShell(last.startIndex, rows.length, width);
  // Cells are written last cell first: an insert shifts every index after it.
  for (let r = rows.length - 1; r >= 0; r--) {
    const cells = table.tableRows[r].tableCells;
    for (let c = Math.min(width, cells.length) - 1; c >= 0; c--) {
      const text = humanise(rows[r][c] ?? "", rtl);
      if (!text) continue;
      const at = cells[c].content[0].startIndex;
      reqs.push({ insertText: { location: { index: at }, text } });
      const rng = { startIndex: at, endIndex: at + text.length };
      reqs.push({
        updateTextStyle: {
          range: rng,
          textStyle: {
            weightedFontFamily: { fontFamily: "Inter" },
            fontSize: { magnitude: 10, unit: "PT" },
            bold: r === 0 || c === 0,
            foregroundColor: { color: { rgbColor: r === 0 ? WHITE : INK } },
          },
          fields: "weightedFontFamily,fontSize,bold,foregroundColor",
        },
      });
      reqs.push({
        updateParagraphStyle: {
          range: rng,
          paragraphStyle: {
            direction: rtl ? "RIGHT_TO_LEFT" : "LEFT_TO_RIGHT",
            alignment: rtl ? "END" : "START",
          },
          fields: "direction,alignment",
        },
      });
    }
  }
  await batch(docId, reqs);
}

function styleRequests(segs: Seg[], start: number, rtl: boolean): Any[] {
  const reqs: Any[] = [];
  const bullets: Any[] = [];
  let idx = start;
  for (const [t, kind] of segs) {
    const rng = { startIndex: idx, endIndex: idx + t.length };
    idx += t.length + 1;
    const para: Any = {
      direction: rtl ? "RIGHT_TO_LEFT" : "LEFT_TO_RIGHT",
      alignment: rtl ? "END" : "START",
      lineSpacing: 115,
    };
    let fieldsP =
      "namedStyleType,direction,alignment,spaceAbove,spaceBelow,lineSpacing";
    let style: Any;
    let fields: string;
    if (kind === "body" || kind === "bullet" || kind === "meta") {
      para.namedStyleType = "NORMAL_TEXT";
      para.spaceAbove = { magnitude: kind === "bullet" ? 0 : 6, unit: "PT" };
      para.spaceBelow = { magnitude: kind === "bullet" ? 4 : 8, unit: "PT" };
      style = {
        weightedFontFamily: { fontFamily: "Inter" },
        fontSize: { magnitude: kind === "meta" ? 9 : 11, unit: "PT" },
        foregroundColor: { color: { rgbColor: kind === "meta" ? MUTED : INK } },
        italic: false,
        bold: false,
      };
      fields = "weightedFontFamily,fontSize,foregroundColor,italic,bold";
      if (kind === "meta") {
        para.borderBottom = {
          color: { color: { rgbColor: CYAN } },
          width: { magnitude: 1.5, unit: "PT" },
          padding: { magnitude: 6, unit: "PT" },
          dashStyle: "SOLID",
        };
        para.spaceBelow = { magnitude: 18, unit: "PT" };
        fieldsP += ",borderBottom";
      }
      if (kind === "bullet")
        bullets.push({
          createParagraphBullets: {
            range: rng,
            bulletPreset: "BULLET_DISC_CIRCLE_SQUARE",
          },
        });
    } else {
      para.namedStyleType = { h1: "TITLE", h2: "HEADING_2", h3: "HEADING_3" }[
        kind
      ];
      para.spaceAbove = {
        magnitude: { h1: 0, h2: 22, h3: 14 }[kind],
        unit: "PT",
      };
      para.spaceBelow = {
        magnitude: { h1: 4, h2: 8, h3: 4 }[kind],
        unit: "PT",
      };
      style = {
        weightedFontFamily: { fontFamily: "Inter" },
        fontSize: { magnitude: { h1: 26, h2: 15, h3: 12 }[kind], unit: "PT" },
        bold: true,
        italic: false,
        foregroundColor: { color: { rgbColor: kind === "h3" ? CYAN : NAVY } },
      };
      fields = "weightedFontFamily,fontSize,bold,italic,foregroundColor";
    }
    reqs.push({
      updateParagraphStyle: {
        range: rng,
        paragraphStyle: para,
        fields: fieldsP,
      },
    });
    reqs.push({ updateTextStyle: { range: rng, textStyle: style, fields } });
  }
  return [...reqs, ...bullets];
}

async function appendText(docId: string, segsIn: Seg[], rtl: boolean) {
  const segs = segsIn
    .map(([t, k]) => [humanise(t, rtl), k] as Seg)
    .filter(([t]) => t.length > 0);
  if (!segs.length) return;
  const doc = await document(docId);
  const content: Any[] = doc.body?.content ?? [];
  const start = content.length
    ? Math.max(...content.map((el: Any) => Number(el.endIndex ?? 1))) - 1
    : 1;
  const text = segs.map(([t]) => `${t}\n`).join("");
  await batch(docId, [
    { insertText: { location: { index: start }, text } },
    ...styleRequests(segs, start, rtl),
  ]);
}

async function setDocumentStyle(docId: string) {
  await batch(docId, [
    {
      updateDocumentStyle: {
        documentStyle: {
          marginTop: { magnitude: 54, unit: "PT" },
          marginBottom: { magnitude: 54, unit: "PT" },
          marginLeft: { magnitude: 64, unit: "PT" },
          marginRight: { magnitude: 64, unit: "PT" },
        },
        fields: "marginTop,marginBottom,marginLeft,marginRight",
      },
    },
  ]);
}

/**
 * Create the empty doc. Inside the client's own Drive folder when the
 * service account may write there; otherwise in its own Drive, shared with
 * the team. Either way the link opens for everyone on SHARE_WITH.
 */
async function createDoc(title: string, folderId?: string): Promise<string> {
  const meta: Any = {
    name: title,
    mimeType: "application/vnd.google-apps.document",
  };
  if (folderId) {
    try {
      const f = await gapi(
        "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id",
        {
          method: "POST",
          body: JSON.stringify({ ...meta, parents: [folderId] }),
        },
      );
      return String(f.id);
    } catch (e) {
      console.warn(
        `report: client folder not writable, using the service account's Drive: ${String(e).slice(0, 100)}`,
      );
    }
  }
  const f = await gapi("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    body: JSON.stringify(meta),
  });
  return String(f.id);
}

async function share(docId: string) {
  for (const email of SHARE_WITH) {
    try {
      await gapi(
        `https://www.googleapis.com/drive/v3/files/${docId}/permissions?sendNotificationEmail=false&supportsAllDrives=true`,
        {
          method: "POST",
          body: JSON.stringify({
            role: "writer",
            type: "user",
            emailAddress: email,
          }),
        },
      );
    } catch (e) {
      console.warn(
        `report: could not share with ${email}: ${String(e).slice(0, 100)}`,
      );
    }
  }
  try {
    await gapi(
      `https://www.googleapis.com/drive/v3/files/${docId}/permissions?supportsAllDrives=true`,
      {
        method: "POST",
        body: JSON.stringify({ role: "reader", type: "anyone" }),
      },
    );
  } catch (e) {
    console.warn(`report: link sharing failed: ${String(e).slice(0, 100)}`);
  }
}

// --- Spend for the reported month, from this deployment's own grain --------------

export const monthSpend = internalQuery({
  args: { clientName: v.string(), since: v.string(), until: v.string() },
  returns: v.any(),
  handler: async (ctx, { clientName, since, until }) => {
    const key = normTight(clientName);
    const campaigns = (await ctx.db.query("campaigns").collect()).filter(
      (c: Any) =>
        (c.clientName && normTight(c.clientName) === key) ||
        (c.clientTag && c.clientTag === key) ||
        (c.tags ?? []).includes(key),
    );
    if (!campaigns.length) return null;
    const names = new Set(campaigns.map((c: Any) => c.campaignName));
    let spend = 0;
    let leads = 0;
    for (const d of await ctx.db.query("dailyStats").collect()) {
      if (!names.has(d.campaignName) || d.date < since || d.date > until)
        continue;
      spend += Number(d.spend ?? 0);
      leads += Number(d.leads ?? 0);
    }
    return {
      spend: Math.round(spend * 100) / 100,
      cpl: leads ? Math.round((spend / leads) * 100) / 100 : undefined,
      account: campaigns[0].accountName,
    };
  },
});

function monthRange(perf: Any, label: string): [string, string] {
  const today = kuwaitNow();
  const first = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
  );
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (label && label === perf?.lastMonthLabel) {
    const lastPrev = new Date(first.getTime() - 86400_000);
    const firstPrev = new Date(
      Date.UTC(lastPrev.getUTCFullYear(), lastPrev.getUTCMonth(), 1),
    );
    return [iso(firstPrev), iso(lastPrev)];
  }
  return [iso(first), iso(today)];
}

// --- The drain ------------------------------------------------------------------------

/** Every pending report in the Client Success app, built and written back. */
export const drain = internalAction({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<unknown> => {
    const pending: Any[] = (await bridge("csm", "pendingReports", {})) ?? [];
    if (!pending.length) return { built: 0 };
    let rows: Any[] = [];
    try {
      rows = await readClientData();
    } catch {
      // no folder placement, the doc still gets written
    }
    const done: string[] = [];
    const failed: string[] = [];
    for (const r of pending) {
      try {
        const profile = await bridge("csm", "profileFor", {
          clientName: r.clientName,
        });
        if (!profile) throw new Error("no stored profile for this client yet");
        const language: Lang = r.language === "ar" ? "ar" : "en";
        const extras: string[] =
          Array.isArray(r.extras) && r.extras.length ? r.extras : EXTRAS;
        let story: { means: string; next: string[] };
        try {
          story = await narrative(profile, language, r.note ?? undefined);
        } catch (e) {
          // No model (no key, or it failed): the doc still ships, with the
          // diagnosis written plainly from the numbers. The CSM edits it anyway.
          console.warn(
            `report: narrative fell back to the diagnosis: ${String(e).slice(0, 120)}`,
          );
          story = plainStory(profile, language);
        }
        const perf = profile.performance ?? {};
        const label = reportingPeriod(perf)[2];
        let spend: Any;
        if (extras.includes("byAd")) {
          try {
            const [since, until] = monthRange(perf, label);
            spend = await ctx.runQuery(internal.reportDocs.monthSpend, {
              clientName: String(r.clientName),
              since,
              until,
            });
          } catch (e) {
            console.warn(
              `report: spend unavailable: ${String(e).slice(0, 100)}`,
            );
          }
        }
        const blocks = blocksFor(
          profile,
          language,
          story,
          r.note ?? undefined,
          extras,
          spend ?? undefined,
        );
        const title = LABELS[language].title(String(r.clientName), label);
        const folder = clientDataFor(
          rows,
          String(r.clientName),
          profile.taskId,
        )?.driveLink;
        const folderId = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(
          String(folder ?? ""),
        )?.[1];
        const docId = await createDoc(title, folderId);
        const rtl = language === "ar";
        try {
          await setDocumentStyle(docId);
          for (const [kind, payload] of blocks) {
            if (kind === "text") await appendText(docId, payload as Seg[], rtl);
            else await appendTable(docId, payload as string[][], rtl);
          }
        } catch (e) {
          // Never leave a half-written doc in the client's folder.
          await gapi(
            `https://www.googleapis.com/drive/v3/files/${docId}?supportsAllDrives=true`,
            { method: "DELETE" },
          ).catch(() => undefined);
          throw e;
        }
        await share(docId);
        const docUrl = `https://docs.google.com/document/d/${docId}/edit`;
        await bridge("csm", "reportDone", { id: r._id, docUrl });
        done.push(`${r.clientName} ${r.month}`);
      } catch (e) {
        const error = String(e).slice(0, 300);
        failed.push(`${r.clientName}: ${error}`);
        try {
          await bridge("csm", "reportDone", { id: r._id, error });
        } catch {
          // the next drain retries it
        }
      }
    }
    console.log(
      `reports: ${done.length} built, ${failed.length} failed ${failed.join(" | ")}`,
    );
    return { built: done.length, done, failed };
  },
});
