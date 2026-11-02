import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { offerStatus } from "../src/dev/offer/fixtures";
import { OfferHotRow } from "../src/pages/money/offers/OfferHotRow";

test("Hot row names missing work and never calls an incomplete offer ready", () => {
  const s = offerStatus();
  s.offers[0].ready = { ok: false, missing: ["no_capture", "no_price"] };
  const html = renderToStaticMarkup(
    <OfferHotRow c={{ taskId: "fixture" }} status={s} client={null} />,
  );
  expect(html).toContain("Add a dated capture");
  expect(html).toContain("Choose the opening price");
  expect(html).not.toContain("Ready to prepare");
});

test("an unchecked sparse client keeps the actual missing pieces visible", () => {
  const html = renderToStaticMarkup(
    <OfferHotRow
      c={{ taskId: "fixture" }}
      status={offerStatus("sparse")}
      client={null}
    />,
  );
  expect(html).toContain("site not checked yet");
  expect(html).toContain("Add a dated capture");
  expect(html).toContain("Add a payment link");
  expect(html).not.toContain("Ready to prepare");
});
