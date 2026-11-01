import sys; sys.path.insert(0,'/tmp/wg')
import importlib, art, rend, place; importlib.reload(place)
from PIL import Image
A='/tmp/parent/shell-android/app/src/main/assets/chars3d/'
FILES={'ppopu':'ppopu','dolsom':'dolsom','lovel':'lovel','chaeng':'chaeng','sul':'sul','dudung':'dudung','bbosong':'bbosong_0','juksun':'juksun'}
def sheetcell(ch,sheet,cell):
    fn=FILES[ch]+('' if sheet=='walk' else '_'+sheet)
    im=Image.open(A+fn+'.webp').convert('RGBA'); c=cell%4; r=cell//4
    return im.crop((c*256,r*256,c*256+256,r*256+256))
def comp(ch,sheet,cell,arts,size=256,bg=(235,235,235,255)):
    base=Image.new('RGBA',(256*rend.SS,256*rend.SS),bg)
    sp=sheetcell(ch,sheet,cell).resize((256*rend.SS,256*rend.SS),Image.LANCZOS); base.alpha_composite(sp)
    for slot in ('cloth','item','hat'):
        a=arts.get(slot)
        if not a: continue
        x,y,u=place.place(ch,sheet,cell,slot); rend.R(base,x,y,u).run(a)
    return base.resize((size,size),Image.LANCZOS)
if __name__=='__main__':
    pal=('d08a4a','f5e1b8','e04848'); pal2=('4a7fd0','e8f0ff','ffd040')
    arts={'hat':art.H_crown(*pal,1),'cloth':art.C_scarf(*pal2,0),'item':art.I_balloon(*pal,0)}
    cells=[0,3,6,9]
    W=Image.new('RGB',(256*len(cells),256*8))
    for i,ch in enumerate(place.IDS):
        for j,c in enumerate(cells): W.paste(comp(ch,'walk',c,arts).convert('RGB'),(j*256,i*256))
    W.save('/tmp/vf/ov.png')
