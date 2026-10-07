import {runtime} from "../../runtime.ts";
export const TAP_KEY_NAME = "TAP_SECRET_KEY";
export const USD_PER = {
    USD: 1,
    KWD: 3.26,
    AED: 0.2723,
    SAR: 0.2666,
    QAR: 0.2747,
};

export function tapKeyState(){const key=runtime().env(TAP_KEY_NAME);return !key?"missing":/^sk_test/i.test(key)?"test":"live";}
