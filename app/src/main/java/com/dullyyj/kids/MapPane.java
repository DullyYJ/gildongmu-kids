package com.dullyyj.kids;

import android.app.Dialog;
import android.content.Context;
import android.content.DialogInterface;
import android.graphics.drawable.ColorDrawable;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.dullyyj.subway.MetroMapData;
import com.dullyyj.subway.MetroMapView;
import com.dullyyj.subway.ScreenCore;
import com.dullyyj.subway.ScreenView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;

/**
 * 노선도 탭 — 길동무와 같은 머리(검색·호선 칩) · 수도권 노선도 · 역 팝업을 그대로 쓴다.
 * 길동무 서버가 내려 주는 화면을 그리기만 하고, 출발·도착·시간표 단추와 버스·지역 칩은 키즈 앱에 없어서 뺀다.
 */
final class MapPane extends LinearLayout {
    private interface Done {
        void run(String find, String near);
    }

    private final Context ctx;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final float dpr;
    private final FrameLayout headBox;
    private final ScreenView head;
    private final FrameLayout holder;
    private final TextView note;
    private MetroMapView metro;
    private MetroMapData data;
    private boolean dataLoading = false, headLoaded = false;
    private String theme = "pastel", flt = "ALL", stn = "";
    private int headSeq = 0, stnSeq = 0;
    private Dialog sheet;

