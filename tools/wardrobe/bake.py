# 길동무 키즈 옷 굽기 (p-kids52): 옷을 '얹지' 않고 캐릭터 몸을 옷감으로 바꾼다.
# 몸 모양(가운데 축 · 폭 · 기울기)에 옷 그림을 맞춰 늘이고 · 기울이고, 몸 명암 · 입체감을 그대로 입힌다.
KINDS=[('walk',0,16),('pose',1,8),('act',2,16)]
import sys, json, os, io, time; sys.path.insert(0,'.')
import numpy as np, eng, math
from multiprocessing import Pool
from PIL import Image
from scipy import ndimage as ndi
SS=2
P=dict(ext=1.45, up=0.0)
CH0={0:(1.05,0.16),1:(1.0,0.2),2:(1.15,0.1),3:(1.3,0.05),4:(1.6,0.0),5:(1.4,0.02),6:(1.35,0.03),7:(1.3,0.03)}   # 띠 높이 배율 · 위로 올리는 정도
def sprite(ci,i):
    q=20+i; ox=(q%8)*192; oy=(q//8)*192
    return np.asarray(eng.atlas(ci).crop((ox,oy,ox+192,oy+192))).astype(np.float32)/255
_ext={}
def extents(ci,i):
    k=(ci,i)
    if k in _ext: return _ext[k]
    G=sprite(ci,i); A=G[...,3]>0.47
    L=np.full(192,np.nan);R=np.full(192,np.nan)
    for r in range(192):
        c=np.where(A[r])[0]
        if len(c): L[r]=c.min(); R[r]=c.max()+1
    rows=np.where(~np.isnan(L))[0]; r0,r1=rows.min(),rows.max()
    idx=np.arange(r0,r1+1)
    Ls=ndi.median_filter(np.interp(idx,rows,L[rows]),5); Rs=ndi.median_filter(np.interp(idx,rows,R[rows]),5)
    _ext[k]=(r0,r1,Ls,Rs,G); return _ext[k]
# 3D 모델에서 부위별(몸통 · 머리 · 팔다리)로 색칠해 다시 그린 그림(m3d/mk/*_m.png, 512)에서 '몸통으로 보이는 자리'만 뽑아 거기에만 옷감을 입힌다.
MKD='m3d/mk/'   # mask/mkall.py · mkfr.py 가 만든 부위 색칠 그림 폴더
TAG=['w','p','a']
def torso(ci,sheet,cell):
    import os
    fn='%s%s_%s%02d_m.png'%(MKD,eng.IDS[ci],TAG[sheet],cell)
    if not os.path.exists(fn): return None
    M=np.asarray(Image.open(fn).convert('RGBA')).astype(np.float32)/255
    r,g,b,a=M[...,0],M[...,1],M[...,2],M[...,3]
    cls=np.zeros(r.shape,np.int8)               # 0 없음 · 1 몸통 · 2 머리 · 3 팔다리 · 4 기타
    cls[(a>0.35)]=4
    cls[(a>0.35)&(r>g+0.25)&(r>b+0.25)]=1
    cls[(a>0.35)&(g>r+0.25)&(g>b+0.25)]=2
    cls[(a>0.35)&(b>r+0.25)&(b>g+0.25)]=3
    if ci==4:
        # 독슐: 깃털 무늬로 몸통 마스크가 줄무늬로 갈라져(기타=4) 옷이 일부에만 입혀졌다 → 몸 덩어리(가장 큰 조각)에 둘러싸인 기타 · 팔다리 칸도 몸통(p-kids58)
        M=ndi.binary_closing((cls==1)|(cls==4),iterations=6)
        M=ndi.binary_fill_holes(M)
        lab,nl=ndi.label(M)
        if nl:
            sz=ndi.sum(M,lab,range(1,nl+1)); M=lab==(1+int(np.argmax(sz)))
            cls[M&(cls!=2)]=1
    return cls
EMPTY=(0,0,np.zeros((2,2,4),np.uint8))
def bake(ci,sheet,cell,i,ext=None):
    cls=torso(ci,sheet,cell)
    if cls is None: return EMPTY
    n=512
    T=(cls==1)
    if T.sum()<60*4: return EMPTY
    T=ndi.binary_opening(T,iterations=1)
    lab,nl=ndi.label(T)
    if nl>1:
        # 가장 큰 조각 + 그 가까이(45px 안)의 큰 조각(큰 조각의 8% 이상)도 몸통이다 — 대나무 · 삽 같은 앞 물건이 몸통을 가르면 뒤쪽 몸도 입힌다(p-kids56)
        sz=ndi.sum(T,lab,range(1,nl+1)); big=int(np.argmax(sz))
        near=ndi.binary_dilation(lab==big+1,iterations=45)
        keep=[k+1 for k in range(nl) if k==big or (sz[k]>=0.08*sz[big] and (near&(lab==k+1)).any())]
        T=np.isin(lab,keep)
    if T.sum()<60*4: return EMPTY
    # 1~2px 살짝 키워 털이 비치지 않게(머리 · 팔다리 자리는 안 건드림)
    grow=ndi.binary_dilation(T,iterations=3)&((cls==1)|(cls==4)|(cls==0)|(cls==3)&False)
    A=T|grow
    ys,xs=np.where(A)
    # 줄 · 칸마다 몸통의 끝 → 옷의 가로 · 세로 좌표
    X,Y=np.meshgrid(np.arange(n,dtype=np.float32),np.arange(n,dtype=np.float32))
    xl=np.full(n,np.nan,np.float32); xr=np.full(n,np.nan,np.float32); yt=np.full(n,np.nan,np.float32); yb=np.full(n,np.nan,np.float32)
    for y in range(n):
        c=np.where(A[y])[0]
        if len(c): xl[y]=c.min(); xr[y]=c.max()+1
    for x in range(n):
        c=np.where(A[:,x])[0]
        if len(c): yt[x]=c.min(); yb[x]=c.max()+1
    def fill(v):
        ok=~np.isnan(v); idx=np.arange(n)
        return np.interp(idx,idx[ok],v[ok]) if ok.sum()>1 else v
    xl,xr,yt,yb=[ndi.gaussian_filter1d(fill(v),3,mode='nearest') for v in (xl,xr,yt,yb)]
    uu=np.clip((X-xl[Y.astype(int)])/np.maximum(xr[Y.astype(int)]-xl[Y.astype(int)],4),0,1)
    vv=np.clip((Y-yt[X.astype(int)])/np.maximum(yb[X.astype(int)]-yt[X.astype(int)],4),0,1)
    G=sprite(ci,i); ga=G[...,3]>0.47
    rows=np.where(ga.any(1))[0]; cols=np.where(ga.any(0))[0]
    r0,r1,c0,c1=rows.min(),rows.max()+1,cols.min(),cols.max()+1
    rr=r0+(0.10+vv*0.80)*(r1-r0); cc=c0+(0.12+uu*0.76)*(c1-c0)
    samp=np.stack([ndi.map_coordinates(G[...,c],[rr,cc],order=1,mode='nearest') for c in range(4)],axis=-1)
    B=np.asarray(eng.sheetcell(ci,sheet,cell).resize((n,n),Image.LANCZOS)).astype(np.float32)/255
    ba=B[...,3]
    a=ndi.gaussian_filter(A.astype(np.float32),0.9)*(ba>0.2)
    a=np.clip((a-0.25)/0.5,0,1)
    lum=B[...,0]*.3+B[...,1]*.59+B[...,2]*.11
    sm=ndi.gaussian_filter(lum*ba,5)/np.maximum(ndi.gaussian_filter(ba,5),1e-3)
    mm=(a>0.6)&(ba>0.5); ref=np.median(sm[mm]) if mm.sum()>50 else 0.6
    shade=1+(np.clip(sm/max(ref,.15),0.55,1.3)-1)*0.95
    dist=ndi.distance_transform_edt(A); R=26.0
    tt=np.clip(dist/R,0,1); hh=ndi.gaussian_filter(np.sqrt(1-(1-tt)**2)*R,3)
    gy,gx=np.gradient(hh); nz=1/np.sqrt(1+gx**2+gy**2); nx=-gx*nz; ny=-gy*nz
    dome=0.66+0.46*np.clip(nx*-0.45+ny*-0.6+nz*0.66,0,1)
    rgb=np.clip(samp[...,:3]*shade[...,None]*dome[...,None],0,1)
    d=ndi.distance_transform_edt(a>0.5); edge=np.clip(1-d/6.0,0,1)*(a>0.5)
    rgb=rgb*(1-0.2*edge[...,None])
    # 몸통 아래쪽에 닿는 그림자(몸 위에만)
    cs=ndi.shift(ndi.gaussian_filter(a,4.4),(3.2,0.0),order=1)*0.30
    sh=cs*(1-a)*(ba>0.3)*((cls==1)|(cls==3)|(cls==2)).astype(np.float32)*0
    la=a+sh*(1-a); prem=rgb*a[...,None]
    la=la.reshape(256,2,256,2).mean((1,3)); prem=prem.reshape(256,2,256,2,3).mean((1,3))
    colr=np.where(la[...,None]>1e-4,prem/np.maximum(la[...,None],1e-4),0)
    img=(np.clip(np.concatenate([colr,la[...,None]],axis=2),0,1)*255+.5).astype(np.uint8)
    ys_,xs_=np.where(img[...,3]>3)
    if len(xs_)==0: return EMPTY
    x0,x1,y0,y1=max(xs_.min()-1,0),min(xs_.max()+2,256),max(ys_.min()-1,0),min(ys_.max()+2,256)
    return (x0,y0,img[y0:y1,x0:x1])
def job(args):
    ci,kn,cell,i=args
    sheet=[k[1] for k in KINDS if k[0]==kn][0]
    return args,bake(ci,sheet,cell,i)
def cellidx(kn,c): return {'walk':0,'pose':16,'act':24}[kn]+c
def run(chars):
    os.makedirs('wearw',exist_ok=True)
    meta={}
    with Pool(2) as P:
        for ci in chars:
            gs=[i for i in range(20) if eng.WRAPS[ci][i]=='1']
            t0=time.time()
            jobs=[(ci,kn,c,i) for i in gs for kn,sheet,nc in KINDS for c in range(nc)]
            res=dict(P.map(job,jobs,chunksize=8))
            tot=0
            for i in gs:
                tiles=[((ci,kn,c,i),res[(ci,kn,c,i)]) for kn,sheet,nc in KINDS for c in range(nc) if res[(ci,kn,c,i)] is not None]
                tiles.sort(key=lambda kv:-kv[1][2].shape[0])
                W=1024; x=y=rowh=0; pos={}
                for k,(ox,oy,im) in tiles:
                    h,w=im.shape[:2]
                    if x+w>W: x=0; y+=rowh; rowh=0
                    pos[k]=(x,y,w,h,ox,oy); x+=w+1; rowh=max(rowh,h+1)
                H=y+rowh
                sheetimg=Image.new('RGBA',(W,H),(0,0,0,0))
                for k,(ox,oy,im) in tiles:
                    sheetimg.paste(Image.fromarray(im,'RGBA'),pos[k][:2])
                fn='wearw/%s_g%d.webp'%(eng.IDS[ci],i)
                sheetimg.save(fn,'WEBP',quality=80,alpha_quality=90,method=6)
                tot+=os.path.getsize(fn)
                meta['%d_%d'%(ci,i)]={'size':[W,H],'tiles':{'%d'%cellidx(k[1],k[2]):tuple(int(v) for v in p) for k,p in pos.items()}}
            print(eng.IDS[ci],len(gs),'garments',tot//1024,'KB',round(time.time()-t0),'s',flush=True)
    json.dump(meta,open('wearw/meta_%s.json'%('_'.join(map(str,chars))),'w'))
if __name__=='__main__':
    run([int(v) for v in sys.argv[1].split(',')])
