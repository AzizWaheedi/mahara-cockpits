// op recap.approve (messages.ts; docs/forms/STAGE2B-CONTRACT.md build 3): the exact
// text checked, fingerprinted and approved as the verified seat. The recap text
// is invented; the booking block is Make [23]'s, verbatim (recapRules.ts).
import { describe, expect, test } from "bun:test";
import { RpcError } from "../cockpit-hours-sync/db.ts";
import { makeDoor } from "./door.ts";
import { sha256 } from "./drafts.ts";
import {
  approveRecap,
  forReviewer,
  MESSAGE_MAX,
  SAY_MESSAGES,
} from "./messages.ts";
import { BOOKING_BLOCK } from "./recapRules.ts";
import {
  csmActor,
  fakeDeps,
  opOf,
  SEAT_TOKEN,
  SERVICE_KEY,
} from "./testkit.ts";

const MID = "66666666-6666-4666-8666-666666666666";
const CLEAN =
  "هلا! شكرًا على وقتك اليوم.\n\nالمطلوب من جهتكم:\n- ترسلون ملفات الشعار\n- تأكدون موعد التصوير\n\nفريق مهارة";
const full = (message: string) => `${message}\n\n${BOOKING_BLOCK}`;
/** The stored row as cockpit_client_message_approve returns it (3.7's MessageView, invented). */
const STORED = {
  id: MID,
  kind: "recap_checkin",
  state: "approved",
  taskId: "86exCITYW",
  clientName: "City Wood",
  approvedBy: "the CSM",
};

function world(
  o: { state?: string; teamToday?: boolean | null; approve?: unknown } = {},
) {
  return fakeDeps({
    seat: {
      cockpit_client_message_read: {
        id: MID,
        kind: "recap_checkin",
        state: o.state ?? "draft",
        taskId: "86exCITYW",
        clientName: "City Wood",
        body: full(CLEAN),
      },
    },
    rpc: {
      cockpit_forms_actor: csmActor,
      cockpit_client_message_team_today:
        o.teamToday === undefined ? false : o.teamToday,
      cockpit_client_message_approve: o.approve ?? STORED,
    },
  });
}
const approve = (f: ReturnType<typeof world>, body: Record<string, unknown>) =>
  approveRecap(opOf(f.deps), { messageId: MID, ...body });
const refusal = async (
  f: ReturnType<typeof world>,
  body: Record<string, unknown>,
) => {
  try {
    await approve(f, body);
  } catch (e) {
    return {
      message: (e as Error).message,
      status: (e as { status?: number }).status,
    };
  }
  throw new Error("Expected a refusal");
};

