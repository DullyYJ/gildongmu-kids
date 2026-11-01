# 3D 천·가죽·금속 렌더러 — 그림 문장(Art DSL) → 높이 지도(부풀린 입체) → 법선 → 빛·질감. 결과는 RGBA 스프라이트(셀)
# 셀 = 2.2 단위 정사각(원점이 가운데). 앱은 셀을 (2.2*u) 크기로 놓기만 한다.
import math, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

CELL = 192          # 최종 셀 픽셀
SSX = 2             # 작업 해상도 배수
UN = 2.2            # 셀이 덮는 단위 길이

def hexcol(c):
    c = c.lstrip('#')
    r, g, b = int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)
    a = int(c[6:8], 16) if len(c) >= 8 else 255
    return np.array([r, g, b], np.float32) / 255.0, a / 255.0

# ───────────── 그림 문장 풀기 → 도형 목록 ─────────────
def parse(art):
    shapes = []
    for op in art.split(';'):
        t = op.split(' ')
        k = t[0]
        if k in 'oOrRtTpPhHsS' and len(k) == 1:
            ol = k.islower(); kk = k.lower()
            if kk == 'p':
                col = t[1]; n = [float(x) / 100 for x in t[2:]]
                pts = [(n[i], n[i + 1]) for i in range(0, len(n), 2)]
            else:
                col = t[-1]; n = [float(x) / 100 for x in t[1:-1]]
                if kk == 'o':
                    x, y, rx, ry = n
                    pts = [(x + rx * math.cos(a * math.pi / 18), y + ry * math.sin(a * math.pi / 18)) for a in range(36)]
                elif kk == 'r':
                    x, y, w, h, rad = n; rad = min(rad, w / 2, h / 2); pts = []
                    for cx, cy, a0 in ((x + w / 2 - rad, y - h / 2 + rad, -90), (x + w / 2 - rad, y + h / 2 - rad, 0),
                                       (x - w / 2 + rad, y + h / 2 - rad, 90), (x - w / 2 + rad, y - h / 2 + rad, 180)):
                        for j in range(0, 91, 10):
                            a = (a0 + j) * math.pi / 180; pts.append((cx + rad * math.cos(a), cy + rad * math.sin(a)))
                elif kk == 't':
                    pts = [(n[0], n[1]), (n[2], n[3]), (n[4], n[5])]
                elif kk == 'h':
                    x, y, r = n; pts = []
                    for j in range(41):
                        a = j / 40 * 2 * math.pi; hx = 16 * math.sin(a) ** 3
                        hy = -(13 * math.cos(a) - 5 * math.cos(2 * a) - 2 * math.cos(3 * a) - math.cos(4 * a))
                        pts.append((x + hx / 17 * r, y + hy / 17 * r * .95 - r * .1))
                elif kk == 's':
                    x, y, r = n; pts = []
                    for j in range(10):
                        a = (-90 + j * 36) * math.pi / 180; rr = r if j % 2 == 0 else r * .45
                        pts.append((x + rr * math.cos(a), y + rr * math.sin(a)))
            shapes.append(dict(k='fill', pts=pts, col=col, ol=ol, kind=kk))
        elif k == 'l':
            n = [float(v) / 100 for v in t[1:6]]
            shapes.append(dict(k='line', pts=[(n[0], n[1]), (n[2], n[3])], w=n[4], col=t[6]))
        elif k == 'q':
            n = [float(v) / 100 for v in t[1:8]]; pts = []
            for j in range(17):
                u = j / 16
                pts.append(((1 - u) ** 2 * n[0] + 2 * (1 - u) * u * n[2] + u * u * n[4], (1 - u) ** 2 * n[1] + 2 * (1 - u) * u * n[3] + u * u * n[5]))
            shapes.append(dict(k='line', pts=pts, w=n[6], col=t[8]))
        elif k == 'a':
            x, y, r = [float(v) / 100 for v in t[1:4]]; a0, a1 = float(t[4]), float(t[5]); w = float(t[6]) / 100
            if a1 < a0: a1 += 360
            pts = [(x + r * math.cos((a0 + (a1 - a0) * j / 24) * math.pi / 180), y + r * math.sin((a0 + (a1 - a0) * j / 24) * math.pi / 180)) for j in range(25)]
            shapes.append(dict(k='line', pts=pts, w=w, col=t[7]))
        elif k == 'e':
            x, y, rx, ry, w = [float(v) / 100 for v in t[1:6]]
            pts = [(x + rx * math.cos(a * math.pi / 18), y + ry * math.sin(a * math.pi / 18)) for a in range(37)]
            shapes.append(dict(k='line', pts=pts, w=w, col=t[6]))
    return shapes

