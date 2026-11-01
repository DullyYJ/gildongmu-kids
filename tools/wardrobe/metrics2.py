import numpy as np, json
from PIL import Image
A='/tmp/parent/shell-android/app/src/main/assets/chars3d/'
FILES={'ppopu':'ppopu','dolsom':'dolsom','lovel':'lovel','chaeng':'chaeng','sul':'sul','dudung':'dudung','bbosong':'bbosong_0','juksun':'juksun_nb'}
POOL={'chaeng':0.10}   # 위쪽 가장자리 무시 비율(올챙이 거품)
def load(fn,rows):
    im=np.array(Image.open(A+fn+'.webp').convert('RGBA'))
    return [im[r*256:(r+1)*256, c*256:(c+1)*256] for r in range(rows) for c in range(4)]
def met(cell,ch):
    m=cell[:,:,3]>40
    if ch=='sul':
        wm=m&(cell[:,:,0]>175)&(cell[:,:,1]>175)&(cell[:,:,2]>165)
        if wm.sum()>150: head=wm
        else: head=m
    else: head=m
    ys,xs=np.nonzero(m)
    if len(ys)<50: return [0,0,0,0,0]
    rows=m.sum(1); cs=np.cumsum(rows); tot=cs[-1]
    t=int(np.searchsorted(cs,tot*POOL.get(ch,0.02))); b=int(np.searchsorted(cs,tot*0.98))
    cols=m.sum(0); cc=np.cumsum(cols); l=int(np.searchsorted(cc,tot*0.02)); r=int(np.searchsorted(cc,tot*0.98))
    cx=int(xs.mean())
    if ch=='sul' and head is not m:
        hy,hx=np.nonzero(head); hr=head.sum(1); hc=np.cumsum(hr); ht=int(np.searchsorted(hc,hc[-1]*0.03))
        band=head[ht:ht+14,:]; bx=np.nonzero(band)[1]
        return [int(bx.mean()) if len(bx) else int(hx.mean()), ht, max(8,r-l), max(8,b-t), cx]
    band=m[t:t+max(4,int((b-t)*0.2)),:]; bx=np.nonzero(band)[1]
    tx=int(bx.mean()) if len(bx) else (l+r)//2
    return [tx,t,max(8,r-l),max(8,b-t),cx]
res={}
for ch,f in FILES.items():
    fa=f if ch!='juksun' else 'juksun'
    res[ch]={'walk':[met(c,ch) for c in load(f,4)],
             'act':[met(c,ch) for c in load(fa+'_act' if ch!='bbosong' else 'bbosong_0_act',4)],
             'pose':[met(c,ch) for c in load((fa if ch!='juksun' else 'juksun')+'_pose' if ch!='bbosong' else 'bbosong_0_pose',2)]}
json.dump(res,open('/tmp/wg/metrics.json','w'))
print({k:v['walk'][0] for k,v in res.items()})
