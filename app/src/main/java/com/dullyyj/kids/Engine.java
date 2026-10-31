package com.dullyyj.kids;

import org.json.JSONArray;
import org.json.JSONObject;

import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.Locale;
import java.util.Random;
import java.util.UUID;

/**
 * 길동무 키즈 엔진 — 판단·계산은 전부 여기서 하고, 화면은 JSON 으로 내려 준다(앱은 그리기만 한다).
 * 지금은 기기 안에서 도는 임시 엔진이며, 서버(워커 gildongmu-kids-api)가 생기면 같은 JSON 을 서버가 내려준다.
 * 모든 공개 메서드는 synchronized — 엔진 스레드(1초 틱)와 위치 스레드(lastFix)가 함께 부른다.
 */
final class Engine {
    // ── 조절값(시험하기 쉽게 짧다. 정식 출시 때 서버 설정으로 옮긴다) ──
    static final long HUNGER_STEP_MS = 12000L;          // 배고픔 1점이 오르는 시간
    static final long OFFLINE_CAP_MS = 20L * 60L * 1000L; // 앱을 닫아 둔 시간은 최대 이만큼만 센다
    static final int BEG_AT = 70;                       // 이 이상이면 밥 달라고 조른다
    static final long SULK_MS = 90000L;                 // 삐지는 시간
    static final long POOP_NEG_MS = 180000L;            // 응가 3개를 이만큼 두면 방치로 센다
    static final long NEG_DECAY_MS = 20L * 60L * 1000L; // 방치 횟수가 1씩 줄어드는 시간
    static final long EVT_MIN = 20000L, EVT_MAX = 70000L; // 랜덤 행동 간격
    static final long CHAT_KEEP_MS = 7L * 24L * 3600L * 1000L; // 가족 대화 보관(최대 7일)
    static final long LOC_INTERVAL_MS = 300000L;        // 위치 보내는 주기(5분)
    static final long PAIR_TTL_MS = 10L * 60L * 1000L;  // 연결 비밀키 유효 시간
    static final int CHAT_MAX_LEN = 500;

    static final String[] MOODS = {"idle", "beg", "eat", "sulk", "sick", "poop", "play", "sleep"};
    // 동작 시트(_act) 칸 번호 — 종류별. -1 이면 그 동작 칸이 없어 걷기 시트로 대신한다.
    static final int[][] CELLS = {
        {-1, 1, 13, 6, 6, 0, 15, 5},   // 0 강아지·고양이
        {-1, 1, 0, 13, 15, 0, 12, 14}, // 1 두더지
        {-1, 11, 8, 14, 14, 6, 15, 1}, // 2 독수리
        {-1, 8, 4, 9, 15, 0, 13, 5},   // 3 올챙이
        {-1, -1, -1, -1, -1, -1, -1, -1} // 4 그 밖(걷기 시트만)
    };
    // id, 이름, 종류
    static final String[][] CAST = {
        {"ppopu", "뽀푸", "0"}, {"dolsom", "돌솜", "0"}, {"lovel", "러블", "0"}, {"chaeng", "챙챙", "3"},
        {"sul", "술", "2"}, {"dudung", "두덩", "1"}, {"bbosong", "뽀송", "4"}, {"juksun", "죽순", "4"}
    };
    private static final String[] BUBBLE = {"", "밥 주세요!", "냠냠!", "흥!", "아파요…", "응가!", "신나요!", "zZ"};
    private static final String KEYS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

    static final class F {
        String id, name;
        int kind;
        double hunger;
        int poop;
        long poopSince;
        int neg;
        long negT;
        boolean sick, starved, poopNeg;
        long sulkUntil;
        String tm = "";
        long tmUntil;
        long nextEvt;
    }

    private final Store store;
    private final Random rnd = new Random();
    private final SecureRandom srnd = new SecureRandom();
    private final ArrayList<F> fs = new ArrayList<F>();
    private JSONArray chat = new JSONArray();
    private String sel = "ppopu";
    private String tab = "home";
    private int rev = 0;
    private long lastNow = 0L, lastTickT = 0L, lastSave = 0L, lastPrune = 0L;
    private boolean dirty = false;
    private String lastSig = "";
    private boolean loc = false;
    private long lastFixT = 0L;
    private String pairCode = "";
    private long pairExp = 0L;
    private final String cid, csec;
    private String sceneJson = "";
    private long sceneAskT = 0L, sceneGotT = 0L;
    private double lat = Double.NaN, lng = Double.NaN;

