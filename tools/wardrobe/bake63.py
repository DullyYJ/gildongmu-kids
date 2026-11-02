import sys, shutil
sys.path.insert(0, 'k/tools/wardrobe')
import eng, bake
JOBS = {0: [2], 1: [6, 9], 2: [6, 15], 3: [1, 11], 4: [0, 18], 5: [4], 6: [3, 19], 7: [4]}
for ci, its in JOBS.items():
    eng.WRAPS[ci] = ''.join('1' if i in its else '0' for i in range(20))
    bake.run([ci])
    shutil.move('wearw/meta_%d.json' % ci, 'wearw/meta_p63_%d.json' % ci)
