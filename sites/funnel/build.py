#!/usr/bin/env python3
"""Build the Mahara funnel as a static site for Vercel.

    python3 build.py            -> writes site/ (deploy that folder)

Sources (src/):
  home.html               home page (was the GHL Custom Code element; new hero + Google rating badge)
  *.html                  the other custom-code pages, as they were stored in GHL
  src/native-pages.json   content of the pages GHL built from its own elements
  src/page-meta.json      each GHL page's SEO title / description / favicon

Every page gets the Meta Pixel with PageView only (Lead and Schedule go through
CAPI), the Mahara favicon, and the same URL path it had on funnel.maharamedia.com.
"""
import base64, hashlib, html, json, os, re, shutil, sys, urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'src')
OUT = os.path.join(ROOT, 'site')
ASSETS = os.path.join(OUT, 'assets')

PIXEL_ID = '850580864362564'
TEAL = '#00CFC8'

native = json.load(open(os.path.join(SRC, 'native-pages.json'), encoding='utf-8'))
meta = json.load(open(os.path.join(SRC, 'page-meta.json'), encoding='utf-8'))

# ---------------------------------------------------------------- assets
# Images that GHL hosts today. They are copied into /assets so the site no longer
# depends on GHL's storage.
FAVICON_URL = 'https://storage.googleapis.com/msgsndr/7NI8yyJtwsh2OOWA5Icr/media/67dd663fd8aa9e4614d9b979.png'
LOGO_DARK_URL = 'https://storage.googleapis.com/msgsndr/7NI8yyJtwsh2OOWA5Icr/media/fa7edfb1-5273-4140-91ca-51fc9ce7185f.png'
LOGO_LIGHT_URL = 'https://storage.googleapis.com/msgsndr/7NI8yyJtwsh2OOWA5Icr/media/f17794d8-d52f-4ac5-9fa6-af5ec149b788.png'
BOOKING_BG_URL = 'https://storage.googleapis.com/msgsndr/4fySqGczT7bD12vraASO/media/69254b88098a9bc43c3a40fb.png'
CASE_BG_URL = 'https://storage.googleapis.com/msgsndr/awiOlflc0ZHXuob4Gads/media/670ec35ada87fca2820a627d.jpeg'
# url -> (file name in /assets, how to optimise it): ('jpg'|'webp'|'png', max width, quality[, flatten colour])
REMOTE = {
    FAVICON_URL: ('favicon.png', ('png', 96, None)),
    LOGO_DARK_URL: ('mahara-logo-dark-bg.webp', ('webp', 600, 85)),
    LOGO_LIGHT_URL: ('mahara-logo-light-bg.webp', ('webp', 640, 85)),
    BOOKING_BG_URL: ('booking-bg.jpg', ('jpg', 1920, 62, (0, 0, 0))),   # shown at 30% over black
    CASE_BG_URL: ('case-bg.jpg', ('jpg', 920, 62)),                     # shown at 30% over white
}
FILESAFE = re.compile(r'https://assets\.cdn\.filesafe\.space/7NI8yyJtwsh2OOWA5Icr/media/([0-9a-f]+)\.(png|jpe?g|webp|gif)')
CACHE = os.path.join(ROOT, '.cache')


def optimise(raw, out, rule):
    """Resize to what the page shows and re-encode (Pillow); fall back to the original bytes."""
    try:
        from PIL import Image
    except ImportError:
        shutil.copyfile(raw, out); return
    fmt, width, quality = rule[0], rule[1], rule[2]
    im = Image.open(raw)
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    if fmt == 'jpg':
        if im.mode in ('RGBA', 'LA', 'P'):
            im = im.convert('RGBA')
            bg = Image.new('RGB', im.size, rule[3] if len(rule) > 3 else (255, 255, 255))
            bg.paste(im, mask=im.split()[-1]); im = bg
        im.convert('RGB').save(out, 'JPEG', quality=quality, optimize=True, progressive=True)
    elif fmt == 'webp':
        im.save(out, 'WEBP', quality=quality, method=6)
    else:
        im.save(out, 'PNG', optimize=True)


