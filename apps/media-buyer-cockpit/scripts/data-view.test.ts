import { describe, expect, test } from "bun:test";
import {
  APPT_ALL,
  type ApptRow,
  apptIssues,
  apptRowSchema,
  buildStory,
  csvCell,
  debugBundle,
  LEAD_ALL,
  type LeadRow,
  leadIssues,
  leadRowSchema,
  plainMade,
  type RecordData,
  result,
  toCsv,
} from "../src/lib/dataView";

const NOW = Date.parse("2026-10-11T15:40:00+03:00");

const lead: LeadRow = leadRowSchema.parse({
  id: "c1",
  location_id: "loc1",
  client: "Ocean Home",
  created_at: "2026-10-10T09:15:00+03:00",
  synced_at: "2026-10-10T09:20:00+03:00",
  channel: "Meta",
  source: "Facebook Ads",
  ad_id: "1202",
  adset_id: "1203",
  campaign_id: "1204",
  ad_name: "Kitchen | Video 1",
  adset_name: "Broad",
  campaign_name: "ocean home-mahara-9\\9",
  utm_campaign: null,
  name: "Test Lead",
  phone: "+96550000000",
  email: "lead@example.com",
  deleted: false,
  deleted_at: null,
  utm_source: "fb",
  utm_content: null,
  utm_medium: null,
  first_url: null,
  meeting_id: null,
  meeting_start: null,
  meeting_status: null,
  meeting_source: null,
  meetings: 0,
});

const appt: ApptRow = apptRowSchema.parse({
  id: "a1",
  contact_id: "c1",
  location_id: "loc1",
  client: "Ocean Home",
  booked_at: "2026-10-10T10:00:00+03:00",
  start_at: "2026-10-11T09:30:00+03:00",
  status: "confirmed",
  ghl_source: "third_party",
  calendar: "A. Appointment Calendar",
  name: "Test Lead",
  phone: "+96550000000",
  lead_found: true,
  lead_channel: "Meta",
  lead_source: "Facebook Ads",
  lead_ad_name: "Kitchen | Video 1",
  lead_campaign_name: "ocean home-mahara-9\\9",
  updated_at: null,
  deal: null,
  quotation: null,
  project_value: null,
  currency: null,
  feedback: null,
  lead_quality: null,
  not_closed_reason: null,
  outcome_at: null,
  cockpit: "counted",
  cockpit_at: "2026-10-10T10:12:00+03:00",
});

describe("columns follow the Master Dashboard", () => {
  test("22 lead and 25 appointment columns, with the unsynced ones marked", () => {
    expect(LEAD_ALL).toHaveLength(22);
    expect(APPT_ALL).toHaveLength(25);
    expect(LEAD_ALL.filter(c => !c.get).map(c => c.label)).toEqual([
      "LAST_UTM_SOURCE",
      "LAST_UTM_CONTENT",
      "LAST_UTM_MEDIUM",
      "LAST_URL",
    ]);
    expect(APPT_ALL.filter(c => !c.get).map(c => c.label)).toEqual([
      "Additional Notes",
      "Agent Number",
      "PRE-PAY",
      "Agent",
    ]);
  });
  test("sheet values use Riyadh time and plain sheet words", () => {
    const get = (label: string) =>
      LEAD_ALL.find(c => c.label === label)?.get?.(lead);
    expect(get("Created Date & Time")).toBe("2026-10-10 09:15:00");
    expect(get("Date")).toBe("2026-10-10");
    expect(get("Platform")).toBe("facebook");
    const aget = (label: string) =>
      APPT_ALL.find(c => c.label === label)?.get?.(appt);
    expect(aget("Contact Link")).toBe(
      "https://app.gohighlevel.com/v2/location/loc1/contacts/detail/c1",
    );
    expect(aget("Showed?")).toBeNull();
    expect(aget("Confirmed?")).toBe("TRUE");
  });
});

