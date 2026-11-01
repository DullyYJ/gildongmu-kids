# 길동무 키즈 두르지 않는 옷(나비넥타이 · 넥타이 · 목도리 · 메달 · 어깨띠 · 꽃목걸이 · 날개) 굽기 (p-kids55)
# 친구마다 · 칸마다 3D 부위 마스크(m3d/mk/*_m.png: R 몸통 · G 머리 · B 팔다리)에서 턱 · 머리 폭 · 몸통을 재서 자리 · 크기 · 기울기를 정하고
# 몸에 맞게 한 장씩 구워 assets/wear/<친구>_g<번호>.webp(bake.py 와 같은 꼴)로 만든다. 날개는 몸 뒤로(몸에 가려지게), 어깨띠는 몸통 곡면에 휘어 입힌다.
import sys, json, os, time, math
sys.path.insert(0, 'k/tools/wardrobe')
import numpy as np, eng
from PIL import Image
from scipy import ndimage as ndi
import bake as B
KINDS = B.KINDS
N = 512

def kind(name):
    if '나비넥타이' in name: return 'bow'
    if '넥타이' in name: return 'tie'
    if '목도리' in name: return 'scarf'
    if '메달' in name: return 'medal'
    if '어깨띠' in name: return 'sash'
    if '꽃목걸이' in name: return 'neck'
    if '날개' in name: return 'wing'
    return None

# 종류마다 {폭: 머리 폭 비율, 위 맞춤: 턱 기준 머리 높이 비율(+ 아래), 기울기 배율}. 친구마다 곱하는 값 SC[ci][종류] 로 따로 다듬는다.
PAR = {
    'bow':   dict(w=0.58, dy=0.02, anchor='center', rot=0.8),
    'tie':   dict(w=0.32, dy=-0.10, anchor='top', rot=0.5),
    'scarf': dict(w=0.74, dy=-0.03, anchor='top', rot=0.8),
    'medal': dict(w=0.34, dy=-0.06, anchor='top', rot=0.5),
    'neck':  dict(w=0.74, dy=-0.10, anchor='top', rot=0.8),
}
CFG = {0: dict(w=0.78, nx='chest', wing_head=1), 1: dict(w=0.78, nx='chest', wing_head=1)}   # 친구마다: 폭 배율 · 목 가운데를 가슴(몸통 가운데)에 둘지 · 옆으로 옮김
SC = {}      # SC[(ci,kind)] = (폭 배율, 아래로 옮김(머리 높이 비율))
try:
    SC = {tuple(k.split(':')[:1] + [k.split(':')[1]]): v for k, v in json.load(open('acc_sc.json')).items()}
    SC = {(int(a), b): v for (a, b), v in SC.items()}
except Exception:
    SC = {}

_spr = {}
def spr(ci, i):
    k = (ci, i)
    if k in _spr: return _spr[k]
    G = B.sprite(ci, i)
    ga = G[..., 3] > 0.47
    rows = np.where(ga.any(1))[0]; cols = np.where(ga.any(0))[0]
    P = G.copy(); P[..., :3] *= P[..., 3:4]
    _spr[k] = (P, rows.min(), rows.max() + 1, cols.min(), cols.max() + 1)
    return _spr[k]

X, Y = np.meshgrid(np.arange(N, dtype=np.float32), np.arange(N, dtype=np.float32))

def put(ci, i, cx, cy, width, rot, anchor):
    """스프라이트 내용 상자를 폭 width 픽셀로 맞춰 (cx,cy) 에 놓는다(anchor: center | top = 위 가운데). rot = 시계 방향 라디안. → 곱해진(premult) RGBA 512."""
    P, r0, r1, c0, c1 = spr(ci, i)
    sc = width / float(c1 - c0)
    dx = X - cx; dy = Y - cy; c = math.cos(rot); s = math.sin(rot)
    u = c * dx + s * dy; v = -s * dx + c * dy
    col = (c0 + c1) / 2.0 + u / sc
    row = ((r0 + r1) / 2.0 + v / sc) if anchor == 'center' else (r0 + v / sc)
    return np.stack([ndi.map_coordinates(P[..., k], [row, col], order=1, mode='constant', cval=0.0) for k in range(4)], axis=-1)

