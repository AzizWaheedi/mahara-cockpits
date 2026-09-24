import { describe, expect, test } from "bun:test";
import { rangeInternal } from "../convex/stats";

const campaignName = "Arcturus-Mahara-3\\9";
const daily = [
  {
    campaignName,
    date: "2026-09-10",
    adSetName: "Leads",
    adName: "ad-2",
    metaAdId: "200",
    spend: 100,
    leads: 5,
    impressions: 2000,
    linkClicks: 50,
  },
  {
    campaignName,
    date: "2026-09-22",
    adSetName: "Leads",
    adName: "ad-1",
    metaAdId: "100",
    spend: 70,
    leads: 7,
    impressions: 2000,
    linkClicks: 50,
  },
];
const bookings = [
  { campaignName, date: "2026-09-22", status: "booked", adId: "200" },
  { campaignName, date: "2026-09-22", status: "booked", adId: "100" },
];

function ctx(dailyRows = daily, bookingRows = bookings) {
  return {
    db: {
      query(table: string) {
        return {
          withIndex(_name: string, apply: (q: any) => any) {
            const bounds: {
              campaign?: string;
              start?: string;
              end?: string;
              endExclusive?: string;
            } = {};
            const q = {
              eq(_field: string, value: string) {
                bounds.campaign = value;
                return q;
              },
              gte(_field: string, value: string) {
                bounds.start = value;
                return q;
              },
              lte(_field: string, value: string) {
                bounds.end = value;
                return q;
              },
              lt(_field: string, value: string) {
                bounds.endExclusive = value;
                return q;
              },
            };
            apply(q);
            return {
              async collect() {
                return (
                  table === "dailyStats" ? dailyRows : bookingRows
                ).filter(
                  r =>
                    r.campaignName === bounds.campaign &&
                    (!bounds.start || r.date >= bounds.start) &&
                    (!bounds.end || r.date <= bounds.end) &&
                    (!bounds.endExclusive || r.date < bounds.endExclusive),
                );
              },
            };
          },
        };
      },
    },
  } as any;
}

describe("ad-level booking attribution across spend windows", () => {
  test("keeps an attributed booking visible when its ad last spent before the selected week", async () => {
    const result = await rangeInternal._handler(ctx(), {
      campaignName,
      start: "2026-09-17",
      end: "2026-09-23",
    });
    const oldAd = result.ads.find((ad: any) => ad.adIds.includes("200"));
    expect(oldAd).toBeDefined();
    expect(oldAd.bookings).toBe(1);
    expect(oldAd.spend).toBe(0);
    expect(oldAd.costPerBooking).toBeUndefined();
    expect(result.bookingsAttributed).toBe(2);
  });

  test("calculates each ad's cost per booking when the 30-day spend and booking are both in range", async () => {
    const result = await rangeInternal._handler(ctx(), {
      campaignName,
      start: "2026-08-25",
      end: "2026-09-23",
    });
    const oldAd = result.ads.find((ad: any) => ad.adIds.includes("200"));
    expect(oldAd.bookings).toBe(1);
    expect(oldAd.costPerBooking).toBe(100);
  });

  test("does not credit an older ad's booking to a different current ad with the same name", async () => {
    const sameNameRows = daily.map(r => ({ ...r, adName: "same name" }));
    const result = await rangeInternal._handler(
      ctx(sameNameRows, [bookings[0]]),
      {
        campaignName,
        start: "2026-09-17",
        end: "2026-09-23",
      },
    );
    const quiet = result.ads.find((a: any) => a.adIds.includes("200"));
    const active = result.ads.find((a: any) => a.adIds.includes("100"));
    expect(quiet).toBeDefined();
    expect(quiet).not.toBe(active);
    expect(quiet.bookings).toBe(1);
    expect(quiet.costPerBooking).toBeUndefined();
    expect(active.bookings).toBe(0);
  });
});
