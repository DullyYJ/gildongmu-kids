# p-kids60: 개 친구(뽀푸 · 둘숑)의 귀띠(토끼 · 고양이 귀띠)를 이마에 둘러 굽는다.
# 머리털 덩어리 전체가 머리로 잡히는 개 친구는 얼굴이 덩어리 오른쪽 가운데에 있어서, 머리 상자(hbox)에서 이마 자리를 잡고
# 띠를 머리 둥근 면을 따라 양끝이 아래로 휘게(곡면 휨) 펴 얹은 뒤 살짝 그림자를 넣어 assets/wear/<친구>_g<20+모자번호>.webp 로 낸다.
import sys, json, os, math, time
sys.path.insert(0, 'k/tools/wardrobe'); sys.path.insert(0, '.')
import numpy as np, eng, hadj
import bake as B
from PIL import Image
from scipy import ndimage as ndi
N = 512
JOBS = {0: [19], 1: [12, 13]}
FOREHEAD = dict(fx=0.68, fy=0.30, w=0.40, bend=0.16, tilt=0.10)     # 이마 가운데(머리 상자 비율) · 띠 폭(머리 폭 비율) · 양끝 휨(띠 폭 비율) · 기울기(라디안)
X, Y = np.meshgrid(np.arange(N, dtype=np.float32), np.arange(N, dtype=np.float32))
def hat(ci, i):
    ox = (i % 8) * 192; oy = (i // 8) * 192
    a = np.asarray(eng.atlas(ci).crop((ox, oy, ox + 192, oy + 192))).astype(np.float32) / 255
    P = a.copy(); P[..., :3] *= P[..., 3:4]
    m = a[..., 3] > 0.3; rr = np.where(m.any(1))[0]; cc = np.where(m.any(0))[0]
    return P, rr.min(), rr.max() + 1, cc.min(), cc.max() + 1

def tile(ci, i, sh, c, hb, P, r0, r1, c0, c1, par):
    if (sh, c) not in hb: return B.EMPTY
    hxm, hy0, hy1, hw, hh = [v * 2 for v in hb[(sh, c)]]            # 512 기준
    Fx = hxm - hw / 2 + par['fx'] * hw; Fy = hy0 + par['fy'] * hh
    bw = par['w'] * hw; k = bw / float(c1 - c0)
    dx = X - Fx; dy = Y - Fy; cs, sn = math.cos(par['tilt']), math.sin(par['tilt'])
    u = cs * dx + sn * dy; v = -sn * dx + cs * dy
    uu = np.clip(u / (bw / 2), -1.3, 1.3)
    v2 = v - par['bend'] * bw * (uu * uu)                          # 양끝이 머리 곡면을 따라 내려간다
    col = (c0 + c1) / 2.0 + u / k; row = r1 + v2 / k
    S = np.stack([ndi.map_coordinates(P[..., q], [row, col], order=1, mode='constant', cval=0.0) for q in range(4)], axis=-1)
    a = S[..., 3]
    sd = ndi.shift(ndi.gaussian_filter(a, 4.0), (4.0, 1.0), order=1) * 0.28 * (1 - a)
    la = a + sd; prem = S[..., :3]
    la2 = la.reshape(256, 2, 256, 2).mean((1, 3)); pm = prem.reshape(256, 2, 256, 2, 3).mean((1, 3))
    colr = np.where(la2[..., None] > 1e-4, pm / np.maximum(la2[..., None], 1e-4), 0)
    img = (np.clip(np.concatenate([colr, la2[..., None]], axis=2), 0, 1) * 255 + .5).astype(np.uint8)
    ys, xs = np.where(img[..., 3] > 3)
    if len(xs) == 0: return B.EMPTY
    x0, x1, y0, y1 = max(xs.min() - 1, 0), min(xs.max() + 2, 256), max(ys.min() - 1, 0), min(ys.max() + 2, 256)
    return (int(x0), int(y0), img[y0:y1, x0:x1])

def cells():
    for kn, sheet, nc in B.KINDS:
        for c in range(nc):
            if sheet == 1 and c == 1: continue
            yield kn, sheet, c

def run(chars):
    os.makedirs('wearw', exist_ok=True)
    for ci in chars:
        hb = hadj.headbox(ci); meta = {}
        for i in JOBS[ci]:
            P, r0, r1, c0, c1 = hat(ci, i)
            par = dict(FOREHEAD); par.update(json.load(open('band_par.json')).get('%d:%d' % (ci, i), {}) if os.path.exists('band_par.json') else {})
            tiles = []
            for kn, sh, c in cells():
                tiles.append(((ci, kn, c, i), tile(ci, i, sh, c, hb, P, r0, r1, c0, c1, par)))
            tiles.sort(key=lambda kv: -kv[1][2].shape[0])
            W = 1024; x = y = rowh = 0; pos = {}
            for key, (ox, oy, im) in tiles:
                h, w = im.shape[:2]
                if x + w > W: x = 0; y += rowh; rowh = 0
                pos[key] = (x, y, w, h, ox, oy); x += w + 1; rowh = max(rowh, h + 1)
            sheet = Image.new('RGBA', (W, y + rowh), (0, 0, 0, 0))
            for key, (ox, oy, im) in tiles: sheet.paste(Image.fromarray(im, 'RGBA'), pos[key][:2])
            sheet.save('wearw/%s_g%d.webp' % (eng.IDS[ci], 20 + i), 'WEBP', quality=80, alpha_quality=90, method=6)
            meta['%d_%d' % (ci, 20 + i)] = {'size': [W, y + rowh], 'tiles': {'%d' % B.cellidx(k[1], k[2]): tuple(int(v) for v in p) for k, p in pos.items() if p[2] > 2}}
        json.dump(meta, open('wearw/meta_band_%d.json' % ci, 'w'))
        print(eng.IDS[ci], sorted(JOBS[ci]))

if __name__ == '__main__':
    run([int(v) for v in sys.argv[1].split(',')] if len(sys.argv) > 1 else [0, 1])