# ───────────── 재질 ─────────────
M = {  # tex, 질감 세기, 반사 세기, 반짝임, 가장자리 비침(sheen), 주름, 금속
    'jersey':  dict(tex='weave', amp=.55, ks=.05, sh=14, sheen=.28, wr=.55),
    'cotton':  dict(tex='weave', amp=.70, ks=.04, sh=12, sheen=.22, wr=.45),
    'knit':    dict(tex='knit',  amp=1.5,  ks=.03, sh=8,  sheen=.38, wr=.70),
    'felt':    dict(tex='fuzz',  amp=.30,  ks=.02, sh=6,  sheen=.34, wr=.50),
    'fleece':  dict(tex='fuzz',  amp=.55,  ks=.02, sh=6,  sheen=.50, wr=.85),
    'denim':   dict(tex='twill', amp=.8,   ks=.05, sh=14, sheen=.18, wr=.55),
    'leather': dict(tex='grain', amp=.9,   ks=.42, sh=30, sheen=.10, wr=.35),
    'satin':   dict(tex='silk',  amp=.2,   ks=.70, sh=48, sheen=.32, wr=.65),
    'nylon':   dict(tex='weave', amp=.35,  ks=.34, sh=26, sheen=.18, wr=.55),
    'straw':   dict(tex='straw', amp=1.3,  ks=.04, sh=10, sheen=.20, wr=.20),
    'wood':    dict(tex='wood',  amp=.7,   ks=.20, sh=22, sheen=.08, wr=.0),
    'paper':   dict(tex='paper', amp=.35,  ks=.05, sh=10, sheen=.12, wr=.25),
    'gloss':   dict(tex='none',  amp=0,    ks=.95, sh=70, sheen=.10, wr=.0, env=.45),
    'plastic': dict(tex='none',  amp=0,    ks=.60, sh=42, sheen=.10, wr=.0, env=.25),
    'metal':   dict(tex='brush', amp=.3,   ks=1.0, sh=60, sheen=.0,  wr=.0, metal=1),
    'tool':    dict(tex='none',  amp=0,    ks=.7,  sh=48, sheen=.0,  wr=.0, metal=1),
}
NOUN = {}
for n in '야구모자 요리사 모자 선장 모자 반다나 벙거지 티셔츠 줄무늬 티 앞치마 원피스 잠옷 턱받이 운동복 깃발'.split(' '): pass
def _m(mat, names):
    for n in names.split('|'): NOUN[n] = mat
_m('cotton', '야구모자|요리사 모자|선장 모자|반다나|벙거지|앞치마|원피스|깃발')
_m('jersey', '티셔츠|줄무늬 티|잠옷|턱받이|운동복')
_m('knit', '털모자|새싹 모자|목도리|스웨터|판초|목폴라')
_m('felt', '고깔모자|마법사 모자|베레모|버섯 모자|딸기 모자|조끼|턱시도|컵케이크|피자')
_m('fleece', '토끼 귀띠|고양이 귀띠|산타 모자|구름 모자|후드티|가운|날개|망토')
_m('denim', '멜빵바지')
_m('leather', '카우보이 모자|조종사 모자|가방')
_m('satin', '실크햇|꽃 장식|리본|나비넥타이|한복 저고리|넥타이|꽃목걸이|어깨띠|꽃다발|선물상자|월계관|투투 치마')
_m('nylon', '우비|구명조끼|우산|연')
_m('straw', '밀짚모자|삿갓')
_m('wood', '대나무|기타|붓|도토리')
_m('paper', '책|부채')
_m('gloss', '천사 링|아이스크림 모자|풍선|막대사탕|요술봉|아이스크림|뼈다귀|물고기|등불|당근')
_m('plastic', '광부 헬멧|프로펠러 모자|헤드폰|고글|카메라')
_m('metal', '왕관|바이킹 투구|갑옷|메달|방패|트럼펫')
_m('tool', '칼|돋보기|삽|곡괭이|망치')

