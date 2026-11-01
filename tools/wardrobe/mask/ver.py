import sys; from PIL import Image; import numpy as np
CH='../par/shell-android/app/src/main/assets/chars3d/'
def down(im): return im.convert('RGBA').convert('RGBa').resize((256,256),Image.LANCZOS).convert('RGBA')
for cid in sys.argv[1].split(','):
    for tag,suf,n in (('w','',16),('p','_pose',6),('a','_act',16)):
        sh=Image.open(CH+cid+suf+'.webp').convert('RGBA'); r=[]
        for i in range(n):
            try: f=down(Image.open(f'mk/{cid}_{tag}{i:02d}.png'))
            except Exception: r.append(None); continue
            c=sh.crop(((i%4)*256,(i//4)*256,(i%4)*256+256,(i//4)*256+256))
            a=np.asarray(c)[...,3]>24; b=np.asarray(f)[...,3]>24; r.append(round((a&b).sum()/max((a|b).sum(),1),3))
        print(cid,tag,r)
