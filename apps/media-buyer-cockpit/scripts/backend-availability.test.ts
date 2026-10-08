import { describe, expect, test } from "bun:test";
import {
  CREATIVE_TRIAGE_ORIGIN,
  probeCockpitBackend,
} from "../src/lib/backendAvailability";

describe("probeCockpitBackend", () => {
  const validUrl = CREATIVE_TRIAGE_ORIGIN;
  const validKey = "sb_publishable_anon_key_test_123";

  test('malformed project configuration is down without a request', async () => {
    let calls=0;
    const mockFetch=(async()=>{calls++;return new Response(null,{status:405});}) as typeof fetch;
    expect(await probeCockpitBackend('not a project URL',validKey,mockFetch)).toBe('down');
    expect(calls).toBe(0);
  });

  test("returns 'up' when endpoint returns HTTP 405 (method guard established)", async () => {
    let capturedUrl = "";
    let capturedOptions: RequestInit | undefined;

    const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedOptions = init;
      return new Response(null, { status: 405 });
    }) as unknown as typeof fetch;

    const status = await probeCockpitBackend(validUrl, validKey, mockFetch);
    expect(status).toBe("up");
    expect(capturedUrl).toBe(`${validUrl}/functions/v1/cockpit-media-api`);
    expect(capturedOptions?.method).toBe("GET");
    expect(capturedOptions?.body).toBeUndefined();
    expect((capturedOptions?.headers as Record<string, string>)?.apikey).toBe(
      validKey,
    );
    expect(
      (capturedOptions?.headers as Record<string, string>)?.Authorization,
    ).toBe(`Bearer ${validKey}`);
  });

  test("returns 'down' on HTTP 401, 404, 500, or any non-405 status", async () => {
    for (const code of [401, 404, 500, 200, 400, 403]) {
      const mockFetch = (async () => {
        return new Response(null, { status: code });
      }) as unknown as typeof fetch;

      const status = await probeCockpitBackend(validUrl, validKey, mockFetch);
      expect(status).toBe("down");
    }
  });

  test("returns 'offline' on network failure without throwing", async () => {
    const mockFetch = (async () => {
      throw new Error("Network offline or DNS error");
    }) as unknown as typeof fetch;

    const status = await probeCockpitBackend(validUrl, validKey, mockFetch);
    expect(status).toBe("offline");
  });

  test("returns 'down' with no request when configuration is missing or empty", async () => {
    let called = false;
    const mockFetch = (async () => {
      called = true;
      return new Response(null, { status: 405 });
    }) as unknown as typeof fetch;

    expect(await probeCockpitBackend(undefined, validKey, mockFetch)).toBe("down");
    expect(await probeCockpitBackend(validUrl, undefined, mockFetch)).toBe("down");
    expect(await probeCockpitBackend("", validKey, mockFetch)).toBe("down");
    expect(await probeCockpitBackend(validUrl, "", mockFetch)).toBe("down");
    expect(await probeCockpitBackend(null, null, mockFetch)).toBe("down");
    expect(called).toBe(false);
  });

  test("returns 'down' with no request when origin is wrong or untrusted", async () => {
    let called = false;
    const mockFetch = (async () => {
      called = true;
      return new Response(null, { status: 405 });
    }) as unknown as typeof fetch;

    expect(
      await probeCockpitBackend("https://malicious-site.com", validKey, mockFetch),
    ).toBe("down");
    expect(
      await probeCockpitBackend("https://other-project.supabase.co", validKey, mockFetch),
    ).toBe("down");
    expect(called).toBe(false);
  });
});
