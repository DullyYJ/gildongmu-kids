package com.dullyyj.kids;

import android.content.Context;

/** 앱 전체가 함께 쓰는 단일 객체들. */
final class Core {
    static Store store;
    static Engine engine;
    static Sheets sheets;

    private Core() {}

    static synchronized void init(Context app) {
        if (store != null) return;
        store = new Store(app);
        engine = new Engine(store);
        sheets = new Sheets(app);
    }
}
