import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { offerStatus } from "../src/dev/offer/fixtures";
import { OfferPicker } from "../src/present/offer/OfferPicker";

test("picker separates this month's actual fit from later work", () => {
  const html = renderToStaticMarkup(
    <OfferPicker taskId="fictional" status={offerStatus()} client={null} />,
  );
  expect(html.indexOf("Website")).toBeLessThan(html.indexOf("Later"));
  expect(html).toContain("Deck and video follow the website");
  expect(html).toContain("present/offer/website?view=prep");
});
