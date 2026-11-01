/**
 * "How this cockpit works" on the Links page: the demo, the two Google Docs
 * SOPs and the how-to videos (onboarding call, launch call, Offers), all
 * from the shared COCKPIT_GUIDES. The command palette (Ctrl K) is drawn from
 * the same rows.
 *
 * Run: bun test scripts/guide-links.test.ts
 */

import { expect, test } from "bun:test";
import { COCKPIT_GUIDES } from "../src/lib/cockpits";
import { LINK_GROUPS } from "../src/lib/csmLinks";

const guide = LINK_GROUPS.find(g => g.title === "How this cockpit works");
const drive = (id: string) => `https://drive.google.com/file/d/${id}/view`;

test("the guide group lists the demo, both SOPs and the how-to videos", () => {
  expect(guide?.rows.map(r => r.label)).toEqual([
    "Watch the demo",
    "The simple SOP",
    "The in-depth SOP",
    "Onboarding call: run the deck and the kickoff form (video)",
    "Launch call: run the launch deck (video)",
    "Offers: pitch an offer and send a proposal (video)",
    "Client success cockpit, how to use it",
  ]);
});

test("each how-to row opens its Drive video", () => {
  const url = (start: string) =>
    guide?.rows.find(r => r.label.startsWith(start))?.url;
  expect(url("Onboarding call:")).toBe(COCKPIT_GUIDES.csm.howTo.onboarding);
  expect(url("Onboarding call:")).toBe(
    drive("1AuD8qBlwRJHdUHF_teerPlLJI856WgTG"),
  );
  expect(url("Launch call:")).toBe(COCKPIT_GUIDES.csm.howTo.launch);
  expect(url("Launch call:")).toBe(drive("1A-4eHbzNXXA2DiH5bZJzfn19LlgGKYdJ"));
  expect(url("Offers:")).toBe(COCKPIT_GUIDES.csm.howTo.offers);
  expect(url("Offers:")).toBe(drive("1fJ2aj62n1uCkxj5HO17Uxd9nqw97xuC2"));
});

test("every guide row has a link", () => {
  for (const r of guide?.rows ?? [])
    expect({ label: r.label, url: r.url }).toEqual({
      label: r.label,
      url: expect.stringMatching(/^https:\/\//),
    });
});

// Waves 3-4 (docs/forms/WAVE34-CONTRACT.md 4.11): the four client forms move
// into the cockpit. Each row follows cockpit_form_client_live_list(): until
// its form is live it says so and keeps the Typeform as the old form, still
// live; once live, the old link goes. The media buyer copy and the CSM
// assistant carry the cockpit words without a live read.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  linkGroupsFor,
  NOT_LIVE_YET,
  OLD_FORM,
  oldFormOf,
} from "../src/lib/csmLinks";

const ROWS: [string, string, string, string][] = [
  [
    "csat",
    "Onboarding survey (in the cockpit)",
    "Open the client, then Send a form. It goes to their portal, or by WhatsApp link.",
    "https://maharamedia.typeform.com/to/KbcbPA73",
  ],
  [
    "nps",
    "NPS survey (in the cockpit)",
    "Open the client, then Send a form. It goes to their portal, or by WhatsApp link.",
    "https://maharamedia.typeform.com/to/fuPgs85S",
  ],
  [
    "pause_consent",
    "Pause consent (in the cockpit)",
    "Open the client, then Pause this client. The client signs the consent in their portal or by link.",
    "https://maharamedia.typeform.com/to/CTUjv6l3",
  ],
  [
    "exit_survey",
    "Exit survey (in the cockpit)",
    "Open the client, then Client is leaving or Send a form.",
    "https://maharamedia.typeform.com/to/knIe4eF3",
  ],
];
const rowOf = (groups: typeof LINK_GROUPS, key: string) =>
  groups.flatMap(g => g.rows).find(r => r.form?.key === key);

test("each client form's row reads the cockpit words and points at the client page", () => {
  for (const [key, label, note, old] of ROWS) {
    const r = rowOf(
      linkGroupsFor(["nps", "csat", "pause_consent", "exit_survey"]),
      key,
    );
    expect({ label: r?.label, url: r?.url, note: r?.note }).toEqual({
      label,
      url: "https://cockpit.maharamedia.com/client-success/clients",
      note,
    });
    expect(
      oldFormOf(r!, ["nps", "csat", "pause_consent", "exit_survey"]),
    ).toBeNull();
    expect(r?.form?.oldUrl).toBe(old);
  }
});

test("until a form is live (or the list cannot be read) the row says so and keeps the old link", () => {
  for (const live of [null, [], ["nps"]] as const) {
    for (const [key, , note, old] of ROWS) {
      const r = rowOf(linkGroupsFor(live), key);
      if (live?.includes(key)) {
        expect(r?.note).toBe(note);
        continue;
      }
      expect(r?.note).toBe(`${note} ${NOT_LIVE_YET}`);
      expect(oldFormOf(r!, live)).toBe(old);
    }
  }
  expect(NOT_LIVE_YET).toBe(
    "Opens with the portal forms (after the switch-on).",
  );
  expect(OLD_FORM).toBe("Old form, still live:");
  // The rows that stay: the referral form is not retired.
  expect(
    LINK_GROUPS.flatMap(g => g.rows).some(
      r => r.url === "https://maharamedia.typeform.com/to/bAmbMKM2",
    ),
  ).toBe(true);
});

test("no row links a retired Typeform as its main link, in either app", () => {
  const retired = /typeform\.com\/to\/(KbcbPA73|fuPgs85S|CTUjv6l3|knIe4eF3)/;
  for (const r of LINK_GROUPS.flatMap(g => g.rows))
    expect(r.url).not.toMatch(retired);
  const mb = readFileSync(
    join(import.meta.dir, "../../media-buyer-cockpit/src/lib/csmLinks.ts"),
    "utf8",
  );
  expect(mb).not.toMatch(
    /url: "https:\/\/maharamedia\.typeform\.com\/to\/(KbcbPA73|fuPgs85S|CTUjv6l3|knIe4eF3)"/,
  );
  for (const [, label] of ROWS) expect(mb).toContain(`label: "${label}"`);
});

test("the CSM assistant changes lines 39 and 41 only; the referral form on 42 stays", () => {
  const py = readFileSync(
    join(import.meta.dir, "../../../viktor-side-scripts/csm/csm_assistant.py"),
    "utf8",
  ).split("\n");
  expect(py[38]).toContain("Open the client, then Pause this client.");
  expect(py[38]).toContain(
    '": "https://cockpit.maharamedia.com/client-success/clients",',
  );
  expect(py[40]).toContain(
    "Open the client, then Client is leaving or Send a form.",
  );
  expect(py[41]).toBe(
    '    "referral form": "https://maharamedia.typeform.com/to/bAmbMKM2",',
  );
});
