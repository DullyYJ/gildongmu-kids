package com.dullyyj.kids;
public final class Poke {
    public interface Sink { void angry(String id); }
    private static volatile String study = ",";
    private static volatile String sleep = ",";
    private static volatile Sink sink;
    private Poke() {}
    public static void setStudy(String csv) { study = csv == null ? "," : csv; }
    public static void setSleep(String csv) { sleep = csv == null ? "," : csv; }
    public static void setSink(Sink s) { sink = s; }
    /** 건드린 친구가 공부 중이면 1, 자는 중이면 2, 아니면 0 — 화낼 일이면 엔진에도 알린다. */
    public static int kind(String id) {
        if (id == null) return 0;
        int k = study.indexOf("," + id + ",") >= 0 ? 1 : sleep.indexOf("," + id + ",") >= 0 ? 2 : 0;
        Sink s = sink;
        if (k != 0 && s != null) s.angry(id);
        return k;
    }
}