describe("recap.approve", () => {
  test("a clean text is approved: the exact text, its sha256, the verified seat, no warnings", async () => {
    const f = world();
    const text = full(CLEAN);
    expect(await approve(f, { body: text })).toEqual({
      message: STORED,
      warnings: [],
    });
    expect(
      f.seat.named("cockpit_client_message_read").map(c => c.args),
    ).toEqual([{ p_id: MID }]);
    expect(
      f.service.named("cockpit_client_message_team_today").map(c => c.args),
    ).toEqual([{ p_task_id: "86exCITYW" }]);
    expect(
      f.service.named("cockpit_client_message_approve").map(c => c.args),
    ).toEqual([
      {
        p_id: MID,
        p_body: text,
        p_body_sha256: await sha256(text),
        p_actor: csmActor.actorId,
        p_warnings: [],
      },
    ]);
  });

  test("a money figure blocks, in the reviewer's words; nothing is approved", async () => {
    const f = world();
    expect(
      await refusal(f, { body: full(`${CLEAN}\nصرفنا ٥٠٠ دولار`) }),
    ).toEqual({
      message:
        "The recap quoted a money figure. Client messages carry no amounts. Edit the text, then approve again.",
      status: 400,
    });
    expect(f.service.named("cockpit_client_message_approve")).toEqual([]);
  });

  test("an edited, missing or doubled booking block is refused", async () => {
    for (const body of [
      `${CLEAN}\n\n${BOOKING_BLOCK.replace("لين الحين", "الحين")}`,
      CLEAN,
      `${full(CLEAN)}\n\n${BOOKING_BLOCK}`,
      `${CLEAN}\n${BOOKING_BLOCK}`,
      `${full(CLEAN)} `,
    ]) {
      const f = world();
      expect(await refusal(f, { body })).toEqual({
        message:
          "The booking link must appear exactly once, at the end. Edit the text, then approve again.",
        status: 400,
      });
      expect(f.service.named("cockpit_client_message_approve")).toEqual([]);
    }
  });

  test(`over ${MESSAGE_MAX.toLocaleString("en")} characters is refused`, async () => {
    const f = world();
    const long = full(`${CLEAN}\n${"ت".repeat(MESSAGE_MAX)}`);
    expect(await refusal(f, { body: long })).toEqual({
      message: SAY_MESSAGES.tooLong,
      status: 400,
    });
    expect(f.service.named("cockpit_client_message_approve")).toEqual([]);
  });

  test("warnings answer needsConfirm with no approve RPC; Approve anyway passes them on", async () => {
    const f = world({ teamToday: true });
    const text = full(`${CLEAN}\nالضمان على التركيب سنة`);
    const warnings = [
      "The recap says ضمان. Check that it means a warranty, not a promised result.",
      "The group already had a team message today.",
    ];
    expect(await approve(f, { body: text })).toEqual({
      needsConfirm: true,
      warnings,
    });
    expect(f.service.named("cockpit_client_message_approve")).toEqual([]);
    expect(await approve(f, { body: text, acceptWarnings: true })).toEqual({
      message: STORED,
      warnings,
    });
    expect(
      f.service.named("cockpit_client_message_approve")[0].args.p_warnings,
    ).toEqual(warnings);
  });

  test("sha256 on the exact UTF-8 bytes: an edit of one space is another fingerprint, and nothing is trimmed", async () => {
    const f = world();
    const edited = full(`${CLEAN.replace("اليوم.", "اليوم. ")}`);
    await approve(f, { body: edited });
    const sent = f.service.named("cockpit_client_message_approve")[0].args;
    expect(sent.p_body).toBe(edited);
    expect(sent.p_body_sha256).toBe(await sha256(edited));
    expect(sent.p_body_sha256).not.toBe(await sha256(full(CLEAN)));
    expect(await sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("p_actor is the verified seat, never an id from the browser", async () => {
    const f = world();
    await approve(f, {
      body: full(CLEAN),
      actorId: "99999999-9999-4999-8999-999999999999",
      p_actor: "99999999-9999-4999-8999-999999999999",
    });
    expect(
      f.service.named("cockpit_client_message_approve")[0].args.p_actor,
    ).toBe(csmActor.actorId);
  });

  test("only a draft row is approved; the seat's gate refusal is the database's sentence", async () => {
    const f = world({ state: "approved" });
    expect(await refusal(f, { body: full(CLEAN) })).toEqual({
      message: SAY_MESSAGES.notDraft,
      status: 400,
    });
    const gated = world();
    gated.seat.handlers.cockpit_client_message_read = () => {
      throw new RpcError("That client is not on your access list", "42501");
    };
    await expect(approve(gated, { body: full(CLEAN) })).rejects.toThrow(
      "That client is not on your access list",
    );
    expect(gated.service.named("cockpit_client_message_approve")).toEqual([]);
  });

  test("a bad message id or no text is refused before anything is read", async () => {
    const f = world();
    expect(
      await refusal(f, { messageId: "not-a-uuid", body: full(CLEAN) }),
    ).toEqual({ message: SAY_MESSAGES.open, status: 400 });
    expect(await refusal(f, { body: 12 })).toEqual({
      message: SAY_MESSAGES.noText,
      status: 400,
    });
    expect(f.seat.calls).toEqual([]);
  });

  test("the reviewer's tail replaces Draft again. only at the end", () => {
    expect(
      forReviewer(
        "The recap used ** or #, which WhatsApp shows as symbols. Draft again.",
      ),
    ).toBe(
      "The recap used ** or #, which WhatsApp shows as symbols. Edit the text, then approve again.",
    );
    expect(
      forReviewer("The preview differs from the stored text. Draft again."),
    ).toBe(
      "The preview differs from the stored text. Edit the text, then approve again.",
    );
  });
});

describe("the door routes recap.approve as a seat op", () => {
  const post = (body: unknown, auth: string) =>
    new Request("https://example.test/functions/v1/cockpit-forms-api", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify(body),
    });

  test("a seat approves; the approve RPC's refusal (the owner gate) is its sentence with 400", async () => {
    const f = world();
    const res = await makeDoor(f.deps)(
      post(
        { op: "recap.approve", messageId: MID, body: full(CLEAN) },
        SEAT_TOKEN,
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: STORED, warnings: [] });
    const gated = world({
      approve: () => {
        throw new RpcError(
          "Make still sends 1-1 recaps until the switch-over, so this one is not sent from here.",
          "22023",
        );
      },
    });
    const refused = await makeDoor(gated.deps)(
      post(
        { op: "recap.approve", messageId: MID, body: full(CLEAN) },
        SEAT_TOKEN,
      ),
    );
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({
      error:
        "Make still sends 1-1 recaps until the switch-over, so this one is not sent from here.",
    });
  });

  // notices' hand-off (20261029v): the approve RPC's own sentences reach the reviewer word for word, a seat
  // the database refuses (42501) is a 403 with its sentence, and a card with no linked group is no warning.
  test("the approve RPC's refusals reach the browser word for word", async () => {
    const cases: [string, string, number][] = [
      [
        "The text changed after it was checked. Approve it again.",
        "22023",
        400,
      ],
      [
        "The recap is empty or over 4,096 characters. Edit the text, then approve again.",
        "22023",
        400,
      ],
      [
        "This recap is already approved. It sends within about 3 minutes.",
        "22023",
        400,
      ],
      [
        "This recap may already be in the group. Look in the group; the tech lead settles it.",
        "22023",
        400,
      ],
      ["Sign in to the cockpit first.", "42501", 403],
    ];
    for (const [sentence, code, status] of cases) {
      const f = world({
        approve: () => {
          throw new RpcError(sentence, code);
        },
      });
      const res = await makeDoor(f.deps)(
        post(
          { op: "recap.approve", messageId: MID, body: full(CLEAN) },
          SEAT_TOKEN,
        ),
      );
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error: sentence });
      expect(f.service.named("cockpit_client_message_approve")).toHaveLength(1);
    }
  });

  test("no WhatsApp group linked (team_today answers null) is no warning, and the recap is approved", async () => {
    const f = world({ teamToday: null });
    const res = await makeDoor(f.deps)(
      post(
        { op: "recap.approve", messageId: MID, body: full(CLEAN) },
        SEAT_TOKEN,
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: STORED, warnings: [] });
    expect(
      f.service.named("cockpit_client_message_approve")[0].args.p_warnings,
    ).toEqual([]);
  });

  test("the service key is still refused", async () => {
    const f = world();
    const res = await makeDoor(f.deps)(
      post(
        { op: "recap.approve", messageId: MID, body: full(CLEAN) },
        `Bearer ${SERVICE_KEY}`,
      ),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "The service key runs the doctor only.",
    });
    expect(f.service.named("cockpit_client_message_approve")).toEqual([]);
  });
});