def largest(M, minpx=0):
    lab, nl = ndi.label(M)
    if nl == 0: return M
    sz = ndi.sum(M, lab, range(1, nl + 1))
    return lab == (1 + int(np.argmax(sz)))

def geo(ci, sheet, cell, ba):
    cls = B.torso(ci, sheet, cell)
    m = eng.MET.get((ci, sheet)); b = cell * 5
    g = {'cls': cls}
    H = Tm = None
    if cls is not None:
        H = ndi.binary_opening(cls == 2, iterations=1)
        if H.sum() > 500: H = largest(H)
        else: H = None
        Tm = ndi.binary_opening(cls == 1, iterations=1)
        if Tm.sum() > 800: Tm = largest(Tm)
        else: Tm = None
    if H is not None:
        ys, xs = np.where(H); hy0, hy1, hx0, hx1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        hh = float(hy1 - hy0); hw = float(hx1 - hx0)
        low = H & (Y > hy1 - 0.16 * hh)
        nx = float(X[low].mean()) if low.sum() > 10 else (hx0 + hx1) / 2.0
        # 턱선 기울기: 열마다 가장 아래 y 를 직선으로
        cols = np.arange(hx0, hx1); bot = []
        for xx in cols:
            cc = np.where(H[:, xx])[0]
            bot.append(cc.max() if len(cc) else np.nan)
        bot = np.array(bot, float); ok = ~np.isnan(bot)
        ang = 0.0
        if ok.sum() > 30:
            lo, hi = int(ok.sum() * 0.15), int(ok.sum() * 0.85)
            xs2 = cols[ok][lo:hi]; ys2 = bot[ok][lo:hi]
            if len(xs2) > 12 and xs2.std() > 3:
                ang = math.atan(np.polyfit(xs2, ys2, 1)[0])
        g.update(hxm=float((hx0 + hx1) / 2.0), nx=nx, hy1=float(hy1), hy0=float(hy0), hw=hw, hh=hh, chin=float(max(-0.3, min(0.3, ang))), head=True)
    elif m is not None and b + 4 < len(m) and m[b + 2] > 0:
        tx, ty, bw, bh, cx = m[b:b + 5]
        g.update(nx=2.0 * tx, hy1=2.0 * (ty + 0.34 * bh), hy0=2.0 * ty, hw=2.0 * 0.55 * bw, hh=2.0 * 0.34 * bh, chin=0.0, head=False)
    else:
        return None
    if Tm is not None:
        ys, xs = np.where(Tm)
        g.update(T=Tm, tx0=float(xs.min()), tx1=float(xs.max() + 1), ty0=float(ys.min()), ty1=float(ys.max() + 1), tcx=float(xs.mean()))
    cf = CFG.get(ci, {})
    nw = g['hw']
    if 'T' in g: nw = min(g['hw'], max(0.75 * g['hw'], 1.05 * (g['tx1'] - g['tx0'])))
    g['nw'] = nw * cf.get('w', 1.0)
    if cf.get('nx') == 'chest' and 'T' in g: g['nx'] = 0.5 * g['tcx'] + 0.5 * g['nx'] if False else g['tcx']
    g['nx'] += cf.get('dx', 0.0) * g['hw']
    return g

def hx_mid(g): return g.get('hxm', g['nx'])

def shade_of(Bm):
    ba = Bm[..., 3]
    lum = Bm[..., 0] * .3 + Bm[..., 1] * .59 + Bm[..., 2] * .11
    sm = ndi.gaussian_filter(lum * ba, 5) / np.maximum(ndi.gaussian_filter(ba, 5), 1e-3)
    mm = ba > 0.6
    ref = np.median(sm[mm]) if mm.sum() > 50 else 0.6
    return 1 + (np.clip(sm / max(ref, .15), 0.6, 1.25) - 1) * 0.7

