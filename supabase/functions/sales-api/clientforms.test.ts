import { describe, expect, test } from "bun:test";
import { CLIENT_FORM_ID, clientFormRow } from "./clientforms.ts";

describe("a New Client Form the page says Typeform saved", () => {
  test("becomes a row for the lead, with the hidden fields it carried", () => {
    const out = clientFormRow(
      { contact_id: " c1 ", response_id: "8th76wi7146sqr8tf4hqsjfhvxzz5xgz", closer: "Ahmed Abushaiba", setter: "Maria" },
      "BTzMwXiw",
    );
    expect(out).toEqual({
      ok: true,
      row: {
        response_id: "8th76wi7146sqr8tf4hqsjfhvxzz5xgz",
        contact_id: "c1",
        form_id: "BTzMwXiw",
        hidden: { contact_id: "c1", closer: "Ahmed Abushaiba", setter: "Maria" },
      },
    });
  });

  test("without a lead or a response id it says what to do", () => {
    expect(clientFormRow({ response_id: "8th76wi7146sqr8tf4hqsjfhvxzz5xgz" }, null)).toEqual({
      ok: false,
      error: "Which lead?",
    });
    const bad = clientFormRow({ contact_id: "c1", response_id: "x; drop table" }, null);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toContain("not onboarded twice");
  });

  test("the form id falls back to the New Client Form's", () => {
    const out = clientFormRow({ contact_id: "c1", response_id: "abcdefgh12345678" }, "");
    expect(out.ok && out.row.form_id).toBe(CLIENT_FORM_ID);
  });
});
