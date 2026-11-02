/** Reuse approved masters. This command never contacts a generation provider. */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { basename, join } from "node:path";
import selection from "./selection.website.json";
import { BUDGET, COCKPIT_ART, DIRS, EXPORT_SIZE, SITE_ART } from "./paths";
import { probe, rgbPixels, run } from "./run";
import { INK_Y, luminance } from "./palette";

export const QUALITY = [88, 84, 80, 76, 72, 68, 64] as const;
export const hash = (bytes: Uint8Array, algorithm = "sha256") =>
  createHash(algorithm).update(bytes).digest("hex");
export const limitFor = (id: string) => id === "hero" ? BUDGET.hero : BUDGET.background;
export function checkSelection() {
  const ids = new Set<string>();
  for (const item of selection.images) {
    if (ids.has(item.id) || basename(item.source) !== item.source || basename(item.file) !== item.file || !/^[a-f0-9]{32}$/.test(item.md5)) throw new Error("Invalid source selection");
    if (!item.alt.en.startsWith("Example:") || !item.alt.ar.startsWith("مثال:")) throw new Error("Example label missing");
    ids.add(item.id);
  }
  if (ids.size !== 4 || !ids.has("hero")) throw new Error("The set needs a hero and three backgrounds");
}
/** A separate quiet-text export, not another creative LUT on the master. */
export function filterFor(treatment: string, reserve = 12) {
  if (!Number.isInteger(reserve) || reserve < 2 || reserve > 48) throw new Error("Invalid highlight reserve");
  const cap = `lutrgb=r='min(${242-reserve},val)':g='min(${246-reserve},val)':b='min(${250-reserve},val)'`;
  const quiet = "lutrgb=r='val*0.32+9*0.68':g='val*0.32+19*0.68':b='val*0.32+51*0.68'";
  if (!["highlight-cap", "quiet-navy"].includes(treatment)) throw new Error("Unknown treatment");
  return `scale=${EXPORT_SIZE.width}:${EXPORT_SIZE.height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${EXPORT_SIZE.width}:${EXPORT_SIZE.height},setsar=1,${treatment === "quiet-navy" ? `${quiet},` : ""}${cap}`;
}
export function assertBudget(images: {id: string; bytes: number}[]) {
  if (images.some((i) => i.bytes <= 0 || i.bytes > limitFor(i.id))) throw new Error("Image exceeds its byte budget");
  if (images.reduce((n, i) => n + i.bytes, 0) > BUDGET.total) throw new Error("Set exceeds its byte budget");
}
export async function exportSet() {
  if (platform() === "darwin") throw new Error("Exports run on the VPS only. Do not encode on the Mac.");
  checkSelection();
  const source = process.env.OFFER_ART_SOURCE || join(homedir(), selection.sourceDirectory);
  const stage = join(DIRS.export, `staging-${process.pid}`);
  await mkdir(stage, {recursive:true});
  const images = [];
  try {
    // Check every input before spending time encoding any of them.
    for (const item of selection.images) {
      if (hash(await readFile(join(source, item.source)), "md5") !== item.md5) throw new Error(`Master checksum changed: ${item.source}`);
    }
    for (const item of selection.images) {
      const out = join(stage, item.file);
      let accepted: {quality: number; bytes: number; sha256: string; highlightReserve:number; maxLuminance:number} | null = null;
      for (const reserve of [12,20,28,36,44]) {
        for (const quality of QUALITY) {
          await run(["ffmpeg", "-v", "error", "-y", "-i", join(source, item.source), "-vf", filterFor(item.treatment,reserve), "-frames:v", "1", "-c:v", "libwebp", "-quality", String(quality), "-compression_level", "6", "-map_metadata", "-1", out], `Export ${item.file}`);
          const bytes = await readFile(out);
          if (bytes.length <= limitFor(item.id)) {
            // Lossy WebP can overshoot the input cap at sharp lighting edges.
            // Measure decoded output and adjust the export, never its test limit.
            const {px}=await rgbPixels(out);
            let peak=0;
            for(let i=0;i<px.length;i+=3) peak=Math.max(peak,luminance([px[i]/255,px[i+1]/255,px[i+2]/255]));
            if(peak<=INK_Y) accepted={quality,bytes:bytes.length,sha256:hash(bytes),highlightReserve:reserve,maxLuminance:peak};
            break;
          }
        }
        if(accepted) break;
      }
      if (!accepted) throw new Error(`Cannot fit ${item.file} within decoded Ink and byte limits without going below quality ${QUALITY.at(-1)}`);
      const dims = await probe(out);
      if (dims.width !== EXPORT_SIZE.width || dims.height !== EXPORT_SIZE.height) throw new Error(`Wrong dimensions: ${item.file}`);
      images.push({...item, ...dims, ...accepted});
    }
    assertBudget(images);
    const manifest = {version:1, offer:selection.offer, example:selection.example, sourceGrade:selection.sourceGrade, motion:null, images};
    // Encode everything first; only complete, verified sets are copied to consumers.
    for (const destination of [COCKPIT_ART, SITE_ART]) {
      await mkdir(destination, {recursive:true});
      for (const item of images) {
        const temporary = join(destination, `${item.file}.new`);
        await writeFile(temporary, await readFile(join(stage, item.file)));
        await rename(temporary, join(destination, item.file));
      }
      await writeFile(join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    }
    await writeFile(join(DIRS.export, "report.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Exported ${images.length} images, ${images.reduce((n,i)=>n+i.bytes,0)} bytes per consumer. Final visual review still required.`);
  } finally { await rm(stage, {recursive:true, force:true}); }
}
if (import.meta.main) await exportSet();
