import asyncio
from sdk.utils.render import html_to_image

ROWS_FUNNEL = [
 ("Ad spend — lead gen","$5,739.70","—",""),
 ("Ad spend — retargeting","$314.46","—",""),
 ("Total ad spend","$6,054.16","—",""),
 ("Leads","558","—",""),
 ("CPL","$10.29","$6–9","warn"),
 ("Lead → intro booked","44.8%  (250)","80%","bad"),
 ("Intros held","253","—",""),
 ("Intro show rate","56.9%  (144)","70%","bad"),
 ("Intro shown → demo booked","60.4%  (87)","55–60%","good"),
 ("Demos held","82","—",""),
 ("Demo show rate","57.3%  (47)","80%","bad"),
 ("Qualified live demos","46","—",""),
 ("Live demo close rate","21.3%","20–25%","good"),
 ("Qualified close rate","21.7%","20–25%","good"),
 ("Clients signed","10","—",""),
]
ROWS_CASH = [
 ("Whop net (gross $23,999.01 − $1,666 refund)","$22,333.01"),
 ("Other provider — 2 × $5,500","$11,000.00"),
 ("Other provider — 1 × $500","$500.00"),
 ("Check — back-end","$1,333.00"),
 ("TOTAL CASH COLLECTED","$35,166.01"),
]
ROWS_SPLIT = [
 ("New-client (front-end) cash","$29,700","$33,700"),
 ("Back-end cash (existing book)","$5,466","$5,466"),
 ("Total cash collected","$35,166","$39,166"),
 ("New : back-end split","84 : 16","86 : 14"),
 ("Contracted revenue","$61,000","$61,000"),
 ("Cash per new deal","$2,970","$3,370"),
 ("CAC","$605","$605"),
 ("FE cash ROAS","4.9x","5.6x"),
 ("Total cash ROAS","5.8x","6.5x"),
 ("Contracted ROAS","10.1x","10.1x"),
]

def frow(r):
    label,val,tgt,flag = r
    cls = {"good":"g","bad":"b","warn":"w",""  :""}[flag]
    strong = " strong" if label in ("Total ad spend","Clients signed") else ""
    return f'<tr class="{strong}"><td>{label}</td><td class="num {cls}">{val}</td><td class="tgt">{tgt}</td></tr>'

