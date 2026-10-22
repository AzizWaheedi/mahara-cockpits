import { expect, test } from "bun:test";
import {
  answersLine,
  clean,
  describeChange,
  ICONS,
  newQuestionKey,
  type PageFormSpec,
  problems,
} from "../src/lib/pageForm";

// Merge Studio's launch questions, cut down to two (olivar-landing form.json).
const PHOTOS = ["type-villa", "type-apartment", "band-dining"];
const spec = (): PageFormSpec => ({
  questions: [
    {
      key: "project_type",
      name: "نوع المشروع",
      label: "شنو نوع مشروعك؟",
      hint: "اختر الأقرب لك.",
      style: "photo",
      options: [
        {
          value: "فيلا كاملة",
          desc: "تصميم داخلي متكامل للفيلا.",
          icon: "home",
          image: "type-villa",
        },
        {
          value: "شقة كاملة",
          desc: "تصميم كامل للمساحات.",
          icon: "building",
          image: "type-apartment",
        },
      ],
    },
    {
      key: "timing",
      name: "موعد البداية",
      label: "متى حاب تبدأ؟",
      style: "list",
      image: "band-dining",
      options: [
        { value: "بأقرب وقت", icon: "bolt" },
        { value: "خلال شهر", icon: "calendar" },
      ],
    },
  ],
});

test("the launch questions pass", () => {
  expect(problems(spec(), { photos: PHOTOS })).toEqual([]);
});

test("a question needs two answers, a CRM name and the question itself", () => {
  const s = spec();
  s.questions[1].options = [{ value: "بأقرب وقت" }];
  s.questions[1].name = " ";
  s.questions[1].label = "";
  const out = problems(s, { photos: PHOTOS });
  expect(out).toContain("Question 2 needs at least two answers.");
  expect(out).toContain("Question 2 needs a short name for the CRM.");
  expect(out).toContain("Question 2 needs the question itself.");
});

test("photo cards need a photo from the page's library on every answer", () => {
  const s = spec();
  s.questions[0].options[1].image = undefined;
  s.questions[0].options[0].image = "someone-elses-photo";
  const out = problems(s, { photos: PHOTOS });
  expect(out).toContain(
    "Question 1, answer 2 needs a photo (or show this question as a list).",
  );
  expect(out).toContain(
    "Question 1, answer 1: its photo is not in this page's photo library.",
  );
});

test("keys are unique, valid, and never reuse a removed question's key", () => {
  const s = spec();
  s.questions[1].key = "project_type";
  expect(problems(s, { photos: PHOTOS })).toContain(
    "Question 2 repeats another question's key.",
  );
  const t = spec();
  t.questions[1].key = "budget";
  expect(problems(t, { photos: PHOTOS, retired: ["budget"] })).toContain(
    "Question 2 reuses the key of a removed question.",
  );
  const u = spec();
  u.questions[1].key = "Bad Key";
  expect(problems(u, { photos: PHOTOS })).toContain(
    "Question 2 has no valid key.",
  );
});

test("duplicate answers, unknown icons and hidden characters are caught", () => {
  const s = spec();
  s.questions[1].options[1].value = "بأقرب وقت";
  s.questions[1].options[0].icon = "rocket";
  s.questions[0].label = "شنو نوع‮ مشروعك؟";
  const out = problems(s, { photos: PHOTOS });
  expect(out).toContain("Question 2, answer 2 repeats another answer.");
  expect(out).toContain("Question 2, answer 1: pick an icon from the list.");
  expect(out).toContain(
    "Question 1 contains hidden control characters. Retype it.",
  );
});

test("more than eight questions is refused", () => {
  const s = spec();
  for (let i = 0; i < 8; i++)
    s.questions.push({
      ...s.questions[1],
      key: `q_${i}`,
      name: `name ${i}`,
    });
  expect(problems(s, { photos: PHOTOS })[0]).toContain(
    "Keep it to 8 questions or fewer",
  );
});

test("clean trims, drops photo fields from lists and takes params only from the bindings", () => {
  const s = spec();
  s.questions[0].label = "  شنو نوع مشروعك؟  ";
  s.questions[0].param = "ms_attacker";
  s.questions[1].options[0].image = "type-villa";
  s.questions[1].options[0].desc = "not shown on a list";
  (s.questions[1] as any).extra = "dropped";
  const out = clean(s, { project_type: "ms_project_type" });
  expect(out.questions[0].label).toBe("شنو نوع مشروعك؟");
  expect(out.questions[0].param).toBe("ms_project_type");
  expect(out.questions[1].param).toBeUndefined();
  expect(out.questions[1].options[0]).toEqual({
    value: "بأقرب وقت",
    icon: "bolt",
  });
  expect((out.questions[1] as any).extra).toBeUndefined();
});

test("describeChange names what was added, removed, edited and moved", () => {
  const before = spec();
  const after = spec();
  after.questions.reverse();
  after.questions[0].label = "متى تبي تبدأ؟";
  after.questions.push({
    key: newQuestionKey(["project_type", "timing"]),
    name: "الميزانية",
    label: "كم الميزانية؟",
    style: "list",
    options: [{ value: "أقل من 10 آلاف" }, { value: "أكثر" }],
  });
  expect(describeChange(before, after)).toBe(
    'Added "الميزانية", edited "موعد البداية", reordered the questions',
  );
  const fewer = spec();
  fewer.questions.pop();
  expect(describeChange(before, fewer)).toBe('Removed "موعد البداية"');
  expect(describeChange(before, spec())).toBe("No change to the questions");
});

test("the Answers line matches the page's format", () => {
  expect(
    answersLine(spec(), { project_type: "فيلا كاملة", timing: "خلال شهر" }),
  ).toBe("نوع المشروع: فيلا كاملة | موعد البداية: خلال شهر");
});

test("new keys are valid and fresh", () => {
  const key = newQuestionKey([]);
  expect(key).toMatch(/^[a-z][a-z0-9_]{1,39}$/);
  expect(newQuestionKey([key])).not.toBe(key);
});

test("every icon the launch form uses exists", () => {
  for (const name of [
    "home",
    "building",
    "hammer",
    "crane",
    "dots",
    "sofa",
    "gear",
    "doc",
    "chat",
    "cube",
    "blocks",
    "key",
    "refresh",
    "bolt",
    "calendar",
    "clock",
    "plan-s",
    "plan-m",
    "plan-l",
    "plan-xl",
  ])
    expect(ICONS[name]).toBeTruthy();
});
