package com.dullyyj.kids;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.view.View;

import com.dullyyj.subway.Chars;

import java.io.InputStream;
import java.util.HashMap;

/** 꾸미기 창 맨 위: 고른 길동무 친구가 제자리에서 걷는 모습(캐릭터 시트 4칸 반복). 시트는 뒤 스레드에서 읽는다. */
final class AvatarView extends View {
    private static final HashMap<String, Bitmap> SHEETS = new HashMap<String, Bitmap>();
    private final String file;
    private final String label;
    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final Paint tp = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Rect src = new Rect();
    private final RectF dst = new RectF();
    private final float dpr;
    private Bitmap sheet;
    private boolean attached = false;
    private int frame = 0;

    private final Runnable step = new Runnable() {
        @Override
        public void run() {
            if (!attached) return;
            frame = (frame + 1) & 3;
            invalidate();
            postDelayed(this, 180L);
        }
    };

    AvatarView(Context c, String id, String name) {
        super(c);
        file = Chars.file(id);
        label = name == null ? "" : name;
        dpr = c.getResources().getDisplayMetrics().density;
        setBackground(Ui.box(c, Pal.c(Pal.CARD), 16, Pal.c(Pal.BORDER)));
        tp.setTextAlign(Paint.Align.CENTER);
        tp.setFakeBoldText(true);
        tp.setTextSize(15f * dpr);
        tp.setColor(Pal.c(Pal.TEXT));
    }

    @Override
    protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        attached = true;
        load();
        postDelayed(step, 180L);
    }

    @Override
    protected void onDetachedFromWindow() {
        attached = false;
        removeCallbacks(step);
        super.onDetachedFromWindow();
    }

    private void load() {
        synchronized (SHEETS) {
            Bitmap b = SHEETS.get(file);
            if (b != null) {
                sheet = b;
                return;
            }
        }
        final Context c = getContext().getApplicationContext();
        Wire.EX.execute(new Runnable() {
            @Override
            public void run() {
                Bitmap b = null;
                try {
                    InputStream in = c.getAssets().open("chars3d/" + file + ".webp");
                    try {
                        b = BitmapFactory.decodeStream(in);
                    } finally {
                        in.close();
                    }
                } catch (Throwable t) {
                    b = null;
                }
                if (b == null) return;
                synchronized (SHEETS) {
                    if (SHEETS.size() >= 3) SHEETS.clear();
                    SHEETS.put(file, b);
                }
                final Bitmap fb = b;
                post(new Runnable() {
                    @Override
                    public void run() {
                        sheet = fb;
                        invalidate();
                    }
                });
            }
        });
    }

    @Override
    protected void onDraw(Canvas cv) {
        super.onDraw(cv);
        float w = getWidth(), h = getHeight();
        float room = h - 40f * dpr;
        Bitmap s = sheet;
        if (s != null && room > 0f) {
            int cell = s.getWidth() / 4;
            src.set((frame % 4) * cell, 0, (frame % 4) * cell + cell, cell);
            dst.set((w - room) / 2f, 8f * dpr, (w + room) / 2f, 8f * dpr + room);
            cv.drawBitmap(s, src, dst, p);
        }
        cv.drawText(label, w / 2f, h - 14f * dpr, tp);
    }
}