def noun_of(name):
    return name.split(' ', 1)[1] if ' ' in name else name

# ───────────── 작은 도구 ─────────────
KP = [1.0]
def noise(shape, sigma, seed):
    r = np.random.RandomState(seed)
    sigma = (sigma * KP[0]) if np.isscalar(sigma) else tuple(v * KP[0] for v in sigma)
    n = ndi.gaussian_filter(r.randn(*shape).astype(np.float32), sigma, mode='wrap')
    return n / (n.std() + 1e-6)

def lite_of(c, k=.35):
    return c + (1 - c) * k

def lum(c):
    return float(.299 * c[0] + .587 * c[1] + .114 * c[2])

def sat(c):
    mx, mn = float(c.max()), float(c.min())
    return 0 if mx <= 0 else (mx - mn) / mx

def texture(tex, X, Y, amp, seed, kp=1.0):
    """높이 미세 질감(px 단위 대략 amp) 과 밝기 변조"""
    KP[0] = kp
    H = np.zeros_like(X); B = np.ones_like(X)
    if tex == 'weave':
        p = .034
        a = np.sin(2 * np.pi * X / p); b = np.sin(2 * np.pi * Y / p)
        H = (a * np.sign(np.sin(np.pi * Y / p)) + b * np.sign(np.sin(np.pi * X / p))) * .5 * amp
        B = 1 + .035 * (a * b)
    elif tex == 'knit':
        pw, ph = .060, .050
        u = (X / pw) % 1.0; v = (Y / ph) % 1.0
        vv = (v + .55 * np.abs(2 * u - 1)) % 1.0           # V 모양 코
        H = (np.sin(np.pi * vv) ** 1.2) * amp
        H *= (.75 + .25 * np.cos(2 * np.pi * (u - .5)))
        B = .90 + .16 * (np.sin(np.pi * vv) ** 1.2)
    elif tex == 'twill':
        p = .040
        d = (X + Y) / p
        H = (np.sin(2 * np.pi * d) * .5 + .5) * amp
        n = noise(X.shape, .6, seed)
        B = .93 + .07 * n + .05 * np.sin(2 * np.pi * d)
    elif tex == 'grain':
        n1 = noise(X.shape, 1.5, seed); n2 = noise(X.shape, 4.0, seed + 1)
        c = np.abs(n1) * -1 + 1
        H = (c * .6 + n2 * .2) * amp
        B = .94 + .05 * n2
    elif tex == 'fuzz':
        n = noise(X.shape, .7, seed); n2 = noise(X.shape, 2.2, seed + 3)
        H = (n * .5 + n2 * .5) * amp
        B = .93 + .045 * n + .03 * n2
    elif tex == 'silk':
        n = noise(X.shape, 6, seed)
        H = n * amp
        B = 1 + .02 * n
    elif tex == 'straw':
        p = .052
        a = np.sin(2 * np.pi * (X + .5 * np.sign(np.sin(np.pi * Y / (p * 1.2))) * p * .5) / p)
        H = (a * .5 + .5) * amp
        B = .90 + .10 * (a * .5 + .5) + .04 * noise(X.shape, 1.2, seed)
    elif tex == 'wood':
        n = noise(X.shape, (1.2, 8.0), seed) if False else ndi.gaussian_filter(np.random.RandomState(seed).randn(*X.shape).astype(np.float32), (7 * kp, 1.0 * kp))
        n = n / (n.std() + 1e-6)
        H = n * amp * .5
        B = .90 + .07 * n
    elif tex == 'paper':
        n = noise(X.shape, .9, seed)
        H = n * amp; B = 1 + .02 * n
    elif tex == 'brush':
        n = ndi.gaussian_filter(np.random.RandomState(seed).randn(*X.shape).astype(np.float32), (.8 * kp, 6 * kp))
        n = n / (n.std() + 1e-6)
        H = n * amp * .4; B = 1 + .035 * n
    return H.astype(np.float32), B.astype(np.float32)

