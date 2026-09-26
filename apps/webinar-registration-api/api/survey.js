// POST /api/survey  — Typeform "Mahara Media Free Gift Survey" (P1xP4r24) webhook handler
// Reads the answers, upserts the contact by email in GHL with tag webby-survey-done and the
// Webinar Profit Band / Webinar Survey Notes fields → fires WEBBY - W5 (SMS 14 + hot-lead alert).
import crypto from "node:crypto";
import { CFG, ghl, normalizePhone, isEmail } from "../lib/ghl.js";

export const config = { api: { bodyParser: false } }; // raw body needed for the signature check

const REF = {
  profit:   "8ca026ce-0a96-4cde-b679-cfda04ee0dfd", // ما هو صافي ربح شركتك آخر سنة؟
  years:    "5b7a691a-135b-4366-a624-160b5b83f9c5", // من متى وأنتم بالسوق؟
  focus:    "4d4e99e3-074d-4974-8500-40ee8dffb6bf", // شنو أكثر شي تشتغلون عليه؟
  blocker:  "b0bc49a4-f0d9-4466-837d-a6b692982785", // أكبر شي واقف بويه نمو شركتك
  goal:     "e14fb851-ab7f-4ebf-96c8-f25c74deb645", // الهدف السنوي للربح
  win:      "70ad73ff-f3ff-446a-99a9-409f034a2bd2", // شي واحد من التدريب يعتبره نجاح
  first:    "12bd11e4-3f5b-453d-adae-8711767aa2b8",
  last:     "c2e8fb25-bc2f-4bbb-bfa3-fc69d0a08e14",
  phone:    "288d7a23-720d-4444-bfc4-cb69d0829ed8",
  email:    "7f0722a2-f1e8-42c9-9546-dfedf0e50b55",
};

const readRaw = (req) => new Promise((resolve, reject) => { const chunks = []; req.on("data", c => chunks.push(c)); req.on("end", () => resolve(Buffer.concat(chunks))); req.on("error", reject); });

function answerValue(a) {
  if (!a) return "";
  switch (a.type) {
    case "choice": return a.choice?.label || a.choice?.other || "";
    case "choices": return (a.choices?.labels || []).join(", ");
    case "text": case "short_text": case "long_text": return a.text || "";
    case "email": return a.email || "";
    case "phone_number": return a.phone_number || "";
    case "number": return String(a.number ?? "");
    case "boolean": return a.boolean ? "yes" : "no";
    default: return a.text || a.email || a.phone_number || a.choice?.label || "";
  }
}

export default async function handler(req, res) {
  if (req.method === "GET") return res.status(200).json({ ok: true, endpoint: "survey", accepts: "POST from Typeform" });
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

  const raw = await readRaw(req);
  if (process.env.TYPEFORM_SECRET) {
    const sig = req.headers["typeform-signature"] || "";
    const expected = "sha256=" + crypto.createHmac("sha256", process.env.TYPEFORM_SECRET).update(raw).digest("base64");
    if (sig !== expected) return res.status(401).json({ ok: false, error: "bad signature" });
  }
  let payload; try { payload = JSON.parse(raw.toString("utf8")); } catch { return res.status(400).json({ ok: false, error: "invalid JSON" }); }

  const fr = payload.form_response || payload;
  const answers = fr.answers || [];
  const byRef = (ref) => answers.find(a => a.field?.ref === ref);
  const byType = (t) => answers.find(a => a.type === t);

  const email = (answerValue(byRef(REF.email)) || answerValue(byType("email")) || fr.hidden?.email || "").trim().toLowerCase();
  const phone = normalizePhone(answerValue(byRef(REF.phone)) || answerValue(byType("phone_number")) || fr.hidden?.phone);
  const firstName = answerValue(byRef(REF.first)).trim();
  const lastName  = answerValue(byRef(REF.last)).trim();
  const profit = answerValue(byRef(REF.profit)).trim();
  const notes = [
    ["الربح آخر سنة", profit],
    ["بالسوق من", answerValue(byRef(REF.years))],
    ["التركيز", answerValue(byRef(REF.focus))],
    ["أكبر عائق", answerValue(byRef(REF.blocker))],
    ["الهدف السنوي", answerValue(byRef(REF.goal))],
    ["يعتبره نجاح", answerValue(byRef(REF.win))],
    ["Typeform response", fr.token || fr.response_id || ""],
  ].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n");

  if (!isEmail(email) && !phone) return res.status(200).json({ ok: false, error: "no email or phone in response — nothing to match", ignored: true });

  try {
    const up = await ghl("POST", "/contacts/upsert", {
      locationId: CFG.locationId,
      email: isEmail(email) ? email : undefined,
      phone: phone || undefined,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      tags: ["webby-survey-done"],
      customFields: [
        { id: CFG.fields.profitBand,  field_value: profit },
        { id: CFG.fields.surveyNotes, field_value: notes },
      ],
    });
    return res.status(200).json({ ok: true, contactId: up?.contact?.id, profit });
  } catch (e) {
    console.error("survey failed", e);
    return res.status(502).json({ ok: false, error: String(e.message || e) });
  }
}
