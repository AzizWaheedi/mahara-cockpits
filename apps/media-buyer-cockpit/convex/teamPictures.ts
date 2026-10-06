import { v } from "convex/values";
import { internal } from "./_generated/api";
import { type SbRow, storageLink } from "./ceo/sbWrite";
import { authenticatedAction } from "./functions";
import {
  bucket,
  logChange,
  meetingOrRefuse,
  noted,
  signPictures,
  type Who,
} from "./teamDb";
import {
  PICTURE_BUCKET,
  PICTURE_MAX_BYTES,
  PICTURE_PATH,
  PICTURE_TYPES,
  picturePath,
} from "./teamDoc";

/**
 * Pictures in a meeting's doc (2026-09-30): pasted, dropped or picked in
 * the editor, they go to the private team-docs bucket and the doc keeps
 * their path; the page signs a link for each when it reads the doc
 * (teamPage.ts). Anyone on the team who can edit the doc can add one, and
 * each one leaves a row in team_changes.
 *
 * The browser puts the file itself, through a one-time upload link, so a
 * screenshot never passes through an action. A picture pasted as a web
 * address (copied from a Google Doc or a page) is fetched here and copied
 * in, so the doc does not depend on a link that can expire.
 */

const TYPES_LINE = "Paste a PNG, JPEG, GIF or WebP picture.";

function hex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, "0")).join("");
}

const encPath = (path: string) =>
  path.split("/").map(encodeURIComponent).join("/");

/** A one-time link the browser puts one picture into, and where it will live. */
export const upload = authenticatedAction({
  args: { meetingId: v.string(), contentType: v.string(), bytes: v.number() },
  returns: v.any(),
  handler: (ctx, a): Promise<{ path: string; uploadUrl: string }> =>
    noted(ctx, async () => {
      await ctx.runQuery(internal.team.who, { userId: ctx.userId });
      await meetingOrRefuse(a.meetingId, "id");
      const ext = PICTURE_TYPES[a.contentType.toLowerCase()];
      if (!ext) throw new Error(TYPES_LINE);
      if (a.bytes > PICTURE_MAX_BYTES)
        throw new Error("That picture is over 10 MB. Paste a smaller one.");
      const path = picturePath(a.meetingId, ext, new Date(), hex(16));
      const out = (await bucket(
        `object/upload/sign/${PICTURE_BUCKET}/${encPath(path)}`,
        { method: "POST" },
      )) as SbRow;
      if (!out?.url)
        throw new Error("Supabase gave no upload link. Try again in a minute.");
      return { path, uploadUrl: storageLink(String(out.url)) };
    }),
});

/** The picture arrived: its link for the editor, and the change log's row. */
export const ready = authenticatedAction({
  args: { meetingId: v.string(), path: v.string() },
  returns: v.any(),
  handler: (ctx, a): Promise<{ path: string; url: string }> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      if (!PICTURE_PATH.test(a.path))
        throw new Error("That is not one of the doc's pictures.");
      const url = (await signPictures([a.path])).get(a.path);
      if (!url) throw new Error("The picture did not arrive. Paste it again.");
      await logChange(w.email, a.meetingId, "added a picture to the doc", {
        path: a.path,
      });
      return { path: a.path, url };
    }),
});

/** A picture pasted as a web address, copied into the bucket. */
export const fromUrl = authenticatedAction({
  args: { meetingId: v.string(), url: v.string() },
  returns: v.any(),
  handler: (ctx, a): Promise<{ path: string; url: string }> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      await meetingOrRefuse(a.meetingId, "id");
      let at: URL;
      try {
        at = new URL(a.url);
      } catch {
        throw new Error("That picture's address is not a web address.");
      }
      const host = at.hostname.toLowerCase();
      if (
        at.protocol !== "https:" ||
        host === "localhost" ||
        /^[\d.]+$/.test(host) ||
        host.includes(":") ||
        /\.(local|internal|localhost)$/.test(host)
      )
        throw new Error(
          "Only pictures on public https addresses can be copied in.",
        );
      const res = await fetch(at.toString(), { redirect: "follow" });
      if (!res.ok)
        throw new Error(`That picture could not be fetched (${res.status}).`);
      const type = (res.headers.get("content-type") ?? "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      const ext = PICTURE_TYPES[type];
      if (!ext) throw new Error(TYPES_LINE);
      const bytes = await res.arrayBuffer();
      if (bytes.byteLength > PICTURE_MAX_BYTES)
        throw new Error("That picture is over 10 MB. Paste a smaller one.");
      const path = picturePath(a.meetingId, ext, new Date(), hex(16));
      await bucket(`object/${PICTURE_BUCKET}/${encPath(path)}`, {
        method: "POST",
        bytes,
        contentType: type,
      });
      const url = (await signPictures([path])).get(path);
      if (!url)
        throw new Error(
          "The picture was copied but has no link yet. Paste it again.",
        );
      await logChange(w.email, a.meetingId, "copied a picture into the doc", {
        path,
        from: host,
      });
      return { path, url };
    }),
});
