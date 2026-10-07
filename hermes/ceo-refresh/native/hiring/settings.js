import {runtime} from "../../runtime.ts";
const rest=path=>runtime().tools.rest(path);
export function railSummary(s) {
    if (s.sender === "gohighlevel")
        return "GoHighLevel sends these, on email and SMS";
    const on = [s.email && "email", s.sms && "SMS"].filter(Boolean);
    if (!on.length)
        return "No rail is on";
    const base = on.join(" and ");
    return s.whatsappFallback ? `${base}, WhatsApp as backup` : base;
}
export const SETTINGS_KEY = "engine";
export const DEFAULT_SETTINGS = {
    sender: "gohighlevel",
    armed: false,
    actions: {
        loom_request: true,
        group_invite: true,
        test_project: true,
        // An offer is the one message that should never leave without a person
        // reading it first.
        offer: false,
        rejection: true,
        bench_note: true,
    },
    email: true,
    sms: true,
    whatsappFallback: true,
    staleDays: 7,
};
export async function settings() {
    const rows = await rest(`cockpit_hiring_meta?key=eq.${SETTINGS_KEY}&select=value&limit=1`);
    const held = rows?.[0]?.value;
    return {
        ...DEFAULT_SETTINGS,
        ...held,
        actions: { ...DEFAULT_SETTINGS.actions, ...(held?.actions ?? {}) },
    };
}