def fetch(url, name, rule=None):
    """Download url once (into .cache), write the optimised copy to assets/, return its public path."""
    if url in REMOTE and rule is None:
        name, rule = REMOTE[url]
    path = os.path.join(ASSETS, name)
    if not os.path.exists(path):
        os.makedirs(CACHE, exist_ok=True)
        raw = os.path.join(CACHE, hashlib.sha1(url.encode()).hexdigest()[:16])
        if not os.path.exists(raw):
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=60) as r, open(raw, 'wb') as f:
                f.write(r.read())
        os.makedirs(os.path.dirname(path), exist_ok=True)
        optimise(raw, path, rule) if rule else shutil.copyfile(raw, path)
    return '/assets/' + name


def localize_remote(text):
    for url in REMOTE:
        if url in text:
            text = text.replace(url, fetch(url, None))
    def media(m):   # service-card photos and the like: shown at most ~720px wide
        if m.group(2) in ('jpg', 'jpeg'):
            return fetch(m.group(0), f'media/{m.group(1)}.jpg', ('jpg', 720, 78))
        return fetch(m.group(0), f'media/{m.group(1)}.webp', ('webp', 720, 80))
    return FILESAFE.sub(media, text)


B64 = re.compile(r'data:image/(png|jpeg|jpg|webp|avif|gif|svg\+xml);base64,([A-Za-z0-9+/=]{2000,})')


def extract_inline_images(text):
    """Move large base64 images into /assets/img/<hash>.<ext> (cacheable, out of the HTML)."""
    def repl(m):
        ext = {'jpeg': 'jpg', 'svg+xml': 'svg'}.get(m.group(1), m.group(1))
        data = base64.b64decode(m.group(2))
        name = 'img/' + hashlib.sha1(data).hexdigest()[:12] + '.' + ext
        path = os.path.join(ASSETS, name)
        if not os.path.exists(path):
            open(path, 'wb').write(data)
        return '/assets/' + name
    return B64.sub(repl, text)


# ---------------------------------------------------------------- shared head bits
PIXEL = f"""<!-- Meta Pixel: PageView only. Lead and Schedule are sent server-side (CAPI). -->
<script>
!function(f,b,e,v,n,t,s){{if(f.fbq)return;n=f.fbq=function(){{n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)}};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','{PIXEL_ID}');
fbq('track','PageView');
</script>"""
PIXEL_NOSCRIPT = f'<noscript><img height="1" width="1" style="display:none" alt="" src="https://www.facebook.com/tr?id={PIXEL_ID}&ev=PageView&noscript=1"/></noscript>'


def head_meta(key, fallback_title=None):
    m = meta.get(key, {})
    title = m.get('title') or fallback_title
    out = []
    if m.get('description'):
        d = html.escape(m['description'], quote=True)
        out += [f'<meta name="description" content="{d}" />', f'<meta property="og:description" content="{d}" />']
    if title:
        out.append(f'<meta property="og:title" content="{html.escape(title, quote=True)}" />')
    if 'noindex' in (m.get('robots') or []):
        out.append('<meta name="robots" content="noindex" />')
    out.append('<link rel="icon" type="image/png" href="/assets/favicon.png" />')
    out.append('<link rel="preconnect" href="https://connect.facebook.net" />')
    return title, '\n'.join(out)


def nonblocking_fonts(text):
    """Google Fonts stylesheet -> preload + swap, so it never blocks the first paint."""
    def repl(m):
        href = m.group(1)
        return (f'<link rel="preload" as="style" href="{href}" onload="this.onload=null;this.rel=\'stylesheet\'" />'
                f'<noscript><link rel="stylesheet" href="{href}" /></noscript>')
    return re.sub(r'<link href="(https://fonts\.googleapis\.com/css2\?[^"]+)" rel="stylesheet" ?/?>', repl, text)


