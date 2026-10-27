#!/usr/bin/env python3
"""The demo firm's bilingual site (Hosh Design & Build, hosh.example, an Example).

Writes out/{en,ar}/{index,projects,project,services,about,contact}.html plus
site.css, fonts and pictures, all local, so Playwright captures it from
file:// on the VPS. No phone number or email anywhere: the WhatsApp button
and the enquiry form carry contact. Pictures are Mahara's own example scenes
(apps/client-success-cockpit/src/present/assets/examples) and the art set's
hero, which is the one project the film follows.

  python3 demo-site/build.py --hero <hero.webp> [--out demo-site/out]
"""
import argparse
import html
import os
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
EXAMPLES = REPO / "apps/client-success-cockpit/src/present/assets/examples"
NM = HERE.parent / "node_modules"

# Service names are the decks' own (present/content.ts SERVICES).
SERVICES = [
    ("Design and build", "تصميم وتنفيذ"),
    ("Architectural design", "تصميم معماري"),
    ("Interior design", "تصميم داخلي"),
    ("Fit-out and renovation", "تشطيب وترميم"),
    ("Construction", "بناء وإنشاءات"),
]

# The portfolio: Mahara's own example scenes (no client's work), with the
# service each sits under. Arabic names follow content.ts EXAMPLE.scenes.
PROJECTS = [
    ("designbuild", "Glass living room over the pool", "صالة زجاج تطل على المسبح", 0),
    ("villa", "Two-storey villa", "فيلا من دورين", 1),
    ("pool", "Villa pool", "مسبح فيلا", 0),
    ("majlis", "Majlis", "مجلس", 2),
    ("kitchen", "Kitchen", "مطبخ", 3),
    ("facade", "Stone facade", "واجهة حجر", 3),
]

# The site is the demo firm's own written copy, so its Arabic is the plain
# written register a Gulf firm's site uses (إلى، شاهدوا، أخبرونا), not
# spoken dialect; the narrator and the captions keep Gulf spoken wording.
# «من ... إلى» rather than «حتى»: IBM Plex Sans Arabic draws تى as one
# ligature that reads like ق at headline size («حق التسليم»).
T = {
    "brand": ("Hosh", "حوش"),
    "brand_sub": ("Design & Build", "للتصميم والبناء"),
    "nav": [
        ("projects.html", "Projects", "المشاريع"),
        ("services.html", "Services", "الخدمات"),
        ("about.html", "About", "من نحن"),
        ("contact.html", "Contact", "تواصل معنا"),
    ],
    "switch": ("العربية", "English"),
    "whatsapp": ("WhatsApp", "واتساب"),
    "hero_h": ("From the first drawing to the handover.", "من أول رسمة إلى التسليم."),
    "hero_p": ("One team designs and builds your home.", "فريق واحد يصمم بيتكم ويبنيه."),
    "see": ("See our projects", "شاهدوا مشاريعنا"),
    "projects": ("Projects", "مشاريعنا"),
    "all": ("All projects", "كل المشاريع"),
    "services": ("Services", "خدماتنا"),
    "project_p": (
        "Designed and built by Hosh, from the first drawing to the handover.",
        "صممناها وبنيناها من أول رسمة إلى التسليم.",
    ),
    "about_h": ("About Hosh", "من نحن"),
    "about_p": (
        "Hosh is a design and build firm. One team takes your project from the first drawing to the handover.",
        "حوش شركة تصميم وتنفيذ. فريق واحد يأخذ مشروعكم من أول رسمة إلى التسليم.",
    ),
    "form_h": ("Tell us about your project", "أخبرونا عن مشروعكم"),
    "f_name": ("Name", "الاسم"),
    "f_mobile": ("Mobile", "رقم الجوال"),
    "f_service": ("Service", "الخدمة"),
    "f_choose": ("Choose a service", "اختاروا الخدمة"),
    "f_msg": ("Message", "رسالتكم"),
    "f_send": ("Send", "إرسال"),
    "prefer": ("Prefer WhatsApp?", "تفضلون واتساب؟"),
    "foot": ("hosh.example · Example site", "hosh.example · موقع للتوضيح"),
}


def tr(key, lang):
    v = T[key]
    return html.escape(v[0] if lang == "en" else v[1])


