import { useAction, useMutation, useQuery } from "convex/react";
import { Upload } from "lucide-react";
import { type ChangeEvent, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { money, plural } from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatusChip } from "@/components/ceo/StatusChip";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { api } from "../../../convex/_generated/api";

/**
 * Bring a month of bank transfers and cheques in at once.
 *
 * Roughly 40% of Mahara's cash never touches Whop, and none of it is recorded
 * anywhere. Typing it one payment at a time is the reason it never happens, so
 * this takes a bank export or a pasted block from a sheet.
 *
 * Two rules the import will not bend:
 *
 *  1. **Nothing is written until it has been read.** The paste is parsed into a
 *     preview with the client, the day and the amount resolved for every row.
 *     A row that cannot be resolved is shown as a problem, never guessed at.
 *  2. **Every row goes through the same door as a single entry.** The import
 *     calls the ordinary `add` mutation once per row, so the CEO gate, the
 *     currency conversion at write time, the duplicate check, the Tap
 *     double-count guard and the audit row all apply exactly as they do when
 *     one payment is typed in by hand. There is no bulk insert path.
 */

type Rail = "bank_transfer" | "cheque" | "cash" | "tap" | "other";
type Currency = "USD" | "KWD";

const RAILS: { value: Rail; label: string; match: RegExp }[] = [
  {
    value: "bank_transfer",
    label: "Bank transfer",
    match: /bank|transfer|wire|حوالة/i,
  },
  { value: "cheque", label: "Cheque", match: /cheque|check|شيك/i },
  { value: "cash", label: "Cash", match: /^cash|نقد/i },
  { value: "tap", label: "Tap", match: /\btap\b/i },
  { value: "other", label: "Other", match: /^$/ },
];

type Parsed = {
  /** 1-based line in the pasted text, so a problem can be pointed at. */
  line: number;
  day: string;
  amount: number | null;
  currency: Currency;
  clientText: string;
  clickupTaskId: string | null;
  rail: Rail;
  note: string;
  problem: string | null;
};

