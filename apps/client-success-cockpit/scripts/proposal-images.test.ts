/** Selected preview images either all resolve or return a useful, non-technical error. */
import { expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fixturePublic,
  proposalFixture,
} from "../src/dev/offer/proposalFixtures";
import { readPublicProposal } from "../src/pages/money/offers/proposal/proposalSources";

type SignResult = { data: { signedUrl: string } | null; error: Error | null };
function imageFixture(sign: (path: string) => Promise<SignResult>) {
  const bundle = proposalFixture();
  const page = fixturePublic(bundle);
  page.logo = {
    bucket: "cockpit-launch-ads",
    path: "logo.png",
    alt: "Example logo",
  };
  page.found = [
    {
      bucket: "cockpit-upsell-files",
      path: "capture.png",
      caption: "Current site",
      capturedOn: "2026-10-26",
      searchedAs: null,
    },
  ];
  const client = {
    rpc: async () => ({ data: page, error: null }),
    storage: { from: () => ({ createSignedUrl: sign }) },
  } as unknown as SupabaseClient;
  return { client, proposal: bundle.proposal, page };
}
const success = async (path: string): Promise<SignResult> => ({
  data: { signedUrl: `https://assets.example/${path}` },
  error: null,
});

test("preview keeps every selected image when signing succeeds", async () => {
  const f = imageFixture(success);
  const preview = await readPublicProposal(f.client, f.proposal);
  expect(preview.logo?.url).toBe("https://assets.example/logo.png");
  expect(preview.found).toHaveLength(1);
  expect(preview.found[0].url).toBe("https://assets.example/capture.png");
});

test.each(["logo", "capture"] as const)(
  "a failed selected %s stops the preview instead of hiding that image",
  async kind => {
    const f = imageFixture(async path =>
      path === `${kind}.png`
        ? { data: null, error: Error("private storage detail") }
        : success(path),
    );
    await expect(readPublicProposal(f.client, f.proposal)).rejects.toThrow(
      kind === "logo"
        ? "The selected logo could not be opened."
        : "A selected capture could not be opened.",
    );
  },
);

test("a missing signed URL or network failure gives the same recoverable preview error", async () => {
  for (const sign of [
    async (): Promise<SignResult> => ({ data: null, error: null }),
    async (): Promise<SignResult> => {
      throw Error("network implementation detail");
    },
  ]) {
    const f = imageFixture(sign);
    await expect(readPublicProposal(f.client, f.proposal)).rejects.toThrow(
      "Refresh captures and logos to try the preview again.",
    );
  }
});

test("images with an existing URL do not require a storage signing call", async () => {
  const f = imageFixture(async () => {
    throw Error("Unexpected signing call");
  });
  f.page.logo = {
    url: "https://assets.example/public-logo.png",
    alt: "Example logo",
  };
  f.page.found[0] = {
    url: "https://assets.example/public-capture.png",
    caption: "Current site",
    capturedOn: "2026-10-26",
    searchedAs: null,
  };
  const preview = await readPublicProposal(f.client, f.proposal);
  expect(preview.logo?.url).toBe("https://assets.example/public-logo.png");
  expect(preview.found[0].url).toBe(
    "https://assets.example/public-capture.png",
  );
});
