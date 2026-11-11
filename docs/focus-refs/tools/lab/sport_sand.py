#!/usr/bin/env python3
"""Modo Foco lab, test 51: the floor in 3 of the probe frames per clip (bottom 55%): share of sand-coloured pixels
(HSV hue 8-28, sat 25-140, val >= 90; OpenCV scale) and their fine texture (median |grey - blur 1.5|).
Writes lab/tests/sport/t51-sand.json; 150 s per run, run again until all clips are done."""
import json,subprocess,os,sys,numpy as np,cv2
D='lab/tests/sport/t51'
out={}
p='lab/tests/sport/t51-sand.json'
if os.path.exists(p): out=json.load(open(p))
names=[f[:-5] for f in sorted(os.listdir(D)) if f.endswith('.json')]
import time; t0=time.time()
for n in names:
    if n in out: continue
    if time.time()-t0>150: break
    d=json.load(open(f'{D}/{n}.json')); fr=[]
    for f in d['frames'][::2]:
        r=subprocess.run(['ffmpeg','-nostdin','-v','error','-ss',f"{f['t']:.2f}",'-i',d['video'],'-frames:v','1','-vf','scale=320:-2','-f','image2pipe','-vcodec','png','-'],capture_output=True)
        if not r.stdout: continue
        im=cv2.imdecode(np.frombuffer(r.stdout,np.uint8),1); h=im.shape[0]
        low=im[int(h*0.45):]  # the floor
        hsv=cv2.cvtColor(low,cv2.COLOR_BGR2HSV); H,S,V=hsv[...,0].astype(int),hsv[...,1].astype(int),hsv[...,2].astype(int)
        sandc=(H>=8)&(H<=28)&(S>=25)&(S<=140)&(V>=90)
        g=cv2.cvtColor(low,cv2.COLOR_BGR2GRAY).astype(np.float32)
        # fine texture: high-pass energy
        hp=np.abs(g-cv2.GaussianBlur(g,(0,0),1.5))
        fr.append({'sand':float(sandc.mean()),'tex':float(np.median(hp[sandc])) if sandc.sum()>50 else 0.0})
    out[n]={'sand':float(np.median([x['sand'] for x in fr])) if fr else 0,'tex':float(np.median([x['tex'] for x in fr])) if fr else 0,'sport':d['sport'],'web':bool(d.get('web'))}
json.dump(out,open(p,'w'))
print(len(out),'/',len(names))
