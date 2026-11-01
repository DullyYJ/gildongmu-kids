import sys; sys.path.insert(0,'.')
import numpy as np, eng
from PIL import Image
from scipy import ndimage as ndi
SS=2  # 작업 해상도 배율
def layer(ci,sheet,cell,slot,i,wrap=True):
    """strip 합성한 옷 한 겹(RGBA float, 256*SS 정사각)"""
    n=256*SS; L=Image.new('RGBA',(n,n),(0,0,0,0))
    pl=eng.place(ci,sheet,cell,slot)
    if not pl: return None
    q=slot*20+i; ox=(q%8)*192; oy=(q//8)*192
    for (a,b,c,d,x0,y0,x1,y1) in eng.strips(ci,sheet,cell,slot,i,*pl,allow_wrap=wrap):
        sw=int(round((x1-x0)*SS)); sh=int(round((y1-y0)*SS))
        if sw<1 or sh<1: continue
        t=eng.atlas(ci).crop((ox+int(a),oy+int(b),ox+int(c),oy+int(d))).resize((sw,sh),Image.LANCZOS)
        L.alpha_composite(t,(max(int(round(x0*SS)),0),max(int(round(y0*SS)),0)))
    return np.asarray(L).astype(np.float32)/255
def wear(ci,sheet,cell,pick,bg=(222,236,252)):
    n=256*SS
    body=eng.sheetcell(ci,sheet,cell).resize((n,n),Image.LANCZOS)
    B=np.asarray(body).astype(np.float32)/255
    out=B.copy()
    ba=B[...,3]
    for slot in (1,):
        if slot not in pick: continue
        G=layer(ci,sheet,cell,slot,pick[slot])
        if G is None: continue
        ga=G[...,3]
        # 1) 몸 윤곽으로 자르기(살짝 부풀려 두께)
        inside=ndi.gaussian_filter((ba>0.4).astype(np.float32),0.8*SS)
        inside=ndi.maximum_filter(inside,size=int(2*SS))
        clip=np.clip(inside*1.0,0,1)
        wraps=eng.WRAPS[ci][pick[slot]]=='1'
        a=ga*clip if wraps else ga
        # 2) 몸 빛 따라 명암
        lum=(B[...,0]*.3+B[...,1]*.59+B[...,2]*.11)
        sm=ndi.gaussian_filter(lum*ba,2.5*SS)/np.maximum(ndi.gaussian_filter(ba,2.5*SS),1e-3)
        m=(a>0.6)&(ba>0.5)
        ref=np.median(sm[m]) if m.sum()>50 else 0.6
        shade=np.clip(sm/max(ref,.15),0.55,1.3)
        shade=1+(shade-1)*(0.95 if wraps else 0)
        # 3) 닿는 그림자(몸 위, 옷 아래쪽)
        if wraps:
            cs=ndi.shift(ndi.gaussian_filter(a,2.2*SS),(1.6*SS,0.0),order=1)*0.34
            sh=cs*(1-a)*(ba>0.3)
            out[...,:3]=out[...,:3]*(1-sh[...,None])
        # 4) 옷 합성
        # 몸 윤곽에서 둥근 면 만들기: 가장자리로 갈수록 어둡고 왼쪽 위에서 빛
        dist=ndi.distance_transform_edt(ba>0.4)
        R=14.0*SS
        t=np.clip(dist/R,0,1); h=np.sqrt(1-(1-t)**2)*R
        h=ndi.gaussian_filter(h,1.5*SS)
        gy,gx=np.gradient(h)
        nz=1.0/np.sqrt(1+gx**2+gy**2); nx=-gx*nz; ny=-gy*nz
        lam=np.clip(nx*-0.45+ny*-0.6+nz*0.66,0,1)
        dome=0.62+0.52*lam
        dome=1+(dome-1)*(1.0 if wraps else 0)
        grgb=np.clip(G[...,:3]*shade[...,None]*dome[...,None],0,1)
        # 옷 안쪽 가장자리 어둡게(몸을 감싼 느낌)
        if wraps:
            d=ndi.distance_transform_edt(a>0.5)
            edge=np.clip(1-d/(3.0*SS),0,1)*(a>0.5)
            grgb=grgb*(1-0.22*edge[...,None])
        oa=out[...,3:4]; aa=a[...,None]
        out[...,:3]=grgb*aa+out[...,:3]*(1-aa)
        out[...,3:4]=np.maximum(oa,aa)
    # 소지품·모자는 기존 얹기
    base=Image.new('RGBA',(n,n),bg+(255,)); base.alpha_composite(Image.fromarray((np.clip(out,0,1)*255).astype(np.uint8),'RGBA'))
    S=SS
    for slot in (2,0):
        if slot not in pick: continue
        pl=eng.place(ci,sheet,cell,slot)
        if not pl: continue
        i=pick[slot]; q=slot*20+i; ox=(q%8)*192; oy=(q//8)*192
        for (a_,b_,c_,d_,x0,y0,x1,y1) in eng.strips(ci,sheet,cell,slot,i,*pl,allow_wrap=False):
            sw=int(round((x1-x0)*S)); sh=int(round((y1-y0)*S))
            t=eng.atlas(ci).crop((ox+int(a_),oy+int(b_),ox+int(c_),oy+int(d_))).resize((sw,sh),Image.LANCZOS)
            base.alpha_composite(t,(max(int(round(x0*S)),0),max(int(round(y0*S)),0)))
    return base
eng.WIDEN=1.14
if __name__=='__main__':
    T=dict(ppopu=15,dolsom=17,lovel=7,chaeng=14,sul=2,dudung=3,bbosong=9,juksun=14)
    S=320; W=Image.new('RGB',(S*4,S*4))
    for n,ch in enumerate(eng.IDS):
        pick={1:T[ch],0:2,2:4}
        eng.WIDEN=1.0; a=eng.comp(n,0,5,pick,size=S).convert('RGB'); eng.WIDEN=1.14; b=wear(n,0,5,pick).resize((S,S),Image.LANCZOS).convert('RGB')
        W.paste(a,(((n%2)*2)*S,(n//2)*S)); W.paste(b,(((n%2)*2+1)*S,(n//2)*S))
    W.save('worn_cmp.png')