def finish(S, clip, ba, shade, shadow=True):
    a = np.clip(S[..., 3] * clip, 0, 1)
    rgb = np.clip(S[..., :3] / np.maximum(S[..., 3:4], 1e-4), 0, 1) * shade[..., None]
    if shadow:
        cs = ndi.shift(ndi.gaussian_filter(a, 3.2), (3.0, 1.0), order=1) * 0.26
        sh = cs * (1 - a) * (ba > 0.3)
    else:
        sh = 0 * a
    la = a + sh * (1 - a); prem = rgb * a[..., None]
    la = la.reshape(256, 2, 256, 2).mean((1, 3)); prem = prem.reshape(256, 2, 256, 2, 3).mean((1, 3))
    colr = np.where(la[..., None] > 1e-4, prem / np.maximum(la[..., None], 1e-4), 0)
    img = (np.clip(np.concatenate([colr, la[..., None]], axis=2), 0, 1) * 255 + .5).astype(np.uint8)
    ys_, xs_ = np.where(img[..., 3] > 3)
    if len(xs_) == 0: return B.EMPTY
    x0, x1, y0, y1 = max(xs_.min() - 1, 0), min(xs_.max() + 2, 256), max(ys_.min() - 1, 0), min(ys_.max() + 2, 256)
    return (int(x0), int(y0), img[y0:y1, x0:x1])

def sash(ci, i, g, Bm, ba, shade):
    """어깨띠: 몸통 한가운데에 몸통 크기만큼의 곧은 띠를 놓고 몸통 모양(+곡면 음영)으로 잘라 몸을 두른 듯 보이게 한다."""
    T = g.get('T')
    if T is None: return B.EMPTY
    cls = g['cls']
    grow = ndi.binary_dilation(T, iterations=3) & ((cls == 1) | (cls == 4) | (cls == 0))
    A = T | grow
    P, r0, r1, c0, c1 = spr(ci, i)
    asp = (r1 - r0) / float(c1 - c0)
    Tw = g['tx1'] - g['tx0']; Th = g['ty1'] - g['ty0']
    sx, dyy = SC.get((ci, 'sash'), (1.0, 0.0))
    w = min(1.12 * Tw, 1.22 * Th / asp) * sx
    cx = 0.5 * (g['tx0'] + g['tx1']); cy = 0.5 * (g['ty0'] + g['ty1']) + dyy * Th
    S = put(ci, i, cx, cy, w, 0.0, 'center')
    dist = ndi.distance_transform_edt(A); R = 26.0
    tt = np.clip(dist / R, 0, 1); hh = ndi.gaussian_filter(np.sqrt(1 - (1 - tt) ** 2) * R, 3)
    gy, gx = np.gradient(hh); nz = 1 / np.sqrt(1 + gx ** 2 + gy ** 2); nx = -gx * nz; ny = -gy * nz
    dome = 0.72 + 0.40 * np.clip(nx * -0.45 + ny * -0.6 + nz * 0.66, 0, 1)
    S[..., :3] = S[..., :3] * dome[..., None]
    clip = np.clip((ndi.gaussian_filter(A.astype(np.float32), 0.9) - 0.25) / 0.5, 0, 1) * (ba > 0.2)
    return finish(S, clip, ba, shade)

