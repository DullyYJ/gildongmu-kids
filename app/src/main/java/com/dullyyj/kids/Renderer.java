package com.dullyyj.kids;

import android.app.Activity;
import android.app.Dialog;
import android.content.Context;
import android.content.DialogInterface;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import com.dullyyj.subway.SceneHello;
import com.dullyyj.subway.ScreenCore;
import com.dullyyj.subway.ScreenView;
import com.dullyyj.subway.ScreenView;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;

import org.json.JSONArray;
import org.json.JSONObject;



/** 엔진이 내려준 화면 JSON(블록 목록)을 뷰로 그린다. 판단은 하지 않고, 눌린 것은 그대로 cb 로 넘긴다. */
final class Renderer {
    interface Cb {
        void call(String v, String arg);
    }

    private final Context ctx;
    private final Cb cb;
    private final FrameLayout host;
    private final ScrollView scroll;
    private final LinearLayout col;
    private final TextView loading;
    private final VillageView village;
    private MapPane mapPane;
    private ScreenView home;
    private Runnable refresh;
    private String draft = "";
    private String lastHead = "";
    private Dialog sheet;
    private ScrollView sheetScroll;
    private LinearLayout sheetCol;

    Renderer(Context c, Cb cb) {
        this.ctx = c;
        this.cb = cb;
        host = new FrameLayout(c);
        scroll = new ScrollView(c) {
            private float x0, y0;

            private boolean drag;

/** 퀘스트처럼 좌우로 넘기는 칸이면 손가락을 따라 아래 박스가 움직이고, 충분히 밀면 다음 칸으로 넘어간다. */
private boolean swiped(android.view.MotionEvent e) {
if (swipeActs == null || swipeActs.size() < 2) return swipedOld(e);
int act = e.getActionMasked();
if (act == android.view.MotionEvent.ACTION_DOWN) {
x0 = e.getX();
y0 = e.getY();
drag = false;
return false;
}
if (Float.isNaN(x0)) return false;
float dx = e.getX() - x0, dy = e.getY() - y0;
if (act == android.view.MotionEvent.ACTION_MOVE) {
if (!drag && Math.abs(dx) > Ui.dp(getContext(), 24f) && Math.abs(dx) > Math.abs(dy) * 1.8f) drag = true;
if (drag) {
LinearLayout tl = tailHold;
if (tl != null) tl.setTranslationX(dx * 0.45f);
return true;
}
return false;
}
if (act == android.view.MotionEvent.ACTION_UP || act == android.view.MotionEvent.ACTION_CANCEL) {
boolean was = drag;
drag = false;
if (!was) return false;
x0 = Float.NaN;
if (act == android.view.MotionEvent.ACTION_UP && Math.abs(dx) > Ui.dp(getContext(), 72f)) {
swipeBy(dx < 0 ? 1 : -1);
} else {
LinearLayout tl = tailHold;
if (tl != null) tl.animate().translationX(0f).setDuration(180L).start();
}
return true;
}
return false;
}

private boolean swipedOld(android.view.MotionEvent e) {
                int act = e.getActionMasked();
                if (act == android.view.MotionEvent.ACTION_DOWN) {
                    x0 = e.getX();
                    y0 = e.getY();
                } else if (act == android.view.MotionEvent.ACTION_UP && swipeActs != null && swipeActs.size() > 1) {
                    float dx = e.getX() - x0, dy = e.getY() - y0;
                    if (Math.abs(dx) > Ui.dp(getContext(), 72f) && Math.abs(dx) > Math.abs(dy) * 1.8f) {
                        x0 = Float.NaN;
                        swipeBy(dx < 0 ? 1 : -1);
                        return true;
                    }
                }
                return false;
            }

            @Override
            public boolean onInterceptTouchEvent(android.view.MotionEvent e) {
                if (swiped(e)) return true;
                return super.onInterceptTouchEvent(e);
            }

            @Override
            public boolean onTouchEvent(android.view.MotionEvent e) {
                if (swiped(e)) return true;
                return super.onTouchEvent(e);
            }
        };
        scroll.setVerticalScrollBarEnabled(false);
        col = new LinearLayout(c);
        scroll.setFillViewport(true);
        col.setOrientation(LinearLayout.VERTICAL);
        int pad = Ui.dpi(c, 16);
        col.setPadding(pad, Ui.dpi(c, 10), pad, Ui.dpi(c, 12));
        scroll.addView(col, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        host.addView(scroll, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        loading = new TextView(c);
        loading.setTextSize(14f);
        loading.setVisibility(View.GONE);
        host.addView(loading, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        village = new VillageView(c);
        village.setCb(new VillageView.Cb() {
            @Override
            public void act(String v) {
                Renderer.this.cb.call(v, "");
            }
        });
    }

    View view() {
        return host;
    }

    // 좌우로 밀어 넘기는 칸(퀘스트): 칩 줄이 loop 를 켜 두면 그 행동 목록을 돌려 쓴다.
    private java.util.ArrayList<String> swipeActs;
    private int swipeCur;
    private int slideDir;
    private View segView;
    private long slideAt;

    private LinearLayout tailHold;
private boolean warmed = false;

/** 칩 줄 아래 칸들을 한 덩어리로 묶는다. 칸이 바뀌면 옛 덩어리는 밀려 나가고 새 덩어리가 밀려 들어온다(칩 줄은 그대로 있다). */
private int tailBuild(int segAt) {
LinearLayout old = tailHold;
tailHold = null;
if (segAt < 0 || segAt > col.getChildCount()) return segAt;
final LinearLayout tail = new LinearLayout(ctx);
tail.setOrientation(LinearLayout.VERTICAL);
int n = col.getChildCount();
for (int i = segAt; i < n; i++) {
View c = col.getChildAt(segAt);
col.removeViewAt(segAt);
tail.addView(c);
}
final FrameLayout fr = new FrameLayout(ctx);
fr.addView(tail, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
col.addView(fr, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
tailHold = tail;
if (old != null && slideDir != 0 && android.os.SystemClock.uptimeMillis() - slideAt < 900L) {
final LinearLayout oldF = old;
final int d = slideDir;
if (old.getParent() instanceof ViewGroup) ((ViewGroup) old.getParent()).removeView(old);
float w = Math.max(1f, ctx.getResources().getDisplayMetrics().widthPixels - 2f * Ui.dpi(ctx, 16));
float from = old.getTranslationX();
android.view.animation.PathInterpolator ip = new android.view.animation.PathInterpolator(0.32f, 0.72f, 0f, 1f);
fr.addView(old, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
old.setAlpha(1f);
old.setTranslationX(from);
old.animate().translationX(-d * w).alpha(0f).setDuration(260L).setInterpolator(ip).withEndAction(new Runnable() {
@Override
public void run() {
fr.removeView(oldF);
}
}).start();
tail.setTranslationX(d * w);
tail.animate().translationX(0f).setDuration(260L).setInterpolator(ip).start();
}
return segAt;
}

/** 홈이 뜬 뒤 잠깐 있다가 노선도 화면과 지도 자료를 미리 만들어 둔다 — 노선도 탭을 처음 열 때 멈칫하지 않도록. */
private void warmMap() {
if (warmed || mapPane != null) return;
warmed = true;
host.postDelayed(new Runnable() {
@Override
public void run() {
if (mapPane != null) return;
try {
mapPane = new MapPane(ctx);
mapPane.setVisibility(View.INVISIBLE);                    // GONE 이면 크기가 없어 그림을 못 그린다 — INVISIBLE 로 두어 뒤에서 한 장 미리 그려 둔다
host.addView(mapPane, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
mapPane.setTheme(Pal.dark ? "dark" : "pastel");
mapPane.warm();
} catch (Throwable t) {
mapPane = null;
}
}
}, 1200L);
}

private void swipeBy(int dir) {
        java.util.ArrayList<String> a = swipeActs;
        if (a == null || a.size() < 2) return;
        int n = a.size();
        int to = ((swipeCur + dir) % n + n) % n;
        slideDir = dir;
        slideAt = android.os.SystemClock.uptimeMillis();
        cb.call(a.get(to), "");
    }

    void setRefresh(Runnable r) {
        refresh = r;
    }

    void village(String json) {
        village.set(json);
    }

    void destroy() {
        closeConsent();
        if (mapPane != null) mapPane.destroy();
    }

    // ───────── 처음 켰을 때 홈 위로 올라오는 동의 창 ─────────
    /** 동의 창 내용(블록 목록 JSON)을 보여 준다. 빈 글이면 창을 내린다. */
    /** 처음 동의 창(닫을 수 없는 창)은 카드 사이 · 안쪽 여백을 줄여 한 화면에 다 들어오게 한다. */
    private boolean snug;

    void consent(String json, boolean dismissible) {
        snug = !dismissible;
        if (json == null || json.isEmpty()) {
            closeConsent();
            return;
        }
        JSONObject o;
        try {
            o = new JSONObject(json);
        } catch (Exception e) {
            return;
        }
        if (sheet == null) openConsent(dismissible);
        if (sheet == null || sheetCol == null) return;
        final int sy = sheetScroll.getScrollY();
        sheetCol.removeAllViews();
        JSONArray bl = o.optJSONArray("blocks");
        if (bl != null) {
            for (int i = 0; i < bl.length(); i++) {
                JSONObject b = bl.optJSONObject(i);
                if (b == null) continue;
                View v = block(b);
                if (v != null) sheetCol.addView(v);
            }
        }
        sheetScroll.post(new Runnable() {
            @Override
            public void run() {
                sheetScroll.scrollTo(0, sy);
            }
        });
    }

    private void openConsent(final boolean dismissible) {
        try {
            final Dialog d = new Dialog(ctx, android.R.style.Theme_Material_Light_Dialog_NoActionBar);
            LinearLayout box = new LinearLayout(ctx);
            box.setOrientation(LinearLayout.VERTICAL);
            GradientDrawable g = new GradientDrawable();
            g.setColor(Pal.c(Pal.BG));
            float r = Ui.dpi(ctx, 24);
            g.setCornerRadius(r);
            box.setBackground(g);
            final int capPx = Math.round(ctx.getResources().getDisplayMetrics().heightPixels * (dismissible ? 0.8f : 0.92f));
            sheetScroll = new ScrollView(ctx) {
                @Override
                protected void onMeasure(int wSpec, int hSpec) {
                    super.onMeasure(wSpec, View.MeasureSpec.makeMeasureSpec(capPx, View.MeasureSpec.AT_MOST));
                }
            };
            sheetScroll.setVerticalScrollBarEnabled(false);
            sheetCol = new LinearLayout(ctx);
            sheetCol.setOrientation(LinearLayout.VERTICAL);
            int pad = Ui.dpi(ctx, 16);
            sheetCol.setPadding(pad, Ui.dpi(ctx, dismissible ? 16 : 12), pad, Ui.dpi(ctx, dismissible ? 20 : 14));
            sheetScroll.addView(sheetCol, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            box.addView(sheetScroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            d.setContentView(box);
            d.setCancelable(dismissible);
            d.setCanceledOnTouchOutside(dismissible);
            if (dismissible) {
                d.setOnCancelListener(new DialogInterface.OnCancelListener() {
                    @Override
                    public void onCancel(DialogInterface di) {
                        cb.call("dress.close", "");
                    }
                });
            } else {
                d.setOnKeyListener(new DialogInterface.OnKeyListener() {
                    @Override
                    public boolean onKey(DialogInterface di, int code, KeyEvent e) {
                        if (code == KeyEvent.KEYCODE_BACK && e.getAction() == KeyEvent.ACTION_UP) {
                            if (ctx instanceof Activity) ((Activity) ctx).finish();
                            return true;
                        }
                        return false;
                    }
                });
            }
            Window w = d.getWindow();
            int wpx = ctx.getResources().getDisplayMetrics().widthPixels - 2 * Ui.dpi(ctx, 20);
            w.setLayout(wpx, ViewGroup.LayoutParams.WRAP_CONTENT);
            w.setGravity(dismissible ? Gravity.BOTTOM : Gravity.CENTER);
            if (dismissible) {
                WindowManager.LayoutParams wl = w.getAttributes();
                wl.y = Ui.dpi(ctx, 72);
                w.setAttributes(wl);
            }
            w.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
            w.setBackgroundDrawable(new ColorDrawable(0));
            w.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            w.setDimAmount(0.45f);
            w.setWindowAnimations(android.R.style.Animation_Dialog);
            sheet = d;
            d.show();
        } catch (Throwable t) {
            sheet = null;
        }
    }

    private void closeConsent() {
        Dialog d = sheet;
        sheet = null;
        sheetCol = null;
        sheetScroll = null;
        if (d != null) {
            try {
                d.dismiss();
            } catch (Throwable t) {
                // 이미 닫힘
            }
        }
    }

    // ───────── 화면 한 장 ─────────
    void build(String json, ScreenCore.Screen pre) {
        JSONObject o;
        try {
            o = new JSONObject(json);
        } catch (Exception e) {
            return;
        }
        host.setBackgroundColor(Pal.c(Pal.BG));
        loading.setTextColor(Pal.c(Pal.SUB));
        String mode = o.optString("mode");
        if ("map".equals(mode)) {
            showMap();
            return;
        }
        revealGen++;
        if (mapPane != null) mapPane.setVisibility(View.INVISIBLE);
        if ("sv".equals(mode)) {
            showHome(pre);
warmMap();
            return;
        }
        if (home != null) home.setVisibility(View.GONE);
        loading.setVisibility(View.GONE);
        if (scroll.getVisibility() != View.VISIBLE) fadeIn(scroll);
scroll.setVisibility(View.VISIBLE);
        scroll.setBackgroundColor(Pal.c(Pal.BG));
        JSONArray bl = o.optJSONArray("blocks");
        String head = "";
        if (bl != null && bl.length() > 0 && bl.optJSONObject(0) != null) head = bl.optJSONObject(0).optString("text");
        final boolean same = head.equals(lastHead);
        lastHead = head;
        final int sy = same ? scroll.getScrollY() : 0;
        final boolean bottom = "1".equals(o.optString("bottom"));
        swipeActs = null;
        segView = null;
        int segAt = -1;
        col.removeAllViews();
        if (bl != null) {
            for (int i = 0; i < bl.length(); i++) {
                JSONObject b = bl.optJSONObject(i);
                if (b == null) continue;
                View v = block(b);
                if (v != null) {
                    col.addView(v);
                    if (v == segView) segAt = col.getChildCount();
                }
            }
        }
        segAt = tailBuild(segAt);
if (false) {
            for (int i = segAt; i < col.getChildCount(); i++) {
                View c = col.getChildAt(i);
                c.setAlpha(0f);
                c.setTranslationX(slideDir * Ui.dp(ctx, 48f));
                c.animate().alpha(1f).translationX(0f).setDuration(240L).setInterpolator(new android.view.animation.PathInterpolator(0.32f, 0.72f, 0f, 1f)).start();
            }
        }
        slideDir = 0;
        scroll.post(new Runnable() {
            @Override
            public void run() {
                if (bottom) scroll.fullScroll(View.FOCUS_DOWN);
                else scroll.scrollTo(0, sy);
            }
        });
    }

    /** 탭을 옮겨 새 화면이 나올 때 살짝 떠오른다(길동무 fadeIn 과 같은 240ms 감속). 갱신에는 쓰지 않는다. */
    private void fadeIn(View v) {
        try {
            v.animate().cancel();
            v.setAlpha(0.35f);
            v.animate().alpha(1f).setDuration(240L).setInterpolator(new android.view.animation.DecelerateInterpolator(1.4f)).start();
        } catch (Throwable t) {
            v.setAlpha(1f);
        }
    }

    private void showMap() {
        scroll.setVisibility(View.GONE);
        loading.setVisibility(View.GONE);
        if (home != null) home.setVisibility(View.GONE);
        if (mapPane == null) {
            mapPane = new MapPane(ctx);
            mapPane.setVisibility(View.INVISIBLE);
            host.addView(mapPane, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
        mapPane.setTheme(Pal.dark ? "dark" : "pastel");
        mapPane.onShow();
        if (mapPane.getVisibility() == View.VISIBLE) return;
        final int gen = ++revealGen;
        if (mapPane.ready()) {
            revealMap();
            return;
        }
        // 머리(칩 줄)와 지도가 같이 뜨도록: 둘이 다 준비될 때까지(최대 0.7초) 기다렸다가 한꺼번에 보인다
        loading.setVisibility(View.VISIBLE);
        final long t0 = System.currentTimeMillis();
        host.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (gen != revealGen || mapPane == null) return;
                if (mapPane.ready() || System.currentTimeMillis() - t0 > 700L) {
                    loading.setVisibility(View.GONE);
                    revealMap();
                } else {
                    host.postDelayed(this, 40L);
                }
            }
        }, 40L);
    }

    private int revealGen = 0;

    private void revealMap() {
        loading.setVisibility(View.GONE);
        fadeIn(mapPane);
        mapPane.setVisibility(View.VISIBLE);
    }

    /** 홈 — 길동무와 같은 그리개(ScreenView)가 엔진이 준 화면(흐르는 글 아래 큰 해변 장면 + 브리핑)을 그린다. */
    private void showHome(ScreenCore.Screen pre) {
        try { View f = scroll.findFocus(); if (f != null) f.clearFocus(); } catch (Throwable ignored) { }          // 대화 화면에서 오며 가려진 입력칸이 포커스를 쥐고 있으면 놓게 한다(홈에서 키보드가 올라오지 않게)
        scroll.setVisibility(View.GONE);
        loading.setVisibility(View.GONE);
        if (home == null) {
            home = SvHost.make(ctx, new SvHost.Cb() {
                @Override
                public void act(String kind, String v) {
                    if ("call".equals(kind) && v != null) cb.call(v, "");
                }
            });
            host.addView(home, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            home.setHelloFeed(new ScreenView.HelloFeed() {              // 홈 장면을 3초 꾹 누르면 친구들이 모여 아이 눈높이로 인사한다
                @Override
                public SceneHello.Plan get() {
                    return KidHello.plan(ctx);
                }
            });
        }
        home.setPalette(SvHost.palette(Pal.dark ? "dark" : "pastel"));
        if (home.getVisibility() != View.VISIBLE) fadeIn(home);
        home.setVisibility(View.VISIBLE);
        if (pre != null) home.setScreen(pre, true);
    }

    // ───────── 블록 ─────────
    private LinearLayout.LayoutParams lp(int w, int h, float topDp) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(w, h);
        p.topMargin = Ui.dpi(ctx, topDp);
        return p;
    }

    private View block(JSONObject b) {
        String t = b.optString("t");
        if ("head".equals(t)) return head(b);
        if ("text".equals(t)) return text(b);
        if ("card".equals(t)) return card(b);
        if ("village".equals(t)) return villageBlock(b);
        if ("box".equals(t)) return box(b);
        if ("wardrobe".equals(t)) {                    // 꾸미기: 네이티브 한 장 화면(엔진이 계산 · 앱은 그리기만)
            View dv = new DressView(ctx);
            dv.setLayoutParams(lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 6));
            return dv;
        }
        if ("avatar".equals(t)) {
            View av = new AvatarView(ctx, b.optString("id"), b.optString("name"));
            av.setLayoutParams(lp(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dpi(ctx, 170), 6));
            return av;
        }
        if ("stars".equals(t)) {
View sv = QuestStars.make(ctx, b);
sv.setLayoutParams(lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 8));
return sv;
}
if ("chips".equals(t)) return chips(b);
        if ("btns".equals(t)) return btns(b);
        if ("stat".equals(t)) return stat(b);
        if ("switch".equals(t)) return toggleRow(b);
        if ("msg".equals(t)) return msg(b);
        if ("input".equals(t)) return input(b);
        if ("pw".equals(t)) return pwBlock(b);
        if ("qr".equals(t)) return qrBlock(b);
        if ("gap".equals(t)) {
            View v = new View(ctx);
            v.setLayoutParams(lp(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dpi(ctx, snug ? Math.min(4f, (float) b.optDouble("h", 8)) : (float) b.optDouble("h", 8)), 0));
            return v;
        }
        return null;
    }

    /** 안에 다른 블록을 담는 둥근 박스(꾸미기 창의 '친구 고르기' · '아이템 고르기'). */
    private View box(JSONObject b) {
        LinearLayout r = new LinearLayout(ctx);
        r.setOrientation(LinearLayout.VERTICAL);
        int pad = Ui.dpi(ctx, 12);
        r.setPadding(pad, pad, pad, pad);
        r.setBackground(Ui.box(ctx, Pal.c(Pal.CARD), 18, Pal.c(Pal.BORDER)));
        JSONArray k = b.optJSONArray("kids");
        final boolean fill = "1".equals(b.optString("fill"));
        final boolean flush = "1".equals(b.optString("flush"));
        ViewGroup tgt = r;
        if (fill) {
            final ScrollView sc = new ScrollView(ctx);
            sc.setVerticalScrollBarEnabled(false);
            LinearLayout inner = new LinearLayout(ctx);
            inner.setOrientation(LinearLayout.VERTICAL);
            sc.addView(inner, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            r.addView(sc, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
            sc.post(new Runnable() {
                @Override
                public void run() {
                    sc.fullScroll(View.FOCUS_DOWN);
                }
            });
            tgt = inner;
        }
        boolean first = true;
        if (k != null) {
            for (int i = 0; i < k.length(); i++) {
                JSONObject x = k.optJSONObject(i);
                if (x == null) continue;
                View v = block(x);
                if (v == null) continue;
                if (v instanceof AvatarView) r.addView(v, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
                else if (fill && "input".equals(x.optString("t"))) r.addView(v);
                else {
                    if (flush && first && v.getLayoutParams() instanceof LinearLayout.LayoutParams) ((LinearLayout.LayoutParams) v.getLayoutParams()).topMargin = 0;
                    first = false;
                    tgt.addView(v);
                }
            }
        }
        if (fill) {
            LinearLayout.LayoutParams fl = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
            fl.topMargin = Ui.dpi(ctx, 10);
            r.setLayoutParams(fl);
            return r;
        }
        int hp = (int) b.optDouble("hp", 0);
        int hpx = hp > 0 ? ctx.getResources().getDisplayMetrics().heightPixels * hp / 100 : ViewGroup.LayoutParams.WRAP_CONTENT;
        r.setLayoutParams(lp(ViewGroup.LayoutParams.MATCH_PARENT, hpx, flush ? 8 : 12));
        return r;
    }

    private View head(JSONObject b) {
        boolean small = "1".equals(b.optString("small"));
        TextView v = Ui.text(ctx, b.optString("text"), small ? 14f : 17f, Pal.c(Pal.TEXT), true);
        v.setIncludeFontPadding(false);
        v.setLayoutParams(lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, small ? 6 : 0));
        return v;
    }

    private View text(JSONObject b) {
        boolean sub = "1".equals(b.optString("sub"));
        boolean tone = "1".equals(b.optString("tone"));
        boolean big = "1".equals(b.optString("big"));
        int color = tone ? Pal.c(Pal.ORANGE) : (sub ? Pal.c(Pal.SUB) : Pal.c(Pal.TEXT));
        TextView v = Ui.text(ctx, b.optString("text"), big ? 17f : (sub ? 11f : 13f), color, tone || big);
        if (big) v.setGravity(Gravity.CENTER);
        boolean tight = "1".equals(b.optString("tight"));
        if (tight) v.setIncludeFontPadding(false);
        v.setLayoutParams(lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, tight ? 4 : (snug ? 6 : 8)));
        return v;
    }

    private View card(JSONObject b) {
        LinearLayout r = new LinearLayout(ctx);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        int pad = Ui.dpi(ctx, snug ? 9 : 12);
        r.setPadding(pad, pad, pad, pad);
        r.setBackground(Ui.box(ctx, Pal.c(Pal.CARD), 16, Pal.c(Pal.BORDER)));
        String thumb = b.optString("thumb");
        if (!thumb.isEmpty()) {
            ThumbView tv = new ThumbView(ctx, thumb);
            LinearLayout.LayoutParams tl = new LinearLayout.LayoutParams(Ui.dpi(ctx, 52), Ui.dpi(ctx, 52));
            tl.rightMargin = Ui.dpi(ctx, 12);
            r.addView(tv, tl);
        }
        LinearLayout tc = new LinearLayout(ctx);
        tc.setOrientation(LinearLayout.VERTICAL);
        boolean tone = "1".equals(b.optString("tone"));
        tc.addView(Ui.text(ctx, b.optString("title"), 13f, Pal.c(Pal.TEXT), true));
        TextView sub = Ui.text(ctx, b.optString("text"), 11f, tone ? Pal.c(Pal.ORANGE) : Pal.c(Pal.SUB), tone);
        LinearLayout.LayoutParams sl = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        sl.topMargin = Ui.dpi(ctx, snug ? 1 : 2);
        tc.addView(sub, sl);
        r.addView(tc, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        r.setLayoutParams(lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, snug ? 5 : 8));
        final String act = b.optString("act");
        if (!act.isEmpty()) {
            r.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    cb.call(act, "");
                }
            });
        }
        return r;
    }

    private View villageBlock(JSONObject b) {
        if (village.getParent() instanceof ViewGroup) ((ViewGroup) village.getParent()).removeView(village);
        village.setLayoutParams(lp(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dpi(ctx, (float) b.optDouble("h", 300)), 8));
        return village;
    }

    private TextView pill(String label, boolean on) {
        TextView v = Ui.text(ctx, label, 12.5f, on ? Pal.c(Pal.ONGOLD) : Pal.c(Pal.TEXT), true);
        v.setGravity(Gravity.CENTER);
        int ph = Ui.dpi(ctx, 14), pv = Ui.dpi(ctx, 8);
        v.setPadding(ph, pv, ph, pv);
        v.setBackground(on ? Ui.box(ctx, Pal.c(Pal.GOLD), 20, 0) : Ui.box(ctx, Pal.c(Pal.CARD2), 20, Pal.c(Pal.BORDER)));
        return v;
    }

    /** 칸 가득 같은 폭으로 나란히 놓인 분류 칸. 고른 칸의 바탕이 미끄러지듯 옮겨 가고(밀거나 눌러도), 아래 목록만 같이 밀려 들어온다. */
    private View segs(JSONObject b, JSONArray a) {
        final FrameLayout fr = new FrameLayout(ctx);
        fr.setBackground(Ui.box(ctx, Pal.c(Pal.CARD2), 20, Pal.c(Pal.BORDER)));
        final View thumb = new View(ctx);
        thumb.setBackground(Ui.box(ctx, Pal.c(Pal.GOLD), 20, 0));
        final int inset = Ui.dpi(ctx, 3);
        FrameLayout.LayoutParams tl = new FrameLayout.LayoutParams(0, 1);
        tl.setMargins(inset, inset, 0, inset);
        fr.addView(thumb, tl);
        LinearLayout row = new LinearLayout(ctx);
        row.setOrientation(LinearLayout.HORIZONTAL);
        final java.util.ArrayList<String> acts = new java.util.ArrayList<String>();
        int cur = 0;
        for (int i = 0; i < a.length(); i++) {
            JSONObject it = a.optJSONObject(i);
            if (it == null) continue;
            boolean on = "1".equals(it.optString("on"));
            if (on) cur = acts.size();
            TextView p = Ui.text(ctx, it.optString("label"), 12.5f, on ? Pal.c(Pal.ONGOLD) : Pal.c(Pal.TEXT), true);
            p.setGravity(Gravity.CENTER);
            p.setPadding(0, Ui.dpi(ctx, 10), 0, Ui.dpi(ctx, 10));
            final String act = it.optString("act");
            final int mine = acts.size();
            acts.add(act);
            p.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    slideDir = mine > swipeCur ? 1 : (mine < swipeCur ? -1 : 0);
                    slideAt = android.os.SystemClock.uptimeMillis();
                    cb.call(act, "");
                }
            });
            row.addView(p, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        }
        fr.addView(row, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        final int n = Math.max(1, acts.size()), now = cur, prev = swipeCur;
        final boolean anim = slideDir != 0 && android.os.SystemClock.uptimeMillis() - slideAt < 900L;
        final boolean[] done = new boolean[1];
        fr.addOnLayoutChangeListener(new View.OnLayoutChangeListener() {
            @Override
            public void onLayoutChange(View v, int l, int t, int r, int bt, int ol, int ot, int or, int ob) {
                int w = r - l;
                if (done[0] || w <= 0) return;
                done[0] = true;
                int cw = (w - 2 * inset) / n;
                FrameLayout.LayoutParams lp2 = (FrameLayout.LayoutParams) thumb.getLayoutParams();
                lp2.width = cw;
lp2.height = Math.max(1, bt - t - 2 * inset);
                thumb.setLayoutParams(lp2);
                if (anim) {
                    thumb.setTranslationX(prev * cw);
                    thumb.animate().translationX(now * cw).setDuration(240L).setInterpolator(new android.view.animation.PathInterpolator(0.32f, 0.72f, 0f, 1f)).start();
                } else {
                    thumb.setTranslationX(now * cw);
                }
            }
        });
        if ("1".equals(b.optString("loop"))) {
            swipeActs = acts;
            swipeCur = cur;
            segView = fr;
        }
        fr.setLayoutParams(lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 8));
        return fr;
    }

    private View chips(JSONObject b) {
        JSONArray eq = b.optJSONArray("items");
        if ("1".equals(b.optString("eq")) && eq != null && eq.length() > 0) return segs(b, eq);
        HorizontalScrollView hs = new HorizontalScrollView(ctx);
        hs.setHorizontalScrollBarEnabled(false);
        LinearLayout row = new LinearLayout(ctx);
        row.setOrientation(LinearLayout.HORIZONTAL);
        JSONArray a = b.optJSONArray("items");
        if (a != null) {
            for (int i = 0; i < a.length(); i++) {
                JSONObject it = a.optJSONObject(i);
                if (it == null) continue;
                TextView p = pill(it.optString("label"), "1".equals(it.optString("on")));
                final String act = it.optString("act");
                p.setOnClickListener(new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        cb.call(act, "");
                    }
                });
                LinearLayout.LayoutParams pl = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                pl.rightMargin = Ui.dpi(ctx, 8);
                row.addView(p, pl);
            }
        }
        hs.addView(row);
        hs.setLayoutParams(lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 10));
        return hs;
    }

    private View btns(JSONObject b) {
        LinearLayout row = new LinearLayout(ctx);
        row.setOrientation(LinearLayout.HORIZONTAL);
        JSONArray a = b.optJSONArray("items");
        int n = a == null ? 0 : a.length();
        for (int i = 0; i < n; i++) {
            JSONObject it = a.optJSONObject(i);
            if (it == null) continue;
            TextView p = pill(it.optString("label"), "1".equals(it.optString("on")));
            if ("1".equals(it.optString("off"))) p.setAlpha(0.4f);
            final String act = it.optString("act");
            p.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    cb.call(act, "");
                }
            });
            LinearLayout.LayoutParams pl = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            if (i > 0) pl.leftMargin = Ui.dpi(ctx, 8);
            row.addView(p, pl);
        }
        row.setLayoutParams(lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 12));
        return row;
    }

    private View stat(JSONObject b) {
        int val = Math.max(0, Math.min(100, b.optInt("val", 0)));
        LinearLayout r = new LinearLayout(ctx);
        r.setOrientation(LinearLayout.VERTICAL);
        LinearLayout top = new LinearLayout(ctx);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.addView(Ui.text(ctx, b.optString("label"), 11.5f, Pal.c(Pal.SUB), false), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        top.addView(Ui.text(ctx, val + "%", 11.5f, Pal.c(Pal.TEXT), true));
        r.addView(top);
        Bar bar = new Bar(ctx, val);
        LinearLayout.LayoutParams bl = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dpi(ctx, 10));
        bl.topMargin = Ui.dpi(ctx, 4);
        r.addView(bar, bl);
        r.setLayoutParams(lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 10));
        return r;
    }

    private View toggleRow(JSONObject b) {
        LinearLayout r = new LinearLayout(ctx);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        int pad = Ui.dpi(ctx, snug ? 10 : 14);
        r.setPadding(pad, pad, pad, pad);
        r.setBackground(Ui.box(ctx, Pal.c(Pal.CARD), 16, Pal.c(Pal.BORDER)));
        TextView lb = Ui.text(ctx, b.optString("label"), 13f, Pal.c(Pal.TEXT), false);
        r.addView(lb, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        LinearLayout.LayoutParams tl = new LinearLayout.LayoutParams(Ui.dpi(ctx, 48), Ui.dpi(ctx, 28));
        tl.leftMargin = Ui.dpi(ctx, 12);
        r.addView(new Toggle(ctx, "1".equals(b.optString("on"))), tl);
        r.setLayoutParams(lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, snug ? 5 : 8));
        final String act = b.optString("act");
        r.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                cb.call(act, "");
            }
        });
        return r;
    }

    private View msg(JSONObject b) {
        boolean me = "1".equals(b.optString("me"));
        int side = me ? Gravity.END : Gravity.START;
        LinearLayout r = new LinearLayout(ctx);
        r.setOrientation(LinearLayout.VERTICAL);
        r.setGravity(side);
        String nick = b.optString("nick");
        if (!me && !nick.isEmpty()) {                                          // 상대가 쓴 글: 말풍선 위에 쓴 사람 이름(엔진이 정해 준 글자를 그대로 그린다)
            TextView nk = Ui.text(ctx, nick, 10.5f, Pal.c(Pal.SUB), false);
            LinearLayout.LayoutParams nl = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            nl.gravity = Gravity.START;
            nl.leftMargin = Ui.dpi(ctx, 4);
            nl.bottomMargin = Ui.dpi(ctx, 2);
            r.addView(nk, nl);
        }
        TextView t = Ui.text(ctx, b.optString("text"), 13f, me ? Pal.c(Pal.ONGOLD) : Pal.c(Pal.TEXT), false);
        int ph = Ui.dpi(ctx, 14), pv = Ui.dpi(ctx, 9);
        t.setPadding(ph, pv, ph, pv);
        t.setMaxWidth(ctx.getResources().getDisplayMetrics().widthPixels * 3 / 4);
        t.setBackground(me ? Ui.box(ctx, Pal.c(Pal.GOLD), 18, 0) : Ui.box(ctx, Pal.c(Pal.CARD), 18, Pal.c(Pal.BORDER)));
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        bp.gravity = side;
        r.addView(t, bp);
        String time = b.optString("time");
        String un = b.optString("un");
        TextView tm = Ui.text(ctx, time, 9.5f, Pal.c(Pal.SUB), false);
        if (!un.isEmpty() && !"0".equals(un)) {                                // 아직 안 읽은 사람 수: 시각 앞에 노란 숫자(카톡처럼 — 몇 명인지는 엔진이 센다)
            android.text.SpannableString ss = new android.text.SpannableString(un + "  " + time);
            ss.setSpan(new android.text.style.ForegroundColorSpan(Pal.c(Pal.GOLD)), 0, un.length(), android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            ss.setSpan(new android.text.style.StyleSpan(android.graphics.Typeface.BOLD), 0, un.length(), android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            tm.setText(ss);
        }
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        tp.gravity = side;                                                     // 내 글의 시각은 내 말풍선 아래 오른쪽, 상대 글은 아래 왼쪽
        tp.topMargin = Ui.dpi(ctx, 2);
        r.addView(tm, tp);
        r.setLayoutParams(lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 8));
        return r;
    }

    private View input(JSONObject b) {
        LinearLayout r = new LinearLayout(ctx);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        final EditText et = new EditText(ctx);
        et.setHint(b.optString("hint"));
        et.setHintTextColor(Pal.c(Pal.SUB));
        et.setTextColor(Pal.c(Pal.TEXT));
        et.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, 13f);
        et.setTypeface(Ui.face(ctx, false));
        et.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        et.setMaxLines(3);
        int pad = Ui.dpi(ctx, 12);
        et.setPadding(pad, pad, pad, pad);
        et.setBackground(Ui.box(ctx, Pal.c(Pal.CARD), 18, Pal.c(Pal.BORDER)));
        et.setText(draft);
        et.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int a, int c, int d) {
            }

            @Override
            public void onTextChanged(CharSequence s, int a, int c, int d) {
            }

            @Override
            public void afterTextChanged(Editable s) {
                draft = s.toString();
            }
        });
        r.addView(et, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        TextView send = pill("보내기", true);
        final String act = b.optString("act");
        send.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String s = et.getText().toString().trim();
                if (s.isEmpty()) return;
                draft = "";
                et.setText("");
                cb.call(act, s);
            }
        });
        LinearLayout.LayoutParams sl = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        sl.leftMargin = Ui.dpi(ctx, 8);
        r.addView(send, sl);
        r.setLayoutParams(lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 14));
        return r;
    }

    /** 숫자 4자리 비밀번호 칸(가려서 보임) + 확인 버튼 — 관리 창 들어가기 전에 쓴다. */
    private View pwBlock(JSONObject b) {
        LinearLayout r = new LinearLayout(ctx);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        final EditText et = new EditText(ctx);
        et.setHint(b.optString("hint"));
        et.setHintTextColor(Pal.c(Pal.SUB));
        et.setTextColor(Pal.c(Pal.TEXT));
        et.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, 16f);
        et.setTypeface(Ui.face(ctx, false));
        et.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        et.setFilters(new android.text.InputFilter[] { new android.text.InputFilter.LengthFilter(4) });
        et.setSingleLine(true);
        et.setGravity(Gravity.CENTER);
        int pad = Ui.dpi(ctx, 12);
        et.setPadding(pad, pad, pad, pad);
        et.setBackground(Ui.box(ctx, Pal.c(Pal.CARD), 18, Pal.c(Pal.BORDER)));
        r.addView(et, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        TextView ok = pill(b.optString("btn", "확인"), true);
        final String act = b.optString("act");
        ok.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String s = et.getText().toString().trim();
                et.setText("");
                cb.call(act, s);
            }
        });
        LinearLayout.LayoutParams sl = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        sl.leftMargin = Ui.dpi(ctx, 8);
        r.addView(ok, sl);
        r.setLayoutParams(lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 14));
        et.postDelayed(new Runnable() {
            @Override
            public void run() {
                try {
                    et.requestFocus();
                    android.view.inputmethod.InputMethodManager im = (android.view.inputmethod.InputMethodManager) ctx.getSystemService(Context.INPUT_METHOD_SERVICE);
                    if (im != null) im.showSoftInput(et, 0);
                } catch (Throwable t) {
                    // 키보드가 안 떠도 눌러서 넣을 수 있다
                }
            }
        }, 250L);
        return r;
    }

    private View qrBlock(JSONObject b) {
        Bitmap bm = qr(b.optString("text"));
        FrameLayout f = new FrameLayout(ctx);
        if (bm != null) {
            ImageView iv = new ImageView(ctx);
            iv.setImageBitmap(bm);
            iv.setScaleType(ImageView.ScaleType.FIT_CENTER);
            int pad = Ui.dpi(ctx, 10);
            iv.setPadding(pad, pad, pad, pad);
            iv.setBackground(Ui.box(ctx, 0xFFFFFFFF, 14, Pal.c(Pal.BORDER)));
            int sz = Ui.dpi(ctx, 220);
            f.addView(iv, new FrameLayout.LayoutParams(sz, sz, Gravity.CENTER_HORIZONTAL));
        }
        f.setLayoutParams(lp(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dpi(ctx, 220), 12));
        return f;
    }

    private Bitmap qr(String text) {
        try {
            BitMatrix m = new QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0);
            int n = m.getWidth(), sc = 8, w = n * sc;
            int[] px = new int[w * w];
            for (int y = 0; y < w; y++) {
                for (int x = 0; x < w; x++) px[y * w + x] = m.get(x / sc, y / sc) ? 0xFF000000 : 0xFFFFFFFF;
            }
            return Bitmap.createBitmap(px, w, w, Bitmap.Config.ARGB_8888);
        } catch (Throwable t) {
            return null;
        }
    }

    // ───────── 작은 그림 뷰 ─────────
    private static final class Bar extends View {
        private final int val;
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF r = new RectF();

        Bar(Context c, int val) {
            super(c);
            this.val = val;
        }

        @Override
        protected void onDraw(Canvas c) {
            float w = getWidth(), h = getHeight();
            p.setColor(Pal.c(Pal.BORDER));
            r.set(0, 0, w, h);
            c.drawRoundRect(r, h / 2f, h / 2f, p);
            if (val > 0) {
                p.setColor(val >= 70 ? Pal.c(Pal.ORANGE) : Pal.c(Pal.GOLD));
                r.set(0, 0, Math.max(h, w * val / 100f), h);
                c.drawRoundRect(r, h / 2f, h / 2f, p);
            }
        }
    }

    private static final class Toggle extends View {
        private final boolean on;
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF r = new RectF();

        Toggle(Context c, boolean on) {
            super(c);
            this.on = on;
        }

        @Override
        protected void onDraw(Canvas c) {
            float w = getWidth(), h = getHeight();
            p.setColor(on ? Pal.c(Pal.GOLD) : Pal.c(Pal.BORDER2));
            r.set(0, 0, w, h);
            c.drawRoundRect(r, h / 2f, h / 2f, p);
            p.setColor(0xFFFFFFFF);
            float rad = h / 2f - h * 0.12f;
            c.drawCircle(on ? w - h / 2f : h / 2f, h / 2f, rad, p);
        }
    }
}
