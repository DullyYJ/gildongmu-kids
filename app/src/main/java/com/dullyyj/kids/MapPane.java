package com.dullyyj.kids;

import android.app.AlertDialog;
import android.app.Dialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.SharedPreferences;
import android.graphics.drawable.ColorDrawable;
import android.os.Handler;
import android.os.Looper;
import android.text.InputFilter;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.EditText;
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
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 노선도 탭 — 길동무처럼 🚌 버스 / 🚇 지하철 두 가지.
 * 지하철: 길동무와 같은 머리(검색·호선 칩) · 수도권 노선도, 역을 누르면 바로 시간표가 올라온다(출발·도착 단추 없음).
 * 버스: 길동무 서버가 내려 주는 지도 + 정류장 카드(주변 정류장 · 도착 정보)를 그대로 그린다.
 * 서버가 내려 주는 화면을 그리기만 한다.
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
    private int headSeq = 0;
    private Dialog sheet;
    private TtSheet tt;
    private String mode = "subway";
    private final ScreenView bus;
    private String busVw = "near";
    private int busSel = -1, busSeq = 0;
    private long busAt = 0L;
    private boolean busShown = false, busTicking = false;
    private final LinkedHashMap<String, String> busRes = new LinkedHashMap<String, String>();
    private final ArrayList<String> lastStops = new ArrayList<String>();
private final LinkedHashMap<String, ScreenCore.Screen> headCache = new LinkedHashMap<String, ScreenCore.Screen>();
private int slideGen = 0;
    private String favRaw = null, alRaw = null;
    private int favMax = 12, aliasMax = 10;
    private String favAdd = "", favRm = "", favFull = "";
    private String ordRaw = "[]";

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
        bus = SvHost.make(c, new SvHost.Cb() {
            @Override
            public void act(String kind, String v) {
                onBusAct(kind, v);
            }
        });
        bus.setSwipeHost(new ScreenView.SwipeHost() {                  // 길동무처럼 버스 → 지하철 좌우 밀기
            @Override
            public boolean onSwipe(ScreenView v, int dir) {
                if (dir == -1 && "bus".equals(mode)) {
                    // 옆으로 밀리는 그림은 setMode 가 그린다
                    setMode("subway");
                }
                return true;
            }

            @Override
            public boolean canSwipe() {
                return "bus".equals(mode);
            }
        });
        bus.setPullHost(new ScreenView.PullHost() {                    // 아래로 당겨 새로고침(🔄 단추와 같은 행동)
            @Override
            public boolean canPull() {
                return "bus".equals(mode);
            }

            @Override
            public void onPull() {
                onBusAct("call", "mp.rf");
            }
        });
        bus.setReorderHost(new ScreenView.ReorderHost() {              // 주변 정류장 카드 끌어서 순서 바꾸기
            @Override
            public void onReorder(String[] keys, int[] perm) {
                reorderNear(keys, perm);
            }
        });
        bus.setVisibility(View.GONE);
        holder.addView(bus, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        applyTheme();
    }

    /** 홈에서 미리 불러 둔다 — 지도 자료만 읽어 두고 화면은 보이지 않는다. */
void warm() {
if (data == null && !dataLoading) loadData();
}

void setTheme(String t) {
        String nt = "dark".equals(t) ? "dark" : "pastel";
        if (nt.equals(theme)) return;
        theme = nt;
        applyTheme();
        headLoaded = false;
        busAt = 0L;
        if (getVisibility() == View.VISIBLE) onShow();
    }

    private void applyTheme() {
        int[] p = SvHost.palette(theme);
        setBackgroundColor(p[0]);
        head.setPalette(p);
        bus.setPalette(p);
        note.setTextColor(p[4]);
    }

    /** 노선도 탭이 보일 때마다 부른다 — 처음이면 자료와 머리 화면을 받아 온다. */
    void onShow() {
        if ("bus".equals(mode)) {
            if (!headLoaded) loadHead(null, null, null);
            if (System.currentTimeMillis() - busAt > 20000L) loadBus(busAt > 0L);
            busTickStart();
            return;
        }
        if (data == null && !dataLoading) loadData();
        if (!headLoaded) loadHead(null, null, null);
    }

    /** 🚌 버스 / 🚇 지하철 바꾸기. */
    private String headKey() {
return ("bus".equals(mode) ? "b" : "s") + "|" + flt + "|" + theme;
}

