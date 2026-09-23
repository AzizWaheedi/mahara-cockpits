"use node";
import { v } from "convex/values";
import { extractText, getDocumentProxy } from "unpdf";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { authenticatedAction } from "../functions";

/**
 * The bank's PDF statement, read on the server (Aziz, 2026-09-21: "Here is
 * the statement. It's just because there's nothing that makes it go
 * automatically"). pdf.js (unpdf) gives the text page by page; bank.ts reads
 * the rows out of it and bankImport.ts keeps them, the same way as a CSV
 * export. A scanned statement has no text layer and is refused with a plain
 * sentence rather than imported as nothing.
 */

/** The PDF's text, pages separated by a form feed, in the order pdf.js met the words. */
export async function pdfText(base64: string): Promise<string> {
  // atob is global on Node 16+ and needs no Buffer types in the site build.
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return (text as string[]).join("\n\f\n");
}

const MAX_BASE64 = 12_000_000;

type Runner = {
  runAction: (ref: any, args: Record<string, unknown>) => Promise<any>;
};

async function importPdfAs(
  ctx: Runner,
  fileName: string,
  base64: string,
  by: string,
): Promise<unknown> {
  if (base64.length > MAX_BASE64)
    throw new Error("That PDF is over 8 MB; a statement is far smaller.");
  const text = await pdfText(base64);
  if (!text.trim())
    throw new Error(
      "No text could be read from that PDF. A scanned statement has no text layer; export the statement from CBK Online instead.",
    );
  return await ctx.runAction(internal.ceo.bankImport.importText, {
    fileName,
    text,
    by,
  });
}

export const importPdf = authenticatedAction({
  args: { fileName: v.string(), base64: v.string() },
  returns: v.any(),
  handler: async (ctx, { fileName, base64 }): Promise<unknown> => {
    const by: string = await ctx.runQuery(internal.ceo.ltv.whoami, {
      userId: ctx.userId,
    });
    return await importPdfAs(ctx, fileName, base64, by);
  },
});

/** The same door from the CLI, for a statement handed over outside the app. */
export const importPdfFile = internalAction({
  args: { fileName: v.string(), base64: v.string(), by: v.string() },
  returns: v.any(),
  handler: async (ctx, { fileName, base64, by }): Promise<unknown> =>
    await importPdfAs(ctx, fileName, base64, by),
});
