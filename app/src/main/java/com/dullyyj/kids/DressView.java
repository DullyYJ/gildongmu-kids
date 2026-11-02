package com.dullyyj.kids;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.VelocityTracker;
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
    private final RectF avR = new RectF(), offR = new RectF(), stripR = new RectF();
    private final float[] spr = new float[3];
    private float scrollX, scrollV, scrollTo = -1f, stripCw, stripGap, stripContent;
    private int lastSel = -1, pfCi = -1, pfSlot = -1;
    private long lastFrame = 0L;
    private VelocityTracker vt;
    private boolean dragging, avSwipe;
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
        float gap = dp(6), ch = dp(36);
        stripGap = dp(8);
        stripCw = dp(76);                               // 이름 한 줄: 한 칸 폭 고정, 넘치면 좌우로 밀어 고른다
        stripContent = 8 * stripCw + 7 * stripGap;
        stripR.set(0, y, w, y + ch);
        y += ch + dp(10);
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
        if (ci != pfCi || slot != pfSlot) {            // 친구 · 탭을 바꾸면 그 탭의 구운 옷 시트를 미리 읽어 둔다
            pfCi = ci;
            pfSlot = slot;
            WearImg.prefetch(ci, slot, inv);
            WearImg.prefetch(ci, slot == 0 ? 1 : 0, inv);
        }
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
        // ── 친구 고르기: 이름 한 줄, 좌우로 밀어서 고른다 ──
        if (stepStrip(now, w, ci)) moving = true;
        cv.save();
        cv.clipRect(stripR);
        for (int i = 0; i < 8; i++) {
            float x0 = i * (stripCw + stripGap) - scrollX;
            chipR[i].set(x0, stripR.top, x0 + stripCw, stripR.bottom);
            if (chipR[i].right < 0 || chipR[i].left > w) continue;
            chip(cv, chipR[i], Engine.CAST[i][1], i == ci, downKind == 0 && downIdx == i, false);
        }
        cv.restore();
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
        Bitmap atlas = Core.sheets == null ? null : Core.sheets.get("wear_" + id, inv);
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
            if (atlas != null) {                                       // 3D 로 그려 둔 그림(칸 가득)
                int k = slot * Wardrobe.PER + i;
                float sz = r.width() * 0.90f;
                src.set((k % Wardrobe.GRID) * Wardrobe.CELL, (k / Wardrobe.GRID) * Wardrobe.CELL, (k % Wardrobe.GRID + 1) * Wardrobe.CELL, (k / Wardrobe.GRID + 1) * Wardrobe.CELL);
                tmp.set(r.centerX() - sz / 2f, r.centerY() - sz / 2f, r.centerX() + sz / 2f, r.centerY() + sz / 2f);
                cv.drawBitmap(atlas, src, tmp, p);
            } else {
                float u = cs0 * (slot == 2 ? 0.62f : 0.66f), cy = r.centerY() + u * (slot == 0 ? 0.28f : slot == 1 ? -0.14f : 0.08f);
                Art.draw(pen, d.ops(ci, slot, i), r.centerX(), cy, u);
            }
            cv.restore();
        }
        if (moving) {
            removeCallbacks(inv);
            postDelayed(inv, 33L);
        }
    }

    /** 이름 줄의 밀림 계산: 손가락을 뗀 뒤 미끄러지기(감속) · 고른 친구를 가운데로. 움직이는 중이면 true. */
    private boolean stepStrip(long now, float w, int ci) {
        float dt = lastFrame == 0L ? 0.016f : Math.min(0.05f, (now - lastFrame) / 1000f);
        lastFrame = now;
        float max = Math.max(0f, stripContent - w);
        boolean mv = false;
        if (ci != lastSel) {                       // 고른 친구가 바뀌면(눌러서 · 좌우로 넘겨서) 그 이름이 보이게 가운데로
            lastSel = ci;
            if (!dragging) {
                float c = ci * (stripCw + stripGap) + stripCw / 2f - w / 2f;
                scrollTo = Math.max(0f, Math.min(max, c));
            }
        }
        if (!dragging) {
            if (scrollTo >= 0f) {
                float d = scrollTo - scrollX;
                if (Math.abs(d) < 0.5f) { scrollX = scrollTo; scrollTo = -1f; }
                else { scrollX += d * Math.min(1f, dt * 16f); mv = true; }
                scrollV = 0f;
            } else if (Math.abs(scrollV) > dp(12)) {
                scrollX += scrollV * dt;
                scrollV *= (float) Math.pow(0.04, dt);            // 약 0.7초에 걸쳐 멈춘다
                mv = true;
            } else scrollV = 0f;
        }
        if (scrollX < 0f) { scrollX = 0f; scrollV = 0f; }
        if (scrollX > max) { scrollX = max; scrollV = 0f; }
        return mv || dragging;
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
        if (stripR.contains(x, y)) {
            for (int i = 0; i < 8; i++) if (chipR[i].contains(x, y)) { if (down) { downKind = 0; downIdx = i; } return true; }
            return false;
        }
        for (int i = 0; i < 3; i++) if (tabR[i].contains(x, y)) { if (down) { downKind = 1; downIdx = i; } return true; }
        if (offR.contains(x, y)) { if (down) { downKind = 2; downIdx = 0; } return true; }
        for (int i = 0; i < Wardrobe.PER; i++) if (gridR[i].contains(x, y)) { if (down) { downKind = 3; downIdx = i; } return true; }
        return false;
    }

    private float lastX;
    private boolean inStrip;

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        int a = e.getActionMasked();
        if (a == MotionEvent.ACTION_DOWN) {
            downX = lastX = e.getX();
            downY = e.getY();
            downKind = -1;
            dragging = false;
            avSwipe = avR.contains(downX, downY);
            inStrip = stripR.contains(downX, downY);
            if (inStrip) {                                  // 이름 줄: 밀던 것을 멈추고 손가락 속도를 재기 시작
                scrollV = 0f;
                scrollTo = -1f;
                if (vt != null) vt.recycle();
                vt = VelocityTracker.obtain();
                vt.addMovement(e);
            }
            if (hit(downX, downY, true) || avSwipe || inStrip) {
                invalidate();                       // 누르는 즉시 눌린 모양
                return true;
            }
            return false;                           // 빈 곳은 창이 받아 민다
        }
        if (a == MotionEvent.ACTION_MOVE) {
            float dx = e.getX() - downX, dy = e.getY() - downY;
            if (dragging) {
                scrollX -= e.getX() - lastX;
                lastX = e.getX();
                if (vt != null) vt.addMovement(e);
                invalidate();
                return true;
            }
            if (inStrip) {
                if (vt != null) vt.addMovement(e);
                if (Math.abs(dx) > dp(8) && Math.abs(dx) > Math.abs(dy)) {      // 좌우로 밀기 시작
                    dragging = true;
                    downKind = -1;
                    lastX = e.getX();
                    getParent().requestDisallowInterceptTouchEvent(true);
                    invalidate();
                } else if (Math.abs(dy) > dp(14)) {
                    downKind = -1;
                    inStrip = false;
                    getParent().requestDisallowInterceptTouchEvent(false);
                }
                return true;
            }
            if (avSwipe) {                                  // 친구 그림 위에서 좌우로 넘기기
                if (Math.abs(dx) > dp(10) && Math.abs(dx) > Math.abs(dy)) getParent().requestDisallowInterceptTouchEvent(true);
                else if (Math.abs(dy) > dp(14)) {
                    avSwipe = false;
                    getParent().requestDisallowInterceptTouchEvent(false);
                }
                return true;
            }
            if (downKind >= 0 && (Math.abs(dy) > dp(14) || Math.abs(dx) > dp(14))) {
                downKind = -1;
                invalidate();
                getParent().requestDisallowInterceptTouchEvent(false);
            }
            return downKind >= 0;
        }
        if (a == MotionEvent.ACTION_CANCEL) {
            downKind = -1;
            dragging = false;
            avSwipe = false;
            inStrip = false;
            if (vt != null) { vt.recycle(); vt = null; }
            invalidate();
            return true;
        }
        if (a == MotionEvent.ACTION_UP) {
            int k = downKind, i = downIdx;
            downKind = -1;
            if (dragging) {                                  // 손가락을 뗐다: 속도만큼 미끄러진다
                if (vt != null) {
                    vt.addMovement(e);
                    vt.computeCurrentVelocity(1000);
                    scrollV = -vt.getXVelocity();
                }
                dragging = false;
                lastFrame = 0L;
                if (vt != null) { vt.recycle(); vt = null; }
                inStrip = false;
                invalidate();
                return true;
            }
            if (vt != null) { vt.recycle(); vt = null; }
            inStrip = false;
            if (avSwipe) {
                avSwipe = false;
                float dx = e.getX() - downX, dy = e.getY() - downY;
                if (Math.abs(dx) > dp(40) && Math.abs(dx) > Math.abs(dy) * 1.5f) {
                    int n = (d.sel() + (dx < 0 ? 1 : 7)) % 8;      // 왼쪽으로 밀면 다음 친구 · 오른쪽이면 이전 친구
                    if (d.act("dress.sel:" + n)) Buzz.play(getContext(), "tap");
                }
                invalidate();
                return true;
            }
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
