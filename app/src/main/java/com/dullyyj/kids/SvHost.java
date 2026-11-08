package com.dullyyj.kids;

import android.content.Context;

import com.dullyyj.subway.ScreenCore;
import com.dullyyj.subway.ScreenView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Iterator;

/**
 * 길동무와 같은 화면 그리개(ScreenView)를 쓰는 곳의 공통 도우미.
 * 화면 글(JSON)을 읽는 일은 뒤 스레드에서 하고(parse), 메인 스레드는 읽어 둔 화면을 그리개에 꽂기만 한다.
 */
final class SvHost {
    interface Cb {
        void act(String kind, String v);
    }

    interface Size {
        void h(float dp);
    }

    private SvHost() {
    }

    /** 길동무와 같은 열네 가지 색(ScreenView 의 색 역할 순서). */
    static int[] palette(String theme) {
        if ("dark".equals(theme)) {
            return new int[] {0xFF121214, 0xFF1C1C1E, 0xFF2C2C2E, 0xFFF2F2F7, 0xFF8E8E93, 0xFFD4AF37, 0xFFFF9F0A, 0xFF252528, 0xFFFFFFFF, 0xFF3A3A3C, 0xFF2C2C2E, 0xFF1C1C1E, 0xFFB8922F, 0xFF121214};
        }
        return new int[] {0xFFF0F4F8, 0xFFFFFFFF, 0xFFDCE8F0, 0xFF1A2533, 0xFF6B8299, 0xFF1D9BF0, 0xFFF07830, 0xFFE8F4FF, 0xFFFFFFFF, 0xFFC8DCEA, 0xFFE8F0F8, 0xFFFFFFFF, 0xFF0E7DD6, 0xFFFFFFFF};
    }

    static ScreenView make(Context c, final Cb cb) {
        return make(c, cb, null);
    }

    static ScreenView make(Context c, final Cb cb, final Size size) {
        ScreenView sv = new ScreenView(c);
        sv.setDpr(c.getResources().getDisplayMetrics().density);
        sv.setListener(new ScreenView.Listener() {
            @Override
            public void onAction(ScreenCore.Act a) {
                if (a != null && cb != null) cb.act(a.a, a.v);
            }

            @Override
            public void onSet(ScreenCore.Act a, boolean on) {
            }

            @Override
            public void onSearch(ScreenCore.Act a, String q) {
                if (a != null && cb != null) cb.act(a.a, a.v);
            }

            @Override
            public void onInputFocus(boolean on) {
            }

            @Override
            public void onFirstDraw() {
            }

            @Override
            public void onText(String key, String value, String kind) {
            }

            @Override
            public void onContentH(float dp) {
                if (size != null) size.h(dp);
            }
        });
        return sv;
    }

    /** 화면 글을 읽는다. 읽지 못하면 null. */
    static ScreenCore.Screen parse(String json) {
        if (json == null || json.isEmpty()) return null;
        try {
            return ScreenCore.load(json);
        } catch (Throwable t) {
            return null;
        }
    }

    /**
     * 길동무 서버가 준 화면에서 패밀리 앱에 없는 단추(출발·도착·시간표)와 지도 종류·지역 칩을 뺀다.
     * 단추만 빼는 게 아니라, 그 때문에 비어 버린 줄(row·chips 등)도 함께 뺀다. 못 읽으면 받은 글 그대로.
     */
    static String strip(String json) {
        try {
            JSONObject root = new JSONObject(json);
            clean(root);
            return root.toString();
        } catch (Throwable t) {
            return json;
        }
    }

    private static boolean drop(JSONObject o) {
        String a = o.optString("a", "");
        String v = o.optString("v", "");
        JSONObject act = o.optJSONObject("act");
        if (act != null) {
            a = act.optString("a", a);
            v = act.optString("v", v);
        }
        if (v.isEmpty()) return false;
        if (v.equals("mp.start") || v.equals("mp.dest") || v.equals("mp.tt")) return true;
        return "cat".equals(a) && v.startsWith("r:");
    }

    private static boolean container(String key) {
        return key.equals("kids") || key.equals("items") || key.equals("btns") || key.equals("chips") || key.equals("cells");
    }

    /** true 면 이 노드는 부모에서 빼야 한다. */
    private static boolean clean(JSONObject o) throws Exception {
        if (drop(o)) return true;
        ArrayList<String> keys = new ArrayList<String>();
        Iterator<String> it = o.keys();
        while (it.hasNext()) keys.add(it.next());
        for (int i = 0; i < keys.size(); i++) {
            String k = keys.get(i);
            Object v = o.opt(k);
            if (v instanceof JSONObject) {
                clean((JSONObject) v);
            } else if (v instanceof JSONArray) {
                JSONArray arr = (JSONArray) v;
                int before = arr.length();
                JSONArray out = new JSONArray();
                for (int j = 0; j < before; j++) {
                    Object x = arr.opt(j);
                    if (x instanceof JSONObject && clean((JSONObject) x)) continue;
                    out.put(x);
                }
                if (out.length() != before) {
                    if (out.length() == 0 && container(k)) return true;
                    o.put(k, out);
                }
            }
        }
        return false;
    }
}