# ───────────── 본 렌더 ─────────────
def render(art, noun, slot, seed=0, cell=CELL, ss=SSX):
    mat = NOUN.get(noun, 'cotton')
    W = cell * ss
    shapes = parse(art)
    x0 = y0 = 1e9; x1 = y1 = -1e9
    for sp in shapes:
        hw = sp['w'] / 2 if sp['k'] == 'line' else 0
        for x, y in sp['pts']:
            x0 = min(x0, x - hw); x1 = max(x1, x + hw); y0 = min(y0, y - hw); y1 = max(y1, y + hw)
    fcx, fcy = (x0 + x1) / 2, (y0 + y1) / 2
    side = max(x1 - x0, y1 - y0) * 1.10 + .07
    side = max(side, .30)
    ppu = W / side                                 # 단위 → 작업 픽셀
    kp = ppu / 174.5
    ox = oy = W / 2
    xs = (np.arange(W, dtype=np.float32) + .5 - W / 2) / ppu
    X, Y = np.meshgrid(xs + fcx, xs + fcy)

    alb = np.zeros((W, W, 3), np.float32)
    cov = np.zeros((W, W), np.float32)
    Hh = np.zeros((W, W), np.float32)
    mid = np.zeros((W, W), np.int8)              # 도형별 재질(0 천, 1 금속, 2 반짝이)
    smask = []
    big = 3                                     # 마스크를 그릴 때 배수(안티앨리어싱)
    for si, sp in enumerate(shapes):
        im = Image.new('L', (W * big, W * big), 0); d = ImageDraw.Draw(im)
        pts = [(((x - fcx) * ppu + ox) * big, ((y - fcy) * ppu + oy) * big) for x, y in sp['pts']]
        col, a0 = hexcol(sp['col'])
        if sp['k'] == 'fill':
            d.polygon(pts, fill=255)
        else:
            wpx = max(1.2, sp['w'] * ppu * big)
            d.line(pts, fill=255, width=int(round(wpx)), joint='curve')
            r = wpx / 2
            for p in (pts[0], pts[-1]): d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=255)
        m = np.asarray(im.resize((W, W), Image.BOX), np.float32) / 255.0
        area = float((m > .5).sum()) / (ppu * ppu)
        if area < 1e-5: continue
        # 2D 하이라이트(밝은 덧칠)는 빼고 3D 빛으로 맡긴다
        if sp['k'] == 'fill' and not sp.get('ol', False):
            mm = m > .5
            under = alb[mm].mean(axis=0) if mm.any() and cov[mm].mean() > .5 else None
            if under is not None and np.abs(col - lite_of(under)).max() < .06 and lum(col) > lum(under): continue
        is_line = sp['k'] == 'line'
        mb = m > .5
        dist = ndi.distance_transform_edt(mb).astype(np.float32) / ppu          # 단위
        inr = float(dist.max()) if mb.any() else 0
        small = (area < .028) and not is_line
        # 도형 재질
        mt = 0
        if mat == 'tool':
            mt = 1 if (sat(col) < .22 and lum(col) > .42) else 0
        elif mat in ('metal', 'gloss', 'plastic'):
            mt = 0
        if small and mat in ('cotton', 'jersey', 'knit', 'felt', 'fleece', 'denim', 'leather', 'nylon', 'paper', 'straw'): mt = 2   # 단추·자수·에나멜 느낌
        rho = min(.075, inr * .95) if not is_line else inr * .98
        rho = max(rho, 1e-3)
        t = np.clip(dist / rho, 0, 1)
        prof = np.sqrt(1 - (1 - t) ** 2)
        hs = 1.0 if not is_line else 1.25
        Hh = np.where(mb, Hh + prof * rho * hs, Hh)
        # 색 겹치기
        al = (m * a0)[..., None]
        alb = alb * (1 - al) + col[None, None, :] * al
        cov = cov + (1 - cov) * m * a0
        mid = np.where(mb, mt, mid)
        smask.append((mb, sp.get('ol', False) and not is_line, dist))
    if cov.max() <= 0:
        return np.zeros((cell, cell, 4), np.uint8), (0, 0, 1)
    union = cov > .5
    dU = ndi.distance_transform_edt(union).astype(np.float32) / ppu
    inrU = float(dU.max())
    # 큰 곡면(몸/머리에 두른 둥근 맛)
    amp_dome = {'hat': .65, 'cloth': .75, 'item': .40}[slot]
    Rm = max(inrU, .05)
    tU = np.clip(dU / Rm, 0, 1)
    Hh = Hh + amp_dome * Rm * (1 - (1 - tU) ** 2) * .9
    # 부드러운 주름(천류)
    prm = M.get(mat, M['cotton'])
    if prm['wr'] > 0 and mat != 'tool':
        w1 = noise((W, W), .10 * ppu, seed + 11); w2 = noise((W, W), .045 * ppu, seed + 12)
        Hh = Hh + (w1 * .010 + w2 * .004) * prm['wr'] * (tU > 0) * np.clip(dU / .08, 0, 1)
    # 미세 질감
    texH = np.zeros_like(Hh); texB = np.ones_like(Hh)
    for mt_id in (0, 1):
        mk = (mid == mt_id)
        if not mk.any(): continue
        tex = prm['tex'] if mt_id == 0 else 'brush'
        if mat == 'tool' and mt_id == 0: tex = 'wood'
        a = prm['amp'] if mt_id == 0 else .3
        h, b = texture(tex, X, Y, a, seed + 20 + mt_id, kp)
        texH = np.where(mk, h, texH); texB = np.where(mk, b, texB)
    px = 1.0 / ppu
    Hs = ndi.gaussian_filter(Hh, .0075 * ppu)
    Hn = Hs + texH * (px * 1.0) * 2.0
    gy, gx = np.gradient(Hn * ppu)                       # 높이를 픽셀 단위로
    nx, ny, nz = -gx, -gy, np.ones_like(gx)
    nl = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny, nz = nx / nl, ny / nl, nz / nl
    # 빛(왼쪽 위 앞에서)
    L1 = np.array([-.48, -.62, .62], np.float32); L1 /= np.linalg.norm(L1)
    L2 = np.array([.62, .45, .64], np.float32); L2 /= np.linalg.norm(L2)
    wrap = .38
    d1 = np.clip((nx * L1[0] + ny * L1[1] + nz * L1[2] + wrap) / (1 + wrap), 0, 1)
    d2 = np.clip(nx * L2[0] + ny * L2[1] + nz * L2[2], 0, 1)
    # 막힘(AO): 둘러싼 높이보다 낮은 곳을 어둡게
    cav = np.clip((ndi.gaussian_filter(Hh, .057 * ppu) - Hh) / .06, 0, 1)
    ao = 1 - .42 * cav
    # 가장자리 이음선(바느질) 어둡게
    seam = np.ones_like(Hh)
    for mb, ol, dist in smask:
        if ol:
            seam *= 1 - .22 * np.exp(-dist / .012) * mb
    base = alb * texB[..., None] * seam[..., None]
    out = np.zeros_like(base)
    # 확산
    light = (.40 + .78 * d1 + .12 * d2)
    cool = np.array([1.0, 1.0, 1.02], np.float32)
    out = base * (light * ao)[..., None]
    # 반사
    vx = nx * 0 + 0; nzv = nz
    hx, hy, hz = L1[0], L1[1], L1[2] + 1
    hn = math.sqrt(hx * hx + hy * hy + hz * hz); hx, hy, hz = hx / hn, hy / hn, hz / hn
    ndh = np.clip(nx * hx + ny * hy + nz * hz, 0, 1)
    ks = np.full_like(Hh, prm['ks']); sh = np.full_like(Hh, float(prm['sh']))
    ks = np.where(mid == 2, .85, ks); sh = np.where(mid == 2, 60., sh)
    ks = np.where(mid == 1, 1.0, ks); sh = np.where(mid == 1, 55., sh)
    spec = ks * np.power(ndh, sh)
    metal = (prm.get('metal') and mat != 'tool') or mat == 'tool'
    metalmask = ((mid == 1) | (mat == 'metal')).astype(np.float32)
    if mat != 'tool' and prm.get('metal'): metalmask[:] = 1
    # 환경 반사(금속·유광)
    envk = np.where(metalmask > 0, 1.0, prm.get('env', 0.0)).astype(np.float32)
    envk = np.where(mid == 2, np.maximum(envk, .35), envk)
    refl_y = -ny                                         # 위쪽을 보면 하늘색, 아래는 땅색
    env = .55 + .55 * np.clip(refl_y * .7 + nx * -.25 + .15, -1, 1) ** 1.0
    env = np.clip(env, .12, 1.15)
    bright = alb.mean(axis=2, keepdims=True)
    mcol = np.where(metalmask[..., None] > 0, base * .55 + .45 * np.array([1, 1, 1], np.float32) * .92, base)
    out = np.where(metalmask[..., None] > 0, mcol * (.30 + .85 * env[..., None]) * ao[..., None], out)
    out = out * (1 - envk[..., None] * (1 - metalmask[..., None]) * .0) + (envk * (1 - metalmask) * (env - .55) * .55)[..., None] * (base * .6 + .4)
    out = out + (spec * (.65 + .35 * (1 - bright[..., 0])))[..., None] * np.where(metalmask[..., None] > 0, base * .4 + .6, np.array([1, 1, 1.0], np.float32))
    # 옷감 가장자리 비침(sheen)
    rim = np.power(np.clip(1 - nz, 0, 1), 2.0)
    out = out + (prm['sheen'] * rim * (1 - metalmask))[..., None] * (lite_of_arr(base, .55)) * .55
    # 하이라이트 볼록 부분의 부드러운 밝기
    out = np.clip(out, 0, 1)
    # 알파 + 바닥 그림자
    A = np.clip(cov, 0, 1)
    sh_off = (int(.018 * ppu), int(.030 * ppu))
    shadow = ndi.shift(A, (sh_off[1], sh_off[0]), order=1)
    shadow = ndi.gaussian_filter(shadow, .022 * ppu) * .34
    # 경계 안쪽 말려 들어가는 가장자리 어둡게(몸을 감싼 느낌)
    edge = np.clip(1 - dU / .045, 0, 1) * (cov > .5)
    out = out * (1 - .10 * edge[..., None])
    rgb = out; a_out = A + (1 - A) * shadow
    # 그림자는 검정에 가깝게
    col_out = np.where(a_out[..., None] > 1e-4, (rgb * A[..., None]) / np.maximum(a_out[..., None], 1e-4), 0)
    img = np.concatenate([col_out, a_out[..., None]], axis=2)
    img = Image.fromarray((np.clip(img, 0, 1) * 255 + .5).astype(np.uint8), 'RGBA')
    if slot == 'cloth': img = wrap_cyl(img, W, ppu, W / 2 - fcx * ppu)
    return np.asarray(img.resize((cell, cell), Image.LANCZOS)), (fcx, fcy, side)

