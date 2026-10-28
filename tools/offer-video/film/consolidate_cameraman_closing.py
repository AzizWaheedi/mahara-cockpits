#!/usr/bin/env python3
"""Consolidate the approved Cameraman closing into its original spoken segment.
The observed words, audio, subtitle files and overall duration are immutable.
"""
import argparse, hashlib, html, json, re, shutil
from pathlib import Path
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 p=argparse.ArgumentParser();p.add_argument('--base',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 if a.output.exists(): raise SystemExit('Refusing to overwrite output')
 m=json.loads((a.base/'build.json').read_text())
 assert m['kind']=='cameraman' and m['language']=='en' and m['wordsExact']
 closes=[x for x in m['beats'] if x['visual']=='close'];assert len(closes) in (1,2)
 text=' '.join(x['text'] for x in closes)
 expected='Your account manager will help plan what is worth filming, and book the day with you.'
 assert text==expected and closes[0]['start']==32.58 and closes[-1]['end']==36.28
 protect=['assets/audio/voice.wav','cameraman-en.srt','cameraman-en.vtt']
 before={x:sha(a.base/x) for x in protect}
 shutil.copytree(a.base,a.output,ignore=shutil.ignore_patterns('.hyperframes'))
 first=closes[0];ident=first['id'];dur=closes[-1]['end']-first['start']
 f=a.output/'compositions'/f'{ident}.html';s=f.read_text()
 s,n=re.subn(r'(<p class="close-copy" data-var-text="closing">).*?(</p>)',lambda z:z[1]+html.escape(text)+z[2],s);assert n==1
 script=f"""<script>(function(){{const tl=gsap.timeline({{paused:true}});tl.fromTo('#{ident}-moving .logo',{{scale:.97}},{{scale:1,duration:.25,ease:'power3.out'}},0);window.__timelines["{ident}"]=tl;}})();</script>"""
 s,n=re.subn(r'<script>.*?</script>',lambda _:script,s,flags=re.S);assert n==1;f.write_text(s)
 idx=a.output/'index.html';s=idx.read_text()
 pat=r'(<div id="'+re.escape(ident)+r'"[^>]*data-duration=")[^"]+(")'
 s,n=re.subn(pat,lambda z:z[1]+f'{dur:.3f}'+z[2],s);assert n==1
 for tail in closes[1:]:
  s,n=re.subn(r'<div id="'+re.escape(tail['id'])+r'"[^>]*></div>','',s);assert n==1
  (a.output/'compositions'/f"{tail['id']}.html").unlink()
 idx.write_text(s)
 first.update(text=text,end=closes[-1]['end'])
 m['beats']=[x for x in m['beats'] if x not in closes[1:]]
 m.setdefault('privateOverrides',[]).append({'type':'whole-approved-closing','audioChanged':False,'observedTimingChanged':False,'subtitlesChanged':False,'sourceComposition':str(a.base)})
 m['clientReady']=False
 (a.output/'build.json').write_text(json.dumps(m,indent=2)+'\n')
 assert all(sha(a.output/x)==h for x,h in before.items())
 (a.output/'closing-provenance.json').write_text(json.dumps({'base':str(a.base),'protectedFileHashes':before,'closing':text,'start':first['start'],'end':first['end'],'generatorSha256':sha(Path(__file__))},indent=2)+'\n')
 print(json.dumps({'output':str(a.output),'protectedFilesUnchanged':True}))
if __name__=='__main__':main()
