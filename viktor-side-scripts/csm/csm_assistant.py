# -*- coding: utf-8 -*-
"""The CSM's in-app assistant, answered from Mahara's own SOPs.

The Client Success app cannot call a model itself (in-app tool gateways return HTTP 500),
so questions are queued in the app's `asks` table and answered here on the next bridge
run. Grounding is Mahara's own material, never general advice:

- `references/client_communication_sop.md` — the Client Communication SOP, verbatim.
- The client's stored profile: their real numbers, stage, links and stale appointments.

The model is told to answer only from that material and to say so plainly when the SOP
does not cover the question — a made-up answer here reaches a paying client.
"""

import json
import os
import sys

sys.path.insert(0, "/work")
from sdk.tools.utils_tools import ai_structured_output  # noqa: E402

SOP_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "references",
    "client_communication_sop.md",
)
# The SOP is ~58KB. Sending it whole keeps the answer anchored in Mahara's wording.
SOP_LIMIT = 90_000

# The links the assistant is allowed to hand over. Anything not here it must mark as
# missing rather than invent — a wrong link in a client message is worse than none.
KEY_LINKS = {
    "onboarding call booking": "https://api.leadconnectorhq.com/widget/booking/z1Ne59rohCCj87KhcXoi",
    "brand blueprint call booking": "https://api.leadconnectorhq.com/widget/booking/x84ET6KnA8odlsjYiVLq",
    "launch call booking": "https://api.leadconnectorhq.com/widget/booking/5E1EVxLJbGiDM3iYl2kL",
    "check-in call booking": "https://api.leadconnectorhq.com/widget/booking/SHjlq0UjeR11maltYNyh",
    "1-1 call notes form (CSM fills)": "https://maharamedia.typeform.com/to/fRokTITH",
    "client ticketing form (CSM fills)": "https://forms.clickup.com/90182518398/f/2kzmr1ky-1178/R1O1N5QXYLUTJOWQ3E",
    "pause request form": "https://maharamedia.typeform.com/to/CTUjv6l3",
    "extension form": "https://maharamedia.typeform.com/to/gqBcyK6g",
    "reactivate ads after a failed payment": "https://maharamedia.typeform.com/to/ecJQ5Z5C",
    "cancellation survey": "https://maharamedia.typeform.com/to/knIe4eF3",
    "referral form": "https://maharamedia.typeform.com/to/bAmbMKM2",
    "client review form": "https://maharamedia.typeform.com/to/ETEynRgb",
    "google review link": "https://g.page/r/CeRMcUwFPpe7EAI/review",
    "projections calculator": "http://calculator.maharamedia.com",
    "content library": "https://content.maharamedia.com/",
    "reset call framework (Skool)": "https://www.skool.com/maharamedia-8165/classroom/68fc87a8?md=181f7ebf64164828bd0faec51925059c",
    "check-in call SOP (Skool)": "https://www.skool.com/maharamedia-8165/classroom/68fc87a8?md=7b7ac08b05a34acaba3a5177117d229e",
    "onboarding call SOP (Skool)": "https://www.skool.com/maharamedia-8165/classroom/68fc87a8?md=0fbe29a02002423aafcf3ca169be9e36",
    "client assets drive": "https://drive.google.com/drive/folders/1DTJUOos129Sl-dSp_zllja47cx_LexFW",
}

SCHEMA = {
    "type": "object",
    "properties": {
        "answer": {
            "type": "string",
            "description": (
                "The direct answer for the CSM, at most 150 words. Lead with what to do. "
                "No preamble, no restating the question."
            ),
        },
        "message_en": {
            "type": "string",
            "description": (
                "The message to send the client in English, ready to paste, or an empty "
                "string when the question does not call for a client message."
            ),
        },
        "message_ar": {
            "type": "string",
            "description": (
                "The same message in Gulf Arabic, or an empty string. Money always in "
                "USD. Never call the client a contractor."
            ),
        },
        "sop_basis": {
            "type": "string",
            "description": (
                "Which part of the SOP or which client number this is based on. Say "
                "'not covered by the SOP' when it is not."
            ),
        },
    },
    "required": ["answer", "message_en", "message_ar", "sop_basis"],
}