/** 길동무처럼 버스 ↔ 지하철을 옆으로 밀며 바꾼다. 머리 화면과 버스 화면은 이전 것을 그대로 두었다가 곧바로 보여 주고, 새 자료는 뒤에서 조용히 받는다. */
private void setMode(String m) {
if (m.equals(mode)) return;
closeSheet();
final boolean b = "bus".equals(m);
View outV;
if (b) outV = (metro != null && metro.getVisibility() == View.VISIBLE) ? (View) metro : (View) note;
else outV = bus.getVisibility() == View.VISIBLE ? (View) bus : (View) note;
mode = m;
headBox.setVisibility(View.VISIBLE);
ScreenCore.Screen hc = headCache.get(headKey());
if (hc != null) {
head.setScreen(hc, true);
headLoaded = true;
} else {
headLoaded = false;
loadHead(null, null, null);
}
View inV;
if (b) {
busSel = -1;
busAt = 0L;
loadBus(false);
inV = busShown && Core.engine.hasFix() ? (View) bus : (View) note;
busTickStart();
} else {
busSeq++;
if (data == null) note.setText("지도를 불러오는 중이에요…");
inV = metro != null ? (View) metro : (View) note;
onShow();
}
slideTo(inV, outV, b ? 1 : -1);
}

private void slideTo(final View in, final View out, int dir) {
final int gen = ++slideGen;
final float w = Math.max(1f, (float) holder.getWidth());
android.view.animation.PathInterpolator ip = new android.view.animation.PathInterpolator(0.32f, 0.72f, 0f, 1f);
in.animate().cancel();
out.animate().cancel();
in.setVisibility(View.VISIBLE);
if (in == out) {
in.setTranslationX(0f);
return;
}
in.setTranslationX(dir * w);
in.animate().translationX(0f).setDuration(260L).setInterpolator(ip).start();
out.animate().translationX(-dir * w).setDuration(260L).setInterpolator(ip).withEndAction(new Runnable() {
@Override
public void run() {
if (gen != slideGen) return;
out.setVisibility(out == metro ? View.INVISIBLE : View.GONE);
out.setTranslationX(0f);
}
}).start();
}

