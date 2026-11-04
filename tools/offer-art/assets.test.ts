import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import selection from "./selection.website.json";
import { assertBudget } from "./export";
import { COCKPIT_ART } from "./paths";
import { INK_Y, PAL, hueDelta, hueOf, luminance, oklab } from "./palette";
import { rgbPixels } from "./run";
test("exports satisfy dimensions, bytes and the quiet background palette", async () => {
  const sizes: {id: string; bytes: number}[] = [];
  for (const image of selection.images) {
    const path = join(COCKPIT_ART,image.file);
    sizes.push({id:image.id,bytes:(await readFile(path)).length});
    const {dims,px} = await rgbPixels(path);
    expect(dims).toEqual({width:1920,height:1080});
    let r=0,g=0,b=0,max=0;
    for(let i=0;i<px.length;i+=3){
      r+=px[i]; g+=px[i+1]; b+=px[i+2];
      max=Math.max(max,luminance([px[i]/255,px[i+1]/255,px[i+2]/255]));
    }
    expect(max).toBeLessThanOrEqual(INK_Y);
    if(image.id!=="hero"){
      const count=px.length/3;
      const mean=oklab([r/count/255,g/count/255,b/count/255]);
      expect(mean.L).toBeLessThan(0.43);
      expect(Math.abs(hueDelta(hueOf(mean),hueOf(PAL.space)))).toBeLessThan(40);
    }
  }
  expect(()=>assertBudget(sizes)).not.toThrow();
},60000);
