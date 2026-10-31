package com.dullyyj.kids;

import android.app.Application;

public class KidsApp extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        Core.init(this);
    }
}
