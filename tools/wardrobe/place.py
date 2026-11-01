import json
M=json.load(open('/tmp/wg/metrics.json'))
IDS=['ppopu','dolsom','lovel','chaeng','sul','dudung','bbosong','juksun']
# K[ch] = {hat:(dx,dy,w), cloth:(dx,dy,w), item:(dx,dy,w)}   hat/cloth/item 위치 = 지표(tx,ty,bw,bh,cx) 의 비율
K={c:{'hat':(0,.10,.60),'cloth':(0,.62,.55),'item':(.38,.72,.45)} for c in IDS}
try:
    from kconst import K as K2; K.update(K2)
except Exception: pass
def place(ch,sheet,cell,slot):
    tx,ty,bw,bh,cx=M[ch][sheet][cell]; dx,dy,w=K[ch][slot]
    if slot=='hat': return tx+dx*bw, ty+dy*bh, w*bw
    return cx+dx*bw, ty+dy*bh, w*bw
