import datetime as dt
from collections import defaultdict
MONTHS=["2026-09","2026-10","2026-11","2026-12"]
def mk(d): return d.strftime("%Y-%m")
# live: name, plan, mrr, launch, next_pay_date, next_amt   (exact ClickUp values 2026-09-08)
live=[
("ocean home","PIF",2000,"2026-09-02",None,6000),
("Acturus Construction","Monthly",2000,"2026-09-03",None,2000),
("Atlantis Contracting","Split",2000,"2026-08-30","2026-09-30",3000),
("ARCWANI","Split",2000,"2026-08-28","2026-09-28",3000),
("منشآت خالدة","Split",2000,"2026-07-15","2026-08-29",3000),
("MOFAG","Monthly",1333,"2026-06-27","2026-08-26",1333),
("حول العمران","Monthly",1333,"2026-08-20","2026-09-20",1333),
("نهوض نجد","Monthly",700,"2026-05-12","2026-09-07",700),
("Brillant Touch","PIF",1333,"2026-08-29","2026-11-29",4000),
("Liwan","Monthly",1333,"2026-07-11","2026-09-11",1333),
("Joe and Sera","Monthly",1666,"2026-04-28","2026-09-24",1666),
("Safad","Monthly",1300,"2026-08-17","2026-09-17",1300),
]
plan=[  # unlaunched: billing starts at launch
("City Wood","PIF",2000,"2026-09-12"),("Alkhalil","Split",2000,"2026-09-12"),
("Ghazzawi.sa","Split",2000,"2026-09-14"),("Marble and more","Split",2000,"2026-09-14"),
("Decor Plus","Monthly",2000,"2026-09-16"),("Render","Split",2000,"2026-09-16"),
("Castello Industries","Monthly",2000,"2026-09-18"),("شركة العلا","Monthly",2000,"2026-09-20"),
("Ardon","Monthly",2000,"2026-09-22"),("Qatar Technology","Monthly",2000,"2026-09-25"),
("Greystone","PIF",1666,"2026-09-25"),
]
ZERO={"Joe and Sera","نهوض نجد"}
CH=[1.0,0.85,0.6]
sched=defaultdict(lambda: defaultdict(float)); term={}
def add(n,d,amt,idx):
    if mk(d) in MONTHS: sched[n][mk(d)] += 0 if n in ZERO else amt*CH[min(idx,2)]
for n,p,mrr,l,npd,amt in live:
    L=dt.date.fromisoformat(l); end=L+dt.timedelta(days=90); term[n]=end
    if p=="PIF": continue                       # nothing left; Brillant $4k is a renewal we won't take
    if not npd: 
        # no billing date on record: fall back to launch+30 cadence
        dates=[L+dt.timedelta(days=30*i) for i in (1,2)]   # launch-day payment already taken
    else:
        d0=dt.date.fromisoformat(npd); dates=[]
        while d0 < end:
            dates.append(d0); d0+=dt.timedelta(days=30)
            if p=="Split": break                # split = one remaining payment only
    for i,d in enumerate(dates):
        idx = 1 if p=="Split" else (i+1 if not npd else i)
        add(n,d,(3000 if p=="Split" else mrr),idx)
for n,p,mrr,l in plan:
    L=dt.date.fromisoformat(l); term[n]=L+dt.timedelta(days=90)
    if p=="PIF": continue
    if p=="Split": add(n,L+dt.timedelta(days=45),3000,1)  # 0.85
    else:
        # launch-day payment is the deposit + onboarding cash, already collected at signup.
        # First new collection is launch+30, which for a September launch means October.
        for i in (1,2): add(n,L+dt.timedelta(days=30*i),mrr,i)
allc=[x[0] for x in live]+[x[0] for x in plan]
tot=defaultdict(float)
print("| Client | Plan | Sep | Oct | Nov | Dec | Total | Term ends |")
print("|---|---|---|---|---|---|---|---|")
pl={**{n:p for n,p,*_ in live},**{n:p for n,p,*_ in plan}}
for n in allc:
    v=[sched[n].get(m,0) for m in MONTHS]
    for m,x in zip(MONTHS,v): tot[m]+=x
    f=lambda x: f"${x:,.0f}" if x else "-"
    print(f"| {n} | {pl[n]} | {f(v[0])} | {f(v[1])} | {f(v[2])} | {f(v[3])} | {f(sum(v))} | {term[n]:%d %b} |")
print(f"| **Total** | | **${tot['2026-09']:,.0f}** | **${tot['2026-10']:,.0f}** | **${tot['2026-11']:,.0f}** | **${tot['2026-12']:,.0f}** | **${sum(tot.values()):,.0f}** | |")
# Expenses = trimmed delivery crew + software floor + 4.46% processing (NOT 3%).
# Software today is $6,332/mo ACTUAL incl. Maqsam (Aug overhead $7,403 - $1,071 fees); floor while
# servicing 23 accounts is ~$4,000 falling to $300 by Jan. Payroll: 2 call-centre agents, CSM, Sabri,
# media buyer, 1 editor, systems mgr part-time, web dev to 31 Oct. Sep carries $750 Ardon closer
# commission + $500 CSM retention.
EXP={"2026-09":8350+4500,"2026-10":7100+4000,"2026-11":6400+3800,"2026-12":2600+1500}
cum=0
print("\nmonth  collected  exp   net   cum")
for m in MONTHS:
    net=tot[m]-EXP[m]; cum+=net
    print(f"{m} {tot[m]:9,.0f} {EXP[m]:6,.0f} {net:7,.0f} {cum:8,.0f}")
print("Jan: 0 in, 600 exp, cum", f"{cum-600:,.0f}")
print("last term", max(term.values()))
