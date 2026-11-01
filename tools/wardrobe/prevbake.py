import sys,json,glob,math; sys.path.insert(0,'.')
import eng, hat
from PIL import Image
meta={}
for f in glob.glob('wearw/meta_*.json'): meta.update(json.load(open(f)))
def cidx(sh,c): return [0,16,24][sh]+c
def comp(ci,sheet,cell,pick,S=320,bg=(222,236,252,255)):
    k=S/256
    base=Image.new('RGBA',(256,256),bg); base.alpha_composite(eng.sheetcell(ci,sheet,cell)); base=base.resize((S,S),Image.LANCZOS)
    i=pick[1]; m=meta.get('%d_%d'%(ci,i))
    if m:
        t=m['tiles'].get(str(cidx(sheet,cell)))
        if t:
            x,y,w,h,ox,oy=t
            sh=Image.open('wearw/%s_g%d.webp'%(eng.IDS[ci],i)).convert('RGBA').crop((x,y,x+w,y+h))
            sh=sh.resize((max(1,round(w*k)),max(1,round(h*k))),Image.LANCZOS)
            base.alpha_composite(sh,(round(ox*k),round(oy*k)))
    for slot in (2,0):
        pl=eng.place(ci,sheet,cell,slot)
        if not pl: continue
        j=pick[slot]; q=slot*20+j; ox=(q%8)*192; oy=(q//8)*192
        (a_,b_,c_,d_,x0,y0,x1,y1),=eng.strips(ci,sheet,cell,slot,j,*pl,allow_wrap=False)
        sw=round((x1-x0)*k); shh=round((y1-y0)*k)
        t=eng.atlas(ci).crop((ox,oy,ox+192,oy+192)).resize((sw,shh),Image.LANCZOS)
        if slot==0:
            ang=hat.tilt(ci,sheet,cell)
            lay=Image.new('RGBA',(S,S),(0,0,0,0)); lay.alpha_composite(t,(max(round(x0*k),0),max(round(y0*k),0)))
            c=((x0+x1)/2*k,(y0+(y1-y0)*.8)*k)
            lay=lay.rotate(math.degrees(-ang),resample=Image.BICUBIC,center=c)   # PIL: 반시계 +
            base.alpha_composite(lay)
        else:
            base.alpha_composite(t,(max(round(x0*k),0),max(round(y0*k),0)))
    return base
if __name__=='__main__':
    T=[15,17,7,14,2,3,9,14]
    S=320; W=Image.new('RGB',(S*4,S*4))
    for n in range(8):
        for j,(sh,c) in enumerate([(0,5),(2,9)]):
            im=comp(n,sh,c,{1:T[n],0:2,2:4},S).convert('RGB'); W.paste(im,(((n%2)*2+j)*S,(n//2)*S))
    W.save(sys.argv[1] if len(sys.argv)>1 else 'p52.png')
