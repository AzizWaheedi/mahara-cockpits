import { expect, test } from "bun:test";
import { createClient } from "@supabase/supabase-js";
import { readSearchAssets, type SearchAsset } from "../src/lib/assetSearch";
import { matchScore } from "../src/lib/search";

type StoredAsset = SearchAsset & { at: string };

function assetsFor(namespace: string, count: number): StoredAsset[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${namespace}-asset-${String(index).padStart(4, "0")}`,
    task_id: `${namespace}-job-${index}`,
    name: `${namespace}/clip-${index}.mp4`,
    transcript: "Ordinary footage from the project.",
    error: null,
    at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  }));
}

/** Only HTTP is replaced. The real Supabase client builds and parses every request. */
function clientFor(
  namespace: string,
  rows: StoredAsset[],
  options: { serverPageSize?: number; failFromOffset?: number } = {},
) {
  return createClient(`https://${namespace}.invalid`, "public-test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async input => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.pathname !== "/rest/v1/editor_assets") {
          return Response.json({ message: "Unknown fixture endpoint" }, { status: 404 });
        }
        const offset = Number(url.searchParams.get("offset") ?? 0);
        if (options.failFromOffset !== undefined && offset >= options.failFromOffset) {
          return Response.json(
            { code: "42501", message: "Asset access was revoked", details: null, hint: null },
            { status: 403 },
          );
        }
        const order = (url.searchParams.get("order") ?? "").split(",");
        const sorted = [...rows].sort((a, b) => {
          for (const part of order) {
            const [field, direction] = part.split(".");
            if (field !== "at" && field !== "id") continue;
            const compared = a[field].localeCompare(b[field]);
            if (compared) return direction === "desc" ? -compared : compared;
          }
          return 0;
        });
        const limit = Math.min(
          Number(url.searchParams.get("limit") ?? rows.length),
          options.serverPageSize ?? rows.length,
        );
        const page = sorted.slice(offset, offset + limit).map(({ at: _at, ...asset }) => asset);
        return Response.json(page);
      },
    },
  });
}

test("global search finds matching footage older than the gallery's first 300 assets", async () => {
  const rows = assetsFor("older-footage", 305);
  rows[0].transcript = "The antique brass staircase is ready.";
  const result = await readSearchAssets(clientFor("older-footage", rows));
  expect(result.error).toBeNull();
  const matches = result.data?.filter(asset =>
    matchScore(`${asset.name ?? ""} ${asset.transcript ?? ""}`, "antique brass staircase") > 0,
  );
  expect(matches?.map(asset => asset.id)).toEqual(["older-footage-asset-0000"]);
  expect(result.data).toHaveLength(305);
});

test("a short server page does not truncate the searchable asset history", async () => {
  const rows = assetsFor("short-pages", 307);
  rows[0].name = "short-pages/archived-courtyard.mp4";
  const result = await readSearchAssets(clientFor("short-pages", rows, { serverPageSize: 73 }));
  expect(result.error).toBeNull();
  expect(result.data).toHaveLength(307);
  expect(new Set(result.data?.map(asset => asset.id)).size).toBe(307);
  expect(result.data?.find(asset => asset.name === "short-pages/archived-courtyard.mp4")?.id)
    .toBe("short-pages-asset-0000");
});

test("equal asset timestamps retain stable ID ordering across page boundaries", async () => {
  const rows = assetsFor("tied-times", 303).map(asset => ({
    ...asset,
    at: "2026-01-01T00:00:00.000Z",
  }));
  const result = await readSearchAssets(clientFor("tied-times", rows));
  expect(result.error).toBeNull();
  expect(result.data).toHaveLength(303);
  expect(result.data?.slice(298).map(asset => asset.id)).toEqual([
    "tied-times-asset-0004",
    "tied-times-asset-0003",
    "tied-times-asset-0002",
    "tied-times-asset-0001",
    "tied-times-asset-0000",
  ]);
  expect(new Set(result.data?.map(asset => asset.id)).size).toBe(303);
});

test("a later-page read failure makes search unavailable instead of returning partial success", async () => {
  const rows = assetsFor("revoked-page", 305);
  const result = await readSearchAssets(clientFor("revoked-page", rows, { failFromOffset: 300 }));
  expect(result.data).toBeNull();
  expect(result.error?.message).toBe("Asset access was revoked");
});