LAZY_ELFSIGHT = """<script>
/* Google reviews widget: load it only when the reviews section is close to the screen. */
(function(){var t=document.querySelector('[class*="elfsight-app-"]');function go(){var s=document.createElement('script');s.src='https://elfsightcdn.com/platform.js';s.async=true;document.body.appendChild(s);}
if(!t)return;if(!('IntersectionObserver' in window)){go();return;}
var io=new IntersectionObserver(function(es){for(var i=0;i<es.length;i++){if(es[i].isIntersecting){io.disconnect();go();return;}}},{rootMargin:'1200px 0px'});io.observe(t);})();
</script>"""


def finish_custom_page(text, key, home=False):
    text = text.lstrip('﻿')
    title, extra = head_meta(key)
    if title:
        text = re.sub(r'<title>.*?</title>', f'<title>{html.escape(title)}</title>', text, count=1, flags=re.S)
    # head additions right after the viewport tag
    text = re.sub(r'(<meta name="viewport"[^>]*>)', lambda m: m.group(1) + '\n' + extra + '\n' + PIXEL, text, count=1)
    text = re.sub(r'(<body\b[^>]*>)', lambda m: m.group(1) + '\n' + PIXEL_NOSCRIPT, text, count=1)
    # GHL's page wrapper sets line-height:normal around the custom code, and these pages were
    # designed and checked inside it. Keep that, so buttons and bars have the same height as on GHL.
    # overflow-x:clip on the root: elements waiting to slide in sit 50px off-screen, which otherwise
    # widens the page on phones and cuts the start of every line (the explainer did this on GHL too).
    text = text.replace('</head>', '<style>body>*{line-height:normal}html{overflow-x:clip}</style>\n</head>', 1)
    text = nonblocking_fonts(text)
    if 'elfsightcdn.com/platform.js' in text:
        text = text.replace('<script src="https://elfsightcdn.com/platform.js" async></script>', LAZY_ELFSIGHT)
    if home:
        # GHL put 40px of its own wrapper above the code; on Vercel the page starts at the top,
        # so the hero needs those 40px back to clear the fixed top bar.
        text = text.replace('.hero { padding-top: 30px;', '.hero { padding-top: 70px;', 1)
        text = text.replace('.hero { padding-top: 46px;', '.hero { padding-top: 86px;', 1)
        assert '.hero { padding-top: 70px;' in text and '.hero { padding-top: 86px;' in text
        # Wistia's player.js is only needed for <wistia-player> tags; this page uses iframe embeds.
        if '<wistia-player' not in text and 'wistia_async_' not in text:
            text = text.replace('<script src="https://fast.wistia.net/player.js" async></script>\n', '')
    text = extract_inline_images(text)
    text = localize_remote(text)
    leftovers = re.findall(r'https://(?:storage\.googleapis\.com/msgsndr|assets\.cdn\.filesafe\.space/[^"\' ]+)', text)
    if leftovers:
        print('   still on GHL storage:', leftovers[:3])
    return text


# ---------------------------------------------------------------- native page templates
FONT_RUBIK = ('<link rel="preconnect" href="https://fonts.googleapis.com" />'
              '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />'
              '<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Rubik:ital,wght@0,400;0,500;0,700;0,800;1,700;1,800&display=swap" '
              'onload="this.onload=null;this.rel=\'stylesheet\'" />'
              '<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Rubik:ital,wght@0,400;0,500;0,700;0,800;1,700;1,800&display=swap" /></noscript>')


def page(key, body, css, lang='ar', title=None, extra_head='', scripts=''):
    t, extra = head_meta(key, title)
    d = 'rtl' if lang == 'ar' else 'ltr'
    return f"""<!DOCTYPE html>
<html lang="{lang}" dir="{d}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>{html.escape(t or 'Mahara Media')}</title>
{extra}
{extra_head}
{PIXEL}
<style>{css}</style>
</head>
<body>
{PIXEL_NOSCRIPT}
{body}
{scripts}
</body>
</html>
"""


def clean_heading(h):
    """GHL heading HTML -> our markup: its theme colours mapped, its font overrides dropped."""
    h = re.sub(r'^\s*<h[12][^>]*>|</h[12]>\s*$', '', h.strip())
    h = h.replace('var(--black)', '#000').replace('var(--white)', '#fff')
    h = re.sub(r'var\(--color-[a-z]+\)', 'var(--teal)', h)
    h = re.sub(r';?\s*font-family:\s*[^;"]+', '', h)
    h = re.sub(r'style="\s*;?\s*"', '', h)
    return h


