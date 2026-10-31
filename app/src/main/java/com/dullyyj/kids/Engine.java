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

    synchronized void lastFix(double lat, double lng, float acc, long t) {
        lastFixT = t;
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
        JSONArray a = new JSONArray();
        a.put(b("head", "text", "오늘의 길동무 브리핑"));
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
        a.put(b("text", "text", needy == 0 ? "길동무 친구들이 모두 잘 지내요." : "도와줘야 하는 친구가 " + needy + "명 있어요.", "sub", "1"));
        for (int i = 0; i < list.size(); i++) {
            F f = list.get(i);
            int nd = need(f, now);
            a.put(b("card", "title", f.name, "text", line(f, now), "thumb", Sheets.walkFile(f.id),
                    "act", "friend:" + f.id, "tone", nd < 4 ? "1" : "0"));
        }
        a.put(b("gap", "h", "6"));
        a.put(b("card", "title", "내 위치", "text", locLine(), "thumb", "", "act", "tab.settings"));
        return wrap("scroll", a);
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
