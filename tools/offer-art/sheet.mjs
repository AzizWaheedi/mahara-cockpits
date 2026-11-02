/** A static contact sheet. Open on the VPS; no screenshot/render on the Mac. */
import { readFile, writeFile } from "node:fs/promises";
const selection = JSON.parse(await readFile(new URL("./selection.website.json", import.meta.url), "utf8"));
const escape = s => String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const cards = selection.images.map(i=>`<figure><img src="${escape(i.file)}" alt="${escape(i.alt.en)}"><figcaption>${escape(i.id)} · Example · ${escape(i.treatment)}</figcaption></figure>`).join("");
await writeFile(new URL("../../sites/offer/art/website/contact-sheet.html", import.meta.url), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Website art review</title><link rel="stylesheet" href="contact-sheet.css"><h1>Website art review · Example</h1><p>Check each full-size export for faces, writing, compression and crop. This page is review material, not client work.</p><main>${cards}</main></html>`);
await writeFile(new URL("../../sites/offer/art/website/contact-sheet.css", import.meta.url), "body{margin:32px;background:#091333;color:#f2f6fa;font:20px sans-serif}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px}figure{margin:0}img{width:100%;display:block}figcaption{padding:12px 0}");
