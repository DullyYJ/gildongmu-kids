import sys; sys.path.insert(0,'/tmp/wg3d')
import numpy as np, json
from PIL import Image
import fab3d, catalog, place, preview
cat = catalog.build()
CACHE={}
def spr(ch, slot, i):
    k=(ch,slot,i)
    if k not in CACHE:
        nm, art = cat[ch][slot][i]
        arr, meta = fab3d.render(art, fab3d.noun_of(nm), slot, seed=i)
        CACHE[k]=(Image.fromarray(arr,'RGBA'), meta)
    return CACHE[k]
def comp(ch, sheet, cell, pick, size=384, bg=(222,236,252,255)):
    base = Image.new('RGBA',(256,256),bg)
    base.alpha_composite(preview.sheetcell(ch,sheet,cell))
    S = size/256.0
    base = base.resize((size,size),Image.LANCZOS)
    for slot in ('cloth','item','hat'):
        if slot not in pick: continue
        im, (fcx,fcy,side) = spr(ch, slot, pick[slot])
        x,y,u = place.place(ch,sheet,cell,slot)
        px = int(round(side*u*S)); 
        if px<2: continue
        t = im.resize((px,px),Image.LANCZOS)
        cx = (x+fcx*u)*S; cy=(y+fcy*u)*S
        base.alpha_composite(t,(int(round(cx-px/2)),int(round(cy-px/2))))
    return base
if __name__=='__main__':
    ch=sys.argv[1]; pick=dict(hat=int(sys.argv[2]),cloth=int(sys.argv[3]),item=int(sys.argv[4]))
    cells=[0,3,6,9]
    W=Image.new('RGB',(384*4,384))
    for j,c in enumerate(cells): W.paste(comp(ch,'walk',c,pick).convert('RGB'),(j*384,0))
    W.save('/tmp/wg3d/out/comp_%s.png'%ch)
