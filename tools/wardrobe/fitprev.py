import sys; sys.path.insert(0,'/tmp/wg3d')
import numpy as np, json, math
from PIL import Image
import comp3d, place, preview
FIT=json.load(open('/tmp/wg3d/atlas/fit.json'))
M=place.M
GARM=('망토','줄무늬 티','티셔츠','목폴라','잠옷','판초','조끼','스웨터','앞치마','후드티','갑옷','멜빵바지','우비','턱받이','운동복','구명조끼','원피스','투투 치마','한복 저고리','가운','턱시도')
NS=16
def cellindex(sheet,cell): return cell if sheet=='walk' else 16+cell if sheet=='pose' else 24+cell
def rows(ch,sheet,cell):
    tx,ty,bw,bh,cx=M[ch][sheet][cell]
    f=FIT[ch][cellindex(sheet,cell)]
    return ty,bh,f
def body_at(ch,sheet,cell,y):
    ty,bh,f=rows(ch,sheet,cell)
    t=(y-ty)/(0.025*bh)
    j=int(math.floor(t)); fr=t-j
    def g(k):
        k=min(max(k,0),39); l,r=f[k]; return (l,r) if r-l>=8 else None
    a=g(j); b=g(j+1)
    if a and b: return (a[0]*(1-fr)+b[0]*fr, a[1]*(1-fr)+b[1]*fr)
    return a or b
SRCX={}
def src_ext(im,key):
    if key in SRCX: return SRCX[key]
    A=np.asarray(im)[...,3]>120
    L=np.full(192,-1.0);R=np.full(192,-1.0)
    for r in range(192):
        c=np.where(A[r])[0]
        if len(c): L[r]=c.min(); R[r]=c.max()+1
    SRCX[key]=(L,R); return SRCX[key]
NS=32
def strips(ch,sheet,cell,i,meta,x,y,u,im,key,wrap=True):
    fcx,fcy,side,bx0,by0,bx1,by1=meta
    P=192.0/(side*u)
    cxs=x+fcx*u; cys=y+fcy*u
    sx0=cxs-side*u/2; sy0=cys-side*u/2
    top=y+by0*u; bot=y+by1*u
    if not wrap: return [((0,0,192,192),(sx0,sy0,sx0+side*u,sy0+side*u))]
    L,R=src_ext(im,key)
    # 가운데 줄에서 몸 폭 대비 옷 폭 비율 -> 전체 확대
    ctr=(top+bot)/2
    r0=max(int((top-sy0)*P),0); r1=min(int((bot-sy0)*P),192)
    mids=[(L[r],R[r]) for r in range(r0,r1) if L[r]>=0]
    natw=np.median([b-a for a,b in mids])/P if mids else (bx1-bx0)*u
    bm=body_at(ch,sheet,cell,ctr)
    g=1.0
    if bm: g=min(max((bm[1]-bm[0])*0.98/natw,1.0),1.5)
    H=(bot-top)*g**0.75
    out=[]; n=NS; last=None
    for k in range(n):
        ya=ctr-H/2+k*H/n; yb=ya+H/n; yc=(ya+yb)/2
        sa=((top+(bot-top)*k/n)-sy0)*P; sb=((top+(bot-top)*(k+1)/n)-sy0)*P
        r0=max(int(sa),0); r1=min(int(math.ceil(sb)),192)
        ls=[L[r] for r in range(r0,r1) if L[r]>=0]; rs=[R[r] for r in range(r0,r1) if R[r]>=0]
        if not ls: continue
        l=min(ls); r=max(rs)
        nat=(r-l)/P
        b=body_at(ch,sheet,cell,yc)
        if b:
            bw=(b[1]-b[0])*0.98; mid=(b[0]+b[1])/2
            wd=min(max(bw,nat*g*0.9),nat*g*1.15)
            last=(wd/nat,mid)
        else:
            if last is None: wd=nat*g; mid=cxs+((l+r)/2-96)/P
            else: wd=nat*last[0]; mid=last[1]
        out.append([l,sa,r,sb,mid,wd,ya,yb])
    for it in range(4):
        for j in range(1,len(out)-1):
            out[j][4]=(out[j-1][4]+2*out[j][4]+out[j+1][4])/4
            out[j][5]=(out[j-1][5]+2*out[j][5]+out[j+1][5])/4
    return [((o[0],o[1],o[2],o[3]),(o[4]-o[5]/2,o[6]-0.35,o[4]+o[5]/2,o[7]+0.35)) for o in out]
def comp(ch,sheet,cell,pick,size=384,bg=(222,236,252,255),wrap=True):
    S=size/256.0
    base=Image.new('RGBA',(256,256),bg); base.alpha_composite(preview.sheetcell(ch,sheet,cell))
    base=base.resize((size,size),Image.LANCZOS)
    for slot in ('cloth','item','hat'):
        if slot not in pick: continue
        im,mt=comp3d.spr(ch,slot,pick[slot])
        x,y,u=place.place(ch,sheet,cell,slot)
        isg = slot=='cloth' and wrap and comp3d.cat[ch]['cloth'][pick[slot]][0].split(' ',1)[-1] in GARM
        st=strips(ch,sheet,cell,pick[slot],mt,x,y,u,im,(ch,slot,pick[slot]),isg)
        for (s0,s1,s2,s3),(d0,d1,d2,d3) in st:
            sw=int(round((d2-d0)*S)); shh=int(round((d3-d1)*S))
            if sw<1 or shh<1: continue
            c=im.crop((int(s0),int(round(s1)),int(round(s2)),max(int(round(s3)),int(round(s1))+1))).resize((sw,shh),Image.LANCZOS)
            base.alpha_composite(c,(int(round(d0*S)),int(round(d1*S)))) if d0*S>=0 and d1*S>=0 else None
    return base
if __name__=='__main__':
    ch=sys.argv[1]; pick=dict(hat=int(sys.argv[2]),cloth=int(sys.argv[3]),item=int(sys.argv[4]))
    cells=[0,3,6,9]
    W=Image.new('RGB',(384*4,768))
    for j,c in enumerate(cells):
        W.paste(comp(ch,'walk',c,pick,wrap=False).convert('RGB'),(j*384,0))
        W.paste(comp(ch,'walk',c,pick).convert('RGB'),(j*384,384))
    W.save('/tmp/wg3d/out/fit_%s.png'%ch)