GHL_EMBED = 'https://link.msgsndr.com/js/form_embed.js'


def calendar_iframe(cal_id, title):
    """GHL's own embed markup. form_embed.js answers the calendar's request for the page's query
    string (name, email, phone, utm_*), so prefill works as on GHL, and it resizes the frame."""
    return (f'<iframe src="https://api.leadconnectorhq.com/widget/booking/{cal_id}" title="{html.escape(title, quote=True)}" '
            f'id="{cal_id}_1794000000000" scrolling="no" style="width:100%;border:none;overflow:hidden;height:700px;display:block"></iframe>')


CAL_SCRIPT = """<script>
/* Case pages: the calendar is added when the popup first opens. GHL's form_embed.js scans the
   page once when it runs, so the calendar goes in first and the script after it. */
function maharaCalendar(holder){
  if (holder.dataset.ready) return; holder.dataset.ready = '1';
  holder.innerHTML = holder.dataset.iframe;
  var s = document.createElement('script'); s.src = '""" + GHL_EMBED + """'; document.body.appendChild(s);
}
</script>"""

BOOKING_CSS = """
:root{--teal:#01D0C7;--bg:#000;--rule:#CBD5E0}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:#fff;font-family:"Rubik",system-ui,-apple-system,"Segoe UI",sans-serif;min-height:100vh}
.bk{position:relative;overflow:hidden;padding:clamp(24px,5vw,56px) 16px clamp(40px,6vw,72px)}
.bk::before{content:"";position:absolute;inset:0;background:url(/assets/booking-bg.jpg) center/cover no-repeat;opacity:.3;pointer-events:none}
.bk>*{position:relative}
.bk-logo{display:block;width:clamp(180px,24vw,300px);height:auto;margin:0 auto clamp(28px,5vw,56px)}
.bk h1{margin:0 auto;max-width:1000px;text-align:center;font-weight:800;line-height:1.3;font-size:clamp(28px,4.8vw,62px)}
.bk h1 span{color:var(--teal)}
.bk-rule{width:min(290px,60%);height:5px;border:0;border-radius:3px;background:var(--rule);margin:clamp(18px,3vw,28px) auto clamp(28px,4vw,44px)}
.bk-card{max-width:1052px;margin:0 auto;padding:clamp(8px,1.6vw,20px);border:2px solid var(--teal);border-radius:16px;background:#000}
.bk-cal{border-radius:10px;overflow:hidden;background:#fff;min-height:700px}
"""


def booking_page(slug, key):
    items = native[key]
    h = next(i for i in items if i['type'] == 'heading')
    cal = next(i for i in items if i['type'] == 'calendar' and not i['inPopup'])
    logo = fetch(next(i['src'] for i in items if i['type'] == 'image'), None)
    fetch(BOOKING_BG_URL, None)
    heading = clean_heading(h['html']).replace(' style="color: var(--teal)"', '')
    body = f"""<main class="bk">
  <img class="bk-logo" src="{logo}" alt="Mahara Media" width="300" height="101" fetchpriority="high" />
  <h1>{heading}</h1>
  <hr class="bk-rule" />
  <div class="bk-card"><div class="bk-cal">{calendar_iframe(cal['calendarId'], 'احجز موعدك')}</div></div>
</main>"""
    scripts = f'<script src="{GHL_EMBED}" type="text/javascript"></script>'
    extra_head = ('<link rel="preconnect" href="https://api.leadconnectorhq.com" />'
                  '<link rel="preconnect" href="https://link.msgsndr.com" />' + FONT_RUBIK)
    return page(key, body, BOOKING_CSS, extra_head=extra_head, scripts=scripts)


