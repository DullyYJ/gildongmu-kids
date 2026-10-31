package com.dullyyj.kids;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

/** 퀘스트 맨 위 스타포인트 줄 — 별 그림(직접 그린다)과 숫자. 서버가 준 값을 그리기만 하고, 값이 늘어난 순간에는 별이 한 번 톡 커진다. */
final class QuestStars {
    private static int last = -1;

    private QuestStars() {
    }

    /** 금색 별 하나(꼭지점 5개). */
    private static final class StarIcon extends View {
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Path path = new Path();

        StarIcon(Context c) {
            super(c);
            p.setStyle(Paint.Style.FILL);
        }

        @Override
        protected void onDraw(Canvas cv) {
            float w = getWidth(), h = getHeight(), cx = w / 2f, cy = h / 2f + h * 0.03f, ro = Math.min(w, h) / 2f, ri = ro * 0.46f;
            path.reset();
            for (int i = 0; i < 10; i++) {
                double a = -Math.PI / 2 + i * Math.PI / 5;
                float r = i % 2 == 0 ? ro : ri;
                float x = cx + (float) Math.cos(a) * r, y = cy + (float) Math.sin(a) * r;
                if (i == 0) path.moveTo(x, y);
                else path.lineTo(x, y);
            }
            path.close();
            p.setColor(Pal.c(Pal.GOLD));
            cv.drawPath(path, p);
            p.setColor(0x55FFFFFF);
            cv.drawCircle(cx - ro * 0.18f, cy - ro * 0.22f, ro * 0.16f, p);
        }
    }

    static View make(Context c, JSONObject b) {
        int n = Math.max(0, b.optInt("n", 0));
        LinearLayout r = new LinearLayout(c);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        int pad = Ui.dpi(c, 12);
        r.setPadding(pad + Ui.dpi(c, 2), pad, pad + Ui.dpi(c, 2), pad);
        r.setBackground(Ui.box(c, Pal.c(Pal.CARD), 16, Pal.c(Pal.BORDER)));
        StarIcon icon = new StarIcon(c);
        r.addView(icon, new LinearLayout.LayoutParams(Ui.dpi(c, 30), Ui.dpi(c, 30)));
        LinearLayout mid = new LinearLayout(c);
        mid.setOrientation(LinearLayout.VERTICAL);
        mid.addView(Ui.text(c, b.optString("label", "스타포인트"), 13f, Pal.c(Pal.TEXT), true));
        String sub = b.optString("sub", "");
        if (!sub.isEmpty()) {
            TextView st = Ui.text(c, sub, 11f, Pal.c(Pal.ORANGE), false);
            LinearLayout.LayoutParams sl = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            sl.topMargin = Ui.dpi(c, 2);
            mid.addView(st, sl);
        }
        LinearLayout.LayoutParams ml = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        ml.leftMargin = Ui.dpi(c, 10);
        r.addView(mid, ml);
        r.addView(Ui.text(c, String.valueOf(n), 22f, Pal.c(Pal.GOLD), true));
        if (last >= 0 && n > last) {
            icon.setScaleX(0.6f);
            icon.setScaleY(0.6f);
            icon.animate().scaleX(1f).scaleY(1f).setDuration(520L).setInterpolator(new android.view.animation.OvershootInterpolator(2.4f)).start();
        }
        last = n;
        return r;
    }
}
