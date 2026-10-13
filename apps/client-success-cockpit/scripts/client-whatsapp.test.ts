import { expect, test } from "bun:test";
import { namedAfter } from "../src/components/ClientWhatsApp";

test("a client's group is found by its name, the way the team names groups", () => {
  expect(namedAfter("Mahara | Smmim Studio [ 📢📢📢 ]", "Smmim studio")).toBe(2);
  expect(namedAfter("Mahara - Alkhalil [ 📢 ]", "Alkhalil")).toBe(2);
  // A long legal name: only the first distinctive word is in the group's name.
  expect(namedAfter("Safad | Mahara [ 📢 ]", "Safad Consultant Engineering")).toBe(1);
  // Mahara, company and the like say nothing about which client it is.
  expect(namedAfter("Mahara | Brillant Touch Company", "Smmim studio")).toBe(0);
  expect(namedAfter("Mahara Media team", "Mahara Media")).toBe(0);
  expect(namedAfter("Mahara | Ideal Homes", "شركة العلا")).toBe(0);
});

test("raw WhatsApp mentions read as a mention, phone numbers in text stay", async () => {
  const { waMentions } = await import("../src/lib/clientBrief");
  expect(waMentions("@127891912274049 بس أكدلي")).toBe("@mention بس أكدلي");
  expect(waMentions("call 96512345 now")).toBe("call 96512345 now");
});
