// The script screen's pieces as they draw (sales simplify, 2026-10-10): the
// number strip pinned above the script, a field under the line that asks
// for it (in the script's own reading direction), the open notes on a part
// with the line that says where they are, and how a typed number shows.
//
// bun test src/components/ScriptScreen.test.tsx

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Block, Capture } from "../lib/script";

// The Supabase client needs the build's settings; nothing here reaches it.
mock.module("../lib/supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
  SUPABASE_URL: "https://example.invalid",
  PROPOSALS_BUCKET: "sales-proposals",
}));

const { NumberLedger, CaptureField, slotValue } = await import(
  "./NumberLedger"
);
const { PartNotes, PART_NOTE_MAX } = await import("./PartNotes");
const { Blocks } = await import("./ScriptParts");
const { LEDGER_SLOTS } = await import("../lib/script");

const none = () => undefined;
const no = () => false;

const CAPTURES: Capture[] = [
  {
    stage: 3,
    key: "project_value",
    label: "Typical project value",
    type: "money",
  },
  {
    stage: 3,
    key: "projects_closed_12m",
    label: "Projects closed",
    type: "number",
  },
  { stage: 3, key: "quotes_12m", label: "Quotes given", type: "number" },
  { stage: 3, key: "revenue_12m", label: "Revenue", type: "money" },
  { stage: 4, key: "ad_spend_month", label: "Ad spend a month", type: "money" },
  {
    stage: 4,
    key: "ad_leads_month",
    label: "Inquiries from ads",
    type: "number",
  },
  { stage: 4, key: "leads_month", label: "Inquiries a month", type: "number" },
  { stage: 4, key: "booked_month", label: "Booked a month", type: "number" },
  { stage: 4, key: "showed_month", label: "Held a month", type: "number" },
  { stage: 4, key: "closed_month", label: "Signed a month", type: "number" },
];

const ledger = (p: Partial<Parameters<typeof NumberLedger>[0]> = {}) =>
  renderToStaticMarkup(
    <NumberLedger
      slots={LEDGER_SLOTS.intro}
      captures={CAPTURES}
      values={{}}
      currency="KWD"
      onChange={none}
      onJump={no}
      answers={{ filled: 0, total: 20 }}
      onAnswers={none}
      funnelOpen={false}
      onFunnel={none}
      fromIntro={no}
      {...p}
    />,
  );

describe("the number strip", () => {
  test("empty slots ask, in a dashed outline; the count says none of six", () => {
    const html = ledger();
    expect(html).toContain("data-ledger");
    expect(html).toContain("sticky");
    expect((html.match(/>Ask</g) ?? []).length).toBe(6);
    expect(html).toContain("border-dashed");
    expect(html).toContain('title="Ask for it: Project value"');
    expect(html).toContain("0 of 6");
    expect(html).toContain("All answers");
    expect(html).toContain("Their numbers");
  });

  test("a typed number fills its slot in mono, with the currency for money", () => {
    const html = ledger({
      values: { project_value: "85k", projects_closed_12m: "14" },
    });
    expect(html).toContain("85k KWD");
    expect(html).toContain(">14<");
    expect(html).toContain("2 of 6");
    expect((html.match(/>Ask</g) ?? []).length).toBe(4);
  });

  test("the intro ends in Book the demo, which turns into the booked time", () => {
    expect(ledger({ book: { booked: null, onClick: none } })).toContain(
      "Book the demo",
    );
    const booked = ledger({
      book: { booked: "Sun 6:00 pm", onClick: none },
    });
    expect(booked).toContain("Sun 6:00 pm");
    expect(booked).not.toContain("Book the demo");
  });

  test("the demo's last four are the funnel in order, joined by chevrons", () => {
    const html = ledger({ slots: LEDGER_SLOTS.demo });
    const at = (w: string) => html.indexOf(w);
    expect(at("Inquiries / mo")).toBeLessThan(at("Booked / mo"));
    expect(at("Booked / mo")).toBeLessThan(at("Held / mo"));
    expect(at("Held / mo")).toBeLessThan(at("Signed / mo"));
    expect((html.match(/lucide-chevron-right/g) ?? []).length).toBe(3);
    expect(html).toContain("0 of 8");
  });

  test("a slot the script has no field for is left out, not shown empty", () => {
    const html = ledger({
      captures: CAPTURES.filter(c => c.key !== "quotes_12m"),
    });
    expect(html).not.toContain("Quotes, 12 mo");
    expect(html).toContain("0 of 5");
  });
});

describe("a typed value in its slot", () => {
  const money = CAPTURES[0];
  test("money gets the currency unless it was typed with one", () => {
    expect(slotValue("85k", money, "KWD")).toBe("85k KWD");
    expect(slotValue("85k SAR", money, "KWD")).toBe("85k SAR");
    expect(slotValue("  ", money, "KWD")).toBeNull();
    expect(slotValue("14", CAPTURES[1], "KWD")).toBe("14");
  });
  test("a long answer is cut to fit the slot", () => {
    expect(slotValue("about twelve or thirteen", CAPTURES[1], "KWD")).toBe(
      "about twelve …",
    );
  });
});