CASE_CSS = """
:root{--teal:#00CFC8;--mint:#81E6D9;--navy:#092D45}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#fff;color:#000;font-family:"Rubik",system-ui,-apple-system,"Segoe UI",sans-serif}
.cs-hero,.cs-main{position:relative;padding:20px 16px}
.cs-hero::before,.cs-main::before{content:"";position:absolute;inset:0;background:url(/assets/case-bg.jpg) center/cover no-repeat;opacity:.3;pointer-events:none}
.cs-hero{border-bottom:1px solid rgba(0,0,0,.6)}
.wrap{position:relative;max-width:1100px;margin:0 auto}
.cs-banner{background:var(--teal);color:#fff;border-radius:8px;padding:14px 18px;text-align:center;font-style:italic;font-weight:700;font-size:clamp(20px,2.6vw,32px);line-height:1.3;margin:0 0 22px}
.cs-head{background:#fff;border-radius:12px;padding:clamp(10px,1.6vw,16px) clamp(14px,2vw,24px)}
.cs-head h1{margin:0;text-align:center;color:var(--teal);font-weight:800;font-size:clamp(30px,4.4vw,56px);line-height:1.3;text-shadow:0 3px 4px rgba(0,0,0,.18);text-wrap:balance}
.cs-head h1 u{text-underline-offset:.12em}
.cs-main{padding-top:0}
.cs-box{position:relative;max-width:1140px;margin:0 auto;background:var(--teal);padding:8px 8px 20px}
.cs-frame{background:#fff;border:1.5px solid #1a73e8;border-radius:22px;padding:clamp(10px,1.8vw,20px)}
.cs-video{position:relative;padding-top:56.25%;border-radius:14px;overflow:hidden;background:#000}
.cs-video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.cs-btn{display:block;margin:22px auto 0;background:var(--mint);color:#000;border:0;border-radius:10px;padding:20px 26px;font:700 16px/1.3 "Rubik",system-ui,sans-serif;cursor:pointer;transition:transform .15s,box-shadow .2s}
.cs-btn:hover{transform:translateY(-1px);box-shadow:0 8px 24px -8px rgba(0,0,0,.35)}
.cs-btn:focus-visible{outline:3px solid #000;outline-offset:3px}
.cs-foot{background:var(--navy);padding:0 clamp(0px,4vw,55px)}
.cs-foot-card{max-width:1170px;margin:0 auto;background:#fff;text-align:center;padding:10px 16px 14px;font-size:14px;line-height:1.3;direction:ltr}
.cs-foot-card img{display:block;width:min(310px,80%);height:auto;margin:0 auto 4px}
.cs-foot-card h2{font-size:14px;font-weight:500;margin:0}
.cs-foot-card p{margin:0}
dialog.cs-modal{width:min(960px,96vw);max-height:92vh;padding:0;border:0;border-radius:14px;overflow:auto;background:#fff}
dialog.cs-modal::backdrop{background:rgba(0,0,0,.65)}
.cs-close{position:sticky;top:0;float:left;margin:8px;width:40px;height:40px;border:0;border-radius:50%;background:#f1f3f5;font-size:24px;line-height:40px;cursor:pointer;z-index:2}
.cs-cal{min-height:700px;clear:both}
@media (max-width:640px){.cs-banner{padding:12px 14px;margin-bottom:16px}.cs-btn{width:100%;padding:18px 16px}}
"""

WISTIA_ID = re.compile(r"(?:embed/iframe/|embed/|wistia_async_|media-id=['\"])([a-z0-9]{10})")


