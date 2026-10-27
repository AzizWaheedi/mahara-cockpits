import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WEBSITE_ROW } from "../src/dev/offer/fixtures";
import { PriceRow } from "../src/pages/money/offers/PriceRow";
import type { OfferClient } from "../src/present/offer/sources";

test("CSM list is read-only and has no CEO approval step", () => {
  const html = renderToStaticMarkup(
    <PriceRow
      row={WEBSITE_ROW}
      client={{} as OfferClient}
      isCeo={false}
      onSaved={() => {}}
    />,
  );
  expect(html).toMatch(/readonly/i);
  expect(html).not.toMatch(/approval|floor price|Use the doc/);
});
test("blank CEO price exposes a one-click hint", () => {
  const row = structuredClone(WEBSITE_ROW);
  row.parts.forEach(p => {
    p.amount = null;
  });
  const html = renderToStaticMarkup(
    <PriceRow row={row} client={{} as OfferClient} isCeo onSaved={() => {}} />,
  );
  expect(html).toContain("Use the doc&#x27;s 2000 USD");
});
