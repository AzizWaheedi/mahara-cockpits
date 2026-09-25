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

test("Atlantis: older spend makes the 30-day ad cost primary, with selected cost disclosed", () => {
  expect(
    bookingCostCell(
      {
        key: "ad-SC3",
        adIds: ["52514606132916"],
        spend: 3.15,
        bookings: 1,
        costPerBooking: 3.15,
      },
      [
        {
          key: "ad-SC3",
          adIds: ["52514606132916"],
          spend: 157.35,
          bookings: 1,
          costPerBooking: 157.35,
        },
      ],
    ),
  ).toEqual({ value: 157.35, label: "30d", selectedValue: 3.15 });
});

test("uses selected cost when there is no older spend", () => {
  expect(
    bookingCostCell(
      {
        key: "new",
        adIds: ["100"],
        spend: 80,
        bookings: 2,
        costPerBooking: 40,
      },
      [
        {
          key: "new",
          adIds: ["100"],
          spend: 80,
          bookings: 2,
          costPerBooking: 40,
        },
      ],
    ),
  ).toEqual({ value: 40 });
});

test("does not mix different IDs even if old and current ads share a name", () => {
  expect(
    bookingCostCell(
      {
        key: "same name [300]",
        adIds: ["300"],
        spend: 3.15,
        bookings: 1,
        costPerBooking: 3.15,
      },
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
  ).toEqual({ value: 3.15 });
});
