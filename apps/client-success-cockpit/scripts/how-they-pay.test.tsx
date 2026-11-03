import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

/**
 * How they pay on the client page's Billing card (Aziz, 2026-11-02: "How they
 * pay should update the ClickUp and client profile card"): the line read from
 * the client's billing row (method · plan · next amount and date), a part not
 * set said in words and never as a zero, the empty state that says where to
 * set it, a card with no billing row, and a failed read. Stand-in reads only.
 *
 * Run: bun test scripts/how-they-pay.test.tsx
 */

setDefaultTimeout(30_000);

const win = new Window({
  url: "https://localhost/client-success/clients/86exfix01?tab=money",
  width: 1280,
  height: 900,
});
const DOM = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "MouseEvent",
  "DocumentFragment",
  "Text",
  "MutationObserver",
  "getComputedStyle",
];
for (const k of DOM)
  Object.defineProperty(globalThis, k, {
    configurable: true,
    writable: true,
    value:
      k === "window"
        ? win
        : typeof (win as any)[k] === "function" && /^[a-z]/.test(k)
          ? (win as any)[k].bind(win)
          : (win as any)[k],
  });
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import("react-dom/client");
const { act, createElement } = await import("react");
const { SectionCard } = await import("../src/components/kit");
const how = await import("../src/components/billing/HowTheyPay");

const roots: ReturnType<typeof createRoot>[] = [];
afterAll(async () => {
  for (const r of roots) await act(async () => r.unmount());
  await win.happyDOM.close();
});
const flush = () =>
  act(async () => {
    for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0));
  });
const text = (el: any) =>
  String(el?.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();

/** A cockpit_billing_accounts row as PostgREST hands it back. */
const ROW = {
  clickup_task_id: "86exfix01",
  client_name: "Castello Industries",
  client_status: "Active",
  stage_group: "active",
  payment_method: "Card on file",
  payment_plan: "Monthly",
  next_payment_usd: 2000,
  next_payment_date: "2026-11-20",
  source: "csm",
};

type Read = { data: unknown; error: unknown };
/** A stand-in client: one table, one eq, maybeSingle; every read is kept. */
function clientOf(answer: Read) {
  const reads: { table: string; columns: string; eq: [string, unknown] }[] = [];
  const client = {
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (col: string, value: unknown) => ({
          maybeSingle: async () => {
            reads.push({ table, columns, eq: [col, value] });
            return answer;
          },
        }),
      }),
    }),
  };
  return { client: client as any, reads };
}

/** The Billing card as the client page's Money tab draws it. */
async function card(answer: Read) {
  const { client, reads } = clientOf(answer);
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  roots.push(root);
  await act(async () =>
    root.render(
      createElement(
        SectionCard,
        { title: "Billing" },
        createElement(how.HowTheyPay, { client, taskId: "86exfix01" }),
      ),
    ),
  );
  await flush();
  return { host: host as any, reads };
}
const line = (host: any) => host.querySelector("[data-how-they-pay]");

describe("the How they pay line", () => {
  test("reads the client's own billing row once and says method · plan · next amount", async () => {
    const { host, reads } = await card({ data: ROW, error: null });
    expect(reads).toEqual([
      {
        table: "cockpit_billing_accounts",
        columns: "*",
        eq: ["clickup_task_id", "86exfix01"],
      },
    ]);
    expect(text(line(host))).toBe(
      "How they pay: Card on file · Monthly · next $2,000",
    );
    expect(host.querySelector("[data-empty]")).toBeNull();
  });

  test("a part not set is said in words, muted, and cents are kept", async () => {
    const { host } = await card({
      data: {
        ...ROW,
        payment_method: null,
        payment_plan: "Split Pay (2x payments)",
        next_payment_usd: "1750.50",
      },
      error: null,
    });
    expect(text(line(host))).toBe(
      "How they pay: Payment method not set · Split Pay (2x payments) · next $1,750.50",
    );
    const muted = [
      ...host.querySelectorAll("[data-line] .text-muted-foreground"),
    ].map(text);
    expect(muted).toEqual(["Payment method not set"]);
  });

  test("an amount not set, or 0, is never $0; the day stays in the sentence above", async () => {
    for (const next_payment_usd of [null, 0, "0", "0.00"]) {
      const { host } = await card({
        data: { ...ROW, next_payment_usd },
        error: null,
      });
      expect(text(line(host))).toBe(
        "How they pay: Card on file · Monthly · Next amount not set",
      );
      expect(text(line(host))).not.toContain("$0");
    }
    // A past day on the row never reads as "next" here: the line has no day.
    const past = await card({
      data: { ...ROW, next_payment_date: "2026-10-28" },
      error: null,
    });
    expect(text(line(past.host))).toBe(
      "How they pay: Card on file · Monthly · next $2,000",
    );
  });

  test("a Paid in full row with amount 0 and no method still says what is set", async () => {
    const { host } = await card({
      data: {
        ...ROW,
        payment_method: null,
        payment_plan: "Paid in full (90 days)",
        next_payment_usd: 0,
      },
      error: null,
    });
    expect(text(line(host))).toBe(
      "How they pay: Payment method not set · Paid in full (90 days) · Next amount not set",
    );
  });

  test("empty: nothing set says where to set it", async () => {
    const { host } = await card({
      data: {
        ...ROW,
        payment_method: null,
        payment_plan: null,
        next_payment_usd: null,
      },
      error: null,
    });
    expect(text(host.querySelector("[data-empty]"))).toBe(
      "How they pay is not set. Set it in Billing.",
    );
    expect(how.HOW_THEY_PAY_EMPTY).toBe(
      "How they pay is not set. Set it in Billing.",
    );
    expect(host.querySelector("[data-line]")).toBeNull();
  });

  test("a card with no billing row says so, not that nothing is set", async () => {
    const { host } = await card({ data: null, error: null });
    expect(text(host.querySelector("[data-empty]"))).toBe(
      how.HOW_THEY_PAY_NO_ROW,
    );
  });

  test("a failed read says what to do; nothing is shown as a value", async () => {
    const { host } = await card({
      data: null,
      error: {
        message: "permission denied for table cockpit_billing_accounts",
      },
    });
    expect(text(host.querySelector("[data-failed]"))).toBe(
      "How they pay did not load. Reload the page to try again.",
    );
    expect(host.querySelector("[data-line]")).toBeNull();
  });
});

describe("the client page", () => {
  test("the Money tab's Billing card draws the line for its own card, above Open billing", () => {
    const src = readFileSync(
      new URL("../src/pages/CsmPage.tsx", import.meta.url),
      "utf8",
    );
    const start = src.indexOf('<SectionCard title="Billing">');
    const end = src.indexOf("</SectionCard>", start);
    expect(start).toBeGreaterThan(-1);
    const billing = src.slice(start, end);
    const at = billing.indexOf(
      "<HowTheyPay client={auth.client} taskId={String(c.taskId)} />",
    );
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(billing.indexOf("Open billing"));
  });
});
