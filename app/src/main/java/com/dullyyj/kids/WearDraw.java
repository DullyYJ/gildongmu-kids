package com.dullyyj.kids;

import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;

/** 입은 모습을 안드로이드 캔버스에 그린다(마을 · 꾸미기 창). 자리·크기는 엔진(Wardrobe.place)이 정하고 여기는 붓질만 한다. */
final class WearDraw {
    private WearDraw() {}

    static final class P implements Art.Pen {
        Canvas c;
        final Path path = new Path();
        final Paint fp = new Paint(Paint.ANTI_ALIAS_FLAG), sp = new Paint(Paint.ANTI_ALIAS_FLAG);
        final RectF rf = new RectF();
        final float[] o = new float[3];

        P() {
            fp.setStyle(Paint.Style.FILL);
            sp.setStyle(Paint.Style.STROKE);
            sp.setStrokeCap(Paint.Cap.ROUND);
            sp.setStrokeJoin(Paint.Join.ROUND);
        }

        @Override public void begin() { path.reset(); }
        @Override public void move(float x, float y) { path.moveTo(x, y); }
        @Override public void line(float x, float y) { path.lineTo(x, y); }
        @Override public void quad(float cx, float cy, float x, float y) { path.quadTo(cx, cy, x, y); }
        @Override public void close() { path.close(); }
        @Override public void oval(float cx, float cy, float rx, float ry) { rf.set(cx - rx, cy - ry, cx + rx, cy + ry); path.addOval(rf, Path.Direction.CW); }
        @Override public void fill(int argb) { fp.setColor(argb); c.drawPath(path, fp); }
        @Override public void stroke(int argb, float w) { sp.setColor(argb); sp.setStrokeWidth(w); c.drawPath(path, sp); }
    }

    /** 칸(시트 sheet · 칸 번호 cell)에 그려진 친구에게 옷 → 소지품 → 모자 순으로 입힌다. (left, top) = 칸 왼쪽 위, s = 칸 한 변의 픽셀. */
    static void worn(Canvas c, P pen, Dress.Look lk, int ci, int sheet, int cell, float left, float top, float s) {
        if (lk == null || ci < 0) return;
        pen.c = c;
        float k = s / 256f;
        for (int n = 0; n < 3; n++) {
            int slot = n == 0 ? 1 : n == 1 ? 2 : 0;
            Art.Op[] ops = lk.ops[slot];
            if (ops == null || !Wardrobe.place(ci, sheet, cell, slot, pen.o)) continue;
            Art.draw(pen, ops, left + pen.o[0] * k, top + pen.o[1] * k, pen.o[2] * k);
        }
    }
}
