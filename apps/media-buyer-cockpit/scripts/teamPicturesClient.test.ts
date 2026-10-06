import { expect, test } from "bun:test";
import { createClient } from "@supabase/supabase-js";
import { teamPicturesAction } from "../src/lib/teamPicturesClient";

function fixture(
  handler: (body: Record<string, unknown>) => Response | Promise<Response>,
) {
  let actor = "11111111-1111-4111-8111-111111111111";
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const client = createClient(
    "https://project.supabase.co",
    "public-test-key",
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: "picture-test-session",
        storage: {
          getItem() {
            return JSON.stringify({
              access_token: `${btoa("{}")}.${btoa(JSON.stringify({ sub: actor, exp: expires }))}.test`,
              refresh_token: "test-refresh",
              expires_at: expires,
              expires_in: 3600,
              token_type: "bearer",
              user: {
                id: actor,
                email: "seat@example.com",
                app_metadata: {},
                user_metadata: {},
                aud: "authenticated",
                created_at: "2026-01-01",
              },
            });
          },
          setItem() {},
          removeItem() {},
        },
      },
      global: {
        fetch: async (_url, init) =>
          handler(
            JSON.parse(String(init?.body)) as Record<string, unknown>,
          ),
      },
    },
  );
  return {
    client,
    changeActor() {
      actor = "22222222-2222-4222-8222-222222222222";
    },
  };
}
const args = { meetingId: "daily", contentType: "image/png", bytes: 20 };
const reply = {
  path: "daily/2026-10/0123456789abcdef0123456789abcdef.png",
  uploadUrl: "https://project.supabase.co/storage/upload?token=secret",
};

test("failed writes reuse the same request ID and confirmed new uploads get a fresh one", async () => {
  const requests: Record<string, unknown>[] = [];
  const { client } = fixture(body => {
    requests.push(body);
    return Response.json(
      requests.length === 1 ? { error: "Retry the same picture" } : reply,
      { status: requests.length === 1 ? 503 : 200 },
    );
  });
  await expect(
    teamPicturesAction(client, "teamPictures.upload", args),
  ).rejects.toThrow("Retry");
  await teamPicturesAction(client, "teamPictures.upload", args);
  await teamPicturesAction(client, "teamPictures.upload", args);
  expect(requests[0].requestId).toBe(requests[1].requestId);
  expect(requests[2].requestId).not.toBe(requests[1].requestId);
});
test("a signed URL from a previous account is not returned after an account switch", async () => {
  const state = fixture(() => {
    state.changeActor();
    return Response.json(reply);
  });
  await expect(
    teamPicturesAction(state.client, "teamPictures.upload", args),
  ).rejects.toThrow("account changed");
});
test("a mismatched meeting response is rejected instead of returning its signed URL", async () => {
  const { client } = fixture(() =>
    Response.json({
      ...reply,
      path: reply.path.replace("daily/", "other/"),
    }),
  );
  await expect(
    teamPicturesAction(client, "teamPictures.upload", args),
  ).rejects.toThrow("this meeting");
});
