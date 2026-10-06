import {runtime} from "../../runtime.ts";
export const hiringConfigured=()=>Boolean(runtime().env("GHL_HIRING_PIT")&&runtime().env("GHL_HIRING_LOCATION"));
export const hiringLocation=()=>{const id=runtime().env("GHL_HIRING_LOCATION");if(!id)throw Error("GHL_HIRING_LOCATION is not configured");return id;};
