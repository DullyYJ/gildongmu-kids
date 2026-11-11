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
import com.dullyyj.subway.PlayCore;
import com.dullyyj.subway.PlayView;
import com.dullyyj.subway.ScreenCore;
import com.dullyyj.subway.ScreenView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
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
    private boolean dataLoading = false, headLoaded = false, metroReady = false, headWarmed = false;
    private String theme = "pastel", flt = "ALL", stn = "";
    private int headSeq = 0;
    private Dialog sheet;
    private TtSheet tt;
    private BrSheet br;                                              // 버스 노선 상세(세부 위치) 시트 — 길동무와 같은 엔진 화면(part "br")
    private final HashMap<Integer, ArrayList<String[]>> rts = new HashMap<Integer, ArrayList<String[]>>();   // 정류장 번호 → 줄마다 [노선 id, 번호, 종류] (엔진 info.rts)
    private String mode = "bus";                                   // 길동무처럼 노선도를 열면 🚌 버스 탭부터
    private final ScreenView bus;
    private String busVw = "near";
    private int busSel = -1, busSeq = 0;
    private long busAt = 0L;
    private boolean busShown = false, busTicking = false;
    private String lastBusJs = "";
    private final LinkedHashMap<String, String> needRes = new LinkedHashMap<String, String>();
    private int busRound = 0;
    private boolean needPass = false;
    private volatile ArrayList<String[]> needNext = new ArrayList<String[]>();
    private final LinkedHashMap<String, String> busRes = new LinkedHashMap<String, String>();
    private final ArrayList<String> lastStops = new ArrayList<String>();
private final LinkedHashMap<String, ScreenCore.Screen> headCache = new LinkedHashMap<String, ScreenCore.Screen>();
private int slideGen = 0;
    private String favRaw = null, alRaw = null;
    private int aliasMax = 10;                              // 별명 입력칸 글자 수 제한(엔진 favp.al 이 알려 준 값 — 다듬기는 엔진이 다시 한다)
    private long pollTick = 10000L, pollStale = 20000L, pollRetry = 8000L;      // 갱신 박자: 엔진(info.poll)이 알려 준 값만 쓴다(첫 응답 전 기본값은 같은 값)
    private String pendAct = null;                          // 별·별명을 누른 것 — 다음 요청에 act 로 실어 보내면 엔진이 새 목록·안내 글을 돌려준다
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
if (!headWarmed) {                       // 정류장·호선 칩 줄도 미리: 저장해 둔 지난 화면을 바로 얹고, 새 것은 뒤에서 받는다
headWarmed = true;
primeHead();
loadHead(null, null, null);
}
}

/** 노선도 탭이 한 번에 뜰 준비가 됐나 — 머리(칩 줄)가 있고, 지도 그림도 한 장 그려졌다(버스는 머리만). */
boolean ready() {
return headLoaded && ("bus".equals(mode) || metroReady);
}

/** 메모리 · 저장해 둔 머리 화면이 있으면 곧바로 얹는다(네트워크를 기다리지 않는다). */
private boolean primeHead() {
String hk = headKey();
ScreenCore.Screen hc = headCache.get(hk);
if (hc == null) {
try {
String raw = Core.store == null ? null : Core.store.get("kh." + hk, null);
if (raw != null && raw.length() > 0) {
hc = SvHost.parse(raw);
if (hc != null) headCache.put(hk, hc);
}
} catch (Throwable t) {
hc = null;
}
}
if (hc == null) return false;
head.setScreen(hc, true);
headLoaded = true;
return true;
}

