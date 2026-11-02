import re, math, numpy as np
from PIL import Image
J=open('k/app/src/main/java/com/dullyyj/kids/Wardrobe.java',encoding='utf-8').read()
IDS=['ppopu','dolsom','lovel','chaeng','sul','dudung','bbosong','juksun']
MET={}
for m in re.finditer(r'MET\[(\d)\]\[(\d)\] = new int\[\]\{([^}]*)\}',J): MET[(int(m[1]),int(m[2]))]=[int(v) for v in m[3].split(',')]
def block(name):
    i=J.index(name); j=J.index('};',i); return J[i:j]
kk=block('KK = {'); KK=[]
for row in re.findall(r'\{\s*(\{[^{}]*\}(?:,\s*\{[^{}]*\})*)\s*\}',kk.split('{',1)[1]):
    KK.append([[float(v.rstrip('f')) for v in g.split(',')] for g in re.findall(r'\{([^{}]*)\}',row)])
wm=block('WM = {'); WM=[[float(v.rstrip('f')) for v in r.split(',')] for r in re.findall(r'\{([^{}]*)\}',wm.split('{',1)[1])]
def strarr(name):
    b=block(name); return re.findall(r'"([^"]*)"',b)
FITS=strarr('FITS = {'); SXS=strarr('SXS = {'); WBS=strarr('WBS = {'); WRAPS=strarr('WRAPS = {')
N={}
for m in re.finditer(r'N\[(\d+)\] = new String\[\]\{([^;]*)\};',J): N[int(m[1])]=re.findall(r'"([^"]*)"',m[2])
NS=32
def place(ci,sheet,cell,slot):
    m=MET[(ci,sheet)]; b=cell*5
    if b+4>=len(m) or m[b+2]<=0 or (sheet==1 and cell==1): return None
    tx,ty,bw,bh,cx=m[b:b+5]; k=KK[ci][slot]
    return ((tx if slot==0 else cx)+k[0]*bw, ty+k[1]*bh, k[2]*bw)
def fit(ci,idx,row,s): return ord(FITS[ci][(idx*40+row)*2+s])-0x100
def bodyAt(ci,idx,ty,bh,y):
    t=(y-ty)/(0.025*bh); j=math.floor(t); fr=t-j
    ja=min(max(j,0),39); jb=min(max(j+1,0),39)
    la,ra,lb,rb=fit(ci,idx,ja,0),fit(ci,idx,ja,1),fit(ci,idx,jb,0),fit(ci,idx,jb,1)
    a=ra-la>=8; b=rb-lb>=8
    if a and b: return la*(1-fr)+lb*fr, ra*(1-fr)+rb*fr
    if a: return la,ra
    if b: return lb,rb
    return None
WIDEN=1.0
import json as _j, os as _o
HADJ={}
def load_hadj(fn='hadj.json'):
    HADJ.clear()
    if _o.path.exists(fn): HADJ.update({tuple(map(int,k.split(':'))):v for k,v in _j.load(open(fn)).items()})
