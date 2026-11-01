package com.dullyyj.kids;

import android.content.Context;

import com.dullyyj.subway.SceneHello;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Calendar;

/**
 * 홈 장면을 3초 꾹 누르면 친구들이 모여 인사하는 대본(길동무와 같은 그림 · 같은 움직임).
 * 시간 · 자리 · 차례는 길동무와 같은 assets/open.json 의 hello 를 그대로 쓰고, 인사 글만 엔진(Engine.helloSay)의 아이 눈높이 말로 바꾼다.
 */
final class KidHello {
    private KidHello() {
    }

    private static SceneHello.Plan base;
    private static String[] ids = new String[0];
    private static String[] slotId = new String[0];
    private static double[] slotH0 = new double[0], slotH1 = new double[0];
    private static boolean[] slotRest = new boolean[0];
    private static boolean loaded = false;

    private static synchronized void load(Context c) {
        if (loaded) return;
        loaded = true;
        try {
            InputStream in = c.getAssets().open("open.json");
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            try {
                byte[] buf = new byte[4096];
                int n;
                while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            } finally {
                in.close();
            }
            JSONObject m = new JSONObject(bo.toString("UTF-8"));
            JSONArray ch = m.getJSONArray("chars");
            ids = new String[ch.length()];
            for (int i = 0; i < ids.length; i++) ids[i] = ch.getString(i);
            JSONObject h = m.getJSONObject("hello");
            JSONObject t = h.getJSONObject("t");
            JSONArray seats = h.getJSONArray("seats");
            JSONArray order = h.getJSONArray("order");
            SceneHello.Plan p = new SceneHello.Plan();
            p.expand = t.optInt("expand", p.expand);
            p.greet = t.optInt("greet", p.greet);
            p.step = t.optInt("step", p.step);
            p.bubble = t.optInt("bubble", p.bubble);
            p.leave = t.optInt("leave", p.leave);
            p.collapse = t.optInt("collapse", p.collapse);
            p.end = t.optInt("end", p.end);
            p.boost = t.optDouble("boost", p.boost);
            int k = seats.length();
            p.sx = new double[k];
            p.sz = new double[k];
            p.order = new int[k];
            for (int i = 0; i < k; i++) {
                JSONObject q = seats.getJSONObject(i);
                p.sx[i] = q.optDouble("x", 0.5);
                p.sz[i] = q.optDouble("z", 0.5);
                p.order[i] = i < order.length() ? order.getInt(i) : i;
            }
            p.chars = ids;
            JSONArray sl = m.getJSONArray("slots");
            int n = sl.length();
            slotId = new String[n];
            slotH0 = new double[n];
            slotH1 = new double[n];
            slotRest = new boolean[n];
            for (int i = 0; i < n; i++) {
                JSONObject s = sl.getJSONObject(i);
                slotId[i] = s.optString("id");
                slotH0[i] = s.optDouble("h0", 0);
                slotH1[i] = s.optDouble("h1", 24);
                JSONObject sh = s.optJSONObject("hello");
                slotRest[i] = sh != null && sh.optBoolean("rest", false);
            }
            base = p;
        } catch (Throwable e) {
            base = null;
        }
    }

    /** 지금 시각 칸에 맞는 인사 대본. 대본이 없거나 모양이 안 맞으면 null(아무것도 안 한다). */
    static SceneHello.Plan plan(Context c) {
        try {
            load(c);
            if (base == null || slotId.length == 0) return null;
            Calendar cal = Calendar.getInstance();
            double hr = cal.get(Calendar.HOUR_OF_DAY) + cal.get(Calendar.MINUTE) / 60.0;
            int at = 0;
            for (int i = 0; i < slotId.length; i++) {
                boolean in = slotH0[i] < slotH1[i] ? (hr >= slotH0[i] && hr < slotH1[i]) : (hr >= slotH0[i] || hr < slotH1[i]);
                if (in) {
                    at = i;
                    break;
                }
            }
            java.util.Map<String, String> say = Engine.helloSay(slotId[at]);
            if (say == null) return null;
            SceneHello.Plan p = new SceneHello.Plan();
            p.expand = base.expand;
            p.greet = base.greet;
            p.step = base.step;
            p.bubble = base.bubble;
            p.leave = base.leave;
            p.collapse = base.collapse;
            p.end = base.end;
            p.boost = base.boost;
            p.sx = base.sx;
            p.sz = base.sz;
            p.order = base.order;
            p.chars = base.chars;
            p.say = say;
            p.rest = slotRest[at];
            p.slot = slotId[at];
            return SceneHello.ok(p) ? p : null;
        } catch (Throwable t) {
            return null;
        }
    }
}