def case_page(slug, key):
    items = native[key]
    heads = [i for i in items if i['type'] == 'heading']
    banner = next(h for h in heads if 'انتباه' in h['html'])
    headline = next(h for h in heads if h is not banner)
    video = next(i for i in items if i['type'] == 'video')
    vid = WISTIA_ID.search(video.get('embed') or video.get('url') or '').group(1)
    button = next(i for i in items if i['type'] == 'button')
    cal = next(i for i in items if i['type'] == 'calendar')
    foot = next(i for i in items if i['type'] == 'sub-heading')
    fetch(CASE_BG_URL, None)
    logo = fetch(LOGO_LIGHT_URL, None)
    banner_text = re.sub(r'<[^>]+>', '', banner['html']).strip()
    title_text = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', headline['html'])).strip()
    foot_html = re.sub(r'\s*style="[^"]*"', '', foot['html'])
    body = f"""<section class="cs-hero">
  <div class="wrap">
    <div class="cs-banner">{html.escape(banner_text)}</div>
    <div class="cs-head"><h1>{clean_heading(headline['html'])}</h1></div>
  </div>
</section>
<section class="cs-main">
  <div class="cs-box">
    <div class="cs-frame"><div class="cs-video"><iframe src="https://fast.wistia.net/embed/iframe/{vid}?seo=true&amp;videoFoam=false" title="{html.escape(title_text, quote=True)}" allow="autoplay; fullscreen" allowfullscreen loading="eager"></iframe></div></div>
    <button type="button" class="cs-btn" data-open-calendar>{html.escape(button['text'].strip())}</button>
  </div>
</section>
<footer class="cs-foot">
  <div class="cs-foot-card">
    <img src="{logo}" alt="Mahara Media" width="310" height="95" loading="lazy" />
    {foot_html}
  </div>
</footer>
<dialog class="cs-modal" aria-label="احجز مكالمة">
  <button type="button" class="cs-close" aria-label="إغلاق" data-close>&times;</button>
  <div class="cs-cal" data-iframe="{html.escape(calendar_iframe(cal['calendarId'], 'احجز مكالمة مع فريق حصول المشاريع'), quote=True)}"></div>
</dialog>"""
    scripts = CAL_SCRIPT + """<script>
(function(){
  var d = document.querySelector('.cs-modal');
  document.querySelector('[data-open-calendar]').addEventListener('click', function(){
    maharaCalendar(d.querySelector('.cs-cal'));
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  });
  d.querySelector('[data-close]').addEventListener('click', function(){ d.close ? d.close() : d.removeAttribute('open'); });
  d.addEventListener('click', function(e){ if (e.target === d && d.close) d.close(); });
})();
</script>"""
    extra_head = ('<link rel="preconnect" href="https://fast.wistia.net" />'
                  '<link rel="preconnect" href="https://api.leadconnectorhq.com" />' + FONT_RUBIK)
    return page(key, body, CASE_CSS, title=f'Mahara Media | {title_text}', extra_head=extra_head, scripts=scripts)


TERMS_CSS = """
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#fff;color:#7D8DB8;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
main{max-width:880px;margin:0 auto;padding:clamp(32px,6vw,64px) 20px 64px}
h1,h2{color:#3D5389;line-height:1.2}
h1{font-size:clamp(30px,4vw,40px);margin:0 0 24px}
h2{font-size:clamp(22px,2.6vw,26px);margin:36px 0 12px}
p{margin:0 0 16px}
a{color:#3D5389}
"""


def terms_page(slug, key):
    items = native[key]
    parts = []
    first = True
    for i in items:
        if i['type'] == 'heading':
            text = re.sub(r'<[^>]+>', '', i['html']).strip()
            parts.append(f'<h1>{html.escape(text)}</h1>' if first else f'<h2>{html.escape(text)}</h2>')
            first = False
        elif i['type'] == 'paragraph':
            p = re.sub(r'\s*style="[^"]*"', '', i['html'] or '')
            # GHL left these links empty; point 'Privacy Policy' at the privacy page, unwrap the rest
            p = re.sub(r'<a [^>]*href=""[^>]*>(.*?)</a>',
                       lambda m: f'<a href="/{PRIVACY_PATH}">{m.group(1)}</a>' if 'Privacy Policy' in m.group(1) else m.group(1), p, flags=re.S)
            parts.append(p)
    return page(key, '<main>\n' + '\n'.join(parts) + '\n</main>', TERMS_CSS, lang='en')


NOT_FOUND = """<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Mahara Media</title>
<script>location.replace('/' + location.search + location.hash);</script>
<meta http-equiv="refresh" content="0;url=/" />
</head>
<body style="margin:0;background:#091333;color:#fff;font-family:system-ui,sans-serif;text-align:center;padding:48px 16px">
<a href="/" style="color:#00CFC8">مهارة ميديا — الصفحة الرئيسية</a>
</body>
</html>
"""


