/**
 * A sheet of every drawn variant, raw and graded side by side, to pick from
 * by eye (review/raw-sheet.jpg). Nothing here is shipped.
 *
 *   bun review.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cube } from "./grade";
import { readJobs } from "./higgsfield";
import { DIRS, SET_DIR } from "./paths";
import { run } from "./run";

const FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf";

async function main() {
  mkdirSync(DIRS.review, { recursive: true });
  const lut = join(SET_DIR, "review.cube");
  writeFileSync(lut, cube());
  const done = readJobs().filter(j => j.status === "completed" && j.file);
  if (!done.length) {
    console.log("review: nothing drawn yet.");
    return;
  }
  const tiles: string[] = [];
  for (const j of done) {
    const out = join(DIRS.review, `${j.variant}.jpg`);
    // Left: as drawn. Right: through the grade, uncut.
    const vf = [
      "[0:v]scale=640:360,split[a][b]",
      `[b]format=rgb48le,lut3d=file='${lut}':interp=tetrahedral,format=rgb24[g]`,
      "[a][g]hstack=inputs=2,format=yuv420p,",
    ].join(";");
    const label = `drawtext=fontfile=${FONT}:text='${j.variant}  raw | graded':x=12:y=12:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=6`;
    await run(
      [
        "ffmpeg",
        "-y",
        "-v",
        "error",
        "-i",
        j.file as string,
        "-filter_complex",
        `${vf}${label}`,
        "-frames:v",
        "1",
        "-q:v",
        "4",
        out,
      ],
      `Reviewing ${j.variant}`,
    );
    tiles.push(out);
  }
  const sheet = join(DIRS.review, "raw-sheet.jpg");
  const inputs = tiles.flatMap(t => ["-i", t]);
  await run(
    [
      "ffmpeg",
      "-y",
      "-v",
      "error",
      ...inputs,
      "-filter_complex",
      `${tiles.map((_, i) => `[${i}:v]`).join("")}vstack=inputs=${tiles.length}`,
      "-frames:v",
      "1",
      "-q:v",
      "5",
      sheet,
    ],
    "Stacking the review sheet",
  );
  console.log(`review: ${sheet} (${tiles.length} variants)`);
}

if (import.meta.main) await main();
