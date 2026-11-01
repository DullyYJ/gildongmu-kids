import sys, os, json, time
sys.path.insert(0,'/tmp/wg3d')
import numpy as np
from multiprocessing import Pool
from PIL import Image
import fab3d, catalog
cat = catalog.build()
IDS = catalog.IDS
SLOTS = ('hat','cloth','item')
CELL = fab3d.CELL
def job(a):
    ch, si, i = a
    nm, art = cat[ch][SLOTS[si]][i]
    arr, meta = fab3d.render(art, fab3d.noun_of(nm), SLOTS[si], seed=ci_seed(ch)*100+si*20+i)
    return ch, si, i, arr, meta
def ci_seed(ch): return IDS.index(ch)
if __name__=='__main__':
    t=time.time(); os.makedirs('/tmp/wg3d/atlas',exist_ok=True)
    jobs=[(ch,si,i) for ch in IDS for si in range(3) for i in range(20)]
    atl={ch:Image.new('RGBA',(8*CELL,8*CELL),(0,0,0,0)) for ch in IDS}
    meta={ch:[None]*60 for ch in IDS}
    with Pool(os.cpu_count()) as p:
        for ch,si,i,arr,mt in p.imap_unordered(job,jobs,chunksize=4):
            k=si*20+i
            atl[ch].paste(Image.fromarray(arr,'RGBA'),((k%8)*CELL,(k//8)*CELL))
            meta[ch][k]=[round(mt[0],4),round(mt[1],4),round(mt[2],4)]
    for ch in IDS:
        atl[ch].save('/tmp/wg3d/atlas/%s.webp'%ch,'WEBP',quality=88,alpha_quality=90,method=4)
        print(ch, os.path.getsize('/tmp/wg3d/atlas/%s.webp'%ch)//1024,'KB')
    json.dump(meta,open('/tmp/wg3d/atlas/meta.json','w'))
    print('done',round(time.time()-t),'s')
