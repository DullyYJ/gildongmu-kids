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
    private static volatile Sink sink;
    private Poke() {}
    public static void setStudy(String csv) { study = csv == null ? "," : csv; }
    public static void setSleep(String csv) { sleep = csv == null ? "," : csv; }
    public static void setSink(Sink s) { sink = s; }
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
    /** 건드린 친구가 공부 중이면 1, 자는 중이면 2, 아니면 0 — 화낼 일이면 엔진에도 알린다. */
    public static int kind(String id) {
        if (id == null) return 0;
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
