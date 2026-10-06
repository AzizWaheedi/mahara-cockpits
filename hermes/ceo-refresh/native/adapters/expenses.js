import { TRIAGE, B2B, num, sql } from "../sb.js";
import { kuwaitDay } from "../time.js";

const ROUND2 = value => Math.round(value * 100) / 100;
const BANK_STALE_DAYS = 7;
// The cockpit has no complete cash-in rail, so revenue remains a floor and profit stays missing.
const REVENUE_IS_COMPLETE = false;
const UNLOAD = /top\s*up|weyay|payoneer|\bwise\b|western union|remit|\batm\b|cash withdrawal|transfer/i;
const RECLASS_RULES = [
  { code: "bank", label: "Bank charges, card fees and payments to a bank", test: /\b(nbk|kfh|cbk)\b|kuwait finance house|national bank of kuwait|boubyan|gulf bank|burgan|non sufficient|decline fee|control card|ann\.?\s*sub\s*fee/i },
  { code: "course", label: "Courses and communities bought from other people", test: /whop\s*\*|^whop\b|teachable|kajabi|circle\.so/i },
  { code: "personal", label: "Books, audiobooks and personal subscriptions", test: /audible|kindle|netflix|spotify|apple\.com\/bill/i },
];
const OVERHEAD_RULES = [
  { label: "Rent and office", test: /\brent\b|\boffice\b|real estate|leasing/i },
  { label: "Utilities", test: /electric|water auth|ministry of electricity|\bmew\b/i },
  { label: "Phone and internet", test: /\bzain\b|ooredoo|\bstc\b|\bviva\b|telecom|broadband/i },
  { label: "Insurance", test: /insurance|takaful/i },
  { label: "Accounting, legal, licences and government fees", test: /accounting|accountant|auditor?\b|\blegal\b|law firm|ministry|municipal|\bpaci\b|licen[cs]e|government|visa fee/i },
];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function value(row, ...names) {
  for (const name of names) if (row?.[name] !== undefined) return row[name];
  return undefined;
}

