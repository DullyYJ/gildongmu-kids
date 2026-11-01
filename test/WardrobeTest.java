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
