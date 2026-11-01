import json, catalog, place as P, importlib
import kconst
cat=catalog.build(); M=json.load(open('/tmp/wg/metrics.json'))
out=[]
w=out.append
w("package com.dullyyj.kids;\n")
w("/**\n * 길동무 친구들 꾸미기 도감(엔진) — 친구 8명 × 모자·옷·소지품 20개씩 = 480개. 친구마다 이름·그림이 모두 다르다(겹치지 않는다).\n * 그림은 짧은 그림 문장(Art)이고, 앱은 이것을 그리기만 한다. 어디에(머리 · 몸 · 손) 얼마 크게 놓을지는 place() 가 칸마다 계산한다.\n * ★ 이 파일은 tools/wardrobe_gen.py 가 만든다 — 손으로 고치지 말고 만드는 쪽을 고친다.\n */\npublic final class Wardrobe {")
w("    private Wardrobe() {}\n")
w("    static final String[] IDS = {"+", ".join('"%s"'%i for i in catalog.IDS)+"};")
w("    static final String[] SLOT = {\"hat\", \"cloth\", \"item\"};")
w("    static final String[] SLOT_KO = {\"모자\", \"옷\", \"소지품\"};")
w("    public static final int PER = 20;\n")
w("    private static final String[][] N = new String[24][];")
w("    private static final String[][] A = new String[24][];")
w("    static {")
for ci,ch in enumerate(catalog.IDS):
    for si,sl in enumerate(('hat','cloth','item')):
        k=ci*3+si; it=cat[ch][sl]
        w("        N[%d] = new String[]{%s};"%(k,", ".join('"%s"'%n for n,a in it)))
        w("        A[%d] = new String[]{"%k)
        for n,a in it: w('            "%s",'%a)
        w("        };")
w("    }\n")
w("    /** 친구 번호(없으면 -1). */\n    public static int ci(String id) {\n        if (id == null) return -1;\n        for (int i = 0; i < IDS.length; i++) if (IDS[i].equals(id)) return i;\n        return -1;\n    }")
w("    static String name(int ci, int slot, int i) { return N[ci * 3 + slot][i]; }")
w("    static String art(int ci, int slot, int i) { return A[ci * 3 + slot][i]; }\n")

WMETA=json.load(open('/tmp/wg3d/atlas/meta.json'))
w("    // 3D 그림 시트(assets/wear/<친구>.webp, 8x8칸 x 192px): 칸 번호 = 칸종류*20 + 번호. 칸마다 {가운데 x, 가운데 y, 한 변} — 그림 문장 단위(1.0 = u 픽셀)")
w("    public static final int CELL = 192, GRID = 8;")
w("    private static final float[][] WM = {")
for ch in catalog.IDS:
    w("        {"+", ".join("%sf, %sf, %sf"%tuple(m) for m in WMETA[ch])+"},")
w("    };\n")
w("""    /** 3D 그림 시트에서 한 아이템의 자리: out = {가운데 x, 가운데 y, 한 변}(그림 문장 단위, 실제 크기는 * u). 시트 안 칸 번호는 k = slot*PER + i. */
    public static boolean sprite(int ci, int slot, int i, float[] out) {
        if (ci < 0 || ci >= 8 || slot < 0 || slot > 2 || i < 0 || i >= PER) return false;
        int b = (slot * PER + i) * 3;
        out[0] = WM[ci][b]; out[1] = WM[ci][b + 1]; out[2] = WM[ci][b + 2];
        return true;
    }
""")
w("    // 칸별 지표(그림 한 칸 256 안): 머리 꼭대기 x · 꼭대기 y · 몸 너비 · 몸 높이 · 몸 가운데 x — 시트 0 걷기(16칸) · 1 자세(8칸) · 2 동작(16칸)")
w("    private static final int[][][] MET = new int[8][3][];")
w("    static {")
for ci,ch in enumerate(catalog.IDS):
    for si,sh in enumerate(('walk','pose','act')):
        flat=[v for c in M[ch][sh] for v in c]
        w("        MET[%d][%d] = new int[]{%s};"%(ci,si,",".join(str(v) for v in flat)))
w("    }")
w("    // 놓는 자리 비율(친구 × 모자·옷·소지품): 가로 어긋남 · 세로 위치 · 그림 크기 — 모두 몸 너비/높이에 대한 비율")
w("    private static final float[][][] KK = {")
for ch in catalog.IDS:
    k=kconst.K.get(ch) or P.K[ch]
    w("        {"+", ".join("{%sf, %sf, %sf}"%tuple(k[s]) for s in ('hat','cloth','item'))+"},")
w("    };\n")
w("""    /**
     * 한 칸에서 그림을 놓을 자리와 크기를 계산한다. out = {x, y, 크기} (칸 256 기준 픽셀). 그릴 수 없으면(자는 모습 등) false.
     * sheet: 0 걷기 · 1 자세 · 2 동작. slot: 0 모자 · 1 옷 · 2 소지품(앞쪽 = +x 쪽).
     */
    public static boolean place(int ci, int sheet, int cell, int slot, float[] out) {
        if (ci < 0 || ci >= 8 || sheet < 0 || sheet > 2 || slot < 0 || slot > 2) return false;
        if (sheet == 1 && cell == 1) return false;                // 자는 모습엔 입히지 않는다
        int[] m = MET[ci][sheet];
        int b = cell * 5;
        if (cell < 0 || b + 4 >= m.length) return false;
        float[] k = KK[ci][slot];
        if (m[b + 2] <= 0) return false;                          // 빈 칸
        float tx = m[b], ty = m[b + 1], bw = m[b + 2], bh = m[b + 3], cx = m[b + 4];
        out[0] = (slot == 0 ? tx : cx) + k[0] * bw;
        out[1] = ty + k[1] * bh;
        out[2] = k[2] * bw;
        return true;
    }
}""")
open('/tmp/wg/Wardrobe.java','w',encoding='utf-8').write("\n".join(out)+"\n")
print(len("\n".join(out))//1024,'KB')
