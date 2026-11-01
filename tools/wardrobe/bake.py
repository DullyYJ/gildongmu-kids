import sys, json, os, io, time; sys.path.insert(0,'.')
import numpy as np, eng
from PIL import Image
from scipy import ndimage as ndi
from multiprocessing import Pool
SS=2; eng.WIDEN=1.14
KINDS=[('walk',0,16),('pose',1,8),('act',2,16)]
def layer(ci,sheet,cell,i):
    n=256*SS; L=Image.new('RGBA',(n,n),(0,0,0,0))
    pl=eng.place(ci,sheet,cell,1)
    if not pl: return None
    q=20+i; ox=(q%8)*192; oy=(q//8)*192
    for (a,b,c,d,x0,y0,x1,y1) in eng.strips(ci,sheet,cell,1,i,*pl):
        sw=int(round((x1-x0)*SS)); sh=int(round((y1-y0)*SS))
        if sw<1 or sh<1: continue
        t=eng.atlas(ci).crop((ox+int(a),oy+int(b),ox+int(c),oy+int(d))).resize((sw,sh),Image.LANCZOS)
        L.alpha_composite(t,(max(int(round(x0*SS)),0),max(int(round(y0*SS)),0)))
    return np.asarray(L).astype(np.float32)/255
def bake(ci,sheet,cell,i):
    G=layer(ci,sheet,cell,i)
    if G is None: return None
    n=256*SS
    B=np.asarray(eng.sheetcell(ci,sheet,cell).resize((n,n),Image.LANCZOS)).astype(np.float32)/255
    ba=B[...,3]; ga=G[...,3]
    inside=ndi.maximum_filter(ndi.gaussian_filter((ba>0.4).astype(np.float32),0.8*SS),size=2*SS)
    a=ga*np.clip(inside,0,1)
    lum=B[...,0]*.3+B[...,1]*.59+B[...,2]*.11
    sm=ndi.gaussian_filter(lum*ba,2.5*SS)/np.maximum(ndi.gaussian_filter(ba,2.5*SS),1e-3)
    m=(a>0.6)&(ba>0.5); ref=np.median(sm[m]) if m.sum()>50 else 0.6
    shade=1+(np.clip(sm/max(ref,.15),0.55,1.3)-1)*0.95
    dist=ndi.distance_transform_edt(ba>0.4); R=14.0*SS
    t=np.clip(dist/R,0,1); h=ndi.gaussian_filter(np.sqrt(1-(1-t)**2)*R,1.5*SS)
    gy,gx=np.gradient(h); nz=1/np.sqrt(1+gx**2+gy**2); nx=-gx*nz; ny=-gy*nz
    dome=0.62+0.52*np.clip(nx*-0.45+ny*-0.6+nz*0.66,0,1)
    grgb=np.clip(G[...,:3]*shade[...,None]*dome[...,None],0,1)
    d=ndi.distance_transform_edt(a>0.5); edge=np.clip(1-d/(3.0*SS),0,1)*(a>0.5)
    grgb=grgb*(1-0.22*edge[...,None])
    cs=ndi.shift(ndi.gaussian_filter(a,2.2*SS),(1.6*SS,0.0),order=1)*0.34
    sh=cs*(1-a)*(ba>0.3)
    la=a+sh*(1-a)
    prem=grgb*a[...,None]            # 그림자는 검정(0)
    # 2x 줄이기
    la=la.reshape(256,SS,256,SS).mean((1,3)); prem=prem.reshape(256,SS,256,SS,3).mean((1,3))
    col=np.where(la[...,None]>1e-4,prem/np.maximum(la[...,None],1e-4),0)
    arr=np.concatenate([col,la[...,None]],axis=2)
    img=(np.clip(arr,0,1)*255+.5).astype(np.uint8)
    ys,xs=np.where(img[...,3]>3)
    if len(xs)==0: return None
    x0,x1,y0,y1=max(xs.min()-1,0),min(xs.max()+2,256),max(ys.min()-1,0),min(ys.max()+2,256)
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