load_hadj()
def strips(ci,sheet,cell,slot,i,x,y,u,allow_wrap=True):
    b0=(slot*20+i)*3; fcx,fcy,side=WM[ci][b0:b0+3]
    hv=HADJ.get((ci,i),(1,0,0,1)) if slot==0 else (1,0,0,1)
    ds,ddx,ddy=hv[:3]; ay=hv[3] if len(hv)>3 else 1
    sw=side*u*ds; shh=sw*ay
    cxs=x+(fcx+ddx)*u; cys=y+(fcy+ddy)*u; sx0=cxs-sw/2; sy0=cys-shh/2; P=192/sw
    idx=[cell,16+cell,24+cell][sheet]
    wrap= allow_wrap and slot==1 and WRAPS[ci][i]=='1'
    if wrap:
        m=MET[(ci,sheet)]; mb=cell*5; ty=m[mb+1]; bh=m[mb+3]
        wb=lambda k:(ord(WBS[ci][i*3+k])-0x8000)/1000
        by0,by1,natw=wb(0),wb(1),wb(2)*u
        top=y+by0*u; bot=y+by1*u; ctr=(top+bot)/2
        bo=bodyAt(ci,idx,ty,bh,ctr)
        if natw<=0 or not bo: wrap=False
    if not wrap: return [(0,0,192,192,sx0,sy0,sx0+sw,sy0+shh)]
    g=min(max((bo[1]-bo[0])*0.98/natw,1),1.5); H=(bot-top)*g**0.75
    out=[]; lastS=-1; lastM=0; sx=SXS[ci]
    for k in range(NS):
        ya=ctr-H/2+k*H/NS; yb=ya+H/NS; yc=(ya+yb)/2
        ql=ord(sx[(i*NS+k)*2])-0x100; qr=ord(sx[(i*NS+k)*2+1])-0x100
        if qr<=ql: continue
        sa=96+192*(by0+(by1-by0)*k/NS-fcy)/side; sb=96+192*(by0+(by1-by0)*(k+1)/NS-fcy)/side
        nat=(qr-ql)/P; bo=bodyAt(ci,idx,ty,bh,yc)
        if bo:
            bw=(bo[1]-bo[0])*0.98*WIDEN; mid=(bo[0]+bo[1])/2; wd=min(max(bw,nat*g*0.9),nat*g*1.15*WIDEN); lastS=wd/nat; lastM=mid
        elif lastS<0: wd=nat*g; mid=cxs+((ql+qr)/2-96)/P
        else: wd=nat*lastS; mid=lastM
        ia=round(sa); ib=round(sb); ib=max(ib,ia+1)
        out.append([ql,ia,qr,ib,mid,wd,ya,yb])
    for it in range(4):
        for j in range(1,len(out)-1):
            out[j][4]=(out[j-1][4]+2*out[j][4]+out[j+1][4])/4; out[j][5]=(out[j-1][5]+2*out[j][5]+out[j+1][5])/4
    return [(o[0],o[1],o[2],o[3],o[4]-o[5]/2,o[6]-.35,o[4]+o[5]/2,o[7]+.35) for o in out]
CH='par/shell-android/app/src/main/assets/chars3d/'
FILES={'ppopu':'ppopu','dolsom':'dolsom','lovel':'lovel','chaeng':'chaeng','sul':'sul','dudung':'dudung','bbosong':'bbosong_0','juksun':'juksun'}
NH={5:True}    # 두덩: 모자를 쓸 때 안전모 없는 시트(wear/dudung_nh · dudung_act_nh)에 입힌다
def sheetcell(ci,sheet,cell,nh=True):
    ch=IDS[ci]; fn=FILES[ch]+['','_pose','_act'][sheet]
    if nh and NH.get(ci) and sheet in (0,2): im=Image.open('k/app/src/main/assets/wear/%s%s_nh.webp'%(ch,['','','_act'][sheet])).convert('RGBA')
    else: im=Image.open(CH+fn+'.webp').convert('RGBA')
    c=cell%4; r=cell//4
    return im.crop((c*256,r*256,c*256+256,r*256+256))
ATL={}
def atlas(ci):
    if ci not in ATL: ATL[ci]=Image.open('k/app/src/main/assets/wear/%s.webp'%IDS[ci]).convert('RGBA')
    return ATL[ci]
def comp(ci,sheet,cell,pick,size=384,bg=(222,236,252,255),wrap=True):
    S=size/256; base=Image.new('RGBA',(256,256),bg); base.alpha_composite(sheetcell(ci,sheet,cell))
    base=base.resize((size,size),Image.LANCZOS)
    for slot in (1,2,0):
        if slot not in pick: continue
        pl=place(ci,sheet,cell,slot)
        if not pl: continue
        i=pick[slot]; q=slot*20+i; ox=(q%8)*192; oy=(q//8)*192
        for (a,b,c,d,x0,y0,x1,y1) in strips(ci,sheet,cell,slot,i,*pl,allow_wrap=wrap):
            sw=int(round((x1-x0)*S)); sh=int(round((y1-y0)*S))
            if sw<1 or sh<1: continue
            t=atlas(ci).crop((ox+int(a),oy+int(b),ox+int(c),oy+int(d))).resize((sw,sh),Image.LANCZOS)
            base.alpha_composite(t,(max(int(round(x0*S)),0),max(int(round(y0*S)),0)))
    return base