def lite_of_arr(c, k):
    return c + (1 - c) * k

def wrap_cyl(img, W, ppu, ocol):
    """옷 : 몸통(원통)에 두른 것처럼 가장자리를 좁힌다"""
    a = np.asarray(img).astype(np.float32)
    alpha = a[..., 3]
    cols = np.where(alpha.max(axis=0) > 40)[0]
    if len(cols) == 0: return img
    half = max(abs(cols.min() - ocol), abs(cols.max() - ocol)) / ppu          # 단위
    R = max(half * 1.22, .30)
    xs = (np.arange(W) + .5 - ocol) / ppu
    # 목적지 x 에서 원본 s = R*asin(x/R)
    sx = np.where(np.abs(xs) < R * .999, R * np.arcsin(np.clip(xs / R, -.999, .999)), 99.0)
    src = sx * ppu + ocol - .5
    yy = np.arange(W, dtype=np.float32)
    gx, gy = np.meshgrid(src.astype(np.float32), yy)
    out = np.zeros_like(a)
    for ch in range(4):
        out[..., ch] = ndi.map_coordinates(a[..., ch], [gy, gx], order=1, cval=0.0)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'RGBA')

if __name__ == '__main__':
    import json
    art = sys.argv[1]; noun = sys.argv[2]; slot = sys.argv[3]; out = sys.argv[4]
    Image.fromarray(render(art, noun, slot)[0]).save(out)
