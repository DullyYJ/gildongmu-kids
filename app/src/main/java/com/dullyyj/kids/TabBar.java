package com.dullyyj.kids;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.view.MotionEvent;
import android.view.View;

import androidx.core.graphics.PathParser;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;

/** 하단 탭 막대 — 엔진이 내려준 탭 목록(글자·아이콘 경로·켜진 칸)을 그리기만 한다. */
final class TabBar extends View {
    interface Cb {
        void tab(String id);
    }

    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final ArrayList<String> ids = new ArrayList<String>();
    private final ArrayList<String> labels = new ArrayList<String>();
    private final ArrayList<Path> paths = new ArrayList<Path>();
    private final ArrayList<Boolean> ons = new ArrayList<Boolean>();
    private Cb cb;

    TabBar(Context c) {
        super(c);
    }

    int count() {
        return ids.size();
    }

    void set(String json, Cb cb) {
        this.cb = cb;
        ids.clear();
        labels.clear();
        paths.clear();
        ons.clear();
        try {
            JSONArray a = new JSONObject(json).optJSONArray("tabs");
            if (a != null) {
                for (int i = 0; i < a.length(); i++) {
                    JSONObject t = a.optJSONObject(i);
                    if (t == null) continue;
                    ids.add(t.optString("id"));
                    labels.add(t.optString("label"));
                    ons.add(t.optInt("on") == 1);
                    Path pa = null;
                    try {
                        pa = PathParser.createPathFromPathData(t.optString("icon"));
                    } catch (Throwable e) {
                        pa = null;
                    }
                    paths.add(pa);
                }
            }
        } catch (Exception e) {
            // 잘못된 화면은 그리지 않는다
        }
        invalidate();
    }

    private float dp(float v) {
        return v * getResources().getDisplayMetrics().density;
    }

    @Override
    protected void onMeasure(int w, int h) {
        setMeasuredDimension(MeasureSpec.getSize(w), Math.round(dp(58f)));
    }

    @Override
    protected void onDraw(Canvas c) {
        int w = getWidth(), h = getHeight();
        p.setStyle(Paint.Style.FILL);
        p.setColor(Pal.c(Pal.NAV));
        c.drawRect(0, 0, w, h, p);
        p.setColor(Pal.c(Pal.BORDER));
        c.drawRect(0, 0, w, Math.max(1f, dp(0.6f)), p);
        int n = ids.size();
        if (n == 0) return;
        float cw = w / (float) n, ic = dp(24f);
        for (int i = 0; i < n; i++) {
            boolean on = ons.get(i);
            int col = on ? Pal.c(Pal.GOLD) : Pal.c(Pal.SUB);
            float cx = cw * (i + 0.5f);
            Path pa = paths.get(i);
            p.setColor(col);
            p.setStyle(Paint.Style.FILL);
            if (pa != null) {
                c.save();
                c.translate(cx - ic / 2f, dp(8f));
                c.scale(ic / 24f, ic / 24f);
                c.drawPath(pa, p);
                c.restore();
            }
            p.setTextAlign(Paint.Align.CENTER);
            p.setTextSize(dp(10.5f));
            p.setFakeBoldText(on);
            c.drawText(labels.get(i), cx, dp(48f), p);
            p.setFakeBoldText(false);
        }
    }

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        if (e.getAction() == MotionEvent.ACTION_DOWN) return ids.size() > 0;
        if (e.getAction() == MotionEvent.ACTION_UP && ids.size() > 0 && cb != null) {
            int i = (int) (e.getX() / (getWidth() / (float) ids.size()));
            if (i >= 0 && i < ids.size()) cb.tab(ids.get(i));
            return true;
        }
        return true;
    }
}
