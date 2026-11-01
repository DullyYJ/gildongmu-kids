import sys,json,glob; sys.path.insert(0,'.')
import eng
from PIL import Image, ImageDraw, ImageFont
meta={}
for f in glob.glob('wearw/meta_*.json'): meta.update(json.load(open(f)))
SH={}
def sh(ci,i):
    k=(ci,i)
    if k not in SH: SH[k]=Image.open('wearw/%s_g%d.webp'%(eng.IDS[ci],i)).convert('RGBA')
    return SH[k]
def comp(ci,sheet,cell,pick,S=320,bg=(222,236,252,255),baked=True):
    base=Image.new('RGBA',(256,256),bg); base.alpha_composite(eng.sheetcell(ci,sheet,cell))
    k=S/256; base=base.resize((S,S),Image.LANCZOS)
    for slot in (1,2,0):
        if slot not in pick: continue
        i=pick[slot]; idx=[cell,16+cell,24+cell][sheet]
        if slot==1 and baked and eng.WRAPS[ci][i]=='1':
            t=meta['%d_%d'%(ci,i)]['tiles'].get(str(idx))
            if t:
                x,y,w,h,ox,oy=t; im=sh(ci,i).crop((x,y,x+w,y+h)).resize((max(1,round(w*k)),max(1,round(h*k))),Image.LANCZOS)
                base.alpha_composite(im,(round(ox*k),round(oy*k))); continue
        pl=eng.place(ci,sheet,cell,slot)
        if not pl: continue
        q=slot*20+i; ox=(q%8)*192; oy=(q//8)*192
        for (a,b,c,d,x0,y0,x1,y1) in eng.strips(ci,sheet,cell,slot,i,*pl):
            sw=round((x1-x0)*k); shh=round((y1-y0)*k)
            if sw<1 or shh<1: continue
            t=eng.atlas(ci).crop((ox+int(a),oy+int(b),ox+int(c),oy+int(d))).resize((sw,shh),Image.LANCZOS)
            base.alpha_composite(t,(max(round(x0*k),0),max(round(y0*k),0)))
    return base
if __name__=='__main__':
    nm=['뽀푸','둘숑','러블','챙챙','독슐','두덩','히뽀','죽순']
    F=ImageFont.truetype('/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc',18)
    T=dict(zip(range(8),[15,17,7,14,2,3,9,14]))
    S=320; W=Image.new('RGB',(S*4,(S+26)*4),(255,255,255)); d=ImageDraw.Draw(W)
    for n in range(8):
        for j in range(2):
            pick={1:T[n],0:2,2:4}
            im=comp(n,0,5 if j==0 else 11,pick,S).convert('RGB')
            x=((n%2)*2+j)*S; y=(n//2)*(S+26); W.paste(im,(x,y+26)); d.text((x+8,y+3),nm[n]+' : '+eng.N[n*3+1][T[n]],fill=(20,20,20),font=F)
    W.save('/mnt/user-data/outputs/예시/입체_옷입히기.png')