PROMPT = """You are the Client Success assistant for Mahara Media, a marketing agency
serving construction and design businesses in the Gulf. You are answering the Client
Success Manager, not the client.

Rules that are not negotiable:
- Answer only from the Client Communication SOP and the client data given to you. If the
  SOP does not cover it, say "not covered by the SOP" in sop_basis and give the most
  conservative answer that follows Mahara's tone.
- Never invent numbers, dates, promises or results. Use only the figures provided.
- Only use URLs from the links given to you, including the client's own sheet and drive
  links. If a link the CSM asks for is not in that list, say which one is missing instead
  of writing a placeholder into the client message.
- Never call the client or their business a "contractor" — they are construction and
  design businesses. Never use the term "B2B" with a client. All money in USD.
- Concerns get a phone call, never a WhatsApp negotiation. Never negotiate a cancellation
  over text.
- Be direct. The CSM has 20 seconds to read this and act.
- The client name you are given is the company, not a person. Address the client as NAME so
  the CSM fills in the contact's first name, and leave TIME placeholders for times you
  cannot know. Never greet a person by their company name.
- Arabic messages must read like a Gulf native wrote them, not like a translation.
"""


def _load_sop() -> str:
    try:
        with open(SOP_PATH, encoding="utf-8") as fh:
            return fh.read()[:SOP_LIMIT]
    except FileNotFoundError:
        return ""


def _client_context(profile: dict | None) -> str:
    """A compact, factual brief on the client — numbers only, no interpretation."""
    if not profile:
        return "No client selected."
    perf = profile.get("performance") or {}
    month = perf.get("month") or {}
    last = perf.get("lastMonth") or {}
    all_time = perf.get("allTime") or {}
    stale = perf.get("stale") or []
    return json.dumps(
        {
            "client": profile.get("clientName"),
            "stage": profile.get("stage"),
            "service": profile.get("service"),
            "daysLive": profile.get("liveDays"),
            "thisMonth": month,
            "lastMonth": last,
            "allTimeOnTheirSheet": all_time,
            "appointmentsWithNoOutcome": perf.get("staleCount"),
            "oldestUnfilledAppointments": [
                {"name": r.get("name"), "days": r.get("ageDays"), "missing": r.get("missing")}
                for r in stale[:5]
            ],
            "liveAds": profile.get("live"),
            "hasSheet": bool((profile.get("links") or {}).get("sheet")),
            # Their real links, so a message can carry the right URL instead of a
            # placeholder the CSM has to go and find.
            "theirLinks": profile.get("links") or {},
        },
        ensure_ascii=False,
    )


async def answer_question(question: str, profile: dict | None) -> dict:
    """Answer one CSM question. Returns the parsed structured answer."""
    res = await ai_structured_output(
        prompt=PROMPT,
        input_text=(
            f"CLIENT COMMUNICATION SOP:\n{_load_sop()}\n\n"
            f"THIS CLIENT'S REAL DATA:\n{_client_context(profile)}\n\n"
            f"LINKS YOU MAY USE (never invent a URL):\n"
            f"{json.dumps(KEY_LINKS, ensure_ascii=False, indent=0)}\n\n"
            f"THE CSM ASKS:\n{question}"
        ),
        output_schema=SCHEMA,
        intelligence_level="smart",
    )
    # `.result` is the schema payload. An empty result used to ship a report with blank
    # sections, so it is an error here, not a shrug.
    data = res.result if isinstance(res.result, dict) else {}
    if isinstance(data, str):
        data = json.loads(data)
    if not data:
        raise RuntimeError(f"the model returned nothing: {res.error or 'empty result'}")
    return data


def format_answer(data: dict) -> str:
    """Flatten the answer into the single text field the app displays."""
    parts = [str(data.get("answer", "")).strip()]
    if data.get("message_en"):
        parts += ["", "— Send this (English) —", data["message_en"].strip()]
    if data.get("message_ar"):
        parts += ["", "— أرسل هذا (عربي) —", data["message_ar"].strip()]
    if data.get("sop_basis"):
        parts += ["", f"Based on: {data['sop_basis'].strip()}"]
    return "\n".join(parts).strip()