describe("CSV", () => {
  test("quotes commas, quotes and new lines", () => {
    expect(csvCell('Al "Noor", Kuwait')).toBe('"Al ""Noor"", Kuwait"');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe("");
  });
  test("defuses spreadsheet formulas but keeps phone numbers", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("+cmd|calc")).toBe("'+cmd|calc");
    expect(csvCell("+965 5000 0000")).toBe("+965 5000 0000");
    expect(csvCell("-12.5")).toBe("-12.5");
  });
  test("every sheet column, in order, with a BOM for Arabic in Excel", () => {
    const csv = toCsv(LEAD_ALL, [lead]);
    expect(csv.startsWith("﻿Lead Name,Lead ID,")).toBe(true);
    expect(csv).toContain("LAST_UTM_SOURCE (not synced)");
    const [, row] = csv.slice(1).split("\r\n");
    expect(row.split(",")).toHaveLength(22);
  });
});

describe("one verdict per row", () => {
  test("Facebook lead without an ad id is flagged", () => {
    expect(leadIssues(lead)).toEqual([]);
    expect(leadIssues({ ...lead, ad_id: null }).map(i => i.label)).toEqual([
      "Ad unknown",
    ]);
    expect(leadIssues({ ...lead, deleted: true })[0].label).toBe(
      "Deleted in GHL",
    );
  });
  test("a passed meeting with no result, a missing or doubled booking, a calendar event", () => {
    expect(apptIssues(appt, NOW).map(i => i.label)).toEqual([
      "Result not recorded",
    ]);
    expect(
      apptIssues({ ...appt, start_at: "2026-10-12T09:30:00+03:00" }, NOW),
    ).toEqual([]);
    expect(
      apptIssues({ ...appt, cockpit: "missing", status: "showed" }, NOW)[0]
        .label,
    ).toBe("Cockpit did not count it");
    expect(
      apptIssues({ ...appt, cockpit: "twice", status: "showed" }, NOW)[0].label,
    ).toBe("Counted twice");
    const cal = apptIssues({ ...appt, ghl_source: "google_calendar" }, NOW);
    expect(cal.map(i => i.label)).toEqual(["Calendar event, not a lead"]);
    expect(cal[0].why).toContain("counts it");
  });
  test("a booking counted without an ad says so (2026-10-12)", () => {
    const upcoming = { ...appt, start_at: "2026-10-12T09:30:00+03:00" };
    expect(apptIssues({ ...upcoming, cockpit_attribution: "ad" }, NOW)).toEqual(
      [],
    );
    expect(
      apptIssues({ ...upcoming, cockpit_attribution: "none" }, NOW).map(
        i => i.label,
      ),
    ).toEqual(["Counted, no ad on the lead"]);
    expect(
      apptIssues({ ...upcoming, cockpit_attribution: "unknown_ad" }, NOW)[0]
        .label,
    ).toBe("Counted, ad not found");
    // Rows from before migration 20261012h carry no attribution at all.
    const { cockpit_attribution: _, ...old } = upcoming;
    expect(apptRowSchema.parse(old).cockpit_attribution).toBeUndefined();
  });
  test("results and booking methods in words", () => {
    expect(result({ status: "showed", start_at: appt.start_at }, NOW)).toEqual([
      "Showed up",
      "ok",
    ]);
    expect(
      result(
        { status: "confirmed", start_at: "2026-10-12T09:00:00+03:00" },
        NOW,
      )[0],
    ).toBe("Upcoming");
    expect(plainMade("booking_widget")).toBe("Booked on the booking page");
    expect(plainMade(null)).toBe("Booking method not recorded");
    expect(plainMade("something_new")).toBe("something_new");
  });
});

describe("the person's story", () => {
  const rec: RecordData = {
    id: "c1",
    contact_id: "c1",
    location_id: "loc1",
    lead,
    appointments: [appt],
    raw: {},
    sync: { leads_synced_at: null, appointments_synced_at: null },
  };
  test("reads in order: lead form, copy, booking, cockpit, meeting", () => {
    const titles = buildStory(rec, NOW).map(s => s.title);
    expect(titles[0]).toBe(
      'Filled a Facebook lead form from the ad "Kitchen | Video 1"',
    );
    expect(titles).toContain("Counted in the cockpit bookings card");
    expect(titles.at(-1)).toBe("Meeting: result not recorded");
  });
  test("the debug bundle holds ids and the story, never a phone or email", () => {
    const text = JSON.stringify(debugBundle(rec, NOW));
    expect(text).toContain("a1");
    expect(text).not.toContain("+96550000000");
    expect(text).not.toContain("lead@example.com");
    expect(text).not.toContain("Test Lead");
  });
});
