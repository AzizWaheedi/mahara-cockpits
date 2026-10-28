#!/usr/bin/env python3
"""Build immutable, narration-led offer films. No network, speech or render calls."""
from __future__ import annotations
import argparse
import hashlib
import html
import json
import math
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path

TOOL = Path(__file__).resolve().parent.parent
REPO = TOOL.parent.parent
KINDS = ("website", "second_campaign", "seo_geo", "smm", "cameraman", "ugc", "closer")
APPROVAL = "1270fc4f0efeaaedf6d2ce1dee859158699167bcba46a7e3136e4750d0fb768d"
ACTORS = ("khalda", "castello", "al-khalil")
FPS = 30

def esc(value):
    return html.escape(str(value), quote=True)

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def text_sha(text):
    return hashlib.sha256(text.encode()).hexdigest()

def number(value, lang):
    return str(value).translate(str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩")) if lang == "ar" else str(value)

def normalized(text):
    return "".join(c.lower() for c in str(text) if unicodedata.category(c)[0] in ("L", "N"))

def phrase(en, ar):
    return {"en": en, "ar": ar}

# Every phrase is checked against its own approved spoken segment before writing.
# No catalog truncation, generated claims, translated paraphrases or invented people.
STORIES = {
 "website": [
  ("project", [phrase("Then they search your name.", "يدور على اسمكم.")]),
  ("site", [phrase("see your work and get in touch.", "يوضح شغلكم، ويسهّل عليه التواصل معكم.")]),
  ("site_tour", [phrase("Up to six pages, in Arabic and English.", "لين ست صفحات، بالعربي والإنجليزي."), phrase("Your projects, shown properly.", "مشاريعكم معروضة مثل ما تستاهل."), phrase("WhatsApp, an enquiry form, and tracking.", "وزر واتساب، ونموذج للاستفسارات، وتتبع.")]),
  ("link", [phrase("Send the link before a first meeting", "وترسلون الرابط قبل أول اجتماع")]),
  ("inputs", [phrase("your logo", "شعاركم"), phrase("photos of your projects", "وصور مشاريعكم"), phrase("your list of services.", "وقائمة خدماتكم.")]),
  ("care", [phrase("two weeks after we have them.", "وبعد أسبوعين من يوم توصلنا، الموقع شغال."), phrase("hosting, backups and an hour of edits.", "الاستضافة، والنسخ الاحتياطي، وساعة تعديلات.")]),
  ("close", []),
 ],
 "second_campaign": [
  ("branches", [phrase("Give the next one its own campaign.", "نعطي الخدمة الثانية حملتها الخاصة.")]),
  ("campaign_parts", [phrase("We agree the second service", "نتفق معكم على الخدمة"), phrase("create its ads", "نسوي إعلاناتها"), phrase("write its words", "ونكتب كلامها"), phrase("its own enquiry form.", "نموذج استفسار خاص.")]),
  ("parallel", [phrase("It runs beside your first campaign", "وتمشي جنب حملتكم الأولى"), phrase("the same support", "بنفس المتابعة")]),
  ("project_input", [phrase("photos of the service you want to grow.", "صور للخدمة اللي تبون تكبرونها.")]),
  ("approval", [phrase("monthly, on top of your current plan.", "الإدارة شهرية، فوق باقتكم الحالية."), phrase("once you approve its ads and form.", "أول ما توافقون على إعلاناتها ونموذجها.")]),
  ("close", []),
 ],
 "seo_geo": [
  ("search", [phrase("your service in your city", "خدمتكم في مدينتكم")]),
  ("dossier", [phrase("Over ninety days", "خلال تسعين يوم"), phrase("your website", "موقعكم"), phrase("Google Business Profile and business listings.", "ملف نشاطكم على قوقل، وقوائم شركتكم.")]),
  ("answers", [phrase("the information search engines read", "المعلومات اللي تقراها محركات البحث"), phrase("pages that AI answers can quote.", "تقدر إجابات الذكاء الاصطناعي تقتبس منها.")]),
  ("report", [phrase("Each month, you receive a report", "وكل شهر يوصلكم تقرير"), phrase("If you have no website", "وإذا ما عندكم موقع")]),
  ("ownership", [phrase("access to your site and Google profile.", "صلاحية الدخول لموقعكم وملفكم على قوقل."), phrase("what we build stays yours.", "واللي نبنيه يبقى لكم."), phrase("its monthly care starts on day ninety-one.", "تبدي عنايته الشهرية من اليوم الواحد والتسعين.")]),
  ("close", []),
 ],
 "smm": [
  ("social", [phrase("can they see your recent work?", "يشوف آخر شغلكم؟")]),
  ("library", [phrase("the project material you already send us.", "مواد المشاريع اللي ترسلونها لنا أصلاً.")]),
  ("calendar", [phrase("more than twenty posts", "أكثر من عشرين بوست"), phrase("weekly stories.", "وستوريات كل أسبوع.")]),
  ("editorial", [phrase("the first month’s calendar", "جدول أول شهر"), phrase("your project photos and footage.", "صور مشاريعكم والمواد اللي عندنا.")]),
  ("conditional", [phrase("Reels depend on the footage you send.", "والريلز تعتمد على المواد اللي ترسلونها."), phrase("rather than a promised number.", "وما نوعد بعدد معين منها.")]),
  ("review", [phrase("review the pages with you on a call", "نراجع الصفحات معكم بمكالمة"), phrase("share a report.", "ونشارككم التقرير.")]),
  ("close", []),
 ],
 "cameraman": [
  ("viewfinder", [phrase("One day on site", "يوم بموقعكم")]),
  ("shoot", [phrase("a full day at a project, your office, or both.", "يوم كامل، بمشروع، أو بمكتبكم، أو الاثنين.")]),
  ("shotlist", [phrase("Finished work.", "مشاريع منتهية."), phrase("Work in progress.", "وشغل قيد التنفيذ."), phrase("Your team doing the job.", "وفريقكم وهو يشتغل."), phrase("only if you want to be.", "بس إذا تبون.")]),
  ("handoff", [phrase("All the footage is yours to keep.", "وكل المواد تبقى لكم.")]),
  ("aim", [phrase("around three months of material", "حوالي ثلاثة شهور"), phrase("depends on what we can film.", "والمدة تعتمد على اللي نقدر نصوره.")]),
  ("booking", [phrase("a suitable site and a date.", "موقع مناسب وتاريخ يناسبكم."), phrase("The day is paid in full.", "ويوم التصوير دفعة وحدة كاملة.")]),
  ("close", []),
 ],
 "ugc": [
  ("presenter", [phrase("You do not have to be the one on camera.", "مو لازم تكونون أنتم قدام الكاميرا.")]),
  ("casting", [phrase("a presenter who speaks your dialect.", "مقدّم يتكلم بلهجتكم."), phrase("without pretending to be its owner.", "وما يمثل إنه صاحبها.")]),
  ("package", [phrase("five ads", "خمسة إعلانات"), phrase("one longer explanation of your offer", "وفيديو أطول يشرح عرضكم"), phrase("two follow-up videos", "وفيديوين متابعة")]),
  ("keep", [phrase("The five ads run in your campaign.", "الإعلانات الخمسة تمشي بحملتكم."), phrase("The three longer videos are yours to keep and send.", "والفيديوهات الثلاثة الأطول تبقى لكم وتقدرون ترسلونها.")]),
  ("script", [phrase("one call to agree the script.", "بمكالمة وحدة نتفق فيها على السكربت."), phrase("You approve it before filming", "توافقون عليه قبل التصوير"), phrase("review all eight videos.", "تراجعون الفيديوهات الثمانية.")]),
  ("close", []),
 ],
 "closer": [
  ("quotation", [phrase("Who follows up on your quotations", "عروض أسعاركم من يتابعها")]),
  ("role", [phrase("recruit, train and manage a salesperson", "نوظف لكم مندوب مبيعات، وندربه وندير أداءه."), phrase("your tools and on your phone line.", "على أدواتكم وعلى خط التلفون عندكم.")]),
  ("recruit", [phrase("the role and pay", "على الدور والراتب"), phrase("interview candidates", "ونسوي المقابلات"), phrase("scripts written for your services.", "سكربتات مكتوبة لخدماتكم.")]),
  ("ramp", [phrase("Month one is training and ramp-up.", "أول شهر للتدريب والتجهيز."), phrase("review calls, coach and manage performance each month.", "نراجع المكالمات، وندربه ونتابع أداءه كل شهر.")]),
  ("workspace", [phrase("a place to work", "مكان يشتغل فيه"), phrase("a phone line", "وخط تلفون"), phrase("your price list.", "وقائمة أسعاركم.")]),
  ("placement", [phrase("Placement is paid in full", "التوظيف دفعة وحدة كاملة"), phrase("a three-month minimum.", "وأقل مدة ثلاثة شهور."), phrase("within ninety days, we recruit a replacement at no cost.", "خلال تسعين يوم، نوظف بديل بدون تكلفة.")]),
  ("close", []),
 ],
}

CSS = """
@font-face{font-family:Geist;src:url('assets/fonts/Geist-Regular.woff2');font-weight:400}
@font-face{font-family:Geist;src:url('assets/fonts/Geist-SemiBold.woff2');font-weight:600}
@font-face{font-family:PlexArabic;src:url('assets/fonts/plexar-400.woff2');font-weight:400}
@font-face{font-family:PlexArabic;src:url('assets/fonts/plexar-600.woff2');font-weight:600}
*{box-sizing:border-box;margin:0}
#root{position:absolute;inset:0;overflow:hidden;font-family:Geist,sans-serif;color:#f2f6fa}
#root[dir=rtl]{font-family:PlexArabic,Geist,sans-serif}
.stage,.phase{position:absolute;inset:0;overflow:hidden;background:#091333}
.paper{background:#e8edf4;color:#091333}
.head{position:absolute;left:192px;top:108px;width:1536px;font-size:96px;font-weight:600;line-height:1.12;letter-spacing:-1.5px}
#root[dir=rtl] .head{letter-spacing:0;line-height:1.18}
.copy{font-size:76px;line-height:1.3;font-weight:600}
.photo{position:absolute;object-fit:cover}
.frame{position:absolute;overflow:hidden}
.tag{position:absolute;inset-inline-end:192px;top:682px;font-size:75px;line-height:1.1;padding:6px 16px;background:#091333;color:#f2f6fa;z-index:4}
.accent{color:#00cfc8}.ink{color:#091333}.blue{color:#506179}
.rule{position:absolute;height:6px;background:#00cfc8}
.big{font-size:220px;line-height:1;font-weight:600;letter-spacing:-8px}
.caption{position:absolute;left:192px;bottom:108px;width:1536px;text-align:center;font-size:75px;line-height:1.12;color:#f2f6fa}
.caption span{background:#091333;box-decoration-break:clone;-webkit-box-decoration-break:clone;padding:3px 18px}
.logo{position:absolute;left:560px;top:180px;width:800px;height:210px;object-fit:contain}
.close-copy{position:absolute;left:240px;top:430px;width:1440px;font-size:96px;line-height:1.12;text-align:center}
#root[dir=rtl] .flow{transform:scaleX(-1)}
.line{stroke:#506179;stroke-width:5;fill:none}
.line-accent{stroke:#00cfc8;stroke-width:7;fill:none}
.sheet{position:absolute;background:#f2f6fa;color:#091333;overflow:hidden}
.folio{position:absolute;font-size:62px;line-height:1.25;font-weight:600}
.corner{position:absolute;width:58px;height:58px;border-color:#00cfc8;border-style:solid}
.actor{position:absolute;object-fit:cover;object-position:center 28%;overflow:hidden}
"""

def script_for(kind, lang, path=None):
    data = json.loads((path or TOOL / "narration/v1/scripts.json").read_text())
    if data.get("approval", {}).get("approved") is not True or data["approval"].get("sheetSha256") != APPROVAL:
        raise ValueError("Exact script-batch approval is missing")
    if data.get("closing", {}).get("approved") is not True:
        raise ValueError("Genuine-logo closing is not approved")
    offer = next(x for x in data["offers"] if x["kind"] == kind)
    script = offer["languages"][lang]
    if script.get("approval") != "approved" or script.get("approvalSheetSha256") != APPROVAL:
        raise ValueError("Language script is not bound to the approved sheet")
    if text_sha(script["text"]) != script["textSha256"]:
        raise ValueError("Script bytes do not match the approved text hash")
    if "\n\n".join(s["text"] for s in script["segments"]) != script["text"]:
        raise ValueError("Spoken segments do not reconstruct the approved script")
    validate_story(kind, lang, script)
    return script

def validate_story(kind, lang, script):
    story = STORIES[kind]
    if len(story) != len(script["segments"]) or story[-1][0] != "close":
        raise ValueError("Picture map does not cover every approved segment")
    for (visual, lines), segment in zip(story, script["segments"]):
        last = -1
        for pair in lines:
            needle = pair[lang]
            at = segment["text"].find(needle)
            if at < 0 or at < last:
                raise ValueError(f"Unapproved or unordered excerpt: {kind}/{lang}/{visual}: {needle}")
            last = at

def finite(value, field):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{field} must be a finite number")
    return float(value)

def audio_duration(path):
    """Bounded metadata read only: no render, resample, transcription or network."""
    try:
        result=subprocess.run(["ffprobe","-v","error","-show_entries","format=duration:stream=codec_type","-of","json",str(path)],capture_output=True,check=True,timeout=10)
        if len(result.stdout)>65536:
            raise ValueError("Audio probe exceeded its output bound")
        facts=json.loads(result.stdout)
        if facts.get("streams") != [{"codec_type":"audio"}]:
            raise ValueError("Narration must contain exactly one audio stream")
        duration=float(facts["format"]["duration"])
        return finite(duration,"probed audio duration")
    except (subprocess.SubprocessError,KeyError,TypeError,json.JSONDecodeError) as exc:
        raise ValueError("Narration audio metadata could not be verified") from exc

def read_timing(path, kind, lang, script):
    raw = json.loads(path.read_text())
    if raw.get("schemaVersion") != 1 or raw.get("kind") != kind or raw.get("language") != lang:
        raise ValueError("Narration manifest does not match this offer/language")
    if raw.get("scriptSha256") != script["textSha256"] or raw.get("copyApproved") is not True:
        raise ValueError("Narration is not bound to the exact approved script")
    if raw.get("commercialEvidenceRecorded") is not True:
        raise ValueError("Narration commercial-use evidence is missing")
    length = finite(raw.get("duration"), "duration")
    if not 1 <= length <= 300:
        raise ValueError("Audio duration is outside the supported bound")
    name = raw.get("audioFile")
    if not isinstance(name, str) or Path(name).is_absolute() or ".." in Path(name).parts:
        raise ValueError("audioFile must be a safe relative path")
    audio = (path.parent / name).resolve()
    if not audio.is_relative_to(path.parent.resolve()) or not audio.is_file() or not 100 < audio.stat().st_size <= 50_000_000:
        raise ValueError("Audio is missing or outside the bounded take folder")
    if audio.suffix.lower() not in (".wav", ".mp3", ".m4a") or sha(audio) != raw.get("audioSha256"):
        raise ValueError("Audio bytes do not match the narration manifest")
    if abs(audio_duration(audio)-length)>0.1:
        raise ValueError("Narration duration differs from its actual audio bytes")
    segments = raw.get("segments")
    if not isinstance(segments, list) or len(segments) != len(script["segments"]):
        raise ValueError("Narration does not cover every script segment")
    previous = 0.0
    for actual, expected in zip(segments, script["segments"]):
        if actual.get("id") != expected["id"] or actual.get("text") != expected["text"]:
            raise ValueError("Narration segment identity or wording differs from approval")
        start, end = finite(actual.get("start"), "segment.start"), finite(actual.get("end"), "segment.end")
        if start < previous or end <= start or end > length + 0.04:
            raise ValueError("Narration segments overlap or leave the audio bounds")
        previous = end
    words = raw.get("words", [])
    if not isinstance(words, list):
        raise ValueError("words must be an array")
    previous = 0.0
    for word in words:
        start, end = finite(word.get("start"), "word.start"), finite(word.get("end"), "word.end")
        if not isinstance(word.get("text"), str) or not normalized(word["text"]) or start < 0 or start < previous - 0.04 or end <= start or end > length + 0.04:
            raise ValueError("Invalid or overlapping word cue")
        previous = end
    expected_tokens = script["text"].split()
    words_exact = len(words) == len(expected_tokens) and all(normalized(a["text"]) == normalized(b) for a, b in zip(words, expected_tokens))
    # Non-exact ASR words never become fabricated caption or picture timings.
    if words_exact:
        offset = 0
        for segment in segments:
            count = len(segment["text"].split())
            selected = words[offset:offset+count]
            if selected[0]["start"] < segment["start"] - 0.08 or selected[-1]["end"] > segment["end"] + 0.08:
                raise ValueError("Word cues fall outside their approved segment")
            offset += count
    raw["wordsExact"] = words_exact
    raw["audioPath"] = audio
    raw["duration"] = length
    return raw

def layout_timing(kind, lang, script):
    cursor = 0.0
    segments = []
    for s in script["segments"]:
        duration = max(3.0, len(s["text"].split()) * 0.42 + 0.65)
        segments.append(dict(s, start=cursor, end=cursor + duration))
        cursor += duration
    return {"kind": kind, "language": lang, "duration": cursor, "segments": segments, "words": [], "wordsExact": False,
            "copyApproved": True, "commercialEvidenceRecorded": False, "transcriptChecked": False, "subjectiveListen": False, "layoutOnly": True}

def chunks(text, limit=54, max_words=8):
    """Exact contiguous excerpts. No paraphrase or silently omitted qualifier."""
    groups, current = [], []
    for token in text.split():
        if current and (len(current) >= max_words or len(" ".join(current + [token])) > limit):
            groups.append(" ".join(current))
            current = []
        current.append(token)
        if re.search(r"[.!?؟]$", token):
            groups.append(" ".join(current)); current = []
    if current: groups.append(" ".join(current))
    return groups

def phases_for(segment, lines, lang, timing, token_offset, *, closing=False):
    # Long approved sentences become successive exact phrases, never tiny type.
    lines = lines or [{lang: segment["text"]}]
    parts, seek = [], 0
    for semantic_index, line in enumerate(lines):
        text = line[lang]
        base = segment["text"].index(text, seek)
        inner = 0
        for part in chunks(text, limit=72 if closing else 54, max_words=12 if closing else 8):
            pos = text.index(part, inner)
            parts.append((part, semantic_index, base + pos))
            inner = pos + len(part)
        seek = base + len(text)
    if timing["wordsExact"]:
        result = []
        for text, index, char_at in parts:
            before = segment["text"][:char_at]
            word_index = token_offset + len(before.split())
            at = max(segment["start"], timing["words"][word_index]["start"])
            result.append((at, text, index))
        result[0] = (segment["start"], result[0][1], result[0][2])
        return result
    if timing.get("layoutOnly"):
        span = segment["end"] - segment["start"]
        return [(segment["start"] + i * span / len(parts), text, index) for i,(text,index,_) in enumerate(parts)]
    raise ValueError("Exact word alignment is required for narrated pictures; use --layout-only for silent preparation")

def captions_for(script, timing):
    if not timing["wordsExact"]:
        return []
    tokens = script["text"].split()
    words = timing["words"]
    groups, begin, current = [], 0, []
    for i, token in enumerate(tokens):
        if current and (len(current) >= 7 or len(" ".join(current + [token])) > 62):
            groups.append({"start": words[begin]["start"], "end": words[i - 1]["end"], "text": " ".join(current)})
            begin, current = i, []
        current.append(token)
        if re.search(r"[.!?؟]$", token):
            groups.append({"start": words[begin]["start"], "end": words[i]["end"], "text": " ".join(current)})
            begin, current = i + 1, []
    if current:
        groups.append({"start": words[begin]["start"], "end": words[-1]["end"], "text": " ".join(current)})
    for i, group in enumerate(groups):
        next_start = groups[i + 1]["start"] if i + 1 < len(groups) else timing["duration"]
        group["end"] = min(next_start, max(group["end"], group["start"] + 0.65))
    return groups

def subtitle_time(value, separator="."):
    milliseconds = round(value * 1000)
    seconds, ms = divmod(milliseconds, 1000)
    minutes, sec = divmod(seconds, 60)
    hours, minute = divmod(minutes, 60)
    return f"{hours:02d}:{minute:02d}:{sec:02d}{separator}{ms:03d}"

def subtitle_files(captions):
    vtt, srt = ["WEBVTT", ""], []
    for i,cue in enumerate(captions,1):
        vtt += [f'{subtitle_time(cue["start"])} --> {subtitle_time(cue["end"])}',cue["text"],""]
        srt += [str(i),f'{subtitle_time(cue["start"],",")} --> {subtitle_time(cue["end"],",")}',cue["text"],""]
    return "\n".join(vtt),"\n".join(srt)

def tag(lang):
    return f'<div class="tag">{"مثال" if lang == "ar" else "Example"}</div>'

def img(name, x, y, width, height, extra=""):
    return f'<img class="photo" src="assets/{esc(name)}" style="left:{x}px;top:{y}px;width:{width}px;height:{height}px;{extra}">'

def head(text, extra=""):
    return f'<h1 class="head" data-var-text="headline" style="{extra}">{esc(text)}</h1>'

def svg(content, x=192, y=360, width=1536, height=410):
    return f'<svg class="flow" aria-hidden="true" style="position:absolute;left:{x}px;top:{y}px;width:{width}px;height:{height}px" viewBox="0 0 1536 450">{content}</svg>'

def document(x, y, w, h, accent=False):
    lines = "".join(f'<path class="line" d="M {x+36} {y+72+i*42} H {x+w-36}"/>' for i in range(max(1, int((h-110)/42))))
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="#f2f6fa" stroke="#506179" stroke-width="3"/><path class="{"line-accent" if accent else "line"}" d="M{x+36} {y+32} H{x+w-80}"/>{lines}'

def actor_video(name, idx, sid, x, y, width, height, duration, offset=0):
    return (f'<video id="{sid}-actor-{idx}" class="clip actor" data-start="0" data-duration="{duration:.3f}" '
            f'data-media-start="{offset}" data-track-index="3" src="assets/actors/{name}.mp4" muted playsinline '
            f'style="left:{x}px;top:{y}px;width:{width}px;height:{height}px;z-index:3"></video>')

def picture(visual, text, index, lang, sid, duration, media_offset=0):
    """Different service objects; text is exact approved copy, never mock results."""
    h = head(text)
    image_tag = tag(lang)
    teal = '<div class="rule" style="left:192px;top:320px;width:180px"></div>'
    if visual == "close":
        return ('<div class="stage"><img class="logo" src="assets/brand/logo.png" data-var-src="logo">'
                f'<p class="close-copy" data-var-text="closing">{esc(text)}</p></div>'), ""
    if visual in ("site", "site_tour", "link"):
        capture = ("index", "projects", "contact")[min(index, 2)] if visual == "site_tour" else ("project" if visual == "link" else "index")
        # A legible crop of the real fictional example; no drawn imitation UI.
        body = h + f'<div class="frame" style="left:192px;top:370px;width:1536px;height:400px;border:2px solid #506179">{img(f"cap/{capture}-{lang}.png",0,0,1536,860,"object-fit:cover;object-position:top")}</div>' + image_tag
        return f'<div class="stage paper">{body}</div>', "page"
    if visual in ("project", "project_input", "social", "library"):
        photo = "kitchen" if visual in ("social", "library") else "hero"
        body = img(f"img/{photo}.webp", 900, 0, 1020, 800)
        body += '<div style="position:absolute;left:0;top:0;width:940px;height:800px;background:#091333"></div>'
        body += head(text, "top:260px;width:690px;font-size:96px;max-height:none")
        body += image_tag
        return f'<div class="stage">{body}</div>', "image"
    if visual in ("branches", "parallel", "campaign_parts"):
        body = h + img("img/villa.webp", 192, 350, 610, 350) + img("img/kitchen.webp", 1118, 350, 610, 350)
        body += svg('<path class="line-accent" d="M610 175 H760 V70 H926 M760 175 V280 H926"/><circle cx="760" cy="175" r="12" fill="#00cfc8"/>',192,350,1536,350)
        if visual == "campaign_parts":
            body += f'<div class="folio" style="left:224px;top:720px;color:#506179">{number(index+1,lang)}</div>'
        return f'<div class="stage paper">{body}{image_tag}</div>', "branch"
    if visual == "search" or visual == "answers":
        channel = "chatgpt" if visual == "answers" and index > 0 else "google"
        capture = "chatgpt-search.png" if channel == "chatgpt" else "google-web-search.png"
        label = "ChatGPT" if channel == "chatgpt" else "Google"
        note = "مثال، وليس نتيجة لعميل" if lang == "ar" else "Example, not a client result"
        # Preserve source pixels. Frame the first answer and its source link, and
        # keep the disclosure outside the screenshot instead of covering it.
        image = (img(f"search/{capture}",-665,-333,2470,1092.5,"object-fit:contain")
                 if channel == "chatgpt" else
                 img(f"search/{capture}",0,0,1536,956,"object-fit:contain;object-position:top"))
        body = head(text, "font-size:82px") + f'<div class="frame" style="left:192px;top:250px;width:1536px;height:400px;background:#202124;border:2px solid #506179;border-radius:24px">{image}</div>'
        body += f'<div class="tag" style="font-size:75px;top:665px;max-width:1536px">{label} · {note}</div>'
        return f'<div class="stage paper">{body}</div>', "search-evidence"
    if visual in ("dossier", "report", "ownership"):
        body = h
        if visual == "dossier" and index == 0:
            body += f'<div class="big" style="position:absolute;inset-inline-start:220px;top:390px">{number(90,lang)}</div>'
            body += svg(document(600, 10, 380, 400, True) + document(1020, 70, 420, 340))
        elif visual == "report" and index > 0:
            body += f'<div class="frame" style="left:192px;top:370px;width:1536px;height:400px">{img(f"cap/index-{lang}.png",0,0,1536,860,"object-position:top")}</div>'
        elif visual == "ownership" and index == 2:
            body += f'<div class="big accent" style="position:absolute;inset-inline-start:192px;top:390px">{number(91,lang)}</div>'
            body += svg(document(650, 10, 760, 400, True))
        else:
            body += svg(document(50, 40, 420, 355) + document(550, 0, 430, 420, True) + document(1060, 65, 400, 330))
        return f'<div class="stage paper">{body}{image_tag}</div>', "dossier"
    if visual in ("calendar", "editorial", "conditional", "review"):
        if visual == "calendar":
            body = h + f'<div class="big" style="position:absolute;left:192px;top:410px">{number(20,lang)}+</div>'
            for j in range(3):
                body += img(f'img/{"villa" if j%2 else "kitchen"}.webp', 820+j*285, 345, 260, 365)
            body += svg('<path class="line-accent" d="M610 410 H1490"/>' ,192,330,1536,440)
        elif visual == "conditional":
            body = h + img("img/kitchen.webp", 1190, 335, 420, 440)
            body += svg('<path class="line-accent" d="M90 90 H580 V330 H90 Z M280 130 L430 210 L280 290 Z"/>')
        elif visual == "review":
            body = h + svg(document(80, 10, 860, 410, True) + '<circle cx="1240" cy="220" r="150" class="line"/><path class="line-accent" d="M1150 220 L1210 280 L1330 160"/>')
        else:
            body = h + img("img/villa.webp", 192, 335, 720, 440) + img("img/kitchen.webp", 1008, 335, 720, 440)
        return f'<div class="stage paper">{body}{image_tag}</div>', "editorial"
    if visual in ("viewfinder", "shoot", "shotlist", "handoff", "aim", "booking"):
        if visual == "aim":
            body = h + f'<div class="big accent" style="position:absolute;left:200px;top:400px">{number(3,lang)}</div>'
            body += svg('<path class="line" d="M450 210 H1450"/>' + "".join(f'<rect x="{550+i*285}" y="90" width="210" height="240" fill="#e8edf4"/><path class="line-accent" d="M{580+i*285} 150 H{730+i*285}"/>' for i in range(3)))
        elif visual == "shotlist" and index >= 2:
            # Deliberately schematic, not counterfeit team/owner footage.
            body = h + svg('<rect x="240" y="25" width="1040" height="370" class="line"/><circle cx="760" cy="135" r="64" class="line-accent"/><path class="line-accent" d="M610 345 C610 225 910 225 910 345"/><path class="line" d="M300 75 H420 M300 75 V180 M1220 75 H1100 M1220 75 V180"/>')
        elif visual in ("handoff", "booking"):
            body = h + svg(document(50, 40, 410, 355) + '<path class="line-accent" d="M530 210 H910 M850 150 L910 210 L850 270"/>' + document(1030, 40, 410, 355, True))
        else:
            body = h + img(f'img/{"kitchen" if index == 1 else "villa"}.webp', 192, 370, 1536, 400)
            body += '<div style="position:absolute;left:235px;top:405px;width:1450px;height:320px;border:5px solid #f2f6fa"></div>'
            body += '<div style="position:absolute;left:890px;top:510px;width:140px;height:100px;border:3px solid #00cfc8"></div>'
        return f'<div class="stage">{body}{image_tag}</div>', "camera"
    if visual in ("presenter", "casting"):
        if visual == "presenter":
            body = head(text, "top:250px;width:820px;max-height:none")
            body += actor_video(ACTORS[0],0,sid,1180,95,384,682,duration,media_offset)
        else:
            body = h
            for j, actor in enumerate(ACTORS):
                body += actor_video(actor,j,sid,260+j*520,370,360,400,duration,media_offset)
        return f'<div class="stage">{body}{image_tag}</div>', "actor"
    if visual in ("package", "keep"):
        quantities = (5,1,2) if visual == "package" else (5,3)
        body = h
        for j, amount in enumerate(quantities):
            column = len(quantities)-1-j if lang=="ar" else j
            x = 240 + column * (1440 / len(quantities))
            active = j == min(index, len(quantities)-1)
            body += f'<div class="big" style="position:absolute;left:{x}px;top:400px;color:{"#00cfc8" if active else "#506179"}">{number(amount,lang)}</div>'
            if j < len(quantities)-1:
                body += f'<div style="position:absolute;left:{240 + j*(1440/len(quantities)) + 320}px;top:460px;font-size:100px;color:#506179">+</div>'
        return f'<div class="stage">{body}</div>', "quantity"
    if visual in ("quotation", "role", "recruit", "ramp", "workspace", "placement", "script", "inputs", "care", "approval"):
        body = h
        phone = '<rect x="1090" y="25" width="220" height="365" rx="24" class="line"/><path class="line-accent" d="M1130 90 H1270 M1130 150 H1270 M1180 345 H1220"/>'
        desk = '<path class="line" d="M90 235 H640 M150 235 V400 M580 235 V400"/><rect x="220" y="45" width="290" height="150" class="line-accent"/><path class="line" d="M365 195 V235"/>'
        person = '<circle cx="760" cy="105" r="58" class="line-accent"/><path class="line-accent" d="M620 340 C620 200 900 200 900 340"/>'
        approve = '<circle cx="1200" cy="210" r="150" class="line-accent"/><path class="line-accent" d="M1115 210 L1180 275 L1300 135"/>'
        if visual == "quotation":
            body += svg(document(100,30,720,370,True)+'<path class="line-accent" d="M900 220 H1390 M1310 140 L1390 220 L1310 300"/>')
        elif visual == "role":
            body += svg(desk + person + phone)
        elif visual == "workspace":
            # Real inputs represented schematically, no fake prices/contact data.
            body += svg(desk + phone + document(680,40,280,350,index==2))
        elif visual in ("recruit", "ramp"):
            if visual == "ramp" and index == 0:
                body += f'<div class="big accent" style="position:absolute;left:220px;top:430px">{number(1,lang)}</div>'
                body += svg(document(630,10,780,400,True))
            else:
                body += svg(document(50,40,350,350,index==0) + person + phone + '<path class="line" d="M440 210 H550 M940 210 H1030"/>')
        elif visual == "placement":
            if index == 0:
                body += svg(document(100,25,720,380,True)+approve)
            else:
                body += f'<div class="big accent" style="position:absolute;left:220px;top:430px">{number(3 if index==1 else 90,lang)}</div>'
                body += svg(document(650,15,760,390,True))
        elif visual == "care":
            if index == 0:
                body += f'<div class="big accent" style="position:absolute;left:220px;top:430px">{number(2,lang)}</div>'
                body += svg(document(650,15,760,390,True))
            else:
                body += svg('<rect x="80" y="60" width="600" height="110" class="line"/><rect x="80" y="210" width="600" height="110" class="line"/><circle cx="126" cy="115" r="14" fill="#00cfc8"/><circle cx="126" cy="265" r="14" fill="#00cfc8"/><circle cx="1120" cy="210" r="160" class="line-accent"/><path class="line-accent" d="M1120 100 V210 H1220"/>')
        elif visual == "inputs":
            if index == 1:
                body += img('img/villa.webp',192,370,720,400)+img('img/kitchen.webp',1008,370,720,400)
            else:
                body += svg(document(170,20,1190,390,True))
        elif visual == "approval":
            body += svg(document(100,25,720,380,True)+approve)
        else:  # The agreed script, approval, then all eight videos.
            if index == 2:
                body += f'<div class="big accent" style="position:absolute;left:220px;top:430px">{number(8,lang)}</div>'
                body += svg(document(650,15,760,390,True))
            else:
                body += svg(document(100,25,720,380,True)+approve)
        return f'<div class="stage">{body}{image_tag}</div>', "process"
    raise ValueError(f"Unknown visual: {visual}")

def component(sid, lang, body, motion="", duration=1):
    direction = 1 if lang == "ar" else -1
    # Only children move; the timed host is never hidden/faded by GSAP.
    js = ""
    if motion == "page":
        js = f"tl.fromTo('#{sid}-moving',{{y:34}},{{y:0,duration:.6,ease:'power4.out'}},0);"
    elif motion == "search-evidence":
        js = f"tl.fromTo('#{sid}-moving .frame',{{y:12}},{{y:0,duration:.4,ease:'power3.out'}},0);"
    elif motion in ("branch", "dossier"):
        js = f"tl.fromTo('#{sid}-moving',{{x:{direction*38}}},{{x:0,duration:.55,ease:'power4.out'}},0);"
    elif motion == "camera":
        js = f"tl.fromTo('#{sid}-moving',{{scale:1.035}},{{scale:1,duration:.75,ease:'power2.inOut'}},0);"
    elif motion == "close":
        js = f"tl.fromTo('#{sid}-moving .logo',{{scale:.97}},{{scale:1,duration:.25,ease:'power3.out'}},0);"
    return f'<template><style>{CSS}</style><div id="root" dir="{"rtl" if lang=="ar" else "ltr"}" data-composition-id="{sid}" data-width="1920" data-height="1080"><div id="{sid}-moving" style="position:absolute;inset:0">{body}</div></div><script>(function(){{const tl=gsap.timeline({{paused:true}});{js}window.__timelines["{sid}"]=tl;}})();</script></template>'

def copy_file(src, dest, assets):
    if not src.is_file():
        raise ValueError(f"Missing reviewed source: {src}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dest)
    assets.append({"file": str(dest), "source": str(src), "sha256": sha(dest)})

def build(kind, lang, out, deps, media, timing_path=None, layout_only=False, actors=None):
    if out.exists():
        raise ValueError("Output exists; use a new immutable version")
    script = script_for(kind, lang)
    if bool(timing_path) == bool(layout_only):
        raise ValueError("Choose exactly one: --timing or --layout-only")
    timing = read_timing(timing_path, kind, lang, script) if timing_path else layout_timing(kind, lang, script)
    if not layout_only and not timing["wordsExact"]:
        raise ValueError("Exact approved-word alignment is required before narrated assembly")
    actors = actors or media.parent / "all-offers/approved-presenter-examples"
    needed = [media / "brand/mahara-logo-white.png"]
    search_assets = REPO / "apps/client-success-cockpit/src/present/offer/art/search"
    if kind == "seo_geo":
        needed += [search_assets / name for name in ("google-web-search.png", "chatgpt-search.png", "provenance.json")]
    if kind == "ugc":
        needed += [actors / f"{name}.mp4" for name in ACTORS] + [actors / "provenance.json"]
    if kind in ("website", "seo_geo"):
        needed += [media / f"capture/v3/{cap}-{lang}.png" for cap in ("index", "projects", "contact", "project")]
    for p in needed:
        if not p.is_file():
            raise ValueError(f"Missing reviewed media: {p}")
    if kind == "ugc":
        provenance = json.loads((actors / "provenance.json").read_text())
        expected = {"khalda":"qlwysqfu2g","castello":"btp2dokvjr","al-khalil":"nix1oq0h3a"}
        for name in ACTORS:
            rows = [x for x in provenance if x.get("label") == name and x.get("wistia_id") == expected[name]]
            if len(rows) != 1 or rows[0].get("sha256") != sha(actors / f"{name}.mp4"):
                raise ValueError("Presenter bytes do not match the approved source provenance")
    if kind == "seo_geo":
        provenance = json.loads((search_assets / "provenance.json").read_text())
        for name in ("google-web-search.png", "chatgpt-search.png"):
            rows = [item for item in provenance if item.get("file") == name]
            if len(rows) != 1 or rows[0].get("sha256") != sha(search_assets / name):
                raise ValueError("Search screenshot bytes differ from their source receipt")
    out.mkdir(parents=True)
    assets = []
    for name in ("Geist-Regular", "Geist-SemiBold"):
        copy_file(deps / f"geist/dist/fonts/geist-sans/{name}.woff2", out / f"assets/fonts/{name}.woff2", assets)
    for weight in (400,600):
        copy_file(deps / f"@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-{weight}-normal.woff2", out / f"assets/fonts/plexar-{weight}.woff2", assets)
    copy_file(deps / "hyperframes/dist/vendor/npm/gsap@3.15.0/dist/gsap.min.js", out / "assets/vendor/gsap.min.js", assets)
    for name in ("hero", "bg-interior", "bg-courtyard"):
        copy_file(REPO / f"apps/client-success-cockpit/src/present/offer/art/website/{name}.webp", out / f"assets/img/{name}.webp", assets)
    for name in ("villa", "kitchen"):
        copy_file(REPO / f"apps/client-success-cockpit/src/present/assets/examples/{name}-feed.webp", out / f"assets/img/{name}.webp", assets)
    copy_file(media / "brand/mahara-logo-white.png", out / "assets/brand/logo.png", assets)
    if kind in ("website", "seo_geo"):
        for cap in ("index","projects","contact","project"):
            copy_file(media / f"capture/v3/{cap}-{lang}.png", out / f"assets/cap/{cap}-{lang}.png", assets)
    if kind == "ugc":
        for name in ACTORS:
            copy_file(actors / f"{name}.mp4", out / f"assets/actors/{name}.mp4", assets)
        copy_file(actors / "provenance.json", out / "assets/actors/provenance.json", assets)
    if kind == "seo_geo":
        for name in ("google-web-search.png", "chatgpt-search.png", "provenance.json"):
            copy_file(search_assets / name, out / f"assets/search/{name}", assets)
    audio_html = ""
    if not layout_only:
        source = timing["audioPath"]
        audio_name = "assets/audio/voice" + source.suffix.lower()
        copy_file(source, out / audio_name, assets)
        audio_html = f'<audio id="narration" class="clip" data-start="0" data-duration="{timing["duration"]:.3f}" data-track-index="2" data-volume="1" src="{audio_name}"></audio>'
    compositions = out / "compositions"
    compositions.mkdir()
    hosts, beats, offset = [], [], 0
    for seq, ((visual, lines), segment) in enumerate(zip(STORIES[kind], timing["segments"])):
        phases = phases_for(segment, lines, lang, timing, offset, closing=visual == "close")
        offset += len(segment["text"].split())
        next_start = timing["segments"][seq+1]["start"] if seq+1 < len(timing["segments"]) else timing["duration"]
        for j, (start, text, phase_index) in enumerate(phases):
            # Carry the last complete frame through inter-segment silence.
            end = phases[j+1][0] if j+1 < len(phases) else next_start
            if seq == 0 and j == 0: start = 0.0
            if end <= start: raise ValueError("Picture cue has no duration")
            sid = f"{kind}-{seq+1:02d}-{j+1:02d}"
            body, motion = picture(visual, text, phase_index, lang, sid, end-start, max(0,start-segment["start"]))
            (compositions / f"{sid}.html").write_text(component(sid, lang, body, ("close" if visual=="close" else motion) if j==0 else "", end-start))
            hosts.append(f'<div id="{sid}" class="clip" data-composition-id="{sid}" data-composition-src="compositions/{sid}.html" data-start="{start:.3f}" data-duration="{end-start:.3f}" data-width="1920" data-height="1080" data-track-index="1" data-track-kind="graphics" style="inset:0"></div>')
            beats.append({"id":sid,"visual":visual,"start":round(start,3),"end":round(end,3),"text":text,"segmentId":segment["id"]})
    captions = captions_for(script,timing)
    if captions:
        vtt,srt=subtitle_files(captions)
        (out/f"{kind}-{lang}.vtt").write_text(vtt)
        (out/f"{kind}-{lang}.srt").write_text(srt)
    close_start = timing["segments"][-1]["start"]
    caption_nodes = []
    for i,c in enumerate(captions):
        if c["start"] >= close_start: continue
        end=min(c["end"],close_start)
        caption_nodes.append(f'<div id="caption-{i}" class="clip caption" data-start="{c["start"]:.3f}" data-duration="{end-c["start"]:.3f}" data-track-index="5"><span>{esc(c["text"])}</span></div>')
    caption_body = '<div style="position:absolute;inset:0;background:transparent">'+"".join(caption_nodes)+"</div>"
    (compositions/"captions.html").write_text(component("captions",lang,caption_body))
    hosts.append(f'<div id="captions" class="clip" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" data-duration="{timing["duration"]:.3f}" data-width="1920" data-height="1080" data-track-index="5" data-track-kind="captions" style="inset:0;z-index:5;pointer-events:none"></div>')
    watermark=""
    if layout_only:
        watermark='<div style="position:absolute;left:192px;top:18px;font:28px Geist,sans-serif;background:#091333;color:#f2f6fa;z-index:99">INTERNAL PICTURE LAYOUT · NO NARRATION · APPROXIMATE TIMING</div>'
    root=f'<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><script src="assets/vendor/gsap.min.js"></script><style>{CSS}html,body{{width:1920px;height:1080px;background:#091333;overflow:hidden}}.clip{{position:absolute}}</style></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="{timing["duration"]:.3f}" data-width="1920" data-height="1080">{"".join(hosts)}{audio_html}{watermark}</div><script>window.__timelines["main"]=gsap.timeline({{paused:true}});</script></body></html>'
    (out/"index.html").write_text(root)
    (out/"hyperframes.json").write_text(json.dumps({"$schema":"https://hyperframes.heygen.com/schema/hyperframes.json","paths":{"blocks":"compositions","components":"compositions/components","assets":"assets"}}))
    for a in assets: a["file"]=str(Path(a["file"]).relative_to(out))
    meta={"schemaVersion":2,"kind":kind,"language":lang,"mode":"internal-picture-layout" if layout_only else "narrated-review","clientReady":False,
          "duration":timing["duration"],"fps":FPS,"sourceSha256":sha(Path(__file__)),"scriptSha256":script["textSha256"],
          "approvalSheetSha256":APPROVAL,"closing":"approved-genuine-Mahara-logo","timing":"approximate-layout" if layout_only else "observed-segment-and-word-cues" if timing["wordsExact"] else "observed-segment-cues-only",
          "audioSha256":timing.get("audioSha256"),"wordsExact":timing["wordsExact"],"captionsComplete":timing["wordsExact"],
          "review":{"transcriptChecked":timing.get("transcriptChecked") is True,"subjectiveListen":timing.get("subjectiveListen") is True,"phoneSpeakerListen":False,"pictureReviewed":False},
          "assets":assets,"beats":beats,"captions":captions,
          "pending":["Current-source layout/seam/phone review","Full-motion playback","Loudness and true-peak measurement","Provider upload and playback verification"]}
    if not timing.get("transcriptChecked"):meta["pending"].insert(0,"Approved-script transcript verification")
    if not timing["wordsExact"]:meta["pending"].insert(0,"Exact word alignment and complete captions")
    (out/"build.json").write_text(json.dumps(meta,ensure_ascii=False,indent=2)+"\n")
    return meta

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kind",choices=KINDS,required=True)
    parser.add_argument("--lang",choices=("en","ar"),required=True)
    parser.add_argument("--out",type=Path,required=True)
    parser.add_argument("--deps",type=Path,default=Path.home()/"upsell-build/repo/tools/offer-video/node_modules")
    parser.add_argument("--media",type=Path,default=Path.home()/"upsell-studio-video/website")
    parser.add_argument("--actors",type=Path)
    mode=parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--timing",type=Path)
    mode.add_argument("--layout-only",action="store_true")
    args=parser.parse_args()
    if sys.platform=="darwin":parser.error("VPS only. No build or render on the Mac.")
    result=build(args.kind,args.lang,args.out,args.deps,args.media,args.timing,args.layout_only,args.actors)
    print(json.dumps({"out":str(args.out),"kind":args.kind,"language":args.lang,"duration":result["duration"],"mode":result["mode"],"clientReady":False,"captionsComplete":result["captionsComplete"]}))

if __name__=="__main__":main()

