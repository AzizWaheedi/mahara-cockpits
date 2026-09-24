import { expect, test } from "bun:test";
import { bookingCostCell, bookingCostTone } from "../src/lib/booking-cost";

test("shows 30-day cost clearly when this week's booking came from an older ad", () => {
  expect(
    bookingCostCell({ key: "AD-3", adIds: ["300"], spend: 0, bookings: 1 }, [
      {
        key: "AD-3",
        adIds: ["300"],
        spend: 102.1,
        bookings: 2,
        costPerBooking: 51.05,
      },
    ]),
  ).toEqual({ value: 51.05, label: "30d" });
});

test("does not label a no-spend week as free, or invent a 30-day cost", () => {
  expect(
    bookingCostCell({ key: "AD-3", adIds: ["300"], spend: 0, bookings: 1 }, []),
  ).toEqual({ label: "n/a" });
});

test("does not assign a name-aggregated 30-day cost to a single quiet ad", () => {
  expect(
    bookingCostCell(
      { key: "same name [300]", adIds: ["300"], spend: 0, bookings: 1 },
      [
        {
          key: "same name",
          adIds: ["100", "300"],
          spend: 250,
          bookings: 2,
          costPerBooking: 125,
        },
      ],
    ),
  ).toEqual({ label: "n/a" });
});

test("colors the displayed 30-day cost against the same gate as selected-range cost", () => {
  const cell = bookingCostCell(
    { key: "AD-2", adIds: ["200"], spend: 0, bookings: 1 },
    [
      {
        key: "AD-2",
        adIds: ["200"],
        spend: 200,
        bookings: 1,
        costPerBooking: 200,
      },
    ],
  );
  expect(bookingCostTone(cell.value, 100)).toBe("txt-bad");
  expect(bookingCostTone(80, 100)).toBe("txt-good");
  expect(bookingCostTone(undefined, 100)).toBe("");
});

test("prefers the selected range's own cost when that ad spent and booked", () => {
  expect(
    bookingCostCell(
      {
        key: "ad-1",
        adIds: ["100"],
        spend: 80,
        bookings: 2,
        costPerBooking: 40,
      },
      [
        {
          key: "ad-1",
          adIds: ["100"],
          spend: 300,
          bookings: 3,
          costPerBooking: 100,
        },
      ],
    ),
  ).toEqual({ value: 40 });
});
