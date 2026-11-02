# p-kids63: 모든 친구의 나비넥타이 · 날개(어색한 장신구)를 잘 입혀지는 옷으로 바꾼다. (p-kids61 에서 뽀푸 · 둘숑에 쓴 같은 방식)
# 같은 자리(번호)에 도감 틀을 새로 골라 3D 그림을 다시 그려 시트에 붙이고 Wardrobe.java 의 이름 · 그림 문장 · 자리(WM) · 옷 줄 표(SXS/WBS/WRAPS)를 고친다.
import sys, re, math, json
sys.path.insert(0, 'k/tools/wardrobe')
import numpy as np, catalog, fab3d, art
from PIL import Image
JP = 'k/app/src/main/java/com/dullyyj/kids/Wardrobe.java'
SL = ('hat', 'cloth', 'item'); NS = 32
GARM = ('망토','줄무늬 티','티셔츠','목폴라','잠옷','판초','조끼','스웨터','앞치마','후드티','갑옷','멜빵바지','우비','턱받이','운동복','구명조끼','원피스','투투 치마','한복 저고리','가운','턱시도')
# (친구, 칸종류 0 모자 · 1 옷, 번호, 도감 틀 번호)
REPL = [(0, 1, 2, 9), (1, 1, 6, 13), (1, 1, 9, 26), (2, 1, 6, 13), (2, 1, 15, 26), (3, 1, 1, 26), (3, 1, 11, 15), (4, 1, 0, 9), (4, 1, 18, 15), (5, 1, 4, 9), (6, 1, 3, 13), (6, 1, 19, 26), (7, 1, 4, 13)]
cat = catalog.build(); IDS = catalog.IDS
allart = {a for ch in cat for s in cat[ch] for n, a in cat[ch][s]}
J = open(JP, encoding='utf-8').read()
def ch_(v): return chr(0x100 + int(v))
def cw_(v): return chr(0x8000 + int(round(v * 1000)))
atl = {}
for ci, si, i, tm in REPL:
    ch = IDS[ci]; sl = SL[si]
    old = cat[ch][sl][i]; adj = old[0].split(' ')[0]
    off = 0 if sl == 'hat' else 4
    a_, c1, c2, c3 = catalog.PAL[ch][(i + ci * 3 + off) % 10]; assert a_ == adj
    noun, fn = catalog.LISTS[sl][tm]
    newart = fn(c1, c2, c3, (i + ci) % 6); name = adj + ' ' + noun
    assert newart not in allart; allart.add(newart)
    print(ch, sl, i, old[0], '->', name)
    arr, (fcx, fcy, side) = fab3d.render(newart, fab3d.noun_of(name), sl, seed=ci * 100 + si * 20 + i)
    shapes = fab3d.parse(newart); y0 = 1e9; y1 = -1e9; x0 = 1e9; x1 = -1e9
    for sp in shapes:
        hw = sp['w'] / 2 if sp['k'] == 'line' else 0
        for x, y in sp['pts']: y0 = min(y0, y - hw); y1 = max(y1, y + hw); x0 = min(x0, x - hw); x1 = max(x1, x + hw)
    if ch not in atl: atl[ch] = Image.open('k/app/src/main/assets/wear/%s.webp' % ch).convert('RGBA')
    q = si * 20 + i; ox = (q % 8) * 192; oy = (q // 8) * 192
    atl[ch].paste(Image.new('RGBA', (192, 192), (0, 0, 0, 0)), (ox, oy)); atl[ch].paste(Image.fromarray(arr, 'RGBA'), (ox, oy))
    # 이름
    k = ci * 3 + si
    m = re.search(r'(        N\[%d\] = new String\[\]\{)(.*?)(\};)' % k, J)
    names = re.findall(r'"([^"]*)"', m.group(2)); names[i] = name
    J = J[:m.start()] + m.group(1) + ", ".join('"%s"' % n for n in names) + m.group(3) + J[m.end():]
    # 그림 문장
    m = re.search(r'        A\[%d\] = new String\[\]\{\n' % k, J)
    lines = J[m.end():].split('\n'); lines[i] = '            "%s",' % newart
    J = J[:m.end()] + '\n'.join(lines)
    # WM (자리)
    m = re.search(r'private static final float\[\]\[\] WM = \{\n(.*?)\n    \};', J, re.S)
    rows = m.group(1).split('\n'); nums = re.findall(r'-?[\d.]+(?:E-?\d+)?(?=f)', rows[ci])
    nums = [float(v) for v in nums]; assert len(nums) == 180
    nums[q * 3:q * 3 + 3] = [round(fcx, 4), round(fcy, 4), round(side, 4)]
    rows[ci] = '        {' + ', '.join('%sf' % repr(v) for v in nums) + '},'
    J = J[:m.start(1)] + '\n'.join(rows) + J[m.end(1):]
    # 옷 줄 표
    if si == 1:
        A = np.asarray(atl[ch])[..., 3]; cell = A[(q // 8) * 192:(q // 8) * 192 + 192, (q % 8) * 192:(q % 8) * 192 + 192] > 120
        g = noun in GARM
        Ls = np.full(192, -1); Rs = np.full(192, -1)
        for r in range(192):
            c = np.where(cell[r])[0]
            if len(c): Ls[r] = c.min(); Rs[r] = c.max() + 1
        sx = ''; wb = ''
        if not g: sx = ch_(0) * (NS * 2); wb = cw_(0) * 3
        else:
            for kk in range(NS):
                sa = 96 + 192 * (y0 + (y1 - y0) * kk / NS - fcy) / side; sb = 96 + 192 * (y0 + (y1 - y0) * (kk + 1) / NS - fcy) / side
                a = max(int(sa), 0); b = min(int(math.ceil(sb)), 192)
                ls = [Ls[r] for r in range(a, b) if Ls[r] >= 0]; rs = [Rs[r] for r in range(a, b) if Rs[r] >= 0]
                sx += (ch_(min(ls)) + ch_(max(rs))) if ls else ch_(0) + ch_(0)
            a = max(int(96 + 192 * (y0 - fcy) / side), 0); b = min(int(96 + 192 * (y1 - fcy) / side), 192)
            wd = [Rs[r] - Ls[r] for r in range(a, b) if Ls[r] >= 0]
            nat = (float(np.median(wd)) * side / 192) if wd else (x1 - x0)
            wb = cw_(y0) + cw_(y1) + cw_(nat)
        for nm_, per, val in (('SXS', NS * 2, sx), ('WBS', 3, wb)):
            m = re.search(r'private static final String\[\] %s = \{\n(.*?)\};' % nm_, J, re.S)
            body = m.group(1); strs = re.findall(r'"([^"]*)"', body)
            s = strs[ci]; s = s[:i * per] + val + s[(i + 1) * per:]; strs[ci] = s
            J = J[:m.start(1)] + ',\n'.join('        "%s"' % t for t in strs) + J[m.end(1):]
        m = re.search(r'(private static final String\[\] WRAPS = \{)(.*?)(\};)', J, re.S)
        wr = re.findall(r'"([01]{20})"', m.group(2)); w = wr[ci]; wr[ci] = w[:i] + ('1' if g else '0') + w[i + 1:]
        J = J[:m.start(2)] + ', '.join('"%s"' % t for t in wr) + J[m.end(2):]
for ch, im in atl.items():
    im.save('u63/a/%s.webp' % ch, 'WEBP', quality=88, alpha_quality=90, method=4)
    im.save('k/app/src/main/assets/wear/%s.webp' % ch, 'WEBP', quality=88, alpha_quality=90, method=4)
open(JP, 'w', encoding='utf-8').write(J)
print('ok')
