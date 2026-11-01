package com.dullyyj.kids;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Rect;
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

    private static final float[] SP = new float[3];
    private static final Rect SRC = new Rect();
    private static final RectF DST = new RectF();
    private static final Paint IP = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);

    /**
     * 칸(시트 sheet · 칸 번호 cell)에 그려진 친구에게 옷 → 소지품 → 모자 순으로 입힌다. (left, top) = 칸 왼쪽 위, s = 칸 한 변의 픽셀.
     * 3D 로 그려 둔 그림(assets/wear)이 읽혀 있으면 그것을, 아직이면 그림 문장(2D)으로 먼저 그린다. 놓을 자리·크기는 어느 쪽이든 엔진 계산(Wardrobe.place).
     */
    static void worn(Canvas c, P pen, Dress.Look lk, int ci, int sheet, int cell, float left, float top, float s) {
        if (lk == null || ci < 0) return;
        pen.c = c;
        float k = s / 256f;
        Bitmap at = WearImg.atlas(ci);
        for (int n = 0; n < 3; n++) {
            int slot = n == 0 ? 1 : n == 1 ? 2 : 0;
            Art.Op[] ops = lk.ops[slot];
            if (ops == null || !Wardrobe.place(ci, sheet, cell, slot, pen.o)) continue;
            int i = lk.idx[slot];
            if (at != null && Wardrobe.sprite(ci, slot, i, SP)) {
                float u = pen.o[2] * k, side = SP[2] * u;
                float cx = left + pen.o[0] * k + SP[0] * u, cy = top + pen.o[1] * k + SP[1] * u;
                int q = slot * Wardrobe.PER + i;
                SRC.set((q % Wardrobe.GRID) * Wardrobe.CELL, (q / Wardrobe.GRID) * Wardrobe.CELL, (q % Wardrobe.GRID + 1) * Wardrobe.CELL, (q / Wardrobe.GRID + 1) * Wardrobe.CELL);
                DST.set(cx - side / 2f, cy - side / 2f, cx + side / 2f, cy + side / 2f);
                c.drawBitmap(at, SRC, DST, IP);
            } else {
                Art.draw(pen, ops, left + pen.o[0] * k, top + pen.o[1] * k, pen.o[2] * k);
            }
        }
    }
}
