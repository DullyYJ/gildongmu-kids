import sys; sys.path.insert(0,'k/tools/wardrobe')
import eng, numpy as np
from PIL import Image
from scipy import ndimage as ndi
CI=5
def helmet(sh,c):
    """두덩 광부 헬멧(금색 껍데기 + 손전등) 자리. → (256 칸 불리언 마스크, 얼굴털 색)"""
    a=np.asarray(eng.sheetcell(CI,sh,c)).astype(np.float32)/255
    rgb=a[...,:3]; al=a[...,3]
    mx=rgb.max(2); mn=rgb.min(2); sat=(mx-mn)/np.maximum(mx,1e-3)
    r,g,b=rgb[...,0],rgb[...,1],rgb[...,2]
    hue=np.degrees(np.arctan2(np.sqrt(3)*(g-b),2*r-g-b))%360
    gold=(al>0.5)&(sat>0.5)&(hue>28)&(hue<58)
    gold=ndi.binary_opening(gold,iterations=1)
    if gold.sum()<200: return None,None,a
    lab,n=ndi.label(gold); sz=ndi.sum(gold,lab,range(1,n+1)); gold=lab==(1+int(np.argmax(sz)))
    ys,xs=np.where(gold); y0,y1,x0,x1=ys.min(),ys.max(),xs.min(),xs.max()
    # 손전등: 금색 가까이의 흰/회색(채도 낮음) 덩어리 — 금색 상자 위쪽 ~ 70% 안쪽
    near=ndi.binary_dilation(gold,iterations=18)
    lamp=(al>0.5)&near&(sat<0.3)&(mx>0.3)&(np.arange(256)[:,None]<y0+0.85*(y1-y0))
    lamp=ndi.binary_opening(lamp,iterations=1)
    lab,n=ndi.label(lamp)
    keep=np.zeros_like(gold)
    for k in range(1,n+1):
        m=lab==k
        if ndi.binary_dilation(m,iterations=3)[gold].any() and m.sum()>40: keep|=m
    R=gold|keep
    R=ndi.binary_closing(R,iterations=4); R=ndi.binary_fill_holes(R)
    return R,gold,a
if __name__=='__main__':
    cells=[(0,c) for c in range(16)]+[(1,c) for c in range(8) if c!=1]+[(2,c) for c in range(16)]
    S=128; cols=8; W=Image.new('RGB',(S*cols,S*((len(cells)+cols-1)//cols)))
    for k,(sh,c) in enumerate(cells):
        R,g,a=helmet(sh,c)
        bg=Image.new('RGBA',(256,256),(222,236,252,255)); bg.alpha_composite(eng.sheetcell(CI,sh,c))
        im=np.asarray(bg.convert('RGB')).copy()
        if R is not None:
            edge=R&~ndi.binary_erosion(R); im[edge]=(255,0,0)
        W.paste(Image.fromarray(im).resize((S,S)),((k%cols)*S,(k//cols)*S))
    W.save('x/helm.png')
