package com.dullyyj.kids;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.view.View;

/** 홈 브리핑 카드의 작은 얼굴 — 걷기 시트 첫 칸. */
final class ThumbView extends View {
    private final String file;
    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final Rect src = new Rect();
    private final RectF dst = new RectF();
    private final Runnable inv = new Runnable() {
        @Override
        public void run() {
            invalidate();
        }
    };

    ThumbView(Context c, String file) {
        super(c);
        this.file = file;
    }

    @Override
    protected void onDraw(Canvas c) {
        float w = getWidth(), h = getHeight(), s = Math.min(w, h);
        Bitmap b = Core.sheets.get(file, inv);
        if (b == null) {
            p.setColor(Pal.c(Pal.IMGBG));
            c.drawCircle(w / 2f, h / 2f, s / 2f, p);
            return;
        }
        int cs = b.getWidth() / 4;
        src.set(0, 0, cs, cs);
        dst.set((w - s) / 2f, (h - s) / 2f, (w + s) / 2f, (h + s) / 2f);
        c.drawBitmap(b, src, dst, p);
    }
}
