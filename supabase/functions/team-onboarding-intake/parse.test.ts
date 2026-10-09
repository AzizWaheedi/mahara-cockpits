import { describe, expect, it } from "bun:test";
import { parseSubmission } from "./parse";
import { signedByTypeform, typeformSignature } from "./signature";

const choice = (ref: string, label: string) => ({ id: `id_${ref}`, ref, label });

// The shape Typeform posts: groups in the definition, answers keyed by field.
function payload(over: Record<string, unknown> = {}) {
  return {
    event_id: "evt",
    event_type: "form_response",
    form_response: {
      form_id: "Cef2QGBh",
      token: "tok123",
      submitted_at: "2026-10-10T07:30:00Z",
      variables: [{ key: "score", type: "number", number: 1 }],
      definition: {
        id: "Cef2QGBh",
        fields: [
          {
            id: "g1", ref: "g_about", type: "group", title: "First, the basics.",
            properties: {
              fields: [
                { id: "f1", ref: "full_name", type: "short_text", title: "What is your full name?" },
                { id: "f2", ref: "work_email", type: "email", title: "What is your Mahara email?" },
                { id: "f3", ref: "role", type: "dropdown", title: "Which role are you joining in?",
                  choices: [choice("role_mb", "Media buyer"), choice("role_csm", "Client success manager")] },
              ],
            },
          },
          { id: "q1", ref: "q_hours", type: "multiple_choice", title: "When are our core working hours?",
            choices: [choice("q_hours_c", "Saturday to Thursday, 10 am to 6 pm"), choice("q_hours_w1", "Sunday to Thursday, 9 am to 5 pm")] },
          { id: "q2", ref: "q_reply", type: "multiple_choice", title: "By when do you reply?",
            choices: [choice("q_reply_w1", "By the end of the day"), choice("q_reply_c", "By 12:00 pm at the latest")] },
          { id: "t1", ref: "tools_done", type: "multiple_choice", title: "Tick everything you have already set up.",
            choices: [choice("t_slack_profile", "Slack profile"), choice("t_clickup", "ClickUp"), choice("t_none", "None of these yet")] },
          { id: "s1", ref: "speed_down", type: "number", title: "Download speed?" },
          { id: "b1", ref: "backup_net", type: "yes_no", title: "Backup connection?" },
          { id: "m1", ref: "goal_money_12m", type: "short_text", title: "Earning in 12 months?" },
          { id: "m2", ref: "goal_career_3y", type: "long_text", title: "In 3 years?" },
          { id: "x1", ref: "something_new", type: "short_text", title: "A question this file has not met" },
        ],
      },
      answers: [
        { type: "text", text: "  Test Person ", field: { id: "f1", type: "short_text", ref: "full_name" } },
        { type: "email", email: "Test.Person@MaharaMedia.com", field: { id: "f2", type: "email", ref: "work_email" } },
        { type: "choice", choice: { id: "id_role_mb", ref: "role_mb", label: "Media buyer" }, field: { id: "f3", type: "dropdown", ref: "role" } },
        { type: "choice", choice: { id: "id_q_hours_c", ref: "q_hours_c", label: "Saturday to Thursday, 10 am to 6 pm" }, field: { id: "q1", type: "multiple_choice", ref: "q_hours" } },
        // No ref on the choice: found by its label.
        { type: "choice", choice: { id: "id_q_reply_w1", label: "By the end of the day" }, field: { id: "q2", type: "multiple_choice", ref: "q_reply" } },
        { type: "choices", choices: { ids: ["id_t_clickup"], labels: ["ClickUp"], refs: ["t_clickup"] }, field: { id: "t1", type: "multiple_choice", ref: "tools_done" } },
        { type: "number", number: 48, field: { id: "s1", type: "number", ref: "speed_down" } },
        { type: "boolean", boolean: false, field: { id: "b1", type: "yes_no", ref: "backup_net" } },
        { type: "text", text: "1,500 KWD a month", field: { id: "m1", type: "short_text", ref: "goal_money_12m" } },
        { type: "text", text: "Head of media buying", field: { id: "m2", type: "long_text", ref: "goal_career_3y" } },
        { type: "text", text: "kept", field: { id: "x1", type: "short_text", ref: "something_new" } },
      ],
      ...over,
    },
  };
}

describe("onboarding submission", () => {
  it("reads who it is, their goals, setup and workspace", () => {
    const s = parseSubmission(payload());
    expect(s.responseToken).toBe("tok123");
    expect(s.formId).toBe("Cef2QGBh");
    expect(s.fullName).toBe("Test Person");
    expect(s.email).toBe("test.person@maharamedia.com");
    expect(s.roleLabel).toBe("Media buyer");
    expect(s.goals).toEqual({ money12m: "1,500 KWD a month", career3y: "Head of media buying" });
    expect(s.setup).toEqual({ done: ["ClickUp"], missing: ["Slack profile"], blocked: null });
    expect(s.workspace).toEqual({ device: null, speedMbps: 48, backup: false, cameraAndMic: null, quietSpace: null });
  });

  it("keeps Typeform's score and works out the missed topics, with or without choice refs", () => {
    const s = parseSubmission(payload());
    expect(s.score).toBe(1);
    expect(s.scoreMax).toBe(2);
    expect(s.missed).toEqual([
      { ref: "q_reply", topic: "Reply time", answered: "By the end of the day", correct: "By 12:00 pm at the latest" },
    ]);
  });

  it("lists every non-quiz answer in form order and keeps unknown fields under More", () => {
    const s = parseSubmission(payload());
    expect(s.answers.map(a => a.ref)).toEqual([
      "full_name", "work_email", "role", "tools_done", "speed_down", "backup_net", "goal_money_12m", "goal_career_3y", "something_new",
    ]);
    expect(s.answers.find(a => a.ref === "something_new")?.section).toBe("More");
    expect(s.answers.find(a => a.ref === "goal_money_12m")?.section).toBe("Goals");
  });

  it("refuses something that is not a submission", () => {
    expect(() => parseSubmission({})).toThrow();
    expect(() => parseSubmission(payload({ token: "" }))).toThrow();
    expect(() => parseSubmission(payload({ submitted_at: "not a date" }))).toThrow();
  });
});

describe("Typeform signature", () => {
  const secret = "a-long-test-secret-value";
  it("accepts the exact body Typeform signed and nothing else", async () => {
    const body = JSON.stringify(payload());
    const header = await typeformSignature(secret, body);
    expect(header.startsWith("sha256=")).toBe(true);
    expect(await signedByTypeform(secret, body, header)).toBe(true);
    expect(await signedByTypeform(secret, body + " ", header)).toBe(false);
    expect(await signedByTypeform("another-long-secret-value", body, header)).toBe(false);
    expect(await signedByTypeform(secret, body, null)).toBe(false);
    expect(await signedByTypeform(undefined, body, header)).toBe(false);
    expect(await signedByTypeform("short", body, await typeformSignature("short", body))).toBe(false);
  });
});