describe("a field under its line", () => {
  test("the label, the input, the currency and how it reads", () => {
    const html = renderToStaticMarkup(
      <CaptureField
        c={CAPTURES[0]}
        value="85k"
        onChange={none}
        currency="KWD"
        fromIntro
        inline
      />,
    );
    expect(html).toContain('data-capture="project_value"');
    expect(html).toContain("data-inline");
    expect(html).toContain("Typical project value");
    expect(html).toContain("from the intro");
    expect(html).toContain(">KWD<");
    expect(html).toContain("Reads as");
    expect(html).toContain("85,000");
    // Filled: the teal start border, on the logical side so Arabic mirrors.
    expect(html).toContain("border-s-2");
    expect(html).toContain("border-[color:var(--primary)]");
  });

  test("a choice is chips, one pressed", () => {
    const html = renderToStaticMarkup(
      <CaptureField
        c={{
          stage: 3,
          key: "capacity",
          label: "Room for more work",
          type: "choice",
          options: ["Has room", "Stretched"],
        }}
        value="Stretched"
        onChange={none}
        currency="KWD"
        fromIntro={false}
      />,
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain("<input");
  });

  test("Blocks puts what a line asks right under it, inside its own reading direction", () => {
    const blocks: Block[] = [
      { type: "say", text: "هلا [NAME]، كيف الحال؟" },
      { type: "say", text: "كم يطلع المشروع الواحد؟" },
      { type: "say", text: "تمام." },
    ];
    const html = renderToStaticMarkup(
      <Blocks
        blocks={blocks}
        fill={{ name: "Sara" }}
        mode="words"
        lang="ar"
        start={10}
        after={i => (i === 11 ? <span data-field="here">FIELD</span> : null)}
      />,
    );
    // A line that opens on the lead's English name still reads right to left.
    expect((html.match(/dir="rtl"/g) ?? []).length).toBe(3);
    expect(html).not.toContain('dir="auto"');
    const asks = html.indexOf("كم يطلع");
    const field = html.indexOf("FIELD");
    const next = html.indexOf("تمام.");
    expect(asks).toBeLessThan(field);
    expect(field).toBeLessThan(next);
  });

  test("a bracket with no value is a dashed blank in sentence case, never a raw bracket", () => {
    const html = renderToStaticMarkup(
      <Blocks
        blocks={[{ type: "say", text: "Our [STRENGTHS] matter. __ or __?" }]}
        fill={{}}
        mode="words"
        lang="en"
      />,
    );
    expect(html).not.toContain("[STRENGTHS]");
    expect(html).toContain(">Strengths<");
    expect(html).toContain(">Two free times<");
    const filled = renderToStaticMarkup(
      <Blocks
        blocks={[{ type: "say", text: "What works for you, __ or __?" }]}
        fill={{ slots: ["Sun 6:00 pm", "Mon 10:00 am"] }}
        mode="words"
        lang="en"
      />,
    );
    expect(filled).toContain("Sun 6:00 pm");
    expect(filled).toContain("Mon 10:00 am");
    expect(filled).not.toContain("__");
  });

  test("in an Arabic line, a detail not known yet is named in the doc's own Arabic", () => {
    const html = renderToStaticMarkup(
      <Blocks
        blocks={[
          {
            type: "say",
            text: "تمام. [TIME + TIMEZONE]. و[CLOSER NAME] بيكون معاك.",
          },
        ]}
        fill={{}}
        mode="words"
        lang="ar"
      />,
    );
    expect(html).toContain(">الوقت<");
    expect(html).toContain(">اسم الكلوزر<");
    expect(html).toContain("Fill this in from what they told you.");
    // The English script keeps the English words.
    const en = renderToStaticMarkup(
      <Blocks
        blocks={[{ type: "say", text: "Perfect. [TIME + TIMEZONE]." }]}
        fill={{}}
        mode="words"
        lang="en"
      />,
    );
    expect(en).toContain(">Time + timezone<");
    expect(en).not.toContain("الوقت");
  });
});

describe("the notes on a part", () => {
  const notes = (p: Partial<Parameters<typeof PartNotes>[0]> = {}) =>
    renderToStaticMarkup(
      <PartNotes
        id="part-notes-intro-3"
        label="Notes on this part"
        hint="Anything they said that no field asks for."
        value=""
        onChange={none}
        state={{ kind: "idle" }}
        {...p}
      />,
    );

  test("a labelled box, no status line before anything is typed", () => {
    const html = notes();
    expect(html).toContain('for="part-notes-intro-3"');
    expect(html).toContain("Notes on this part");
    expect(html).toContain(`maxLength="${PART_NOTE_MAX}"`);
    expect(html).toContain('dir="auto"');
    expect(html).not.toContain('role="status"');
  });

  test("saving, saved, and not saved say where the notes are", () => {
    expect(notes({ state: { kind: "pending" } })).toContain("Saving…");
    expect(
      notes({
        state: { kind: "saved", at: Date.parse("2026-10-10T11:02:00Z") },
      }),
    ).toMatch(/Saved at \d{1,2}:\d{2}/);
    const bad = notes({
      state: { kind: "failed", message: "x", retryAt: Date.now() + 30_000 },
    });
    expect(bad).toContain(
      "Not saved, kept on this device. Trying again in 30 seconds.",
    );
    expect(bad).toContain("var(--warning)");
  });

  test("the intro's last part is the line for the closer", () => {
    expect(
      notes({ label: "For the closer", value: "Partner decides" }),
    ).toContain("For the closer");
  });

  test("near the limit it counts down", () => {
    expect(notes({ value: "x".repeat(PART_NOTE_MAX - 100) })).toContain(
      "100 left",
    );
    expect(notes({ value: "x".repeat(100) })).not.toContain("left");
  });
});
