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
    static final long LOC_MOVING_MS = 180000L;          // p-kids53(YJ): 자녀가 움직인다고 판단(GPS 이동 발생)하면 3분마다 위치를 확인한다
    static final double MOVE_M = 60.0;                  // 이어진 두 위치가 이만큼(m) 이상(그리고 오차의 1.5배 이상) 떨어지면 '움직임'
    static final long MOVE_GAP_MS = 12 * 60000L;        // 두 위치 사이가 이보다 길면(꺼졌다 켜짐 등) 움직임을 판단하지 않는다
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
        {"ppopu", "뽀푸", "0"}, {"dolsom", "둘숑", "0"}, {"lovel", "러블", "0"}, {"chaeng", "챙챙", "3"},
        {"sul", "독슐", "2"}, {"dudung", "두덩", "1"}, {"bbosong", "히뽀", "4"}, {"juksun", "죽순", "4"}
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
        long joinUntil;                    // 같이 놀기(모이기) 부름에 응해 모여 있는 때까지(자던 친구도 깨어 모인다)
        boolean joinSleepy;                // 졸린 채로 모였다(자다가 불려 나온 친구) — 장면이 졸린 말을 한다
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
    private volatile int watchW = 0;                         // s393: 부모가 지금 보고 있어서 서버가 정해 준 보고 주기 종류(1 = 2.5초 · 2 = 10초 · 3 = 15초 · 0 = 원래대로)
    private volatile long watchUntil = 0L;                  // 이 시각까지만 유효(서버 응답이 없으면 스스로 풀린다 — 배터리 보호)
    private volatile int battPct = -1;                      // s392: 폰 배터리 %(모르면 -1) · 충전 중 — 위치와 함께 서버에 보낸다(서버가 '배터리 낮음' 알림을 판단)
    private volatile boolean battChg = false;
    private long lastFixT = 0L;
    private double mvLa = Double.NaN, mvLo = Double.NaN;      // 움직임 판단용 바로 앞 위치
    private float mvAcc = 0f;
    private long mvT = 0L;
    private boolean moving = false;
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
    private String callK = "", callText = "";          // 긴급 호출 · 데리러 와줘 의 지금 상태(서버가 정한 글) — 부모가 확인하면 바뀐다
    private int callSt = -1;
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
    private String dongFull = "";                                          // 부모에게 보내는 "인천시 아라1동"(시 + 동) — 홈의 날씨 글은 동만 쓴다
    private double dongLa = Double.NaN, dongLo = Double.NaN;
    private long dongTryAt = 0L;
    private boolean dressOpen = false;
    private int mg = 0;                 // 관리 창: 0 닫힘 · 1 비밀번호 정하기 · 2 한 번 더 · 3 비밀번호 넣기 · 4 열림
    private String mgTmp = "";
    private String mgErr = "";
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
        Dress.I.restore(s.get("wear", ""));           // 꾸미기: 입은 것은 앱을 껐다 켜도 이어진다(바뀔 때마다 바로 저장)
        Dress.I.setOnChange(new Runnable() {
            @Override
            public void run() {
                store.put("wear", Dress.I.export());
                WearImg.warmAll();                    // 꾸민 모습에 필요한 시트를 미리 읽어 둔다(친구가 나올 때 시트가 읽히는 사이 그림이 바뀌지 않게)
            }
        });
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
        return "1".equals(store.get("consent2", "0"));
    }

    synchronized String tab() {
        return tab;
    }

    synchronized int rev() {
        return rev;
    }

    /** 위치 보내는 주기 — 계산은 엔진이: 움직이는 중이면 3분, 가만히 있으면 5분. */
    synchronized long locIntervalMs() {
        if (watchW > 0 && System.currentTimeMillis() < watchUntil) return watchW == 1 ? 2500L : (watchW == 2 ? 10000L : 15000L);      // 부모가 보는 동안(서버가 정한 대로)
        return moving ? LOC_MOVING_MS : LOC_INTERVAL_MS;
    }

    /** 지금 움직이는 중인가(바로 앞 위치와 비교해 판단한 값). */
    synchronized boolean isMoving() {
        return moving;
    }

    /** 이어진 두 위치로 움직임을 판단한다 — 거리 ≥ max(60m, 오차 1.5배). 사이가 너무 길면 판단하지 않고 가만히 있는 것으로 본다. */
    private void judgeMove(double la, double lo, float acc, long t) {
        boolean mv = false;
        if (!Double.isNaN(mvLa) && mvT > 0L && t > mvT && t - mvT <= MOVE_GAP_MS) {
            double d = moveDist(mvLa, mvLo, la, lo), thr = Math.max(MOVE_M, 1.5 * Math.max(acc, mvAcc));
            mv = d >= thr;
        }
        moving = mv;
        mvLa = la;
        mvLo = lo;
        mvAcc = acc;
        mvT = t;
    }

    private static double moveDist(double a1, double o1, double a2, double o2) {
        double r = 6371000.0, p1 = Math.toRadians(a1), p2 = Math.toRadians(a2), dp = p2 - p1, dl = Math.toRadians(o2 - o1);
        double h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
        return 2 * r * Math.asin(Math.min(1.0, Math.sqrt(h)));
    }

    synchronized boolean locOn() {
        return loc && consented();
    }

    /** 동의를 마쳤다는 사실(버전만)을 서버에 한 번 알린다 — 동의 증빙. 통신이 안 되면 다음 위치 보고 때 다시 시도한다. */
    private void sendConsent() {
        if (!"1".equals(store.get("consent2", "0")) || "1".equals(store.get("cons2sent", "0"))) return;
        if (!ensureReg()) return;
        String r = Kid.call("POST", "/c/consent", "{\"v\":2}", cid, csec);
        if (r != null && r.contains("\"ok\":true")) store.put("cons2sent", "1");
    }

    /** 부모님이 지금 내 위치를 보고 있나 — 서버가 정한 값(w)을 그대로 따른다. 서버 응답이 90초 넘게 없으면 저절로 꺼진다. */
    synchronized boolean watched() {
        return watchW > 0 && System.currentTimeMillis() < watchUntil;
    }

    /** 부모가 보기 시작했다는 푸시(watch)를 받았다 — 서버 응답이 올 때까지 90초 동안 빠른 주기. 이후엔 위치 보고 응답의 w 가 정한다. */
    void watchOn() {
        setWatch(1);
    }

    /** 서버가 정한 보고 주기 종류(w)를 받는다. 0 이면 보는 사람이 없는 것. */
    private void setWatch(int w) {
        watchW = w < 0 || w > 3 ? 0 : w;
        watchUntil = watchW > 0 ? System.currentTimeMillis() + 90000L : 0L;
    }

    private void watchFrom(String r) {
        if (r == null || r.isEmpty()) return;                      // 통신이 안 됐다 — 있던 상태는 시간이 지나면 저절로 풀린다
        try {
            setWatch(new JSONObject(r).optInt("w", 0));
        } catch (Exception e) {
            // 모양이 이상하면 건너뛴다
        }
    }

    /** 위치 서비스가 읽은 배터리 값을 받아 둔다(판단은 서버). */
    void setBattery(int pct, boolean charging) {
        battPct = pct;
        battChg = charging;
    }

    /** 위치 공유를 켜고 껐다는 사실을 서버에 알린다(서버가 부모에게 알리고, 끈 동안은 '위치 끊김' 알림을 멈춘다). */
    private void shareTell(final boolean on) {
        if (!consented()) return;
        Wire.EX.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    if (!ensureReg()) return;
                    JSONObject o = new JSONObject();
                    o.put("on", on ? 1 : 0);
                    Kid.call("POST", "/c/share", o.toString(), cid, csec);
                } catch (Exception e) {
                    // 다음에 다시 알린다
                }
            }
        });
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
        judgeMove(la, lo, acc, t);
        if (locOn() && dongDue(t)) {                                // 앱이 꺼져 있어도(위치 서비스만 돌 때) 동네 이름을 새로 받은 뒤에 보낸다 — 옛 동네 이름이 가지 않게
            dongTryAt = t;
            final String url = dongUrl();
            if (!url.isEmpty()) {
                final double fla = la, flo = lo;
                final float facc = acc;
                final long ft = t;
                Wire.EX.execute(new Runnable() {
                    @Override
                    public void run() {
                        String r = Wire.get(url, 6000);
                        if (r != null) setDong(r, fla, flo);
                        synchronized (Engine.this) {
                            kidLoc(fla, flo, facc, ft);
                        }
                    }
                });
                return;
            }
        }
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

    /** 긴급 호출 · 데리러 와줘 가 열려 있으면 서버가 정한 상태 글("부모님께 알렸어요" · "부모님이 확인했어요" · "부모님이 데리러 가고 있어요"), 없으면 "". */
    synchronized String callText() {
        return callText;
    }

    /** 열려 있는 호출 종류("sos" · "pick"), 없으면 "". */
    synchronized String callKind() {
        return callK;
    }

    /** maxAgeMs 안에 잡힌 지금 위치 [위도, 경도], 없으면 null(공유를 껐어도 긴급 호출에는 쓴다 — 아이가 직접 누른 일이다). */
    synchronized double[] fixNow(long maxAgeMs) {
        if (Double.isNaN(lat) || Double.isNaN(lng) || fixT <= 0L || System.currentTimeMillis() - fixT > maxAgeMs) return null;
        return new double[] {lat, lng};
    }

    /** 긴급 호출 · 안전하게 도착 · 데리러 와줘 를 서버에 보낸 결과(뒤 스레드에서 불린다). */
    interface CallCb {
        void done(boolean ok, int linked, boolean dup);
    }

    /**
     * 자녀가 누른 일을 서버(/c/call)에 알린다. kind: "sos"(긴급 호출) · "pick"(데리러 와줘) · "arr"(안전하게 도착). cancel 은 sos · pick 취소.
     * 서버가 알림 · 기록 · 장소 이름을 정한다(앱은 누른 일과 지금 위치만 보낸다). 연결이 안 되면 ok=false.
     */
    void callSend(final String kind, final boolean cancel, final CallCb cb) {
        if (!consented()) {
            if (cb != null) cb.done(false, -1, false);
            return;
        }
        final double[] fx = fixNow(10 * 60000L);
        Wire.EX.execute(new Runnable() {
            @Override
            public void run() {
                boolean ok = false;
                int linked = -1;
                boolean dup = false;
                try {
                    if (ensureReg()) {
                        JSONObject o = new JSONObject();
                        o.put("k", kind);
                        if (cancel) o.put("op", "cancel");
                        if (fx != null) {
                            o.put("la", fx[0]);
                            o.put("lo", fx[1]);
                        }
                        String r = Kid.call("POST", "/c/call", o.toString(), cid, csec);
                        if (r != null) {
                            JSONObject j = new JSONObject(r);
                            ok = j.optBoolean("ok", false);
                            linked = j.optInt("linked", -1);
                            dup = j.optInt("dup", 0) == 1;
                        }
                    }
                } catch (Exception e) {
                    ok = false;
                }
                if (cb != null) cb.done(ok, linked, dup);
            }
        });
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
        Poke.setSleepy(sleepyCsv(now));
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
        if (!(k.equals("eat") || k.equals("clean") || k.equals("drop") || k.equals("psleep") || k.equals("pstudy") || k.equals("pplay"))) return;           // 자녀가 직접 누른 일만(재우기 · 공부 시키기 · 놀게 하기 포함 — 친구들 스스로의 놀기 · 공부 · 잠 · 응가는 알리지 않는다)
        long t = lastNow;
        String key = k + name;
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

    /** 자녀가 친구를 공중에서 떨어뜨렸다(장면 스레드에서 부른다). 땅에서 놓은 것은 세지 않는다. */
    synchronized void dropEv(String id, double lift) {
        if (lift < 24.0) return;
        for (int i = 0; i < fs.size(); i++) {
            if (fs.get(i).id.equals(id)) {
                kidEv("drop", fs.get(i).name);
                return;
            }
        }
    }

    private void setTm(F f, String m, long until) {
        if ("eat".equals(m)) kidEv(m, f.name);                                              // 밥은 자녀가 줄 때만 setTm 이 불린다 — 공부 · 잠 · 놀기는 친구들이 스스로도 하므로 자녀가 누른 자리에서 따로 알린다
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
                .append(store.get("cp2", "0")).append(store.get("cc2", "0")).append(loc ? 1 : 0)
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
                boolean waits = f.poop > 0 || m == 1; // 밥을 줄 때까지 · 응가를 치울 때까지는 제자리에서 기다린다
                if (m == 0 && !waits) mode = "walk";
                else if (cell >= 0) mode = "cell";
                else if (waits || m == 3 || m == 4 || m == 7) mode = "still";
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
                        remGot("chat", Kid.call("GET", "/c/screen?tab=chat" + (fg ? "&fg=1" : ""), null, cid, csec));       // fg=1: 앞에서 대화 탭을 보는 중 = 부모 글을 읽는 중(서버가 읽음으로 적는다)
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
            JSONObject cl = o.optJSONObject("call");
            callK = cl == null ? "" : cl.optString("k", "");
            callSt = cl == null ? -1 : cl.optInt("st", -1);
            callText = cl == null ? "" : cl.optString("text", "");
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
                String r = Kid.callT("GET", "/c/wait?since=" + svRev + "&fg=1&tab=" + t + "&qt=" + ("p".equals(questTabNow()) ? "p" : "c"), null, cid, csec, 24000);
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
            if (o.has("linked")) {
                int nl = o.optInt("linked", linked);
                boolean first = linked <= 0 && nl > 0;
                linked = nl;
                if (first) kidLocNow();                              // 부모와 막 연결됐다 — 다음 위치 소식을 기다리지 않고 마지막으로 알던 자리를 바로 보낸다
            }
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
            n.put(b("msg", "text", s, "me", "1", "un", "1", "time", new SimpleDateFormat("M/d a h:mm", Locale.KOREA).format(new Date(now))));
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
    private double fixLa = Double.NaN, fixLo = Double.NaN;
    private float fixAcc = 0f;
    private boolean locPending = false;

    /** 부모와 연결되는 순간: 연결 전에는 서버가 위치를 저장하지 않으므로, 마지막으로 잡은 위치를 곧바로 한 번 올린다(없으면 다음 위치를 막힘 없이 바로 올린다). */
    private void kidLocNow() {
        if (!locOn()) return;
        if (Double.isNaN(fixLa) || Double.isNaN(fixLo)) {
            locPending = true;
            return;
        }
        locSentT = 0L;
        kidLoc(fixLa, fixLo, fixAcc, lastNow > 0L ? lastNow : System.currentTimeMillis());
    }

    /** 부모가 처음 열었는데 위치가 없어 서버가 '위치 한 번 올려' 푸시를 보냈다 — 방금 잡은 위치(2분 안)가 있으면 곧바로 올리고, 없으면 다음 위치를 바로(주기를 기다리지 않고) 올린다. */
    synchronized void locAsk() {
        if (!locOn()) return;
        if (!Double.isNaN(fixLa) && !Double.isNaN(fixLo) && lastFixT > 0L && System.currentTimeMillis() - lastFixT < 120000L) kidLocNow();
        else {
            locPending = true;
            locSentT = 0L;
        }
    }

    private void kidLoc(final double la, final double lo, final float acc, long t) {
        fixLa = la;
        fixLo = lo;
        fixAcc = acc;
        boolean fast = watchW > 0 && System.currentTimeMillis() < watchUntil;
        if (!locOn() || (!locPending && t - locSentT < (fast ? 1200L : (tripId.isEmpty() ? 15000L : 7000L)))) return;      // 출발한 뒤에는 거리가 더 자주 갱신되게
        locPending = false;
        locSentT = t;
        final JSONObject o = new JSONObject();
        put(o, "la", la);
        put(o, "lo", lo);
        put(o, "acc", (double) acc);
        put(o, "dn", dongFull.isEmpty() ? dong : dongFull);
        if (battPct >= 0) {
            put(o, "bt", battPct);
            put(o, "ch", battChg ? 1 : 0);
        }
        Wire.EX.execute(new Runnable() {
            @Override
            public void run() {
                if (ensureReg()) {
                    sendConsent();
                    String r = Kid.call("POST", "/c/loc", o.toString(), cid, csec);
                    watchFrom(r);
                    remGot(null, r);
                }
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
        a.put(b("text", "text", kid ? "부모님이 길동무 앱에서 보내 주신 미션이에요. 해내면 부모님이 완료를 눌러 주고, 그러면 스타포인트가 올라가요." : "내가 부모님께 보내는 미션이에요(한 번에 스타포인트 50). 부모님이 승낙하면 차감돼요.", "sub", "1"));
        if (!kid) a.put(b("input", "hint", "부모님께 보낼 미션을 적어요", "act", "quest.send"));
        int shown = 0;
        for (int i = quests.length() - 1; i >= 0; i--) {
            JSONObject q = quests.optJSONObject(i);
            if (q == null || "p".equals(q.optString("k")) == kid) continue;
            int qs = q.optInt("s", 0);
            boolean done = kid ? qs >= 2 : qs == 1;                  // 자녀 미션은 부모님이 완료(2) · 부모님 미션은 자녀가 완료(1)
            String st = kid ? (done ? "완료! 스타 +" + q.optInt("pt", 1) + " 받았어요" : "부모님이 완료해 주면 스타 +" + q.optInt("pt", 1)) : (done ? "완료했어요" : "부모님이 해 주셨으면 눌러서 완료해요");
            a.put(b("card", "title", q.optString("x"), "text", st, "thumb", "", "act", !kid && !done ? "quest.pdone:" + q.optString("i") : "", "tone", done ? "0" : "1"));
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

    /** 꾸미기 창: 제목 + 네이티브 꾸미기 화면(DressView) + 닫기. 내용은 입을 때마다 바뀌지만 이 글은 늘 같아서 창을 다시 만들지 않는다 —
     *  무엇을 입었는지는 Dress(엔진)가 계산하고 DressView 가 그 자리에서 그린다. */
    synchronized String dressSheet() {
        if (!dressOpen || !consented() || fs.isEmpty()) return "";
        JSONArray a = new JSONArray();
        a.put(b("head", "text", "길동무 친구들 꾸미기"));
        a.put(b("wardrobe"));
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
            String h3 = "", b3 = "", any3 = "", any2 = "", c1 = "", c2 = "";
            for (int i = 0; i < d.length(); i++) {
                JSONObject m = d.optJSONObject(i);
                if (m == null) continue;
                String t = m.optString("region_type", ""), r3 = m.optString("region_3depth_name", "").trim(), r2 = m.optString("region_2depth_name", "").trim();
                if ("H".equals(t) && h3.isEmpty()) h3 = r3;
                if ("B".equals(t) && b3.isEmpty()) b3 = r3;
                if (any3.isEmpty()) any3 = r3;
                if (any2.isEmpty()) any2 = r2;
                if (c1.isEmpty()) { c1 = m.optString("region_1depth_name", "").trim(); c2 = r2; }
            }
            String r = !h3.isEmpty() ? h3 : !b3.isEmpty() ? b3 : !any3.isEmpty() ? any3 : any2;
            if (r.isEmpty()) return;
            if (r.length() > 20) r = r.substring(0, 20);
            String city = "";                                                       // 광역시·특별시는 "인천시" 처럼, 도는 "수원시" 처럼 시 이름만
            if (c1.endsWith("특별자치시")) city = c1.substring(0, c1.length() - 5) + "시";
            else if (c1.endsWith("특별시") || c1.endsWith("광역시")) city = c1.substring(0, c1.length() - 3) + "시";
            else if (!c2.isEmpty()) city = c2.split(" ")[0];
            else city = c1;
            String full = city.isEmpty() || r.startsWith(city) ? r : city + " " + r;
            if (full.length() > 20) full = r;
            boolean ch = !r.equals(dong) || !full.equals(dongFull);
            dongFull = full;
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
        a.put(b("card", "title", "알리는 것", "text", "내 휴대폰의 위치와 알린 시각, 배터리 잔량이에요. 평소에는 몇 분마다 알리고, 부모님이 지도를 보는 동안에는 몇 초마다 알려요. 이때는 맨 위 줄과 알림에 '부모님이 지금 내 위치를 보고 있어요'라고 보여요.", "thumb", "", "act", ""));
        a.put(b("card", "title", "누가 쓸 수 있나요", "text", "만 9살 이상 어린이가 쓸 수 있어요. 부모님(법정대리인)과 함께 읽고 정해요.", "thumb", "", "act", ""));
        a.put(b("card", "title", "누가 보나요", "text", "내가 QR이나 비밀키로 연결한 부모님만 볼 수 있어요.", "thumb", "", "act", ""));
        a.put(b("card", "title", "언제든 끌 수 있어요", "text", "설정에서 위치 공유를 끄거나 동의를 거둘 수 있어요.", "thumb", "", "act", ""));
        a.put(b("card", "title", "보관", "text", "위치 기록은 3일, 지난 길은 7일, 오래 머문 곳은 30일 뒤에 지워져요. 연결을 끊으면 바로 모두 지워져요.", "thumb", "", "act", ""));
        a.put(b("gap", "h", "8"));
        a.put(b("switch", "label", "보호자(부모님)가 위 내용을 확인하고 동의했어요", "on", store.get("cp2", "0"), "act", "consent.parent"));
        a.put(b("switch", "label", "나도 위 내용을 이해했고 동의해요", "on", store.get("cc2", "0"), "act", "consent.child"));
        boolean ok = "1".equals(store.get("cp2", "0")) && "1".equals(store.get("cc2", "0"));
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
        a.put(b("gap", "h", "6"));
        JSONArray it = new JSONArray();
        it.put(b("i", "label", "관리", "act", "mg.open", "on", "0"));
        JSONObject bt = b("btns");
        put(bt, "items", it);
        a.put(bt);
        return wrap("scroll", a);
    }

    /** 관리 창으로 들어가기 전 비밀번호 창: 처음이면 정하고(두 번), 이후엔 넣어야 열린다. */
    private String mgAuthSheet() {
        JSONArray a = new JSONArray();
        a.put(b("head", "text", mg == 3 ? "비밀번호를 넣어요" : mg == 2 ? "한 번 더 넣어요" : "비밀번호를 정해요"));
        a.put(b("text", "text", mg == 3 ? "관리에 들어가려면 숫자 4자리 비밀번호가 필요해요." : mg == 2 ? "방금 정한 숫자 4자리를 똑같이 한 번 더 넣어요." : "처음이에요. 부모님과 함께 숫자 4자리 비밀번호를 정해요. 다음부터는 이 번호로 들어와요.", "sub", "1"));
        a.put(b("pw", "hint", "숫자 4자리", "btn", mg == 3 ? "열기" : "확인", "act", "mg.pw"));
        if (!mgErr.isEmpty()) a.put(b("text", "text", mgErr, "sub", "1"));
        JSONArray it = new JSONArray();
        it.put(b("i", "label", "취소", "act", "mg.close", "on", "0"));
        JSONObject bt = b("btns");
        put(bt, "items", it);
        a.put(bt);
        return wrap("scroll", a);
    }

    private static String pwHash(String pin) {
        try {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
            byte[] d = md.digest(("gdm-kids-mg:" + pin).getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (byte x : d) sb.append(String.format("%02x", x & 0xff));
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    synchronized String mgSheet() {
        if (!consented() || mg == 0) return "";
        if (mg != 4) return mgAuthSheet();
        JSONArray a = new JSONArray();
        a.put(b("head", "text", "관리"));
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
        JSONArray it3 = new JSONArray();
        it3.put(b("i", "label", "닫기", "act", "mg.close", "on", "0"));
        JSONObject bt3 = b("btns");
        put(bt3, "items", it3);
        a.put(bt3);
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
            store.put("cp2", "1".equals(store.get("cp2", "0")) ? "0" : "1");
        } else if (v.equals("consent.child")) {
            store.put("cc2", "1".equals(store.get("cc2", "0")) ? "0" : "1");
        } else if (v.equals("consent.ok")) {
            if ("1".equals(store.get("cp2", "0")) && "1".equals(store.get("cc2", "0"))) {
                store.put("consent2", "1");
                store.put("cons2sent", "0");
                loc = true;
                tab = "home";
                res = cmd("perm");
                Wire.EX.execute(new Runnable() {
                    @Override
                    public void run() {
                        sendConsent();
                    }
                });
            }
        } else if (v.equals("mg.open")) {
            mg = store.get("mgpw", "").isEmpty() ? 1 : 3;
            mgTmp = "";
            mgErr = "";
        } else if (v.equals("mg.close")) {
            mg = 0;
            mgTmp = "";
            mgErr = "";
        } else if (v.equals("mg.pw")) {
            String pin = arg == null ? "" : arg.trim();
            if (!pin.matches("[0-9]{4}")) {
                mgErr = "숫자 4자리로 넣어 주세요";
            } else if (mg == 1) {
                mgTmp = pin;
                mg = 2;
                mgErr = "";
            } else if (mg == 2) {
                if (pin.equals(mgTmp)) {
                    store.put("mgpw", pwHash(pin));
                    mg = 4;
                    mgErr = "";
                } else {
                    mg = 1;
                    mgErr = "처음 넣은 번호와 달라요. 다시 정해요";
                }
                mgTmp = "";
            } else if (mg == 3) {
                if (pwHash(pin).equals(store.get("mgpw", ""))) {
                    mg = 4;
                    mgErr = "";
                } else {
                    mgErr = "비밀번호가 달라요";
                }
            }
        } else if (v.equals("consent.reset") && mg == 4) {
            mg = 0;
            mgTmp = "";
            mgErr = "";
            store.put("mgpw", "");
            kidUnlink();
            store.put("consent2", "0");
            store.put("cons2sent", "0");
            store.put("cp2", "0");
            store.put("cc2", "0");
            loc = false;
            tab = "home";
            res = cmd("loc.stop");
        } else if (v.equals("loc.toggle") && mg == 4) {
            loc = !loc;
            shareTell(loc);
            res = loc ? cmd("perm") : cmd("loc.stop");
        } else if (v.equals("loc.denied")) {
            loc = false;
            shareTell(false);
        } else if (v.equals("pair.new") && mg == 4) {
            kidPair();
        } else if (v.equals("pair.unlink") && mg == 4) {
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
        } else if (v.startsWith("quest.accept:") || v.startsWith("quest.reject:") || v.startsWith("quest.fin:") || v.startsWith("quest.confirm:")) {          // 미션 승낙 · 거절 · 완료 · 확인(부모님 미션 완료 확인) — 상태 · 스타포인트 계산은 모두 서버가 하고 새 화면을 돌려준다
            kidAct(v, "");
        } else if (v.startsWith("quest.pdone:")) {          // (옛 단추) 부모님 미션: 자녀가 완료를 누르면 이 화면도 바로 완료로 바뀐다
            for (int qi = 0; qi < quests.length(); qi++) {
                JSONObject qq = quests.optJSONObject(qi);
                if (qq != null && v.substring(12).equals(qq.optString("i")) && "p".equals(qq.optString("k"))) put(qq, "s", 1);
            }
            dirty = true;
            kidAct(v, "");
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
            if (mg != 0) {
                mg = 0;
                mgTmp = "";
                mgErr = "";
            } else if (!dressOpen && !promptId.isEmpty()) promptShut = true;
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
                if (f.poop > 0) kidEv("clean", f.name);
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
            if (f.poop > 0) kidEv("clean", f.name);
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
            if (f.poop > 0) kidEv("clean", f.name);
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
        body.put(nd("marq", "h", 26, "pad", pad(8, 7, 8, 8), "msgs", m, "pass", 16000, "grad", 6000, "line", true));
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
        if (f.joinUntil > now) return "play";                                           // 모이라는 부름: 자던 친구도 모여 논다(끝나면 원래 자던 잠으로 돌아간다)
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
        if ("beg".equals(st)) return new String[] {"kbeg", "rest", "kbeg", "rest"};
        if ("sulk".equals(st)) return new String[] {"ksulk", "rest", "ksulk"};
        if ("sick".equals(st)) return new String[] {"ksick", "rest", "ksick"};
        if ("poop".equals(st)) return new String[] {"kpoop", "rest", "kpoop", "rest", "kpoop"};
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
            if (f.poop > 0) kidEv("clean", f.name);
            f.poop = 0;
            f.poopNeg = false;
            f.poopSince = 0L;
            recover(f, now);
        } else if ("feed".equals(what)) {
            feedOne(f, now);
        } else if ("study".equals(what) || "sleep".equals(what)) {
            if (f.sick || f.sulkUntil > now || wakeAt(f, now) != 0L) return;
            boolean st = "study".equals(what);
            kidEv(st ? "pstudy" : "psleep", f.name);                                           // 부모님께: 'OO이가 ○○를 재웠어요 / 공부를 시켰어요'
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
        boolean any = false;
        for (int i = 0; i < g.size(); i++) {
            F f = g.get(i);
            boolean asleep = wakeAt(f, now) != 0L || ("sleep".equals(f.tm) && f.tmUntil > now);
            if ("play".equals(m) && asleep && !f.sick && f.sulkUntil <= now) {
                f.joinUntil = now + ms;                                                       // 자는 친구도 깨어 모인다 — 잠(tm)은 그대로 두어 모임이 끝나면 다시 잔다
                f.joinSleepy = true;
                any = true;
                continue;
            }
            if (f.sick || f.sulkUntil > now || wakeAt(f, now) != 0L) continue;
            if ("play".equals(m)) f.joinUntil = 0L;
            setTm(f, m, now + ms);
            any = true;
            if (!"play".equals(m)) f.nextLong = now + 8L * 60L * 1000L;
        }
        if (any) kidEv("p" + m, "친구들");                                                   // 한꺼번에 누른 것은 한 줄로(친구마다 한 줄씩 쌓이지 않게)
    }

    /** 졸린 채로 모여 있는 친구들(형식 ",id,id,") — 장면이 이 친구들에게 졸린 말을 하게 한다. */
    private String sleepyCsv(long now) {
        StringBuilder sb = new StringBuilder(",");
        for (int i = 0; i < fs.size(); i++) {
            F f = fs.get(i);
            if (f.joinUntil > now && f.joinSleepy) sb.append(f.id).append(',');
        }
        return sb.toString();
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
