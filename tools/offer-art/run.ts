/**
 * The two outside programs the art tool leans on, ffmpeg and ffprobe, run
 * with plain arguments (never a shell), so a path cannot become a command.
 */

export async function run(cmd: string[], what: string): Promise<Uint8Array> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).arrayBuffer(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  if (code !== 0) {
    throw new Error(`${what} failed (exit ${code}): ${err.trim().slice(-500)}`);
  }
  return new Uint8Array(out);
}

export interface Dims {
  width: number;
  height: number;
}

/** Width and height of an image's first stream. */
export async function probe(file: string): Promise<Dims> {
  const out = await run(
    [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0:s=x",
      file,
    ],
    `Reading the size of ${file}`,
  );
  const [w, h] = new TextDecoder().decode(out).trim().split("x").map(Number);
  if (!(w > 0 && h > 0)) throw new Error(`ffprobe found no picture in ${file}`);
  return { width: w, height: h };
}

/** Every pixel of an image as 8-bit RGB, decoded by ffmpeg at its own size. */
export async function rgbPixels(
  file: string,
): Promise<{ dims: Dims; px: Uint8Array }> {
  const dims = await probe(file);
  const px = await run(
    [
      "ffmpeg",
      "-v",
      "error",
      "-i",
      file,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ],
    `Decoding ${file}`,
  );
  if (px.length !== dims.width * dims.height * 3) {
    throw new Error(`Decoding ${file} gave ${px.length} bytes, not a full frame`);
  }
  return { dims, px };
}
