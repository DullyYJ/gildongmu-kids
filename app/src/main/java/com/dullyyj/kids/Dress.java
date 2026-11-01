package com.dullyyj.kids;

/**
 * 꾸미기 상태(엔진) — 친구마다 입은 모자·옷·소지품, 고른 친구·탭. 누르면 여기서 바로 계산하고(0.1초 안),
 * 홈 장면·마을·꾸미기 창은 입은 모습(look)을 읽어 그리기만 한다. 앱 껐다 켜도 이어지도록 export/restore 로 저장한다.
 * 한 번 누를 때마다 바뀌는 것은 숫자 몇 개뿐이라 화면 전체를 다시 만들지 않는다.
 */
public final class Dress {
    public static final Dress I = new Dress();

    /** 입은 모습(바뀌지 않는 한 장): 칸마다 그림 문장을 풀어 둔 것(없으면 null). */
    public static final class Look {
        public final Art.Op[][] ops = new Art.Op[3][];
        public final int[] idx = {-1, -1, -1};
        boolean any() { return ops[0] != null || ops[1] != null || ops[2] != null; }
    }

    private final int[][] worn = new int[8][3];
    private int sel = 0, tab = 0;
    private volatile Look[] looks = new Look[8];
    private final Art.Op[][] cache = new Art.Op[8 * 3 * Wardrobe.PER][];
    private Runnable onChange;

    private Dress() {
        for (int i = 0; i < 8; i++) for (int j = 0; j < 3; j++) worn[i][j] = -1;
    }

    synchronized void setOnChange(Runnable r) { onChange = r; }

    synchronized int sel() { return sel; }
    synchronized int tab() { return tab; }
    synchronized int worn(int ci, int slot) { return ci < 0 || ci > 7 || slot < 0 || slot > 2 ? -1 : worn[ci][slot]; }

    /** 입은 모습(홈 장면 · 마을이 매 프레임 읽는다 — 잠금 없이). 안 입었으면 null. */
    public Look look(String id) {
        int c = Wardrobe.ci(id);
        return c < 0 ? null : looks[c];
    }

    /** 칸(친구 · 칸 종류 · 번호)의 그림 문장을 풀어 둔 것. */
    synchronized Art.Op[] ops(int ci, int slot, int i) {
        int k = (ci * 3 + slot) * Wardrobe.PER + i;
        if (k < 0 || k >= cache.length || i < 0 || i >= Wardrobe.PER) return new Art.Op[0];
        Art.Op[] o = cache[k];
        if (o == null) cache[k] = o = Art.parse(Wardrobe.art(ci, slot, i));
        return o;
    }

    /** 눌림 처리. 상태가 바뀌었으면 true (저장은 바뀐 쪽이 알아서 부른다). */
    boolean act(String v) {
        boolean ch = false;
        Runnable cb;
        synchronized (this) {
            if (v == null) return false;
            if (v.startsWith("dress.sel:")) {
                int c = num(v.substring(10), -1);
                if (c >= 0 && c < 8 && c != sel) { sel = c; ch = true; }
            } else if (v.startsWith("dress.tab:")) {
                int s = slotOf(v.substring(10));
                if (s >= 0 && s != tab) { tab = s; ch = true; }
            } else if (v.startsWith("dress.eq:")) {           // dress.eq:<칸>:<번호> — 입고 있으면 벗고, 아니면 입는다(같은 칸 옷은 바뀐다)
                String[] p = v.substring(9).split(":");
                int s = p.length == 2 ? slotOf(p[0]) : -1, i = p.length == 2 ? num(p[1], -1) : -1;
                if (s >= 0 && i >= 0 && i < Wardrobe.PER) {
                    worn[sel][s] = worn[sel][s] == i ? -1 : i;
                    rebuild(sel);
                    ch = true;
                }
            } else if (v.startsWith("dress.off:")) {          // 이 칸(모자 · 옷 · 소지품)을 벗긴다 / all 이면 모두
                String q = v.substring(10);
                if ("all".equals(q)) {
                    for (int s = 0; s < 3; s++) if (worn[sel][s] >= 0) { worn[sel][s] = -1; ch = true; }
                } else {
                    int s = slotOf(q);
                    if (s >= 0 && worn[sel][s] >= 0) { worn[sel][s] = -1; ch = true; }
                }
                if (ch) rebuild(sel);
            }
            cb = ch ? onChange : null;
        }
        if (cb != null) cb.run();
        return ch;
    }

    private void rebuild(int c) {
        Look l = new Look();
        for (int s = 0; s < 3; s++) {
            int i = worn[c][s];
            if (i >= 0) {
                int k = (c * 3 + s) * Wardrobe.PER + i;
                Art.Op[] o = cache[k];
                if (o == null) cache[k] = o = Art.parse(Wardrobe.art(c, s, i));
                l.ops[s] = o;
                l.idx[s] = i;
            }
        }
        Look[] n = looks.clone();
        n[c] = l.any() ? l : null;
        looks = n;
    }

    static int slotOf(String s) {
        for (int i = 0; i < 3; i++) if (Wardrobe.SLOT[i].equals(s)) return i;
        return -1;
    }

    private static int num(String s, int d) {
        try { return Integer.parseInt(s.trim()); } catch (RuntimeException e) { return d; }
    }

    /** 저장 글: "고른친구,탭;모자,옷,소지품;…(8명)". */
    synchronized String export() {
        StringBuilder b = new StringBuilder();
        b.append(sel).append(',').append(tab);
        for (int c = 0; c < 8; c++) b.append(';').append(worn[c][0]).append(',').append(worn[c][1]).append(',').append(worn[c][2]);
        return b.toString();
    }

    synchronized void restore(String s) {
        if (s == null || s.isEmpty()) return;
        String[] p = s.split(";");
        try {
            String[] h = p[0].split(",");
            sel = Math.max(0, Math.min(7, Integer.parseInt(h[0])));
            tab = Math.max(0, Math.min(2, Integer.parseInt(h[1])));
            for (int c = 0; c < 8 && c + 1 < p.length; c++) {
                String[] w = p[c + 1].split(",");
                for (int k = 0; k < 3 && k < w.length; k++) {
                    int v = Integer.parseInt(w[k]);
                    worn[c][k] = v >= 0 && v < Wardrobe.PER ? v : -1;
                }
                rebuild(c);
            }
        } catch (RuntimeException e) {
            // 망가진 저장은 무시(아무것도 안 입은 상태)
        }
    }
}