html = f"""<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
:root{{--navy:#091333;--cyan:#00CFC8;--cobalt:#2E5BD6;--ink:#1b2340;--mut:#6b7392;--line:#e4e8f2;}}
*{{box-sizing:border-box}}
body{{margin:0;font-family:Inter,sans-serif;background:#fff;width:1240px;padding:44px 48px;color:var(--ink)}}
h1{{font-size:34px;margin:0;color:var(--navy);font-weight:800;letter-spacing:-.5px}}
.sub{{color:var(--mut);font-size:14px;margin-top:6px}}
.bar{{height:5px;background:linear-gradient(90deg,var(--cyan),var(--cobalt));border-radius:4px;margin:18px 0 26px}}
h2{{font-size:14px;text-transform:uppercase;letter-spacing:1.4px;color:var(--cyan);margin:0 0 10px;font-weight:700}}
.kpis{{display:flex;gap:14px;margin-bottom:28px}}
.kpi{{flex:1;background:var(--navy);color:#fff;border-radius:12px;padding:16px 18px}}
.kpi .l{{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#9fb0d8}}
.kpi .v{{font-size:27px;font-weight:800;margin-top:4px}}
.kpi .n{{font-size:11px;color:var(--cyan);margin-top:3px}}
.cols{{display:flex;gap:26px;align-items:flex-start}}
.col{{flex:1}}
table{{width:100%;border-collapse:collapse;font-size:13.5px}}
td,th{{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left}}
th{{background:#f5f7fc;color:var(--navy);font-size:11px;text-transform:uppercase;letter-spacing:.8px}}
.num{{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}}
.tgt{{text-align:right;color:var(--mut);font-size:12px;width:78px}}
tr.strong td{{background:#fafbff;font-weight:700}}
.g{{color:#0f9d58}} .b{{color:#d93025}} .w{{color:#e37400}}
tr.tot td{{background:var(--navy);color:#fff;font-weight:800;border:none}}
.note{{margin-top:22px;background:#f5f7fc;border-left:4px solid var(--cyan);padding:14px 16px;font-size:13px;line-height:1.6}}
.note b{{color:var(--navy)}}
.ft{{margin-top:20px;font-size:11px;color:var(--mut);border-top:1px solid var(--line);padding-top:10px}}
</style></head><body>
<h1>August 2026 — Ad &amp; Funnel Performance</h1>
<div class="sub">Mahara Media · client acquisition (Aug 1–31, 2026) · sources: Meta Ads, CRM, Whop payment export + off-platform payments</div>
<div class="bar"></div>

<div class="kpis">
  <div class="kpi"><div class="l">Total ad spend</div><div class="v">$6,054</div><div class="n">$5,740 lead gen + $314 retargeting</div></div>
  <div class="kpi"><div class="l">Clients signed</div><div class="v">10</div><div class="n">CAC $605</div></div>
  <div class="kpi"><div class="l">Cash collected</div><div class="v">$35,166</div><div class="n">$39,166 if today's 2 land</div></div>
  <div class="kpi"><div class="l">Contracted revenue</div><div class="v">$61,000</div><div class="n">10.1x contracted ROAS</div></div>
  <div class="kpi"><div class="l">FE cash ROAS</div><div class="v">4.9x</div><div class="n">target 3–4x · $2,970/deal</div></div>
</div>

<div class="cols">
 <div class="col">
  <h2>Full funnel vs target</h2>
  <table><tr><th>Metric</th><th style="text-align:right">Actual</th><th style="text-align:right">Target</th></tr>
  {''.join(frow(r) for r in ROWS_FUNNEL)}
  </table>
 </div>
 <div class="col">
  <h2>Cash reconciliation</h2>
  <table><tr><th>Source</th><th style="text-align:right">Amount</th></tr>
  {''.join(f'<tr class="{"tot" if "TOTAL" in a else ""}"><td>{a}</td><td class="num">{b}</td></tr>' for a,b in ROWS_CASH)}
  </table>
  <h2 style="margin-top:24px">New vs back-end · both scenarios</h2>
  <table><tr><th>Metric</th><th style="text-align:right">Without today's 2</th><th style="text-align:right">With today's 2</th></tr>
  {''.join(f'<tr class="{"strong" if a=="Total cash collected" else ""}"><td>{a}</td><td class="num">{b}</td><td class="num" style="color:#2E5BD6">{c}</td></tr>' for a,b,c in ROWS_SPLIT)}
  </table>
 </div>
</div>

<div class="note">
<b>Read of the month.</b> The front end is profitable and the close rate is inside target (21.3% live / 21.7% qualified) — close rate is no longer the binding constraint.
The two real leaks are <b>lead → intro booked at 44.8% vs 80%</b> (~196 leads never booked) and <b>both show rates near 57%</b> vs 70%/80% targets.
Fixing only those, at today's $6K spend, puts you at roughly 18–20 clients and ~$55K new cash per month with no budget increase and no change to the pitch.
Back-end note: the $1,666 Tariq Azzam cycle was collected Aug 7 and refunded Aug 23 — net zero, and a churn event.
</div>
<div class="ft">Prepared by Viktor · 2026-09-01 · Back-end cash = $1,333 + $1,300 + $1,500.01 via Whop + $1,333 by check. Today's pending: Al Ola $2,500 + Actorus $1,500 (both already paid the $500 onboarding fee).</div>
</body></html>"""

async def main():
    r = await html_to_image(html=html, title="Mahara Media — August 2026 Ad & Funnel Performance")
    print(r.image_path, r.permalink)

asyncio.run(main())
