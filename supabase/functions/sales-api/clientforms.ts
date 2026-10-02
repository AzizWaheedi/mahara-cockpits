// The New Client Form sent from a lead's page (Aziz, 2026-10-02), kept apart
// from index.ts so bun can test it.
//
// The form is Typeform's own, embedded on the page: Typeform saves the
// response and starts the onboarding (Make's "10. Closer Form to Onboarding
// (MAIN)", HighLevel, B2B's closed_deals). The page then reports the
// response Typeform says it saved; this checks that report before
// cockpit_sales_client_forms gets its row and the audit log its line.

type Row = Record<string, unknown>;

export const CLIENT_FORM_ID = "BTzMwXiw";

export interface ClientFormRow {
  response_id: string;
  contact_id: string;
  form_id: string;
  hidden: { contact_id: string; closer: string; setter: string };
}

function text(v: unknown, max: number): string {
  return String(v ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, max);
}

/** The row for a form the page says Typeform saved, or the sentence that says what is wrong. */
export function clientFormRow(
  b: Row,
  formId: string | null | undefined,
): { ok: true; row: ClientFormRow } | { ok: false; error: string } {
  const contact = text(b.contact_id, 80);
  if (!contact) return { ok: false, error: "Which lead?" };
  const response = text(b.response_id, 64);
  if (!/^[A-Za-z0-9]{8,64}$/.test(response))
    return {
      ok: false,
      error:
        "Typeform did not say which response it saved. Look for it in Typeform's results before filling the form again, so the client is not onboarded twice.",
    };
  return {
    ok: true,
    row: {
      response_id: response,
      contact_id: contact,
      form_id: text(formId, 40) || CLIENT_FORM_ID,
      hidden: { contact_id: contact, closer: text(b.closer, 80), setter: text(b.setter, 80) },
    },
  };
}
