package com.dullyyj.kids;

import java.util.ArrayList;

/**
 * 아이템 그림 문장(Wardrobe 의 art) 해석·그리기. 좌표 단위 100 = 1.0 (1.0 = 그림 크기 한 단위).
 * 연산: o/O 타원 · r/R 둥근 네모 · t/T 세모 · p/P 다각형 · h/H 하트 · s/S 별(소문자 = 테두리 있음) · l 선 · q 굽은 선 · a 호 · e 타원 테두리.
 * 이 클래스는 해석과 도형 계산만 한다(안드로이드를 쓰지 않아 JVM 에서 시험한다). 실제 붓은 Pen 이 넘겨받는다 — 앱은 그리기만 한다.
 */
public final class Art {
    private Art() {}

    public interface Pen {
        void begin();
        void move(float x, float y);
        void line(float x, float y);
        void quad(float cx, float cy, float x, float y);
        void close();
        void oval(float cx, float cy, float rx, float ry);
        void fill(int argb);
        void stroke(int argb, float w);
    }

    public static final class Op {
        char k;
        float[] n = new float[0];
        int color;
        boolean ol;
    }

    static Op[] parse(String s) {
        ArrayList<Op> r = new ArrayList<Op>();
        if (s == null) return new Op[0];
        for (String part : s.split(";")) {
            String[] t = part.trim().split(" ");
            if (t.length < 2 || t[0].isEmpty()) continue;
            Op o = new Op();
            char c = t[0].charAt(0);
            o.ol = Character.isLowerCase(c) && "ortphs".indexOf(c) >= 0;
            o.k = Character.toLowerCase(c);
            try {
                if (o.k == 'p') {
                    o.color = col(t[1]);
                    o.n = nums(t, 2, t.length);
                } else if ("ortshlqae".indexOf(o.k) >= 0) {
                    o.color = col(t[t.length - 1]);
                    o.n = nums(t, 1, t.length - 1);
                } else continue;
            } catch (RuntimeException e) {
                continue;
            }
            r.add(o);
        }
        return r.toArray(new Op[0]);
    }

    private static float[] nums(String[] t, int a, int b) {
        float[] f = new float[Math.max(0, b - a)];
        for (int i = a; i < b; i++) f[i - a] = Float.parseFloat(t[i]) / 100f;
        return f;
    }

    static int col(String h) {
        int r = Integer.parseInt(h.substring(0, 2), 16), g = Integer.parseInt(h.substring(2, 4), 16), b = Integer.parseInt(h.substring(4, 6), 16);
        int a = h.length() >= 8 ? Integer.parseInt(h.substring(6, 8), 16) : 255;
        return (a << 24) | (r << 16) | (g << 8) | b;
    }

    static int dark(int c) {
        int a = c >>> 24, r = (int) (((c >> 16) & 255) * .62f), g = (int) (((c >> 8) & 255) * .62f), b = (int) ((c & 255) * .62f);
        return (a << 24) | (r << 16) | (g << 8) | b;
    }

