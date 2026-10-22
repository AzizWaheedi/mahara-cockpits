import { expect, test } from "bun:test";
import { FIXED_USD_PER_KWD, hmacHex, kuwaitDay, ledgerRow, sameHex, signatureString } from "./ecom.ts";

// The docs' own example: drop nulls, sort keys case-insensitively, join with "&".
test("signature string follows Ecom's sample", () => {
  const data = { timestamp: null, eventType: "X", amount: "100.5050", Currency: "KWD", ecomId: "1" };
  expect(signatureString(data)).toBe("amount=100.5050&Currency=KWD&ecomId=1&eventType=X");
});

test("hmac and compare", async () => {
  const sig = await hmacHex("my_secret_key", "a=1&b=2");
  expect(sig).toMatch(/^[0-9a-f]{64}$/);
  expect(sameHex(sig, sig.toUpperCase())).toBe(true);
  expect(sameHex(sig, sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0"))).toBe(false);
  expect(sameHex("", "")).toBe(false);
});

test("kuwait day rolls at 21:00 UTC", () => {
  expect(kuwaitDay(Date.parse("2026-10-21T20:59:00Z"))).toBe("2026-10-21");
  expect(kuwaitDay(Date.parse("2026-10-21T21:00:00Z"))).toBe("2026-10-22");
});

const live = {
  id: "INV_20261020201fwiBU", invoiceNumber: "26B106914", ecomReference: "E_L_26B106914",
  amount: { value: "620.000", currency: "KWD" }, status: "UNPAID", paymentMethod: null,
  customer: { fullName: "Client", email: "X@Y.com" }, description: "MaharaMedia Premium Projects Program",
  createdAt: "2026-10-20T13:00:27.659Z", paymentUrl: "https://invoice.ecom.io/E_LINKS/pending?paymentToken=INV_x",
};

test("an invoice made outside the cockpit uses the fixed rate", () => {
  const row = ledgerRow(live, new Map(), new Date("2026-10-22T00:00:00Z"))!;
  expect(row.amount_kwd).toBe(620);
  expect(row.usd).toBe(Math.round(620 * FIXED_USD_PER_KWD * 100) / 100);
  expect(row.usd_rate_source).toBe("fixed");
  expect(row.status).toBe("UNPAID");
  expect(row.day).toBe("2026-10-20");
  expect(row.customer_email).toBe("x@y.com");
});

test("a cockpit invoice keeps the rate it was made with, and counts on its paid day", () => {
  const rates = new Map([["INV_20261020201fwiBU", { usdPerKwd: 1 / 0.3096, cockpitId: "11111111-2222-3333-4444-555555555555" }]]);
  const row = ledgerRow({ ...live, status: "PAID", paidAt: "2026-10-22T22:30:00Z", paymentMethod: "KNET" }, rates, new Date())!;
  expect(row.usd).toBe(Math.round(620 / 0.3096 * 100) / 100);
  expect(row.usd_rate_source).toBe("invoice");
  expect(row.cockpit_invoice_id).toBe("11111111-2222-3333-4444-555555555555");
  expect(row.day).toBe("2026-10-23");
  expect(row.payment_method).toBe("KNET");
});

test("rows that are not Ecom invoices are skipped", () => {
  expect(ledgerRow({ id: "CHA_1", amount: { value: 1 } }, new Map(), new Date())).toBe(null);
  expect(ledgerRow({ id: "INV_abcdef", amount: { value: "x" } }, new Map(), new Date())).toBe(null);
});