const fold = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Split a line on tabs, or on commas outside quotes. Handles both a sheet paste and a CSV. */
function splitRow(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map(c => c.trim());
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

/** A date in any of the shapes a bank or a spreadsheet writes, as a Kuwait day. */
function readDay(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    const first = Number(m[1]);
    const second = Number(m[2]);
    // 13/09 can only be day first and 09/13 can only be month first. When both
    // are 12 or under the date is genuinely ambiguous, and day first is taken
    // because that is how banks here and spreadsheets set to this region write
    // it. The card says so, so nobody has to guess what the importer assumed.
    const [d, mo] =
      first > 12
        ? [first, second]
        : second > 12
          ? [second, first]
          : [first, second];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${year}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const t = Date.parse(s);
  if (Number.isFinite(t))
    return new Date(t + 3 * 3600 * 1000).toISOString().slice(0, 10);
  return null;
}

/** An amount with thousands separators, currency symbols or a trailing minus. */
function readAmount(raw: string): number | null {
  const s = raw.replace(/[^\d.,-]/g, "").replace(/,/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n !== 0 ? Math.abs(n) : null;
}

const HEAD = {
  day: /date|day|received|تاريخ/i,
  amount: /amount|value|credit|paid|usd|kwd|مبلغ/i,
  client: /client|name|customer|payer|description|عميل|بيان/i,
  rail: /rail|method|type|channel|طريقة/i,
  note: /note|ref|reference|remark|ملاح/i,
};

/**
 * Parse pasted text into rows.
 *
 * Columns are found by their header when the first line looks like one, and
 * otherwise by position, which is the order a bank export almost always uses:
 * date, amount, description. Nothing is inferred silently: a row whose day or
 * amount cannot be read carries the reason with it.
 */
function parse(
  text: string,
  clients: { name: string; clickupTaskId: string }[],
  defaultCurrency: Currency,
): Parsed[] {
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const first = splitRow(lines[0]);
  const looksLikeHeader =
    first.some(c => HEAD.day.test(c)) && first.some(c => HEAD.amount.test(c));
  const col = { day: 0, amount: 1, client: 2, rail: -1, note: -1 };
  if (looksLikeHeader) {
    first.forEach((c, i) => {
      if (HEAD.day.test(c) && col.day === 0) col.day = i;
      if (HEAD.amount.test(c)) col.amount = i;
      if (HEAD.client.test(c)) col.client = i;
      if (HEAD.rail.test(c)) col.rail = i;
      if (HEAD.note.test(c)) col.note = i;
    });
  }

  const byName = clients.map(c => ({ ...c, key: fold(c.name) }));
  const body = looksLikeHeader ? lines.slice(1) : lines;

  return body.map((line, i) => {
    const cells = splitRow(line);
    const at = (n: number) => (n >= 0 && n < cells.length ? cells[n] : "");
    const day = readDay(at(col.day));
    const amount = readAmount(at(col.amount));
    const clientText = at(col.client);
    const railText = col.rail >= 0 ? at(col.rail) : line;
    const rail =
      RAILS.find(r => r.value !== "other" && r.match.test(railText))?.value ??
      "bank_transfer";

    const key = fold(clientText);
    let hit = key ? byName.find(c => c.key === key) : undefined;
    if (!hit && key.length >= 4)
      hit = byName.find(c => c.key.includes(key) || key.includes(c.key));

    const problem = !day
      ? `Could not read a date from "${at(col.day) || "(empty)"}"`
      : !amount
        ? `Could not read an amount from "${at(col.amount) || "(empty)"}"`
        : !clientText
          ? "No client on this row"
          : !hit
            ? `No client card matches "${clientText}"`
            : null;

    return {
      line: i + 1 + (looksLikeHeader ? 1 : 0),
      day: day ?? "",
      amount,
      currency: defaultCurrency,
      clientText,
      clickupTaskId: hit?.clickupTaskId ?? null,
      rail,
      note: col.note >= 0 ? at(col.note).slice(0, 200) : "",
      problem,
    };
  });
}

type Result = { line: number; ok: boolean; message: string };

export function ImportPaymentsCard({ order }: { order?: number }) {
  const clients = useQuery(api.ceo.manualPayments.clientOptions, {}) ?? [];
  const info = useQuery(api.ceo.manualPayments.formInfo, {});
  const add = useMutation(api.ceo.manualPayments.add);

  const [text, setText] = useState("");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [rows, setRows] = useState<Parsed[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const ready = useMemo(
    () => (rows ?? []).filter(r => !r.problem && r.amount !== null),
    [rows],
  );
  const blocked = useMemo(() => (rows ?? []).filter(r => r.problem), [rows]);
  const total = ready.reduce((n, r) => n + (r.amount ?? 0), 0);

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const t = String(reader.result ?? "");
      setText(t);
      setRows(parse(t, clients, currency));
      setResults(null);
    };
    reader.readAsText(file);
  }

  async function run() {
    if (!ready.length) return;
    setBusy(true);
    const out: Result[] = [];
    for (const r of ready) {
      try {
        await add({
          day: r.day,
          amount: r.amount as number,
          currency: r.currency,
          clientName: r.clientText,
          clickupTaskId: r.clickupTaskId ?? undefined,
          rail: r.rail,
          note: r.note || undefined,
        });
        out.push({ line: r.line, ok: true, message: "Logged" });
      } catch (e) {
        out.push({
          line: r.line,
          ok: false,
          message: String(e instanceof Error ? e.message : e).slice(0, 200),
        });
      }
    }
    setResults(out);
    setBusy(false);
  }

  const tapWarning = info?.tapLive && (rows ?? []).some(r => r.rail === "tap");

  return (
    <SectionCard
      id="money-import"
      kicker="Bank transfers and cheques, a month at a time"
      title="Import payments"
      order={order}
    >
      {() => (
        <div className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            Drop a CSV from your bank, or paste rows straight from a sheet.
            Date, amount and client, in that order, with or without a header
            line. Nothing is logged until you have looked at it. A date like
            03/09 is read as 3 September, the way banks here write it; write
            2026-09-03 if you want to be certain.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
            >
              <Upload className="size-4" aria-hidden />
              Choose a CSV
            </button>
            <input
              ref={fileRef}
              id="money-import-file"
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              onChange={onFile}
              className="hidden"
            />
            <label
              htmlFor="money-import-currency"
              className="text-sm text-muted-foreground"
            >
              Amounts are in
            </label>
            <AnimatedSelect
              id="money-import-currency"
              value={currency}
              onChange={e => {
                const c = e.target.value as Currency;
                setCurrency(c);
                if (text) setRows(parse(text, clients, c));
              }}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <option value="USD">US dollars</option>
              <option value="KWD">Kuwaiti dinar</option>
            </AnimatedSelect>
          </div>

          <textarea
            id="money-import-text"
            value={text}
            onChange={e => {
              setText(e.target.value);
              setResults(null);
            }}
            onBlur={() => setRows(parse(text, clients, currency))}
            rows={5}
            spellCheck={false}
            placeholder={
              "2026-09-03, 1500, Ocean Home, bank transfer\n2026-09-11, 2000, Ardon, cheque"
            }
            className="w-full rounded-md border bg-background p-3 font-mono text-xs"
          />

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setRows(parse(text, clients, currency));
                setResults(null);
              }}
              disabled={!text.trim()}
              className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              Check the rows
            </button>
            {rows ? (
              <span className="text-sm text-muted-foreground">
                {plural(ready.length, "row")} ready
                {blocked.length ? `, ${blocked.length} to fix` : ""}
                {ready.length ? ` · ${money(total)} ${currency}` : ""}
              </span>
            ) : null}
          </div>

          {tapWarning ? (
            <p className="text-sm text-[var(--ceo-warning)]">
              Tap is connected, so Tap payments arrive on their own. Rows marked
              Tap will be refused rather than counted twice.
            </p>
          ) : null}

          {rows && rows.length ? (
            <div className="overflow-x-auto rounded-md border">
              <table
                className="w-full text-sm"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="p-2 font-medium">Line</th>
                    <th className="p-2 font-medium">Day</th>
                    <th className="p-2 text-right font-medium">Amount</th>
                    <th className="p-2 font-medium">Client</th>
                    <th className="p-2 font-medium">Rail</th>
                    <th className="p-2 font-medium">State</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const res = results?.find(x => x.line === r.line);
                    return (
                      <tr key={r.line} className="border-t align-top">
                        <td className="p-2 text-muted-foreground">{r.line}</td>
                        <td className="p-2">{r.day || "—"}</td>
                        <td className="p-2 text-right">
                          {r.amount === null ? "—" : money(r.amount)}
                        </td>
                        <td className="p-2">
                          {r.clientText || (
                            <span className="text-muted-foreground">—</span>
                          )}
                          {r.clickupTaskId ? null : (
                            <span className="block text-xs text-muted-foreground">
                              no card matched
                            </span>
                          )}
                        </td>
                        <td className="p-2">
                          {RAILS.find(x => x.value === r.rail)?.label}
                        </td>
                        <td className="p-2">
                          {res ? (
                            <StatusChip
                              tone={res.ok ? "good" : "serious"}
                              label={res.message.slice(0, 60)}
                            />
                          ) : r.problem ? (
                            <StatusChip tone="serious" label={r.problem} />
                          ) : (
                            <StatusChip tone="neutral" label="Ready" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : rows ? (
            <EmptyState
              title="Nothing to read in that"
              text="Each line needs a date, an amount and a client."
              icon={Upload}
              compact
            />
          ) : null}

          <div>
            <button
              type="button"
              onClick={run}
              disabled={busy || !ready.length}
              className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Logging…" : `Log ${plural(ready.length, "payment")}`}
            </button>
            {results ? (
              <p className="mt-2 text-sm">
                {results.filter(r => r.ok).length} logged,{" "}
                {results.filter(r => !r.ok).length} refused. A refusal is
                usually the duplicate check: the same payment is already on the
                ledger for that day.
              </p>
            ) : null}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

/**
 * Lifetime value on the client cards: what the cockpit would write, and why.
 *
 * Nothing is written until the button is pressed, and the table above it is the
 * whole argument: the baseline that was already on the card, the payments
 * logged since, and the figure the two add up to. A card whose field is already
 * right never appears, because there is nothing to say about it.
 */
export function LtvWriteCard({ order }: { order?: number }) {
  const plan = useQuery(api.ceo.ltv.preview, {});
  const apply = useAction(api.ceo.ltv.apply);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    try {
      const r = await apply({});
      setDone(
        `${plural(r.written, "card")} updated${r.skipped ? `, ${r.skipped} already correct` : ""}${
          r.errors.length ? `. Refused: ${r.errors.join("; ")}` : "."
        }`,
      );
    } catch (e) {
      setDone(String(e instanceof Error ? e.message : e).slice(0, 240));
    }
    setBusy(false);
  }

  return (
    <SectionCard
      id="money-ltv"
      kicker="Active and onboarding clients only"
      title="Lifetime value on the cards"
      order={order}
    >
      {() => {
        if (!plan) return null;
        const rows = plan.rows ?? [];
        const missing = plan.missing ?? [];
        return (
          <div className="grid gap-5">
            <p className="text-sm text-muted-foreground">
              Each card's LTV is the figure already typed on it, frozen as a
              baseline, plus every payment logged against that client since.
              Part of it was typed from memory and nothing can check it, so it
              is carried rather than trusted. Whop money is left out: only 42 of
              124 paid rows carry a deal id, so counting it would credit some
              clients and not others for reasons unrelated to what they paid.
            </p>

            {rows.length ? (
              <div className="overflow-x-auto rounded-md border">
                <table
                  className="w-full text-sm"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="p-2 font-medium">Client</th>
                      <th className="p-2 text-right font-medium">Baseline</th>
                      <th className="p-2 text-right font-medium">
                        Logged since
                      </th>
                      <th className="p-2 text-right font-medium">
                        On the card now
                      </th>
                      <th className="p-2 text-right font-medium">
                        Would become
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r: any) => (
                      <tr key={r.clickupTaskId} className="border-t">
                        <td className="p-2">
                          {r.client}
                          <span className="block text-xs text-muted-foreground">
                            {`baseline taken ${r.baselineDay}`}
                          </span>
                        </td>
                        <td className="p-2 text-right">{money(r.baseline)}</td>
                        <td className="p-2 text-right">
                          {money(r.logged)}
                          <span className="block text-xs text-muted-foreground">
                            {plural(r.loggedCount, "payment")}
                          </span>
                        </td>
                        <td className="p-2 text-right text-muted-foreground">
                          {r.current === null ? "—" : money(r.current)}
                        </td>
                        <td className="p-2 text-right font-medium">
                          {money(r.target)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="Every card is already right"
                text="No active or onboarding client has a logged payment that the card does not already account for."
                icon={Upload}
                compact
              />
            )}

            {missing.length ? (
              <div className="border-t pt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {`No LTV figure at all (${missing.length})`}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  There is no baseline to build on, so these are left alone.
                  Type a figure on the card and they join on the next refresh.
                </p>
                <ul className="mt-3 grid gap-1 sm:grid-cols-2">
                  {missing.map((m: any) => (
                    <li key={m.clickupTaskId} className="text-sm">
                      {m.client}
                      <span className="text-muted-foreground">
                        {m.stage ? ` · ${m.stage}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div>
              <button
                type="button"
                onClick={run}
                disabled={busy || !rows.length}
                className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
              >
                {busy
                  ? "Writing…"
                  : `Write ${plural(rows.length, "card")} to ClickUp`}
              </button>
              {done ? <p className="mt-2 text-sm">{done}</p> : null}
              <p className="mt-2 text-xs text-muted-foreground">
                {`${plan.outOfScope} paused, stopped and internal cards are never touched.`}
              </p>
            </div>
          </div>
        );
      }}
    </SectionCard>
  );
}
