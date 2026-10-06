import {runtime} from "../runtime.ts";
const rest=(path)=>runtime().tools.rest(path);
import { DEFAULT_WORKING_HOURS, WORKING_HOURS_KEY, workingHoursFromStored, } from "./workingHours.js";
const TABLE = "cockpit_settings";
const MIGRATION = "supabase/migrations/20260921a_cockpit_settings.sql";
const brief = (e) => String(e instanceof Error ? e.message : e)
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 160);
async function readWorkingHours() {
    try {
        const rows = await rest(`${TABLE}?key=eq.${WORKING_HOURS_KEY}&select=key,value,updated_by,updated_at&limit=1`);
        if (rows === null)
            return {
                hours: DEFAULT_WORKING_HOURS,
                ready: false,
                problem: `The cockpit_settings table does not exist yet. Run ${MIGRATION} first.`,
            };
        const row = rows[0];
        if (!row)
            return { hours: DEFAULT_WORKING_HOURS, ready: true, problem: null };
        const at = Date.parse(String(row.updated_at ?? ""));
        const hours = workingHoursFromStored(row.value, Number.isFinite(at) ? at : null);
        if (!hours)
            return {
                hours: DEFAULT_WORKING_HOURS,
                ready: true,
                problem: "The saved working hours could not be read, so the default is in force. Save them again from the Calls tab.",
            };
        return { hours, ready: true, problem: null };
    }
    catch (e) {
        return {
            hours: DEFAULT_WORKING_HOURS,
            ready: true,
            problem: `Could not read cockpit_settings: ${brief(e)}`,
        };
    }
}
export async function workingHoursForAdapters() {
    return readWorkingHours();
}
