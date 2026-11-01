package com.dullyyj.kids;

import org.json.JSONArray;
import org.json.JSONObject;

import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
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

    static final String[] MOODS = {"idle", "beg", "eat", "sulk", "sick", "poop", "play", "sleep", "study"};
    static final long STUDY_MS = 5L * 60L * 1000L;      // 공부하기는 5분 동안 이어진다
    static final long SLEEP_MS = 3L * 60L * 1000L;      // 잠자기는 3분 동안 이어진다
    static final long ANGRY_MS = 10000L;                // 공부 중에 건드리면 화를 내는 시간
    // 하루 일과(기기의 현지 시각 기준) — 기상 5:00~6:00 · 아침 6:30~7:30 · 점심 11:00~13:00 · 밤 11시 취침. 친구마다·날마다 시각이 다르다.
    static final int SLEEP_AT_MIN = 23 * 60;
    static final int MEAL_WIN_MIN = 90;                     // 밥때가 된 뒤 이만큼 안에 앱이 켜져 있으면 밥을 달라고 한다
    static final long MEAL_RISE_MS = 90L * 60L * 1000L;     // 밥을 달라고 한 뒤 70점에서 100점까지 오르는 시간
    static final long MEAL_GIVEUP_MS = 150L * 60L * 1000L;  // 이만큼 지나면 그 끼니는 넘어간다
    static final long POOP_MIN_MS = 2L * 3600L * 1000L;     // 밥 먹고 2~3시간 뒤에 응가
    static final long POOP_SPAN_MS = 3600L * 1000L;
    static final long DAY_MS = 86400000L;
    // 동작 시트(_act) 칸 번호 — 종류별. -1 이면 그 동작 칸이 없어 걷기 시트로 대신한다.
    static final int[][] CELLS = {
        {-1, 1, 13, 6, 6, 0, 15, 5, -1},   // 0 강아지·고양이
        {-1, 1, 0, 13, 15, 0, 12, 14, -1}, // 1 두더지
        {-1, 11, 8, 14, 14, 6, 15, 1, -1}, // 2 독수리
        {-1, 8, 4, 9, 15, 0, 13, 5, -1},   // 3 올챙이
        {-1, -1, -1, -1, -1, -1, -1, -1, -1} // 4 그 밖(걷기 시트만)
    };
    // id, 이름, 종류
    static final String[][] CAST = {
        {"ppopu", "뽀푸", "0"}, {"dolsom", "돌솜", "0"}, {"lovel", "러블", "0"}, {"chaeng", "챙챙", "3"},
        {"sul", "술", "2"}, {"dudung", "두덩", "1"}, {"bbosong", "뽀송", "4"}, {"juksun", "죽순", "4"}
    };
    private static final String[] BUBBLE = {"", "밥 주세요!", "냠냠!", "흥!", "아파요…", "응가!", "신나요!", "zZ", "공부 중"};
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
        long nextLong;
        long angerUntil;
        String pend = "";                  // 밥을 기다리는 끼니("b" 아침 · "l" 점심)
        long pendT;
        long bfDay = -1L, lunchDay = -1L;  // 그 끼니를 시작한 날(현지 날짜 번호)
        long poopAt;                       // 밥 먹고 난 뒤 정해 둔 응가 시각
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
    // ── 길동무 키즈 서버(엔진) 연결 — 가족대화·퀘스트 화면은 서버가 만들어 주고, 앱은 받아서 그리기만 한다
    private final HashMap<String, String> rem = new HashMap<String, String>();
    private volatile boolean regOk = false;
    private boolean remBusy = false;
    private long remAskT = 0L, locSentT = 0L;
    private int linked = 0;
    // ── 부모 길동무와 실시간 연동: 서버(엔진)가 정한 알림 · 남은 거리 · 응원문구 · 안내를 받아 둘 뿐이다
    private String promptId = "", promptName = "", promptText = "";
    private boolean promptShut = false;
    private String tripId = "", tripText = "", tripHint = "";
    private boolean tripNear = false;
    private JSONArray cheers = new JSONArray();
    private String noticeTxt = "";
    private long noticeUntil = 0L, waitOkT = 0L;
    private volatile int svRev = 0;
    private volatile boolean fg = false, waitRun = false;
    private String pairErr = "";
    private long pairExp = 0L;
    private final String cid, csec;
    private String sceneJson = "";
    private long sceneAskT = 0L, sceneGotT = 0L;
    private double lat = Double.NaN, lng = Double.NaN;
    private long fixT = 0L;
    private boolean sceneWx = false;
    private String dong = "";
    private double dongLa = Double.NaN, dongLo = Double.NaN;
    private long dongTryAt = 0L;
    private boolean dressOpen = false;
    private String dressSel = "";
    private String dressTab = "hat";
    private JSONArray quests = new JSONArray();
    private String questTab = "c";
    private String drawKey = "", drawJson = "";
    private int viewDp = 0;                 // 화면 높이(dp) — 장면 높이를 고정으로 정할 때만 쓴다(줄 수가 바뀌어도 장면이 다시 만들어지지 않게)

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
        if (o.has("la") && o.has("lo")) { // 마지막으로 잡은 정확한 위치 — 앱을 껐다 켜도 이어서 쓴다
            lat = o.optDouble("la", Double.NaN);
            lng = o.optDouble("lo", Double.NaN);
            fixT = o.optLong("ft", 0L);
        }

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
                f.pend = s.optString("pd", "");
                f.pendT = s.optLong("pt", 0L);
                f.bfDay = s.optLong("bd", -1L);
                f.lunchDay = s.optLong("ld", -1L);
                f.poopAt = s.optLong("pa", 0L);
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
        try {
            quests = new JSONArray(store.get("quests", "[]"));
        } catch (Exception e) {
            quests = new JSONArray();
        }
    }

    private void save() {
        try {
            JSONObject o = new JSONObject();
            o.put("sel", sel);
            o.put("loc", loc ? 1 : 0);
            o.put("lf", lastFixT);
            if (!Double.isNaN(lat) && !Double.isNaN(lng)) {
                o.put("la", lat);
                o.put("lo", lng);
                o.put("ft", fixT);
            }

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
                x.put("pd", f.pend);
                x.put("pt", f.pendT);
                x.put("bd", f.bfDay);
                x.put("ld", f.lunchDay);
                x.put("pa", f.poopAt);
                a.put(x);
            }
            o.put("fr", a);
            store.put("state", o.toString());
            store.put("chat", chat.toString());
            store.put("quests", quests.toString());
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

    /** 부모에게 알리는 위치 — 정확한 값 그대로 저장한다(날씨를 물을 때만 따로 뭉갠다). */
    synchronized void lastFix(double la, double lo, float acc, long t) {
        lastFixT = t;
        lat = la;
        lng = lo;
        fixT = t;
        dirty = true;
        kidLoc(la, lo, acc, t);
    }

    /** 날씨용으로 빨리 잡은 마지막 위치(부모에게 알린 것은 아니다). */
    synchronized void seenFix(double la, double lo) {
        if (Double.isNaN(la) || Double.isNaN(lo)) return;
        lat = la;
        lng = lo;
        fixT = System.currentTimeMillis();
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
        Poke.setStudy(studyCsv(now));
        Poke.setSleep(sleepCsv(now));
        Poke.setStates(statesCsv(now));
        if (now - lastPrune > 60000L) {
            lastPrune = now;
            pruneChat(now);
        }
        remPoll(now);
        Push.ping(consented());
        if (fg && !waitRun && consented()) setFg(true);
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

    private static long tzOf(long now) {
        return java.util.TimeZone.getDefault().getOffset(now);
    }

    /** 친구 f 의 그날 일과(하루 중 분): {기상, 아침, 점심}. 친구마다·날마다 다르게 나오되 같은 날엔 늘 같다. */
    private static int[] plan(F f, long day) {
        long z = f.id.hashCode() * 1000003L + day * 7919L + 17L;
        z = (z ^ (z >>> 30)) * 0xbf58476d1ce4e5b9L;
        z = (z ^ (z >>> 27)) * 0x94d049bb133111ebL;
        z ^= z >>> 31;
        Random r = new Random(z);
        return new int[] {300 + r.nextInt(61), 390 + r.nextInt(61), 660 + r.nextInt(121)};
    }

    /** 지금이 밤(밤 11시~기상)이면 깨어날 시각(ms), 낮이면 0. */
    private long wakeAt(F f, long now) {
        long tz = tzOf(now), loc = now + tz, day = loc / DAY_MS;
        int m = (int) ((loc % DAY_MS) / 60000L);
        if (m >= SLEEP_AT_MIN) return (day + 1L) * DAY_MS + plan(f, day + 1L)[0] * 60000L - tz;
        int w = plan(f, day)[0];
        if (m < w) return day * DAY_MS + w * 60000L - tz;
        return 0L;
    }

    /** 하루 일과: 밤엔 자고, 아침·점심엔 밥을 달라고 하고, 밥 먹고 2~3시간 뒤엔 응가한다. */
    private void schedule(F f, long now, long dt) {
        long wk = wakeAt(f, now);
        if (wk != 0L) {
            if (!"sleep".equals(f.tm) || f.tmUntil != wk) setTm(f, "sleep", wk);
            f.pend = "";
            return;
        }
        long tz = tzOf(now), loc = now + tz, day = loc / DAY_MS;
        int m = (int) ((loc % DAY_MS) / 60000L);
        int[] p = plan(f, day);
        if (f.pend.isEmpty() && !f.sick) {
            if (f.bfDay != day && m >= p[1] && m < p[1] + MEAL_WIN_MIN) startMeal(f, "b", day, now);
            else if (f.lunchDay != day && m >= p[2] && m < p[2] + MEAL_WIN_MIN) startMeal(f, "l", day, now);
        }
        if (!f.pend.isEmpty()) {
            if (now - f.pendT > MEAL_GIVEUP_MS) {
                f.pend = "";
                f.hunger = Math.min(f.hunger, 40.0);
                f.starved = false;
            } else if (!f.sick && f.hunger < 100.0) {
                f.hunger = Math.min(100.0, f.hunger + dt * 30.0 / (double) MEAL_RISE_MS);
            }
        }
        if (f.poopAt != 0L && now >= f.poopAt) {
            f.poopAt = 0L;
            if (f.poop < 3) {
                if (f.poop == 0) f.poopSince = now;
                f.poop++;
            }
            setTm(f, "poop", now + 4000L);
        }
    }

    private void startMeal(F f, String k, long day, long now) {
        f.pend = k;
        f.pendT = now;
        f.starved = false;
        f.hunger = Math.max(f.hunger, (double) BEG_AT);
        if ("b".equals(k)) f.bfDay = day;
        else f.lunchDay = day;
    }

    /** 밥을 준다. 밥때(졸랐을 때)면 배가 불러 응가 시각이 정해지고, 아니면 간식처럼 조금만 채운다. 자는 밤엔 깨우지 않는다. */
    private void feedOne(F f, long now) {
        if (wakeAt(f, now) != 0L) return;
        boolean meal = !f.pend.isEmpty();
        f.hunger = meal ? 0.0 : Math.max(0.0, f.hunger - 50.0);
        if (f.hunger < 100) f.starved = false;
        if (f.sulkUntil > now) f.sulkUntil = 0L;
        if (meal) {
            f.pend = "";
            if (f.poopAt == 0L) f.poopAt = now + POOP_MIN_MS + (long) (rnd.nextDouble() * POOP_SPAN_MS);
        }
        if (f.sick) recover(f, now);
        if (!f.sick) setTm(f, "eat", now + 4000L);
    }

    private void step(F f, long now, long dt) {
        schedule(f, now, dt);
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
        if (f.nextLong == 0L) f.nextLong = now + rnd.nextInt(5 * 60 * 1000);
        if (now >= f.nextEvt) {
            f.nextEvt = now + EVT_MIN + rnd.nextInt((int) (EVT_MAX - EVT_MIN));
            if (!f.sick && f.sulkUntil <= now && f.tm.isEmpty() && f.hunger < BEG_AT) event(f, now);
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
        if (r < 50) {
            playTogether(f, now, 45000L + rnd.nextInt(30000));
        } else if (r < 70 && now >= f.nextLong) {
            startLong(f, "study", now + STUDY_MS, now);
        }
    }

    /** 공부·잠처럼 오래 하는 행동은 한 번 하면 한참 쉬었다가 다시 한다(장면이 늘 자고 있지 않게). */
    private void startLong(F f, String m, long until, long now) {
        setTm(f, m, until);
        f.nextLong = now + 8L * 60L * 1000L + rnd.nextInt(8 * 60 * 1000);
    }

    /** 친구 한 명이 놀기 시작하면 한가한 친구 한두 명이 같이 논다. */
    private void playTogether(F f, long now, long ms) {
        setTm(f, "play", now + ms);
        ArrayList<F> o = new ArrayList<F>();
        for (int i = 0; i < fs.size(); i++) {
            F x = fs.get(i);
            if (x != f && !x.sick && x.sulkUntil <= now && x.tm.isEmpty()) o.add(x);
        }
        Collections.shuffle(o, rnd);
        int n = 1 + rnd.nextInt(2);
        for (int i = 0; i < n && i < o.size(); i++) setTm(o.get(i), "play", now + ms);
    }

    /** 부모 길동무 '뭐하니?' 활동 기록: 친구가 밥 먹기 · 놀기 · 공부 · 잠 · 응가를 시작하면 서버에 한 줄 알린다(같은 일은 60초에 한 번 · 연결된 부모가 있을 때만). */
    private final HashMap<String, Long> evAt = new HashMap<String, Long>();

    private void kidEv(String k, String name) {
        if (linked <= 0 || !consented() || name == null || name.isEmpty()) return;
        if (!(k.equals("eat") || k.equals("play") || k.equals("study") || k.equals("sleep") || k.equals("poop"))) return;
        long t = lastNow;
        String key = k.equals("eat") ? k + name : k;
        Long p = evAt.get(key);
        if (p != null && t - p < 60000L) return;
        evAt.put(key, t);
        final JSONObject o = new JSONObject();
        put(o, "k", k.equals("eat") ? "feed" : k);
        put(o, "x", name);
        Wire.EX.execute(new Runnable() {
            @Override
            public void run() {
                if (ensureReg()) Kid.call("POST", "/c/ev", o.toString(), cid, csec);
            }
        });
    }

    private void setTm(F f, String m, long until) {
        kidEv(m, f.name);
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
                .append('|').append(sel).append('|').append(pairCode).append('|').append(chat.length()).append(pairErr).append(linked);
        sb.append('|').append(promptId).append(promptShut ? 1 : 0).append(tripText).append(tripNear ? 1 : 0).append(noticeTxt.isEmpty() || System.currentTimeMillis() > noticeUntil ? 0 : 1).append(cheers.length());
        if ("chat".equals(tab)) sb.append('|').append(remGet("chat").hashCode());
        if ("settings".equals(tab)) sb.append('|').append(lastFixT / 60000L);
        if ("quest".equals(tab)) sb.append('|').append(questTab).append(remGet("quest:" + questTab).hashCode());
        if ("home".equals(tab)) sb.append('|').append(sceneGotT / 1000L).append(Double.isNaN(lat) ? 'n' : 'y').append(viewDp).append(Poke.shown()).append(String.valueOf(sceneRoom(lastNow)));
        for (int i = 0; i < fs.size(); i++) {
            F f = fs.get(i);
            sb.append('|').append(moodOf(f, lastNow)).append(',').append((int) (f.hunger / 5)).append(',')
                    .append(f.poop).append(',').append(f.neg).append(f.angerUntil > lastNow ? 'a' : '-')
                    .append(f.tm.isEmpty() ? 0L : Math.min(f.tmUntil - lastNow, 6L * 60000L) / 60000L);
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
        {
            String[][] T = {
                {"chat", "가족대화", "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"},
                {"map", "노선도", "M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"},
                {"home", "홈", "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"},
                {"quest", "퀘스트", "M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm-2 14l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"},
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
            if (!consented()) return homeScreen();
            if ("chat".equals(t)) return chatScreen();
            if ("map".equals(t)) return wrap("map", new JSONArray());
            if ("quest".equals(t)) return questScreen();
            if ("settings".equals(t)) return settingsScreen();
            return homeScreen();
        } catch (Exception e) {
            return wrap("scroll", new JSONArray());
        }
    }

    /** 처음 켰을 때 홈 위로 올라오는 동의 창 내용(동의한 뒤에는 빈 글). */
    synchronized String consentSheet() {
        return consented() ? "" : consentScreen();
    }

    /** 퀘스트: 왼쪽 자녀 미션(부모님이 보낸 것) · 오른쪽 부모님 미션(내가 부모님께 보낸 것). 길동무와 연결되기 전에는 이 기기에만 저장한다. */
    private String questScreen() {
        String r = remGet("quest:" + ("p".equals(questTab) ? "p" : "c"));
        return r.isEmpty() ? questLocal() : r;
    }

    // ───────── 키즈 서버 통로(모든 통신은 뒤 스레드) ─────────
    private String remGet(String key) {
        String s = rem.get(key);
        if (s == null) {
            s = store.get("rm." + key, "");
            if (s == null) s = "";
            rem.put(key, s);
        }
        return s;
    }

    private void remPut(String key, String json) {
        if (json == null || json.isEmpty() || json.equals(remGet(key))) return;
        rem.put(key, json);
        store.put("rm." + key, json);
        dirty = true;
    }

    private boolean ensureReg() {
        if (regOk) return true;
        try {
            JSONObject o = new JSONObject();
            o.put("id", cid);
            o.put("sec", csec);
            o.put("role", "c");
            String r = Kid.call("POST", "/reg", o.toString(), null, null);
            if (r != null && new JSONObject(r).optBoolean("ok", false)) regOk = true;
        } catch (Exception e) {
            regOk = false;
        }
        return regOk;
    }

    /** 화면 서버에서 새로 받아 온다. 가족대화·퀘스트를 보고 있으면 자주, 아니면 드물게. */
    private void remPoll(long now) {
        if (!consented() || remBusy) return;
        final boolean ch = "chat".equals(tab), qu = "quest".equals(tab);
        long gap = now - waitOkT < 40000L ? 90000L : ((ch || qu) ? 4000L : ("settings".equals(tab) ? 8000L : 40000L));    // 긴 대기가 살아 있으면 가끔 확인만
        if (now - remAskT < gap) return;
        remAskT = now;
        remBusy = true;
        final String qt = "p".equals(questTab) ? "p" : "c";
        Wire.EX.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    if (!ensureReg()) return;
                    if (ch) {
                        remGot("chat", Kid.call("GET", "/c/screen?tab=chat", null, cid, csec));
                    } else if (qu) {
                        remGot("quest:c", Kid.call("GET", "/c/screen?tab=quest&qt=c", null, cid, csec));
                        remGot("quest:p", Kid.call("GET", "/c/screen?tab=quest&qt=p", null, cid, csec));
                    } else {
                        remGot(null, Kid.call("GET", "/c/state", null, cid, csec));
                    }
                } finally {
                    remDone();
                }
            }
        });
    }

    /** 서버가 준 상태(알림 · 남은 거리 · 응원문구 · 안내 · 미션 화면)를 받아 둔다. 바뀐 것만 화면이 다시 그려진다. */
    private void absorb(JSONObject o) {
        if (o.has("rev")) svRev = o.optInt("rev", svRev);
        if (o.has("stars")) {
            JSONObject p = o.optJSONObject("prompt");
            String pid = p == null ? "" : p.optString("id", "");
            if (!pid.equals(promptId)) promptShut = false;
            promptId = pid;
            promptName = p == null ? "" : p.optString("name", "");
            promptText = p == null ? "" : p.optString("text", "");
            JSONObject t = o.optJSONObject("trip");
            tripId = t == null ? "" : t.optString("id", "");
            tripText = t == null ? "" : t.optString("text", "");
            tripHint = t == null ? "" : t.optString("hint", "");
            tripNear = t != null && t.optBoolean("near", false);
            JSONArray ch = o.optJSONArray("cheers");
            cheers = ch == null ? new JSONArray() : ch;
        }
        String nt = o.optString("notice", "");
        if (!nt.isEmpty()) {
            noticeTxt = nt;
            noticeUntil = System.currentTimeMillis() + 5000L;
        }
        JSONObject ss = o.optJSONObject("screens");
        if (ss != null) {
            JSONObject c0 = ss.optJSONObject("c"), p0 = ss.optJSONObject("p");
            if (c0 != null) remPut("quest:c", c0.toString());
            if (p0 != null) remPut("quest:p", p0.toString());
        }
        dirty = true;
    }

    /** 앞에 떠 있는 동안 서버에 긴 대기를 걸어 둔다 — 부모가 무언가 하면 서버가 곧바로 답을 준다(기다리는 시간 없음). */
    synchronized void setFg(boolean on) {
        fg = on;
        if (on && !waitRun && consented()) {
            waitRun = true;
            Thread th = new Thread(new Runnable() {
                @Override
                public void run() {
                    waitLoop();
                }
            }, "kids-wait");
            th.setDaemon(true);
            th.start();
        }
    }

    private void waitLoop() {
        int fails = 0;
        try {
            while (fg && consented()) {
                if (!ensureReg()) {
                    Thread.sleep(3000L);
                    continue;
                }
                String t = tab();
                String r = Kid.callT("GET", "/c/wait?since=" + svRev + "&tab=" + t + "&qt=" + ("p".equals(questTabNow()) ? "p" : "c"), null, cid, csec, 24000);
                if (r == null) {
                    fails++;
                    Thread.sleep(Math.min(500L * fails, 4000L));
                    continue;
                }
                fails = 0;
                synchronized (this) {
                    waitOkT = System.currentTimeMillis();
                }
                remGot("chat".equals(t) ? "chat" : null, r);
            }
        } catch (InterruptedException e) {
            // 끝
        } finally {
            synchronized (this) {
                waitRun = false;
            }
        }
    }

    private synchronized String questTabNow() {
        return questTab;
    }

    private synchronized void remDone() {
        remBusy = false;
    }

    /** 서버가 준 화면(또는 상태)을 받아 둔다. 달라졌을 때만 화면이 다시 그려진다. */
    private synchronized void remGot(String key, String r) {
        if (r == null) return;
        try {
            JSONObject o = new JSONObject(r);
            if (!o.optBoolean("ok", false)) return;
            absorb(o);
            if (o.has("linked")) linked = o.optInt("linked", linked);
            JSONObject sc = o.optJSONObject("screen");
            if (key != null && sc != null) remPut(key, sc.toString());
        } catch (Exception e) {
            // 무시
        }
    }

    /** 눌림·보내기를 서버로 보내고 돌려받은 새 화면으로 바꾼다. */
    private void kidAct(String v, String arg) {
        final JSONObject o = new JSONObject();
        put(o, "v", v);
        put(o, "arg", arg);
        put(o, "tab", tab);
        put(o, "qt", "p".equals(questTab) ? "p" : "c");
        final String key = "chat".equals(tab) ? "chat" : "quest:" + ("p".equals(questTab) ? "p" : "c");
        remAskT = 0L;
        Wire.EX.execute(new Runnable() {
            @Override
            public void run() {
                if (!ensureReg()) return;
                remGot(key, Kid.call("POST", "/c/act", o.toString(), cid, csec));
            }
        });
    }

    /** 보낸 글은 서버 답을 기다리지 않고 바로 보이게 먼저 끼워 둔다(곧 서버 화면으로 바뀐다). */
    private void chatPatch(String s, long now) {
        String r = remGet("chat");
        if (r.isEmpty()) return;
        try {
            JSONObject o = new JSONObject(r);
            JSONArray bl = o.getJSONArray("blocks");
            JSONObject bx = bl.getJSONObject(2);
            JSONArray k = bx.getJSONArray("kids");
            JSONArray n = new JSONArray();
            for (int i = 0; i < k.length() - 1; i++) n.put(k.get(i));
            n.put(b("msg", "text", s, "me", "1", "time", new SimpleDateFormat("M/d a h:mm", Locale.KOREA).format(new Date(now))));
            n.put(k.get(k.length() - 1));
            bx.put("kids", n);
            remPut("chat", o.toString());
        } catch (Exception e) {
            // 무시
        }
    }

    private void kidPair() {
        pairErr = "";
        pairCode = "";
        pairExp = 0L;
        dirty = true;
        Wire.EX.execute(new Runnable() {
            @Override
            public void run() {
                String r = ensureReg() ? Kid.call("POST", "/c/pair", "{}", cid, csec) : null;
                pairGot(r);
            }
        });
    }

    private synchronized void pairGot(String r) {
        String code = "";
        try {
            JSONObject o = new JSONObject(r == null ? "{}" : r);
            if (o.optBoolean("ok", false)) code = o.optString("code", "");
        } catch (Exception e) {
            code = "";
        }
        if (code.isEmpty()) {
            pairErr = "1";
        } else {
            pairErr = "";
            pairCode = code;
            pairExp = System.currentTimeMillis() + PAIR_TTL_MS;
        }
        dirty = true;
    }

    private void kidUnlink() {
        promptId = "";
        promptShut = false;
        tripId = "";
        cheers = new JSONArray();
        noticeTxt = "";
        linked = 0;
        pairCode = "";
        pairExp = 0L;
        dirty = true;
        Wire.EX.execute(new Runnable() {
            @Override
            public void run() {
                if (ensureReg()) Kid.call("POST", "/c/unlink", "{}", cid, csec);
            }
        });
    }

    /** 정확한 위치를 서버에 올린다. 서버는 연결된 부모가 있을 때만, 가장 최근 한 건만 둔다. */
    private void kidLoc(final double la, final double lo, final float acc, long t) {
        if (!locOn() || t - locSentT < (tripId.isEmpty() ? 15000L : 7000L)) return;      // 출발한 뒤에는 거리가 더 자주 갱신되게
        locSentT = t;
        final JSONObject o = new JSONObject();
        put(o, "la", la);
        put(o, "lo", lo);
        put(o, "acc", (double) acc);
        put(o, "dn", dong);
        Wire.EX.execute(new Runnable() {
            @Override
            public void run() {
                if (ensureReg()) remGot(null, Kid.call("POST", "/c/loc", o.toString(), cid, csec));
            }
        });
    }

    private String questLocal() {
        boolean kid = !"p".equals(questTab);
        int nc = 0, np = 0;
        for (int i = 0; i < quests.length(); i++) {
            JSONObject q = quests.optJSONObject(i);
            if (q == null) continue;
            if ("p".equals(q.optString("k"))) np++;
            else nc++;
        }
        JSONArray a = new JSONArray();
        a.put(b("head", "text", "퀘스트"));
        JSONArray chips = new JSONArray();
        chips.put(item("자녀 미션 " + nc, "quest.tab:c", kid ? "1" : "0"));
        chips.put(item("부모님 미션 " + np, "quest.tab:p", kid ? "0" : "1"));
        JSONObject c = b("chips", "eq", "1", "loop", "1");
        put(c, "items", chips);
        a.put(c);
        a.put(b("text", "text", kid ? "부모님이 길동무 앱에서 보내 주신 미션이에요. 해냈으면 눌러서 알려요." : "내가 부모님께 보내는 미션이에요. 부모님이 해내면 여기에 표시돼요.", "sub", "1"));
        if (!kid) a.put(b("input", "hint", "부모님께 보낼 미션을 적어요", "act", "quest.send"));
        int shown = 0;
        for (int i = quests.length() - 1; i >= 0; i--) {
            JSONObject q = quests.optJSONObject(i);
            if (q == null || "p".equals(q.optString("k")) == kid) continue;
            boolean done = q.optInt("s", 0) == 1;
            String st = kid ? (done ? "✅ 해냈어요" : "눌러서 해냈다고 알려요") : (done ? "✅ 부모님이 해냈어요" : "⏳ 부모님을 기다리는 중이에요");
            a.put(b("card", "title", q.optString("x"), "text", st, "thumb", "", "act", kid && !done ? "quest.done:" + q.optString("i") : "", "tone", done ? "0" : "1"));
            shown++;
        }
        if (shown == 0) {
            a.put(b("card", "title", kid ? "아직 받은 미션이 없어요" : "아직 보낸 미션이 없어요", "text", kid ? "부모님이 길동무 앱에서 미션을 보내면 여기에 나타나요" : "위 칸에 적어서 부모님께 보내 보세요", "thumb", "", "act", ""));
        }
        return wrap("scroll", a);
    }

    /** 홈 위로 올라오는 '길동무 친구들 꾸미기' 창 — 위쪽에서 친구를 고르고 아래에 꾸미는 아이템이 들어온다. */
    /** 부모가 정한 장소에 갈 시간이 가까우면 홈 위에 올라오는 알림: [확인](그냥 끔) · [출발]. */
    synchronized String promptSheet() {
        if (!consented() || promptId.isEmpty() || promptShut || linked <= 0) return "";
        JSONArray a = new JSONArray();
        a.put(b("text", "text", promptText, "big", "1"));
        JSONArray it = new JSONArray();
        it.put(b("i", "label", "확인", "act", "trip.ok:" + promptId, "on", "0"));
        it.put(b("i", "label", "출발", "act", "trip.go:" + promptId, "on", "1"));
        JSONObject bt = b("btns");
        put(bt, "items", it);
        a.put(bt);
        return wrap("scroll", a);
    }

    /** 서버가 보낸 짧은 안내(출발하면 '00에 도착하면 포인트가 쌓여요' · 도착하면 포인트 안내)를 5초 동안 보여 준다. */
    synchronized String noticeSheet() {
        if (!consented() || noticeTxt.isEmpty() || System.currentTimeMillis() > noticeUntil) return "";
        JSONArray a = new JSONArray();
        a.put(b("text", "text", noticeTxt, "big", "1"));
        return wrap("scroll", a);
    }

    /** 출발한 뒤 화면 아래에 뜨는 남은 거리 알약. 도착점 100m 안이면 [도착 확인]이 켜진다(거리 · 문구는 모두 서버가 계산). */
    synchronized String pill() {
        if (!consented() || tripId.isEmpty() || linked <= 0) return "";
        JSONArray k = new JSONArray();
        k.put(tx(tripText, 14, true, "text", 2));
        if (tripNear) {
            k.put(nd("button", "s", "도착 확인", "act", callAct("trip.arrive:" + tripId), "h", 40, "size", 13, "bold", true, "fill", "gold", "tc", "#121214", "line", "gold", "r", 20, "pad", pad(0, 6, 0, 0)));
        } else {
            k.put(tx(tripHint, 11, false, "sub", 0));
        }
        JSONArray body = new JSONArray();
        body.put(nd("panel", "pad", pad(12, 4, 12, 6), "ip", pad(16, 10, 16, 10), "fill", "card", "line", "gold", "r", 24, "kids", k));
        JSONObject o = new JSONObject();
        put(o, "ok", true);
        put(o, "v", 1);
        put(o, "screen", "trip");
        put(o, "cover", "tab");
        put(o, "head", new JSONArray());
        put(o, "body", body);
        put(o, "info", new JSONObject());
        return o.toString();
    }

    synchronized String dressSheet() {
        if (!dressOpen || !consented() || fs.isEmpty()) return "";
        F cur = find(dressSel);
        JSONArray a = new JSONArray();
        a.put(b("head", "text", "길동무 친구들 꾸미기"));
        JSONArray k1 = new JSONArray();
        k1.put(b("avatar", "id", cur.id, "name", cur.name));
        JSONArray chips = new JSONArray();
        for (int i = 0; i < fs.size(); i++) chips.put(item(fs.get(i).name, "dress.sel:" + fs.get(i).id, fs.get(i).id.equals(cur.id) ? "1" : "0"));
        JSONObject c = b("chips");
        put(c, "items", chips);
        k1.put(c);
        JSONObject bx1 = b("box", "hp", "25");
        put(bx1, "kids", k1);
        a.put(bx1);
        JSONArray k2 = new JSONArray();
        String[][] tabs = {{"hat", "모자"}, {"cloth", "옷"}, {"item", "소지품"}};
        JSONArray tc = new JSONArray();
        String tname = "모자";
        for (int i = 0; i < tabs.length; i++) {
            boolean on = tabs[i][0].equals(dressTab);
            if (on) tname = tabs[i][1];
            tc.put(item(tabs[i][1], "dress.tab:" + tabs[i][0], on ? "1" : "0"));
        }
        JSONObject tcs = b("chips");
        put(tcs, "items", tc);
        k2.put(tcs);
        k2.put(b("card", "title", tname, "text", "곧 만날 수 있어요", "thumb", "", "act", ""));
        JSONObject bx2 = b("box", "hp", "33");
        put(bx2, "kids", k2);
        a.put(bx2);
        a.put(b("gap", "h", "8"));
        JSONArray it = new JSONArray();
        it.put(b("i", "label", "닫기", "act", "dress.close", "on", "0"));
        JSONObject bt = b("btns");
        put(bt, "items", it);
        a.put(bt);
        return wrap("scroll", a);
    }

    // ── 동네 이름: 길동무 서버가 좌표 → 행정동을 알려 준다(위치를 새로 잡았을 때만 · 300m 안에서는 다시 묻지 않는다) ──
    synchronized boolean dongDue(long now) {
        if (Double.isNaN(lat) || now - dongTryAt < 30000L) return false;
        return dong.isEmpty() || Double.isNaN(dongLa) || Math.abs(dongLa - lat) > 0.003 || Math.abs(dongLo - lng) > 0.003;
    }

    synchronized void dongAsked(long now) {
        dongTryAt = now;
    }

    synchronized String dongUrl() {
        String qs = String.format(Locale.US, "x=%.3f&y=%.3f", lng, lat);
        try {
            return "https://gentle-lab-7e47subway-api.phg0643.workers.dev/kakao-local?path=" + java.net.URLEncoder.encode("geo/coord2regioncode.json", "UTF-8") + "&qs=" + java.net.URLEncoder.encode(qs, "UTF-8");
        } catch (Exception e) {
            return "";
        }
    }

    synchronized void setDong(String body, double la, double lo) {
        if (body == null || body.length() < 2) return;
        try {
            JSONArray d = new JSONObject(body).optJSONArray("documents");
            if (d == null) return;
            String h3 = "", b3 = "", any3 = "", any2 = "";
            for (int i = 0; i < d.length(); i++) {
                JSONObject m = d.optJSONObject(i);
                if (m == null) continue;
                String t = m.optString("region_type", ""), r3 = m.optString("region_3depth_name", "").trim(), r2 = m.optString("region_2depth_name", "").trim();
                if ("H".equals(t) && h3.isEmpty()) h3 = r3;
                if ("B".equals(t) && b3.isEmpty()) b3 = r3;
                if (any3.isEmpty()) any3 = r3;
                if (any2.isEmpty()) any2 = r2;
            }
            String r = !h3.isEmpty() ? h3 : !b3.isEmpty() ? b3 : !any3.isEmpty() ? any3 : any2;
            if (r.isEmpty()) return;
            if (r.length() > 20) r = r.substring(0, 20);
            boolean ch = !r.equals(dong);
            dong = r;
            dongLa = la;
            dongLo = lo;
            if (ch) rev++;
        } catch (Exception e) {
            // 못 읽으면 이름 없이 둔다
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
        String[] w = weatherParts();                                   // ① 날씨 · ② 애니메이션(장면) · ③ 길동무 친구들 — 세 칸으로 나눈다
        JSONArray wk = new JSONArray();
        JSONObject wl = tx(w[0], 15, true, "text", w[1].isEmpty() ? 0 : 3);                    // 날씨 박스: "아라동 7도예요. 맑아요."
        put(wl, "hl", hl(w[0], w[2], w[3]));
        wk.put(wl);
        if (!w[1].isEmpty()) wk.put(tx(w[1], 11, false, "sub", 0));
        body.put(nd("panel", "pad", pad(12, 8, 12, 0), "ip", pad(14, 12, 14, 12), "kids", wk));
        body.put(nd("lth", "s", "길동무 길거리", "dot", "#34c759", "live", true, "pad", pad(16, 12, 16, 2)));
        String sc = sceneOut(now);
        if (!sc.isEmpty()) {
            int sh = viewDp > 0 ? Math.max(200, Math.min(720, viewDp - 335)) : 420;   // 고정 높이(viewDp = 본문 칸 높이) — 아래 글 줄 수가 바뀌어도 장면이 다시 만들어지지 않는다
            body.put(nd("scene", "h", sh, "r", 16, "pad", pad(12, 6, 12, 6), "sc", sc));
        } else {
            JSONArray ph = new JSONArray();
            ph.put(tx("해변을 불러오는 중이에요…", 12, true, "sub", 0));
            body.put(nd("panel", "pad", pad(12, 6, 12, 6), "ip", pad(14, 40, 14, 40), "kids", ph));
        }
        body.put(nd("button", "s", "🎨 길동무 친구들 꾸미기", "act", callAct("kid.dress"), "h", 44, "size", 13, "bold", true,
                "fill", "card", "line", "border", "tc", "text", "r", 16, "pad", pad(12, 2, 12, 2)));
        body.put(nd("lth", "s", "길동무 친구들과 놀기", "dot", "#34c759", "live", true, "pad", pad(16, 10, 16, 4)));
        JSONArray kids = new JSONArray();
        ArrayList<F> g = new ArrayList<F>();                            // 지금 화면에 나와 있는 친구(장면이 알려 준다) · 나머지는 쉬는 중
        ArrayList<F> rest = new ArrayList<F>();
        String shownNow = Poke.shown();
        for (int i = 0; i < fs.size(); i++) (shownNow.indexOf("," + fs.get(i).id + ",") >= 0 ? g : rest).add(fs.get(i));
        if (g.isEmpty()) {
            kids.put(tx("🤝 같이 놀아요 — 친구들이 모이는 중이에요", 12, true, "text", 5));
        } else {
            StringBuilder sb = new StringBuilder("🤝 같이 놀아요 — ");
            String[] nm = new String[g.size()];
            for (int i = 0; i < g.size(); i++) {
                F f = g.get(i);
                nm[i] = f.name;
                sb.append(i > 0 ? ", " : "").append(f.name).append(stateTag(stateOf(f, now)));
            }
            kids.put(tx(sb.toString(), 12, true, "text", 5, nm));
        }
        if (!rest.isEmpty()) {
            StringBuilder sb = new StringBuilder("💤 친구들이 휴식 중이에요 — ");
            for (int i = 0; i < rest.size(); i++) sb.append(i > 0 ? ", " : "").append(rest.get(i).name);
            kids.put(tx(sb.toString(), 12, false, "sub", 5));
        }
        kids.put(tx("💡 친구를 콕 누르면 응가 치우기·식사·공부·잠자기 메뉴가 나와요", 10, false, "sub", 6));
        body.put(nd("panel", "pad", pad(12, 0, 12, 14), "ip", pad(14, 12, 14, 8), "fillRest", true, "kids", kids));
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

    private static JSONObject btnRow(String[][] items, int padB) {
        JSONArray k = new JSONArray();
        for (int i = 0; i < items.length; i++) {
            k.put(nd("button", "s", items[i][0], "act", callAct(items[i][1]), "h", 40, "size", 12, "bold", true,
                    "fill", "card", "line", "border", "tc", "text", "r", 14));
        }
        return nd("row", "gap", 8, "pad", pad(12, 0, 12, padB), "kids", k);
    }

    /** 날씨 한 줄(크게)과 작은 안내 — 장면 답(look)에 든 값을 아이콘과 글로 옮길 뿐이다. */
    private String[] weatherParts() {
        boolean stale = !Double.isNaN(lat) && (!loc || lastNow - fixT > 1800000L);
        try {
            JSONObject l = new JSONObject(sceneJson).optJSONObject("look");
            if (l != null && l.optBoolean("wxKnown", false) && !l.isNull("temp")) {
                String wk = l.optString("wk", "clear");
                String ic = "rain".equals(wk) ? "🌧️" : "snow".equals(wk) ? "❄️" : "fog".equals(wk) ? "🌫️" : "overcast".equals(wk) ? "☁️" : "cloudy".equals(wk) ? "⛅" : "☀️";
                int wd = l.optInt("wind", 0);
                StringBuilder sub = new StringBuilder();
                sub.append(wd >= 2 ? "💨 바람이 세요" : wd == 1 ? "🍃 바람이 불어요" : "🍃 바람이 잔잔해요");
                sub.append(" · ").append(l.optBoolean("hot", false) ? "🥵 더워요" : l.optBoolean("cold", false) ? "🥶 추워요" : "😊 지내기 좋아요");
                if (stale) sub.append(" · 마지막으로 잡은 위치 기준");
                String say = "rain".equals(wk) ? "비가 와요" : "snow".equals(wk) ? "눈이 와요" : "fog".equals(wk) ? "안개가 꼈어요" : "overcast".equals(wk) ? "흐려요" : "cloudy".equals(wk) ? "구름이 조금 있어요" : "clear".equals(wk) ? "맑아요" : l.optString("wxKo", "");
                String dn = dong.isEmpty() ? "" : dong, tp = l.optInt("temp") + "도";
                String head = ic + " " + (dn.isEmpty() ? "" : dn + " ") + tp + "예요. " + say + ".";
                return new String[] {head, sub.toString(), dn, tp};
            }
        } catch (Exception e) {
            // 아래 기본 글
        }
        if (Double.isNaN(lat)) return new String[] {"📍 위치를 켜면 날씨를 알려줘요", "설정에서 위치 공유를 켜 주세요", "", ""};
        return new String[] {"⛅ 날씨를 불러오는 중이에요", "", "", ""};
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
        String r = remGet("chat");
        return r.isEmpty() ? chatLocal() : r;
    }

    private String chatLocal() {
        JSONArray a = new JSONArray();
        a.put(b("head", "text", "가족대화"));
        JSONArray k1 = new JSONArray();
        k1.put(b("text", "text", "글자만 보낼 수 있어요. 대화는 7일이 지나면 지워져요.", "sub", "1", "tight", "1"));
        if (chat.length() == 0) {
            k1.put(b("text", "text", "아직 대화가 없어요. 부모님이 연결되면 여기서 이야기할 수 있어요.", "sub", "1", "tight", "1"));
        }
        JSONObject bx1 = b("box", "flush", "1");
        put(bx1, "kids", k1);
        a.put(bx1);
        JSONArray k2 = new JSONArray();
        SimpleDateFormat fmt = new SimpleDateFormat("M/d a h:mm", Locale.KOREA);
        for (int i = 0; i < chat.length(); i++) {
            JSONObject m = chat.optJSONObject(i);
            if (m == null) continue;
            k2.put(b("msg", "text", m.optString("x"), "me", String.valueOf(m.optInt("m", 1)),
                    "time", fmt.format(new Date(m.optLong("t", 0L)))));
        }
        k2.put(b("input", "hint", "메시지를 입력해요", "act", "chat.send"));
        JSONObject bx2 = b("box", "fill", "1", "flush", "1");
        put(bx2, "kids", k2);
        a.put(bx2);
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
            a.put(b("qr", "text", "https://gildongmu-kids.phg0643.workers.dev/q?k=" + pairCode));
            a.put(b("text", "text", "비밀키  " + pairCode, "big", "1"));
            a.put(b("text", "text", "부모님 길동무 앱에서 QR을 찍거나 비밀키를 넣어요. 10분 안에 써야 해요.", "sub", "1"));
        } else {
            a.put(b("text", "text", "부모님의 길동무 앱과 QR이나 비밀키로 연결하면, 연결한 부모님만 내 위치를 볼 수 있어요.", "sub", "1"));
        }
        JSONArray it = new JSONArray();
        it.put(b("i", "label", pairCode.isEmpty() ? "연결 QR 만들기" : "새 QR 만들기", "act", "pair.new", "on", "1"));
        if (linked > 0) it.put(b("i", "label", "연결 모두 끊기", "act", "pair.unlink", "on", "0"));
        JSONObject bt = b("btns");
        put(bt, "items", it);
        a.put(bt);
        a.put(b("text", "text", pairErr.isEmpty() ? (linked > 0 ? "연결된 부모님 " + linked + "명이 내 위치를 볼 수 있어요." : "아직 연결된 부모님이 없어요. 연결되기 전에는 위치가 서버에 저장되지 않아요.") : "서버에 연결하지 못했어요. 잠시 뒤에 다시 눌러 주세요.", "sub", "1"));
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
            if (consented()) tab = v.substring(4);
            remAskT = 0L;
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
            kidUnlink();
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
            kidPair();
        } else if (v.equals("pair.unlink")) {
            kidUnlink();
        } else if (v.equals("chat.send")) {
            String s = arg == null ? "" : arg.trim();
            if (s.length() > CHAT_MAX_LEN) s = s.substring(0, CHAT_MAX_LEN);
            if (!s.isEmpty()) {
                chatPatch(s, now);
                kidAct("chat.send", s);
            }
        } else if (v.startsWith("quest.tab:")) {
            questTab = v.substring(10).equals("p") ? "p" : "c";
            remAskT = 0L;
        } else if (v.startsWith("quest.done:")) {
            kidAct(v, "");
        } else if (v.equals("quest.send")) {
            String s = arg == null ? "" : arg.trim();
            if (s.length() > 100) s = s.substring(0, 100);
            if (!s.isEmpty()) kidAct("quest.send", s);
        } else if (v.startsWith("trip.")) {          // 장소 알림: 확인(끄기) · 출발 · 도착 확인 — 눌린 즉시 화면이 바뀌고, 서버에는 바로 알린다
            if (v.startsWith("trip.ok:")) {
                promptShut = true;
            } else if (v.startsWith("trip.go:")) {
                promptShut = true;
                noticeTxt = promptName + "에 도착하면 포인트가 쌓여요";
                noticeUntil = now + 5000L;
            }
            kidAct(v, "");
        } else if (v.equals("kid.dress")) {
            dressOpen = true;
            if (dressSel.isEmpty() && !fs.isEmpty()) dressSel = fs.get(0).id;
        } else if (v.startsWith("dress.sel:")) {
            dressSel = find(v.substring(10)).id;
        } else if (v.startsWith("dress.tab:")) {
            String tb = v.substring(10);
            if (tb.equals("hat") || tb.equals("cloth") || tb.equals("item")) dressTab = tb;
        } else if (v.equals("dress.close")) {
            if (!dressOpen && !promptId.isEmpty()) promptShut = true;
            dressOpen = false;
        } else if (v.startsWith("kid.pick:")) {
            String[] p = v.substring(9).split(":");
            if (p.length == 2) pickFor(find(p[0]), p[1], now);
        } else if (v.equals("home.play")) {
            groupSet(now, "play", 60000L);
        } else if (v.equals("home.study")) {
            groupSet(now, "study", STUDY_MS);
        } else if (v.equals("home.sleep")) {
            groupSet(now, "sleep", SLEEP_MS);
        } else if (v.equals("home.feed")) {
            ArrayList<F> g = onScreen();
            for (int i = 0; i < g.size(); i++) feedOne(g.get(i), now);
        } else if (v.equals("home.clean")) {
            ArrayList<F> g = onScreen();
            for (int i = 0; i < g.size(); i++) {
                F f = g.get(i);
                f.poop = 0;
                f.poopNeg = false;
                f.poopSince = 0L;
                recover(f, now);
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
            feedOne(find(sel), now);
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
        boolean own = linked > 0 && cheers.length() > 0;      // 부모가 만든 응원문구가 있으면 그것으로 흐른다
        if (own) {
            l.clear();
            for (int ci = 0; ci < cheers.length(); ci++) {
                String cx = cheers.optString(ci, "");
                if (!cx.isEmpty()) l.add(cx);
            }
            if (l.isEmpty()) own = false;
        }
        if (!own) l = new ArrayList<String>(java.util.Arrays.asList(HOPE[s]));
        long day = (now + java.util.TimeZone.getDefault().getOffset(now)) / 86400000L;
        if (!own) Collections.shuffle(l, new Random(day * 7L + s));
        JSONArray m = new JSONArray();
        for (int i = 0; i < l.size(); i++) m.put(l.get(i));
        JSONArray body = new JSONArray();
        body.put(nd("marq", "h", 26, "pad", pad(8, 4, 8, 5), "msgs", m, "pass", 16000, "grad", 6000, "line", true));
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
        if (sceneJson.isEmpty()) return true;
        if (!sceneWx && !Double.isNaN(lat)) return true;      // 위치를 잡았는데 날씨가 아직 없으면 바로 다시 묻는다
        return now / 600000L != sceneGotT / 600000L;
    }

    synchronized void sceneAsked(long now) {
        sceneAskT = now;
    }

    synchronized boolean hasFix() {
        return !Double.isNaN(lat);
    }

    /** 가장 최근에 잡은 정확한 위치(위치 권한이 꺼졌거나 못 잡는 중이어도 마지막 값을 쓴다). 한 번도 못 잡았으면 null — 임의의 도시로 정하지 않는다. */
    synchronized double[] where() {
        return Double.isNaN(lat) ? null : new double[] {lat, lng};
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
        try {
            JSONObject lk = new JSONObject(json).optJSONObject("look");
            sceneWx = lk != null && lk.optBoolean("wxKnown", false);
        } catch (Exception e) {
            sceneWx = false;
        }
    }

    /** 장면·날씨를 물을 때 보낼 글 — 날씨를 묻는 이 순간에만 위치를 약 5km 칸으로 뭉갠다. 저장·부모 전달용 위치는 그대로 둔다. 위치를 모르면 좌표를 아예 보내지 않는다. */

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
        if (w != null) {
            put(o, "lat", Math.round(w[0] * 20.0) / 20.0);
            put(o, "lng", Math.round(w[1] * 20.0) / 20.0);
        }

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

    // ───────── 화면에 나온 친구 · 상태 · 장면 동작 ─────────
    /** 지금 장면에 나온 친구들(장면을 아직 못 받았으면 모두). */
    private ArrayList<F> onScreen() {
        ArrayList<F> r = new ArrayList<F>();
        try {
            if (!sceneJson.isEmpty()) {
                JSONObject o = new JSONObject(sceneJson);
                JSONArray c = o.optJSONArray("cast");
                if (c != null) {
                    for (int i = 0; i < c.length(); i++) {
                        String id = c.optString(i);
                        for (int j = 0; j < fs.size(); j++) if (fs.get(j).id.equals(id) && !r.contains(fs.get(j))) r.add(fs.get(j));
                    }
                }
            }
        } catch (Exception e) {
            r.clear();
        }
        if (r.isEmpty()) r.addAll(fs);
        return r;
    }

    private static String stateTag(String st) {
        if ("study".equals(st)) return "📖";
        if ("sleep".equals(st)) return "😴";
        if ("beg".equals(st)) return "🍚";
        if ("poop".equals(st)) return "💩";
        if ("sick".equals(st)) return "🤒";
        if ("sulk".equals(st) || "angry".equals(st) || "wake".equals(st)) return "😤";
        return "";
    }

    private String stateOf(F f, long now) {
        if (f.sick) return "sick";
        if (f.angerUntil > now) return "sleep".equals(f.tm) ? "wake" : "angry";
        if (f.sulkUntil > now) return "sulk";
        if (!f.tm.isEmpty() && (f.tm.equals("study") || f.tm.equals("sleep") || f.tm.equals("play") || f.tm.equals("eat"))) return f.tm;
        if (f.hunger >= BEG_AT) return "beg";
        if (f.poop > 0) return "poop";
        return "ok";
    }

    private static String[] actsFor(String st) {
        if ("angry".equals(st)) return new String[] {"kangry", "rest", "kangry"};
        if ("wake".equals(st)) return new String[] {"kwake", "rest", "kwake"};
        if ("study".equals(st)) return new String[] {"kstudy", "kstudy", "rest", "kstudy"};
        if ("sleep".equals(st)) return new String[] {"ksleep", "ksleep", "ksleep"};
        if ("play".equals(st)) return new String[] {"walk", "kplay", "walk", "kplay", "hop"};
        if ("eat".equals(st)) return new String[] {"keat", "keat"};
        if ("beg".equals(st)) return new String[] {"kbeg", "rest", "kbeg", "walk"};
        if ("sulk".equals(st)) return new String[] {"ksulk", "rest", "ksulk"};
        if ("sick".equals(st)) return new String[] {"ksick", "rest", "ksick"};
        if ("poop".equals(st)) return new String[] {"walk", "kpoop", "walk", "walk", "kpoop"};
        return null;
    }

    private String studyCsv(long now) {
        StringBuilder sb = new StringBuilder(",");
        for (int i = 0; i < fs.size(); i++) {
            String s = stateOf(fs.get(i), now);
            if ("study".equals(s) || "angry".equals(s)) sb.append(fs.get(i).id).append(',');
        }
        return sb.toString();
    }

    private String sleepCsv(long now) {
        StringBuilder sb = new StringBuilder(",");
        for (int i = 0; i < fs.size(); i++) {
            String s = stateOf(fs.get(i), now);
            if ("sleep".equals(s) || "wake".equals(s)) sb.append(fs.get(i).id).append(',');
        }
        return sb.toString();
    }

    /** 장면은 서버가 준 값 그대로(친구 모두가 늘 나온다). 친구들의 지금 상태(공부·잠·밥·응가…)는 Poke 로 따로 건네서 그림이 이어진다 — 글이 바뀌어도 장면이 다시 만들어지지 않는다. */
    /** 밤 방(0~6) 번호. 누군가 밤 일과로 자는 중이면 그날 밤의 방, 아니면 -1. 자정을 넘겨도 같은 밤은 같은 방이다. */
private int roomOf(long now) {
boolean night = false;
for (int i = 0; i < fs.size(); i++) {
if (wakeAt(fs.get(i), now) != 0L) {
night = true;
break;
}
}
if (!night) return -1;
long loc = now + tzOf(now), day = loc / DAY_MS;
if ((int) ((loc % DAY_MS) / 60000L) < SLEEP_AT_MIN) day--;
return (int) (((day % 7L) + 7L) % 7L);
}

private boolean napping(long now) {
for (int i = 0; i < fs.size(); i++) {
F f = fs.get(i);
if ("sleep".equals(f.tm) && f.tmUntil > now) return true;
}
return false;
}

private String holdPlace = "";

private String basePlace() {
try {
JSONObject lk = new JSONObject(sceneJson).optJSONObject("look");
return lk == null ? "" : lk.optString("place", "");
} catch (Exception e) {
return "";
}
}

/** 잠자는 동안 장면의 장소를 정한다. 밤에는 집 안 방, 낮잠 중에는 지금 장소를 붙잡아 둔다 — 장소가 바뀌면 친구들이 걸어 나가며 잠이 깨기 때문이다. 해당 없으면 null(서버 장소 그대로). */
private String sceneRoom(long now) {
int r = roomOf(now);
if (r >= 0) {
holdPlace = "";
return "kroom" + r;
}
if (napping(now)) {
if (holdPlace.isEmpty()) holdPlace = basePlace();
return holdPlace.isEmpty() ? null : holdPlace;
}
holdPlace = "";
return null;
}

private String sceneOut(long now) {
        if (sceneJson.isEmpty()) return "";
        final String rmP = sceneRoom(now);
String key = sceneGotT + "|" + (rmP == null ? "" : rmP);
        if (key.equals(drawKey)) return drawJson;
        String out = sceneJson;
        try {
            JSONObject o = new JSONObject(sceneJson);
            JSONArray c = new JSONArray();
            for (int i = 0; i < CAST.length; i++) c.put(CAST[i][0]);
            o.put("cast", c);
if (rmP != null) {
JSONObject lk = o.optJSONObject("look");
if (lk == null) {
lk = new JSONObject();
o.put("look", lk);
}
lk.put("place", rmP);
}
            out = o.toString();
        } catch (Exception e) {
            out = sceneJson;
        }
        drawKey = key;
        drawJson = out;
        return out;
    }

    private String statesCsv(long now) {
        StringBuilder sb = new StringBuilder(";");
        for (int i = 0; i < fs.size(); i++) {
            F f = fs.get(i);
            sb.append(f.id).append(':').append(stateOf(f, now)).append(':').append(f.poop).append(';');
        }
        return sb.toString();
    }

    /** 장면에서 친구를 짧게 눌러 고른 일(응가 치우기 · 식사 · 공부 · 잠자기). */
    private void pickFor(F f, String what, long now) {
        if ("clean".equals(what)) {
            f.poop = 0;
            f.poopNeg = false;
            f.poopSince = 0L;
            recover(f, now);
        } else if ("feed".equals(what)) {
            feedOne(f, now);
        } else if ("study".equals(what) || "sleep".equals(what)) {
            if (f.sick || f.sulkUntil > now || wakeAt(f, now) != 0L) return;
            boolean st = "study".equals(what);
            setTm(f, what, now + (st ? STUDY_MS : SLEEP_MS));
            f.nextLong = now + 8L * 60L * 1000L;
        }
    }

    /** 앱이 알려 주는 본문 칸 높이(dp). 장면 높이를 정하는 데만 쓴다. */
    synchronized void setView(int dp) {
        if (dp > 0 && Math.abs(dp - viewDp) > 4) {
            viewDp = dp;
            rev++;
        }
    }

    /** 화면에 나온 친구 중 쉴 수 있는 친구들에게 같은 행동(같이 놀기·공부·잠)을 시킨다. */
    private void groupSet(long now, String m, long ms) {
        ArrayList<F> g = onScreen();
        for (int i = 0; i < g.size(); i++) {
            F f = g.get(i);
            if (f.sick || f.sulkUntil > now || wakeAt(f, now) != 0L) continue;
            setTm(f, m, now + ms);
            if (!"play".equals(m)) f.nextLong = now + 8L * 60L * 1000L;
        }
    }

    /** 장면에서 공부 중인 친구를 건드렸다(엔진 스레드에서 부른다). */
    synchronized void angered(String id, long now) {
        for (int i = 0; i < fs.size(); i++) {
            if (fs.get(i).id.equals(id)) {
                fs.get(i).angerUntil = now + ANGRY_MS;
                lastNow = now;
                String sg = sig();
                if (!sg.equals(lastSig)) {
                    lastSig = sg;
                    rev++;
                }
                return;
            }
        }
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

    // ───────── 3초 꾹 인사(어린이 눈높이) ─────────
    /** 친구 여덟의 차례: open.json 의 chars 와 같다. */
    private static final String[] HI_CH = {"dolsom", "lovel", "dudung", "sul", "ppopu", "chaeng", "juksun", "bbosong"};
    /** 시간 칸(open.json slots 의 id)마다 여덟 친구의 인사 — 길동무(어른)와 달리 아이에게 건네는 말(학교 · 양치 · 손 씻기 · 놀이). */
    private static final String[][] HI = {
        {"greet", "일어났니? 안녕!", "좋은 아침이야!", "오늘도 안녕~", "해님이 떴어요!", "아침밥 먹자!", "세수하고 놀자!", "기지개 쭈욱~", "오늘 뭐 할까?"},
        {"morning", "학교 가자! 멍멍", "씩씩하게 가자냥", "열심히 배우자!", "힘차게 출발!", "오늘도 신나게!", "친구 만나러 가자", "천천히 안전하게", "차 조심! 손 번쩍"},
        {"lunch", "밥 먹자! 멍멍!", "냠냠 맛있냥!", "골고루 먹어요", "손 씻고 냠냠!", "맛있게 먹자!", "배고파 꼬르륵", "대나무도 냠냠", "남기지 말기!"},
        {"afternoon", "같이 놀자! 멍멍", "놀이터 가자냥", "흙놀이 최고!", "바람 타고 슝~", "간식 먹을까?", "첨벙첨벙 놀자!", "숙제 다 했니?", "오늘 뭐 배웠어?"},
        {"evening", "오늘 재밌었어?", "발 씻고 쉬자냥", "저녁 먹자!", "노을이 예뻐요", "엄마 아빠 안녕!", "오늘도 최고야!", "맛있는 저녁~", "꼭 안아 주자!"},
        {"night", "양치하자! 멍멍", "동화책 읽자냥", "별이 반짝반짝", "달님 안녕~", "이 닦고 코~", "뽀득뽀득 목욕!", "포근 이불 속~", "잘 준비 해요~"},
        {"sleep", "쿨쿨… 잘 자", "그르릉… 잘 자", "음냐… 잘 자", "푸드덕… 잘 자", "새근… 잘 자", "뽀글… 잘 자", "쿨쿨… 좋은 꿈", "으음… 잘 자"},
    };

    /** 시간 칸 id → {친구 id → 인사 글}. 모르는 칸이면 null(앱은 아무것도 안 한다). */
    static HashMap<String, String> helloSay(String slot) {
        for (String[] row : HI) {
            if (row[0].equals(slot)) {
                HashMap<String, String> m = new HashMap<String, String>();
                for (int i = 0; i < HI_CH.length; i++) m.put(HI_CH[i], row[i + 1]);
                return m;
            }
        }
        return null;
    }
}
