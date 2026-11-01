package com.dullyyj.kids;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;

/**
 * 길동무 친구들 꾸미기 — 모든 것을 한 장에 그리는 네이티브 화면. 무엇을 입었는지·어디에 놓일지는 엔진(Dress · Wardrobe)이 계산하고
 * 여기는 그것을 그리기만 한다. 누르면 같은 틱에 엔진이 답하고 그 자리에서 다시 그려서(서버·화면 재구성 없음) 0.1초 안에 바뀐다.
 */
final class DressView extends View {
    private final Dress d = Dress.I;
    private final float dp;
    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final Paint tp = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final WearDraw.P pen = new WearDraw.P();
    private final Rect src = new Rect();
    private final RectF dst = new RectF(), tmp = new RectF();
    private final RectF avR = new RectF(), offR = new RectF();
    private final RectF[] chipR = new RectF[8], tabR = new RectF[3], gridR = new RectF[Wardrobe.PER];
    private final Runnable inv = new Runnable() {
        @Override
        public void run() {
            invalidate();
        }
    };
    private int downKind = -1, downIdx = -1;      // 눌러 둔 곳: 0 친구 · 1 탭 · 2 벗기기 · 3 아이템
    private float downX, downY;
    private int pulseIdx = -1;
    private long pulseT = 0L;
    private float contentH;

    DressView(Context c) {
        super(c);
        dp = c.getResources().getDisplayMetrics().density;
        tp.setTypeface(Ui.face(c, true));
        for (int i = 0; i < chipR.length; i++) chipR[i] = new RectF();
        for (int i = 0; i < tabR.length; i++) tabR[i] = new RectF();
        for (int i = 0; i < gridR.length; i++) gridR[i] = new RectF();
    }

    private float dp(float v) {
        return v * dp;
    }

    @Override
    protected void onMeasure(int ws, int hs) {
        int w = MeasureSpec.getSize(ws);
        lay(w);
        setMeasuredDimension(w, Math.round(contentH));
    }

    private void lay(float w) {
        float y = 0f;
        float avH = Math.min(dp(168), w * 0.52f);
        avR.set(0, 0, w, avH);
        y = avH + dp(10);
        float gap = dp(6), cw = (w - gap * 3) / 4f, ch = dp(32);
        for (int i = 0; i < 8; i++) {
            int r = i / 4, c = i % 4;
            chipR[i].set(c * (cw + gap), y + r * (ch + gap), c * (cw + gap) + cw, y + r * (ch + gap) + ch);
        }
        y += ch * 2 + gap + dp(10);
        float th = dp(34), tw = (w - gap * 3) / 4f;
        for (int i = 0; i < 3; i++) tabR[i].set(i * (tw + gap), y, i * (tw + gap) + tw, y + th);
        offR.set(3 * (tw + gap), y, w, y + th);
        y += th + dp(8) + dp(22) + dp(4);              // 줄 이름 한 줄
        float g = dp(6), cell = (w - g * 4) / 5f;
        for (int i = 0; i < gridR.length; i++) {
            int r = i / 5, c = i % 5;
            gridR[i].set(c * (cell + g), y + r * (cell + g), c * (cell + g) + cell, y + r * (cell + g) + cell);
        }
        contentH = y + 4 * (cell + g);
    }

    @Override
    protected void onDraw(Canvas cv) {
        float w = getWidth();
        if (w <= 0) return;
        if (contentH <= 0f) lay(w);
        int ci = d.sel(), slot = d.tab();
        long now = SystemClock.uptimeMillis();
        boolean moving = false;
        // ── 미리보기: 걷는 모습에 입은 것 그대로 ──
        p.setStyle(Paint.Style.FILL);
        p.setColor(Pal.c(Pal.IMGBG));
        cv.drawRoundRect(avR, dp(18), dp(18), p);
        String id = Wardrobe.IDS[ci];
        Bitmap b = Core.sheets == null ? null : Core.sheets.get(Sheets.walkFile(id), inv);
        float room = Math.min(avR.height() - dp(30), w * 0.6f);
        if (b != null) {
            int cs = b.getWidth() / 4, cell = (int) ((now / 140L) % 4L);
            float bob = (float) Math.sin(now / 140.0 * Math.PI / 2) * dp(1.5f);
            src.set(cell * cs, 0, cell * cs + cs, cs);
            float l = (w - room) / 2f, t = dp(6) + bob;
            dst.set(l, t, l + room, t + room);
            cv.drawBitmap(b, src, dst, p);
            WearDraw.worn(cv, pen, d.look(id), ci, 0, cell, l, t, room);
            moving = true;
        }
        tp.setTextAlign(Paint.Align.CENTER);
        tp.setTextSize(dp(13));
        tp.setColor(Pal.c(Pal.TEXT));
        cv.drawText(Engine.CAST[ci][1], w / 2f, avR.bottom - dp(9), tp);
        // ── 친구 고르기 ──
        tp.setTextSize(dp(13));
        for (int i = 0; i < 8; i++) {
            chip(cv, chipR[i], Engine.CAST[i][1], i == ci, downKind == 0 && downIdx == i, false);
        }
        // ── 탭 ──
        for (int i = 0; i < 3; i++) chip(cv, tabR[i], Wardrobe.SLOT_KO[i], i == slot, downKind == 1 && downIdx == i, false);
        chip(cv, offR, "벗기기", false, downKind == 2, d.worn(ci, slot) < 0);
        // ── 입은 것 이름 ──
        int wi = d.worn(ci, slot);
        tp.setTextAlign(Paint.Align.LEFT);
        tp.setTextSize(dp(12.5f));
        tp.setColor(wi >= 0 ? Pal.c(Pal.TEXT) : Pal.c(Pal.SUB));
        cv.drawText(wi >= 0 ? Wardrobe.name(ci, slot, wi) : "마음에 드는 것을 눌러 입혀 보세요", 2f * dp, tabR[0].bottom + dp(24), tp);
        // ── 아이템 20개 ──
        float cs0 = gridR[0].width();
        for (int i = 0; i < Wardrobe.PER; i++) {
            RectF r = gridR[i];
            boolean on = i == wi, press = downKind == 3 && downIdx == i;
            float pu = 0f;
            if (i == pulseIdx) {
                float f = (now - pulseT) / 150f;
                if (f < 1f) {
                    pu = (float) Math.sin(f * Math.PI) * 0.12f;
                    moving = true;
                } else pulseIdx = -1;
            }
            cv.save();
            cv.scale(1f + pu - (press ? 0.06f : 0f), 1f + pu - (press ? 0.06f : 0f), r.centerX(), r.centerY());
            p.setStyle(Paint.Style.FILL);
            p.setColor(on ? blend(Pal.c(Pal.GOLD), Pal.c(Pal.CARD), 0.82f) : Pal.c(Pal.CARD));
            cv.drawRoundRect(r, dp(12), dp(12), p);
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(on ? dp(2) : dp(1));
            p.setColor(on ? Pal.c(Pal.GOLD) : Pal.c(Pal.BORDER));
            cv.drawRoundRect(r, dp(12), dp(12), p);
            p.setStyle(Paint.Style.FILL);
            pen.c = cv;
            float u = cs0 * (slot == 2 ? 0.62f : 0.66f), cy = r.centerY() + u * (slot == 0 ? 0.28f : slot == 1 ? -0.14f : 0.08f);
            Art.draw(pen, d.ops(ci, slot, i), r.centerX(), cy, u);
            cv.restore();
        }
        if (moving) {
            removeCallbacks(inv);
            postDelayed(inv, 33L);
        }
    }