# The mark: a house drawn in plan around its courtyard (a hosh), the gap in
# the lower wall is the way in.
MARK = (
    '<svg class="mark" viewBox="0 0 32 32" aria-hidden="true">'
    '<path d="M3 3h26v26H19.5v-4.5H25V7H7v17.5h5.5V29H3z" fill="currentColor"/>'
    '<rect x="12" y="12" width="8" height="8" fill="currentColor"/></svg>'
)

WA_GLYPH = (
    '<svg class="wa-g" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5a9.5 9.5 0 0 0-8.2 14.3L2.5 21.5l4.8-1.3A9.5 9.5 0 1 0 12 2.5z" '
    'fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.6 7.6c.3-.6.6-.6 1-.6.3 0 .5.1.7.6l.8 1.9c.1.3 0 .6-.2.8l-.6.7c.6 1.3 1.7 2.4 3 3l.7-.6c.2-.2.5-.3.8-.2l1.9.8c.4.2.6.4.5.8-.1.9-.9 1.9-2 1.9-3.4 0-7-3.6-7-7 0-.8.2-1.5.4-2.1z" fill="currentColor"/></svg>'
)


def header(lang, page):
    other = "ar" if lang == "en" else "en"
    links = "".join(
        f'<a href="{h}"{" aria-current=page" if h == page else ""}>{html.escape(en if lang == "en" else ar)}</a>'
        for h, en, ar in T["nav"]
    )
    return f"""
<header class="top">
  <a class="brand" href="index.html">{MARK}<span class="word"><b>{tr('brand', lang)}</b><small>{tr('brand_sub', lang)}</small></span></a>
  <nav class="nav">{links}</nav>
  <div class="tools">
    <a class="switch" id="lang-switch" href="../{other}/{page}" lang="{other}">{tr('switch', lang)}</a>
    <a class="wa wa-sm" href="#whatsapp">{WA_GLYPH}<span>{tr('whatsapp', lang)}</span></a>
  </div>
</header>"""


def footer(lang):
    links = "".join(
        f'<a href="{h}">{html.escape(en if lang == "en" else ar)}</a>' for h, en, ar in T["nav"]
    )
    return f"""
<footer class="foot" id="footer">
  <a class="brand" href="index.html">{MARK}<span class="word"><b>{tr('brand', lang)}</b><small>{tr('brand_sub', lang)}</small></span></a>
  <nav class="foot-nav">{links}</nav>
  <p class="foot-note" id="foot-note">{tr('foot', lang)}</p>
</footer>"""


def page(lang, name, title, body, cls=""):
    d = "rtl" if lang == "ar" else "ltr"
    return f"""<!doctype html>
<html lang="{lang}" dir="{d}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title><link rel="stylesheet" href="../site.css"></head>
<body class="{cls}">{header(lang, name)}
<main>{body}</main>{footer(lang)}
<a class="wa wa-float" id="wa-float" href="#whatsapp" aria-label="{tr('whatsapp', lang)}">{WA_GLYPH}<span>{tr('whatsapp', lang)}</span></a>
</body></html>
"""


def pname(p, lang):
    return html.escape(p[1] if lang == "en" else p[2])


def sname(i, lang):
    return html.escape(SERVICES[i][0] if lang == "en" else SERVICES[i][1])


def home(lang):
    tiles = "".join(
        f'<a class="tile" href="project.html"><img src="../img/{p[0]}-feed.webp" alt=""><span>{pname(p, lang)}</span></a>'
        for p in PROJECTS[:4]
    )
    services = "".join(f"<li>{sname(i, lang)}</li>" for i in range(len(SERVICES)))
    body = f"""
<section class="hero" id="hero">
  <div class="hero-copy">
    <h1>{tr('hero_h', lang)}</h1>
    <p>{tr('hero_p', lang)}</p>
    <div class="ctas"><a class="btn" href="projects.html">{tr('see', lang)}</a><a class="wa" href="#whatsapp">{WA_GLYPH}<span>{tr('whatsapp', lang)}</span></a></div>
  </div>
  <figure class="hero-pic" id="hero-pic"><img src="../img/hero.webp" alt=""></figure>
</section>
<section class="strip" id="strip">
  <div class="row-head"><h2>{tr('projects', lang)}</h2><a href="projects.html">{tr('all', lang)}</a></div>
  <div class="tiles">{tiles}</div>
</section>
<section class="services-row" id="services-row">
  <h2>{tr('services', lang)}</h2><ul>{services}</ul>
</section>"""
    return page(lang, "index.html", f"{T['brand'][0]} {T['brand_sub'][0]}", body, "home")