    MapPane(Context c) {
        super(c);
        ctx = c;
        dpr = c.getResources().getDisplayMetrics().density;
        setOrientation(VERTICAL);
        headBox = new FrameLayout(c);
        head = SvHost.make(c, new SvHost.Cb() {
            @Override
            public void act(String kind, String v) {
                onHeadAct(kind, v);
            }
        }, new SvHost.Size() {
            @Override
            public void h(float dp) {
                int px = Math.max(1, Math.round(dp * dpr));
                ViewGroup.LayoutParams lp = headBox.getLayoutParams();
                if (lp != null && lp.height != px) {
                    lp.height = px;
                    headBox.setLayoutParams(lp);
                }
            }
        });
        headBox.addView(head, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        addView(headBox, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Math.round(44f * dpr)));
        holder = new FrameLayout(c);
        addView(holder, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        note = new TextView(c);
        note.setTextSize(14f);
        note.setGravity(Gravity.CENTER);
        note.setText("지도를 불러오는 중이에요…");
        holder.addView(note, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        applyTheme();
    }

    void setTheme(String t) {
        String nt = "dark".equals(t) ? "dark" : "pastel";
        if (nt.equals(theme)) return;
        theme = nt;
        applyTheme();
        headLoaded = false;
        if (getVisibility() == View.VISIBLE) onShow();
    }

    private void applyTheme() {
        int[] p = SvHost.palette(theme);
        setBackgroundColor(p[0]);
        head.setPalette(p);
        note.setTextColor(p[4]);
    }

    /** 노선도 탭이 보일 때마다 부른다 — 처음이면 자료와 머리 화면을 받아 온다. */
    void onShow() {
        if (data == null && !dataLoading) loadData();
        if (!headLoaded) loadHead(null, null, null);
    }

    void destroy() {
        closeSheet();
        if (metro != null) metro.destroy();
    }

    // ───────── 노선도 그림 ─────────
    private void loadData() {
        dataLoading = true;
        new Thread(new Runnable() {
            @Override
            public void run() {
                MetroMapData d = null;
                try {
                    InputStream in = ctx.getAssets().open("metro_native.bin");
                    try {
                        d = MetroMapData.parse(in);
                    } finally {
                        in.close();
                    }
                } catch (Throwable t) {
                    d = null;
                }
                final MetroMapData fd = d;
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        dataLoading = false;
                        dataReady(fd);
                    }
                });
            }
        }, "kids-map").start();
    }

    private void dataReady(MetroMapData d) {
        if (d == null) {
            note.setText("지도를 불러오지 못했어요");
            return;
        }
        data = d;
        metro = new MetroMapView(ctx, d, dpr);
        metro.setListener(new MetroMapView.Listener() {
            @Override
            public void onStation(int op, float sx, float sy) {
                openStation(data.labelName(op));
            }

            @Override
            public void onGestureStart() {
                closeSheet();
            }

            @Override
            public void onEdgeSwipe(int dir) {
            }

            @Override
            public void onReady() {
            }

            @Override
            public void onError(String msg) {
                toast("노선도를 그리지 못했어요");
            }

            @Override
            public void onCentered(int op) {
                openStation(data.labelName(op));
            }
        });
        holder.addView(metro, 0, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        metro.setFilter(flt);
        note.setVisibility(View.GONE);
    }

    // ───────── 머리(검색·호선 칩) ─────────
    private String req(String part, String q, double[] gps) {
        JSONObject o = new JSONObject();
        try {
            JSONObject f = new JSONObject();
            f.put("part", part);
            f.put("mode", "subway");
            f.put("reg", "seoul");
            f.put("flt", flt);
            f.put("th", theme);
            if (q != null && !q.isEmpty()) f.put("q", q);
            if (gps != null) {
                JSONArray g = new JSONArray();
                g.put(gps[0]);
                g.put(gps[1]);
                f.put("gps", g);
            }
            o.put("cap", Wire.CAP);
            o.put("f", f);
        } catch (Exception e) {
            // 빈 요청이 가면 서버가 거절한다
        }
        return o.toString();
    }

    private void loadHead(String q, double[] gps, final Done done) {
        final String body = req("h", q, gps);
        final int seq = ++headSeq;
        Wire.EX.execute(new Runnable() {
            @Override
            public void run() {
                final String r = Wire.post("/screen/map", body, 8000);
                if (r == null) {
                    ui.post(new Runnable() {
                        @Override
                        public void run() {
                            if (seq != headSeq || headLoaded) return;
                            ui.postDelayed(new Runnable() {
                                @Override
                                public void run() {
                                    if (!headLoaded && isShown()) loadHead(null, null, null);
                                }
                            }, 6000L);
                        }
                    });
                    return;
                }
                String f = "", n = "";
                try {
                    JSONObject info = new JSONObject(r).optJSONObject("info");
                    if (info != null) {
                        JSONObject fo = info.optJSONObject("find");
                        JSONObject no = info.optJSONObject("near");
                        if (fo != null) f = fo.optString("name", "");
                        if (no != null) n = no.optString("name", "");
                    }
                } catch (Exception e) {
                    f = "";
                    n = "";
                }
                final String ff = f, nn = n;
                final ScreenCore.Screen sc = SvHost.parse(SvHost.strip(r));
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        if (seq != headSeq) return;
                        if (sc != null) {
                            head.setScreen(sc, true);
                            headLoaded = true;
                        }
                        if (done != null) done.run(ff, nn);
                    }
                });
            }
        });
    }

    private void onHeadAct(String kind, String v) {
        if (v == null) return;
        if ("cat".equals(kind)) {
            if (v.startsWith("f:")) {
                flt = v.substring(2);
                if (metro != null) metro.setFilter(flt);
                loadHead(null, null, null);
            }
            return;
        }
        if (!"call".equals(kind)) return;
        if ("mp.find".equals(v)) {
            final String q = head.fields().get("mq");
            if (q == null || q.replaceAll("\\s+", "").length() < 2) return;
            loadHead(q, null, new Done() {
                @Override
                public void run(String find, String near) {
                    if (metro == null || find.isEmpty() || !metro.centerOn(find, 1.6f, true)) toast("'" + q.trim() + "' 역을 찾지 못했어요");
                }
            });
        } else if ("mp.loc".equals(v)) {
            Engine en = Core.engine;
            if (!en.hasFix()) {
                toast("내 위치를 아직 몰라요. 설정에서 위치 공유를 켜 주세요");
                return;
            }
            loadHead(null, en.where(), new Done() {
                @Override
                public void run(String find, String near) {
                    if (metro != null && !near.isEmpty() && metro.centerOn(near, 1.6f, true)) toast(near + " (가장 가까운 역)");
                    else toast("가까운 역을 지도에서 찾지 못했어요");
                }
            });
        }
    }

    // ───────── 역 팝업 ─────────
    private void openStation(String label) {
        stn = label == null ? "" : label.replaceAll("\\s+", "").trim();
        if (stn.isEmpty()) return;
        closeSheet();
        final int seq = ++stnSeq;
        final ScreenView sv = SvHost.make(ctx, new SvHost.Cb() {
            @Override
            public void act(String kind, String v) {
                if ("call".equals(kind) && "mp.close".equals(v)) closeSheet();
            }
        });
        int[] pal = SvHost.palette(theme);
        sv.setPalette(pal);
        sv.setParentIntercept(true);
        final Dialog d = new Dialog(ctx, android.R.style.Theme_Material_Light_Dialog_NoActionBar);
        d.setContentView(sv);
        int hpx = Math.round(ctx.getResources().getDisplayMetrics().heightPixels * 0.58f);
        try {
            Window w = d.getWindow();
            w.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, hpx);
            w.setGravity(Gravity.BOTTOM);
            w.setBackgroundDrawable(new ColorDrawable(pal[0]));
            w.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            w.setWindowAnimations(android.R.style.Animation_InputMethod);
            if (metro != null) metro.setCover(hpx);
            d.setOnDismissListener(new DialogInterface.OnDismissListener() {
                @Override
                public void onDismiss(DialogInterface x) {
                    if (sheet == d) sheet = null;
                    if (metro != null) metro.setCover(0f);
                }
            });
            sheet = d;
            d.show();
        } catch (Throwable t) {
            sheet = null;
            return;
        }
        final String name = stn;
        Wire.EX.execute(new Runnable() {
            @Override
            public void run() {
                final String r = Wire.post("/screen/map", stnBody(name), 8000);
                final ScreenCore.Screen sc = r == null ? null : SvHost.parse(SvHost.strip(r));
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        if (seq != stnSeq || sheet != d) return;
                        if (sc == null) {
                            closeSheet();
                            toast("역 정보를 불러오지 못했어요");
                            return;
                        }
                        sv.setScreen(sc, false);
                        if (metro != null) metro.ensureVisible(name);
                    }
                });
            }
        });
    }

    private String stnBody(String name) {
        JSONObject o = new JSONObject();
        try {
            JSONObject f = new JSONObject();
            f.put("part", "stn");
            f.put("stn", name);
            f.put("sl", "");
            f.put("reg", "seoul");
            f.put("th", theme);
            o.put("cap", Wire.CAP);
            o.put("f", f);
        } catch (Exception e) {
            // 빈 요청이 가면 서버가 거절한다
        }
        return o.toString();
    }

    private void closeSheet() {
        stnSeq++;
        Dialog d = sheet;
        sheet = null;
        if (d != null) {
            try {
                d.dismiss();
            } catch (Throwable t) {
                // 이미 닫힘
            }
        }
        if (metro != null) metro.setCover(0f);
    }

    private void toast(String s) {
        try {
            Toast.makeText(ctx, s, Toast.LENGTH_SHORT).show();
        } catch (Throwable t) {
            // 무시
        }
    }
}
