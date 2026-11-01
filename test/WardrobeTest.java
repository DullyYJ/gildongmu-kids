package com.dullyyj.kids;

import java.util.HashSet;

/** 꾸미기 도감·엔진 시험(JVM): java -cp out com.dullyyj.kids.WardrobeTest */
public class WardrobeTest {
    static int fail = 0;
    static void ok(boolean c, String m) { System.out.println((c ? "  ok   " : "  FAIL ") + m); if (!c) fail++; }

    static final class Count implements Art.Pen {
        int fills, strokes, paths;
        float minX = 1e9f, maxX = -1e9f, minY = 1e9f, maxY = -1e9f;
        void t(float x, float y) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
        public void begin() { paths++; }
        public void move(float x, float y) { t(x, y); }
        public void line(float x, float y) { t(x, y); }
        public void quad(float cx, float cy, float x, float y) { t(x, y); }
        public void close() {}
        public void oval(float cx, float cy, float rx, float ry) { t(cx - rx, cy - ry); t(cx + rx, cy + ry); }
        public void fill(int c) { fills++; }
        public void stroke(int c, float w) { strokes++; }
    }

    public static void main(String[] a) {
        String[] nm = {"뽀푸", "둘숑", "러블", "챙챙", "독슐", "두덩", "히뽀", "죽순"};
        ok(Wardrobe.IDS.length == 8, "친구 8명");
        HashSet<String> names = new HashSet<String>(), arts = new HashSet<String>();
        int n = 0;
        for (int c = 0; c < 8; c++) for (int s = 0; s < 3; s++) for (int i = 0; i < Wardrobe.PER; i++) {
            String x = Wardrobe.name(c, s, i), y = Wardrobe.art(c, s, i);
            ok2(names.add(x), "이름 겹침: " + x);
            ok2(arts.add(y), "그림 겹침: " + x);
            Art.Op[] ops = Art.parse(y);
            ok2(ops.length >= 3, "그림 해석: " + x);
            Count p = new Count();
            Art.draw(p, ops, 0, 0, 100f);
            ok2(p.fills >= 1 && p.minX > -300 && p.maxX < 300 && p.minY > -300 && p.maxY < 300, "그림 범위: " + x + " " + p.minX + ".." + p.maxX + " " + p.minY + ".." + p.maxY);
            n++;
        }
        ok(n == 480 && names.size() == 480 && arts.size() == 480, "480개 · 이름 480가지 · 그림 480가지(겹침 없음)");
        // 친구마다 60개(모자 20 · 옷 20 · 소지품 20)
        for (int c = 0; c < 8; c++) {
            int k = 0;
            for (int s = 0; s < 3; s++) { k += Wardrobe.PER; }
            ok(k == 60, nm[c] + " 60개");
        }
        // 놓는 자리
        float[] o = new float[3];
        boolean all = true;
        for (int c = 0; c < 8; c++) for (int sh = 0; sh < 3; sh++) {
            int cells = sh == 1 ? 8 : 16;
            for (int cell = 0; cell < cells; cell++) for (int sl = 0; sl < 3; sl++) {
                boolean r = Wardrobe.place(c, sh, cell, sl, o);
                if (sh == 1 && (cell == 1 || (cell >= 6 && c < 6))) { if (r) all = false; continue; }   // 자는 모습 · 빈 칸
                if (!r || !(o[0] > 0 && o[0] < 256 && o[1] > 0 && o[1] < 300 && o[2] > 5 && o[2] < 200)) { all = false; System.out.println("   범위 밖 " + c + "/" + sh + "/" + cell + "/" + sl + " " + o[0] + "," + o[1] + "," + o[2]); }
            }
        }
        ok(all, "모든 칸(걷기 16 · 자세 · 동작 16)에서 놓을 자리가 정해진다(자는 모습 · 빈 칸만 빼고)");
        ok(!Wardrobe.place(-1, 0, 0, 0, o) && !Wardrobe.place(0, 3, 0, 0, o) && !Wardrobe.place(0, 0, 99, 0, o), "잘못된 값은 거절");
        // 3D 그림 시트 자리: 모든 칸(480) 에 가운데·크기가 있고 시트 칸 번호가 8x8 안
        float[] sp = new float[3];
        boolean sprOk = true;
        for (int c = 0; c < 8; c++) for (int s = 0; s < 3; s++) for (int i = 0; i < Wardrobe.PER; i++) {
            int q = s * Wardrobe.PER + i;
            if (!Wardrobe.sprite(c, s, i, sp) || !(sp[2] >= 0.3f && sp[2] < 3.5f && Math.abs(sp[0]) < 1.5f && Math.abs(sp[1]) < 1.5f) || q >= Wardrobe.GRID * Wardrobe.GRID) sprOk = false;
        }
        ok(sprOk && !Wardrobe.sprite(8, 0, 0, sp) && !Wardrobe.sprite(0, 3, 0, sp) && !Wardrobe.sprite(0, 0, 20, sp), "3D 그림 시트 자리 480곳 · 잘못된 값 거절");
        // 몸에 맞춰 입히기(줄 단위): 파이썬 시안(fitprev.py) 값과 맞는지 · 범위
        float[] st = new float[8 * Wardrobe.NS], pl = new float[3];
        Object[][] cs = {
            {0, 0, 5, 15, new float[][]{{78, 42.8f, 114, 46.1f, 108.6f, 113.7f, 146.0f, 117.1f}, {23, 96.0f, 169, 99.3f, 61.1f, 157.0f, 179.9f, 160.4f}, {48, 145.9f, 144, 149.2f, 101.6f, 197.6f, 179.6f, 201.1f}}},
            {4, 0, 3, 2, new float[][]{{78, 42.8f, 114, 46.1f, 123.6f, 157.6f, 139.1f, 159.5f}, {23, 96.0f, 169, 99.3f, 102.7f, 175.7f, 160.1f, 177.5f}, {48, 145.9f, 144, 149.2f, 115.8f, 192.6f, 148.2f, 194.5f}}},
            {7, 2, 4, 14, new float[][]{{78, 42.8f, 114, 46.1f, 139.1f, 133.0f, 174.0f, 136.2f}, {23, 96.0f, 169, 99.3f, 90.5f, 173.5f, 202.7f, 176.8f}, {48, 145.9f, 144, 149.2f, 90.7f, 211.6f, 163.6f, 214.8f}}}};
        for (Object[] cc : cs) {
            int c = (Integer) cc[0], sh = (Integer) cc[1], cell = (Integer) cc[2], it = (Integer) cc[3];
            float[][] ex2 = (float[][]) cc[4];
            Wardrobe.place(c, sh, cell, 1, pl);
            int nn = Wardrobe.strips(c, sh, cell, 1, it, pl[0], pl[1], pl[2], st);
            ok(Wardrobe.wraps(c, 1, it) && nn == Wardrobe.NS, "몸에 두르는 옷은 " + Wardrobe.NS + "줄로 나뉜다: " + Wardrobe.name(c, 1, it) + " " + nn);
            int[] pick = {0, nn / 2, nn - 1};
            boolean same = true;
            for (int q = 0; q < 3; q++) for (int v = 0; v < 8; v++) {
                float got = st[pick[q] * 8 + v], want = ex2[q][v];
                if (Math.abs(got - want) > (v < 4 ? 1.6f : 2.2f)) { same = false; System.out.println("   다름 " + Wardrobe.name(c, 1, it) + " 줄" + pick[q] + " [" + v + "] " + got + " vs " + want); }
            }
            ok(same, "줄별 자리가 시안과 같다: " + Wardrobe.name(c, 1, it));
        }
        boolean sane = true;
        int wrapN = 0;
        for (int c = 0; c < 8; c++) for (int sh = 0; sh < 3; sh++) for (int cell = 0; cell < (sh == 1 ? 8 : 16); cell++) for (int it = 0; it < Wardrobe.PER; it++) {
            if (!Wardrobe.place(c, sh, cell, 1, pl)) continue;
            int nn = Wardrobe.strips(c, sh, cell, 1, it, pl[0], pl[1], pl[2], st);
            if (nn < 1 || nn > Wardrobe.NS) { sane = false; System.out.println("   줄 수 이상 " + c + "/" + sh + "/" + cell + "/" + it + " " + nn); continue; }
            if (Wardrobe.wraps(c, 1, it)) wrapN++;
            for (int j = 0; j < nn; j++) {
                float sx0 = st[j * 8], sy0 = st[j * 8 + 1], sx1 = st[j * 8 + 2], sy1 = st[j * 8 + 3], dx0 = st[j * 8 + 4], dy0 = st[j * 8 + 5], dx1 = st[j * 8 + 6], dy1 = st[j * 8 + 7];
                boolean good = sx0 >= 0 && sy0 >= 0 && sx1 <= 192 && sy1 <= 192 + 1 && sx1 > sx0 && sy1 > sy0 && dx1 - dx0 > 0.3f && dx1 - dx0 < 230 && dy1 > dy0 && dx0 > -40 && dx1 < 420 && dy0 > -40 && dy1 < 320;
                if (!good) { sane = false; System.out.println("   조각 이상 " + c + "/" + sh + "/" + cell + "/" + it + " #" + j + " " + sx0 + "," + sy0 + "," + sx1 + "," + sy1 + " -> " + dx0 + "," + dy0 + "," + dx1 + "," + dy1); break; }
            }
        }
        ok(sane && wrapN > 1000, "모든 칸 · 모든 옷에서 조각이 범위 안에 있다(두르는 옷 " + wrapN + "곳)");
        Wardrobe.place(0, 0, 5, 0, pl);
        ok(Wardrobe.strips(0, 0, 5, 0, 3, pl[0], pl[1], pl[2], st) == 1 && !Wardrobe.wraps(0, 0, 3) && Wardrobe.strips(8, 0, 0, 0, 0, 0, 0, 1, st) == 0, "모자·소지품은 한 장 · 잘못된 값은 0");
        // 엔진 동작
        Dress d = Dress.I;
        int[] cnt = {0};
        d.setOnChange(new Runnable() { public void run() { cnt[0]++; } });
        ok(d.look("ppopu") == null, "처음엔 아무것도 안 입었다");
        ok(d.act("dress.eq:hat:3") && d.worn(0, 0) == 3 && d.look("ppopu") != null && d.look("ppopu").ops[0] != null, "모자 입기");
        ok(d.act("dress.eq:cloth:5") && d.worn(0, 1) == 5, "옷 입기");
        ok(d.act("dress.eq:hat:7") && d.worn(0, 0) == 7 && d.look("ppopu").idx[0] == 7, "같은 칸은 바뀐다");
        ok(d.act("dress.eq:hat:7") && d.worn(0, 0) == -1, "한 번 더 누르면 벗는다");
        ok(d.act("dress.sel:3") && d.sel() == 3 && d.act("dress.eq:item:2") && d.worn(3, 2) == 2 && d.look("chaeng") != null && d.look("ppopu") != null && d.worn(0, 1) == 5, "친구마다 따로 입는다");
        ok(!d.act("dress.sel:3") && !d.act("dress.eq:hat:99") && !d.act("dress.eq:foo:1") && !d.act(null), "바뀌지 않는 눌림은 false");
        ok(d.act("dress.tab:cloth") && d.tab() == 1, "탭 바꾸기");
        String ex = d.export();
        ok(d.act("dress.off:all") && d.look("chaeng") == null, "모두 벗기");
        d.restore(ex);
        ok(d.worn(3, 2) == 2 && d.worn(0, 1) == 5 && d.sel() == 3 && d.tab() == 1 && d.look("chaeng") != null, "저장했다 다시 읽으면 그대로");
        d.restore("망가진;;값");
        ok(d.worn(3, 2) == 2, "망가진 저장은 무시");
        ok(cnt[0] >= 8, "바뀔 때마다 저장 알림");
        long t0 = System.nanoTime();
        for (int i = 0; i < 2000; i++) { d.act("dress.eq:hat:" + (i % 20)); d.look("lovel"); }
        double ms = (System.nanoTime() - t0) / 1e6 / 2000;
        ok(ms < 1.0, "한 번 누르는 계산은 1ms 도 안 걸린다(" + String.format("%.3f", ms) + "ms ≪ 100ms)");
        System.out.println(fail == 0 ? "\n모두 통과" : "\n실패 " + fail);
        System.exit(fail == 0 ? 0 : 1);
    }
    static void ok2(boolean c, String m) { if (!c) { System.out.println("  FAIL " + m); fail++; } }
}
