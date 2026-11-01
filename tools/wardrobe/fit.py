# 몸 윤곽 지표: 칸마다 세로 40줄(머리 꼭대기 ty 에서 몸 높이 bh 까지 0.025bh 간격)의 몸 왼쪽/오른쪽 끝(칸 256 안 픽셀)
import sys, json
sys.path.insert(0,'/tmp/wg3d')
import numpy as np
from PIL import Image
A='/tmp/parent/shell-android/app/src/main/assets/chars3d/'
FILES={'ppopu':'ppopu','dolsom':'dolsom','lovel':'lovel','chaeng':'chaeng','sul':'sul','dudung':'dudung','bbosong':'bbosong_0','juksun':'juksun'}
IDS=['ppopu','dolsom','lovel','chaeng','sul','dudung','bbosong','juksun']
NR=40; STEP=0.025
M=json.load(open('/tmp/wg/metrics.json'))
def sheet(ch,sh):
    fn=FILES[ch]+('' if sh=='walk' else '_'+sh)
    return np.asarray(Image.open(A+fn+'.webp').convert('RGBA'))[...,3]
def runs(row):
    on=row>110; out=[]; i=0; n=len(row)
    while i<n:
        if on[i]:
            j=i
            while j<n and on[j]: j+=1
            out.append((i,j-1)); i=j
        else: i+=1
    return out
def cellfit(al, m):
    tx,ty,bw,bh,cx=m
    res=[]
    if bw<=0: return [(0,0)]*NR
    for j in range(NR):
        y=int(round(ty+j*STEP*bh))
        if y<0 or y>255: res.append((0,0)); continue
        rs=runs(al[y])
        if not rs: res.append((0,0)); continue
        best=min(rs,key=lambda r:0 if r[0]<=cx<=r[1] else min(abs(r[0]-cx),abs(r[1]-cx)))
        res.append(best)
    # 가로 3줄 이동 평균(들쭉날쭉 완화) — 폭이 있는 줄끼리만
    out=[]
    for j in range(NR):
        w=[res[k] for k in range(max(0,j-1),min(NR,j+2)) if res[k][1]>res[k][0]]
        if not w or res[j][1]<=res[j][0]: out.append((0,0)); continue
        out.append((int(round(sum(a for a,b in w)/len(w))),int(round(sum(b for a,b in w)/len(w)))))
    return out
def build():
    F={}
    for ch in IDS:
        cells=[]
        for sh,n in (('walk',16),('pose',8),('act',16)):
            al=sheet(ch,sh)
            for c in range(n):
                cr=(c%4)*256; rr=(c//4)*256
                cells.append(cellfit(al[rr:rr+256,cr:cr+256], M[ch][sh][c]))
        F[ch]=cells
    return F
if __name__=='__main__':
    F=build(); json.dump(F,open('/tmp/wg3d/atlas/fit.json','w'))
    print({ch:(len(F[ch]),F[ch][3][12:20]) for ch in IDS[:2]})
