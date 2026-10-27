import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { proposalCardSchema } from "../src/pages/money/offers/proposal/proposalSources";
import { publicProposal } from "../src/pages/money/offers/proposal/publicProposal";
import { buildProposalSrcdoc } from "../src/pages/money/offers/proposal/srcdocSource";

const root = resolve(import.meta.dir, "../../..");
const read = (file: string) =>
  readFileSync(resolve(root, "sites/offer", file), "utf8");
const source = {
  core: read("core.js"),
  strings: read("strings.js"),
  css: read("offer.css"),
  script: read("offer.js"),
};
describe("proposal preview boundary", () => {
  test("ships the exact renderer, styles and strings, not a second implementation", () => {
    for (const file of ["core.js", "offer.css", "strings.js", "offer.js"]) {
      expect(
        readFileSync(
          resolve(
            import.meta.dir,
            "../src/pages/money/offers/proposal/page",
            file,
          ),
          "utf8",
        ),
      ).toBe(read(file));
    }
    const html = buildProposalSrcdoc(source);
    const modules = [
      ...html.matchAll(/data:text\/javascript;base64,([A-Za-z0-9+/=]+)/g),
    ].map(match => Buffer.from(match[1], "base64").toString("utf8"));
    expect(modules).toContain(source.core);
    expect(modules).toContain(source.strings);
    expect(html).toContain(`<style>${source.css}</style>`);
    expect(html).toContain("window.__OFFER_PREVIEW__=true");
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("frame-src 'none'");
    expect(html).toContain("form-action 'none'");
  });
  test("trusted code cannot break out of a script or style container", () => {
    const html = buildProposalSrcdoc({
      core: "",
      strings: "",
      css: "/* </style><script>bad()</script> */",
      script: "const text = '</script><script>bad()</script>';",
    });
    expect(html).not.toContain("</style><script>bad");
    expect(html).not.toContain("'</script><script>bad");
  });
  test("public allowlist removes internal fields at every nested boundary", () => {
    const p = publicProposal({
      lang: "en",
      offer: "website",
      title: "Website",
      clientName: "Fictional",
      logo: null,
      csmFirstName: null,
      date: "2026-10-26",
      validUntil: "2026-11-09",
      video: null,
      found: [],
      why: null,
      get: [],
      platforms: null,
      work: [],
      steps: null,
      timing: null,
      investment: {
        parts: [
          {
            label: "Build",
            amountUsd: 2000,
            cadence: "one_time",
            reason: "private",
          },
        ],
        terms: "",
        split: null,
        list: 2500,
      },
      button: { text: "Continue", whatsapp: null, email: "private" },
      taskId: "private",
      warnings: [],
      reason: "private",
    });
    expect(JSON.stringify(p)).not.toContain("private");
    expect(Object.keys(p)).not.toContain("taskId");
  });
  test("draft activity is absent; published activity contains counts", () => {
    const base = {
      id: "example",
      offerKey: "website",
      lang: "en",
      status: "draft",
      expired: false,
      updatedAfterSend: false,
      sentAt: null,
      validUntil: "2026-11-09",
      code: null,
      revision: 1,
      updatedAt: "2026-10-26",
    };
    expect(
      proposalCardSchema.parse({ ...base, opened: null }).opened,
    ).toBeNull();
    expect(
      proposalCardSchema.parse({
        ...base,
        opened: {
          devices: 2,
          visits: 3,
          lastAt: null,
          played: 4,
          pressedYes: 1,
          known: true,
        },
      }).opened?.played,
    ).toBe(4);
  });
});
