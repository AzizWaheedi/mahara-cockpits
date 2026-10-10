// The Zoom link card and the WhatsApp group kit as they draw (2026-10-10):
// what the rep sees for each host, a lead who cannot get WhatsApp, the
// moment the meeting is being made, a refusal, and the group's steps.
//
// bun test src/components/ZoomLink.test.tsx

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// The Supabase client needs the build's settings; nothing here reaches it.
mock.module("../lib/supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
  SUPABASE_URL: "https://example.invalid",
  PROPOSALS_BUCKET: "sales-proposals",
}));
mock.module("../lib/api", () => ({
  api: async () => ({}),
}));

const { ZoomLinkCard } = await import("./ZoomLink");
const { GroupKit } = await import("./GroupKit");

const LINK = "https://us06web.zoom.us/j/81234567890?pwd=EnCrYpTeD.1";
const lead = {
  name: "Sara Al Ali",
  phone: "+96550000000",
  dnd: false,
};
const ready = (host: "own" | "shared", warning: string | null = null) =>
  ({
    at: "ready",
    answer: {
      link: {
        id: "00000000-0000-4000-8000-000000000001",
        join_url: LINK,
        kind: "intro",
        host,
        host_name: "Aziz Waheedi",
        made_at: "2026-10-10T11:02:00Z",
      },
      reused: false,
      warning,
      rep: { name: "Tahreer Ali", name_ar: "تحرير" },
    },
  }) as const;

const card = (p: Parameters<typeof ZoomLinkCard>[0]) =>
  renderToStaticMarkup(<ZoomLinkCard {...p} />);
const none = () => undefined;

describe("the Zoom link card", () => {
  test("shared host: the link, the message in English, WhatsApp on the lead's number, Join the call", () => {
    const html = card({
      lead,
      phase: ready("shared"),
      initialLang: "en",
      onFresh: none,
      onRetry: none,
    });
    expect(html).toContain("Zoom link for <bdi>Sara</bdi>");
    expect(html).toContain(
      "Nothing goes to <bdi>Sara</bdi> until you send it.",
    );
    expect(html).toContain(`href="${LINK.replace(/&/g, "&amp;")}"`);
    const msg = `Hi Sara, your call with Tahreer from Mahara Media is ready. Join here:\n${LINK}`;
    expect(html).toContain(
      `href="https://wa.me/96550000000?text=${encodeURIComponent(msg)}"`,
    );
    expect(html).toContain("Send on WhatsApp");
    expect(html).toContain("Copy the message");
    expect(html).toContain(
      "Shared Zoom: you and <bdi>Sara</bdi> join with this link.",
    );
    expect(html).toContain("Join the call");
    expect(html).not.toContain("Start the meeting");
    expect(html).toContain("Pressing again gives this same link for 12 hours.");
    expect(html).toContain("Make a new link");
  });

  test("the Arabic message names the rep by their Arabic name, right to left", () => {
    const html = card({
      lead,
      phase: ready("shared"),
      initialLang: "ar",
      onFresh: none,
      onRetry: none,
    });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain(
      "هلا Sara، مكالمتك مع تحرير من مهارة ميديا جاهزة. ادخل من هني:",
    );
  });

  test("own host: Start the meeting, never a Join button", () => {
    const html = card({
      lead,
      phase: ready("own"),
      initialLang: "en",
      onFresh: none,
      onRetry: none,
    });
    expect(html).toContain("You host it. They wait until you start.");
    expect(html).toContain("Start the meeting");
    expect(html).not.toContain("Join the call");
  });

  test("do not disturb, or no country code: no WhatsApp button, the sentence instead", () => {
    const dnd = card({
      lead: { ...lead, dnd: true },
      phase: ready("shared"),
      initialLang: "en",
      onFresh: none,
      onRetry: none,
    });
    expect(dnd).not.toContain("Send on WhatsApp");
    expect(dnd).toContain("Do not disturb is on in HighLevel");
    const local = card({
      lead: { ...lead, phone: "50000000" },
      phase: ready("shared"),
      initialLang: "en",
      onFresh: none,
      onRetry: none,
    });
    expect(local).not.toContain("wa.me");
    expect(local).toContain("no country code");
  });

  test("the busy shared host's warning", () => {
    const html = card({
      lead,
      phase: ready(
        "shared",
        "The shared Zoom is in another meeting right now.",
      ),
      initialLang: "en",
      onFresh: none,
      onRetry: none,
    });
    expect(html).toContain("callout-warn");
    expect(html).toContain("in another meeting right now");
  });

  test("while the meeting is made, and when it is refused", () => {
    const making = card({
      lead,
      phase: { at: "making" },
      initialLang: "en",
      onFresh: none,
      onRetry: none,
    });
    expect(making).toContain("Making the meeting…");
    expect(making).toContain("motion-safe:animate-ping");
    expect(making).not.toContain("Send on WhatsApp");
    const failed = card({
      lead,
      phase: {
        at: "failed",
        error: "Zoom links are switched off. Ask Aziz to switch them on.",
      },
      initialLang: "en",
      onFresh: none,
      onRetry: none,
    });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain(
      "Zoom links are switched off. Ask Aziz to switch them on.",
    );
    expect(failed).toContain("Try again");
  });

  test("no name: the card still reads", () => {
    const html = card({
      lead: { ...lead, name: null },
      phase: ready("shared"),
      initialLang: "en",
      onFresh: none,
      onRetry: none,
    });
    expect(html).toContain("Zoom link for <bdi>this lead</bdi>");
  });
});