# ---------------------------------------------------------------- the site
CUSTOM = {   # path on funnel.maharamedia.com -> (source, page-meta key)
    'index': (os.path.join(SRC, 'home.html'), 'home'),
    'intro-thankyou': (os.path.join(SRC, 'intro-thankyou.html'), 'intro-thankyou'),
    'demo-thankyou': (os.path.join(SRC, 'demo-thankyou.html'), 'demo-thankyou'),
    'intro-thankyou-uq': (os.path.join(SRC, 'intro-thankyou-uq.html'), 'intro-thankyou-uq'),
    'explainer-doc': (os.path.join(SRC, 'explainer-doc.html'), 'offer-explainer'),
    'proof-page': (os.path.join(SRC, 'proof-page.html'), 'proof-clone'),
}
BOOKING = {'booking-intro': 'intro-booking', 'demo-booking': 'demo-booking', 'booking-intro-uq': 'intro-booking-uq'}
CASES = {
    'case-study': 'case-study',                                         # Nawaf
    'case-study-524145': 'case-study-c1',                               # Ali
    'case-study-524145-527369': 'case-study-c2',                        # Abdullah
    'case-study-524145-527369-835020': 'case-study-c3',                 # Ahmed
    'case-study-524145-527369-835020-394318': 'haneen',                 # Haneen
    'case-study-524145-527369-835020-394318-112195': 'life-depth',      # Life Depth
    'safad': 'safad',
    'joeandsera': 'joe-and-sera',
}
PRIVACY_PATH = 'privacy-policy-497114'
TERMS = {'8-terms': 'terms', PRIVACY_PATH: 'privacy'}

VERCEL = {
    "cleanUrls": True,
    "trailingSlash": False,
    "rewrites": [
        {"source": "/funnel-420185", "destination": "/"},              # GHL's own path for the home step
        {"source": "/intro-booking", "destination": "/booking-intro"},  # older path of the same step, used by webinar /p1 /p2
    ],
    "headers": [
        {"source": "/assets/(.*)", "headers": [{"key": "Cache-Control", "value": "public, max-age=31536000, immutable"}]},
        {"source": "/(.*)", "headers": [{"key": "X-Content-Type-Options", "value": "nosniff"}]},
    ],
}


def main():
    # site/assets is kept (and committed): the images were copied off GHL's storage, which may not
    # exist later. fetch() only downloads what is missing. Delete an asset by hand to refresh it.
    if os.path.isdir(OUT):
        keep = (os.path.join(OUT, '.vercel'), ASSETS)
        for n in os.listdir(OUT):
            p = os.path.join(OUT, n)
            if p in keep:
                continue
            shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
    os.makedirs(os.path.join(ASSETS, 'img'), exist_ok=True)
    os.makedirs(os.path.join(ASSETS, 'media'), exist_ok=True)
    fetch(FAVICON_URL, None)

    def write(slug, text):
        open(os.path.join(OUT, slug + '.html'), 'w', encoding='utf-8').write(text)
        print(f'  /{"" if slug == "index" else slug:48s} {len(text.encode()) // 1024:4d} KB')

    for slug, (src, key) in CUSTOM.items():
        write(slug, finish_custom_page(open(src, encoding='utf-8').read(), key, home=(slug == 'index')))
    for slug, key in BOOKING.items():
        write(slug, booking_page(slug, key))
    for slug, key in CASES.items():
        write(slug, case_page(slug, key))
    for slug, key in TERMS.items():
        write(slug, terms_page(slug, key))
    json.dump(VERCEL, open(os.path.join(OUT, 'vercel.json'), 'w'), indent=2)
    open(os.path.join(OUT, '.vercelignore'), 'w').write('.env*\n.gitignore\n.DS_Store\n')
    # Any address that is not one of these pages (old GHL steps, typos) lands on the main page,
    # keeping its utm_* so the ad is still credited, instead of showing a 404.
    write('404', NOT_FOUND)
    total = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(ASSETS) for f in fs)
    print(f'  assets: {total // 1024} KB')


if __name__ == '__main__':
    main()
