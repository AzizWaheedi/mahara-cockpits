import re,glob,json,subprocess,sys
import sys
M=sys.argv[1] if len(sys.argv)>1 else 'supabase/migrations/'
PAT=sys.argv[2] if len(sys.argv)>2 else '2026110*.sql'
trip=[]
for f in sorted(glob.glob(__import__('os').path.join(M,PAT))):
    t=open(f).read()
    for m in re.finditer(r"\(\s*'((?:public\.)?[a-z0-9_]+\([^']*\))'\s*,\s*'([0-9a-f]{32})'\s*,\s*'([0-9a-f]{32})'\s*\)",t):
        trip.append((f.split('/')[-1][:9],)+m.groups())
if not trip: sys.exit('No drift guard rows in %s: check the folder and the pattern.'%__import__('os').path.join(M,PAT))
vals=",".join("('%s','%s','%s')"%(fn,lv,af) for _,fn,lv,af in trip)
sql="select count(*) n, count(*) filter (where y.m=y.lv) live, count(*) filter (where y.m=y.af) after, json_agg(y.fn) filter (where y.m is distinct from y.lv) odd from (select x.*, md5(regexp_replace(p.prosrc,'\\s+',' ','g')) m from (values %s) x(fn,lv,af) left join pg_proc p on p.oid=to_regprocedure(case when x.fn like 'public.%%' then x.fn else 'public.'||x.fn end)) y"%vals
r=subprocess.run(['python3',__import__('os').path.join(__import__('os').path.dirname(__file__),'wsql.py'),sql],capture_output=True,text=True)
print(r.stdout)