const fullLead = {
  contact_id: "lead-11",
  name: "Sara Al Ali",
  email: null,
  phone: "+96550000000",
  phone8: "50000000",
  company: "Al Noor Interiors",
  country: "KW",
  tags: [],
  dnd: false,
} as unknown as Parameters<typeof GroupKit>[0]["lead"];
const me = { signed_in: true, email: "tahreer@maharamedia.com", seat: true };
const demo = {
  appointment_id: "a11",
  start_at: "2026-10-11T15:00:00Z",
  assigned_user_name: "Ahmed Abu Shaiba",
};

describe("the WhatsApp group kit", () => {
  test("the four steps, the group's name, the invite button and the welcome", () => {
    const html = renderToStaticMarkup(
      <GroupKit lead={fullLead} me={me} demo={demo} lang="en" />,
    );
    expect(html).toContain("WhatsApp group");
    expect(html).toContain("Al Noor Interiors | Mahara Media");
    expect(html).toContain(
      "In WhatsApp: New group, add <bdi>Ahmed</bdi>, paste the name,",
    );
    expect(html).toContain("Then Group info, Invite via link, Copy link.");
    expect(html).toContain("Send the invite to <bdi>Sara</bdi>");
    expect(html).toContain(
      "Welcome, Sara. Ahmed is here too and will take your demo on Sun 11 Oct at 6:00 pm Kuwait time. Any question before then, ask here.",
    );
    expect(html).toContain("Group made");
    expect(html).toContain("Save <bdi>Sara</bdi>&#x27;s contact");
    expect((html.match(/<li /g) ?? []).length).toBe(4);
  });

  test("Arabic: the welcome in the lead's language, right to left", () => {
    const html = renderToStaticMarkup(
      <GroupKit lead={fullLead} me={me} demo={demo} lang="ar" compact />,
    );
    expect(html).toContain('dir="rtl"');
    expect(html).toContain(
      "هلا والله Sara. معانا هني Ahmed، اللي بيكون معاك بالديمو الأحد ١١ أكتوبر الساعة ٦ المغرب بتوقيت الكويت.",
    );
  });

  test("do not disturb: no invite button, the sentence instead", () => {
    const html = renderToStaticMarkup(
      <GroupKit
        lead={{ ...fullLead, dnd: true }}
        me={me}
        demo={demo}
        lang="en"
      />,
    );
    expect(html).not.toContain("Send the invite to <bdi>");
    expect(html).toContain("Copy the invite");
    expect(html).toContain("Do not disturb is on in HighLevel");
  });

  test("nothing for an active client, or with no demo booked", () => {
    expect(
      renderToStaticMarkup(
        <GroupKit
          lead={{ ...fullLead, tags: ["client"] }}
          me={me}
          demo={demo}
        />,
      ),
    ).toBe("");
    expect(
      renderToStaticMarkup(<GroupKit lead={fullLead} me={me} demo={null} />),
    ).toBe("");
  });
});