function day(value) {
  const text = String(value ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : text.slice(0, 10);
}

function timestamp(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function clean(value, max = 160) {
  return String(value ?? "").replace(/https?:\/\/\S+/gi, "[link]").replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]").replace(/\+?\d[\d\s-]{6,}\d/g, "[number]").replace(/[—–]/g, ", ").replace(/\s+/g, " ").trim().slice(0, max);
}

function fail(name, detail) {
  throw new Error(`${name} is not confirmed: ${detail}`);
}

function normalizeLine(row) {
  const sourceCategory = String(value(row, "category") ?? "uncategorised").trim().toLowerCase() || "uncategorised";
  const category = sourceCategory === "ads" ? "ad_spend" : sourceCategory === "labour" ? "salaries" : sourceCategory;
  return {
    id: num(value(row, "id")),
    day: day(value(row, "day")),
    amount: num(value(row, "amount")),
    usd: num(value(row, "usd")),
    reference: clean(value(row, "reference"), 160),
    account: clean(value(row, "account"), 80),
    kind: String(value(row, "kind") ?? "unknown"),
    category,
    note: value(row, "note") == null ? null : clean(value(row, "note"), 200),
  };
}

function exclusionsFor(line, exclusions) {
  for (const rule of exclusions) {
    if (value(rule, "removed_at", "removedAt")) continue;
    const pattern = String(value(rule, "pattern") ?? "").trim().toLowerCase();
    if (!pattern) continue;
    if (value(rule, "kind") === "card" && line.account.toLowerCase() === pattern) return rule;
    if (value(rule, "kind") === "vendor" && line.reference.toLowerCase().includes(pattern)) return rule;
  }
  return null;
}

function reportGroup(lines, category, monthName, excludedLines) {
  const rows = lines.filter(line => line.category === category);
  const kept = rows.filter(line => !excludedLines.has(line.id) && !line.reclass && !line.overhead);
  const moved = rows.filter(line => excludedLines.has(line.id) || line.reclass || line.overhead);
  const amount = ROUND2(kept.reduce((sum, line) => sum + Math.abs(line.usd), 0));
  if (!rows.length) return {
    amount: null, headline: null, excluded: [], vendors: [], quality: "missing",
    why: `The bank statement has no ${category} lines for ${monthName}; this category is missing, not zero.`,
  };
  const excluded = new Map();
  for (const line of moved) {
    const label = line.overhead ? `Moved to overhead: ${line.overhead}` : line.reclass?.label ?? "Manually excluded bank line";
    excluded.set(label, (excluded.get(label) ?? 0) + Math.abs(line.usd));
  }
  return {
    amount,
    headline: ROUND2(rows.reduce((sum, line) => sum + Math.abs(line.usd), 0)),
    excluded: [...excluded].map(([label, value]) => ({ label, amount: ROUND2(value) })).sort((a, b) => b.amount - a.amount),
    vendors: kept.map(line => ({ vendor: line.reference || "(no payee)", amount: ROUND2(Math.abs(line.usd)), rows: 1, category: line.category, reclass: null })).sort((a, b) => b.amount - a.amount),
    quality: kept.length && kept.every(line => line.railPayee) && category === "salaries" ? "floor" : "measured",
    why: `Amounts use classified bank statement lines for ${monthName}. Human exclusions and source classification remain visible and unchanged.`,
  };
}

export function createExpensesAdapter(snapshot) {
  return {
    key: "expenses",
    label: "Expenses and P&L",
    compute: async () => {
      if (!snapshot || snapshot.history_ready !== true || snapshot.manual_ready !== true) fail("Canonical finance history", "manual payment history or bank classification is not reconciled");
      const statements = Array.isArray(snapshot.statements) ? snapshot.statements : [];
      const sourceLines = Array.isArray(snapshot.bank_lines) ? snapshot.bank_lines : [];
      const exclusions = Array.isArray(snapshot.exclusions) ? snapshot.exclusions : [];
      if (!statements.length) fail("Bank statements", "no canonical statement has been imported");
      const normalizedStatements = statements.map(row => ({
        id: String(value(row, "id")), toDay: day(value(row, "to_day", "toDay")), importedAt: timestamp(value(row, "imported_at", "importedAt")),
      }));
      const latestStatement = normalizedStatements.filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.toDay)).sort((a, b) => b.toDay.localeCompare(a.toDay))[0];
      if (!latestStatement) fail("Bank statements", "the newest statement has no verified end date");
      const today = kuwaitDay();
      const statementAge = Math.round((Date.parse(today) - Date.parse(latestStatement.toDay)) / 86_400_000);
      if (statementAge < 0 || statementAge > BANK_STALE_DAYS) fail("Bank statements", `the newest statement ends ${latestStatement.toDay}, ${statementAge} days ago`);
      const month = latestStatement.toDay.slice(0, 7);
      const monthName = `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
      const allLines = sourceLines.map(normalizeLine).filter(line => line.day.slice(0, 7) <= month);
      const monthLines = allLines.filter(line => line.day.slice(0, 7) === month && line.usd < 0 && ["expense", "fee", "excluded"].includes(line.kind));
      const excludedLines = new Set();
      for (const line of monthLines) {
        if (line.kind === "excluded" || exclusionsFor(line, exclusions)) excludedLines.add(line.id);
        line.reclass = RECLASS_RULES.find(rule => rule.test.test(line.reference)) ?? null;
        line.overhead = line.reclass ? null : OVERHEAD_RULES.find(rule => rule.test.test(line.reference))?.label ?? null;
        line.railPayee = UNLOAD.test(line.reference);
      }
      const excludedUsd = ROUND2([...excludedLines].reduce((sum, id) => sum + Math.abs(monthLines.find(line => line.id === id)?.usd ?? 0), 0));
      const unloads = ROUND2(allLines.filter(line => line.day.slice(0, 7) === month && line.kind === "own_transfer" && UNLOAD.test(line.reference)).reduce((sum, line) => sum + Math.abs(line.usd), 0));
      const rawTotal = ROUND2(monthLines.reduce((sum, line) => sum + Math.abs(line.usd), 0));
      const total = ROUND2(rawTotal + unloads);
      const spend = ROUND2(rawTotal - excludedUsd);
      const kept = monthLines.filter(line => !excludedLines.has(line.id));
      const [revenueRows, adRows, eodRows] = await Promise.all([
        sql(B2B, `/* ceo-refresh:expenses.revenue */ SELECT coalesce(sum(net_amount),0) AS revenue,floor(extract(epoch FROM max(synced_at))*1000)::bigint AS synced_ms FROM public.whop_payments WHERE status='paid' AND currency='usd' AND paid_on>=date '${month}-01' AND paid_on<date '${month}-01'+interval '1 month'`),
        sql(TRIAGE, `/* ceo-refresh:expenses.client_ads */ SELECT coalesce(sum(a.spend),0) AS spend,count(DISTINCT a.client_id) AS clients,coalesce(sum(a.spend) FILTER (WHERE lower(replace(coalesce(c.name,''),' ',''))='maharamedia'),0) AS own_spend,count(DISTINCT a.client_id) FILTER (WHERE lower(replace(coalesce(c.name,''),' ',''))='maharamedia') AS own_clients,floor(extract(epoch FROM max(a.last_synced_at))*1000)::bigint AS synced_ms FROM public.ads_daily_snapshots a LEFT JOIN public.clients c ON c.id=a.client_id WHERE a.date>=date '${month}-01' AND a.date<date '${month}-01'+interval '1 month'`),
        sql(B2B, `/* ceo-refresh:expenses.eods */ SELECT count(DISTINCT lower(btrim(person_name))) AS people FROM public.eod_reports WHERE report_date>=date '${month}-01' AND report_date<date '${month}-01'+interval '1 month' AND nullif(btrim(person_name),'') IS NOT NULL`),
      ]);
      const revenue = revenueRows[0] ? ROUND2(num(revenueRows[0].revenue)) : null;
      const whopAt = timestamp(revenueRows[0]?.synced_ms);
      if (whopAt === null || Date.now() - whopAt > 60 * 60_000) fail("Whop cash source", "the last successful sync is missing or older than one hour");
      const adsAt = timestamp(adRows[0]?.synced_ms);
      if (adsAt === null || Date.now() - adsAt > 3 * 60 * 60_000) fail("Client ad snapshots", "the last successful snapshot is missing or older than three hours");
      if (!adRows[0]) fail("Client ad snapshots", "query returned no row");
      const clientAdSpend = { amount: ROUND2(num(adRows[0].spend) - num(adRows[0].own_spend)), clients: num(adRows[0].clients) - num(adRows[0].own_clients) };
      const peopleFilingEods = eodRows[0] ? num(eodRows[0].people) : null;

      const software = reportGroup(kept, "software", monthName, excludedLines);
      const labour = reportGroup(kept, "salaries", monthName, excludedLines);
      const ownAdSpend = reportGroup(kept, "ad_spend", monthName, excludedLines);
      const overheadRows = kept.filter(line => line.overhead);
      const overhead = overheadRows.length ? {
        amount: ROUND2(overheadRows.reduce((sum, line) => sum + Math.abs(line.usd), 0)),
        headline: ROUND2(overheadRows.reduce((sum, line) => sum + Math.abs(line.usd), 0)),
        excluded: [], vendors: overheadRows.map(line => ({ vendor: line.reference || "(no payee)", amount: ROUND2(Math.abs(line.usd)), rows: 1, category: line.category, reclass: null })),
        quality: "measured", why: "Overhead is matched to the payee on the classified bank statement line.",
      } : { amount: null, headline: null, excluded: [], vendors: [], quality: "missing", why: `No classified rent, utilities, phone, insurance, or accounting line exists for ${monthName}; overhead is missing, not zero.` };

      const byCategoryMap = new Map();
      for (const line of monthLines) {
        const category = line.category;
        const row = byCategoryMap.get(category) ?? { amount: 0, rows: 0 };
        row.amount += Math.abs(line.usd);
        row.rows += 1;
        byCategoryMap.set(category, row);
      }
      const profitComplete = REVENUE_IS_COMPLETE && [software, overhead, labour, ownAdSpend].every(group => group.quality === "measured") && revenue !== null;
      const missingProfit = [software, overhead, labour, ownAdSpend].filter(group => group.quality !== "measured").map(group => group.quality === "floor" ? "a cost group is a known floor" : "a cost group is missing");
      missingProfit.push("cash in is Whop only, which is not complete company revenue");
      const payload = {
        month,
        monthsLoaded: [...new Set(allLines.filter(line => line.usd < 0 && ["expense", "fee", "excluded"].includes(line.kind)).map(line => line.day.slice(0, 7)))].sort(),
        importedAt: latestStatement.importedAt,
        fxUsdPerKwd: null,
        total,
        spend,
        unloads,
        software,
        overhead,
        labour,
        ownAdSpend,
        byCategory: [...byCategoryMap].map(([category, row]) => ({ category, amount: ROUND2(row.amount), rows: row.rows })).sort((a, b) => b.amount - a.amount),
        clientAdSpend,
        revenue,
        profit: profitComplete ? { amount: ROUND2(revenue - spend), margin: revenue > 0 ? Math.round((1 - spend / revenue) * 10_000) / 10_000 : null, why: null } : { amount: null, margin: null, why: `Profit is not drawn for ${monthName} because ${missingProfit.join(" and ")}.` },
        peopleFilingEods,
        notes: [
          { level: "warn", text: `These numbers cover ${monthName}; each classified expense line comes from the current canonical CBK statement snapshot.` },
          { level: "info", text: `${excludedLines.size} bank lines worth $${excludedUsd.toFixed(2)} are excluded by the saved bank classification or human exclusion list.` },
          { level: "info", text: `Client advertising spend of $${clientAdSpend.amount.toFixed(2)} stays separate from Mahara expense lines.` },
        ],
      };
      const sources = [
        { name: "Canonical CBK bank statements and exclusions", freshestAt: latestStatement.importedAt ?? undefined, ok: true, note: `${monthLines.length} classified expense lines in ${month}` },
        { name: "Canonical finance revision", freshestAt: timestamp(snapshot.updated_at) ?? undefined, ok: true, note: `revision ${num(snapshot.revision)}` },
        { name: "Whop revenue source", freshestAt: whopAt, ok: true },
        { name: "Creative Triage client ad snapshots", freshestAt: adsAt, ok: true },
      ];
      const daily = [];
      for (const loadedMonth of payload.monthsLoaded) {
        const date = monthEnd(loadedMonth, today);
        const lines = allLines.filter(line => line.day.slice(0, 7) === loadedMonth && line.usd < 0 && ["expense", "fee", "excluded"].includes(line.kind));
        const rawMonth = ROUND2(lines.reduce((sum, line) => sum + Math.abs(line.usd), 0));
        const monthExcluded = ROUND2(lines.filter(line => excludedLinesForMonth(line, exclusions)).reduce((sum, line) => sum + Math.abs(line.usd), 0));
        const monthUnloads = ROUND2(allLines.filter(line => line.day.slice(0, 7) === loadedMonth && line.kind === "own_transfer" && UNLOAD.test(line.reference)).reduce((sum, line) => sum + Math.abs(line.usd), 0));
        daily.push({ date, metric: "expenses.total", scope: "company", value: ROUND2(rawMonth + monthUnloads) });
        daily.push({ date, metric: "expenses.spend", scope: "company", value: ROUND2(rawMonth - monthExcluded) });
        daily.push({ date, metric: "expenses.unloads", scope: "company", value: monthUnloads });
      }
      const pointDate = monthEnd(month, today);
      for (const [metric, amount] of [["expenses.software", software.amount], ["expenses.overhead", overhead.amount], ["expenses.labour", labour.amount], ["expenses.ownAdSpend", ownAdSpend.amount], ["expenses.clientAdSpend", clientAdSpend.amount], ["expenses.revenue", revenue]]) {
        if (amount !== null) daily.push({ date: pointDate, metric, scope: "company", value: amount });
      }
      return { payload, sources, daily, financeRevision: num(snapshot.revision) };
    },
  };
}

function excludedLinesForMonth(line, exclusions) {
  return line.kind === "excluded" || Boolean(exclusionsFor(line, exclusions));
}

function monthEnd(month, today) {
  const [year, monthNumber] = month.split("-").map(Number);
  const last = `${month}-${String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, "0")}`;
  return last > today ? today : last;
}
