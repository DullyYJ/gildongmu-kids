"""Wardrobe.java 에 '몸에 입혀 구운 옷' 표(WTS)와 wornTile() 을 끼워 넣는다(여러 번 돌려도 같은 결과).
쓰는 법: python3 gen_worn.py <Wardrobe.java> <bake.py 가 만든 wearw 폴더>"""
import sys, json, glob, re
src, d = sys.argv[1], sys.argv[2]
meta = {}
for f in glob.glob(d + '/meta_*.json'): meta.update(json.load(open(f)))
def ch_(v): return chr(0x100 + int(v))
rows = []
for ci in range(8):
    st = ''
    for i in range(40):
        t = meta.get('%d_%d' % (ci, i), {}).get('tiles', {})
        for c in range(40):
            v = t.get(str(c))
            st += ''.join(ch_(x) for x in (v if v else (0, 0, 0, 0, 0, 0)))
    rows.append(st)
bacc = []
bhat = [''.join('1' if meta.get('%d_%d' % (ci, 20 + i), {}).get('tiles') else '0' for i in range(20)) for ci in range(8)]
J0 = open(src, encoding='utf-8').read()
wr = re.findall(r'"([01]{20})"', re.search(r'WRAPS = \{(.*?)\};', J0, re.S).group(1))
for ci in range(8):
    bacc.append(''.join('1' if (wr[ci][i] == '0' and meta.get('%d_%d' % (ci, i), {}).get('tiles')) else '0' for i in range(20)))
body = '''    // <worn>
    // 몸에 입혀 구운 옷(assets/wear/<친구>_g<옷 번호>.webp): 옷 한 벌마다 칸(걷기 16 · 자세 8 · 동작 16 = 40칸)별로 한 장씩 — 몸 윤곽대로 잘리고 몸의 빛 · 둥근 면 · 닿는 그림자가 들어 있다.
    // 칸마다 {시트 x, y, 너비, 높이, 칸 안 왼쪽 위 x, y} (칸 256 기준 1:1 픽셀). 너비 0 = 없음(두르지 않는 옷 · 빈 칸).
    private static final String[] WTS = {
%s};
    // 두르지는 않지만 몸에 맞춰 구운 옷(나비넥타이 · 넥타이 · 목도리 · 메달 · 어깨띠 · 꽃목걸이 · 날개): 친구 × 옷 20개
    private static final String[] BACC = {
%s};
    // 머리에 맞춰 구운 머리띠(개 친구 둘): 조각은 옷 번호 20 + 모자 번호 자리에 있다. 두덩은 안전모 없는 시트에 모자를 얹는다(p-kids64)
    private static final String[] BHAT = {
%s};

    /** 구운 조각으로 그리는 옷인지(몸에 두르는 옷 + 몸에 맞춰 구운 장신구 옷). */
    public static boolean baked(int ci, int slot, int i) {
        return wraps(ci, slot, i) || (slot == 0 && ci >= 0 && ci < 8 && i >= 0 && i < PER && BHAT[ci].charAt(i) == '1') || (slot == 1 && ci >= 0 && ci < 8 && i >= 0 && i < PER && BACC[ci].charAt(i) == '1');
    }

    /**
     * 소지품은 손에 쥐지 않고 친구 옆(앞쪽)에서 둥실둥실 떠다닌다. out = {가운데 x, 가운데 y, 크기 u, 기울기(라디안, 시계 +)} — 칸 256 기준.
     * x · y · u 는 place() 의 소지품과 같은 꼴이라 strips() 에 그대로 넘긴다. tMs = 시계(ms): 위아래 · 좌우 · 기울기가 서로 다른 박자로 천천히 흔들리고 친구마다 박자가 어긋난다.
     */
    public static boolean floatAt(int ci, int sheet, int cell, long tMs, float[] out) {
        if (ci < 0 || ci >= 8 || sheet < 0 || sheet > 2 || cell < 0) return false;
        int[] m = MET[ci][sheet];
        int b = cell * 5;
        if (b + 4 >= m.length || m[b + 2] <= 0) return false;
        float bw = m[b + 2], bh = m[b + 3], cx = m[b + 4], ty = m[b + 1];
        float u = KK[ci][2][2] * bw * 1.15f;
        double ph = ci * 1.7, tt = (tMs %% 1000000L) / 1000.0;
        double bob = Math.sin(tt / 2.4 * 2 * Math.PI + ph), sw = Math.sin(tt / 3.1 * 2 * Math.PI + ph * 1.3), rt = Math.sin(tt / 2.7 * 2 * Math.PI + ph * 0.7);
        out[0] = cx + 0.5f * bw + 0.62f * u + (float) (sw * 0.03 * bw);
        out[1] = ty + 0.40f * bh + (float) (bob * 0.06 * bh);
        out[2] = u;
        out[3] = (float) (rt * 0.12);
        return true;
    }

    /** 몸에 입혀 구운 옷 조각: out = {시트 x, y, 너비, 높이, 칸 안 x, y}. 없으면 false(→ 줄 단위 · 한 장으로 그린다). */
    public static boolean wornTile(int ci, int sheet, int cell, int i, int[] out) {
        if (ci < 0 || ci >= 8 || sheet < 0 || sheet > 2 || cell < 0 || cell >= (sheet == 1 ? 8 : 16) || i < 0 || i >= 2 * PER) return false;
        int b = (i * 40 + (sheet == 0 ? cell : sheet == 1 ? 16 + cell : 24 + cell)) * 6;
        String s = WTS[ci];
        if (s.charAt(b + 2) == 0x100) return false;
        for (int k = 0; k < 6; k++) out[k] = s.charAt(b + k) - 0x100;
        return true;
    }
    // </worn>
''' % (",\n".join('        "' + r + '"' for r in rows), ",\n".join('        "' + r + '"' for r in bacc), ",\n".join('        "' + r + '"' for r in bhat))
J = open(src, encoding='utf-8').read()
if '// <worn>' in J:
    J = re.sub(r'    // <worn>.*?    // </worn>\n', lambda m: body, J, flags=re.S)
else:
    i = J.index('    /**\n     * 한 칸에서 그림을 놓을')
    J = J[:i] + body + '\n' + J[i:]
open(src, 'w', encoding='utf-8').write(J)
print('ok', len(J) // 1024, 'KB')
