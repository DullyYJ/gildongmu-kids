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

import com.dullyyj.subway.ScreenCore;
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
        scroll = new ScrollView(c);
        scroll.setVerticalScrollBarEnabled(false);
        col = new LinearLayout(c);
        col.setOrientation(LinearLayout.VERTICAL);
        int pad = Ui.dpi(c, 16);
        col.setPadding(pad, pad, pad, pad);
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
    void consent(String json) {
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
        if (sheet == null) openConsent();
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

    private void openConsent() {
        try {
            final Dialog d = new Dialog(ctx, android.R.style.Theme_Material_Light_Dialog_NoActionBar);
            LinearLayout box = new LinearLayout(ctx);
            box.setOrientation(LinearLayout.VERTICAL);
            GradientDrawable g = new GradientDrawable();
            g.setColor(Pal.c(Pal.BG));
            float r = Ui.dpi(ctx, 24);
            g.setCornerRadius(r);
            box.setBackground(g);
            final int capPx = Math.round(ctx.getResources().getDisplayMetrics().heightPixels * 0.78f);
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
            sheetCol.setPadding(pad, Ui.dpi(ctx, 16), pad, Ui.dpi(ctx, 20));
            sheetScroll.addView(sheetCol, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            box.addView(sheetScroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            d.setContentView(box);
            d.setCancelable(false);
            d.setCanceledOnTouchOutside(false);
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
            Window w = d.getWindow();
            int wpx = ctx.getResources().getDisplayMetrics().widthPixels - 2 * Ui.dpi(ctx, 20);
            w.setLayout(wpx, ViewGroup.LayoutParams.WRAP_CONTENT);
            w.setGravity(Gravity.CENTER);
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
        if (mapPane != null) mapPane.setVisibility(View.GONE);
        if ("sv".equals(mode)) {
            showHome(pre);
            return;
        }
        if (home != null) home.setVisibility(View.GONE);
        loading.setVisibility(View.GONE);
        scroll.setVisibility(View.VISIBLE);
        scroll.setBackgroundColor(Pal.c(Pal.BG));
        JSONArray bl = o.optJSONArray("blocks");
        String head = "";
        if (bl != null && bl.length() > 0 && bl.optJSONObject(0) != null) head = bl.optJSONObject(0).optString("text");
        final boolean same = head.equals(lastHead);
        lastHead = head;
        final int sy = same ? scroll.getScrollY() : 0;
        final boolean bottom = "1".equals(o.optString("bottom"));
        col.removeAllViews();
        if (bl != null) {
            for (int i = 0; i < bl.length(); i++) {
                JSONObject b = bl.optJSONObject(i);
                if (b == null) continue;
                View v = block(b);
                if (v != null) col.addView(v);
            }
        }
        scroll.post(new Runnable() {
            @Override
            public void run() {
                if (bottom) scroll.fullScroll(View.FOCUS_DOWN);
                else scroll.scrollTo(0, sy);
            }
        });
    }

    private void showMap() {
        scroll.setVisibility(View.GONE);
        loading.setVisibility(View.GONE);
        if (home != null) home.setVisibility(View.GONE);
        if (mapPane == null) {
            mapPane = new MapPane(ctx);
            host.addView(mapPane, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
        mapPane.setTheme(Pal.dark ? "dark" : "pastel");
        mapPane.setVisibility(View.VISIBLE);
        mapPane.onShow();
    }

    /** 홈 — 길동무와 같은 그리개(ScreenView)가 엔진이 준 화면(흐르는 글 아래 큰 해변 장면 + 브리핑)을 그린다. */
    private void showHome(ScreenCore.Screen pre) {
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
        }
        home.setPalette(SvHost.palette(Pal.dark ? "dark" : "pastel"));
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
        if ("chips".equals(t)) return chips(b);
        if ("btns".equals(t)) return btns(b);
        if ("stat".equals(t)) return stat(b);
        if ("switch".equals(t)) return toggleRow(b);
        if ("msg".equals(t)) return msg(b);
        if ("input".equals(t)) return input(b);
        if ("qr".equals(t)) return qrBlock(b);
        if ("gap".equals(t)) {
            View v = new View(ctx);
            v.setLayoutParams(lp(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dpi(ctx, (float) b.optDouble("h", 8)), 0));
            return v;
        }
        return null;
    }

    private View head(JSONObject b) {
        boolean small = "1".equals(b.optString("small"));
        TextView v = Ui.text(ctx, b.optString("text"), small ? 16f : 22f, Pal.c(Pal.TEXT), true);
        v.setLayoutParams(lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, small ? 6 : 2));
        return v;
    }

    private View text(JSONObject b) {
        boolean sub = "1".equals(b.optString("sub"));
        boolean tone = "1".equals(b.optString("tone"));
        boolean big = "1".equals(b.optString("big"));
        int color = tone ? Pal.c(Pal.ORANGE) : (sub ? Pal.c(Pal.SUB) : Pal.c(Pal.TEXT));
        TextView v = Ui.text(ctx, b.optString("text"), big ? 22f : (sub ? 13f : 15f), color, tone || big);
        if (big) v.setGravity(Gravity.CENTER);
        v.setLayoutParams(lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 8));
        return v;
    }

    private View card(JSONObject b) {
        LinearLayout r = new LinearLayout(ctx);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        int pad = Ui.dpi(ctx, 12);
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
        tc.addView(Ui.text(ctx, b.optString("title"), 15f, Pal.c(Pal.TEXT), true));
        TextView sub = Ui.text(ctx, b.optString("text"), 13f, tone ? Pal.c(Pal.ORANGE) : Pal.c(Pal.SUB), tone);
        LinearLayout.LayoutParams sl = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        sl.topMargin = Ui.dpi(ctx, 2);
        tc.addView(sub, sl);
        r.addView(tc, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        r.setLayoutParams(lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 8));
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
        TextView v = Ui.text(ctx, label, 14f, on ? Pal.c(Pal.ONGOLD) : Pal.c(Pal.TEXT), true);
        v.setGravity(Gravity.CENTER);
        int ph = Ui.dpi(ctx, 16), pv = Ui.dpi(ctx, 9);
        v.setPadding(ph, pv, ph, pv);
        v.setBackground(on ? Ui.box(ctx, Pal.c(Pal.GOLD), 20, 0) : Ui.box(ctx, Pal.c(Pal.CARD2), 20, Pal.c(Pal.BORDER)));
        return v;
    }

    private View chips(JSONObject b) {
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
        top.addView(Ui.text(ctx, b.optString("label"), 13f, Pal.c(Pal.SUB), false), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        top.addView(Ui.text(ctx, val + "%", 13f, Pal.c(Pal.TEXT), true));
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
        int pad = Ui.dpi(ctx, 14);
        r.setPadding(pad, pad, pad, pad);
        r.setBackground(Ui.box(ctx, Pal.c(Pal.CARD), 16, Pal.c(Pal.BORDER)));
        TextView lb = Ui.text(ctx, b.optString("label"), 15f, Pal.c(Pal.TEXT), false);
        r.addView(lb, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        LinearLayout.LayoutParams tl = new LinearLayout.LayoutParams(Ui.dpi(ctx, 48), Ui.dpi(ctx, 28));
        tl.leftMargin = Ui.dpi(ctx, 12);
        r.addView(new Toggle(ctx, "1".equals(b.optString("on"))), tl);
        r.setLayoutParams(lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 8));
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
        LinearLayout r = new LinearLayout(ctx);
        r.setOrientation(LinearLayout.VERTICAL);
        r.setGravity(me ? Gravity.END : Gravity.START);
        TextView t = Ui.text(ctx, b.optString("text"), 15f, me ? Pal.c(Pal.ONGOLD) : Pal.c(Pal.TEXT), false);
        int ph = Ui.dpi(ctx, 14), pv = Ui.dpi(ctx, 9);
        t.setPadding(ph, pv, ph, pv);
        t.setMaxWidth(ctx.getResources().getDisplayMetrics().widthPixels * 3 / 4);
        t.setBackground(me ? Ui.box(ctx, Pal.c(Pal.GOLD), 18, 0) : Ui.box(ctx, Pal.c(Pal.CARD), 18, Pal.c(Pal.BORDER)));
        r.addView(t, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        r.addView(Ui.text(ctx, b.optString("time"), 10.5f, Pal.c(Pal.SUB), false));
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
        et.setTextSize(15f);
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
