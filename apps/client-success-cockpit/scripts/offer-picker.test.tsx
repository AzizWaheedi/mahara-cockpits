import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { offerStatus } from "../src/dev/offer/fixtures";
import { OfferPicker } from "../src/present/offer/OfferPicker";

test("picker separates the recommended offer from the complete service library", () => {
  const html = renderToStaticMarkup(
    <OfferPicker taskId="fictional" status={offerStatus()} client={null} />,
  );
  expect(html.indexOf("Website")).toBeLessThan(html.indexOf("All services"));
  expect(html).toContain("Deck and video follow the website");
  expect(html).toContain("present/offer/website?view=prep");
  expect(html.match(/Prepare for client/g)).toHaveLength(7);
  expect(html.match(/Quick pitch/g)).toHaveLength(7);
  expect(html).not.toContain("The client asked about a website");
});