private void setModeOld(String m) {
        if (m.equals(mode)) return;
        closeSheet();
        mode = m;
        boolean b = "bus".equals(m);
        headBox.setVisibility(View.VISIBLE);
        bus.setVisibility(b ? View.VISIBLE : View.GONE);
        if (metro != null) metro.setVisibility(b ? View.GONE : View.VISIBLE);
        note.setVisibility(View.GONE);
        if (b) {
            busSel = -1;
            busAt = 0L;
            headLoaded = false;
            loadHead(null, null, null);
            loadBus(false);
            busTickStart();
        } else {
            busSeq++;
            headLoaded = false;
            if (data == null) note.setVisibility(View.VISIBLE);
            onShow();
        }
    }

    void destroy() {
        busSeq++;
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
                openTimetable(data.labelName(op));
            }

            @Override
            public void onGestureStart() {
                closeSheet();
            }

            @Override
            public void onEdgeSwipe(int dir) {
                if (dir == 1) setMode("bus");                          // 노선도 끝에서 더 밀면 버스로
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
                openTimetable(data.labelName(op));
            }
        });
        holder.addView(metro, 0, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        metro.setFilter(flt);
        if ("bus".equals(mode)) metro.setVisibility(View.GONE);
        note.setVisibility("bus".equals(mode) ? View.GONE : View.GONE);
    }

    // ───────── 머리(검색·호선 칩) ─────────
    private String req(String part, String q, double[] gps) {
        JSONObject o = new JSONObject();
        try {
            JSONObject f = new JSONObject();
            f.put("part", part);
            f.put("mode", "bus".equals(mode) ? "bus" : "subway");
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
final String hk = (q == null || q.isEmpty()) ? headKey() : "";
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
                            if (!hk.isEmpty()) headCache.put(hk, sc);
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
            if (v.startsWith("m:")) {
                setMode(v.substring(2));
                return;
            }
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

    // ───────── 버스 (길동무 서버가 지도 + 정류장 카드를 한 번에 내려 준다) ─────────
    private String busBody(double[] g, String vw, int sel, LinkedHashMap<String, String> resIn) {
        JSONObject o = new JSONObject();
        try {
            JSONObject f = new JSONObject();
            f.put("part", "b");
            f.put("mode", "bus");
            f.put("reg", "seoul");
            f.put("flt", flt);
            f.put("th", theme);
            JSONArray ga = new JSONArray();
            ga.put(g[0]);
            ga.put(g[1]);
            f.put("gps", ga);
            JSONObject b = new JSONObject();
            b.put("vw", vw);
            b.put("sel", sel);
            b.put("sv", 1);
            b.put("svb", 300);
            b.put("lat", g[0]);
            b.put("lng", g[1]);
            b.put("fav", new JSONArray(favRaw == null ? "[]" : favRaw));
            b.put("nx", new JSONObject());
            b.put("al", new JSONObject(alRaw == null ? "{}" : alRaw));
            b.put("ord", new JSONArray(ordRaw));
            JSONObject res = new JSONObject();
            for (Map.Entry<String, String> e : resIn.entrySet()) res.put(e.getKey(), e.getValue());
            b.put("res", res);
            f.put("bus", b);
            o.put("cap", Wire.CAP);
            o.put("f", f);
        } catch (Exception e) {
            // 빈 요청이 가면 서버가 거절한다
        }
        return o.toString();
    }

    private void busNote(String s) {
        bus.setVisibility(View.GONE);
        note.setText(s);
        note.setVisibility(View.VISIBLE);
    }

    private void loadBus(final boolean quiet) {
        Engine en = Core.engine;
        if (!en.hasFix()) {
            busNote("내 위치를 아직 몰라요. 설정에서 위치 공유를 켜 주세요");
            return;
        }
        final double[] g = en.where();
        final String vw = busVw;
        final int sel = busSel;
        final LinkedHashMap<String, String> resCopy = new LinkedHashMap<String, String>(busRes);
        final int seq = ++busSeq;
        if (!quiet && !busShown) busNote("주변 정류장을 불러오는 중이에요…");
        Wire.EX.execute(new Runnable() {
            @Override
            public void run() {
                loadPrefs();
                final String body = busBody(g, vw, sel, resCopy);
                final String r = Wire.post("/screen/map", body, 15000);
                final ScreenCore.Screen sc = r == null ? null : SvHost.parse(SvHost.strip(r));
                final LinkedHashMap<String, String> keep = new LinkedHashMap<String, String>();
                final ArrayList<String> stopsNow = new ArrayList<String>();
                final int[] lim = new int[] {favMax, aliasMax};
                final String[] txt = new String[] {favAdd, favRm, favFull};
                if (r != null) {
                    try {
                        JSONObject info = new JSONObject(r).optJSONObject("info");
                        JSONArray sa = info == null ? null : info.optJSONArray("stops");
                        if (sa != null) {
                            for (int i = 0; i < sa.length() && i < 40; i++) {
                                JSONObject so = sa.optJSONObject(i);
                                stopsNow.add(so == null ? "{}" : so.toString());
                            }
                        }
                        JSONObject fp = info == null ? null : info.optJSONObject("favp");
                        if (fp != null) {
                            lim[0] = fp.optInt("max", lim[0]);
                            lim[1] = fp.optInt("al", lim[1]);
                            txt[0] = fp.optString("add", txt[0]);
                            txt[1] = fp.optString("rm", txt[1]);
                            txt[2] = fp.optString("full", txt[2]);
                        }
                        JSONObject bres = info == null ? null : info.optJSONObject("bres");
                        if (bres != null) {
                            Iterator<String> it = bres.keys();
                            while (it.hasNext()) {
                                String k = it.next();
                                if (k.matches("tp|gg|tn|d1")) {
                                    String val = bres.optString(k, "");
                                    if (!val.isEmpty()) keep.put(k, val);
                                }
                            }
                        }
                    } catch (Exception e) {
                        keep.clear();
                    }
                }
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        if (seq != busSeq || !"bus".equals(mode)) return;
                        if (sc == null) {
                            if (!busShown) busNote("정류장 정보를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요");
                            else toast("정류장 정보를 새로 받지 못했어요");
                            busAt = System.currentTimeMillis() - 12000L;
                            return;
                        }
                        if (!keep.isEmpty()) {
                            busRes.clear();
                            busRes.putAll(keep);
                        }
                        lastStops.clear();
                        lastStops.addAll(stopsNow);
                        favMax = lim[0];
                        aliasMax = lim[1];
                        favAdd = txt[0];
                        favRm = txt[1];
                        favFull = txt[2];
                        note.setVisibility(View.GONE);
                        bus.setVisibility(View.VISIBLE);
                        bus.setScreen(sc, busShown);
                        busShown = true;
                        busAt = System.currentTimeMillis();
                    }
                });
            }
        });
    }

    private final Runnable busTick = new Runnable() {
        @Override
        public void run() {
            busTicking = false;
            if (!"bus".equals(mode) || !isShown()) return;
            if (System.currentTimeMillis() - busAt > 20000L) loadBus(true);
            busTickStart();
        }
    };

    private void busTickStart() {
        if (busTicking || !"bus".equals(mode)) return;
        busTicking = true;
        ui.postDelayed(busTick, 10000L);
    }

    private void onBusAct(String kind, String v) {
        if (v == null) return;
        if ("cat".equals(kind)) {
            if (v.startsWith("m:")) setMode(v.substring(2));
            return;
        }
        if (!"call".equals(kind)) return;
        if ("mp.vw.near".equals(v) || "mp.vw.fav".equals(v)) {
            String nv = v.substring(6);
            if (nv.equals(busVw)) return;
            busVw = nv;
            busSel = -1;
            loadBus(true);
        } else if ("mp.rf".equals(v)) {
            busSel = -1;
            busRes.clear();
            loadBus(true);
        } else if (v.startsWith("mp.pc.") || v.startsWith("mp.pm.")) {
            try {
                busSel = Integer.parseInt(v.substring(6));
            } catch (NumberFormatException e) {
                return;
            }
            loadBus(true);
        } else if (v.startsWith("mp.fv.")) {
            toggleFav(stopIdx(v));
        } else if (v.startsWith("mp.al.")) {
            aliasDialog(stopIdx(v));
        } else if ("mp.rt".equals(v)) {
            busRes.clear();
            loadBus(true);
        } else if (v.startsWith("br.")) {
            toast("이 기능은 곧 열려요");
        }
    }

    /** 주변 정류장 카드를 끌어 바꾼 순서는 이 기기에 두고, 요청마다 서버에 실어 보낸다. */
    private void reorderNear(String[] keys, int[] perm) {
        if (!"bus".equals(mode) || !"near".equals(busVw) || keys == null || keys.length < 2 || keys.length > 40) return;
        JSONArray a = new JSONArray();
        for (int i = 0; i < keys.length; i++) {
            if (keys[i] == null || keys[i].isEmpty() || keys[i].length() > 64) return;
            a.put(keys[i]);
        }
        ordRaw = a.toString();
        final String o = ordRaw;
        Wire.EX.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    ctx.getSharedPreferences("kids_busmap", Context.MODE_PRIVATE).edit().putString("ord", o).apply();
                } catch (Throwable t) {
                    // 저장 실패는 이번 실행에서만 유지
                }
            }
        });
        busSel = -1;
        loadBus(true);
    }

    private int stopIdx(String v) {
        try {
            int i = Integer.parseInt(v.substring(6));
            return i >= 0 && i < lastStops.size() ? i : -1;
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    /** 즐겨찾기·별명은 이 기기에만 두고(작은 설정 파일), 길동무 서버에는 요청마다 실어 보낸다. 읽기는 뒤 스레드에서. */
    private synchronized void loadPrefs() {
        if (favRaw != null) return;
        try {
            SharedPreferences sp = ctx.getSharedPreferences("kids_busmap", Context.MODE_PRIVATE);
            favRaw = sp.getString("fav", "[]");
            alRaw = sp.getString("al", "{}");
            ordRaw = sp.getString("ord", "[]");
        } catch (Throwable t) {
            favRaw = "[]";
            alRaw = "{}";
        }
    }

    private void savePrefs() {
        final String f = favRaw, a = alRaw;
        Wire.EX.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    ctx.getSharedPreferences("kids_busmap", Context.MODE_PRIVATE).edit().putString("fav", f).putString("al", a).apply();
                } catch (Throwable t) {
                    // 저장 실패는 이번 실행에서만 유지
                }
            }
        });
    }

    private void toggleFav(int i) {
        if (i < 0 || favRaw == null) return;
        try {
            JSONObject stop = new JSONObject(lastStops.get(i));
            String id = stop.optString("id", "");
            if (id.isEmpty()) return;
            JSONArray fl = new JSONArray(favRaw);
            int at = -1;
            for (int k = 0; k < fl.length(); k++) {
                JSONObject x = fl.optJSONObject(k);
                if (x != null && id.equals(x.optString("id", ""))) {
                    at = k;
                    break;
                }
            }
            if (at >= 0) {
                fl.remove(at);
                toast(favRm);
            } else {
                if (fl.length() >= favMax) {
                    toast(favFull);
                    return;
                }
                fl.put(stop);
                toast(favAdd);
            }
            favRaw = fl.toString();
            savePrefs();
            loadBus(true);
        } catch (Exception e) {
            toast("즐겨찾기를 바꾸지 못했어요");
        }
    }

    private void aliasDialog(int i) {
        if (i < 0 || alRaw == null) return;
        final String id, nm;
        final JSONObject al;
        try {
            JSONObject stop = new JSONObject(lastStops.get(i));
            id = stop.optString("id", "");
            nm = stop.optString("nm", "");
            al = new JSONObject(alRaw);
        } catch (Exception e) {
            return;
        }
        if (id.isEmpty()) return;
        final EditText et = new EditText(ctx);
        et.setSingleLine(true);
        et.setFilters(new InputFilter[] {new InputFilter.LengthFilter(Math.max(1, aliasMax))});
        et.setText(al.optString(id, ""));
        et.setSelection(et.getText().length());
        new AlertDialog.Builder(ctx)
                .setTitle(nm)
                .setView(et)
                .setPositiveButton("저장", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int w) {
                        String t = et.getText().toString().trim();
                        try {
                            if (t.isEmpty()) al.remove(id);
                            else al.put(id, t);
                            alRaw = al.toString();
                        } catch (Exception e) {
                            return;
                        }
                        savePrefs();
                        loadBus(true);
                    }
                })
                .setNegativeButton("취소", null)
                .show();
    }

    // ───────── 역을 누르면 바로 시간표 ─────────
    private void openTimetable(String label) {
        String name = label == null ? "" : label.replaceAll("\\s+", "").trim();
        if (name.isEmpty()) return;
        closeSheet();
        stn = name;
        TtSheet t = new TtSheet(name);
        tt = t;
        t.show();
    }

    /** 시간표 시트: 길동무 서버(part "tt")가 화면을 채워 주고, 못 채운 노선·요일만 /next-train 으로 받아 다시 부탁한다. */
    private final class TtSheet {
        final String name;
        int gen = 0;
        String line = "", day = "", dk = "", state = "loading";
        final ArrayList<String> lines = new ArrayList<String>(), dks = new ArrayList<String>();
        final LinkedHashMap<String, String> res = new LinkedHashMap<String, String>();
        boolean need = false;
        String needLine = "", needDay = "", asked = "";
        ScreenView sv;
        Dialog d;
        View dv;

        TtSheet(String n) {
            name = n;
        }

        void show() {
            sv = SvHost.make(ctx, new SvHost.Cb() {
                @Override
                public void act(String kind, String v) {
                    if ("call".equals(kind)) onAct(v);
                }
            });
            int[] pal = SvHost.palette(theme);
            sv.setPalette(pal);
            sv.setParentIntercept(true);
            d = new Dialog(ctx, android.R.style.Theme_Material_Light_Dialog_NoActionBar);
            d.setContentView(sv);
            int hpx = Math.round(ctx.getResources().getDisplayMetrics().heightPixels * 0.62f);
            try {
                Window w = d.getWindow();
                w.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, hpx);
                w.setGravity(Gravity.BOTTOM);
                w.setBackgroundDrawable(new ColorDrawable(pal[0]));
                w.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
                w.setWindowAnimations(0);
                dv = w.getDecorView();
                dv.setAlpha(0f);
                dv.setTranslationY(hpx * 0.35f);
                if (metro != null) metro.setCover(hpx);
                final Dialog me = d;
                d.setOnDismissListener(new DialogInterface.OnDismissListener() {
                    @Override
                    public void onDismiss(DialogInterface x) {
                        gen++;
                        if (sheet == me) sheet = null;
                        if (tt == TtSheet.this) tt = null;
                        if (metro != null) metro.setCover(0f);
                    }
                });
                sheet = d;
                d.show();
                dv.animate().alpha(1f).translationY(0f).setDuration(340L).setInterpolator(new android.view.animation.PathInterpolator(0.32f, 0.72f, 0f, 1f)).start();
            } catch (Throwable t) {
                if (dv != null) {
                    dv.setAlpha(1f);
                    dv.setTranslationY(0f);
                }
                sheet = null;
                tt = null;
                return;
            }
            if (metro != null) metro.ensureVisible(name);
            render();
        }

        void onAct(String v) {
            if (v == null) return;
            if ("mp.close".equals(v)) {
                closeSheetAnim();
            } else if ("mt.retry".equals(v)) {
                state = "loading";
                asked = "";
                render();
            } else if (v.startsWith("mt.l.")) {
                try {
                    int i = Integer.parseInt(v.substring(5));
                    if (i < 0 || i >= lines.size()) return;
                    line = lines.get(i);
                    day = "";
                    dk = "";
                    render();
                } catch (NumberFormatException e) {
                    // 무시
                }
            } else if (v.startsWith("mt.d.")) {
                day = v.substring(5);
                if (!res.containsKey(line + "|" + day)) {
                    needLine = line;
                    needDay = day;
                    state = "loading";
                }
                render();
            } else if (v.startsWith("mt.k.")) {
                try {
                    int i = Integer.parseInt(v.substring(5));
                    if (i < 0 || i >= dks.size()) return;
                    dk = dks.get(i);
                    render();
                } catch (NumberFormatException e) {
                    // 무시
                }
            }
        }

        String body() {
            JSONObject o = new JSONObject();
            try {
                JSONObject f = new JSONObject();
                f.put("part", "tt");
                f.put("stn", name);
                f.put("sl", "");
                f.put("reg", "seoul");
                f.put("th", theme);
                JSONObject t = new JSONObject();
                t.put("sv", 1);
                t.put("st", state);
                JSONObject sel = new JSONObject();
                sel.put("line", line);
                sel.put("day", day);
                sel.put("dk", dk);
                t.put("sel", sel);
                JSONObject rs = new JSONObject();
                for (Map.Entry<String, String> e : res.entrySet()) rs.put(e.getKey(), new JSONObject(e.getValue()));
                t.put("res", rs);
                f.put("tt", t);
                o.put("cap", Wire.CAP);
                o.put("f", f);
            } catch (Exception e) {
                // 빈 요청이 가면 서버가 거절한다
            }
            return o.toString();
        }

        void render() {
            final int my = ++gen;
            final String b = body();
            Wire.EX.execute(new Runnable() {
                @Override
                public void run() {
                    final String r = Wire.post("/screen/map", b, 10000);
                    final ScreenCore.Screen sc = r == null ? null : SvHost.parse(SvHost.strip(r));
                    ui.post(new Runnable() {
                        @Override
                        public void run() {
                            if (my != gen || tt != TtSheet.this) return;
                            if (sc == null) {
                                toast("시간표를 불러오지 못했어요");
                                if (res.isEmpty()) closeSheet();
                                return;
                            }
                            readInfo(r);
                            sv.setScreen(sc, true);
                            if (need && !"fail".equals(state)) fetch();
                        }
                    });
                }
            });
        }

        void readInfo(String r) {
            need = false;
            try {
                JSONObject im = new JSONObject(r).optJSONObject("info");
                if (im == null) return;
                fill(im.optJSONArray("lines"), lines);
                fill(im.optJSONArray("dks"), dks);
                JSONObject fl = im.optJSONObject("fill");
                if (fl != null) {
                    Iterator<String> it = fl.keys();
                    while (it.hasNext()) {
                        String k = it.next();
                        JSONObject val = fl.optJSONObject(k);
                        if (val != null && k.length() <= 40) res.put(k, val.toString());
                    }
                    state = "ok";
                }
                line = im.optString("line", line);
                day = im.optString("day", day);
                dk = im.optString("dk", dk);
                JSONObject nd = im.optJSONObject("need");
                if (nd != null) {
                    need = true;
                    needLine = nd.optString("line", "");
                    needDay = nd.optString("day", "");
                }
            } catch (Exception e) {
                need = false;
            }
        }

        void fill(JSONArray a, ArrayList<String> out) {
            if (a == null) return;
            out.clear();
            for (int i = 0; i < a.length(); i++) out.add(a.optString(i, ""));
        }

        /** 서버가 못 채운 시간표만 기기가 /next-train 으로 한 번 받는다. 같은 요청은 두 번 묻지 않는다. */
        void fetch() {
            final String key = needLine + "|" + needDay + "|" + lines.size();
            if (key.equals(asked)) return;
            asked = key;
            final boolean first = needDay.isEmpty();
            final String nl = needLine, nd = needDay;
            final ArrayList<String> ls = new ArrayList<String>(lines);
            final int my = gen;
            Wire.EX.execute(new Runnable() {
                @Override
                public void run() {
                    JSONObject o = new JSONObject();
                    JSONArray items = new JSONArray();
                    long now = System.currentTimeMillis();
                    try {
                        if (first) {
                            for (int i = 0; i < ls.size() && i < 20; i++) {
                                JSONObject it = new JSONObject();
                                it.put("id", i);
                                it.put("op", "timetable");
                                it.put("line", ls.get(i));
                                it.put("from", name);
                                it.put("baseMs", now);
                                items.put(it);
                            }
                        } else {
                            JSONObject it = new JSONObject();
                            it.put("id", 0);
                            it.put("op", "timetable");
                            it.put("line", nl);
                            it.put("from", name);
                            it.put("day", nd);
                            it.put("baseMs", now);
                            items.put(it);
                        }
                        o.put("items", items);
                    } catch (Exception e) {
                        // 빈 요청
                    }
                    final String r = Wire.post("/next-train", o.toString(), 12000);
                    final LinkedHashMap<String, String> got = new LinkedHashMap<String, String>();
                    if (r != null) {
                        try {
                            JSONArray arr = new JSONObject(r).optJSONArray("items");
                            if (arr != null) {
                                for (int i = 0; i < arr.length(); i++) {
                                    JSONObject x = arr.optJSONObject(i);
                                    if (x == null) continue;
                                    int id = x.optInt("id", -1);
                                    String ln = first ? (id >= 0 && id < ls.size() ? ls.get(id) : "") : nl;
                                    if (ln.isEmpty()) continue;
                                    got.put(ln + "|" + (first ? "-" : nd), x.toString());
                                }
                            }
                        } catch (Exception e) {
                            got.clear();
                        }
                    }
                    ui.post(new Runnable() {
                        @Override
                        public void run() {
                            if (tt != TtSheet.this || my != gen) return;
                            if (got.isEmpty()) {
                                state = "fail";
                            } else {
                                res.putAll(got);
                                state = "ok";
                            }
                            render();
                        }
                    });
                }
            });
        }
    }

    /** 길동무처럼 시간표 창을 아래로 부드럽게 내린 뒤 닫는다(160~240ms 감속). */
    private void closeSheetAnim() {
        final TtSheet ts = tt;
        final Dialog dlg = sheet;
        if (ts == null || dlg == null || ts.dv == null) {
            closeSheet();
            return;
        }
        tt = null;
        ts.gen++;
        sheet = null;
        if (metro != null) metro.setCover(0f);
        ts.dv.animate().alpha(0f).translationY(ts.dv.getHeight() * 0.35f).setDuration(200L).setInterpolator(new android.view.animation.PathInterpolator(0.4f, 0f, 0.2f, 1f)).withEndAction(new Runnable() {
            @Override
            public void run() {
                try {
                    dlg.dismiss();
                } catch (Throwable t) {
                    // 이미 닫힘
                }
            }
        }).start();
    }

    private void closeSheet() {
        TtSheet ts = tt;
        tt = null;
        if (ts != null) ts.gen++;
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