    Engine(Store s) {
        store = s;
        String a = s.get("cid", "");
        if (a == null || a.isEmpty()) {
            a = UUID.randomUUID().toString();
            s.put("cid", a);
        }
        cid = a;
        String b = s.get("csec", "");
        if (b == null || b.isEmpty()) {
            byte[] r = new byte[16];
            srnd.nextBytes(r);
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < r.length; i++) sb.append(String.format(Locale.US, "%02x", r[i] & 0xff));
            b = sb.toString();
            s.put("csec", b);
        }
        csec = b;
        load();
    }

    // ───────── 저장·불러오기 ─────────
    private void load() {
        JSONObject o = new JSONObject();
        try {
            o = new JSONObject(store.get("state", "{}"));
        } catch (Exception e) {
            o = new JSONObject();
        }
        sel = o.optString("sel", CAST[0][0]);
        loc = o.optInt("loc", 0) == 1;
        lastFixT = o.optLong("lf", 0L);
        lastTickT = o.optLong("lt", 0L);
        pairCode = o.optString("pc", "");
        pairExp = o.optLong("pe", 0L);
        JSONArray a = o.optJSONArray("fr");
        for (int i = 0; i < CAST.length; i++) {
            F f = new F();
            f.id = CAST[i][0];
            f.name = CAST[i][1];
            f.kind = Integer.parseInt(CAST[i][2]);
            JSONObject s = null;
            if (a != null) {
                for (int j = 0; j < a.length(); j++) {
                    JSONObject x = a.optJSONObject(j);
                    if (x != null && f.id.equals(x.optString("i"))) s = x;
                }
            }
            if (s != null) {
                f.hunger = s.optDouble("h", 40);
                f.poop = s.optInt("p", 0);
                f.poopSince = s.optLong("ps", 0L);
                f.neg = s.optInt("n", 0);
                f.negT = s.optLong("nt", 0L);
                f.sick = s.optInt("sk", 0) == 1;
                f.starved = s.optInt("st", 0) == 1;
                f.poopNeg = s.optInt("pn", 0) == 1;
                f.sulkUntil = s.optLong("su", 0L);
            } else {
                f.hunger = 35 + rnd.nextInt(30);
            }
            fs.add(f);
        }
        try {
            chat = new JSONArray(store.get("chat", "[]"));
        } catch (Exception e) {
            chat = new JSONArray();
        }
    }

    private void save() {
        try {
            JSONObject o = new JSONObject();
            o.put("sel", sel);
            o.put("loc", loc ? 1 : 0);
            o.put("lf", lastFixT);
            o.put("lt", lastTickT);
            o.put("pc", pairCode);
            o.put("pe", pairExp);
            JSONArray a = new JSONArray();
            for (F f : fs) {
                JSONObject x = new JSONObject();
                x.put("i", f.id);
                x.put("h", f.hunger);
                x.put("p", f.poop);
                x.put("ps", f.poopSince);
                x.put("n", f.neg);
                x.put("nt", f.negT);
                x.put("sk", f.sick ? 1 : 0);
                x.put("st", f.starved ? 1 : 0);
                x.put("pn", f.poopNeg ? 1 : 0);
                x.put("su", f.sulkUntil);
                a.put(x);
            }
            o.put("fr", a);
            store.put("state", o.toString());
            store.put("chat", chat.toString());
        } catch (Exception e) {
            // 다음 기회에 다시 저장
        }
        dirty = false;
        lastSave = System.currentTimeMillis();
    }

    // ───────── 앱이 묻는 것들 ─────────
    synchronized String theme() {
        return store.get("theme", "pastel");
    }

    synchronized boolean consented() {
        return "1".equals(store.get("consent", "0"));
    }

    synchronized String tab() {
        return tab;
    }

    synchronized int rev() {
        return rev;
    }

    synchronized long locIntervalMs() {
        return LOC_INTERVAL_MS;
    }

    synchronized boolean locOn() {
        return loc && consented();
    }

    synchronized void setLoc(boolean on) {
        loc = on;
        dirty = true;
    }

    synchronized void lastFix(double la, double lo, float acc, long t) {
        lastFixT = t;
        lat = la;
        lng = lo;
        dirty = true;
    }

    synchronized String childId() {
        return cid;
    }

    synchronized String childSecret() {
        return csec;
    }

    // ───────── 시계 한 틱 ─────────
    synchronized void tick(long now) {
        lastNow = now;
        long dt = lastTickT == 0L ? 0L : now - lastTickT;
        if (dt < 0L) dt = 0L;
        if (dt > OFFLINE_CAP_MS) dt = OFFLINE_CAP_MS;
        lastTickT = now;
        for (int i = 0; i < fs.size(); i++) step(fs.get(i), now, dt);
        if (now - lastPrune > 60000L) {
            lastPrune = now;
            pruneChat(now);
        }
        if (pairExp != 0L && now > pairExp) {
            pairCode = "";
            pairExp = 0L;
        }
        String sg = sig();
        if (!sg.equals(lastSig)) {
            lastSig = sg;
            rev++;
        }
        dirty = true;
        if (now - lastSave > 5000L) save();
    }

    private void step(F f, long now, long dt) {
        if (!f.sick && f.hunger < 100) f.hunger = Math.min(100.0, f.hunger + dt / (double) HUNGER_STEP_MS);
        if (f.hunger >= 100 && !f.starved) {
            f.starved = true;
            neglect(f, now);
        }
        if (f.poop >= 3 && !f.poopNeg && f.poopSince > 0 && now - f.poopSince > POOP_NEG_MS) {
            f.poopNeg = true;
            neglect(f, now);
        }
        if (f.neg > 0 && !f.sick && f.negT > 0 && now - f.negT > NEG_DECAY_MS) {
            f.neg--;
            f.negT = now;
        }
        if (f.tmUntil != 0L && now >= f.tmUntil) {
            f.tm = "";
            f.tmUntil = 0L;
        }
        if (f.nextEvt == 0L) f.nextEvt = now + EVT_MIN + rnd.nextInt((int) (EVT_MAX - EVT_MIN));
        if (now >= f.nextEvt) {
            f.nextEvt = now + EVT_MIN + rnd.nextInt((int) (EVT_MAX - EVT_MIN));
            if (!f.sick && f.sulkUntil <= now && f.tm.isEmpty()) event(f, now);
        }
    }

    /** 돌봄을 놓친 횟수를 센다 — 1·2번째는 삐지고, 3번째부터는 아프다(죽지는 않는다). */
    private void neglect(F f, long now) {
        f.neg++;
        f.negT = now;
        if (f.neg >= 3) {
            f.sick = true;
            f.sulkUntil = 0L;
        } else {
            f.sulkUntil = now + SULK_MS;
        }
    }

    private void event(F f, long now) {
        int r = rnd.nextInt(100);
        if (r < 35) {
            if (f.poop < 3) {
                if (f.poop == 0) f.poopSince = now;
                f.poop++;
            }
            setTm(f, "poop", now + 4000L);
        } else if (r < 65) {
            setTm(f, "play", now + 6000L);
        } else if (r < 85) {
            setTm(f, "sleep", now + 10000L);
        }
    }

    private void setTm(F f, String m, long until) {
        f.tm = m;
        f.tmUntil = until;
    }

    private int moodOf(F f, long now) {
        if (f.sick) return 4;
        if (f.sulkUntil > now) return 3;
        if (!f.tm.isEmpty()) {
            for (int i = 0; i < MOODS.length; i++) if (MOODS[i].equals(f.tm)) return i;
        }
        if (f.hunger >= BEG_AT) return 1;
        return 0;
    }

    private F find(String id) {
        for (int i = 0; i < fs.size(); i++) if (fs.get(i).id.equals(id)) return fs.get(i);
        return fs.get(0);
    }

    private String sig() {
        StringBuilder sb = new StringBuilder();
        sb.append(tab).append('|').append(theme()).append('|').append(consented() ? 1 : 0)
                .append(store.get("cp", "0")).append(store.get("cc", "0")).append(loc ? 1 : 0)
                .append('|').append(sel).append('|').append(pairCode).append('|').append(chat.length());
        if ("settings".equals(tab)) sb.append('|').append(lastFixT / 60000L);
        if ("home".equals(tab)) sb.append('|').append(sceneGotT / 1000L).append(Double.isNaN(lat) ? 'n' : 'y');
        for (int i = 0; i < fs.size(); i++) {
            F f = fs.get(i);
            sb.append('|').append(moodOf(f, lastNow)).append(',').append((int) (f.hunger / 5)).append(',')
                    .append(f.poop).append(',').append(f.neg);
        }
        return sb.toString();
    }

    // ───────── 마을(그림) ─────────
    synchronized String village() {
        try {
            JSONObject o = new JSONObject();
            o.put("sel", sel);
            JSONArray a = new JSONArray();
            for (int i = 0; i < fs.size(); i++) {
                F f = fs.get(i);
                int m = moodOf(f, lastNow);
                int cell = CELLS[f.kind][m];
                String mode;
                if (m == 0) mode = "walk";
                else if (cell >= 0) mode = "cell";
                else if (m == 3 || m == 4 || m == 7) mode = "still";
                else mode = "walk";
                JSONObject x = new JSONObject();
                x.put("id", f.id);
                x.put("name", f.name);
                x.put("mode", mode);
                x.put("cell", cell);
                x.put("bubble", BUBBLE[m]);
                x.put("poop", f.poop);
                a.put(x);
            }
            o.put("friends", a);
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    // ───────── 말 만들기 ─────────
    static boolean batchim(String s) {
        if (s == null || s.isEmpty()) return false;
        char c = s.charAt(s.length() - 1);
        if (c < 0xAC00 || c > 0xD7A3) return false;
        return (c - 0xAC00) % 28 != 0;
    }

    static String ga(String n) {
        return n + (batchim(n) ? "이" : "가");
    }

    private int need(F f, long now) { // 0 아픔 · 1 삐짐 · 2 배고픔 · 3 응가 · 4 괜찮음
        if (f.sick) return 0;
        if (f.sulkUntil > now) return 1;
        if (f.hunger >= BEG_AT) return 2;
        if (f.poop > 0) return 3;
        return 4;
    }

    private String line(F f, long now) {
        switch (need(f, now)) {
            case 0:
                return ga(f.name) + " 아파요… 밥을 주고 응가를 치워 주면 나아져요";
            case 1:
                return ga(f.name) + " 삐졌어요. 쓰다듬어 주세요";
            case 2:
                return ga(f.name) + " 배고파요 밥을 주세요";
            case 3:
                return ga(f.name) + " 응가했어요 치워 주세요";
            default:
                return ga(f.name) + " 잘 지내요";
        }
    }

    // ───────── 화면 JSON ─────────
    private static void put(JSONObject o, String k, Object v) {
        try {
            o.put(k, v);
        } catch (Exception e) {
            // 무시
        }
    }

    private static JSONObject b(String t, String... kv) {
        JSONObject o = new JSONObject();
        put(o, "t", t);
        for (int i = 0; i + 1 < kv.length; i += 2) put(o, kv[i], kv[i + 1]);
        return o;
    }

    private static JSONObject item(String label, String act, String on) {
        return b("i", "label", label, "act", act, "on", on);
    }

    private String wrap(String mode, JSONArray blocks) {
        JSONObject o = new JSONObject();
        put(o, "mode", mode);
        put(o, "blocks", blocks);
        return o.toString();
    }

    synchronized String tabbar(String t) {
        JSONObject o = new JSONObject();
        JSONArray a = new JSONArray();
        if (consented()) {
            String[][] T = {
                {"chat", "가족대화", "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"},
                {"map", "노선도", "M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"},
                {"home", "홈", "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"},
                {"friends", "길동무", "M2 9.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0zM6.5 5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0zM12.5 5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0zM17 9.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0zM12 12c-3 0-6 3-6 6.5S8 22 12 22s6-0.5 6-3.5S15 12 12 12z"},
                {"settings", "설정", "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"}
            };
            for (int i = 0; i < T.length; i++) {
                JSONObject x = new JSONObject();
                put(x, "id", T[i][0]);
                put(x, "label", T[i][1]);
                put(x, "icon", T[i][2]);
                put(x, "on", T[i][0].equals(t) ? 1 : 0);
                a.put(x);
            }
        }
        put(o, "tabs", a);
        return o.toString();
    }

    synchronized String screen(String t) {
        try {
            if (!consented()) return consentScreen();
            if ("chat".equals(t)) return chatScreen();
            if ("map".equals(t)) return wrap("map", new JSONArray());
            if ("friends".equals(t)) return friendsScreen();
            if ("settings".equals(t)) return settingsScreen();
            return homeScreen();
        } catch (Exception e) {
            return wrap("scroll", new JSONArray());
        }
    }

    private String consentScreen() {
        JSONArray a = new JSONArray();
        a.put(b("head", "text", "시작하기 전에 읽어 주세요"));
        a.put(b("text", "text", "길동무 키즈는 부모님께 내 위치를 알려 주는 앱이에요. 길동무 친구들과 놀면서 지내요."));
        a.put(b("card", "title", "알리는 것", "text", "내 휴대폰의 위치(약 5분마다)와 알린 시각이에요.", "thumb", "", "act", ""));
        a.put(b("card", "title", "누가 보나요", "text", "내가 QR이나 비밀키로 연결한 부모님만 볼 수 있어요.", "thumb", "", "act", ""));
        a.put(b("card", "title", "언제든 끌 수 있어요", "text", "설정에서 위치 공유를 끄거나 동의를 거둘 수 있어요.", "thumb", "", "act", ""));
        a.put(b("card", "title", "보관", "text", "위치 기록은 법에서 정한 기간 동안만 보관하고, 그 뒤에는 지워요.", "thumb", "", "act", ""));
        a.put(b("gap", "h", "8"));
        a.put(b("switch", "label", "보호자(부모님)가 위 내용을 확인하고 동의했어요", "on", store.get("cp", "0"), "act", "consent.parent"));
        a.put(b("switch", "label", "나도 위 내용을 이해했고 동의해요", "on", store.get("cc", "0"), "act", "consent.child"));
        boolean ok = "1".equals(store.get("cp", "0")) && "1".equals(store.get("cc", "0"));
        JSONArray it = new JSONArray();
        it.put(b("i", "label", "시작하기", "act", "consent.ok", "on", ok ? "1" : "0", "off", ok ? "0" : "1"));
        JSONObject bt = b("btns");
        put(bt, "items", it);
        a.put(bt);
        return wrap("scroll", a);
    }

    private String homeScreen() {
        long now = lastNow;
        JSONArray body = new JSONArray();
        if (!sceneJson.isEmpty()) {
            body.put(nd("scene", "h", 300, "fit", true, "fmin", 240, "fmax", 640, "frh", 26, "r", 16,
                    "pad", pad(12, 6, 12, 6), "sc", sceneJson));
        } else {
            JSONArray ph = new JSONArray();
            ph.put(tx("해변을 불러오는 중이에요…", 14, true, "sub", 0));
            body.put(nd("panel", "pad", pad(12, 6, 12, 6), "ip", pad(14, 40, 14, 40), "kids", ph));
        }
        body.put(nd("lth", "s", "길동무 브리핑", "dot", "#34c759", "live", true, "pad", pad(16, 10, 16, 4)));
        JSONArray kids = new JSONArray();
        String[] wl = weatherLines();
        kids.put(tx(wl[0], 13, true, "text", 2));
        if (wl[1].length() > 0) kids.put(tx(wl[1], 12, false, "sub", 8));
        ArrayList<F> list = new ArrayList<F>(fs);
        final long n = now;
        Collections.sort(list, new Comparator<F>() {
            @Override
            public int compare(F x, F y) {
                return need(x, n) - need(y, n);
            }
        });
        int needy = 0;
        for (int i = 0; i < list.size(); i++) if (need(list.get(i), now) < 4) needy++;
        kids.put(tx(needy == 0 ? "길동무 친구들이 모두 잘 지내요 😊" : "도와줘야 하는 친구가 " + needy + "명 있어요", 13, true, "text", 4));
        String[] em = {"🤒 ", "😤 ", "🍚 ", "💩 "};
        int shown = 0;
        for (int i = 0; i < list.size() && shown < 4; i++) {
            F f = list.get(i);
            int nz = need(f, now);
            if (nz >= 4) break;
            kids.put(tx(em[nz] + line(f, now), 13, false, "text", 3, f.name));
            shown++;
        }
        if (needy > shown) kids.put(tx("그리고 " + (needy - shown) + "명이 더 기다려요", 12, false, "sub", 2));
        body.put(nd("panel", "pad", pad(12, 0, 12, 6), "ip", pad(14, 12, 14, 12), "kids", kids));
        body.put(nd("button", "s", "친구들 보러 가기", "act", callAct("tab.friends"), "h", 42, "size", 13, "bold", true,
                "fill", "gold", "tc", "ongold", "r", 14, "pad", pad(12, 2, 12, 14)));
        JSONObject o = new JSONObject();
        put(o, "ok", true);
        put(o, "v", 1);
        put(o, "screen", "home");
        put(o, "mode", "sv");
        put(o, "rev", String.valueOf(rev));
        put(o, "cover", "tab");
        put(o, "head", new JSONArray());
        put(o, "body", body);
        put(o, "info", new JSONObject());
        return o.toString();
    }

    /** 지금 날씨 두 줄(상태 · 한마디) — 장면 답(look)에 든 값을 글로 옮길 뿐이다. */
    private String[] weatherLines() {
        try {
            JSONObject l = new JSONObject(sceneJson).optJSONObject("look");
            if (l != null && l.optBoolean("wxKnown", false) && !l.isNull("temp")) {
                int t = l.optInt("temp");
                String wk = l.optString("wk", "");
                String ko = l.optString("wxKo", "");
                String ic = "rain".equals(wk) ? "🌧️" : "snow".equals(wk) ? "❄️" : "fog".equals(wk) ? "🌫️" : "overcast".equals(wk) ? "☁️" : "cloudy".equals(wk) ? "⛅" : "☀️";
                String a = ic + " 지금 날씨는 " + ko + ", " + t + "°C예요" + (Double.isNaN(lat) ? " (서울 기준)" : "");
                String tip;
                if ("rain".equals(wk)) tip = "비가 와요, 우산을 꼭 챙겨요 ☂️";
                else if ("snow".equals(wk)) tip = "눈이 와요, 미끄러우니 조심조심 걸어요";
                else if ("fog".equals(wk)) tip = "안개가 껴서 앞이 잘 안 보여요, 천천히 걸어요";
                else if (t <= 5) tip = "많이 추워요, 따뜻하게 입고 나가요 🧣";
                else if (t >= 28) tip = "많이 더워요, 물을 자주 마셔요 💧";
                else if ("overcast".equals(wk)) tip = "구름이 많아요, 가벼운 겉옷을 챙겨요";
                else tip = "밖에서 뛰어놀기 좋은 날이에요 🏃";
                return new String[] {a, tip};
            }
        } catch (Exception e) {
            // 아래 기본 글
        }
        return new String[] {"날씨를 불러오는 중이에요…", ""};
    }

    private String locLine() {
        if (!loc) return "위치 공유가 꺼져 있어요. (설정에서 켤 수 있어요)";
        if (lastFixT == 0L) return "위치 공유 켜짐 · 아직 알린 적이 없어요";
        return "위치 공유 켜짐 · 마지막으로 알린 시각 " + new SimpleDateFormat("a h:mm", Locale.KOREA).format(new Date(lastFixT));
    }

    private String friendsScreen() {
        long now = lastNow;
        F f = find(sel);
        JSONArray a = new JSONArray();
        a.put(b("head", "text", "길동무마을"));
        a.put(b("village", "h", "300"));
        JSONArray chips = new JSONArray();
        for (int i = 0; i < fs.size(); i++) chips.put(item(fs.get(i).name, "sel:" + fs.get(i).id, fs.get(i).id.equals(f.id) ? "1" : "0"));
        JSONObject c = b("chips");
        put(c, "items", chips);
        a.put(c);
        a.put(b("text", "text", line(f, now), "tone", need(f, now) < 4 ? "1" : "0"));
        a.put(b("stat", "label", "배고픔", "val", String.valueOf((int) f.hunger)));
        a.put(b("stat", "label", "응가", "val", String.valueOf(f.poop * 100 / 3)));
        JSONArray it = new JSONArray();
        it.put(b("i", "label", "밥 주기", "act", "care.feed", "on", "1"));
        it.put(b("i", "label", "쓰다듬기", "act", "care.pet", "on", "0"));
        it.put(b("i", "label", "응가 치우기", "act", "care.clean", "on", "0"));
        JSONObject bt = b("btns");
        put(bt, "items", it);
        a.put(bt);
        a.put(b("text", "text", "마을에서 친구를 누르면 고를 수 있고, 💩를 누르면 치워요.", "sub", "1"));
        return wrap("scroll", a);
    }

    private String chatScreen() {
        JSONArray a = new JSONArray();
        a.put(b("head", "text", "가족대화"));
        a.put(b("text", "text", "글자만 보낼 수 있어요. 대화는 7일이 지나면 지워져요.", "sub", "1"));
        if (chat.length() == 0) {
            a.put(b("text", "text", "아직 대화가 없어요. 부모님이 연결되면 여기서 이야기할 수 있어요.", "sub", "1"));
        }
        SimpleDateFormat fmt = new SimpleDateFormat("M/d a h:mm", Locale.KOREA);
        for (int i = 0; i < chat.length(); i++) {
            JSONObject m = chat.optJSONObject(i);
            if (m == null) continue;
            a.put(b("msg", "text", m.optString("x"), "me", String.valueOf(m.optInt("m", 1)),
                    "time", fmt.format(new Date(m.optLong("t", 0L)))));
        }
        a.put(b("input", "hint", "메시지를 입력해요", "act", "chat.send"));
        JSONObject o = new JSONObject();
        put(o, "mode", "scroll");
        put(o, "bottom", "1");
        put(o, "blocks", a);
        return o.toString();
    }

    private String settingsScreen() {
        JSONArray a = new JSONArray();
        a.put(b("head", "text", "설정"));
        a.put(b("switch", "label", "어두운 화면", "on", "dark".equals(theme()) ? "1" : "0", "act", "theme.toggle"));
        a.put(b("switch", "label", "내 위치를 부모님께 알리기", "on", loc ? "1" : "0", "act", "loc.toggle"));
        a.put(b("text", "text", locLine(), "sub", "1"));
        a.put(b("gap", "h", "10"));
        a.put(b("head", "text", "부모님과 연결", "small", "1"));
        if (!pairCode.isEmpty()) {
            a.put(b("qr", "text", "gildongmu-kids://pair?c=" + cid + "&k=" + pairCode));
            a.put(b("text", "text", "비밀키  " + pairCode, "big", "1"));
            a.put(b("text", "text", "부모님 길동무 앱에서 QR을 찍거나 비밀키를 넣어요. 10분 안에 써야 해요.", "sub", "1"));
        } else {
            a.put(b("text", "text", "부모님의 길동무 앱과 QR이나 비밀키로 연결하면, 연결한 부모님만 내 위치를 볼 수 있어요.", "sub", "1"));
        }
        JSONArray it = new JSONArray();
        it.put(b("i", "label", pairCode.isEmpty() ? "연결 QR 만들기" : "새 QR 만들기", "act", "pair.new", "on", "1"));
        JSONObject bt = b("btns");
        put(bt, "items", it);
        a.put(bt);
        a.put(b("text", "text", "서버 연결 전 시험판이에요. 지금은 부모님께 위치가 전달되지 않아요.", "sub", "1"));
        a.put(b("gap", "h", "10"));
        JSONArray it2 = new JSONArray();
        it2.put(b("i", "label", "동의 철회하고 처음으로", "act", "consent.reset", "on", "0"));
        JSONObject bt2 = b("btns");
        put(bt2, "items", it2);
        a.put(bt2);
        return wrap("scroll", a);
    }

    // ───────── 눌림 처리 ─────────
    private String cmd(String c) {
        return "{\"cmd\":\"" + c + "\"}";
    }

    private String genKey() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 10; i++) {
            if (i == 5) sb.append('-');
            sb.append(KEYS.charAt(srnd.nextInt(KEYS.length())));
        }
        return sb.toString();
    }

    private void recover(F f, long now) {
        if (f.sick && f.hunger < 80 && f.poop == 0) {
            f.sick = false;
            f.neg = 0;
            f.sulkUntil = 0L;
            f.starved = f.hunger >= 100;
            setTm(f, "play", now + 4000L);
        }
    }

    synchronized String call(String v, String arg, long now) {
        if (v == null) return null;
        lastNow = now;
        String res = null;
        if (v.startsWith("tab.")) {
            tab = v.substring(4);
        } else if (v.equals("theme.toggle")) {
            store.put("theme", "dark".equals(theme()) ? "pastel" : "dark");
        } else if (v.equals("consent.parent")) {
            store.put("cp", "1".equals(store.get("cp", "0")) ? "0" : "1");
        } else if (v.equals("consent.child")) {
            store.put("cc", "1".equals(store.get("cc", "0")) ? "0" : "1");
        } else if (v.equals("consent.ok")) {
            if ("1".equals(store.get("cp", "0")) && "1".equals(store.get("cc", "0"))) {
                store.put("consent", "1");
                loc = true;
                tab = "home";
                res = cmd("perm");
            }
        } else if (v.equals("consent.reset")) {
            store.put("consent", "0");
            store.put("cp", "0");
            store.put("cc", "0");
            loc = false;
            tab = "home";
            res = cmd("loc.stop");
        } else if (v.equals("loc.toggle")) {
            loc = !loc;
            res = loc ? cmd("perm") : cmd("loc.stop");
        } else if (v.equals("loc.denied")) {
            loc = false;
        } else if (v.equals("pair.new")) {
            pairCode = genKey();
            pairExp = now + PAIR_TTL_MS;
        } else if (v.equals("chat.send")) {
            String s = arg == null ? "" : arg.trim();
            if (s.length() > CHAT_MAX_LEN) s = s.substring(0, CHAT_MAX_LEN);
            if (!s.isEmpty()) {
                try {
                    JSONObject m = new JSONObject();
                    m.put("t", now);
                    m.put("m", 1);
                    m.put("x", s);
                    chat.put(m);
                } catch (Exception e) {
                    // 무시
                }
            }
        } else if (v.startsWith("sel:")) {
            sel = find(v.substring(4)).id;
        } else if (v.startsWith("friend:")) {
            sel = find(v.substring(7)).id;
            tab = "friends";
        } else if (v.startsWith("clean:")) {
            F f = find(v.substring(6));
            if (f.poop > 0) f.poop--;
            if (f.poop == 0) {
                f.poopNeg = false;
                f.poopSince = 0L;
            }
            recover(f, now);
        } else if (v.equals("care.feed")) {
            F f = find(sel);
            f.hunger = Math.max(0.0, f.hunger - 50.0);
            if (f.hunger < 100) f.starved = false;
            if (f.sulkUntil > now) f.sulkUntil = 0L;
            if (f.sick) recover(f, now);
            if (!f.sick) setTm(f, "eat", now + 4000L);
        } else if (v.equals("care.pet")) {
            F f = find(sel);
            f.sulkUntil = 0L;
            if (f.sick) recover(f, now);
            if (!f.sick) setTm(f, "play", now + 3000L);
        } else if (v.equals("care.clean")) {
            F f = find(sel);
            f.poop = 0;
            f.poopNeg = false;
            f.poopSince = 0L;
            recover(f, now);
        }
        dirty = true;
        save();
        return res;
    }

    // ───────── 맨 위 흐르는 문구 · 홈 장면 · 날씨 ─────────
    // 초등학생에게 꿈과 희망을 주는 문구 — 시간대별 12개씩. 같은 시간대라도 날마다 순서가 바뀐다.
    static final String[][] HOPE = {
        { // 0 새벽
            "일찍 일어난 너, 오늘도 반짝반짝 멋져요", "새로운 하루가 선물처럼 도착했어요 🎁", "해님이 올라오듯 너의 꿈도 쑥쑥 커져요 🌅",
            "오늘은 어떤 멋진 일이 생길까요?", "너의 꿈은 아침 해처럼 환하게 빛나요", "씩씩하게 하루를 시작해 봐요, 화이팅!",
            "작은 용기가 큰 꿈의 첫걸음이에요", "오늘도 한 뼘 더 자라는 너를 응원해요", "일어나 준 너에게 박수를 짝짝짝 👏",
            "하고 싶은 일을 마음껏 상상해 봐요", "오늘의 너는 어제보다 더 멋져질 거예요", "꿈을 향해 오늘도 한 걸음 나아가요"
        },
        { // 1 아침
            "좋은 아침! 오늘도 신나게 출발해요 ☀️", "배우는 만큼 너의 꿈도 커져요", "모르는 걸 알아 가는 건 정말 멋진 일이에요",
            "실수해도 괜찮아요, 다시 하면 되니까요", "오늘 만나는 친구에게 먼저 인사해 봐요 😊", "너는 무엇이든 될 수 있는 소중한 사람이에요",
            "하고 싶은 일이 있다면 오늘 한 번 해 봐요", "씩씩한 걸음으로 오늘을 만나요", "궁금한 게 많은 너, 정말 멋져요",
            "오늘 하루도 웃음 가득하길 바라요", "작은 노력이 모여 큰 꿈이 된답니다", "너의 꿈에는 날개가 있어요 🕊️"
        },
        { // 2 점심
            "맛있게 먹고 힘내요! 🍚", "골고루 먹으면 키도 꿈도 쑥쑥 자라요", "점심시간엔 친구와 신나게 놀아요",
            "오늘 배운 것 중 가장 재미있는 건 뭐였나요?", "햇살 가득한 낮, 마음껏 뛰어놀아요 🏃", "포기하지 않는 너는 이미 멋진 도전자예요",
            "친구에게 따뜻한 말 한마디를 건네 봐요", "배가 든든하면 용기도 두둑해져요", "너의 하루는 반짝이는 보물 같아요 ✨",
            "웃는 얼굴이 제일 예뻐요 😄", "오후에도 힘차게 달려 볼까요?", "어려운 문제도 하나씩 풀면 풀려요"
        },
        { // 3 오후
            "오후도 힘내요, 너는 할 수 있어요!", "조금 힘들어도 괜찮아요, 천천히 가도 좋아요", "오늘 해낸 일을 스스로 칭찬해 주세요 👍",
            "너의 꿈이 점점 가까워지고 있어요", "친구와 함께라면 무엇이든 더 즐거워요", "집에 가는 길, 오늘 하루를 떠올려 봐요",
            "넘어져도 다시 일어나는 너는 정말 용감해요", "하고 싶은 일을 하나씩 해 나가요", "오늘도 새로운 걸 하나 배웠다면 대성공!",
            "조금만 더 힘내면 즐거운 저녁이 기다려요", "너는 세상에 하나뿐인 특별한 친구예요", "커서 어떤 사람이 되고 싶은지 상상해 봐요 🌈"
        },
        { // 4 저녁
            "오늘도 수고했어요, 정말 잘했어요! 🌇", "맛있는 저녁 먹고 가족과 이야기 나눠요", "오늘 가장 기뻤던 일을 떠올려 봐요",
            "가족에게 고맙다는 말을 전해 봐요 💛", "내일은 더 멋진 하루가 될 거예요", "오늘 하루, 열심히 해낸 너를 응원해요",
            "책 한 쪽 읽으면 꿈도 한 뼘 자라요 📖", "하루를 잘 마무리하는 너는 멋진 사람이에요", "오늘 배운 것을 가족에게 자랑해 봐요",
            "저녁노을처럼 너의 마음도 따뜻해요", "숙제도 놀이도 즐겁게 해 봐요", "너의 꿈을 모두가 응원하고 있어요 🌟"
        },
        { // 5 밤
            "오늘도 정말 잘 보냈어요, 푹 자요 🌙", "좋은 꿈 꾸고 내일 또 만나요", "잠을 푹 자야 키도 쑥쑥 커요",
            "별님이 너의 꿈을 지켜 주고 있어요 ⭐", "오늘의 걱정은 잠시 내려놓아요", "내일은 오늘보다 더 반짝일 거예요",
            "꿈속에서도 멋진 모험을 떠나요 🚀", "하루 동안 고생한 너를 꼭 안아 줄게요", "눈을 감고 오늘 가장 좋았던 일을 떠올려 봐요",
            "너는 사랑받는 소중한 아이예요 💖", "편안한 밤, 달콤한 꿈 꾸세요", "자고 일어나면 새로운 하루가 기다려요"
        }
    };

    static int slotOf(long now) {
        java.util.Calendar c = java.util.Calendar.getInstance();
        c.setTimeInMillis(now);
        int h = c.get(java.util.Calendar.HOUR_OF_DAY);
        return h >= 4 && h < 7 ? 0 : h >= 7 && h < 11 ? 1 : h >= 11 && h < 14 ? 2 : h >= 14 && h < 18 ? 3 : h >= 18 && h < 21 ? 4 : 5;
    }

    /** 맨 위 흐르는 문구 화면(길동무 /screen/hdr 와 같은 모양). */
    synchronized String hdr() {
        long now = lastNow == 0L ? System.currentTimeMillis() : lastNow;
        int s = slotOf(now);
        ArrayList<String> l = new ArrayList<String>(java.util.Arrays.asList(HOPE[s]));
        long day = (now + java.util.TimeZone.getDefault().getOffset(now)) / 86400000L;
        Collections.shuffle(l, new Random(day * 7L + s));
        JSONArray m = new JSONArray();
        for (int i = 0; i < l.size(); i++) m.put(l.get(i));
        JSONArray body = new JSONArray();
        body.put(nd("marq", "h", 26, "pad", pad(8, 8, 8, 9), "msgs", m, "pass", 16000, "grad", 6000, "line", true));
        JSONObject o = new JSONObject();
        put(o, "ok", true);
        put(o, "v", 1);
        put(o, "screen", "hdr");
        put(o, "rev", day + ":" + s);
        put(o, "cover", "tab");
        put(o, "head", new JSONArray());
        put(o, "body", body);
        put(o, "info", new JSONObject());
        return o.toString();
    }

    synchronized boolean sceneDue(long now) {
        if (now - sceneAskT < 15000L) return false;
        return sceneJson.isEmpty() || now / 600000L != sceneGotT / 600000L;
    }

    synchronized void sceneAsked(long now) {
        sceneAskT = now;
    }

    synchronized boolean hasFix() {
        return !Double.isNaN(lat);
    }

    /** 날씨·장면을 물을 좌표 — 아직 위치를 모르면 서울 시청. */
    synchronized double[] where() {
        return Double.isNaN(lat) ? new double[] {37.5665, 126.978} : new double[] {lat, lng};
    }

    synchronized void setScene(String json, long now) {
        if (json == null || json.length() < 20 || json.length() >= 5900) return;
        try {
            JSONObject o = new JSONObject(json);
            if (!o.has("look") || !o.has("traits")) return;
        } catch (Exception e) {
            return;
        }
        sceneJson = json;
        sceneGotT = now;
    }

    /** 장면·날씨를 물을 때 보낼 글 — 위치는 약 5km 칸으로 뭉개서 보낸다(날씨에는 그 정도면 충분하다). */
    synchronized String sceneBody(long now) {
        double[] w = where();
        JSONObject o = new JSONObject();
        put(o, "nowMs", now);
        put(o, "tzOffsetMin", java.util.TimeZone.getDefault().getOffset(now) / 60000);
        put(o, "locked", false);
        put(o, "routeShown", false);
        put(o, "key", "kids");
        put(o, "here", 0);
        put(o, "boarded", false);
        put(o, "nodes", new JSONArray());
        put(o, "lat", Math.round(w[0] * 20.0) / 20.0);
        put(o, "lng", Math.round(w[1] * 20.0) / 20.0);
        return o.toString();
    }

    private static JSONArray pad(int a, int t, int r, int d) {
        JSONArray x = new JSONArray();
        x.put(a);
        x.put(t);
        x.put(r);
        x.put(d);
        return x;
    }

    private static JSONObject nd(String t, Object... kv) {
        JSONObject o = new JSONObject();
        put(o, "t", t);
        for (int i = 0; i + 1 < kv.length; i += 2) put(o, (String) kv[i], kv[i + 1]);
        return o;
    }

    private static JSONObject callAct(String v) {
        JSONObject a = new JSONObject();
        put(a, "a", "call");
        put(a, "v", v);
        return a;
    }

    /** 글 안의 낱말을 파랗게 강조(시작·끝·색) — 앞에서부터 겹치지 않게 찾는다. */
    private static JSONArray hl(String s, String... words) {
        JSONArray r = new JSONArray();
        int from = 0;
        for (int i = 0; i < words.length; i++) {
            int a = s.indexOf(words[i], from);
            if (a < 0 || words[i].isEmpty()) continue;
            JSONArray p = new JSONArray();
            p.put(a);
            p.put(a + words[i].length());
            p.put("#1d9bf0");
            r.put(p);
            from = a + words[i].length();
        }
        return r;
    }

    private static JSONObject tx(String s, int size, boolean bold, String color, int padB, String... words) {
        JSONObject n = nd("text", "s", s, "size", size, "bold", bold, "color", color, "pad", pad(0, 0, 0, padB), "lh", 1.4);
        if (words.length > 0) put(n, "hl", hl(s, words));
        return n;
    }

    private void pruneChat(long now) {
        try {
            JSONArray n = new JSONArray();
            for (int i = 0; i < chat.length(); i++) {
                JSONObject m = chat.optJSONObject(i);
                if (m != null && now - m.optLong("t", 0L) <= CHAT_KEEP_MS) n.put(m);
            }
            if (n.length() != chat.length()) {
                chat = n;
                dirty = true;
            }
        } catch (Exception e) {
            // 무시
        }
    }
}