    private static int blend(int a, int b, float t) {
        int r = (int) (((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t), g = (int) (((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t), bl = (int) ((a & 255) * (1 - t) + (b & 255) * t);
        return 0xFF000000 | (r << 16) | (g << 8) | bl;
    }

    private void chip(Canvas cv, RectF r, String s, boolean on, boolean press, boolean dim) {
        p.setStyle(Paint.Style.FILL);
        p.setColor(on ? Pal.c(Pal.GOLD) : press ? Pal.c(Pal.BORDER) : Pal.c(Pal.CARD));
        cv.drawRoundRect(r, dp(16), dp(16), p);
        if (!on) {
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(dp(1));
            p.setColor(Pal.c(Pal.BORDER));
            cv.drawRoundRect(r, dp(16), dp(16), p);
            p.setStyle(Paint.Style.FILL);
        }
        tp.setTextAlign(Paint.Align.CENTER);
        tp.setTextSize(dp(13));
        tp.setColor(on ? 0xFFFFFFFF : dim ? Pal.c(Pal.SUB) : Pal.c(Pal.TEXT));
        cv.drawText(s, r.centerX(), r.centerY() + dp(4.5f), tp);
    }

    private boolean hit(float x, float y, boolean down) {
        for (int i = 0; i < 8; i++) if (chipR[i].contains(x, y)) { if (down) { downKind = 0; downIdx = i; } return true; }
        for (int i = 0; i < 3; i++) if (tabR[i].contains(x, y)) { if (down) { downKind = 1; downIdx = i; } return true; }
        if (offR.contains(x, y)) { if (down) { downKind = 2; downIdx = 0; } return true; }
        for (int i = 0; i < Wardrobe.PER; i++) if (gridR[i].contains(x, y)) { if (down) { downKind = 3; downIdx = i; } return true; }
        return false;
    }

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        int a = e.getActionMasked();
        if (a == MotionEvent.ACTION_DOWN) {
            downX = e.getX();
            downY = e.getY();
            downKind = -1;
            if (hit(downX, downY, true)) {
                invalidate();                       // 누르는 즉시 눌린 모양
                return true;
            }
            return false;                           // 빈 곳은 창이 받아 민다
        }
        if (a == MotionEvent.ACTION_MOVE) {
            if (downKind >= 0 && (Math.abs(e.getY() - downY) > dp(14) || Math.abs(e.getX() - downX) > dp(14))) {
                downKind = -1;
                invalidate();
                getParent().requestDisallowInterceptTouchEvent(false);
            }
            return downKind >= 0;
        }
        if (a == MotionEvent.ACTION_CANCEL) {
            downKind = -1;
            invalidate();
            return true;
        }
        if (a == MotionEvent.ACTION_UP) {
            int k = downKind, i = downIdx;
            downKind = -1;
            if (k >= 0 && hit(e.getX(), e.getY(), false)) {
                int slot = d.tab();
                String v = k == 0 ? "dress.sel:" + i : k == 1 ? "dress.tab:" + Wardrobe.SLOT[i] : k == 2 ? "dress.off:" + Wardrobe.SLOT[slot] : "dress.eq:" + Wardrobe.SLOT[slot] + ":" + i;
                if (d.act(v)) {
                    Buzz.play(getContext(), "tap");
                    if (k == 3) {
                        pulseIdx = i;
                        pulseT = SystemClock.uptimeMillis();
                    }
                }
            }
            invalidate();
            return true;
        }
        return true;
    }

    @Override
    protected void onDetachedFromWindow() {
        removeCallbacks(inv);
        super.onDetachedFromWindow();
    }
}