def projects(lang):
    cards = "".join(
        f'<a class="card" href="project.html"><img src="../img/{p[0]}-feed.webp" alt=""><b>{pname(p, lang)}</b><small>{sname(p[3], lang)}</small></a>'
        for p in PROJECTS
    )
    body = f'<section class="list" id="list"><h1>{tr("projects", lang)}</h1><div class="cards">{cards}</div></section>'
    return page(lang, "projects.html", "Projects", body)


def project(lang):
    p = PROJECTS[0]
    body = f"""
<section class="one" id="one">
  <figure class="one-main"><img src="../img/{p[0]}-feed.webp" alt=""></figure>
  <div class="one-copy">
    <p class="crumb"><a href="projects.html">{tr('projects', lang)}</a></p>
    <h1>{pname(p, lang)}</h1>
    <p class="tag">{sname(p[3], lang)}</p>
    <p>{tr('project_p', lang)}</p>
    <figure class="one-side"><img src="../img/{p[0]}-story.webp" alt=""></figure>
  </div>
</section>"""
    return page(lang, "project.html", "Project", body)


def services(lang):
    items = "".join(f"<li><b>{sname(i, lang)}</b></li>" for i in range(len(SERVICES)))
    body = f'<section class="svc" id="svc"><h1>{tr("services", lang)}</h1><ol>{items}</ol></section>'
    return page(lang, "services.html", "Services", body)


def about(lang):
    body = f'<section class="about"><h1>{tr("about_h", lang)}</h1><p>{tr("about_p", lang)}</p></section>'
    return page(lang, "about.html", "About", body)


def contact(lang):
    opts = "".join(f"<option>{sname(i, lang)}</option>" for i in range(len(SERVICES)))
    body = f"""
<section class="contact" id="contact">
  <form class="form" id="form" onsubmit="return false">
    <h1>{tr('form_h', lang)}</h1>
    <label>{tr('f_name', lang)}<input type="text" autocomplete="off"></label>
    <label>{tr('f_mobile', lang)}<input type="tel" autocomplete="off"></label>
    <label>{tr('f_service', lang)}<select><option selected>{tr('f_choose', lang)}</option>{opts}</select></label>
    <label>{tr('f_msg', lang)}<textarea rows="4"></textarea></label>
    <button type="button" class="btn">{tr('f_send', lang)}</button>
  </form>
  <aside class="prefer"><p>{tr('prefer', lang)}</p><a class="wa" href="#whatsapp">{WA_GLYPH}<span>{tr('whatsapp', lang)}</span></a></aside>
</section>"""
    return page(lang, "contact.html", "Contact", body)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hero", required=True, help="the one project's hero, as the site shows it")
    ap.add_argument("--out", default=str(HERE / "out"))
    a = ap.parse_args()
    out = Path(a.out)
    if out.exists():
        shutil.rmtree(out)
    (out / "img").mkdir(parents=True)
    (out / "fonts").mkdir()
    shutil.copy(a.hero, out / "img/hero.webp")
    for p in PROJECTS:
        for kind in ("feed", "story"):
            shutil.copy(EXAMPLES / f"{p[0]}-{kind}.webp", out / f"img/{p[0]}-{kind}.webp")
    fonts = {
        "plex-400.woff2": "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2",
        "plex-500.woff2": "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2",
        "plex-600.woff2": "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2",
        "plexar-400.woff2": "@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-400-normal.woff2",
        "plexar-500.woff2": "@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-500-normal.woff2",
        "plexar-600.woff2": "@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-600-normal.woff2",
    }
    for name, src in fonts.items():
        shutil.copy(NM / src, out / "fonts" / name)
    shutil.copy(HERE / "site.css", out / "site.css")
    for lang in ("en", "ar"):
        (out / lang).mkdir()
        for name, fn in (
            ("index.html", home),
            ("projects.html", projects),
            ("project.html", project),
            ("services.html", services),
            ("about.html", about),
            ("contact.html", contact),
        ):
            (out / lang / name).write_text(fn(lang), encoding="utf-8")
    print(f"site: {out} ({len(os.listdir(out / 'en'))} pages per language)")


if __name__ == "__main__":
    main()
