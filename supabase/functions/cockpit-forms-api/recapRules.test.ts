import { describe, expect, test } from "bun:test";
import { BOOKING_BLOCK, checkRecap, recapText, splitRecap } from "./recapRules.ts";

const CLEAN = "هلا! شكرًا على وقتك اليوم.\n\nالمطلوب من جهتكم:\n- ترسلون ملفات الشعار\n- تأكدون موعد التصوير\n\nفريق مهارة";
const refusal = (m: string, opts?: Parameters<typeof checkRecap>[1]) => checkRecap(m, opts).refusal;
const rule = (m: string, name: string, opts?: Parameters<typeof checkRecap>[1]) => checkRecap(m, opts).checks.find(c => c.rule === name);

describe("the 14 recap checks", () => {
  test("a clean recap passes every check, and its text ends with Make [23]'s block, verbatim, once", () => {
    const v = checkRecap(CLEAN);
    expect(v.refusal).toBeNull();
    expect(v.warnings).toEqual([]);
    expect(v.checks.map(c => c.rule)).toEqual([
      "leads", "money", "guarantee", "warranty", "internal", "markdown", "dashes", "script", "contractor", "length", "empty", "booking", "reference", "one_a_day", "stored",
    ]);
    expect(v.checks.every(c => c.ok && c.note === null)).toBe(true);
    expect(recapText(CLEAN)).toBe(`${CLEAN}\n\nإذا ما حجزت مكالمة المتابعة لين الحين، تقدر تحجزها من هنا:\nhttps://api.leadconnectorhq.com/widget/booking/SHjlq0UjeR11maltYNyh\nعادة نخلي أسبوع تقريبًا بين مكالمات المتابعة، عشان يكون فيه تقدم واضح نستعرضه معك.`);
  });

  test("1. leads and cost per lead are refused in both languages; وليد, تقليدي, مواليد and leadership pass", () => {
    for (const bad of ["وصلتكم ليدز وايد", "الليدات زادت", "للليد الجديد", "ليداتكم", "عملاء محتملين", "more leads this week", "the CPL dropped", "cost per lead"]) expect(rule(bad, "leads")?.ok).toBe(false);
    for (const fine of ["وليد بيتواصل معكم", "تصميم تقليدي", "مواليد الشهر", "great leadership", "mislead"]) expect(rule(fine, "leads")?.ok).toBe(true);
  });

  test("1. the singular عميل محتمل is refused too; عميل alone passes", () => {
    for (const bad of ["جاكم عميل محتمل", "العميل المحتمل تواصل", "عميل  محتملة"]) expect(rule(bad, "leads")?.ok).toBe(false);
    for (const fine of ["عميلكم راضي", "عميل جديد", "من المحتمل نخلص باجر"]) expect(rule(fine, "leads")?.ok).toBe(true);
  });

  test("2. a digit beside a currency or cost word is refused; a digit alone passes", () => {
    for (const bad of ["صرفنا ٥٠٠ دولار", "$200 this month", "200 KWD", "التكلفة ٣ دينار", "تكلفة 12", "cost 50", "CPB 12", "1.5 ألف دولار", "٢٠٠ ريال"]) expect(rule(bad, "money")?.ok).toBe(false);
    for (const fine of ["نرسل لكم ٣ تصاميم", "دولار", "باجر الساعة 10"]) expect(rule(fine, "money")?.ok).toBe(true);
  });

  test("2. Kuwait's own marks, dirham and AED are money, either side of the digit", () => {
    for (const bad of ["الميزانية 500 KD هالشهر", "KD 500", "500kd", "500 k.d.", "٥٠٠ د.ك", "د.ك ٥٠٠", "٥٠٠ درهم", "٥ دراهم", "٣ دنانير", "500 AED", "AED 500"]) expect(rule(bad, "money")?.ok).toBe(false);
    // Those letters inside a name or a word are not money.
    for (const fine of ["Raed 5 ايام", "kids 5", "the 5 kdrama", "عنده.ك 5"]) expect(rule(fine, "money")?.ok).toBe(true);
  });

  test("2. the no-hamza الاف is a scale, and a spelled amount of a currency is money with no digit at all", () => {
    for (const bad of ["١٠ الاف دولار", "عشرة آلاف دولار", "عشرة الاف دولار", "ألف دينار", "الف ريال", "ألفين دولار", "مليون درهم", "ملايين الدولارات", "بألف دولار", "وبألف دولار", "الألف دينار"])
      expect(rule(bad, "money")?.ok).toBe(false);
    for (const fine of ["ألف شكر", "الف مبروك", "١٠ آلاف متابع", "تحالف دولار", "مخالف ريال"]) expect(rule(fine, "money")?.ok).toBe(true);
  });

  test("3. a guarantee is refused; ضمان is a warning, since it can mean a warranty", () => {
    for (const bad of ["نضمن لكم النتيجة", "النتيجة مضمونة", "we guarantee results", "guaranteed bookings", "أضمن لك نتايج", "احنا ضامنين لك مشاريع", "انا ضامن"]) expect(refusal(bad)).toBe("The recap promised a result. Client messages never guarantee one. Draft again.");
    const w = checkRecap("الضمان على التركيب سنة");
    expect(w.refusal).toBeNull();
    expect(w.warnings).toEqual(["The recap says ضمان. Check that it means a warranty, not a promised result."]);
  });

  test("3. the words that only hold those letters pass: يتضمن and تضامن promise nothing", () => {
    for (const fine of ["الخطة تتضمن ثلاث خطوات", "يتضمن التقرير", "تضامن الفريق", "متضامنين معكم"]) expect(rule(fine, "guarantee")?.ok).toBe(true);
  });

  test("4. internal words are refused, in Latin script and in Arabic; the verb make and platform pass", () => {
    for (const bad of ["Make sends it", "ClickUp", "Typeform", "Fathom recording", "the form", "the transcript", "DEFCON", "your grade", "عبوا الفورم"]) expect(rule(bad, "internal")?.ok).toBe(false);
    for (const fine of ["we will make it work", "the platform", "information"]) expect(rule(fine, "internal")?.ok).toBe(true);
  });

  test("5 to 8. markdown, an em dash or guillemets, another script and مقاول are refused", () => {
    expect(rule("**مهم**", "markdown")?.ok).toBe(false);
    expect(rule("# عنوان", "markdown")?.ok).toBe(false);
    expect(rule("*مهم* تمام", "markdown")?.ok).toBe(true);
    for (const bad of ["تمام — نكمل", "«تمام»", "تمام – نكمل", "تمام ― نكمل"]) expect(rule(bad, "dashes")?.ok).toBe(false);
    expect(refusal("تمام – نكمل")).toBe("The recap used a long dash or guillemets. Draft again.");
    expect(rule("الموعد 10-12", "dashes")?.ok).toBe(true);
    expect(rule("تمام.. نكمل", "dashes")?.ok).toBe(true);
    for (const bad of ["안녕", "你好", "こんにちは", "привет"]) expect(rule(`تمام ${bad}`, "script")?.ok).toBe(false);
    expect(rule("شركتكم مقاولات", "contractor")?.ok).toBe(false);
  });

  test("9. over 1,200 characters before the block is a warning; 10. an empty message without skip is refused", () => {
    const long = checkRecap(`${"تمام ".repeat(250)}`);
    expect(long.refusal).toBeNull();
    expect(long.warnings).toEqual(["The recap is longer than 1,200 characters before the booking block."]);
    expect(refusal("   ")).toBe("The recap came back empty. Draft again.");
    expect(rule("", "empty", { skip: true })?.ok).toBe(true);
  });

  test("11 and 12. the booking block exactly once, at the end, and no reference line", () => {
    expect(rule(`${CLEAN}\nhttps://api.leadconnectorhq.com/widget/booking/SHjlq0UjeR11maltYNyh`, "booking")?.ok).toBe(false);
    expect(rule(CLEAN, "booking", { text: CLEAN })?.ok).toBe(false);
    expect(rule(CLEAN, "booking", { text: `${CLEAN}\n\n${BOOKING_BLOCK}` })?.ok).toBe(true);
    expect(rule(CLEAN, "reference", { text: `${recapText(CLEAN)}\n\nمرجع المتابعة: BG-12` })?.ok).toBe(false);
  });

  test("13. a team message already today is a warning (2b); 14. the preview equals what is stored, byte for byte", () => {
    expect(checkRecap(CLEAN, { teamToday: true }).warnings).toEqual(["The group already had a team message today."]);
    expect(checkRecap(CLEAN, { teamToday: null }).warnings).toEqual([]);
    expect(rule(CLEAN, "stored", { stored: recapText(CLEAN) })?.ok).toBe(true);
    expect(rule(CLEAN, "stored", { stored: `${recapText(CLEAN)} ` })?.ok).toBe(false);
  });

  test("the first refusal is the draft's sentence", () => {
    expect(refusal("وصلتكم ليدز بـ ٥٠٠ دولار")).toBe("The recap mentioned leads or cost per lead, which client messages never do. Draft again.");
  });
});

