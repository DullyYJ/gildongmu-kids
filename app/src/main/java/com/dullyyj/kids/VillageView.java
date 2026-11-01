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

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Random;

/**
 * 길동무마을 — 엔진이 알려 준 친구들(걷기/동작 칸/가만히, 말풍선, 응가 수)을 프레임 시트로 그리기만 한다.
 * 돌아다니는 위치는 그림 움직임일 뿐이라 이 화면 안에서 정한다. 시트는 Sheets 가 뒤에서 읽는다.
 */
final class VillageView extends View {
    interface Cb {
        void act(String v);
    }

    private static final class A {
        String id = "", name = "", mode = "walk", bubble = "";
        int cell = -1, poop = 0;
        float x, tx, lane, dir = 1f, wait;
        long phase;
        final RectF hit = new RectF();
        final RectF[] poopHit = {new RectF(), new RectF(), new RectF()};
    }

    private final Random rnd = new Random();
    private final HashMap<String, A> byId = new HashMap<String, A>();
    private final ArrayList<A> order = new ArrayList<A>();
    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final Rect src = new Rect();
    private final RectF dst = new RectF();
    private final RectF tmp = new RectF();
    private final Runnable inv = new Runnable() {
        @Override
        public void run() {
            invalidate();
        }
    };
    private String last = "";
    private String sel = "";
    private long lastT = 0L;
    private float downX, downY;
    private Cb cb;
    private boolean primed = false; // 첫 그림이 놓인 뒤의 변화에만 진동(화면에 들어올 때는 울리지 않는다)

    VillageView(Context c) {
        super(c);
    }

    void setCb(Cb cb) {
        this.cb = cb;
    }

    private float dp(float v) {
        return v * getResources().getDisplayMetrics().density;
    }

    void set(String json) {
        if (json == null || json.equals(last)) return;
        last = json;
        try {
            JSONObject o = new JSONObject(json);
            sel = o.optString("sel", "");
            JSONArray a = o.optJSONArray("friends");
            if (a == null) return;
            HashMap<String, A> keep = new HashMap<String, A>();
            order.clear();
            for (int i = 0; i < a.length(); i++) {
                JSONObject f = a.optJSONObject(i);
                if (f == null) continue;
                String id = f.optString("id");
                A x = byId.get(id);
                if (x == null) {
                    x = new A();
                    x.id = id;
                    x.x = 0.1f + rnd.nextFloat() * 0.8f;
                    x.tx = x.x;
                    x.phase = rnd.nextInt(1000);
                    x.wait = rnd.nextFloat() * 2f;
                }
                x.lane = 0.12f + 0.76f * ((i * 5) % 8) / 7f;
                x.name = f.optString("name");
                String nm = f.optString("mode", "walk");
                if (primed && "cell".equals(nm) && !"cell".equals(x.mode)) Buzz.play(getContext(), "grin"); // 동작을 시작했다
                x.mode = nm;
                x.cell = f.optInt("cell", -1);
                x.bubble = f.optString("bubble", "");
                int np = Math.max(0, Math.min(3, f.optInt("poop", 0)));
                if (primed && np > x.poop) Buzz.play(getContext(), "thud"); // 응가를 쌌다
                x.poop = np;
                keep.put(id, x);
                order.add(x);
            }
            byId.clear();
            byId.putAll(keep);
            primed = true;
            for (int i = 1; i < order.size(); i++) { // 뒤에 있는(위쪽) 친구부터 그린다
                A k = order.get(i);
                int j = i - 1;
                while (j >= 0 && order.get(j).lane > k.lane) {
                    order.set(j + 1, order.get(j));
                    j--;
                }
                order.set(j + 1, k);
            }
        } catch (Exception e) {
            // 잘못된 데이터는 무시
        }
        invalidate();
    }

    private void move(A x, float dt) {
        if (!"walk".equals(x.mode)) return;
        if (x.wait > 0f) {
            x.wait -= dt;
            return;
        }
        float d = x.tx - x.x;
        if (Math.abs(d) < 0.01f) {
            x.wait = 0.6f + rnd.nextFloat() * 3f;
            x.tx = 0.08f + rnd.nextFloat() * 0.84f;
            return;
        }
        x.dir = d > 0f ? 1f : -1f;
        float sp = 0.07f * dt;
        x.x += Math.abs(d) < sp ? d : x.dir * sp;
    }

