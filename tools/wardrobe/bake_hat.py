# 두덩 모자(p-kids57): 두덩은 원래 금색 광부 헬멧을 쓰고 있어 모자가 헬멧 위에 겹쳐 보였다.
# 칸마다 헬멧 자리를 찾아 털색 둥근 머리로 덮고(헬멧 지움), 그 위에 모자를 머리에 맞춰 올려 한 장으로 구워 assets/wear/dudung_g<20+모자번호>.webp 로 낸다.
import sys, json, os, math, time
sys.path.insert(0, 'k/tools/wardrobe')
import numpy as np, eng, helm
import bake as B
from PIL import Image
from scipy import ndimage as ndi
CI = 5; N = 512
HAT_SC = json.load(open('hat_sc.json')) if os.path.exists('hat_sc.json') else {}   # {모자번호: [폭 배율, 아래로 옮김(칸 256 픽셀)]}

def fur_color(a, R):
    rgb = a[..., :3]; al = a[..., 3]
    mx = rgb.max(2); mn = rgb.min(2); sat = (mx - mn) / np.maximum(mx, 1e-3)
    ring = ndi.binary_dilation(R, iterations=14) & ~ndi.binary_dilation(R, iterations=2) & (al > 0.5) & (sat < 0.5) & (mx > 0.35)
    # 분홍 코(채도 · 붉은 기) 빼기
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    ring &= ~((r - g) > 0.22)
    if ring.sum() < 20: return np.array([0.62, 0.5, 0.39], np.float32)
    return np.median(rgb[ring], axis=0)

def fur_layer(a, R):
    """헬멧 자리를 덮는 털색 둥근 머리(512 premult RGBA)."""
    col = fur_color(a, R)
    Rb = np.asarray(Image.fromarray((R * 255).astype(np.uint8)).resize((N, N), Image.BILINEAR)).astype(np.float32) / 255
    Rb = ndi.gaussian_filter(Rb, 1.2)
    A = Rb > 0.5
    dist = ndi.distance_transform_edt(A); Rr = 40.0
    tt = np.clip(dist / Rr, 0, 1); hh = ndi.gaussian_filter(np.sqrt(1 - (1 - tt) ** 2) * Rr, 4)
    gy, gx = np.gradient(hh); nz = 1 / np.sqrt(1 + gx ** 2 + gy ** 2); nx = -gx * nz; ny = -gy * nz
    lit = np.clip(nx * -0.45 + ny * -0.55 + nz * 0.70, 0, 1)
    shade = 0.80 + 0.36 * lit
    rgb = np.clip(col[None, None, :] * shade[..., None], 0, 1)
    al = np.clip((Rb - 0.35) / 0.3, 0, 1)
    return np.concatenate([rgb * al[..., None], al[..., None]], axis=2)

def hat_layer(sh, c, i):
    """모자 한 장을 엔진 자리 · 크기 · 기울기대로 512 premult RGBA 로."""
    pl = eng.place(CI, sh, c, 0)
    out = np.zeros((N, N, 4), np.float32)
    if not pl: return out
    x, y, u = pl
    sc = HAT_SC.get(str(i))
    if sc: u = u * sc[0]; y = y + sc[1]
    q = i; ox = (q % 8) * 192; oy = (q // 8) * 192
    S = N / 256.0
    base = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    for (a, b, cc, d, x0, y0, x1, y1) in eng.strips(CI, sh, c, 0, i, x, y, u, allow_wrap=False):
        sw = int(round((x1 - x0) * S)); shh = int(round((y1 - y0) * S))
        if sw < 1 or shh < 1: continue
        t = eng.atlas(CI).crop((ox + int(a), oy + int(b), ox + int(cc), oy + int(d))).resize((sw, shh), Image.LANCZOS)
        base.alpha_composite(t, (max(int(round(x0 * S)), 0), max(int(round(y0 * S)), 0)))
    # 모자 기울기(엔진 hatTilt)
    import hat as H
    tl = H.tilt(CI, sh, c)
    if tl:
        px = (pl[0]) * S; py = (y + 0.0) * S
        # 앱은 모자 아래 80% 줄 가운데를 중심으로 돈다 — 모자 내용 상자 기준
        bb = base.getbbox()
        if bb:
            px = (bb[0] + bb[2]) / 2.0; py = bb[1] + 0.8 * (bb[3] - bb[1])
            base = base.rotate(-math.degrees(tl), resample=Image.BICUBIC, center=(px, py))
    a = np.asarray(base).astype(np.float32) / 255
    out[..., :3] = a[..., :3] * a[..., 3:4]; out[..., 3] = a[..., 3]
    return out

def over(top, bot):
    ta = top[..., 3:4]
    return top + bot * (1 - ta)

def tile(sh, c, i):
    R, g, a = helm.helmet(sh, c)
    if R is None: return B.EMPTY
    L = over(hat_layer(sh, c, i), fur_layer(a, R))
    la = L[..., 3]
    la = la.reshape(256, 2, 256, 2).mean((1, 3)); pm = L[..., :3].reshape(256, 2, 256, 2, 3).mean((1, 3))
    colr = np.where(la[..., None] > 1e-4, pm / np.maximum(la[..., None], 1e-4), 0)
    img = (np.clip(np.concatenate([colr, la[..., None]], axis=2), 0, 1) * 255 + .5).astype(np.uint8)
    ys, xs = np.where(img[..., 3] > 3)
    if len(xs) == 0: return B.EMPTY
    x0, x1, y0, y1 = max(xs.min() - 1, 0), min(xs.max() + 2, 256), max(ys.min() - 1, 0), min(ys.max() + 2, 256)
    return (int(x0), int(y0), img[y0:y1, x0:x1])

def cells():
    for kn, sheet, nc in B.KINDS:
        for c in range(nc):
            if sheet == 1 and c == 1: continue
            yield kn, sheet, c

def job(args):
    sh, c, hats = args
    return (sh, c), {i: tile(sh, c, i) for i in hats}

def run(hats):
    from multiprocessing import Pool
    os.makedirs('wearw', exist_ok=True)
    t0 = time.time(); meta = {}
    with Pool(2) as Pl:
        res = dict(Pl.map(job, [(sh, c, hats) for kn, sh, c in cells()], chunksize=4))
    for i in hats:
        tiles = []
        for kn, sh, c in cells(): tiles.append(((CI, kn, c, i), res[(sh, c)][i]))
        tiles.sort(key=lambda kv: -kv[1][2].shape[0])
        W = 1024; x = y = rowh = 0; pos = {}
        for key, (ox, oy, im) in tiles:
            h, w = im.shape[:2]
            if x + w > W: x = 0; y += rowh; rowh = 0
            pos[key] = (x, y, w, h, ox, oy); x += w + 1; rowh = max(rowh, h + 1)
        sheetimg = Image.new('RGBA', (W, y + rowh), (0, 0, 0, 0))
        for key, (ox, oy, im) in tiles: sheetimg.paste(Image.fromarray(im, 'RGBA'), pos[key][:2])
        sheetimg.save('wearw/%s_g%d.webp' % (eng.IDS[CI], 20 + i), 'WEBP', quality=80, alpha_quality=90, method=6)
        meta['%d_%d' % (CI, 20 + i)] = {'size': [W, y + rowh], 'tiles': {'%d' % B.cellidx(k[1], k[2]): tuple(int(v) for v in p) for k, p in pos.items()}}
    json.dump(meta, open('wearw/meta_hat_5.json', 'w'))
    print('dudung hats', len(hats), round(time.time() - t0), 's')

if __name__ == '__main__':
    run(list(range(20)))
