package com.dullyyj.kids;

import android.content.Context;
import android.content.SharedPreferences;

/** 기기에 저장하는 작은 값들(엔진 상태 포함). */
final class Store {
    private final SharedPreferences sp;

    Store(Context c) {
        sp = c.getSharedPreferences("kids", Context.MODE_PRIVATE);
    }

    synchronized String get(String k, String d) {
        return sp.getString(k, d);
    }

    synchronized void put(String k, String v) {
        sp.edit().putString(k, v).apply();
    }

    synchronized long getLong(String k, long d) {
        try {
            return Long.parseLong(sp.getString(k, String.valueOf(d)));
        } catch (Exception e) {
            return d;
        }
    }

    synchronized void putLong(String k, long v) {
        put(k, String.valueOf(v));
    }

    synchronized boolean has(String k) {
        return sp.contains(k);
    }
}