def bake_item(ci, sheet, cell, i, k, g, Bm, ba, shade):
    if k == 'sash': return sash(ci, i, g, Bm, ba, shade)
    nx, hy1, hy0, hw, hh, chin = g['nx'], g['hy1'], g['hy0'], g['hw'], g['hh'], g['chin']
    if k == 'wing':
        if 'T' in g and (g['tx1'] - g['tx0']) > 0.8 * hw * 0.6 and not CFG.get(ci, {}).get('wing_head'):
            bw = g['tx1'] - g['tx0']; cxx = (g['tx0'] + g['tx1']) / 2.0; cyy = g['ty0'] + 0.14 * (g['ty1'] - g['ty0'])
        else:
            bw = 0.9 * hw; cxx = (g['nx'] if not CFG.get(ci, {}).get('wing_head') else 0.5 * (g['nx'] + (hx_mid(g)))); cyy = hy0 + 0.60 * hh
        sx, dyy = SC.get((ci, 'wing'), (1.0, 0.0))
        span = 1.75 * max(bw, 0.9 * hw) * sx
        span = min(span, 2 * min(cxx, N - cxx) - 24)
        S = put(ci, i, cxx, cyy + dyy * hh, span, 0.0, 'center')
        behind = 1 - np.clip((ndi.gaussian_filter((ba > 0.5).astype(np.float32), 1.2) - 0.2) / 0.6, 0, 1)
        return finish(S, behind, ba, np.ones_like(ba), shadow=False)
    p = PAR[k]
    sx, dyy = SC.get((ci, k), (1.0, 0.0))
    width = p['w'] * g['nw'] * sx
    cy = hy1 + (p['dy'] + dyy) * hh
    rot = chin * p['rot']
    S = put(ci, i, nx, cy, width, rot, p['anchor'])
    clip = np.clip(ndi.gaussian_filter(ndi.binary_dilation(ba > 0.3, iterations=4).astype(np.float32), 1.0), 0, 1)
    return finish(S, clip, ba, shade)

def job(args):
    ci, sheet, cell, items = args
    Bm = np.asarray(eng.sheetcell(ci, sheet, cell).resize((N, N), Image.LANCZOS)).astype(np.float32) / 255
    ba = Bm[..., 3]
    out = {}
    if ba.sum() < 500: return args[:3], {i: B.EMPTY for i, k in items}
    g = geo(ci, sheet, cell, ba)
    if g is None: return args[:3], {i: B.EMPTY for i, k in items}
    shade = shade_of(Bm)
    for i, k in items:
        out[i] = bake_item(ci, sheet, cell, i, k, g, Bm, ba, shade)
    return args[:3], out

def itemsOf(ci):
    r = []
    for i in range(20):
        if eng.WRAPS[ci][i] == '0':
            k = kind(eng.N[ci * 3 + 1][i])
            if k: r.append((i, k))
    return r

def cells():
    for kn, sheet, nc in KINDS:
        for c in range(nc):
            if sheet == 1 and c == 1: continue
            yield kn, sheet, c

def run(chars):
    from multiprocessing import Pool
    os.makedirs('wearw', exist_ok=True)
    meta = {}
    with Pool(2) as Pl:
        for ci in chars:
            its = itemsOf(ci); t0 = time.time()
            jobs = [(ci, sheet, c, its) for kn, sheet, c in cells()]
            res = dict(Pl.map(job, jobs, chunksize=4))
            tot = 0
            for i, k in its:
                tiles = []
                for kn, sheet, c in cells():
                    ox, oy, im = res[(ci, sheet, c)][i]
                    tiles.append(((ci, kn, c, i), (ox, oy, im)))
                tiles.sort(key=lambda kv: -kv[1][2].shape[0])
                W = 1024; x = y = rowh = 0; pos = {}
                for key, (ox, oy, im) in tiles:
                    h, w = im.shape[:2]
                    if x + w > W: x = 0; y += rowh; rowh = 0
                    pos[key] = (x, y, w, h, ox, oy); x += w + 1; rowh = max(rowh, h + 1)
                H = y + rowh
                sheetimg = Image.new('RGBA', (W, H), (0, 0, 0, 0))
                for key, (ox, oy, im) in tiles:
                    sheetimg.paste(Image.fromarray(im, 'RGBA'), pos[key][:2])
                fn = 'wearw/%s_g%d.webp' % (eng.IDS[ci], i)
                sheetimg.save(fn, 'WEBP', quality=80, alpha_quality=90, method=6)
                tot += os.path.getsize(fn)
                meta['%d_%d' % (ci, i)] = {'size': [W, H], 'tiles': {'%d' % B.cellidx(key[1], key[2]): tuple(int(v) for v in p) for key, p in pos.items()}}
            print(eng.IDS[ci], len(its), 'items', tot // 1024, 'KB', round(time.time() - t0), 's', flush=True)
    json.dump(meta, open('wearw/meta_acc_%s.json' % '_'.join(map(str, chars)), 'w'))

if __name__ == '__main__':
    run([int(v) for v in sys.argv[1].split(',')])
