// deno test --no-remote supabase/functions/_shared/hiring
// Mapping: Typeform answers, GoHighLevel contacts and cards, the board's
// ids, and the draft layout that sendDraft reads back.
import { compose, draftText, parseDraft, TEMPLATES, varsFor } from "./engine.ts";
import { answersOf, answerText, mapAnswers, titlesOf, transcript } from "./intake.ts";
import { buildMeta, parseFields, parsePipelines } from "./meta.ts";
import { contactFlat, parseOpp } from "./mirror.ts";
import { redact } from "./providers.ts";
import { roleByKey } from "./spec.ts";
import { assert, CUSTOM_FIELDS, PIPELINES, test } from "./testkit.ts";

test("answerText reads every Typeform answer shape", () => {
  assert.equal(answerText({ type: "choice", choice: { label: "Khaliji" } }), "Khaliji");
  assert.equal(answerText({ type: "choices", choices: { labels: ["Meta", "Snap"], other: "X" } }), "Meta, Snap, X");
  assert.equal(answerText({ type: "boolean", boolean: false }), "No");
  assert.equal(answerText({ type: "file_url", file_url: "https://f/cv.pdf" }), "https://f/cv.pdf");
  assert.equal(answerText({ type: "email", email: "a@b.co" }), "a@b.co");
  assert.equal(answerText({ type: "number", number: 4 }), "4");
  assert.equal(answerText(null), "");
});

test("mapAnswers picks fields by what the question is, not its ref", () => {
  const def = {
    fields: [
      { ref: "n", title: "Your full name" },
      { ref: "e", title: "Email" },
      { ref: "p", title: "Phone" },
      { ref: "g", title: "Group", properties: { fields: [{ ref: "y", title: "Years of experience?" }] } },
      { ref: "nat", title: "Nationality" },
      { ref: "city", title: "Which city are you located in?" },
      { ref: "cv", title: "Upload your CV" },
      { ref: "ar", title: "Arabic level" },
      { ref: "src", title: "Where did you hear about us?" },
      { ref: "soon", title: "How soon can you start?" },
    ],
  };
  const item = {
    token: "tok1",
    answers: [
      { field: { ref: "n", type: "short_text" }, type: "text", text: "Sara Ali" },
      { field: { ref: "e", type: "email" }, type: "email", email: "sara@example.com" },
      { field: { ref: "p", type: "phone_number" }, type: "phone_number", phone_number: "+96550000000" },
      { field: { ref: "y", type: "number" }, type: "number", number: 4 },
      { field: { ref: "nat", type: "short_text" }, type: "text", text: "Egyptian" },
      { field: { ref: "city", type: "short_text" }, type: "text", text: "Cairo" },
      { field: { ref: "cv", type: "file_upload" }, type: "file_url", file_url: "https://f/cv.pdf" },
      { field: { ref: "ar", type: "multiple_choice" }, type: "choice", choice: { label: "Native" } },
      { field: { ref: "src", type: "multiple_choice" }, type: "choice", choice: { label: "LinkedIn" } },
      { field: { ref: "soon", type: "short_text" }, type: "text", text: "Two weeks" },
    ],
  };
  const answers = answersOf(item, titlesOf(def));
  const f = mapAnswers(answers);
  assert.deepEqual(f, {
    name: "Sara Ali",
    email: "sara@example.com",
    phone: "+96550000000",
    country: "Egyptian, Cairo",
    years: "4",
    arabic: "Native",
    portfolio: "https://f/cv.pdf",
    source: "LinkedIn",
    startsIn: "Two weeks",
  });
  const note = transcript(answers, "Media Buyer Application");
  assert.ok(note.startsWith("Application, Media Buyer Application\n\n"));
  assert.ok(note.includes("Your full name\nSara Ali"));
});

test("contactFlat puts custom field values on the spec keys", () => {
  const keyOf = new Map([["f-s1", "scoreApplication"], ["f-notes", "notes"]]);
  const flat = contactFlat(
    {
      contactName: " Sara Ali ",
      country: "EG",
      customFields: [
        { id: "f-s1", value: "7" },
        { id: "f-notes", fieldValue: ["a", "b"] },
        { id: "unknown", value: "ignored" },
      ],
    },
    keyOf,
  );
  assert.deepEqual(flat, { name: "Sara Ali", country: "EG", source: "", scoreApplication: "7", notes: "a, b" });
});

test("parseOpp reads a card whichever shape GoHighLevel returns", () => {
  assert.deepEqual(
    parseOpp({ id: 1, contact: { id: "c", name: " N " }, pipelineStageId: "s", createdAt: "2026-10-01" }),
    { id: "1", contactId: "c", name: "N", stageId: "s", createdAt: "2026-10-01", updatedAt: null },
  );
  assert.equal(parseOpp({ id: "2", contactId: "c2", name: "M" }).contactId, "c2");
});

test("buildMeta matches the board by name, a role's own stage label included", () => {
  const m = buildMeta("loc-1", parsePipelines(PIPELINES), parseFields(CUSTOM_FIELDS), 5);
  assert.equal(m.pipelines["media-buyer"], "p-mb");
  // The media buyer board calls the Loom stage "Case studies".
  assert.equal(m.stageKeyById["s-loom"], "loom");
  assert.equal(m.stageIdByKey["media-buyer"]["one-to-one"], "s-121");
  assert.equal(m.fields.scoreApplication, "f-s1");
  assert.equal(m.fields.loomUrl, undefined);
  assert.ok(m.missing.includes("Video editor"));
  assert.ok(!m.missing.includes("Media buyer"));
});

test("a draft is composed from the custom values and read back whole", () => {
  const role = roleByKey("media-buyer")!;
  const values = new Map([["hiring - owner name", "Aziz"]]);
  const msg = compose(TEMPLATES.loom_request, varsFor(role, "Sara Ali", values));
  assert.ok(msg.body.startsWith("Hi Sara,"));
  assert.ok(!/\n{3,}/.test(msg.body), "an empty value leaves no gap");
  assert.ok(!msg.body.includes("{{"));
  const text = draftText("the engine is disarmed", msg);
  const parts = parseDraft(text)!;
  assert.equal(parts.subject, msg.subject);
  assert.equal(parts.message, msg.body);
  assert.equal(parts.sms, msg.sms);
  assert.equal(parseDraft("Could not send: refused"), null);
});

test("redact strips tokens from anything that might be logged", () => {
  const s = redact("pit-1234abcd-0000-1111 Bearer abc.def tfp_secretvalue123");
  assert.ok(!s.includes("1234abcd") && !s.includes("abc.def") && !s.includes("secretvalue"));
});
