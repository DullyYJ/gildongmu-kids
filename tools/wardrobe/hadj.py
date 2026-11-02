# p-kids60: 모자 · 머리 장신구를 친구마다 · 모자마다 머리에 맞춘다. 머리 마스크(3D 부위 마스크)에서 머리 폭 · 높이 · 가운데를 재고,
# 모자 종류별로 (폭 비율, 맞춤 위치)를 정해 엔진 기본 자리(place)에서 얼마나 키우고(ds) 옮길지(dx, dy: u 단위)를 구해 HADJ[친구][모자] = {ds, dx, dy} 로 낸다.
import sys, json, os, math
sys.path.insert(0, '.'); sys.path.insert(0, 'k/tools/wardrobe')
import numpy as np, eng
from PIL import Image
import bake as B
N = 512
def cells():
    for kn, sheet, nc in B.KINDS:
        for c in range(nc):
            if sheet == 1 and c == 1: continue
            yield sheet, c

def headbox(ci):
    fn = 'hbox_%d.json' % ci
    if os.path.exists(fn): return {tuple(map(int, k.split(':'))): v for k, v in json.load(open(fn)).items()}
    import bake_acc as A
    out = {}
    for sh, c in cells():
        Bm = np.asarray(eng.sheetcell(ci, sh, c).resize((N, N), Image.LANCZOS)).astype(np.float32) / 255
        if Bm[..., 3].sum() < 500: continue
        g = A.geo(ci, sh, c, Bm[..., 3])
        if g is None or not g.get('head'): continue
        out['%d:%d' % (sh, c)] = [g['hxm'] / 2, g['hy0'] / 2, g['hy1'] / 2, g['hw'] / 2, g['hh'] / 2]
    json.dump(out, open(fn, 'w'))
    return {tuple(map(int, k.split(':'))): v for k, v in out.items()}

# 종류: (이름 조각, 폭 비율(머리 폭 대비 모자 그림 내용 폭), 맞춤 'bot'(그림 아랫선) | 'top'(윗선) | 'mid', 위치(머리 높이 비율, 머리 꼭대기에서 아래로), 가로 치우침(머리 폭 비율))
TYPES = [
    ('헤드폰', 1.02, 'top', -0.06, 0.0),
    ('고글', 0.78, 'mid', 0.36, 0.0),
    ('천사 링', 0.62, 'bot', 0.0, 0.0),
    ('월계관', 0.98, 'bot', 0.26, 0.0),
    ('귀띠', 0.86, 'bot', 0.22, 0.0),
    ('반다나', 1.0, 'mid', 0.26, 0.0),
    ('리본', 0.58, 'bot', 0.14, 0.0),
    ('꽃 장식', 0.50, 'bot', 0.16, 0.0),
    ('새싹', 0.62, 'bot', 0.14, 0.0),
    ('프로펠러', 0.84, 'bot', 0.14, 0.0),
    ('왕관', 0.84, 'bot', 0.14, 0.0),
    ('고깔', 0.60, 'bot', 0.12, 0.0),
    ('마법사', 0.98, 'bot', 0.16, 0.0),
    ('밀짚', 1.38, 'bot', 0.18, 0.0),
    ('카우보이', 1.32, 'bot', 0.18, 0.0),
    ('삿갓', 1.30, 'bot', 0.18, 0.0),
    ('벙거지', 1.16, 'bot', 0.18, 0.0),
    ('실크햇', 0.96, 'bot', 0.16, 0.0),
    ('요리사', 0.86, 'bot', 0.16, 0.0),
    ('산타', 0.98, 'bot', 0.20, 0.0),
    ('털모자', 0.98, 'bot', 0.22, 0.0),
    ('베레', 1.02, 'bot', 0.18, 0.0),
    ('야구', 0.98, 'bot', 0.20, 0.0),
    ('광부', 1.02, 'bot', 0.22, 0.0),
    ('바이킹', 1.06, 'bot', 0.22, 0.0),
    ('버섯', 1.14, 'bot', 0.20, 0.0),
    ('딸기', 1.00, 'bot', 0.20, 0.0),
    ('구름', 1.04, 'bot', 0.20, 0.0),
    ('아이스크림', 0.62, 'bot', 0.14, 0.0),
    ('선장', 1.02, 'bot', 0.18, 0.0),
    ('조종사', 1.06, 'bot', 0.22, 0.0),
]
# 친구마다: 머리 상자 보정 {폭 배율, 높이 배율, 가로 치우침(머리 폭 비율), 모자 폭 배율}. 개 친구는 머리털 덩어리 전체가 '머리'로 잡혀 얼굴 크기만 쓴다.
FR = {0: dict(hw=0.62, hh=0.80), 1: dict(hw=0.62, hh=0.80), 2: dict(hw=0.90, hh=1.0)}
OV = {}        # OV[(친구, 모자번호)] = (폭 비율, 맞춤, 위치, 치우침) 개별 덮어쓰기
if os.path.exists('hadj_ov.json'):
    for k, v in json.load(open('hadj_ov.json')).items(): OV[tuple(map(int, k.split(':')))] = v

