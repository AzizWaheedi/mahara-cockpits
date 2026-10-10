import { expect, test } from "bun:test";
import {
  filteringCount,
  frictionSteps,
  fromMeta,
  type LeadFormSpec,
  newKey,
  problems,
  toMetaCreate,
  versionName,
} from "../src/lib/leadForm";

// A form as the Graph API reads it back (the shape of a real client form,
// Arabic and all), including fields the cockpit ignores.
const RAW = {
  id: "1234567890",
  name: "form 12/09",
  locale: "AR_AR",
  status: "ACTIVE",
  leads_count: 106,
  question_page_custom_headline: "سجل بياناتك وسيتواصل معك فريقنا",
  is_optimized_for_quality: false,
  questions: [
    {
      key: "ما_نوع_مشروعك؟",
      label: "ما نوع مشروعك؟",
      type: "CUSTOM",
      id: "q1",
      options: [
        { key: "سكني", value: "سكني" },
        { key: "تجاري", value: "تجاري" },
      ],
    },
    { key: "full_name", label: "Full name", type: "FULL_NAME", id: "q2" },
    { key: "phone_number", label: "Phone number", type: "PHONE", id: "q3" },
  ],
  context_card: {
    id: "cc1",
    title: "استشارة مجانية",
    style: "LIST_STYLE",
    content: ["تصميم داخلي", "تنفيذ"],
    button_text: "ابدأ",
  },
  thank_you_page: {
    id: "ty1",
    title: "شكراً لك",
    body: "سنتواصل معك خلال ٢٤ ساعة",
    button_type: "VIEW_WEBSITE",
    button_text: "زيارة الموقع",
    website_url: "https://example.com",
  },
  legal_content: {
    privacy_policy: {
      url: "https://example.com/privacy",
      link_text: "Privacy",
    },
  },
};

test("a Meta form reads back into the cockpit's shape, Arabic intact", () => {
  const spec = fromMeta(RAW);
  expect(spec.name).toBe("form 12/09");
  expect(spec.headline).toBe("سجل بياناتك وسيتواصل معك فريقنا");
  expect(spec.questions.map(q => q.type)).toEqual([
    "CUSTOM",
    "FULL_NAME",
    "PHONE",
  ]);
  expect(spec.questions[0]?.options?.map(o => o.value)).toEqual([
    "سكني",
    "تجاري",
  ]);
  expect(spec.intro).toEqual({
    title: "استشارة مجانية",
    style: "LIST_STYLE",
    content: ["تصميم داخلي", "تنفيذ"],
    buttonText: "ابدأ",
  });
  expect(spec.thankYou?.buttonType).toBe("VIEW_WEBSITE");
  expect(spec.thankYou?.websiteUrl).toBe("https://example.com");
  expect(spec.privacy).toEqual({
    url: "https://example.com/privacy",
    linkText: "Privacy",
  });
  expect(spec.higherIntent).toBe(false);
  expect(spec.smsVerify).toBe(false);
  expect(filteringCount(spec)).toBe(1);
  expect(problems(spec)).toEqual([]);
});

test("a bare form reads as every extra switched off, and asks for a privacy link", () => {
  const spec = fromMeta({
    name: "x",
    questions: [{ key: "phone", type: "PHONE" }],
    privacy_policy_url: "",
  });
  expect(spec.intro).toBeNull();
  expect(spec.thankYou).toBeNull();
  expect(frictionSteps(spec)).toEqual([]);
  expect(problems(spec).map(p => p.where)).toEqual(["privacy"]);
});

test("the older privacy field still reads, and a phone code question means SMS verification", () => {
  const spec = fromMeta({
    name: "y",
    privacy_policy_url: "https://example.com/p",
    questions: [{ key: "p", type: "PHONE_OTP" }],
  });
  expect(spec.privacy?.url).toBe("https://example.com/p");
  expect(spec.smsVerify).toBe(true);
});

