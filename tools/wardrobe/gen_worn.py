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
    for i in range(20):
        t = meta.get('%d_%d' % (ci, i), {}).get('tiles', {})
        for c in range(40):
            v = t.get(str(c))
            st += ''.join(ch_(x) for x in (v if v else (0, 0, 0, 0, 0, 0)))
    rows.append(st)
body = '''    // <worn>
    // 몸에 입혀 구운 옷(assets/wear/<친구>_g<옷 번호>.webp): 옷 한 벌마다 칸(걷기 16 · 자세 8 · 동작 16 = 40칸)별로 한 장씩 — 몸 윤곽대로 잘리고 몸의 빛 · 둥근 면 · 닿는 그림자가 들어 있다.
    // 칸마다 {시트 x, y, 너비, 높이, 칸 안 왼쪽 위 x, y} (칸 256 기준 1:1 픽셀). 너비 0 = 없음(두르지 않는 옷 · 빈 칸).
    private static final String[] WTS = {
%s};

    /** 몸에 입혀 구운 옷 조각: out = {시트 x, y, 너비, 높이, 칸 안 x, y}. 없으면 false(→ 줄 단위 · 한 장으로 그린다). */
    public static boolean wornTile(int ci, int sheet, int cell, int i, int[] out) {
        if (ci < 0 || ci >= 8 || sheet < 0 || sheet > 2 || cell < 0 || cell >= (sheet == 1 ? 8 : 16) || i < 0 || i >= PER) return false;
        int b = (i * 40 + (sheet == 0 ? cell : sheet == 1 ? 16 + cell : 24 + cell)) * 6;
        String s = WTS[ci];
        if (s.charAt(b + 2) == 0x100) return false;
        for (int k = 0; k < 6; k++) out[k] = s.charAt(b + k) - 0x100;
        return true;
    }
    // </worn>
''' % ",\n".join('        "' + r + '"' for r in rows)
J = open(src, encoding='utf-8').read()
if '// <worn>' in J:
    J = re.sub(r'    // <worn>.*?    // </worn>\n', lambda m: body, J, flags=re.S)
else:
    i = J.index('    /**\n     * 한 칸에서 그림을 놓을')
    J = J[:i] + body + '\n' + J[i:]
open(src, 'w', encoding='utf-8').write(J)
print('ok', len(J) // 1024, 'KB')