def typeof(name):
    for t in TYPES:
        if t[0] in name: return t[1:]
    return (1.0, 'bot', 0.18, 0.0)

def hatbox(ci, i):
    q = i; ox = (q % 8) * 192; oy = (q // 8) * 192
    a = np.asarray(eng.atlas(ci).crop((ox, oy, ox + 192, oy + 192)))[..., 3] > 60
    rr = np.where(a.any(1))[0]; cc = np.where(a.any(0))[0]
    return rr.min(), rr.max() + 1, cc.min(), cc.max() + 1

def solve(ci, i):
    name = eng.N[ci * 3][i]
    rw, mode, fr, xo = OV.get((ci, i), typeof(name))
    r0, r1, c0, c1 = hatbox(ci, i)
    b0 = i * 3; fcx, fcy, side = eng.WM[ci][b0:b0 + 3]
    hb = headbox(ci); f = FR.get(ci, {})
    acc = []
    for (sh, c), (hxm, hy0, hy1, hw, hh) in hb.items():
        pl = eng.place(ci, sh, c, 0)
        if not pl: continue
        x, y, u = pl
        hwe = hw * f.get('hw', 1.0); hhe = hh * f.get('hh', 1.0)
        cw = (c1 - c0) / 192.0 * side * u
        ds = rw * hwe / cw
        sw = side * u * ds
        tcx = hxm + xo * hwe
        cxs = tcx - ((c0 + c1) / 2.0 / 192.0 - 0.5) * sw
        yy = hy0 + fr * hhe
        if mode == 'bot': cys = yy - (r1 / 192.0 - 0.5) * sw
        elif mode == 'top': cys = yy - (r0 / 192.0 - 0.5) * sw
        else: cys = yy - ((r0 + r1) / 2.0 / 192.0 - 0.5) * sw
        acc.append((math.log(ds), (cxs - x) / u - fcx, (cys - y) / u - fcy))
    a = np.array(acc)
    return (round(float(math.exp(np.median(a[:, 0]))), 3), round(float(np.median(a[:, 1])), 3), round(float(np.median(a[:, 2])), 3))

def table():
    T = {}
    for ci in range(8):
        for i in range(20):
            T[(ci, i)] = (1.0, 0.0, 0.0) if ci == 5 else solve(ci, i)
    return T

def gen_java(T, src):
    import re
    rows = []
    for ci in range(8):
        rows.append('        {' + ', '.join('%sf, %sf, %sf' % T[(ci, i)] for i in range(20)) + '}')
    body = '    // <hadj>\n    /** 모자 · 머리 장신구를 친구 · 모자마다 머리에 맞춘 보정: 모자마다 {크기 배율, 가로(u 단위), 세로(u 단위)} (두덩은 구운 모자라 쓰지 않음). */\n    private static final float[][] HADJ = {\n' + ',\n'.join(rows) + '\n    };\n    // </hadj>\n'
    J = open(src, encoding='utf-8').read()
    if '// <hadj>' in J: J = re.sub(r'    // <hadj>.*?    // </hadj>\n', lambda m: body, J, flags=re.S)
    else:
        k = J.index('    // <worn>'); J = J[:k] + body + J[k:]
    open(src, 'w', encoding='utf-8').write(J)

if __name__ == '__main__':
    T = table()
    json.dump({'%d:%d' % k: v for k, v in T.items()}, open('hadj.json', 'w'))
    print('ok')
