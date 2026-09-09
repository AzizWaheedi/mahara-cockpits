import re, collections, json
t=open('temp/stmt.txt').read()
# join lines
lines=[l.strip() for l in t.replace('\r','').split('\n')]
txt='\n'.join(lines)
pat=re.compile(r'P-\d+-(.+?)\s*/\d+\s*-\n\((USD|EUR|GBP|AED|SAR)\n([\d,]+\.\d+)\n([\d,]+\.?\d*)\)')
rows=[]
for m in pat.finditer(txt):
    name=m.group(1).strip(); cur=m.group(2)
    kwd=float(m.group(3).replace(',','')); fx=float(m.group(4).replace(',',''))
    usd = fx if cur=='USD' else round(kwd*3.16,2)
    rows.append((name,cur,kwd,usd))
print("parsed",len(rows))
agg=collections.defaultdict(lambda:[0.0,0])
for n,c,k,u in rows:
    key=n.upper()
    agg[key][0]+=u; agg[key][1]+=1
for k,(u,n) in sorted(agg.items(), key=lambda x:-x[1][0]):
    print(f"{u:9.2f} {n:3d}  {k}")
print("TOTAL", round(sum(r[3] for r in rows),2))
json.dump(rows, open('temp/stmt_rows.json','w'))
