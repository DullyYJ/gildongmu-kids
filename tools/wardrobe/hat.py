import sys; sys.path.insert(0,'.')
import numpy as np, math, eng
def tilt(ci,sheet,cell):
    m=eng.MET[(ci,sheet)]; mb=cell*5
    if m[mb+2]<=0: return 0.0
    idx=[cell,16+cell,24+cell][sheet]; bh=m[mb+3]
    js=[];ms=[]
    for j in range(2,11):
        l=ord(eng.FITS[ci][(idx*40+j)*2])-0x100; r=ord(eng.FITS[ci][(idx*40+j)*2+1])-0x100
        if r-l>=8: js.append(j); ms.append((l+r)/2)
    if len(js)<4: return 0.0
    s=np.polyfit(js,ms,1)[0]; t=s/(0.025*bh)
    return float(np.clip(-math.atan(t)*0.7,-0.26,0.26))