    @Override
    protected void onDraw(Canvas c) {
        long now = SystemClock.uptimeMillis();
        float dt = lastT == 0L ? 0.033f : Math.min(0.1f, (now - lastT) / 1000f);
        lastT = now;
        float w = getWidth(), h = getHeight();
        if (w <= 0 || h <= 0) return;
        // 하늘·풀밭
        p.setStyle(Paint.Style.FILL);
        p.setColor(Pal.c(Pal.IMGBG));
        tmp.set(0, 0, w, h);
        c.drawRoundRect(tmp, dp(18), dp(18), p);
        p.setColor(Pal.dark ? 0xFF2F4A2A : 0xFFB5E08F);
        c.save();
        c.clipRect(0, h * 0.34f, w, h);
        tmp.set(0, -dp(30), w, h);
        c.drawRoundRect(tmp, dp(18), dp(18), p);
        c.restore();
        p.setColor(Pal.c(Pal.SUB));
        p.setTextAlign(Paint.Align.LEFT);
        p.setTextSize(dp(11));
        c.drawText("길동무마을", dp(12), dp(20), p);

        float base = Math.min(w * 0.30f, h * 0.44f);
        for (int i = 0; i < order.size(); i++) {
            A x = order.get(i);
            move(x, dt);
            float sc = 0.78f + 0.22f * x.lane;
            float s = base * sc;
            float feet = h * (0.42f + 0.50f * x.lane);
            float cx = w * (0.08f + 0.84f * x.x);
            float left = cx - s / 2f, top = feet - s * 0.92f;
            x.hit.set(left, top, left + s, feet + dp(4));
            if (x.id.equals(sel)) {
                p.setStyle(Paint.Style.STROKE);
                p.setStrokeWidth(dp(2));
                p.setColor(Pal.c(Pal.GOLD));
                tmp.set(cx - s * 0.36f, feet - s * 0.07f, cx + s * 0.36f, feet + s * 0.07f);
                c.drawOval(tmp, p);
                p.setStyle(Paint.Style.FILL);
            }
            drawSprite(c, x, now, left, top, s);
            // 응가
            p.setTextSize(dp(22));
            p.setTextAlign(Paint.Align.CENTER);
            p.setColor(0xFF000000);
            for (int k = 0; k < 3; k++) {
                if (k < x.poop) {
                    float px = cx + s * 0.32f + k * dp(20);
                    float py = feet + dp(2);
                    c.drawText("💩", px, py, p);
                    x.poopHit[k].set(px - dp(16), py - dp(26), px + dp(16), py + dp(8));
                } else {
                    x.poopHit[k].setEmpty();
                }
            }
            // 이름
            p.setTextSize(dp(11));
            p.setFakeBoldText(true);
            p.setColor(x.id.equals(sel) ? Pal.c(Pal.GOLD) : Pal.c(Pal.TEXT));
            c.drawText(x.name, cx, feet + dp(15), p);
            p.setFakeBoldText(false);
            // 말풍선
            if (x.bubble != null && !x.bubble.isEmpty()) drawBubble(c, x.bubble, cx, top + s * 0.08f, w);
        }
        removeCallbacks(inv);
        postDelayed(inv, 33L);
    }

    private void drawSprite(Canvas c, A x, long now, float left, float top, float s) {
        boolean act = "cell".equals(x.mode) && x.cell >= 0;
        String file = act ? Sheets.actFile(x.id) : Sheets.walkFile(x.id);
        Bitmap b = Core.sheets.get(file, inv);
        if (b == null) {
            p.setColor(Pal.c(Pal.BORDER));
            c.drawCircle(left + s / 2f, top + s * 0.6f, s * 0.3f, p);
            return;
        }
        int cs = b.getWidth() / 4;
        int idx;
        float bob = 0f;
        if (act) {
            idx = x.cell;
            bob = (float) Math.sin((now + x.phase) / 260.0) * dp(2);
        } else if ("still".equals(x.mode)) {
            idx = 0;
        } else {
            boolean moving = x.wait <= 0f;
            idx = moving ? (int) (((now + x.phase) / 62L) % 16L) : 0;
        }
        src.set((idx % 4) * cs, (idx / 4) * cs, (idx % 4) * cs + cs, (idx / 4) * cs + cs);
        dst.set(left, top + bob, left + s, top + s + bob);
        boolean flip = !act && x.dir < 0f;
        if (flip) {
            c.save();
            c.scale(-1f, 1f, left + s / 2f, 0f);
        }
        c.drawBitmap(b, src, dst, p);
        if (flip) c.restore();
    }

    private void drawBubble(Canvas c, String t, float cx, float y, float w) {
        p.setTextSize(dp(12));
        p.setTextAlign(Paint.Align.CENTER);
        float tw = p.measureText(t);
        float bw = tw + dp(18), bh = dp(26);
        float l = Math.max(dp(4), Math.min(w - bw - dp(4), cx - bw / 2f));
        float tp = Math.max(dp(26), y - bh);
        tmp.set(l, tp, l + bw, tp + bh);
        p.setStyle(Paint.Style.FILL);
        p.setColor(Pal.c(Pal.CARD));
        c.drawRoundRect(tmp, dp(13), dp(13), p);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(dp(1));
        p.setColor(Pal.c(Pal.BORDER2));
        c.drawRoundRect(tmp, dp(13), dp(13), p);
        p.setStyle(Paint.Style.FILL);
        p.setColor(Pal.c(Pal.TEXT));
        c.drawText(t, l + bw / 2f, tp + dp(17.5f), p);
    }

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        int a = e.getActionMasked();
        if (a == MotionEvent.ACTION_DOWN) {
            downX = e.getX();
            downY = e.getY();
            return true;
        }
        if (a == MotionEvent.ACTION_UP) {
            if (Math.abs(e.getX() - downX) > dp(12) || Math.abs(e.getY() - downY) > dp(12)) return true;
            float x = e.getX(), y = e.getY();
            for (int i = order.size() - 1; i >= 0; i--) { // 앞에 있는 것부터
                A f = order.get(i);
                for (int k = 2; k >= 0; k--) {
                    if (!f.poopHit[k].isEmpty() && f.poopHit[k].contains(x, y)) {
                        if (cb != null) { Buzz.play(getContext(), "squirt"); cb.act("clean:" + f.id); }
                        return true;
                    }
                }
            }
            for (int i = order.size() - 1; i >= 0; i--) {
                A f = order.get(i);
                if (f.hit.contains(x, y)) {
                    if (cb != null) { Buzz.play(getContext(), Buzz.landOf(f.id)); cb.act("sel:" + f.id); }
                    return true;
                }
            }
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
