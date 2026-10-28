#!/usr/bin/env python3
"""Reproducible photographic picture pass; never changes approved narration/captions.
Input: a verified narrated Cameraman composition and four provenance-tracked
fictional photographs. Output is a new, immutable versioned composition.
"""
import argparse, hashlib, html, json, shutil
from pathlib import Path

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 p=argparse.ArgumentParser()
 p.add_argument('--base',type=Path,required=True)
 p.add_argument('--photos',type=Path,required=True)
 p.add_argument('--output',type=Path,required=True)
 a=p.parse_args()
 if a.output.exists(): raise SystemExit('Refusing to overwrite output')
 m=json.loads((a.base/'build.json').read_text())
 assert m['kind']=='cameraman' and m['language']=='en' and m['wordsExact'] and m['captionsComplete']
 names=['camera-operator','construction-progress','finished-interior','team-at-work']
 assert (a.photos/'provenance.json').is_file()
 for n in names: assert (a.photos/f'{n}.png').is_file()
 a.output.parent.mkdir(parents=True,exist_ok=True)
 shutil.copytree(a.base,a.output,ignore=shutil.ignore_patterns('.hyperframes'))
 imgdir=a.output/'assets'/'photoreal';imgdir.mkdir()
 for n in names: shutil.copy2(a.photos/f'{n}.png',imgdir/f'{n}.png')
 shutil.copy2(a.photos/'provenance.json',imgdir/'provenance.json')
 before={x:sha(a.base/x) for x in ['assets/audio/voice.wav','cameraman-en.srt','cameraman-en.vtt']}
 css=(a.base/'compositions/cameraman-01-01.html').read_text().split('<style>',1)[1].split('</style>',1)[0]
 css+="""
.photo-stage{position:absolute;inset:0;background:#091333;overflow:hidden}
.photo-frame{position:absolute;inset:0;overflow:hidden}
.hero-photo{position:absolute;width:1920px;height:1080px;left:0;top:0;object-fit:cover}
.shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(9,19,51,.92) 0%,rgba(9,19,51,.77) 26%,rgba(9,19,51,.15) 63%,rgba(9,19,51,.08) 100%),linear-gradient(0deg,rgba(9,19,51,.98) 0%,rgba(9,19,51,.77) 18%,transparent 46%)}
.photo-head{position:absolute;left:192px;top:108px;width:990px;font-size:90px;line-height:1.12;font-weight:600;letter-spacing:-1.2px;color:#f2f6fa;text-shadow:0 2px 16px rgba(9,19,51,.3)}
.photo-disclosure{position:absolute;left:192px;top:716px;padding:8px 18px;background:#091333;color:#f2f6fa;font-size:75px;line-height:1.1;font-weight:400}
.photo-rule{position:absolute;left:192px;top:662px;width:130px;height:6px;background:#00cfc8}
"""
 mapping={
 'cameraman-01-01':'camera-operator',
 'cameraman-02-01':'construction-progress',
 'cameraman-02-02':'team-at-work',
 'cameraman-03-01':'finished-interior',
 'cameraman-03-02':'construction-progress',
 'cameraman-03-03':'team-at-work',
 'cameraman-03-04':'camera-operator',
 'cameraman-04-01':'finished-interior',
 'cameraman-05-01':'team-at-work',
 'cameraman-05-02':'construction-progress',
 'cameraman-06-01':'camera-operator',
 'cameraman-06-02':'camera-operator',
 }
 rows=[]
 for beat in m['beats']:
  ident=beat['id']
  if ident not in mapping: continue
  name=mapping[ident];dur=beat['end']-beat['start']
  # Still typography; only the photo eases toward its final framing.
  # Short spoken beats remain still rather than wobbling through a one-second cut.
  move=f"tl.fromTo('#{ident}-photo',{{scale:1.035,x:-12}},{{scale:1,x:0,duration:{min(dur,4.8):.3f},ease:'power1.inOut'}},0);" if dur>=2 else ''
  title=html.escape(beat['text'])
  if ident=='cameraman-05-01': title='The aim: around three months'
  if ident=='cameraman-05-02': title='It depends on what we can film.'
  if ident=='cameraman-03-04': title='Only if you want to be.'
  content=f"""<template><style>{css}</style><div id="root" dir="ltr" data-composition-id="{ident}" data-width="1920" data-height="1080"><div class="photo-stage"><div class="photo-frame"><img id="{ident}-photo" class="hero-photo" data-layout-allow-overflow src="assets/photoreal/{name}.png" alt="Fictional illustrative {name.replace('-',' ')}"></div><div class="shade"></div><h1 class="photo-head" data-var-text="headline">{title}</h1><div class="photo-rule"></div><div class="photo-disclosure">AI-generated example</div></div></div><script>(function(){{const tl=gsap.timeline({{paused:true}});{move}window.__timelines["{ident}"]=tl;}})();</script></template>"""
  target=a.output/'compositions'/f'{ident}.html'
  target.write_text(content)
  rows.append({'scene':ident,'image':name+'.png','photoOnlyMotion':dur>=2,'duration':round(dur,3)})
  beat['picturePass']='photoreal-fictional-example'
  beat['text']=html.unescape(title)
 assert all(sha(a.output/x)==h for x,h in before.items()),'Approved media changed'
 override={'type':'photoreal-fictional-examples','baseComposition':str(a.base),'scriptPath':str(Path(__file__).resolve()),'generatorSha256':sha(Path(__file__)),'audioChanged':False,'observedWordTimingsChanged':False,'subtitlesChanged':False,'sourceAssets':[{'name':n+'.png','sha256':sha(a.photos/f'{n}.png')} for n in names],'provenanceSha256':sha(a.photos/'provenance.json'),'protectedFileHashes':before,'sceneChanges':rows,'disclosure':'AI-generated example','claims':'No claim these are real Mahara shoots; approved aim/dependency wording retained.'}
 (a.output/'photoreal-override.json').write_text(json.dumps(override,indent=2)+'\n')
 m['privateOverrides'].append(override)
 m['clientReady']=False;m['review'].update({'pictureReviewed':False,'subjectiveListen':False,'phoneSpeakerListen':False})
 m['assets'] += [{'file':f'assets/photoreal/{n}.png','source':str(a.photos/f'{n}.png'),'sha256':sha(a.photos/f'{n}.png'),'synthetic':True} for n in names]
 (a.output/'build.json').write_text(json.dumps(m,indent=2)+'\n')
 print(json.dumps({'composition':str(a.output),'generatorSha256':override['generatorSha256'],'protectedFilesUnchanged':True,'scenes':len(rows)}))
if __name__=='__main__': main()