    /** ops 를 (ox, oy) 를 가운데로 u 픽셀 = 1.0 크기로 그린다. */
    public static void draw(Pen p, Op[] ops, float ox, float oy, float u) {
        float lw = Math.max(.7f, .022f * u);
        for (int i = 0; i < ops.length; i++) {
            Op o = ops[i];
            float[] n = o.n;
            switch (o.k) {
                case 'o':
                    if (n.length < 4) break;
                    p.begin();
                    p.oval(ox + n[0] * u, oy + n[1] * u, n[2] * u, n[3] * u);
                    paint(p, o, lw);
                    break;
                case 'r':
                    if (n.length < 5) break;
                    p.begin();
                    rrect(p, ox + n[0] * u, oy + n[1] * u, n[2] * u, n[3] * u, n[4] * u);
                    paint(p, o, lw);
                    break;
                case 't':
                    if (n.length < 6) break;
                    p.begin();
                    p.move(ox + n[0] * u, oy + n[1] * u);
                    p.line(ox + n[2] * u, oy + n[3] * u);
                    p.line(ox + n[4] * u, oy + n[5] * u);
                    p.close();
                    paint(p, o, lw);
                    break;
                case 'p':
                    if (n.length < 6) break;
                    p.begin();
                    p.move(ox + n[0] * u, oy + n[1] * u);
                    for (int j = 2; j + 1 < n.length; j += 2) p.line(ox + n[j] * u, oy + n[j + 1] * u);
                    p.close();
                    paint(p, o, lw);
                    break;
                case 'h':
                    if (n.length < 3) break;
                    p.begin();
                    for (int j = 0; j <= 36; j++) {
                        double a = j / 36.0 * 2 * Math.PI, s = Math.sin(a);
                        double hx = 16 * s * s * s, hy = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
                        float x = ox + (n[0] + (float) (hx / 17.0) * n[2]) * u, y = oy + (n[1] + (float) (hy / 17.0) * n[2] * .95f - n[2] * .1f) * u;
                        if (j == 0) p.move(x, y); else p.line(x, y);
                    }
                    p.close();
                    paint(p, o, lw);
                    break;
                case 's':
                    if (n.length < 3) break;
                    p.begin();
                    for (int j = 0; j < 10; j++) {
                        double a = (-90 + j * 36) * Math.PI / 180.0;
                        float rr = (j % 2 == 0 ? 1f : .45f) * n[2];
                        float x = ox + (n[0] + (float) Math.cos(a) * rr) * u, y = oy + (n[1] + (float) Math.sin(a) * rr) * u;
                        if (j == 0) p.move(x, y); else p.line(x, y);
                    }
                    p.close();
                    paint(p, o, lw);
                    break;
                case 'l':
                    if (n.length < 5) break;
                    p.begin();
                    p.move(ox + n[0] * u, oy + n[1] * u);
                    p.line(ox + n[2] * u, oy + n[3] * u);
                    p.stroke(o.color, Math.max(.8f, n[4] * u));
                    break;
                case 'q':
                    if (n.length < 7) break;
                    p.begin();
                    p.move(ox + n[0] * u, oy + n[1] * u);
                    p.quad(ox + n[2] * u, oy + n[3] * u, ox + n[4] * u, oy + n[5] * u);
                    p.stroke(o.color, Math.max(.8f, n[6] * u));
                    break;
                case 'a':
                    if (n.length < 6) break;
                    p.begin();
                    {
                        float a0 = n[3] * 100f, a1 = n[4] * 100f;
                        if (a1 < a0) a1 += 360f;
                        for (int j = 0; j <= 20; j++) {
                            double a = (a0 + (a1 - a0) * j / 20f) * Math.PI / 180.0;
                            float x = ox + (n[0] + n[2] * (float) Math.cos(a)) * u, y = oy + (n[1] + n[2] * (float) Math.sin(a)) * u;
                            if (j == 0) p.move(x, y); else p.line(x, y);
                        }
                    }
                    p.stroke(o.color, Math.max(.8f, n[5] * u));
                    break;
                case 'e':
                    if (n.length < 5) break;
                    p.begin();
                    p.oval(ox + n[0] * u, oy + n[1] * u, n[2] * u, n[3] * u);
                    p.stroke(o.color, Math.max(.8f, n[4] * u));
                    break;
                default:
                    break;
            }
        }
    }

    private static void paint(Pen p, Op o, float lw) {
        p.fill(o.color);
        if (o.ol && (o.color >>> 24) > 200) p.stroke(dark(o.color), lw);
    }

    private static void rrect(Pen p, float x, float y, float w, float h, float rad) {
        float l = x - w / 2f, t = y - h / 2f, r = x + w / 2f, b = y + h / 2f;
        float k = Math.min(rad, Math.min(w, h) / 2f);
        p.move(l + k, t);
        p.line(r - k, t);
        p.quad(r, t, r, t + k);
        p.line(r, b - k);
        p.quad(r, b, r - k, b);
        p.line(l + k, b);
        p.quad(l, b, l, b - k);
        p.line(l, t + k);
        p.quad(l, t, l + k, t);
        p.close();
    }
}
