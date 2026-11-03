package com.dullyyj.kids;
/** 엔진(친구들의 지금 상태)과 장면 그리개 사이의 다리 — 엔진이 값을 놓고 그리개가 읽는다. 장면 그리개는 이 값을 그리기만 한다. */
public final class Poke {
    public interface Sink {
        void angry(String id);
        void pick(String id, String what);
    }
    private static volatile String study = ",";
    private static volatile String sleep = ",";
    private static volatile String states = ";";
    private static volatile String sleepy = ",";
    private static volatile String shown = ",";
    private static volatile Sink sink;
    private Poke() {}
    public static void setStudy(String csv) { study = csv == null ? "," : csv; }
    public static void setSleep(String csv) { sleep = csv == null ? "," : csv; }
    /** 졸린 채로 모여 있는 친구들(형식 ",id,id,") — 엔진이 놓고(s387) 장면이 읽는다: 이 친구들은 느릿한 몸짓과 졸린 말로 모여 있는다. */
    public static void setSleepy(String csv) { sleepy = csv == null ? "," : csv; }
    public static boolean sleepy(String id) { return id != null && sleepy.indexOf("," + id + ",") >= 0; }
    public static void setSink(Sink s) { sink = s; }
    /** 장면 아래 모서리의 호출 버튼("arr" 안전 도착 · "pick" 데리러 와줘)이 눌렸다 — 앱 화면(MainActivity)이 받아 서버에 알린다. */
    public interface Caller { void call(String what); }
    private static volatile Caller caller;
    private static volatile boolean callOk;
    /** 연결된 부모님이 있으면 true — 없으면 장면 아래 모서리 호출 단추(안전 도착 · 데리러 와줘)는 회색이고 눌리지 않는다. */
    public static void setCallOk(boolean ok) { callOk = ok; }
    public static boolean callOk() { return callOk; }
    public static void setCaller(Caller c) { caller = c; }
    public static void call(String what) { Caller c = caller; if (c != null && what != null) c.call(what); }
    /** 지금 화면에 나와 있는 친구들(장면 그리개가 놓고 엔진이 읽는다) — 형식 ",id,id,". */
    public static void setShown(String csv) { shown = csv == null ? "," : csv; }
    public static String shown() { return shown; }
    /** 형식 ";id:상태:응가수;id:상태:응가수;" */
    public static void setStates(String s) { states = s == null ? ";" : s; }
    private static String field(String id, int n) {
        String s = states, k = ";" + id + ":";
        int i = s.indexOf(k);
        if (i < 0) return "";
        int a = i + k.length(), e = s.indexOf(';', a);
        String r = e < 0 ? s.substring(a) : s.substring(a, e);
        int c = r.indexOf(':');
        if (n == 0) return c < 0 ? r : r.substring(0, c);
        return c < 0 ? "" : r.substring(c + 1);
    }
    public static String state(String id) { return id == null ? "" : field(id, 0); }
    public static int poops(String id) {
        try { return id == null ? 0 : Integer.parseInt(field(id, 1)); } catch (NumberFormatException e) { return 0; }
    }
    /** 자는 중(깨지 않은 채)인데 응가가 있으면 true — 이때는 건드려도 화내지 않고 원형 메뉴에서 '응가 치우기'만 누를 수 있다(나머지는 회색). 치우면 그대로 다시 잔다. */
    public static boolean sleepPoop(String id) {
        return id != null && "sleep".equals(state(id)) && poops(id) > 0;
    }
    /** 건드린 친구가 공부 중이면 1, 자는 중이면 2, 아니면 0 — 화낼 일이면 엔진에도 알린다. */
    public static int kind(String id) {
        if (id == null) return 0;
        if (sleepPoop(id)) return 0;                                              // 응가 싸고 자는 친구: 화내지 않는다(메뉴에서 응가만 치울 수 있다)
        int k = study.indexOf("," + id + ",") >= 0 ? 1 : sleep.indexOf("," + id + ",") >= 0 ? 2 : 0;
        Sink s = sink;
        if (k != 0 && s != null) s.angry(id);
        return k;
    }
    /** 원형 메뉴에서 고른 일(clean · feed · study · sleep)을 엔진에 알린다. */
    public static void pick(String id, String what) {
        Sink s = sink;
        if (s != null && id != null && what != null) s.pick(id, what);
    }
}
