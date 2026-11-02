import sys, os, shutil
sys.path.insert(0, 'k/tools/wardrobe')
import eng, bake
JOBS = {2: [1], 3: [2, 8], 4: [15], 6: [14, 18], 7: [5]}
for ci, its in JOBS.items():
    w = ''.join('1' if i in its else '0' for i in range(20))
    eng.WRAPS[ci] = w
    bake.run([ci])
    shutil.move('wearw/meta_%d.json' % ci, 'wearw/meta_p62_%d.json' % ci)
