package com.dullyyj.kids;
public final class Poke {
    public interface Sink { void angry(String id); }
    private static volatile String study = ",";
    private static volatile Sink sink;
    private Poke() {}
    public static void setStudy(String csv) { study = csv == null ? "," : csv; }
    public static void setSink(Sink s) { sink = s; }
    public static boolean studying(String id) {
        if (id == null || study.indexOf("," + id + ",") < 0) return false;
        Sink s = sink;
        if (s != null) s.angry(id);
        return true;
    }
}