describe("splitRecap (2b, recap.approve)", () => {
  test("a reviewer's full text splits back into the message and Make's block, byte for byte", () => {
    expect(splitRecap(recapText(CLEAN))).toEqual([CLEAN, BOOKING_BLOCK]);
    const spaced = `${CLEAN}  \n\n${BOOKING_BLOCK}`;
    expect(splitRecap(spaced)).toEqual([`${CLEAN}  `, BOOKING_BLOCK]);
  });

  test("no block at the end, an edited block or one after a single line break: the text whole and no block", () => {
    expect(splitRecap(CLEAN)).toEqual([CLEAN, null]);
    expect(splitRecap(`${CLEAN}\n${BOOKING_BLOCK}`)).toEqual([`${CLEAN}\n${BOOKING_BLOCK}`, null]);
    const edited = `${CLEAN}\n\n${BOOKING_BLOCK.replace("لين الحين", "الحين")}`;
    expect(splitRecap(edited)).toEqual([edited, null]);
    expect(splitRecap(`${recapText(CLEAN)} `)[1]).toBeNull();
  });

  test("a doubled block keeps one in the message, which the booking rule then refuses", () => {
    const doubled = `${recapText(CLEAN)}\n\n${BOOKING_BLOCK}`;
    const [message, block] = splitRecap(doubled);
    expect(block).toBe(BOOKING_BLOCK);
    expect(message).toBe(recapText(CLEAN));
    expect(checkRecap(message, { text: doubled, stored: doubled }).refusal).toBe("The booking link must appear exactly once, at the end. Draft again.");
  });
});
