import { describe, expect, test } from "bun:test";
import * as proof from "./proof";

/**
 * The documents a prospect opens from the deck. Each is a Google Doc shared as
 * "anyone with the link can view", linked at its /view address.
 */

const links = {
  BRAND_DNA_DOC: proof.BRAND_DNA_DOC,
  AD_SCRIPT_DOC: proof.AD_SCRIPT_DOC,
  OFFER_DOC: proof.OFFER_DOC,
  OFFER_PACK_DOC: proof.OFFER_PACK_DOC,
  SCRIPTS_DOC: proof.SCRIPTS_DOC,
};

describe("deck documents", () => {
  test("every link set is a Google Doc's view address", () => {
    for (const [name, url] of Object.entries(links)) {
      if (url === null) continue;
      expect({ name, ok: /^https:\/\/docs\.google\.com\/document\/d\/[\w-]{20,}\/view$/.test(url) }).toEqual({ name, ok: true });
    }
  });

  test("the script pages open the sample, never the partner's own script", () => {
    // The partner's document carries its owner's number, email and address.
    expect(proof.SCRIPTS_DOC).not.toContain("1u2pp9r2cUyJRu7_McX-ewrWfafsogPcOe7K790uw1UI");
    expect(proof.SCRIPTS_DOC).toContain("1QUIEoIIcM8285aJWLWQlkanSigAsp9B29QFPck1bnIo");
  });
});