const base = (): LeadFormSpec => fromMeta(RAW);

test("the checks catch what would publish broken", () => {
  const noContact: LeadFormSpec = {
    ...base(),
    questions: base().questions.filter(q => q.type === "CUSTOM"),
  };
  expect(problems(noContact).map(p => p.where)).toContain("questions");

  const oneAnswer = base();
  oneAnswer.questions[0] = {
    ...oneAnswer.questions[0]!,
    options: [{ key: "a", value: "a" }],
  };
  expect(problems(oneAnswer)[0]?.message).toMatch(/two answers or more/);

  const sms = {
    ...base(),
    smsVerify: true,
    questions: base().questions.filter(q => q.type !== "PHONE"),
  };
  expect(problems(sms).map(p => p.where)).toContain("smsVerify");

  const call = base();
  call.thankYou = {
    title: "Thanks",
    buttonType: "CALL_BUSINESS",
    phone: "abc",
  };
  expect(problems(call).map(p => p.where)).toContain("thankYou");

  const dupe = base();
  dupe.questions.push({ ...dupe.questions[1]! });
  expect(problems(dupe).some(p => /same key/.test(p.message))).toBe(true);
});

test("a new version is created with the same keys and every extra spelled out", () => {
  const spec = {
    ...base(),
    higherIntent: true,
    smsVerify: true,
    name: "form 12/09 · v2 · 2026-10-10",
  };
  const body = toMetaCreate(spec);
  expect(body.name).toBe("form 12/09 · v2 · 2026-10-10");
  expect(body.is_optimized_for_quality).toBe("true");
  expect(body.is_phone_sms_verify_enabled).toBe("true");
  expect(body.block_display_for_non_targeted_viewer).toBe("true");
  expect(JSON.parse(body.questions!)).toEqual([
    {
      type: "CUSTOM",
      key: "ما_نوع_مشروعك؟",
      label: "ما نوع مشروعك؟",
      options: [
        { key: "سكني", value: "سكني" },
        { key: "تجاري", value: "تجاري" },
      ],
    },
    { type: "FULL_NAME", key: "full_name" },
    { type: "PHONE", key: "phone_number" },
  ]);
  expect(JSON.parse(body.context_card!)).toEqual({
    title: "استشارة مجانية",
    style: "LIST_STYLE",
    content: ["تصميم داخلي", "تنفيذ"],
    button_text: "ابدأ",
  });
  expect(JSON.parse(body.thank_you_page!)).toEqual({
    title: "شكراً لك",
    body: "سنتواصل معك خلال ٢٤ ساعة",
    button_type: "VIEW_WEBSITE",
    button_text: "زيارة الموقع",
    website_url: "https://example.com",
  });
  expect(JSON.parse(body.privacy_policy!)).toEqual({
    url: "https://example.com/privacy",
    link_text: "Privacy",
  });
});

test("switching extras off leaves them out rather than sending empty objects", () => {
  const body = toMetaCreate({
    ...base(),
    intro: null,
    thankYou: null,
    smsVerify: false,
  });
  expect(body.context_card).toBeUndefined();
  expect(body.thank_you_page).toBeUndefined();
  expect(body.is_phone_sms_verify_enabled).toBeUndefined();
});

test("version names stay readable in Ads Manager and keys stay unique", () => {
  const at = new Date("2026-10-10T09:00:00Z");
  expect(versionName("form 12/09", at, 2)).toBe(
    "form 12/09 · v2 · 2026-10-10 12:00",
  );
  expect(versionName("form 12/09 · v2 · 2026-10-10 12:00", at, 3)).toBe(
    "form 12/09 · v3 · 2026-10-10 12:00",
  );
  expect(newKey(base())).toBe("question_1");
  expect(newKey({ questions: [{ key: "question_1", type: "CUSTOM" }] })).toBe(
    "question_2",
  );
});