void setTheme(String t) {
        String nt = "dark".equals(t) ? "dark" : "pastel";
        if (nt.equals(theme)) return;
        theme = nt;
        applyTheme();
        headLoaded = false;
        headWarmed = false;
        busAt = 0L;
        if (getVisibility() == View.VISIBLE) onShow();
        else warm();
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
            if (System.currentTimeMillis() - busAt > pollStale) loadBus(busAt > 0L);
            busTickStart();
            return;
        }
        if (data == null && !dataLoading) loadData();
        if (!headLoaded) {
            primeHead();
            loadHead(null, null, null);
        }
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
        in.setLayerType(View.LAYER_TYPE_HARDWARE, null); // 밀리는 동안 두 화면을 한 장씩 그림으로 두어 매 프레임 다시 그리지 않는다(길동무 시트와 같은 방식)
        out.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        ui.postDelayed(new Runnable() {
            @Override
            public void run() {
                in.setLayerType(View.LAYER_TYPE_NONE, null);
                out.setLayerType(View.LAYER_TYPE_NONE, null);
            }
        }, 320L);
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
                metroReady = true;
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
                            if (!hk.isEmpty()) {
headCache.put(hk, sc);
try {
if (Core.store != null) Core.store.put("kh." + hk, SvHost.strip(r));
} catch (Throwable t) {
// 저장 실패는 다음에 다시 받으면 된다
}
}
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
    private String busBody(double[] g, String vw, int sel, LinkedHashMap<String, String> resIn, String act) {
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
            b.put("svb", busShown ? 2500 : 300); // 첫 그림은 빨리(300ms), 갱신은 서버가 도착정보를 더 기다려 받아 오게(길동무와 같다)
            b.put("lat", g[0]);
            b.put("lng", g[1]);
            b.put("fav", new JSONArray(favRaw == null ? "[]" : favRaw));
            b.put("nx", new JSONObject());
            b.put("al", new JSONObject(alRaw == null ? "{}" : alRaw));
            b.put("ord", new JSONArray(ordRaw));
            if (act != null) b.put("act", new JSONObject(act));
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
        if (!needPass) { // 사용자가 누르거나 주기 갱신 — 옛 도착정보는 버려 서버가 새로 받게 한다
            needRes.clear();
            busRound = 0;
        }
        needPass = false;
        resCopy.putAll(needRes);
        final int seq = ++busSeq;
        final String act = pendAct;                                   // 누른 별·별명은 이 요청 하나에만 실린다(엔진이 새 목록을 돌려주면 그것을 저장한다)
        pendAct = null;
        if (!quiet && !busShown) busNote("주변 정류장을 불러오는 중이에요…");
        Wire.EX.execute(new Runnable() {
            @Override
            public void run() {
                loadPrefs();
                final String body = busBody(g, vw, sel, resCopy, act);
                final String r = Wire.post("/screen/map", body, 15000);
                final ScreenCore.Screen sc = r == null ? null : SvHost.parse(SvHost.strip(r));
                final LinkedHashMap<String, String> keep = new LinkedHashMap<String, String>();
                final ArrayList<String> stopsNow = new ArrayList<String>();
                final int[] lim = new int[] {aliasMax};
                final long[] pl = new long[] {pollTick, pollStale, pollRetry};
                final String[] editMsg = new String[] {""};
                final HashMap<Integer, ArrayList<String[]>> rtsNow = new HashMap<Integer, ArrayList<String[]>>();
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
                        JSONObject rj = info == null ? null : info.optJSONObject("rts");
                        if (rj != null) {
                            Iterator<String> ki = rj.keys();
                            while (ki.hasNext()) {
                                String rk = ki.next();
                                JSONArray ra = rj.optJSONArray(rk);
                                if (ra == null) continue;
                                int rsi;
                                try {
                                    rsi = Integer.parseInt(rk);
                                } catch (NumberFormatException nfe) {
                                    continue;
                                }
                                ArrayList<String[]> rl = new ArrayList<String[]>();
                                for (int j = 0; j < ra.length() && rl.size() < 40; j++) {
                                    JSONArray rx = ra.optJSONArray(j);
                                    if (rx == null || rx.length() < 3) continue;
                                    rl.add(new String[] {rx.optString(0, ""), rx.optString(1, ""), rx.optString(2, "")});
                                }
                                rtsNow.put(rsi, rl);
                            }
                        }
                        JSONObject fp = info == null ? null : info.optJSONObject("favp");
                        if (fp != null) lim[0] = fp.optInt("al", lim[0]);
                        JSONObject po = info == null ? null : info.optJSONObject("poll");
                        if (po != null) {
                            pl[0] = po.optLong("tick", pl[0]);
                            pl[1] = po.optLong("stale", pl[1]);
                            pl[2] = po.optLong("retry", pl[2]);
                        }
                        JSONObject ed = info == null ? null : info.optJSONObject("edit");      // 엔진이 정한 새 즐겨찾기·별명 — 그대로 저장하고 안내 글만 보인다
                        if (ed != null) {
                            JSONArray ef = ed.optJSONArray("fav");
                            JSONObject ea = ed.optJSONObject("al");
                            if (ef != null && ea != null) {
                                favRaw = ef.toString();
                                alRaw = ea.toString();
                                savePrefs();
                                editMsg[0] = ed.optString("msg", "");
                            }
                        }
                        JSONArray nd = info == null || info.optJSONObject("bus") == null ? null : info.optJSONObject("bus").optJSONArray("need");
                if (nd != null) { // 서버가 못 받은 정류장 목록 · 도착정보 — 기기가 직접 받아 다시 부탁한다(길동무와 같은 길)
                    ArrayList<String[]> nn = new ArrayList<String[]>();
                    for (int i = 0; i < nd.length() && nn.size() < 32; i++) {
                        JSONObject o = nd.optJSONObject(i);
                        if (o == null) continue;
                        String nk = o.optString("k", "");
                        String nu = o.optString("url", "");
                        if (nk.matches("[afgh][0-9]{1,3}|[tu][0-9]{1,3}|tp|gg|tn|d1") && nu.length() > 0 && nu.length() < 600) nn.add(new String[] {nk, nu});
                    }
                    needNext = nn;
                } else {
                    needNext = new ArrayList<String[]>();
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
                        if (editMsg[0].length() > 0) toast(editMsg[0]);
                        else if (act != null && r == null) toast("즐겨찾기를 바꾸지 못했어요");
                        if (seq != busSeq || !"bus".equals(mode)) return;
                        if (sc == null) {
                            if (!busShown) busNote("정류장 정보를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요");
                            else toast("정류장 정보를 새로 받지 못했어요");
                            busAt = System.currentTimeMillis() - (pollStale - pollRetry);
                            return;
                        }
                        if (!keep.isEmpty()) {
                            busRes.clear();
                            busRes.putAll(keep);
                        }
                        lastStops.clear();
                        lastStops.addAll(stopsNow);
                        rts.clear();
                        rts.putAll(rtsNow);
                        routePrefetch();
                        aliasMax = lim[0];
                        pollTick = pl[0];
                        pollStale = pl[1];
                        pollRetry = pl[2];
                        note.setVisibility(View.GONE);
                        bus.setVisibility(View.VISIBLE);
                        if (!(busShown && !needNext.isEmpty() && busRound < 2) && !r.equals(lastBusJs)) { // 이미 그림이 떠 있는데 새 화면이 '불러오는 중' 줄뿐이면(받을 게 남음) 그리지 않고 다 받은 뒤에 그린다 — 도착정보가 깜박이지 않게 // 받은 화면이 그대로면 다시 짜지 않는다(깜박임 · 스크롤 흔들림 없음)
                    lastBusJs = r;
                    bus.setScreen(sc, busShown);
                }
                        busShown = true;
                        busAt = System.currentTimeMillis();
                busNeedKick();
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
            if (br != null) {                                          // 노선 상세가 떠 있는 동안은 뒤 목록을 새로 받지 않는다
                busTickStart();
                return;
            }
            if (System.currentTimeMillis() - busAt > pollStale) loadBus(true);
            busTickStart();
        }
    };

    /** 서버가 'need' 로 남긴 주소를 기기가 직접 받아 다시 요청한다(최대 4바퀴). 길동무의 fetchBusNeed 와 같은 방식. */
    private void busNeedKick() {
        final ArrayList<String[]> work = needNext;
        needNext = new ArrayList<String[]>();
        if (work.isEmpty() || busRound >= 4 || !"bus".equals(mode)) return;
        busRound++;
        final int seq = busSeq;
        new Thread(new Runnable() {
            @Override
            public void run() {
                final LinkedHashMap<String, String> got = new LinkedHashMap<String, String>();
                ArrayList<Thread> ts = new ArrayList<Thread>();
                for (final String[] n : work) {
                    Thread t = new Thread(new Runnable() {
                        @Override
                        public void run() {
                            String b = busFetch(n[1]);
                            if (b != null && b.length() > 0) {
                                synchronized (got) {
                                    got.put(n[0], b.length() > 120000 ? b.substring(0, 120000) : b);
                                }
                            }
                        }
                    });
                    t.start();
                    ts.add(t);
                }
                long end = System.currentTimeMillis() + 14000L;
                for (Thread t : ts) {
                    try {
                        t.join(Math.max(1L, end - System.currentTimeMillis()));
                    } catch (InterruptedException e) {
                        break;
                    }
                }
                final LinkedHashMap<String, String> snap;
                synchronized (got) {
                    snap = new LinkedHashMap<String, String>(got);
                }
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        if (seq != busSeq || !"bus".equals(mode)) return;
                        if (snap.isEmpty()) { // 하나도 못 받았다 — 잠시 뒤 같은 주소로 다시
                            needNext = work;
                            ui.postDelayed(new Runnable() {
                                @Override
                                public void run() {
                                    if (seq == busSeq && "bus".equals(mode)) busNeedKick();
                                }
                            }, 1500L);
                            return;
                        }
                        needRes.putAll(snap);
                        needPass = true;
                        loadBus(true);
                    }
                });
            }
        }).start();
    }

    /** 주소 하나를 받는다 — 길동무와 같이 공공 API 는 버스 프록시로(실패하면 route-v2 로), 정류장 표는 직접. 허용 호스트가 아니면 null. */
    private static String busFetch(String raw) {
        String u, alt = "";
        if (raw.startsWith("https://gentle-lab-7e47subway-api.phg0643.workers.dev/bus-stops?") && raw.length() < 200 && raw.matches("[A-Za-z0-9:/._?=&%-]+")) {
            u = raw;
        } else if (raw.matches("^https?://(apis\\.data\\.go\\.kr|ws\\.bus\\.go\\.kr)/.*")) {
            try {
                String e = java.net.URLEncoder.encode(raw, "UTF-8");
                u = "https://gildongmu-bus.phg0643.workers.dev/tago?url=" + e;
                alt = "https://route-v2.phg0643.workers.dev/bus-tago?url=" + e;
            } catch (java.io.UnsupportedEncodingException x) {
                return null;
            }
        } else {
            return null;
        }
        String b = Wire.get(u, 7000);
        if ((b == null || b.length() == 0) && alt.length() > 0) b = Wire.get(alt, 6000);
        return b;
    }

    private void busTickStart() {
        if (busTicking || !"bus".equals(mode)) return;
        busTicking = true;
        ui.postDelayed(busTick, pollTick);
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
            openRoute(v);
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

    /** 별을 눌렀다 — 넣을지 뺄지·몇 곳까지·안내 글은 엔진이 정한다. 앱은 누른 정류장만 실어 보낸다. */
    private void toggleFav(int i) {
        if (i < 0 || i >= lastStops.size()) return;
        try {
            JSONObject a = new JSONObject();
            a.put("k", "fv");
            a.put("stop", new JSONObject(lastStops.get(i)));
            pendAct = a.toString();
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
                        try {                                                // 다듬기(앞뒤 공백·글자 수)·저장할 내용은 엔진이 정한다 — 앱은 쓴 글만 보낸다
                            JSONObject a = new JSONObject();
                            a.put("k", "al");
                            a.put("id", id);
                            a.put("t", et.getText().toString());
                            pendAct = a.toString();
                        } catch (Exception e) {
                            return;
                        }
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

    // 방금 연 역의 시간표 첫 화면 기억(길동무 ttCache 와 같다): 같은 역을 150초 안에 다시 누르면 기다림 없이 뜬다. 최대 6곳.
    private static final long TT_KEEP_MS = 150000L;
    private final LinkedHashMap<String, String> ttCache = new LinkedHashMap<String, String>();
    private final LinkedHashMap<String, Long> ttCacheAt = new LinkedHashMap<String, Long>();

    private String ttHit(String key) {
        String c = ttCache.get(key);
        Long at = ttCacheAt.get(key);
        return c != null && at != null && System.currentTimeMillis() - at < TT_KEEP_MS ? c : null;
    }

    private void ttPut(String key, String txt) {
        if (key == null || txt == null || txt.length() == 0 || txt.length() > 300000) return;
        ttCache.remove(key);
        ttCacheAt.remove(key);
        ttCache.put(key, txt);
        ttCacheAt.put(key, System.currentTimeMillis());
        while (ttCache.size() > 6) {
            String k = ttCache.keySet().iterator().next();
            ttCache.remove(k);
            ttCacheAt.remove(k);
        }
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
            sv.setScrollHook(new Runnable() {
                @Override
                public void run() {
                    playScroll();
                }
            });
            ScreenCore.Screen loc = SvHost.parse(localLoading());       // 서버 답을 기다리는 동안 바로 보이는 제목 + 0→100% 막대
            if (loc != null) sv.setScreen(loc, false);
            FrameLayout box = new FrameLayout(ctx);
            box.addView(sv, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            pv = new PlayView(ctx, dpr);                                // 제목 오른쪽 빈 칸의 캐릭터 놀이터(길동무와 같다) — 만져지지 않는다
            box.addView(pv, new FrameLayout.LayoutParams(1, 1, Gravity.TOP | Gravity.LEFT));
            d = new Dialog(ctx, android.R.style.Theme_Material_Light_Dialog_NoActionBar);
            d.setContentView(box);
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
                        if (pv != null) pv.end();
                        if (sheet == me) sheet = null;
                        if (tt == TtSheet.this) tt = null;
                        if (metro != null) metro.setCover(0f);
                    }
                });
                sheet = d;
                render();                                               // 창이 올라오는 그림보다 먼저 서버에 묻는다
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
            playLater();
        }

        /** 서버가 답하기 전에 바로 그리는 화면: 제목줄(놀이터 칸 포함) + 불러오는 중 막대. 모양은 서버(map.js mapTimetableSheet)의 불러오는 화면과 같다. */
        String localLoading() {
            try {
                JSONObject bar = new JSONObject();
                bar.put("t", "bar");
                bar.put("pad", new JSONArray().put(16).put(36).put(16).put(12));
                bar.put("rw", 100);
                bar.put("mq", true);
                bar.put("title", name + " 시간표");
                JSONObject lb = new JSONObject();
                lb.put("t", "lbar");
                lb.put("ttl", "시간표를 불러오는 중이에요");
                lb.put("sub", "잠시만 기다려 주세요");
                lb.put("pad", new JSONArray().put(16).put(36).put(16).put(0));
                JSONObject o = new JSONObject();
                o.put("ok", true);
                o.put("v", 1);
                o.put("screen", "maptt");
                o.put("cover", "tab");
                o.put("head", new JSONArray().put(bar));
                o.put("body", new JSONArray().put(lb));
                o.put("rev", "local-tt");
                return o.toString();
            } catch (Exception e) {
                return "";
            }
        }

        // ── 놀이터(길동무 ShellActivity.playPlace 와 같다): 제목 오른쪽 빈 칸에 캐릭터들이 논다 ──
        PlayView pv;
        float playScrollY;

        void playLater() {
            Runnable r = new Runnable() {
                @Override
                public void run() {
                    playPlace();
                }
            };
            ui.post(r);
            ui.postDelayed(r, 90L);
            ui.postDelayed(r, 420L);                                    // 올라오는 그림이 끝난 뒤 한 번 더(칸 크기가 정해진 뒤)
        }

        void playPlace() {
            final PlayView v = pv;
            if (v == null || sv == null || d == null || !d.isShowing() || tt != TtSheet.this) return;
            try {
                float[] a = sv.playAnchor(ScreenCore.K_BAR);
                float w = sv.getWidth() / dpr;
                float[] h = a == null || w <= 0f ? null : PlayCore.ttHost(a[4], a[5], a[0], a[2], a[6]);
                if (h == null) {                                        // 빈 칸이 없으면 놀이터도 없다
                    v.end();
                    return;
                }
                FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) v.getLayoutParams();
                int wp = Math.round(h[2] * dpr), hp = Math.round(h[3] * dpr), lx = Math.round(h[0] * dpr), ty = Math.round(Math.max(0f, h[1]) * dpr);
                if (lp.width != wp || lp.height != hp || lp.leftMargin != lx || lp.topMargin != ty) {
                    lp.width = wp;
                    lp.height = hp;
                    lp.leftMargin = lx;
                    lp.topMargin = ty;
                    v.setLayoutParams(lp);
                }
                boolean reduce = false;
                try {
                    reduce = android.provider.Settings.Global.getFloat(ctx.getContentResolver(), android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f;
                } catch (Throwable ignored) {
                    reduce = false;
                }
                v.begin(wp, hp, "dark".equals(theme), reduce, v.snap());
                playScrollY = a[7] > 0f ? 1f : 0f;
                playScroll();
            } catch (Throwable t) {
                v.end();                                                // 장식일 뿐 — 실패해도 시간표는 그대로
            }
        }

        /** 머리줄이 글과 함께 올라가면 놀이터 그림도 같은 만큼 옮긴다. */
        void playScroll() {
            if (pv == null || sv == null) return;
            pv.setTranslationY(playScrollY > 0f ? -sv.scrollPos() * dpr : 0f);
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

        /** 처음 요청(고른 것도 받아 둔 것도 없는 요청)인가 — 이 요청의 답만 잠깐 기억해 둔다. */
        boolean initial() {
            return res.isEmpty() && line.isEmpty() && day.isEmpty() && dk.isEmpty() && "loading".equals(state);
        }

        void apply(String r, ScreenCore.Screen sc) {
            readInfo(r);
            sv.setScreen(sc, true);
            playPlace();
            if (need && !"fail".equals(state)) fetch();
        }

        void render() {
            final int my = ++gen;
            final String b = body();
            final boolean first = initial();
            if (first) {                                               // 방금 본 역이면 기다림 없이(다음 열차 시각이 든 화면이라 150초만)
                String hit = ttHit(b);
                ScreenCore.Screen hs = hit == null ? null : SvHost.parse(SvHost.strip(hit));
                if (hs != null) {
                    apply(hit, hs);
                    return;
                }
            }
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
                            apply(r, sc);
                            if (first && !need) ttPut(b, r);           // 서버가 다 채운 화면만 둔다
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


    private String pfSig = "";
    private long pfAt = 0L;

    /**
     * 가까운 정류장이 정해져 도착정보가 뜨면, 그 정류장 노선들의 정류장 표를 모두 동시에 뒤에서 받아 기기에 둔다(길동무 brPrefetch).
     * 노선 줄을 누르면 표는 바로 그리고 버스 위치만 새로 받는다. 같은 정류장·노선이면 10분 안에는 다시 하지 않는다.
     */
    private void routePrefetch() {
        ArrayList<String[]> rl = rts.get(0);
        if (rl == null || rl.isEmpty() || lastStops.isEmpty()) return;
        final JSONObject sm;
        try {
            sm = new JSONObject(lastStops.get(0));
        } catch (Exception e) {
            return;
        }
        StringBuilder sg = new StringBuilder(sm.optString("id", "")).append('|');
        final ArrayList<String[]> jobs = new ArrayList<String[]>();
        for (int i = 0; i < rl.size() && jobs.size() < 8; i++) {
            String[] r = rl.get(i);
            if (r[0].isEmpty()) continue;
            jobs.add(r);
            sg.append(r[0]).append(',');
        }
        long now = System.currentTimeMillis();
        if (jobs.isEmpty() || (sg.toString().equals(pfSig) && now - pfAt < 600000L)) return;
        pfSig = sg.toString();
        pfAt = now;
        for (final String[] r : jobs) {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        new BrSheet(r[0], r[1], r[2], sm).prefetch();
                    } catch (Throwable t) {
                        // 미리 받기는 덤 — 실패해도 열 때 받는다
                    }
                }
            }, "kids-brpf").start();
        }
    }

    /** 정류장 카드의 노선 줄을 눌렀다("br.<정류장>.<줄>") — 길동무처럼 그 노선의 정류장 표 + 달리는 버스 위치를 시트로 연다. */
    private void openRoute(String v) {
        String[] pr = v.split("\\.");
        if (pr.length != 3) return;
        int si, ri;
        try {
            si = Integer.parseInt(pr[1]);
            ri = Integer.parseInt(pr[2]);
        } catch (NumberFormatException e) {
            return;
        }
        ArrayList<String[]> rl = rts.get(si);
        if (rl == null || ri < 0 || ri >= rl.size() || si < 0 || si >= lastStops.size() || rl.get(ri)[0].isEmpty()) {
            toast("이 노선 정보는 아직 열 수 없어요");
            return;
        }
        JSONObject sm;
        try {
            sm = new JSONObject(lastStops.get(si));
        } catch (Exception e) {
            return;
        }
        String[] r = rl.get(ri);
        closeSheet();
        BrSheet b = new BrSheet(r[0], r[1], r[2], sm);
        br = b;
        b.show();
    }

    /** 패밀리 앱은 출발·도착을 고르지 않는다 — 엔진이 np 를 모르는 옛 버전이어도 정류장 줄의 선택 글·표시와 아래 바를 뺀다. */
    private static String noPick(String json) {
        try {
            JSONObject root = new JSONObject(json);
            JSONArray body = root.optJSONArray("body");
            for (int i = 0; body != null && i < body.length(); i++) {
                JSONObject o = body.optJSONObject(i);
                if (o != null && "brs".equals(o.optString("t", ""))) {
                    o.remove("lab");                                   // act 는 둔다 — 앱 검증기가 정류장 줄에 act 가 없으면 화면을 통째로 거절한다(눌러도 onAct 가 무시)
                    o.remove("ps");
                }
            }
            root.put("foot", new JSONArray());
            return root.toString();
        } catch (Throwable t) {
            return json;
        }
    }

    /** 길동무처럼 노선 상세 창을 아래로 부드럽게 내린 뒤 닫는다. */
    private void closeBrAnim() {
        final BrSheet b = br;
        final Dialog dlg = sheet;
        if (b == null || dlg == null || b.dv == null) {
            closeSheet();
            return;
        }
        br = null;
        b.alive = false;
        sheet = null;
        b.dv.animate().alpha(0f).translationY(b.dv.getHeight() * 0.35f).setDuration(200L).setInterpolator(new android.view.animation.PathInterpolator(0.4f, 0f, 0.2f, 1f)).withEndAction(new Runnable() {
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

    /** 노선 상세 전용 통신 줄: 공용 Wire.EX(3줄)가 버스 목록 갱신·다른 통신에 묶여 있어도 노선 상세는 기다리지 않는다. */
    private static final java.util.concurrent.ExecutorService BR_EX = java.util.concurrent.Executors.newCachedThreadPool(new java.util.concurrent.ThreadFactory() {
        @Override
        public Thread newThread(Runnable r) {
            Thread t = new Thread(r, "kids-br");
            t.setDaemon(true);
            return t;
        }
    });

    private static final String[] BUS_ERR = {"OpenAPI_ServiceResponse", "cmmMsgHeader", "SERVICE_KEY_IS_NOT_REGISTERED_ERROR", "LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR"};

    /** 공공 API 오류 봉투(짧은 본문)가 아닌 정상 본문인가. */
    private static boolean busOk(String b) {
        if (b == null || b.isEmpty()) return false;
        if (b.length() > 4000) return true;
        for (String m : BUS_ERR) if (b.indexOf(m) >= 0) return false;
        return true;
    }

    /**
     * 노선 상세용 받기(길동무 MapCore.busGet 과 같은 길): 정류장 표는 버스 서버와 route-v2 두 길에 동시에 보내 먼저 온 정상 본문을 쓰고,
     * 버스 위치는 시도마다 길을 바꿔 가며 한 길씩 받는다. 허용 주소가 아니면 빈 글.
     */
    private static String busRace(String raw, final int ms, boolean pos, int attempt) {
        if (raw == null || !raw.matches("^https?://(apis\\.data\\.go\\.kr|ws\\.bus\\.go\\.kr)/.*")) return "";
        final String u, alt;
        try {
            String e = java.net.URLEncoder.encode(raw, "UTF-8");
            u = "https://gildongmu-bus.phg0643.workers.dev/tago?url=" + e;
            alt = "https://route-v2.phg0643.workers.dev/bus-tago?url=" + e;
        } catch (java.io.UnsupportedEncodingException x) {
            return "";
        }
        if (pos) {
            String b = Wire.get((attempt & 1) == 1 ? alt : u, ms);
            return busOk(b) ? b : "";
        }
        final Object lock = new Object();
        final String[] win = new String[1];
        final int[] done = new int[1];
        for (int i = 0; i < 2; i++) {
            final String url = i == 0 ? u : alt;
            new Thread(new Runnable() {
                @Override
                public void run() {
                    String b = Wire.get(url, ms);
                    synchronized (lock) {
                        if (win[0] == null && busOk(b)) win[0] = b;
                        done[0]++;
                        lock.notifyAll();
                    }
                }
            }, "kids-brr").start();
        }
        synchronized (lock) {
            long end = System.currentTimeMillis() + ms + 1500L;
            while (win[0] == null && done[0] < 2) {
                long w = end - System.currentTimeMillis();
                if (w <= 0) break;
                try {
                    lock.wait(w);
                } catch (InterruptedException e) {
                    break;
                }
            }
            return win[0] == null ? "" : win[0];
        }
    }

    /**
     * 노선 상세 시트(길동무 ShellActivity.openBusRoute/brRound/brFetchOne 과 같은 길): 계산·문구·배치는 모두 서버(part "br").
     * 서버가 'need' 로 남긴 주소(정류장 표 · 버스 위치)는 각각 따로 동시에 받아, 오는 대로 바로 다시 묻고 다시 그린다(표가 오면 위치를 기다리지 않고 그린다).
     * 정류장 표는 이 기기에 7일 두었다가 다음엔 바로 쓰고, 버스 위치만 새로 받는다. 8초마다 위치만 새로 받는다.
     * 패밀리 앱은 출발·도착을 고르지 않으므로 np:1 로 줄 선택 단추를 뺀다.
     */
    private final class BrSheet {
        final String rid, no, tp, src;
        String oJson = "{}", cc = "", via = "", stnJson = "", lastJs = "";
        volatile String pk = "", pu = "";                     // 버스 위치 주소 열쇠 · 주소(서버가 need 로 준 것 — 기기에 두었다가 다음엔 서버 답을 기다리지 않고 바로 받는다)
        volatile boolean alive = true;
        int req = 0, retryN = 0;
        boolean shown = false, busy = false, ticking = false, cached = false, cachePut = false;
        long busyAt = 0L;
        double[] me;
        final LinkedHashMap<String, String> res = new LinkedHashMap<String, String>();
        final HashSet<String> flight = new HashSet<String>();            // 지금 받는 중인 주소 열쇠(같은 것을 두 번 받지 않는다) — 메인 스레드에서만
        ScreenView sv;
        Dialog d;
        View dv;

        BrSheet(String rid, String no, String tp, JSONObject sm) {
            this.rid = rid;
            this.no = no;
            this.tp = tp;
            String id = sm.optString("id", "");
            String s = sm.optString("src", "");
            src = id.startsWith("GG:") || "gbis".equals(s) ? "gbis" : id.startsWith("SEOUL:") || "topis".equals(s) ? "topis" : "";
            try {
                JSONObject o = new JSONObject();
                o.put("id", id);
                o.put("nm", sm.optString("nm", ""));
                o.put("la", sm.optDouble("la", 0));
                o.put("lo", sm.optDouble("lo", 0));
                o.put("city", sm.optString("city", ""));
                oJson = o.toString();
            } catch (Exception e) {
                oJson = "{}";
            }
            me = Core.engine.hasFix() ? Core.engine.where() : null;
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
            ScreenCore.Screen loc = SvHost.parse(localLoading());
            if (loc != null) sv.setScreen(loc, false);
            FrameLayout box = new FrameLayout(ctx);
            box.addView(sv, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            d = new Dialog(ctx, android.R.style.Theme_Material_Light_Dialog_NoActionBar);
            d.setContentView(box);
            try {
                Window w = d.getWindow();
                w.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);   // 길동무와 같이 화면 전체
                w.setGravity(Gravity.BOTTOM);
                w.setBackgroundDrawable(new ColorDrawable(pal[0]));
                w.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
                w.setWindowAnimations(0);
                dv = w.getDecorView();
                dv.setAlpha(0f);
                dv.setTranslationY(56f * dpr);
                final Dialog mine = d;
                d.setOnDismissListener(new DialogInterface.OnDismissListener() {
                    @Override
                    public void onDismiss(DialogInterface x) {
                        alive = false;
                        if (sheet == mine) sheet = null;
                        if (br == BrSheet.this) br = null;
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
                br = null;
                alive = false;
                toast("노선 상세를 열지 못했어요");
                return;
            }
            // 기기에 둔 정류장 표를 뒤 스레드에서 읽어 오고(메인 스레드는 막지 않는다), 서버에 묻는다
            BR_EX.execute(new Runnable() {
                @Override
                public void run() {
                    final String[] c = readCache();
                    ui.post(new Runnable() {
                        @Override
                        public void run() {
                            if (!alive) return;
                            if (c != null) {
                                stnJson = c[0];
                                via = c[1];
                                cc = c[2];
                                pk = c[3];
                                pu = c[4];
                                cached = true;
                            }
                            busy = true;
                            busyAt = System.currentTimeMillis();
                            if (cached && !pk.isEmpty() && !pu.isEmpty() && pu.length() < 600) {      // 표를 기기에 둔 노선은 버스 위치도 서버 답을 기다리지 않고 바로(표를 그리는 통신과 동시에) 받는다
                                flight.add(pk);
                                fetchOne(pk, pu, false, true);
                            }
                            round(false);
                            arm();
                        }
                    });
                }
            });
        }

        /** 7일 안에 받아 둔 이 노선의 정류장 표: {표 JSON, via, 도시 코드}. 없으면 null. */
        String[] readCache() {
            try {
                String raw = ctx.getSharedPreferences("kids_busmap", Context.MODE_PRIVATE).getString("brc_" + rid, "");
                if (raw.isEmpty()) return null;
                JSONObject o = new JSONObject(raw);
                JSONArray st = o.optJSONArray("s");
                if (st == null || st.length() == 0 || System.currentTimeMillis() - o.optLong("t", 0L) > 7L * 24L * 3600000L) return null;
                return new String[] {st.toString(), o.optString("v", ""), o.optString("c", ""), o.optString("pk", ""), o.optString("pu", "")};
            } catch (Throwable t) {
                return null;
            }
        }

        /** 받은 정류장 표를 기기에 둔다(최근 8개 노선만). 한 시트에서 한 번만. */
        void putCache() {
            if (cached || cachePut || stnJson.isEmpty() || stnJson.length() > 120000 || rid.isEmpty() || rid.length() > 40) return;
            cachePut = true;
            final String sj = stnJson, v = via, c = cc, kk = pk, uu = pu;
            BR_EX.execute(new Runnable() {
                @Override
                public void run() {
                    try {
                        SharedPreferences sp = ctx.getSharedPreferences("kids_busmap", Context.MODE_PRIVATE);
                        JSONObject o = new JSONObject();
                        o.put("t", System.currentTimeMillis());
                        o.put("v", v);
                        o.put("c", c);
                        if (!kk.isEmpty() && !uu.isEmpty() && uu.length() < 600) {
                            o.put("pk", kk);
                            o.put("pu", uu);
                        }
                        o.put("s", new JSONArray(sj));
                        String idx = sp.getString("brc_idx", "");
                        ArrayList<String> ids = new ArrayList<String>();
                        if (!idx.isEmpty()) for (String x : idx.split(",")) if (!x.isEmpty() && !x.equals(rid)) ids.add(x);
                        ids.add(rid);
                        SharedPreferences.Editor ed = sp.edit();
                        while (ids.size() > 8) ed.remove("brc_" + ids.remove(0));
                        StringBuilder sb = new StringBuilder();
                        for (String x : ids) sb.append(sb.length() > 0 ? "," : "").append(x);
                        ed.putString("brc_" + rid, o.toString()).putString("brc_idx", sb.toString()).apply();
                    } catch (Throwable t) {
                        // 저장 실패는 이번 실행에서만 유지
                    }
                }
            });
        }

        /** 서버 답을 기다리는 동안 바로 보이는 화면(서버의 '불러오는 중' 화면과 같은 모양). */
        String localLoading() {
            try {
                JSONObject h = new JSONObject();
                h.put("t", "brh");
                h.put("no", no.isEmpty() ? "-" : no);
                h.put("tp", tp);
                h.put("c", "#7f8c8d");
                h.put("act", new JSONObject().put("a", "call").put("v", "br.rf"));
                h.put("bact", new JSONObject().put("a", "call").put("v", "br.x"));
                JSONObject t = new JSONObject();
                t.put("t", "text");
                t.put("s", "🚌 노선 정보 불러오는 중...");
                t.put("size", 13);
                t.put("color", "sub");
                t.put("align", "center");
                t.put("pad", new JSONArray().put(40).put(20).put(40).put(20));
                JSONObject o = new JSONObject();
                o.put("ok", true);
                o.put("v", 1);
                o.put("screen", "mapbr");
                o.put("cover", "tab");
                o.put("head", new JSONArray().put(h));
                o.put("body", new JSONArray().put(t));
                o.put("foot", new JSONArray());
                o.put("rev", "local-br");
                return o.toString();
            } catch (Exception e) {
                return "";
            }
        }

        void onAct(String v) {
            if ("br.x".equals(v)) {
                closeBrAnim();
            } else if ("br.rf".equals(v)) {                             // ↻ — 받아 둔 위치·표 본문을 비우고 다시(길동무와 같다: 정류장 표 목록은 둔다)
                res.clear();
                retryN = 0;
                busy = true;
                busyAt = System.currentTimeMillis();
                round(false);
            }
        }

        String body() {
            JSONObject o = new JSONObject();
            try {
                JSONObject f = new JSONObject();
                f.put("part", "br");
                f.put("th", theme);
                JSONObject b = new JSONObject();
                b.put("rid", rid);
                b.put("no", no);
                b.put("tp", tp);
                b.put("src", src);
                b.put("o", new JSONObject(oJson));
                if (!cc.isEmpty()) b.put("cc", cc);
                if (me != null) b.put("me", new JSONArray().put(me[0]).put(me[1]));
                if (!stnJson.isEmpty()) {
                    b.put("stn", new JSONArray(stnJson));
                    b.put("via", via);
                }
                b.put("sel", -1);
                b.put("np", 1);
                JSONObject rs = new JSONObject();
                for (Map.Entry<String, String> e : res.entrySet()) rs.put(e.getKey(), e.getValue());
                b.put("res", rs);
                f.put("br", b);
                o.put("cap", Wire.CAP);
                o.put("f", f);
            } catch (Exception e) {
                // 빈 요청이 가면 서버가 거절한다
            }
            return o.toString();
        }

        /** 서버 답에서 더 받을 주소(need)와 정류장 표(stn · via · cc)를 읽는다(뒤 스레드). */
        void parseBr(String r, ArrayList<String[]> nn, String[] meta) {
            try {
                JSONObject im = new JSONObject(r).optJSONObject("info");
                JSONObject ib = im == null ? null : im.optJSONObject("br");
                if (ib == null) return;
                JSONArray nd = ib.optJSONArray("need");
                for (int i = 0; nd != null && i < nd.length() && nn.size() < 4; i++) {
                    JSONObject x = nd.optJSONObject(i);
                    if (x == null) continue;
                    String k = x.optString("k", "");
                    String u = x.optString("url", "");
                    if (k.matches("[a-z]{2}") && u.length() > 0 && u.length() < 600) {
                        nn.add(new String[] {k, u});
                        if (k.endsWith("p") && pk.isEmpty()) {
                            pk = k;
                            pu = u;
                        }
                    }
                }
                JSONArray st = ib.optJSONArray("stn");
                if (st != null && st.length() > 0) {
                    meta[0] = st.toString();
                    meta[1] = ib.optString("via", "");
                    meta[2] = ib.optString("cc", "");
                }
            } catch (Exception e) {
                nn.clear();
            }
        }

        /**
         * 미리 받기(뒤 스레드, 길동무 brPrefetch 와 같다): 이 노선의 정류장 표를 서버·공공 API 에서 받아 기기에 7일 둔다.
         * 버스 위치는 금방 낡으므로 받지 않는다 — 열 때 표와 함께 바로 받는다. 이미 둔 것이 있으면 건너뛴다.
         */
        void prefetch() {
            if (readCache() != null) return;
            for (int round = 0; round < 3 && stnJson.isEmpty(); round++) {
                String r = Wire.post("/screen/map", body(), 8000);
                if (r == null) return;
                ArrayList<String[]> nn = new ArrayList<String[]>();
                String[] meta = new String[] {"", "", ""};
                parseBr(r, nn, meta);
                if (!meta[0].isEmpty()) {
                    stnJson = meta[0];
                    via = meta[1];
                    cc = meta[2];
                    break;
                }
                boolean any = false;
                for (String[] nd : nn) {
                    if (!nd[0].endsWith("s")) continue;                // 표만(위치는 열 때 새로 받는다)
                    res.put(nd[0], busRace(nd[1], 9000, false, 0));
                    any = true;
                }
                if (!any) return;
            }
            if (!stnJson.isEmpty()) putCache();
        }

        /** 서버에 지금 상태를 보내 화면을 받는다. 더 받아야 할 주소는 각각 따로 받아, 오는 대로 바로 다시 그린다. */
        void round(final boolean pl) {
            final int my = ++req;
            final String b = body();
            BR_EX.execute(new Runnable() {
                @Override
                public void run() {
                    final String r = Wire.post("/screen/map", b, 8000);
                    final ScreenCore.Screen sc = r == null ? null : SvHost.parse(noPick(SvHost.strip(r)));
                    final ArrayList<String[]> nn = new ArrayList<String[]>();
                    final String[] meta = new String[] {"", "", ""};     // 정류장 표(JSON) · via · 도시 코드
                    if (sc != null) parseBr(r, nn, meta);
                    ui.post(new Runnable() {
                        @Override
                        public void run() {
                            if (!alive) return;
                            if (sc == null) {
                                if (my == req && flight.isEmpty()) busy = false;
                                if (!shown) {                              // 처음 한 번 못 받았다고 빈 시트로 두지 않는다 — 0.4 · 1.2 · 2.5초 뒤 조용히 다시(세 번까지), 그래도 안 되면 알린다
                                    if (retryN < 3) {
                                        long wait = retryN == 0 ? 400L : retryN == 1 ? 1200L : 2500L;
                                        retryN++;
                                        ui.postDelayed(new Runnable() {
                                            @Override
                                            public void run() {
                                                if (alive && !shown) {
                                                    busy = true;
                                                    busyAt = System.currentTimeMillis();
                                                    round(false);
                                                }
                                            }
                                        }, wait);
                                    } else {
                                        toast("노선 정보를 받지 못했어요. 위쪽 새로고침(↻)을 눌러 주세요");
                                    }
                                }
                                return;
                            }
                            retryN = 0;                                    // 갱신이 실패하면 보던 화면을 그대로 둔다
                            if (my != req) return;                         // 더 새 요청이 이미 나갔다 — 그 답이 이 내용까지 담는다
                            if (!meta[0].isEmpty() && stnJson.isEmpty()) {
                                stnJson = meta[0];
                                via = meta[1];
                                cc = meta[2];
                                res.remove("gs");
                                res.remove("ts");
                            }
                            if (!(pl && !nn.isEmpty())) {                  // 위치를 새로 받는 중이면 옛 위치가 그려진 화면 위에 중간 화면을 덮지 않는다
                                if (!r.equals(lastJs)) {
                                    lastJs = r;
                                    sv.setScreen(sc, shown);
                                }
                                shown = true;
                            }
                            for (String[] nd : nn) if (flight.add(nd[0])) fetchOne(nd[0], nd[1], pl, false);
                            if (nn.isEmpty() && flight.isEmpty()) {
                                busy = false;
                                putCache();
                            }
                        }
                    });
                }
            });
        }

        /** 주소 하나를 따로 받는다. 위치는 실패하면 0.8초 뒤 다시(최대 5번), 표는 한 번 더. 받자마자 다시 묻는다. */
        void fetchOne(final String k, final String url, final boolean pl, final boolean early) {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    boolean pos = k.endsWith("p");
                    String body = "";
                    for (int a = 0; a < (pos ? (early ? 2 : 5) : 2) && body.isEmpty(); a++) {
                        if (a > 0) {
                            try {
                                Thread.sleep(pos ? 800L : 300L);
                            } catch (InterruptedException e) {
                                break;
                            }
                        }
                        if (!alive) return;
                        body = busRace(url, pos ? 6000 : 9000, pos, a);
                    }
                    final String got = body.length() > 200000 ? body.substring(0, 200000) : body;
                    ui.post(new Runnable() {
                        @Override
                        public void run() {
                            flight.remove(k);
                            if (!alive) return;
                            if (early && got.isEmpty()) {                  // 기기에 둔 주소로 못 받았다 — 둔 주소를 버리고 서버가 주는 주소로 처음부터
                                pk = "";
                                pu = "";
                                round(false);
                                return;
                            }
                            if (pl && got.isEmpty()) {                     // 8초 갱신이 비면 버린다 — 보던 위치를 그대로
                                if (flight.isEmpty()) busy = false;
                                return;
                            }
                            res.put(k, got);
                            round(pl);
                        }
                    });
                }
            }, "kids-brf").start();
        }

        final Runnable tick = new Runnable() {
            @Override
            public void run() {
                ticking = false;
                if (!alive || br != BrSheet.this || d == null || !d.isShowing()) return;
                if (busy && System.currentTimeMillis() - busyAt > 20000L) busy = false;
                if (!busy && shown && !stnJson.isEmpty() && MapPane.this.isShown()) {
                    busy = true;
                    busyAt = System.currentTimeMillis();
                    res.remove("gp");
                    res.remove("tp");
                    round(true);
                }
                arm();
            }
        };

        /** 8초마다 버스 위치만 새로 받는다(길동무 BR_POLL_MS). */
        void arm() {
            if (ticking || !alive) return;
            ticking = true;
            ui.postDelayed(tick, 8000L);
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
        BrSheet bs = br;
        br = null;
        if (bs != null) bs.alive = false;
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
