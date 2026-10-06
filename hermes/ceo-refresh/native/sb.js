import {runtime} from "../runtime.ts";
export const B2B="flwboeijllbtrufxkhts",TRIAGE="bldgtotkfmhoxmlzowdx";
export const sql=(project,query)=>runtime().read(project,query);
export {num} from "./numbers.js";
export function ms(x) {
    if (x === null || x === undefined || x === "")
        return undefined;
    // Postgres writes "2026-09-12 15:05:15+00": JavaScript needs "T" and "+00:00".
    let iso = String(x).trim().replace(" ", "T");
    if (/T\d{2}:\d{2}/.test(iso))
        iso = iso
            .replace(/([+-]\d{2})$/, "$1:00")
            .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    const t = new Date(iso).getTime();
    return Number.isFinite(t) ? t : undefined;
}
